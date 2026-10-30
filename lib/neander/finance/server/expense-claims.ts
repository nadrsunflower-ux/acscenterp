import "server-only";

import { createHash } from "node:crypto";
import { FieldValue, type Firestore, type Transaction } from "firebase-admin/firestore";
import { NEANDER_COL } from "@/lib/neander/collections";
import type { FinAccountDoc, FinPaymentMethodDoc } from "../db-types";
import {
  MAX_EXPENSE_CLAIM_ROWS,
  expenseClaimDedupHash,
  expenseClaimSourceCounts,
  expenseClaimSummary,
  expensePayerKey,
  expensePaymentKey,
  isExpenseClaimSettlement,
  type ExpenseClaimDoc,
  type ExpenseClaimImportInput,
  type ExpenseClaimRow,
} from "../expense-claims";
import { trimTransaction } from "../payload";
import { BIZ_MAJORS } from "../sheet";
import type { FinSuspenseDoc } from "../suspense";
import { lookupKeyOf, netAmount, type FinTransaction } from "../types";

export class ExpenseClaimError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

const assert: (ok: unknown, message: string, status?: number) => asserts ok = (ok, message, status = 400) => {
  if (!ok) throw new ExpenseClaimError(message, status);
};
const text = (value: unknown) => typeof value === "string" ? value.normalize("NFC").trim() : "";
const optional = (value: unknown, max = 240) => {
  const valueText = text(value);
  assert(valueText.length <= max, "입력한 글자가 너무 깁니다.");
  return valueText || undefined;
};
function assertId(id: unknown): asserts id is string {
  assert(typeof id === "string" && /^[A-Za-z0-9_-]{8,128}$/.test(id), "기록 번호가 올바르지 않습니다.");
}
const claims = (db: Firestore) => db.collection(NEANDER_COL.finExpenseClaims);
const transactions = (db: Firestore) => db.collection(NEANDER_COL.finTransactions);
const clean = <T extends object>(value: T): Record<string, unknown> => Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined));
const asClaim = (id: string, data: object): ExpenseClaimDoc => ({ ...data, id } as ExpenseClaimDoc);
const asTx = (id: string, data: object): FinTransaction => ({ ...data, id } as FinTransaction);

function validDate(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

function parseInput(raw: ExpenseClaimImportInput): ExpenseClaimImportInput {
  assert(raw && typeof raw === "object", "등록할 대납 내역이 없습니다.");
  const payer = text(raw.payer);
  const site = text(raw.site);
  const fileName = text(raw.fileName);
  const fileHash = text(raw.fileHash).toLowerCase();
  assert(payer && payer.length <= 80 && expensePayerKey(payer), "먼저 결제한 사람을 입력하세요.");
  assert(site && site.length <= 80, "회사 비용이 귀속될 사업체를 선택하세요.");
  assert(fileName && fileName.length <= 240 && !/[\u0000-\u001f\u007f]/.test(fileName), "원본 파일 이름이 올바르지 않습니다.");
  assert(/^[a-f0-9]{64}$/.test(fileHash), "원본 파일 확인값이 올바르지 않습니다.");
  assert(Array.isArray(raw.rows) && raw.rows.length > 0 && raw.rows.length <= MAX_EXPENSE_CLAIM_ROWS,
    `회사 비용을 1~${MAX_EXPENSE_CLAIM_ROWS}행 선택하세요.`);
  const rowNos = new Set<number>();
  let total = 0;
  const rows = raw.rows.map((row): ExpenseClaimRow => {
    assert(row && typeof row === "object", "등록할 행이 올바르지 않습니다.");
    assert(Number.isSafeInteger(row.rowNo) && row.rowNo > 0 && !rowNos.has(row.rowNo), "원본 행 번호가 없거나 중복됐습니다.");
    rowNos.add(row.rowNo);
    const date = text(row.date);
    const vendor = text(row.vendor);
    assert(validDate(date), `${row.rowNo}행: 실제 이용일을 확인하세요.`);
    assert(vendor && vendor.length <= 200, `${row.rowNo}행: 가맹점 이름을 확인하세요.`);
    assert(row.txType === "지출" || row.txType === "환급", `${row.rowNo}행: 비용 또는 환급만 등록할 수 있습니다.`);
    assert(Number.isSafeInteger(row.gross) && row.gross > 0, `${row.rowNo}행: 금액은 0보다 큰 정수여야 합니다.`);
    total += row.gross;
    assert(Number.isSafeInteger(total), "등록 금액이 너무 큽니다.");
    const bizMajor = text(row.bizMajor);
    const bizMinor = text(row.bizMinor);
    assert((BIZ_MAJORS as readonly string[]).includes(bizMajor) && bizMinor && bizMinor.length <= 80,
      `${row.rowNo}행: 사업 대분류와 소분류를 선택하세요.`);
    const acctMajor = text(row.acctMajor), acctMid = text(row.acctMid), acctMinor = text(row.acctMinor);
    assert(acctMajor && acctMid && acctMinor && [acctMajor, acctMid, acctMinor].every((v) => v.length <= 100),
      `${row.rowNo}행: 실제 계정 대·중·소분류를 선택하세요.`);
    // 입력으로 카드번호·원장 id·수령/상환 꼬리표를 넘겨도 가져오지 않는다.
    return clean({ rowNo: row.rowNo, date, vendor, gross: row.gross, txType: row.txType, bizMajor, bizMinor,
      acctMajor, acctMid, acctMinor, paymentLabel: optional(row.paymentLabel, 120),
      accountText: optional(row.accountText, 240), projectText: optional(row.projectText, 240),
      projectCode: optional(row.projectCode, 100), note: optional(row.note, 4000) }) as unknown as ExpenseClaimRow;
  });
  return { payer, site, fileName, fileHash, paymentLabel: optional(raw.paymentLabel, 120), rows };
}

/** 동일 결제자·결제수단의 중복 적재를 서로 다른 요청도 한 번씩만 처리한다. */
function scopeLock(db: Firestore, payerKey: string, paymentLabel?: string) {
  const hash = createHash("sha256").update(JSON.stringify([payerKey, expensePaymentKey(paymentLabel)])).digest("hex");
  return db.collection(NEANDER_COL.finSettings).doc(`expense-claim-scope-${hash}`);
}

function log(tx: Transaction, db: Firestore, by: string, at: number, txId: string, kind: "add" | "delete" | "edit", before?: unknown, after?: unknown) {
  tx.create(db.collection(NEANDER_COL.finTxLog).doc(), clean({ txId, at, by, via: "expense-claim", kind,
    changes: kind === "edit" ? [{ f: "expenseReimbursement", from: before ? JSON.stringify(before) : null, to: after ? JSON.stringify(after) : null }] : undefined }));
}

export async function listExpenseClaims(db: Firestore): Promise<ExpenseClaimDoc[]> {
  const snapshot = await claims(db).get();
  return snapshot.docs.map((doc) => asClaim(doc.id, doc.data())).sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));
}

