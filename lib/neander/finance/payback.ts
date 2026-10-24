// ============================================================
//  돌려줄 돈 — 받은 돈에서 부가세와 우리 몫을 떼고 거래처에 돌려주는 돈
// ------------------------------------------------------------
//  B2B 계약 중에는 세금계산서를 큰 금액으로 끊고, 받은 뒤 일부를 거래처에
//  돌려주는 건이 있다 (써큐 580만 · 워크온 880만 · 크래커스 310만 · KPOP 1,290만).
//  돌려줄 돈은 이렇게 센다 (2026-10-24 사용자 결정):
//
//    돌려줄 돈 = 받은 돈(부가세 포함) − 부가세 − 우리 몫
//              = 공급가액 − 우리 몫
//
//  사람이 적는 칸은 「우리 몫」 이다. 부가세는 세금계산서를 그대로 둔 채 우리가
//  내므로 거래처에 돌려줄 돈에서 뺀다. KPOP-2509 메모 「공급 1,800 − 우리 몫 510
//  = 1,290」 이 같은 셈이다.
//
//  돌려줄 돈은 두 곳에 있다.
//    · 프로젝트의 「매출 차감」 — 계약에 묶인 것. 정본은 프로젝트 문서다.
//      이익 계산(project.ts 의 projectSummary)이 이 줄을 읽으므로 여기 따로
//      적으면 같은 돈이 두 번 생긴다. 이 화면은 그 줄을 모아 보여 주고, 고칠
//      때는 프로젝트 문서의 그 줄을 고친다.
//    · 따로 적은 건 — 계약 없이 생긴 것. neander_fin_paybacks 에 둔다.
//  화면은 둘을 한 표(PaybackRow)로 합친다.
//
//  프로젝트 차감에는 예정일 칸이 없다(FinProjectDeduction 에 dueDate 가 없다).
//  그래서 프로젝트 행은 「남음」 · 「돌려줌」 만 있고 「늦음」 은 따로 적은 건에만 생긴다.
//
//  openPaybacks 는 아직 돌려주지 않은 돈을 날짜와 함께 내놓는다 — 현금 예측
//  (runway.ts)이 나갈 돈으로 이을 자리다. 지금은 아무 데서도 부르지 않는다.
// ============================================================

import {
  DUE_PARTS,
  approxDueDate,
  dueLabel,
  deductionSplit,
  isProjectEntity,
  projectSummary,
  splitVat,
  VAT_MODES,
  type DuePart,
  type FinProjectDeduction,
  type FinProjectDoc,
  type ProjectEntity,
  type VatMode,
  type VatSplit,
} from "./project";
import { netAmount, type FinTransaction } from "./types";
import { todayStrKST } from "../format";

// ---- 따로 적은 건 ---------------------------------------------

export interface FinPaybackDoc {
  id: string;
  /** 돌려받을 거래처 — 필수 */
  vendor: string;
  /** 무엇 — 「개발비 페이백」 */
  label?: string;
  /** 원장과 이을 때 쓰는 자유 글자 (프로젝트코드와 같은 값이면 원장에서 같이 보인다) */
  projectCode?: string;
  /** 돈을 받은 사업체 */
  entity?: ProjectEntity;
  /** 받은 돈 (원) — vatMode 가 이 금액의 뜻을 정한다 */
  received: number;
  /** 받은 돈의 부가세 기준. 기본은 「부가세 포함」 — 통장에 들어온 금액을 그대로 적는다 */
  vatMode: VatMode;
  /** 우리 몫 — 공급가액 중 회사에 남길 돈 */
  keep: number;
  /** 돌려줄 돈 — 계산값을 저장한다. 사람이 직접 고쳤으면 그 값 */
  amount: number;
  /** 돌려주기로 한 날. 대략이면 그 구간의 끝 날 (project.ts 의 DUE_PARTS) */
  dueDate?: string;
  dueApprox?: DuePart;
  /** 돌려준 날 — 적혀 있으면 돌려준 것이다 */
  paidDate?: string;
  /** 실제로 돌려준 돈 — 돌려줄 돈과 다를 때만 */
  paidAmount?: number;
  /** 「4223 계좌이체」 · 「현금」 */
  method?: string;
  /** 붙인 장부 거래 (나간 돈) */
  txIds?: string[];
  note?: string;
  createdAt: number;
  updatedAt?: number;
  updatedBy?: string;
}

