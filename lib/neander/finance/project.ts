// ============================================================
//  프로젝트 손익 — 행사·납품 건별로 계약금액과 원가를 맞춰 본다
// ------------------------------------------------------------
//  출발점은 「JIMFF 행사 물품 체크리스트」 엑셀이다. 행사를 준비하며
//  분류·품목·수량·단가·발주처·준비수량을 적어 내려가고, 금액과 합계는
//  수식이 굴린다. 그 시트를 ERP 로 옮기되 두 가지를 더한다.
//
//    1) 계약금액을 같은 화면에 두고 이익을 바로 보여준다. 엑셀에서는
//       합계만 있고 "얼마 남는지"는 머릿속으로 계산했다.
//    2) 줄마다 **실제금액** 칸을 둔다. 견적(수량×단가)과 실제 지출은
//       다르기 마련이라, 예상 이익과 실질 이익을 따로 굴린다.
//
//  식대·인건비·숙박·운송도 같은 줄 구조(수량 × 단가)로 넣는다. 인건비는
//  단위를 「인일」로, 식대는 「인」으로 두면 된다. 분류를 따로 나누지 않고
//  같은 표에 두는 이유는, 준비하는 사람이 한 장에서 보던 습관 그대로
//  쓰게 하려는 것이다.
//
//  원장(통합거래장)의 `projectCode` 와 코드로 이어진다. 원장에 같은
//  코드가 찍힌 거래의 합계를 **참고값**으로 옆에 보여줄 뿐, 두 숫자를
//  자동으로 합치지 않는다 — 카드 대금은 나중에 찍히고 현금 지출은 원장에
//  없을 수 있어 어느 쪽이 정답인지 사람이 봐야 한다.
//
//  문서 1개 = 프로젝트 1개. 줄(lines)은 문서 안에 배열로 둔다. 체크리스트는
//  길어야 100줄 안팎이고 언제나 통째로 보고 통째로 고치므로, 줄마다
//  문서를 만들면 저장이 잘게 쪼개져 반쯤 바뀐 상태가 남을 수 있다.
// ============================================================

import type { FinTransaction } from "./types";
import { expenseAmount, incomeAmount, refundAmount } from "./types";
import { todayStrKST } from "../format";

export const PROJECT_STATUSES = ["planning", "active", "done", "cancelled"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  planning: "준비 중",
  active: "진행 중",
  done: "완료",
  cancelled: "취소",
};

export const PROJECT_STATUS_COLOR: Record<ProjectStatus, string> = {
  planning: "#f59e0b",
  active: "#2a78d6",
  done: "#16a34a",
  cancelled: "#a1a1aa",
};

/**
 * 분류 추천 목록. 자유 입력이라 목록에 없는 분류도 쓸 수 있다 —
 * 엑셀에서도 「키오스크(AI포토부스)」「조향 오르간」처럼 행사마다 달랐다.
 * 식대·인건비처럼 **행사마다 반복되는 것**만 미리 둔다.
 */
export const LINE_CATEGORY_SUGGESTIONS = [
  "물품",
  "인쇄물",
  "식대",
  "인건비",
  "교통·운송",
  "숙박",
  "외주",
  "대관·장소",
  "기타",
] as const;

export const UNIT_SUGGESTIONS = ["개", "대", "장", "세트", "묶음", "롤", "식", "인", "인일", "박", "회", "L", "ml"] as const;

// ---- 부가세 --------------------------------------------------
//
//  계약서에 적힌 금액이 부가세를 포함한 값인지 아닌지에 따라 회사에 남는
//  돈이 10% 달라진다. 「3,520,000 (VAT 별도)」 와 「3,520,000 (VAT 포함)」
//  은 공급가액이 각각 3,520,000 과 3,200,000 이다.
//
//  이익은 **공급가액** 으로 계산한다. 받은 부가세는 회사 수익이 아니라
//  나중에 국가에 낼 돈이라, 이익에 넣으면 남는 돈을 10% 부풀려 보게 된다.

