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

// ---- 사내 인력 ---------------------------------------------------
//
//  외부 인력(일용직 · 3.3% 프리랜서)은 실제로 돈이 나가므로 지출 줄에 적는다.
//  정직원과 대표가 준비 · 설치 · 운영 · 철수에 쓴 날은 어디에도 잡히지 않아,
//  그대로 두면 이익이 크게 부풀어 보인다(평택 미리내컴 이익률 76%).
//  그래서 「누가 · 며칠 × 하루 단가」 를 따로 적는다. 실제 지출이 아니라 추정이라
//  「실제 원가」 에 더하지 않고, 이익을 두 줄로 본다 — 현장 이익(외부 원가만)과
//  인력 반영 이익. (업계 도구 Deltek Maconomy 의 GM1 · GM2 와 같은 생각)
//
//  하루 단가는 **그때 값으로 이 프로젝트에 남긴다.** 급여가 바뀌어도 끝난
//  프로젝트의 숫자가 따라 바뀌면 안 된다.

export interface FinProjectLabor {
  id: string;
  /** 사람 이름 (원장 급여 거래처 이름과 같게 쓰면 단가 추천이 붙는다) */
  name: string;
  /** 쓴 날 — 반나절은 0.5 */
  days: number;
  /** 하루 단가 (원) — 급여 + 4대보험 회사 부담을 하루로 나눈 값 */
  dayRate: number;
  note?: string;
}

export const laborCost = (l: Pick<FinProjectLabor, "days" | "dayRate">) =>
  Math.round((Number(l.days) || 0) * (Number(l.dayRate) || 0));

export const laborTotal = (list: FinProjectLabor[] | undefined) =>
  (list ?? []).reduce((s, l) => s + laborCost(l), 0);

/** 남은 일 한 줄 */
export interface FinProjectTodo {
  id: string;
  text: string;
  done?: boolean;
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
  /** 받을 날을 대략으로만 안다 — 「10월 말」. dueDate 는 그 구간의 끝 날이다 (아래 DUE_PARTS) */
  dueApprox?: DuePart;
  /** 실제로 들어온 날. 적혀 있으면 입금 완료로 본다 */
  paidDate?: string;
  note?: string;
}

// ---- 대략 받을 날 ---------------------------------------------
//
//  발주처는 「이달 말쯤」 「다음 달 초」 라고만 말할 때가 많다. 그걸 아무 날짜로
//  찍어 두면 나중에 누가 봐도 약속한 날처럼 읽힌다. 그래서 「10월 말」 을 그대로
//  적고, dueDate 에는 그 구간의 **끝 날**(초 10일 · 중 20일 · 말 말일)을 같이 둔다.
//  연체 판정 · 정렬 · 런웨이의 달 배치가 날짜 하나로 그대로 돈다. 끝 날로 두는 건
//  「말이라 했는데 25일에 벌써 연체」 가 되지 않게.

export const DUE_PARTS = ["early", "mid", "late"] as const;
export type DuePart = (typeof DUE_PARTS)[number];
export const DUE_PART_LABEL: Record<DuePart, string> = { early: "초", mid: "중", late: "말" };

/** `YYYY-MM` 의 초·중·말 → 그 구간의 끝 날 */
export function approxDueDate(month: string, part: DuePart): string {
  if (part === "early") return `${month}-10`;
  if (part === "mid") return `${month}-20`;
  const [y, m] = month.split("-").map(Number);
  return `${month}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`;
}

/** 날짜 → 그 날이 드는 구간 (정확한 날을 대략으로 바꿀 때) */
export const partOfDate = (date: string): DuePart => {
  const d = Number(date.slice(8, 10));
  return d <= 10 ? "early" : d <= 20 ? "mid" : "late";
};