export type FinPaybackInput = Omit<FinPaybackDoc, "id" | "createdAt" | "updatedAt" | "updatedBy">;

export function emptyPayback(): FinPaybackInput {
  return { vendor: "", received: 0, vatMode: "included", keep: 0, amount: 0 };
}

// ---- 계산 -----------------------------------------------------

export interface PaybackCalc extends VatSplit {
  /** 돌려줄 돈 = 공급가액 − 우리 몫. 음수면 우리 몫이 공급가액보다 크다 — 화면이 경고한다 */
  amount: number;
}

/** 받은 돈 · 부가세 기준 · 우리 몫 → 공급가액 · 부가세 · 돌려줄 돈 */
export function paybackCalc(received: number, vatMode: VatMode, keep: number): PaybackCalc {
  const split = splitVat(received, vatMode);
  return { ...split, amount: split.supply - Math.round(Number(keep) || 0) };
}

// ---- 저장 직전 정리 ---------------------------------------------

const str = (v: unknown): string | undefined => {
  const s = String(v ?? "").trim();
  return s ? s : undefined;
};
const num = (v: unknown): number | undefined => {
  if (v === "" || v === null || v === undefined) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};
const dateStr = (v: unknown): string | undefined => {
  const s = str(v);
  return s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined;
};
const compact = <T extends Record<string, unknown>>(o: T): T => {
  const out = { ...o };
  (Object.keys(out) as (keyof T)[]).forEach((k) => {
    if (out[k] === undefined) delete out[k];
  });
  return out;
};

export function sanitizePayback(
  raw: Partial<FinPaybackInput>,
): { ok: true; value: FinPaybackInput } | { ok: false; error: string } {
  const vendor = str(raw.vendor);
  if (!vendor) return { ok: false, error: "거래처가 필요합니다 — 누구에게 돌려줄 돈인지." };
  const vatMode = (VAT_MODES as readonly string[]).includes(String(raw.vatMode)) ? (raw.vatMode as VatMode) : "included";
  const received = Math.round(num(raw.received) ?? 0);
  const keep = Math.round(num(raw.keep) ?? 0);
  // 금액을 안 보냈으면 계산값 — 보냈으면 사람이 정한 값 그대로
  const amount = Math.round(num(raw.amount) ?? paybackCalc(received, vatMode, keep).amount);
  const due = dateStr(raw.dueDate);
  const approx = due && (DUE_PARTS as readonly string[]).includes(String(raw.dueApprox)) ? (raw.dueApprox as DuePart) : undefined;
  const paidAmount = num(raw.paidAmount);
  const txIds = Array.isArray(raw.txIds) ? [...new Set(raw.txIds.map((t) => String(t).trim()).filter(Boolean))] : [];
  return {
    ok: true,
    value: compact({
      vendor: vendor.slice(0, 80),
      label: str(raw.label)?.slice(0, 120),
      projectCode: str(raw.projectCode),
      entity: isProjectEntity(raw.entity) ? raw.entity : undefined,
      received,
      vatMode,
      keep,
      amount,
      // 대략이면 그 구간의 끝 날로 맞춘다 — 프로젝트 회차와 같은 규칙
      dueDate: due && approx ? approxDueDate(due.slice(0, 7), approx) : due,
      dueApprox: approx,
      paidDate: dateStr(raw.paidDate),
      paidAmount: paidAmount === undefined ? undefined : Math.round(paidAmount),
      method: str(raw.method)?.slice(0, 80),
      txIds: txIds.length > 0 ? txIds : undefined,
      note: str(raw.note),
    }) as FinPaybackInput,
  };
}