export const VAT_MODES = ["excluded", "included", "exempt"] as const;
export type VatMode = (typeof VAT_MODES)[number];

export const VAT_LABEL: Record<VatMode, string> = {
  excluded: "부가세 별도",
  included: "부가세 포함",
  exempt: "면세",
};

export const VAT_HINT: Record<VatMode, string> = {
  excluded: "적은 금액이 공급가액. 부가세 10% 를 더 받는다",
  included: "적은 금액이 청구 총액. 그 안에 부가세가 들어 있다",
  exempt: "부가세가 붙지 않는다 (면세 거래)",
};

export const VAT_RATE = 0.1;

export interface VatSplit {
  /** 공급가액 — 이익 계산의 기준 */
  supply: number;
  /** 부가세 */
  vat: number;
  /** 청구·입금 총액 = 공급가액 + 부가세 */
  total: number;
}

/** 적힌 금액을 부가세 기준에 따라 공급가액·부가세·총액으로 가른다 */
export function splitVat(amount: number, mode: VatMode = "excluded"): VatSplit {
  const a = Math.round(Number(amount) || 0);
  if (mode === "exempt") return { supply: a, vat: 0, total: a };
  if (mode === "included") {
    const supply = Math.round(a / (1 + VAT_RATE));
    return { supply, vat: a - supply, total: a };
  }
  const vat = Math.round(a * VAT_RATE);
  return { supply: a, vat, total: a + vat };
}

/** 체크리스트 한 줄. 견적은 수량×단가, 실제는 따로 적는다. */
export interface FinProjectLine {
  id: string;
  /** 분류 — 물품 · 식대 · 인건비 · … (자유 입력) */
  category: string;
  /** 품목 · 항목명 */
  item: string;
  qty: number;
  unit?: string;
  /** 단가. 비우면 견적 0 — 이미 갖고 있는 물품 등 */
  unitPrice?: number;
  /** 발주처 · 구매처 */
  vendor?: string;
  /** 보관 위치 · 담당 */
  location?: string;
  /** 준비된 수량 */
  preparedQty?: number;
  /** 준비 완료 체크 */
  done?: boolean;
  note?: string;
  /** 실제 지출액. 비우면 견적금액으로 본다 */
  actual?: number;
  /** 사용자 열의 값 (열 id → 글자). 값이 없는 열은 키 자체가 없다 */
  extra?: Record<string, string>;
}

/**
 * 사용자가 직접 만든 열.
 *
 * 행사마다 챙겨야 하는 것이 달라서 고정 열로는 모자란다 — 규격·담당·
 * 입고예정일 같은 칸이 그때그때 필요하다. 값은 줄의 `extra` 에 들어간다.
 *
 * `after` 는 이 열이 **어느 열 바로 오른쪽**에 붙는지다. 전체 열 순서를
 * 통째로 저장하지 않는 이유는, 나중에 고정 열이 하나 늘면 저장된 순서에
 * 없는 열이 사라져 버리기 때문이다. 앵커만 두면 고정 열이 늘어도 제자리에
 * 나타난다.
 */
export interface FinProjectColumn {
  id: string;
  label: string;
  /** 이 열의 왼쪽 열 id (고정 열 키 또는 다른 사용자 열의 `x:<id>`) */
  after?: string;
}

/** 체크리스트 고정 열 — 순서 그대로가 화면 순서다 */
export const CHECKLIST_FIXED_KEYS = [
  "done",
  "category",
  "item",
  "qty",
  "unit",
  "unitPrice",
  "estimate",
  "actual",
  "vendor",
  "location",
  "preparedQty",
  "note",
] as const;
export type ChecklistFixedKey = (typeof CHECKLIST_FIXED_KEYS)[number];