/** 받을 날 글자 — 대략이면 「2026년 10월 말」, 아니면 날짜 그대로 */
export function dueLabel(i: Pick<FinProjectInstallment, "dueDate" | "dueApprox">): string {
  if (!i.dueDate) return "";
  if (!i.dueApprox) return i.dueDate;
  const [y, m] = i.dueDate.split("-").map(Number);
  return `${y}년 ${m}월 ${DUE_PART_LABEL[i.dueApprox]}`;
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

// ---- 매출 차감 ------------------------------------------------
//
//  계약서에 찍힌 금액 중 일부를 발주처에 돌려주는 돈 — 에누리·할인·환급.
//  계약금액을 줄여 적으면 통장에 들어온 돈·세금계산서와 어긋나고, 원가
//  줄에 넣으면 매출이 부풀어 이익률이 틀어진다. 그래서 계약금액(총액)은
//  그대로 두고 여기서 뺀다.
//
//  부가세가 함께 줄어드는지는 세금계산서를 고쳐 끊었는지에 달렸다.
//    · 수정세금계산서 발행 — 돌려준 돈 안에 부가세가 들어 있다.
//      1,100,000 을 돌려주면 공급가액 1,000,000 · 부가세 100,000 이 준다.
//    · 세금계산서 그대로 — 부가세는 처음 끊은 대로 낸다. 돌려준 돈
//      전액이 공급가액(= 이익)에서 빠진다.
//
//  금액은 언제나 **실제로 돌려주는 돈**(양수)으로 적는다. 계약이 부가세
//  별도든 포함이든 통장에서 나가는 금액은 하나라, 그 숫자를 적게 한다.

export const DEDUCTION_TAX_MODES = ["invoice", "none"] as const;
export type DeductionTaxMode = (typeof DEDUCTION_TAX_MODES)[number];

export const DEDUCTION_TAX_LABEL: Record<DeductionTaxMode, string> = {
  invoice: "수정세금계산서 발행",
  none: "세금계산서 그대로",
};

export const DEDUCTION_TAX_HINT: Record<DeductionTaxMode, string> = {
  invoice: "부가세도 함께 줄어든다",
  none: "부가세는 처음 끊은 대로 내고, 돌려준 돈 전액이 이익에서 빠진다",
};

export interface FinProjectDeduction {
  id: string;
  label: string;
  /** 돌려주는 돈 — 통장에서 실제로 나가는 금액. 늘 양수로 둔다 */
  amount: number;
  taxMode: DeductionTaxMode;
  /** 돌려줬거나 청구액에서 뺀 날. 비어 있으면 아직 돌려줄 돈이다 */
  paidDate?: string;
  note?: string;
}

/**
 * 차감 한 줄이 공급가액·부가세에서 얼마씩 빼는가.
 * 면세 계약은 애초에 부가세가 없으니 어느 쪽이든 전액이 공급가액이다.
 */
export function deductionSplit(d: Pick<FinProjectDeduction, "amount" | "taxMode">, base: VatMode): VatSplit {
  const mode: VatMode = d.taxMode === "none" || base === "exempt" ? "exempt" : "included";
  return splitVat(d.amount, mode);
}

// ---- 사업체 --------------------------------------------------
//
//  같은 사람들이 사업자 넷(법인 네안데르 · 개인사업자 일해라컴퍼니 · 와작홈즈 ·
//  개인 계좌 안다르)으로 일을 받는다. 어느 사업체의 매출인지는 계약서·세금
//  계산서를 낸 쪽이 정한다 — 같은 행사도 선금과 잔금을 다른 사업체로 끊은
//  적이 있어(2025 JIMFF) 하나 이상을 고를 수 있게 한다.
//
//  이름은 원장의 사업장(site)과 같은 글자를 쓴다. 그래야 프로젝트에 고르지
//  않았을 때 원장 입금의 사업장으로 대신 보여줄 수 있다.

export const PROJECT_ENTITIES = ["네안데르", "일해라컴퍼니", "와작홈즈", "안다르"] as const;
export type ProjectEntity = (typeof PROJECT_ENTITIES)[number];

/** 좁은 칸에 쓰는 이름 — 사람들이 부르는 그대로 */
export const ENTITY_SHORT: Record<ProjectEntity, string> = {
  네안데르: "네안데르",
  일해라컴퍼니: "일컴",
  와작홈즈: "와작",
  안다르: "안다르",
};

export const isProjectEntity = (v: unknown): v is ProjectEntity =>
  (PROJECT_ENTITIES as readonly string[]).includes(String(v));

/**
 * 이 프로젝트의 사업체. 사람이 고른 값이 있으면 그것, 없으면 원장에서 이
 * 코드로 들어온 **수입**의 사업장들 — 고른 값이 아니라 추정이라 source 로
 * 구분해 화면이 흐리게 그린다.
 */
export function projectEntities(
  p: Pick<FinProjectDoc, "entities" | "code">,
  transactions: FinTransaction[] = [],
): { entities: ProjectEntity[]; source: "set" | "ledger" | "none" } {
  const set = (p.entities ?? []).filter(isProjectEntity);
  if (set.length > 0) return { entities: set, source: "set" };
  const seen = new Set<string>();
  ledgerRowsOf(transactions, p.code).forEach((t) => {
    if (t.txType === "수입" && t.site) seen.add(t.site);
  });
  const fromLedger = PROJECT_ENTITIES.filter((e) => seen.has(e));
  return fromLedger.length > 0 ? { entities: fromLedger, source: "ledger" } : { entities: [], source: "none" };
}

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
  /** 매출을 낸 사업체 (계약·세금계산서 주체). 원장 사업장과 같은 이름. 비우면 원장 입금으로 추정 */
  entities?: ProjectEntity[];
  /** 계약 금액. 이 값이 공급가액인지 총액인지는 vatMode 가 정한다 */
  contractAmount: number;
  /** 계약금액의 부가세 기준. 비우면 「부가세 별도」 */
  vatMode?: VatMode;
  /** 계약금액을 나눠 받는 일정 (선금·중도금·잔금) */
  installments?: FinProjectInstallment[];
  revenues: FinProjectRevenue[];
  /** 매출 차감 — 발주처에 돌려주는 돈 (에누리·할인·환급) */
  deductions?: FinProjectDeduction[];
  /** 사용자가 만든 열 */
  columns?: FinProjectColumn[];
  lines: FinProjectLine[];
  note?: string;
  /** 사내 인력 — 정직원·대표가 쓴 날 × 하루 단가 (추정 원가, 실제 지출이 아니다) */
  labor?: FinProjectLabor[];
  /** 남은 일 — 남은 청구 · 세금계산서 · 신고 · 장비 반납 … */
  todos?: FinProjectTodo[];
  /** 다음엔 — 이 건에서 배운 것 (다음 견적·운영에 넘길 것) */
  lessons?: string;
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

export const newLabor = (name = "", dayRate = 0): FinProjectLabor => ({ id: shortId(), name, days: 1, dayRate });

export const newTodo = (text: string): FinProjectTodo => ({ id: shortId(), text });

export function newDeduction(): FinProjectDeduction {
  return { id: shortId(), label: "", amount: 0, taxMode: "invoice" };
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
   * 수입 = **공급가액** 합계 (계약 + 추가 − 매출 차감). 이익 계산의 기준이다.
   * 받은 부가세는 국가에 낼 돈이라 회사 수익이 아니다.
   */
  revenue: number;
  /** 부가세 합계 — 받아서 납부할 돈. 수정세금계산서로 뺀 몫은 빠진다 */
  revenueVat: number;
  /** 순 청구 총액 = 공급가액 + 부가세. 매출 차감까지 뺀, 끝내 회사에 남는 돈 */
  revenueTotal: number;
  /** 차감 전 청구 총액 — 계약서·세금계산서에 찍히는 금액 */
  grossTotal: number;

  // ---- 매출 차감 ----
  /** 돌려주는 돈 합계 */
  deduction: number;
  /** 그중 공급가액에서 빠지는 몫 */
  deductionSupply: number;
  /** 그중 부가세에서 빠지는 몫 — 수정세금계산서를 끊은 줄만 */
  deductionVat: number;
  /** 아직 돌려주지 않은 돈 */
  deductionPending: number;
  deductionCount: number;

  // ---- 입금 · 미수금 (모두 청구 총액 기준, 부가세 포함) ----
  /** 실제로 들어온 돈 (입금일이 적힌 회차 + 입금 확인된 추가 수입) */
  received: number;
  /** 돌려준 돈 (날짜가 적힌 매출 차감) */
  returned: number;
  /** 미수금 = 순 청구 총액 − (들어온 돈 − 돌려준 돈) */
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
    deductions?: FinProjectDeduction[];
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
  const grossSupply = splits.reduce((n, v) => n + v.supply, 0);
  const grossVat = splits.reduce((n, v) => n + v.vat, 0);
  const grossTotal = splits.reduce((n, v) => n + v.total, 0);

  // ---- 매출 차감 ----
  //
  //  총액은 그대로 두고 여기서 뺀다. 세금계산서를 그대로 둔 차감은 부가세를
  //  건드리지 않으므로 돌려준 돈 전액이 공급가액에서 빠진다.
  const deductions = p.deductions ?? [];
  let deductionSupply = 0;
  let deductionVat = 0;
  let deductionPending = 0;
  let returned = 0;
  deductions.forEach((d) => {
    const split = deductionSplit(d, base);
    deductionSupply += split.supply;
    deductionVat += split.vat;
    if (d.paidDate) returned += split.total;
    else deductionPending += split.total;
  });
  const deduction = deductionSupply + deductionVat;
  const revenue = grossSupply - deductionSupply;
  const revenueVat = grossVat - deductionVat;
  const revenueTotal = grossTotal - deduction;

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
    grossTotal,
    deduction,
    deductionSupply,
    deductionVat,
    deductionPending,
    deductionCount: deductions.length,
    received,
    returned,
    // 들어온 돈이 청구액을 넘으면(초과 입금) 미수금은 0 으로 본다 —
    // 음수 미수금은 읽는 사람을 헷갈리게 한다. 초과분은 따로 드러낼 일이다.
    // 990 을 받고 110 을 돌려줄 계약이면, 990 이 들어온 순간 미수금은 0 이고
    // 남은 110 은 「돌려줄 돈」(deductionPending)으로 따로 보인다.
    unpaid: Math.max(0, revenueTotal - (received - returned)),
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

export function sanitizeDeduction(raw: Partial<FinProjectDeduction>): FinProjectDeduction {
  const taxMode = (DEDUCTION_TAX_MODES as readonly string[]).includes(String(raw.taxMode))
    ? (raw.taxMode as DeductionTaxMode)
    : "invoice";
  return compact({
    id: str(raw.id) ?? shortId(),
    label: String(raw.label ?? "").trim(),
    // 돌려주는 돈은 늘 양수로 둔다 — 「-1,100,000」 으로 적어도 같은 뜻이다
    amount: Math.abs(Math.round(num(raw.amount) ?? 0)),
    taxMode,
    paidDate: dateStr(raw.paidDate),
    note: str(raw.note),
  }) as FinProjectDeduction;
}

export function sanitizeLabor(raw: Partial<FinProjectLabor>): FinProjectLabor {
  const days = Number(raw.days);
  return compact({
    id: str(raw.id) ?? shortId(),
    name: String(raw.name ?? "").trim().slice(0, 40),
    // 반나절(0.5)까지 — 소수 둘째 자리에서 끊는다
    days: Number.isFinite(days) && days > 0 ? Math.round(days * 100) / 100 : 0,
    dayRate: Math.max(0, Math.round(num(raw.dayRate) ?? 0)),
    note: str(raw.note),
  }) as FinProjectLabor;
}

export function sanitizeInstallment(raw: Partial<FinProjectInstallment>): FinProjectInstallment {
  const kind = (INSTALLMENT_KINDS as readonly string[]).includes(String(raw.kind))
    ? (raw.kind as InstallmentKind)
    : "선금";
  const due = dateStr(raw.dueDate);
  const approx = due && (DUE_PARTS as readonly string[]).includes(String(raw.dueApprox)) ? (raw.dueApprox as DuePart) : undefined;
  return compact({
    id: str(raw.id) ?? shortId(),
    kind,
    amount: Math.round(num(raw.amount) ?? 0),
    // 대략이면 날짜를 그 구간의 끝 날로 맞춘다 — 화면이 어떤 날을 보내도 같은 값이 남게
    dueDate: due && approx ? approxDueDate(due.slice(0, 7), approx) : due,
    dueApprox: approx,
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

  const deductions = (Array.isArray(raw.deductions) ? raw.deductions : [])
    .map(sanitizeDeduction)
    .filter((d) => d.label || d.amount !== 0);

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
      // 정해진 넷만, 늘 같은 순서로 — 고른 순서에 따라 「일컴 · 네안데르」와
      // 「네안데르 · 일컴」이 따로 보이면 같은 조합이 두 가지로 읽힌다
      entities: (() => {
        const picked = new Set(Array.isArray(raw.entities) ? raw.entities.filter(isProjectEntity) : []);
        const list = PROJECT_ENTITIES.filter((e) => picked.has(e));
        return list.length > 0 ? list : undefined;
      })(),
      contractAmount: Math.round(num(raw.contractAmount) ?? 0),
      vatMode: vatMode(raw.vatMode) ?? "excluded",
      installments: installments.length > 0 ? installments : undefined,
      revenues,
      deductions: deductions.length > 0 ? deductions : undefined,
      columns: columns.length > 0 ? columns : undefined,
      lines,
      note: str(raw.note),
      labor: (() => {
        const list = (Array.isArray(raw.labor) ? raw.labor : [])
          .map(sanitizeLabor)
          .filter((l) => l.name || l.days !== 0 || l.dayRate !== 0);
        return list.length > 0 ? list : undefined;
      })(),
      todos: (() => {
        const list = (Array.isArray(raw.todos) ? raw.todos : [])
          .map((t) => compact({ id: str(t?.id) ?? shortId(), text: String(t?.text ?? "").trim().slice(0, 300), done: t?.done ? true : undefined }))
          .filter((t) => t.text) as FinProjectTodo[];
        return list.length > 0 ? list : undefined;
      })(),
      lessons: str(raw.lessons),
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

// ---- ERP 대시보드용 요약 ---------------------------------------
//
//  대시보드는 FinanceProvider 밖이라 원장 전체를 받지 않는다. 서버가 아직
//  끝나지 않은 프로젝트만 골라 숫자 몇 개로 줄여 보낸다 (매출 요약 타일과
//  같은 방식). 원장 참고값은 빼고 계산한다 — 카드에 싣지 않는 값이다.

/** 대시보드 카드가 그리는 프로젝트 한 줄 */
export interface ProjectDigest {
  id: string;
  name: string;
  code: string;
  client?: string;
  status: ProjectStatus;
  startDate?: string;
  endDate?: string;
  /** 수입 (공급가액) */
  revenue: number;
  profitActual: number;
  marginActual: number | null;
  unpaid: number;
  overdue: number;
  /** 준비물 — 준비 완료 줄 / 전체 줄 */
  doneCount: number;
  lineCount: number;
}

/** 아직 끝나지 않은 상태 — 대시보드에 올라오는 프로젝트 */
export const OPEN_PROJECT_STATUSES: ProjectStatus[] = ["active", "planning"];

export function projectDigest(p: FinProjectDoc): ProjectDigest {
  const s = projectSummary(p);
  return {
    id: p.id,
    name: p.name,
    code: p.code,
    client: p.client,
    status: p.status,
    startDate: p.startDate,
    endDate: p.endDate,
    revenue: s.revenue,
    profitActual: s.profitActual,
    marginActual: s.marginActual,
    unpaid: s.unpaid,
    overdue: s.overdue,
    doneCount: s.doneCount,
    lineCount: s.lineCount,
  };
}