// ---- 상태 -----------------------------------------------------

/** open 남음 · late 예정일이 지났는데 안 돌려줌 · paid 돌려줌 */
export type PaybackStatus = "open" | "late" | "paid";

export const PAYBACK_STATUS_LABEL: Record<PaybackStatus, string> = {
  open: "남음",
  late: "늦음",
  paid: "돌려줌",
};

export function paybackStatus(p: { paidDate?: string; dueDate?: string }, today = todayStrKST()): PaybackStatus {
  if (p.paidDate) return "paid";
  if (p.dueDate && p.dueDate < today) return "late";
  return "open";
}

// ---- 화면 행 ---------------------------------------------------

export interface PaybackRow {
  /** 표 안의 열쇠 — 따로 적은 건은 문서 id, 프로젝트 차감은 `프로젝트id:차감id` */
  key: string;
  source: "standalone" | "project";
  vendor: string;
  label: string;
  /** 받은 돈 (부가세 포함) */
  received: number;
  vat: number;
  supply: number;
  /** 우리 몫 — 공급가액 중 회사에 남는 돈 */
  keep: number;
  /** 돌려줄 돈 */
  amount: number;
  /** 실제로 돌려준 돈 (돌려준 행만) */
  paid: number;
  dueDate?: string;
  dueText: string;
  paidDate?: string;
  status: PaybackStatus;
  entity?: string;
  note?: string;
  /** 프로젝트 행 */
  projectId?: string;
  projectName?: string;
  projectCode?: string;
  deductionId?: string;
  /** 「수정세금계산서 발행」 차감 — 돌려준 돈 안에 부가세가 들어 있다 */
  invoiceAdjusted?: boolean;
  /** 같은 프로젝트에 차감이 여럿 — 우리 몫은 그 합을 뺀 값이다 */
  sharedKeep?: boolean;
  /** 따로 적은 건의 원본 */
  doc?: FinPaybackDoc;
}

/**
 * 프로젝트 하나의 「차감 전」 숫자. projectSummary 는 차감을 뺀 값을 주므로
 * 되돌린다 — 차감 전 공급가액 = 수입(차감 후) + 차감이 공급가액에서 뺀 몫.
 */
export function projectGross(p: FinProjectDoc) {
  const s = projectSummary(p, []);
  return {
    /** 차감 전 청구 총액 — 세금계산서에 찍힌 금액 */
    total: s.grossTotal,
    /** 차감 전 공급가액 */
    supply: s.revenue + s.deductionSupply,
    /** 차감 전 부가세 */
    vat: s.revenueVat + s.deductionVat,
    /** 차감 후 공급가액 = 우리 몫 */
    keep: s.revenue,
  };
}

/** 프로젝트 차감 한 줄의 행 */
function projectRows(p: FinProjectDoc, today: string): PaybackRow[] {
  const ds = p.deductions ?? [];
  if (ds.length === 0) return [];
  const g = projectGross(p);
  return ds.map((d) => ({
    key: `${p.id}:${d.id}`,
    source: "project" as const,
    vendor: p.client ?? p.name,
    label: d.label || "매출 차감",
    received: g.total,
    vat: g.vat,
    supply: g.supply,
    keep: g.keep,
    amount: d.amount,
    paid: d.paidDate ? d.amount : 0,
    dueText: "",
    paidDate: d.paidDate,
    status: paybackStatus({ paidDate: d.paidDate }, today),
    entity: p.entities?.join(" · "),
    note: d.note,
    projectId: p.id,
    projectName: p.name,
    projectCode: p.code,
    deductionId: d.id,
    invoiceAdjusted: d.taxMode === "invoice",
    sharedKeep: ds.length > 1,
  }));
}