/** 사용자 열의 셀 키 — 줄의 extra 와 시트 열 id 가 같은 규칙을 쓴다 */
export const extraKey = (id: string) => `x:${id}`;

/**
 * 화면에 나갈 열 순서. 고정 열을 훑으며 그 뒤에 붙은 사용자 열을 끼워 넣고,
 * 앵커가 사라진 열은 맨 뒤에 붙여 **어떤 열도 조용히 사라지지 않게** 한다.
 */
/**
 * 「고정 열보다 왼쪽」 자리. `after` 에 이 값을 넣으면 맨 앞에 선다.
 *
 * `after` 가 없으면(undefined) 맨 뒤라는 뜻이라 "맨 앞"을 따로 표시할 방법이
 * 없었다. 기존 문서에는 없는 값이라 지금까지 저장된 열의 자리는 그대로다.
 */
export const COLUMN_START = "*start";

export function orderedColumnIds(columns: FinProjectColumn[] = []): string[] {
  const byAnchor = new Map<string, FinProjectColumn[]>();
  columns.forEach((c) => {
    const anchor = c.after ?? "";
    const list = byAnchor.get(anchor) ?? [];
    list.push(c);
    byAnchor.set(anchor, list);
  });

  const out: string[] = [];
  const seen = new Set<string>();
  const emit = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    out.push(id);
    (byAnchor.get(id) ?? []).forEach((c) => emit(extraKey(c.id)));
  };
  (byAnchor.get(COLUMN_START) ?? []).forEach((c) => emit(extraKey(c.id)));
  CHECKLIST_FIXED_KEYS.forEach(emit);
  columns.forEach((c) => emit(extraKey(c.id)));
  return out;
}

// ---- 입금 회차 ------------------------------------------------
//
//  계약 금액은 한 번에 들어오지 않는다. 선금을 받고 시작해 중도금·잔금으로
//  나눠 받는다. 그래서 "계약이 얼마인가"와 "지금까지 얼마나 들어왔는가"는
//  다른 질문이고, 그 차이가 **미수금**이다.
//
//  회차는 계약금액을 **쪼갠 것**이지 그 위에 더하는 돈이 아니다. 그래서
//  수입 합계에 더하지 않는다 — 더하면 계약금액이 두 번 잡힌다. 회차 합계가
//  계약금액과 어긋나면 화면이 그 차이를 드러낸다.
//
//  회차의 부가세 기준은 계약과 같다. 선금만 부가세 별도인 계약은 없다.

export const INSTALLMENT_KINDS = ["선금", "중도금", "잔금"] as const;
export type InstallmentKind = (typeof INSTALLMENT_KINDS)[number];

export interface FinProjectInstallment {
  id: string;
  kind: InstallmentKind;
  /** 이 회차 금액. 계약금액과 같은 부가세 기준으로 적는다 */
  amount: number;
  /** 받기로 한 날 `YYYY-MM-DD` */
  dueDate?: string;
  /** 실제로 들어온 날. 적혀 있으면 입금 완료로 본다 */
  paidDate?: string;
  note?: string;
}

/** 회차 하나의 상태 */
export type InstallmentStatus = "paid" | "overdue" | "planned";

export function installmentStatus(
  i: Pick<FinProjectInstallment, "dueDate" | "paidDate">,
  today = todayStrKST(),
): InstallmentStatus {
  if (i.paidDate) return "paid";
  // 예정일이 없으면 연체를 말할 수 없다 — 아직 날짜를 안 정한 회차다
  if (i.dueDate && i.dueDate < today) return "overdue";
  return "planned";
}

export const INSTALLMENT_STATUS_LABEL: Record<InstallmentStatus, string> = {
  paid: "입금",
  overdue: "연체",
  planned: "예정",
};

export const INSTALLMENT_STATUS_COLOR: Record<InstallmentStatus, string> = {
  paid: "#16a34a",
  overdue: "#e11d48",
  planned: "#71717a",
};

