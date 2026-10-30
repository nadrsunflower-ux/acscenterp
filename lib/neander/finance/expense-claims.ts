// 개인이 먼저 결제한 회사 비용. 원장의 비용과 실제 은행 상환은 서로 다른 기록이다.
import type { FinPaymentMethodDoc } from "./db-types";
import { dedupHashOf, netAmount, type FinTransaction } from "./types";

export interface ExpenseClaimRow {
  rowNo: number;
  date: string;
  vendor: string;
  gross: number;
  txType: "지출" | "환급";
  paymentLabel?: string;
  accountText?: string;
  projectText?: string;
  bizMajor?: string;
  bizMinor?: string;
  acctMajor?: string;
  acctMid?: string;
  acctMinor?: string;
  projectCode?: string;
  note?: string;
}

export interface ExpenseClaimDoc {
  id: string;
  payer: string;
  payerKey: string;
  site: string;
  paymentLabel?: string;
  fileName: string;
  fileHash: string;
  createdAt: number;
  createdBy?: string;
  updatedAt?: number;
  updatedBy?: string;
}

export interface ExpenseClaimImportInput {
  payer: string;
  site: string;
  paymentLabel?: string;
  fileName: string;
  fileHash: string;
  rows: ExpenseClaimRow[];
}

export const MAX_EXPENSE_CLAIM_ROWS = 150;

/** 공백·유니코드 표기 차이로 같은 결제자가 중복 생성되지 않게 한다. */
export const expensePayerKey = (payer: string) => payer.normalize("NFC").replace(/\s+/g, "").toLowerCase();
export const expensePaymentKey = (label?: string) => (label ?? "").normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();

/** 분류·프로젝트·나중에 고친 금액과 별개로 원본 명세서 행의 식별값을 유지한다. */
export function expenseClaimDedupHash(payerKey: string, paymentLabel: string | undefined, row: ExpenseClaimRow): string {
  const raw = dedupHashOf({ date: row.date, vendor: row.vendor, gross: row.gross, txType: row.txType });
  return `expense-claim:${encodeURIComponent(payerKey)}:${encodeURIComponent(expensePaymentKey(paymentLabel))}:${raw}`;
}

/** 비용 나누기의 조각도 같은 원본 결제 한 건으로 센다. */
export function expenseClaimSourceCounts(transactions: FinTransaction[]): Map<string, number> {
  const sources = new Map<string, Set<string>>();
  transactions.forEach((tx) => {
    if (!tx.expenseClaim || !tx.dedupHash) return;
    const hash = tx.dedupHash.replace(/(?:#split\d+)+$/, "");
    const ids = sources.get(hash) ?? new Set<string>();
    ids.add(`${tx.expenseClaim.claimId}:${tx.expenseClaim.rowNo}`);
    sources.set(hash, ids);
  });
  return new Map([...sources].map(([hash, ids]) => [hash, ids.size]));
}

export interface ExpenseClaimSummary {
  expenses: FinTransaction[];
  settlements: FinTransaction[];
  /**  원장에서 계정·유형이 바뀐 연결. 목록에는 남겨 연결을 풀 수 있게 한다. */
  invalidSettlements: FinTransaction[];
  total: number;
  settled: number;
  remaining: number;
  overpaid: number;
}

export function expenseClaimSummary(claim: ExpenseClaimDoc, transactions: FinTransaction[], paymentMethods?: FinPaymentMethodDoc[]): ExpenseClaimSummary {
  const expenses = transactions.filter((tx) => tx.expenseClaim?.claimId === claim.id && (tx.txType === "지출" || tx.txType === "환급"));
  const settlements = transactions.filter((tx) => tx.expenseReimbursement?.claimId === claim.id);
  const total = expenses.reduce((sum, tx) => sum + (tx.personalUse ? 0 : (tx.txType === "환급" ? -netAmount(tx) : netAmount(tx))), 0);
  const validSettlement = (tx: FinTransaction) => isExpenseClaimSettlementType(tx) &&
    (!paymentMethods || paymentMethods.some((method) => method.last4 === tx.last4 && method.kind === "account"));
  const invalidSettlements = settlements.filter((tx) => !validSettlement(tx));
  const settled = settlements.reduce((sum, tx) => sum + (validSettlement(tx) ? netAmount(tx) : 0), 0);
  return { expenses, settlements, invalidSettlements, total, settled, remaining: Math.max(0, total - settled), overpaid: Math.max(0, settled - total) };
}

/** 이미 분류된 은행 상환 전체만 연결한다. 금액 나누기나 계정 추정은 하지 않는다. */
export function isExpenseClaimSettlementType(tx: FinTransaction): boolean {
  return tx.txType === "자금거래" && tx.acctMajor === "가수금" && tx.acctMid === "가수금관리" && tx.acctMinor === "가수금지급" &&
    !tx.expenseClaim && !tx.personalUse && typeof tx.last4 === "string" && /^\d{4}$/.test(tx.last4) && Number.isSafeInteger(netAmount(tx)) && netAmount(tx) > 0;
}

export function isExpenseClaimSettlement(tx: FinTransaction, paymentMethods: FinPaymentMethodDoc[]): boolean {
  return isExpenseClaimSettlementType(tx) && paymentMethods.some((method) => method.last4 === tx.last4 && method.kind === "account");
}

export function expenseClaimCandidates(claim: ExpenseClaimDoc, transactions: FinTransaction[], paymentMethods: FinPaymentMethodDoc[]): FinTransaction[] {
  const { remaining } = expenseClaimSummary(claim, transactions, paymentMethods);
  return transactions.filter((tx) => !tx.expenseReimbursement && isExpenseClaimSettlement(tx, paymentMethods) && netAmount(tx) <= remaining)
    .sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
}