function standaloneRow(d: FinPaybackDoc, today: string): PaybackRow {
  const c = paybackCalc(d.received, d.vatMode, d.keep);
  return {
    key: d.id,
    source: "standalone",
    vendor: d.vendor,
    label: d.label ?? "",
    received: c.total,
    vat: c.vat,
    supply: c.supply,
    keep: d.keep,
    amount: d.amount,
    paid: d.paidDate ? (d.paidAmount ?? d.amount) : 0,
    dueDate: d.dueDate,
    dueText: dueLabel(d),
    paidDate: d.paidDate,
    status: paybackStatus(d, today),
    entity: d.entity,
    note: d.note,
    projectCode: d.projectCode,
    doc: d,
  };
}

/** 따로 적은 건 + 프로젝트 차감 → 한 표. 남은 것 → 예정일 → 거래처 순 */
export function paybackRows(
  paybacks: FinPaybackDoc[],
  projects: FinProjectDoc[],
  today = todayStrKST(),
): PaybackRow[] {
  const rows = [
    ...paybacks.map((d) => standaloneRow(d, today)),
    // 취소된 프로젝트의 차감은 돌려줄 일도 없다
    ...projects.filter((p) => p.status !== "cancelled").flatMap((p) => projectRows(p, today)),
  ];
  const rank: Record<PaybackStatus, number> = { late: 0, open: 1, paid: 2 };
  return rows.sort(
    (a, b) =>
      rank[a.status] - rank[b.status] ||
      (a.status === "paid"
        ? (b.paidDate ?? "").localeCompare(a.paidDate ?? "")
        : (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999")) ||
      a.vendor.localeCompare(b.vendor, "ko"),
  );
}

// ---- 합계 -----------------------------------------------------

export interface PaybackTotals {
  /** 아직 돌려주지 않은 돈 (남음 + 늦음) */
  open: number;
  openCount: number;
  late: number;
  lateCount: number;
  /** 이번 달 · 다음 달 예정 (안 돌려준 것만) */
  thisMonth: number;
  nextMonth: number;
  /** 예정일 없는 남은 돈 */
  undated: number;
  /** 올해 돌려준 돈 */
  paidThisYear: number;
  paidThisYearCount: number;
}

export function paybackTotals(rows: PaybackRow[], today = todayStrKST()): PaybackTotals {
  const m = today.slice(0, 7);
  const [y, mm] = m.split("-").map(Number);
  const next = `${mm === 12 ? y + 1 : y}-${String(mm === 12 ? 1 : mm + 1).padStart(2, "0")}`;
  const t: PaybackTotals = {
    open: 0,
    openCount: 0,
    late: 0,
    lateCount: 0,
    thisMonth: 0,
    nextMonth: 0,
    undated: 0,
    paidThisYear: 0,
    paidThisYearCount: 0,
  };
  rows.forEach((r) => {
    if (r.status === "paid") {
      if ((r.paidDate ?? "").slice(0, 4) === today.slice(0, 4)) {
        t.paidThisYear += r.paid;
        t.paidThisYearCount += 1;
      }
      return;
    }
    t.open += r.amount;
    t.openCount += 1;
    if (r.status === "late") {
      t.late += r.amount;
      t.lateCount += 1;
    }
    const due = r.dueDate?.slice(0, 7);
    if (!due) t.undated += r.amount;
    else if (due === m) t.thisMonth += r.amount;
    else if (due === next) t.nextMonth += r.amount;
  });
  return t;
}

/**
 * 아직 돌려주지 않은 돈 — 현금 예측이 「나갈 돈」 으로 넣을 자리 (runway.ts 에 이을 것).
 * 예정일이 없으면 date 가 비어 있다 — 받는 쪽이 따로 보인다.
 */
export function openPaybacks(rows: PaybackRow[]): { date?: string; amount: number; label: string }[] {
  return rows
    .filter((r) => r.status !== "paid" && r.amount > 0)
    .map((r) => ({ date: r.dueDate, amount: r.amount, label: [r.vendor, r.label].filter(Boolean).join(" · ") }));
}

// ---- 프로젝트 차감 고치기 -----------------------------------------

/**
 * 프로젝트 차감 한 줄의 금액 — 「우리 몫」 이 keep 이 되도록.
 *
 * 차감 후 공급가액 = 차감 전 공급가액 − Σ 차감이 공급가액에서 뺀 몫 이므로,
 * 이 줄이 빼야 할 공급가액 = 차감 전 공급가액 − keep − 다른 차감의 몫.
 * 「세금계산서 그대로」 줄은 그 금액 그대로, 「수정세금계산서」 줄은 부가세를
 * 더해 돌려준다(돌려준 돈 안에 부가세가 들어 있다).
 */
export function deductionAmountForKeep(
  p: FinProjectDoc,
  keep: number,
  deductionId: string | null,
  taxMode: FinProjectDeduction["taxMode"] = "none",
): number {
  const g = projectGross(p);
  const base = p.vatMode ?? "excluded";
  const others = (p.deductions ?? [])
    .filter((d) => d.id !== deductionId)
    .reduce((s, d) => s + deductionSplit(d, base).supply, 0);
  const cut = g.supply - Math.round(Number(keep) || 0) - others;
  if (taxMode === "none" || base === "exempt") return cut;
  return Math.round(cut * 1.1);
}

// ---- 장부 거래 후보 ----------------------------------------------

/** 거래처 이름 비교용 — 「(주)」 · 「주식회사」 · 띄어쓰기를 걷어낸다 */
export const vendorKey = (s?: string) =>
  (s ?? "")
    .replace(/\(주\)|㈜|주식회사|\(유\)|유한회사/g, "")
    .replace(/\s+/g, "")
    .toLowerCase();

/** 회사 통장에서 나간 돈인가 — 지출 · 자금거래 · 음수로 적은 수입(매출을 되돌린 것) */
export function isOutgoing(t: Pick<FinTransaction, "txType" | "gross" | "adjust">): boolean {
  const n = netAmount(t);
  if (t.txType === "지출" || t.txType === "자금거래") return n !== 0;
  if (t.txType === "수입") return n < 0;
  return false;
}

export interface TxCandidate {
  tx: FinTransaction;
  /** 금액이 돌려줄 돈과 같다 */
  sameAmount: boolean;
  /** 거래처 이름이 겹친다 */
  sameVendor: boolean;
}

/**
 * 돌려준 거래 후보 — 금액이 같거나 거래처 이름이 겹치는 나간 돈.
 * 이미 붙인 거래는 맨 앞에. 많아야 limit 건.
 */
export function txCandidates(
  p: { vendor: string; amount: number; paidAmount?: number; txIds?: string[]; dueDate?: string },
  transactions: FinTransaction[],
  limit = 20,
): TxCandidate[] {
  const v = vendorKey(p.vendor);
  const amounts = new Set([Math.abs(Math.round(p.amount)), Math.abs(Math.round(p.paidAmount ?? p.amount))]);
  const linked = new Set(p.txIds ?? []);
  const out: (TxCandidate & { score: number })[] = [];
  transactions.forEach((t) => {
    const isLinked = linked.has(t.id);
    if (!isLinked && !isOutgoing(t)) return;
    const n = Math.abs(netAmount(t));
    const tv = vendorKey(t.vendor);
    const sameAmount = amounts.has(n) && n > 0;
    const sameVendor = v.length >= 2 && tv.length >= 2 && (tv.includes(v) || v.includes(tv));
    if (!isLinked && !sameAmount && !sameVendor) return;
    // 붙인 것 > 금액·거래처 둘 다 > 금액 > 거래처
    const score = (isLinked ? 100 : 0) + (sameAmount ? 10 : 0) + (sameVendor ? 5 : 0);
    out.push({ tx: t, sameAmount, sameVendor, score });
  });
  return out
    .sort((a, b) => b.score - a.score || b.tx.date.localeCompare(a.tx.date))
    .slice(0, limit)
    .map((c) => ({ tx: c.tx, sameAmount: c.sameAmount, sameVendor: c.sameVendor }));
}