/** 계약금액 외의 수입 — 추가 정산·현장 판매·지원금 등 */
export interface FinProjectRevenue {
  id: string;
  label: string;
  amount: number;
  /** 이 줄의 부가세 기준. 비우면 프로젝트 기본값을 따른다 */
  vatMode?: VatMode;
  /** 실제로 들어온 날 `YYYY-MM-DD` */
  receivedDate?: string;
  /** 입금 확인 (날짜를 모를 때). 날짜가 있으면 그쪽이 우선이다 */
  received?: boolean;
  note?: string;
}

/** 이 수입이 들어왔는가 — 날짜가 있거나 체크돼 있으면 */
export const isReceived = (r: Pick<FinProjectRevenue, "received" | "receivedDate">) =>
  Boolean(r.receivedDate) || r.received === true;

export interface FinProjectDoc {
  id: string;
  /** 원장의 projectCode 와 맞춘다 — 대소문자 무시 */
  code: string;
  name: string;
  /** 발주처 · 주최 */
  client?: string;
  status: ProjectStatus;
  /** `YYYY-MM-DD` */
  startDate?: string;
  endDate?: string;
  /** 사업소분류 (와우·SMOAT·조향 …) — 사업부 손익과 이어 볼 때 */
  bizMinor?: string;
  /** 계약 금액. 이 값이 공급가액인지 총액인지는 vatMode 가 정한다 */
  contractAmount: number;
  /** 계약금액의 부가세 기준. 비우면 「부가세 별도」 */
  vatMode?: VatMode;
  /** 계약금액을 나눠 받는 일정 (선금·중도금·잔금) */
  installments?: FinProjectInstallment[];
  revenues: FinProjectRevenue[];
  /** 사용자가 만든 열 */
  columns?: FinProjectColumn[];
  lines: FinProjectLine[];
  note?: string;
  createdAt: number;
  createdBy?: string;
  updatedAt?: number;
  updatedBy?: string;
}

export type FinProjectInput = Omit<FinProjectDoc, "id" | "createdAt" | "createdBy" | "updatedAt" | "updatedBy">;

// ---- 새 줄 ---------------------------------------------------

/** 짧은 무작위 id — 문서 안 배열 요소라 전역 유일까지는 필요 없다 */
export const shortId = () => Math.random().toString(36).slice(2, 10);

export function newLine(category = ""): FinProjectLine {
  return { id: shortId(), category, item: "", qty: 1 };
}

export function newRevenue(): FinProjectRevenue {
  return { id: shortId(), label: "", amount: 0 };
}

export function newInstallment(kind: InstallmentKind = "선금"): FinProjectInstallment {
  return { id: shortId(), kind, amount: 0 };
}

export function emptyProject(): FinProjectInput {
  return {
    code: "",
    name: "",
    status: "planning",
    contractAmount: 0,
    vatMode: "excluded",
    revenues: [],
    lines: [],
  };
}

// ---- 계산 ----------------------------------------------------

/** 견적금액 = 수량 × 단가 (원 단위 반올림). 단가가 비면 0. */
export function lineEstimate(l: Pick<FinProjectLine, "qty" | "unitPrice">): number {
  const q = Number(l.qty) || 0;
  const p = Number(l.unitPrice);
  if (!Number.isFinite(p)) return 0;
  return Math.round(q * p);
}

/** 실제금액. 안 적었으면 견적으로 본다 — 빈 칸을 0 으로 세면 이익이 부풀려진다 */
export function lineActual(l: Pick<FinProjectLine, "qty" | "unitPrice" | "actual">): number {
  const a = l.actual;
  return a === undefined || a === null || !Number.isFinite(Number(a))
    ? lineEstimate(l)
    : Math.round(Number(a));
}

export const hasActual = (l: Pick<FinProjectLine, "actual">) =>
  l.actual !== undefined && l.actual !== null && Number.isFinite(Number(l.actual));