export async function importExpenseClaim(db: Firestore, by: string, raw: ExpenseClaimImportInput) {
  const input = parseInput(raw);
  const payerKey = expensePayerKey(input.payer);
  const ref = claims(db).doc();
  const now = Date.now();
  const lockRefs = [...new Map(input.rows.map((row) => {
    const lock = scopeLock(db, payerKey, row.paymentLabel ?? input.paymentLabel);
    return [lock.path, lock];
  })).values()].sort((a, b) => a.path.localeCompare(b.path));
  return db.runTransaction(async (tx) => {
    await tx.getAll(...lockRefs);
    const [existing, knownClaims, accounts, methods, projects] = await Promise.all([
      tx.get(transactions(db).where("expenseClaim.payerKey", "==", payerKey)),
      tx.get(claims(db).where("payerKey", "==", payerKey)),
      tx.get(db.collection(NEANDER_COL.finAccounts)),
      tx.get(db.collection(NEANDER_COL.finPaymentMethods)),
      tx.get(db.collection(NEANDER_COL.finProjects)),
    ]);
    const accountMap = new Map(accounts.docs.map((doc) => {
      const account = { ...doc.data(), id: doc.id } as FinAccountDoc;
      return [account.lookupKey || doc.id, account];
    }));
    assert(methods.docs.some((doc) => doc.data().site === input.site), "선택한 사업체가 결제수단 마스터에 없습니다.");
    const projectCodes = new Set(projects.docs.map((doc) => text(doc.data().code).toLowerCase()));
    input.rows.forEach((row) => {
      const account = accountMap.get(lookupKeyOf(row)) ?? (row.txType === "환급" ? accountMap.get(lookupKeyOf({ ...row, txType: "지출" })) : undefined);
      assert(account && account.active !== false, `${row.rowNo}행: 현재 사용할 수 있는 계정을 선택하세요.`);
      assert(!row.projectCode || projectCodes.has(row.projectCode.toLowerCase()), `${row.rowNo}행: 존재하지 않는 프로젝트 코드입니다.`);
    });
    const existingTx = existing.docs.map((doc) => asTx(doc.id, doc.data()));
    const counts = expenseClaimSourceCounts(existingTx);
    const seen = new Map<string, number>();
    const pending: { hash: string; row: ExpenseClaimRow }[] = [];
    let skippedClaimId: string | undefined;
    input.rows.forEach((row) => {
      const label = row.paymentLabel ?? input.paymentLabel;
      const hash = expenseClaimDedupHash(payerKey, label, row);
      const occurrence = (seen.get(hash) ?? 0) + 1;
      seen.set(hash, occurrence);
      if (occurrence <= (counts.get(hash) ?? 0)) {
        skippedClaimId ??= existingTx.find((item) => item.dedupHash.replace(/(?:#split\d+)+$/, "") === hash)?.expenseClaim?.claimId;
      } else pending.push({ hash, row });
    });
    if (pending.length === 0) {
      const previous = knownClaims.docs.find((doc) => doc.id === skippedClaimId);
      assert(previous, "이미 등록된 비용의 출처 기록을 찾지 못했습니다. 원장에서 확인해 주세요.", 409);
      return { claim: asClaim(previous.id, previous.data()), transactions: [] as Record<string, unknown>[], inserted: 0, skipped: input.rows.length };
    }
    const claim = clean({ payer: input.payer, payerKey, site: input.site, paymentLabel: input.paymentLabel,
      fileName: input.fileName, fileHash: input.fileHash, createdAt: now, createdBy: by, updatedAt: now, updatedBy: by });
    const added: Record<string, unknown>[] = [];
    pending.forEach(({ hash, row }) => {
      const costRef = transactions(db).doc();
      const source = clean({ claimId: ref.id, payer: input.payer, payerKey, paymentLabel: row.paymentLabel ?? input.paymentLabel,
        fileName: input.fileName, rowNo: row.rowNo });
      const paymentLabel = row.paymentLabel ?? input.paymentLabel;
      const note = [`개인 결제 회사 비용 — 결제자: ${input.payer}${paymentLabel ? ` · 결제수단: ${paymentLabel}` : ""} · ${input.fileName} ${row.rowNo}행`,
        row.note, row.accountText ? `원본 계정: ${row.accountText}` : "", row.projectText ? `원본 프로젝트: ${row.projectText}` : ""].filter(Boolean).join("\n");
      const data = clean({ date: row.date, txType: row.txType, vendor: row.vendor, gross: row.gross, adjust: 0,
        bizMajor: row.bizMajor, bizMinor: row.bizMinor, acctMajor: row.acctMajor, acctMid: row.acctMid, acctMinor: row.acctMinor,
        projectCode: row.projectCode, site: input.site, personalUse: false, expenseClaim: source,
        note: note || undefined, status: "confirmed", engineSig: "hold", classReason: `${input.payer} 개인 결제 회사 비용 — ${input.fileName} ${row.rowNo}행`,
        dedupHash: hash, createdAt: now, updatedAt: now, updatedBy: by });
      tx.create(costRef, data);
      log(tx, db, by, now, costRef.id, "add");
      added.push(trimTransaction({ ...data, id: costRef.id }));
    });
    tx.create(ref, claim);
    lockRefs.forEach((lock) => tx.set(lock, { payerKey, updatedAt: now, updatedBy: by }));
    return { claim: asClaim(ref.id, claim), transactions: added, inserted: pending.length, skipped: input.rows.length - pending.length };
  });
}

export async function linkExpenseClaimSettlement(db: Firestore, by: string, claimId: string, txId: string) {
  assertId(claimId); assertId(txId);
  return db.runTransaction(async (tx) => {
    const ref = claims(db).doc(claimId), bankRef = transactions(db).doc(txId);
    const [claimDoc, bankDoc, costs, repayments, methods, suspense] = await Promise.all([
      tx.get(ref), tx.get(bankRef),
      tx.get(transactions(db).where("expenseClaim.claimId", "==", claimId)),
      tx.get(transactions(db).where("expenseReimbursement.claimId", "==", claimId)),
      tx.get(db.collection(NEANDER_COL.finPaymentMethods)), tx.get(db.collection(NEANDER_COL.finSuspense)),
    ]);
    assert(claimDoc.exists, "대납 기록이 없습니다.", 404);
    assert(bankDoc.exists, "연결할 은행 거래가 없습니다.", 404);
    const claim = asClaim(claimDoc.id, claimDoc.data()!);
    const bank = asTx(bankDoc.id, bankDoc.data()!);
    if (bank.expenseReimbursement?.claimId === claimId) return { ok: true, transactions: [trimTransaction({ ...bank })] };
    assert(!bank.expenseReimbursement, "이미 다른 대납 건에 연결된 상환입니다.", 409);
    const paymentMethods = methods.docs.map((doc) => ({ ...doc.data(), id: doc.id }) as FinPaymentMethodDoc);
    assert(isExpenseClaimSettlement(bank, paymentMethods), "은행 통장의 자금거래 › 가수금 › 가수금관리 › 가수금지급 거래만 연결할 수 있습니다.");
    const debts = suspense.docs.map((doc) => doc.data() as FinSuspenseDoc);
    assert(!debts.some((debt) => (debt.origins ?? []).some((item) => item.txId === txId) || (debt.settles ?? []).some((item) => item.txId === txId)),
      "가수금 기록장에 이미 연결된 거래입니다. 같은 송금을 두 채무에 사용할 수 없습니다.", 409);
    const rows = [...costs.docs, ...repayments.docs].map((doc) => asTx(doc.id, doc.data()));
    const summary = expenseClaimSummary(claim, rows, paymentMethods);
    assert(netAmount(bank) <= summary.remaining, "이 송금 전체 금액이 남은 대납금보다 큽니다. 원장에서 금액을 나눈 뒤 연결하세요.", 409);
    const now = Date.now(), metadata = { claimId, payer: claim.payer };
    tx.update(bankRef, { expenseReimbursement: metadata, engineSig: "hold", updatedAt: now, updatedBy: by });
    tx.update(ref, { updatedAt: now, updatedBy: by });
    log(tx, db, by, now, txId, "edit", bank.expenseReimbursement, metadata);
    return { ok: true, transactions: [trimTransaction({ ...bank, expenseReimbursement: metadata, engineSig: "hold", updatedAt: now, updatedBy: by })] };
  });
}

export async function unlinkExpenseClaimSettlement(db: Firestore, by: string, claimId: string, txId: string) {
  assertId(claimId); assertId(txId);
  return db.runTransaction(async (tx) => {
    const ref = claims(db).doc(claimId), bankRef = transactions(db).doc(txId);
    const snapshots = await tx.getAll(ref, bankRef);
    const claimDoc = snapshots.find((doc) => doc.ref.path === ref.path)!;
    const bankDoc = snapshots.find((doc) => doc.ref.path === bankRef.path)!;
    assert(claimDoc.exists, "대납 기록이 없습니다.", 404);
    assert(bankDoc.exists, "연결한 은행 거래가 없습니다.", 404);
    const bank = asTx(bankDoc.id, bankDoc.data()!);
    assert(bank.expenseReimbursement?.claimId === claimId, "이 대납 건의 상환 연결이 아닙니다.", 409);
    const now = Date.now();
    tx.update(bankRef, { expenseReimbursement: FieldValue.delete(), updatedAt: now, updatedBy: by });
    tx.update(ref, { updatedAt: now, updatedBy: by });
    log(tx, db, by, now, txId, "edit", bank.expenseReimbursement, undefined);
    const { expenseReimbursement: _removed, ...rest } = bank;
    return { ok: true, transactions: [trimTransaction({ ...rest, updatedAt: now, updatedBy: by })] };
  });
}

export async function cancelExpenseClaim(db: Firestore, by: string, claimId: string) {
  assertId(claimId);
  return db.runTransaction(async (tx) => {
    const ref = claims(db).doc(claimId);
    const [claimDoc, costs, repayments] = await Promise.all([
      tx.get(ref), tx.get(transactions(db).where("expenseClaim.claimId", "==", claimId)),
      tx.get(transactions(db).where("expenseReimbursement.claimId", "==", claimId)),
    ]);
    assert(claimDoc.exists, "대납 기록이 없습니다.", 404);
    assert(repayments.empty, "상환 연결이 있습니다. 은행 거래의 연결을 먼저 해제한 뒤 취소하세요.", 409);
    assert(costs.size <= MAX_EXPENSE_CLAIM_ROWS, "비용을 나눈 뒤 행이 많아졌습니다. 원장에서 합치거나 정리한 뒤 취소하세요.");
    const claim = asClaim(claimDoc.id, claimDoc.data()!);
    const lockRefs = [...new Map(costs.docs.map((doc) => {
      const source = (doc.data() as FinTransaction).expenseClaim;
      const lock = scopeLock(db, claim.payerKey, source?.paymentLabel ?? claim.paymentLabel);
      return [lock.path, lock];
    })).values()].sort((a, b) => a.path.localeCompare(b.path));
    if (lockRefs.length) await tx.getAll(...lockRefs);
    const now = Date.now();
    costs.docs.forEach((doc) => {
      tx.set(db.collection(NEANDER_COL.finTrash).doc(doc.id), { doc: doc.data(), deletedAt: now, deletedBy: by });
      tx.delete(doc.ref);
      log(tx, db, by, now, doc.id, "delete");
    });
    tx.set(db.collection(NEANDER_COL.finTrash).doc(`expense-claim:${claimId}`), { doc: claimDoc.data(), collection: NEANDER_COL.finExpenseClaims, deletedAt: now, deletedBy: by });
    tx.delete(ref);
    return { ok: true, removed: costs.size, removedIds: costs.docs.map((doc) => doc.id), transactions: [] };
  });
}