export interface CategoryGroup {
  category: string;
  lines: FinProjectLine[];
  estimate: number;
  actual: number;
  /** 준비 완료 줄 수 */
  doneCount: number;
}

/**
 * 분류별로 묶는다. 순서는 **처음 나온 순서** — 정렬하면 사용자가 적은
 * 순서(보통 현장 동선)가 깨진다. 분류가 빈 줄은 「(분류 없음)」 으로 모은다.
 */
export function groupLines(lines: FinProjectLine[]): CategoryGroup[] {
  const map = new Map<string, CategoryGroup>();
  lines.forEach((l) => {
    const key = (l.category ?? "").trim() || UNCATEGORIZED;
    let g = map.get(key);
    if (!g) {
      g = { category: key, lines: [], estimate: 0, actual: 0, doneCount: 0 };
      map.set(key, g);
    }
    g.lines.push(l);
    g.estimate += lineEstimate(l);
    g.actual += lineActual(l);
    if (l.done) g.doneCount += 1;
  });
  return [...map.values()];
}

export const UNCATEGORIZED = "(분류 없음)";

/** 원장에서 이 프로젝트 코드가 찍힌 거래 */
export function ledgerRowsOf(transactions: FinTransaction[], code: string): FinTransaction[] {
  const c = code.trim().toLowerCase();
  if (!c) return [];
  return transactions.filter((t) => (t.projectCode ?? "").trim().toLowerCase() === c);
}

export interface ProjectSummary {
  /** 계약금액 — 사람이 적은 값 그대로 (부가세 기준에 따라 뜻이 다르다) */
  contract: number;
  extraRevenue: number;
  /**
   * 수입 = **공급가액** 합계 (계약 + 추가). 이익 계산의 기준이다.
   * 받은 부가세는 국가에 낼 돈이라 회사 수익이 아니다.
   */
  revenue: number;
  /** 부가세 합계 — 받아서 납부할 돈 */
  revenueVat: number;
  /** 청구·입금 총액 = 공급가액 + 부가세 */
  revenueTotal: number;

  // ---- 입금 · 미수금 (모두 청구 총액 기준, 부가세 포함) ----
  /** 실제로 들어온 돈 (입금일이 적힌 회차 + 입금 확인된 추가 수입) */
  received: number;
  /** 미수금 = 청구 총액 − 입금액 */
  unpaid: number;
  /** 예정일이 지났는데 아직 안 들어온 회차의 합 */
  overdue: number;
  overdueCount: number;
  /** 회차에 적힌 금액의 청구 총액 합계 */
  scheduled: number;
  /**
   * 계약 총액 − 회차 합계. 0 이 아니면 일정이 계약을 다 담지 못한 것이다
   * (아직 안 나눈 잔여이거나, 잘못 적었거나).
   */
  scheduleGap: number;
  installmentCount: number;
  /** 견적 원가 = Σ 수량×단가 */
  estimate: number;
  /** 실제 원가 = Σ (실제금액 ?? 견적금액) */
  actual: number;
  /** 실제금액을 적은 줄 수 / 전체 줄 수 */
  actualFilled: number;
  lineCount: number;
  doneCount: number;
  profitEstimate: number;
  profitActual: number;
  /** 이익률 (수입 0 이면 null) */
  marginEstimate: number | null;
  marginActual: number | null;
  /** 원장 참고값 */
  ledger: { count: number; income: number; expense: number; refund: number };
}

export function projectSummary(
  p: Pick<FinProjectDoc, "contractAmount" | "revenues" | "lines" | "code"> & {
    vatMode?: VatMode;
    installments?: FinProjectInstallment[];
  },
  transactions: FinTransaction[] = [],
  /** 연체 판정 기준일. 넘기지 않으면 한국 기준 오늘 */
  today = todayStrKST(),
): ProjectSummary {
  const contract = Math.round(Number(p.contractAmount) || 0);
  const extraRevenue = (p.revenues ?? []).reduce((s, r) => s + (Math.round(Number(r.amount)) || 0), 0);

  // 계약금액과 추가 수입 줄을 각각 부가세 기준대로 가른 뒤 합친다.
  // 줄마다 기준이 다를 수 있다 — 계약은 별도인데 현장 판매는 포함인 식이다.
  const base = p.vatMode ?? "excluded";
  const contractSplit = splitVat(contract, base);
  const splits = [contractSplit, ...(p.revenues ?? []).map((r) => splitVat(r.amount, r.vatMode ?? base))];
  const revenue = splits.reduce((n, v) => n + v.supply, 0);
  const revenueVat = splits.reduce((n, v) => n + v.vat, 0);
  const revenueTotal = splits.reduce((n, v) => n + v.total, 0);

  // ---- 입금 · 미수금 ----
  //
  //  회차는 계약금액을 쪼갠 것이라 수입 합계에는 더하지 않는다. 여기서는
  //  "그 중 얼마가 들어왔나"만 센다. 추가 수입은 그 자체가 수입이면서
  //  입금 여부도 갖는다.
  const inst = p.installments ?? [];
  let received = 0;
  let scheduled = 0;
  let overdue = 0;
  let overdueCount = 0;
  inst.forEach((i) => {
    const total = splitVat(i.amount, base).total;
    scheduled += total;
    const st = installmentStatus(i, today);
    if (st === "paid") received += total;
    else if (st === "overdue") {
      overdue += total;
      overdueCount += 1;
    }
  });
  (p.revenues ?? []).forEach((r) => {
    if (isReceived(r)) received += splitVat(r.amount, r.vatMode ?? base).total;
  });
  const lines = p.lines ?? [];
  const estimate = lines.reduce((s, l) => s + lineEstimate(l), 0);
  const actual = lines.reduce((s, l) => s + lineActual(l), 0);
  const actualFilled = lines.filter(hasActual).length;
  const doneCount = lines.filter((l) => l.done).length;

  const rows = ledgerRowsOf(transactions, p.code);
  const ledger = rows.reduce(
    (acc, t) => {
      acc.count += 1;
      acc.income += incomeAmount(t);
      acc.expense += expenseAmount(t);
      acc.refund += refundAmount(t);
      return acc;
    },
    { count: 0, income: 0, expense: 0, refund: 0 },
  );

  const margin = (profit: number) => (revenue > 0 ? profit / revenue : null);
  return {
    contract,
    extraRevenue,
    revenue,
    revenueVat,
    revenueTotal,
    received,
    // 들어온 돈이 청구액을 넘으면(초과 입금) 미수금은 0 으로 본다 —
    // 음수 미수금은 읽는 사람을 헷갈리게 한다. 초과분은 따로 드러낼 일이다.
    unpaid: Math.max(0, revenueTotal - received),
    overdue,
    overdueCount,
    scheduled,
    scheduleGap: contractSplit.total - scheduled,
    installmentCount: inst.length,
    estimate,
    actual,
    actualFilled,
    lineCount: lines.length,
    doneCount,
    profitEstimate: revenue - estimate,
    profitActual: revenue - actual,
    marginEstimate: margin(revenue - estimate),
    marginActual: margin(revenue - actual),
    ledger,
  };
}

/** 이익률 표시. 수입이 없으면 — */
export function formatMargin(m: number | null): string {
  if (m === null) return "—";
  return `${(m * 100).toFixed(1)}%`;
}

// ---- 정규화 (서버 저장 직전) -----------------------------------

const str = (v: unknown): string | undefined => {
  const s = String(v ?? "").trim();
  return s ? s : undefined;
};
const num = (v: unknown): number | undefined => {
  if (v === "" || v === null || v === undefined) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};
/** undefined 키를 빼고 돌려준다 — Firestore 는 undefined 를 거부한다 */
const compact = <T extends Record<string, unknown>>(o: T): T => {
  const out: Record<string, unknown> = {};
  Object.keys(o).forEach((k) => {
    if (o[k] !== undefined) out[k] = o[k];
  });
  return out as T;
};

export function sanitizeLine(raw: Partial<FinProjectLine>): FinProjectLine {
  return compact({
    id: str(raw.id) ?? shortId(),
    category: String(raw.category ?? "").trim(),
    item: String(raw.item ?? "").trim(),
    qty: num(raw.qty) ?? 0,
    unit: str(raw.unit),
    unitPrice: num(raw.unitPrice),
    vendor: str(raw.vendor),
    location: str(raw.location),
    preparedQty: num(raw.preparedQty),
    done: raw.done ? true : undefined,
    note: str(raw.note),
    actual: num(raw.actual),
    extra: sanitizeExtra(raw.extra),
  }) as FinProjectLine;
}

const vatMode = (v: unknown): VatMode | undefined =>
  (VAT_MODES as readonly string[]).includes(String(v)) ? (v as VatMode) : undefined;

/** 값이 빈 칸은 키를 남기지 않는다 — 지운 칸이 문서에 쌓이지 않게 */
function sanitizeExtra(raw: unknown): Record<string, string> | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const out: Record<string, string> = {};
  Object.entries(raw as Record<string, unknown>).forEach(([k, v]) => {
    const s = String(v ?? "").trim();
    if (s) out[k] = s;
  });
  return Object.keys(out).length > 0 ? out : undefined;
}

/** `YYYY-MM-DD` 만 통과시킨다. 형식이 틀리면 없는 것으로 (조용히 버린다) */
const dateStr = (v: unknown): string | undefined => {
  const s = str(v);
  return s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined;
};

export function sanitizeRevenue(raw: Partial<FinProjectRevenue>): FinProjectRevenue {
  return compact({
    id: str(raw.id) ?? shortId(),
    label: String(raw.label ?? "").trim(),
    amount: Math.round(num(raw.amount) ?? 0),
    vatMode: vatMode(raw.vatMode),
    receivedDate: dateStr(raw.receivedDate),
    received: raw.received ? true : undefined,
    note: str(raw.note),
  }) as FinProjectRevenue;
}

export function sanitizeInstallment(raw: Partial<FinProjectInstallment>): FinProjectInstallment {
  const kind = (INSTALLMENT_KINDS as readonly string[]).includes(String(raw.kind))
    ? (raw.kind as InstallmentKind)
    : "선금";
  return compact({
    id: str(raw.id) ?? shortId(),
    kind,
    amount: Math.round(num(raw.amount) ?? 0),
    dueDate: dateStr(raw.dueDate),
    paidDate: dateStr(raw.paidDate),
    note: str(raw.note),
  }) as FinProjectInstallment;
}

/**
 * 저장 직전 정리. 빈 줄(품목도 분류도 금액도 없는 줄)은 버린다 —
 * 「줄 추가」를 눌러놓고 안 채운 줄이 저장돼 남는 걸 막는다.
 * 유효성 문제는 문자열로 돌려주고, 없으면 정리된 값을 준다.
 */
export function sanitizeProject(
  raw: Partial<FinProjectInput>,
): { ok: true; value: FinProjectInput } | { ok: false; error: string } {
  const code = String(raw.code ?? "").trim();
  const name = String(raw.name ?? "").trim();
  if (!name) return { ok: false, error: "프로젝트 이름이 필요합니다." };
  if (!code) return { ok: false, error: "프로젝트 코드가 필요합니다. 원장의 프로젝트코드와 같은 값을 씁니다." };
  if (/[\/\s]/.test(code)) return { ok: false, error: "프로젝트 코드에는 공백과 / 를 쓸 수 없습니다." };
  const status = (PROJECT_STATUSES as readonly string[]).includes(String(raw.status))
    ? (raw.status as ProjectStatus)
    : "planning";
  const date = (v: unknown) => {
    const s = str(v);
    if (s === undefined) return undefined;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
    return s;
  };
  const startDate = date(raw.startDate);
  const endDate = date(raw.endDate);
  if (startDate === null || endDate === null) {
    return { ok: false, error: "날짜는 YYYY-MM-DD 형식이어야 합니다." };
  }
  if (startDate && endDate && startDate > endDate) {
    return { ok: false, error: "종료일이 시작일보다 앞설 수 없습니다." };
  }

  // 빈 줄만 버린다. 「줄 추가」를 눌러놓고 안 채운 줄이 저장되는 것은 막되,
  // 사람이 무엇이든 적어 넣은 줄은 남긴다 — 발주처만 적어 둔 줄, 비고만
  // 달아 둔 줄도 준비 과정에서는 뜻이 있다. 조용히 사라지는 게 더 나쁘다.
  const lines = (Array.isArray(raw.lines) ? raw.lines : [])
    .map(sanitizeLine)
    .filter(
      (l) =>
        l.item ||
        l.category ||
        l.vendor ||
        l.location ||
        l.note ||
        l.unit ||
        l.done ||
        l.preparedQty !== undefined ||
        lineEstimate(l) !== 0 ||
        hasActual(l),
    );
  const revenues = (Array.isArray(raw.revenues) ? raw.revenues : [])
    .map(sanitizeRevenue)
    .filter((r) => r.label || r.amount !== 0);

  // 금액도 날짜도 없는 회차는 「+ 회차 추가」를 눌러만 둔 줄이다
  const installments = (Array.isArray(raw.installments) ? raw.installments : [])
    .map(sanitizeInstallment)
    .filter((i) => i.amount !== 0 || i.dueDate || i.paidDate || i.note);

  // 사용자 열 — id 중복을 없애고 이름이 빈 열은 기본 이름을 준다
  const seenCols = new Set<string>();
  const columns = (Array.isArray(raw.columns) ? raw.columns : [])
    .map((c, i) => ({
      id: str(c?.id) ?? shortId(),
      label: String(c?.label ?? "").trim() || `새 열 ${i + 1}`,
      after: str(c?.after),
    }))
    .filter((c) => (seenCols.has(c.id) ? false : (seenCols.add(c.id), true)))
    .map((c) => compact(c) as FinProjectColumn);

  // 지워진 열의 값이 줄에 남아 있으면 문서만 무거워진다
  const known = new Set(columns.map((c) => c.id));
  lines.forEach((l) => {
    if (!l.extra) return;
    const kept: Record<string, string> = {};
    Object.entries(l.extra).forEach(([k, v]) => {
      if (known.has(k)) kept[k] = v;
    });
    if (Object.keys(kept).length > 0) l.extra = kept;
    else delete l.extra;
  });

  return {
    ok: true,
    value: compact({
      code,
      name,
      client: str(raw.client),
      status,
      startDate,
      endDate,
      bizMinor: str(raw.bizMinor),
      contractAmount: Math.round(num(raw.contractAmount) ?? 0),
      vatMode: vatMode(raw.vatMode) ?? "excluded",
      installments: installments.length > 0 ? installments : undefined,
      revenues,
      columns: columns.length > 0 ? columns : undefined,
      lines,
      note: str(raw.note),
    }) as FinProjectInput,
  };
}

/** 목록 정렬 — 진행 중 → 준비 중 → 완료 → 취소, 같은 상태면 최근 수정순 */
const STATUS_ORDER: Record<ProjectStatus, number> = { active: 0, planning: 1, done: 2, cancelled: 3 };
export function sortProjects(list: FinProjectDoc[]): FinProjectDoc[] {
  return [...list].sort((a, b) => {
    const s = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    if (s !== 0) return s;
    return (b.updatedAt ?? b.createdAt ?? 0) - (a.updatedAt ?? a.createdAt ?? 0);
  });
}
