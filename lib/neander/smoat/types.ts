// ============================================================
//  SMOAT 매출 도메인 — 향수가 아닌 사업 하나
// ------------------------------------------------------------
//  ⚠️ SMOAT 은 매장이 아니다. 판매 줄(neander_sales_lines)에 네 번째
//     매장으로 끼우지 않았다. 이유:
//
//     · 매출 모듈의 축은 **상품 × 수량 × 재료비 × 접객 시간 × 이벤트**다.
//       향수 한 병을 만드는 데 드는 향료와 공병, 손님을 응대한 20분이
//       그 축의 내용이다. SMOAT 에는 그 어느 것도 없다 — 팔리는 것은
//       크레딧이고, 원가는 AI 호출이며, 접객 시간은 0 이다.
//     · 매장 축은 타입 한 줄이 아니라 고정비 배부·인건비·이벤트 코드·
//       장부 대사 매핑·색·집계에 걸쳐 있다. 거기 SMOAT 을 넣으면 그
//       모든 자리에 "SMOAT 이면 예외" 분기가 생긴다. 분기가 열 개를
//       넘으면 그건 같은 모듈이 아니다.
//
//  그래서 **같은 워크스페이스 안의 다른 사업**으로 둔다. 월 이동·금액
//  색·드릴·보고 덱 같은 껍데기는 그대로 쓰고, 도메인만 따로 갖는다.
//  통합 화면에서 만나는 자리는 "회사 매출 총괄" 한 줄뿐이다.
//
//  ── 이 모듈이 답하는 질문 ────────────────────────────────
//    이 달에 얼마 벌었나 (환불을 뺀 순매출)
//    누가 샀나 — 새 학원인가 다시 산 학원인가
//    무엇을 샀나 — 어느 팩이 팔리나
//    얼마 남았나 — AI 원가를 뺀 공헌이익
//    갚아야 할 것은 얼마인가 — 판 크레딧 중 아직 안 쓰인 몫 (선수금)
//
//  ⚠️ 여기 금액도 **회사 매출의 정본이 아니다.** 장부에는 다날 정산 입금과
//     계좌이체가 「SMOAT매출 / 정기구독」으로 이미 들어와 있다. 매장 모듈이
//     POS 를 거래로 적재하지 않는 것과 같은 이유로, 이 모듈도 장부를 고치지
//     않는다. 장부와는 /neander/sales/smoat 의 대사 표에서 만난다.
// ============================================================

import type { SmoatSaleKind } from "@/lib/neander/sync/contract";

export type { SmoatSaleKind };

export const SMOAT_KINDS: { value: SmoatSaleKind; label: string; hint: string }[] = [
  { value: "topup", label: "크레딧 충전", hint: "팩 단위 선결제 — 지금 매출의 거의 전부" },
  { value: "deposit", label: "무통장 수기", hint: "충전 레코드 없이 손으로 지급한 실입금" },
  { value: "subscription", label: "정기구독", hint: "다날 정기결제 심사 뒤에 열린다" },
];

export const smoatKindLabel = (k: SmoatSaleKind) =>
  SMOAT_KINDS.find((x) => x.value === k)?.label ?? k;

/**
 * 결제수단 — 수수료의 근거다.
 *
 * ⚠️ 매장의 PayMethod 와 **섞지 않는다.** 저쪽은 여신전문금융업법의
 *    영세·중소 우대요율이 기준이고, 이쪽은 다날 PG 계약 요율이다.
 *    같은 "신용카드"라도 근거가 다른 숫자라 한 타입으로 묶으면
 *    나중에 한쪽 요율을 고칠 때 다른 쪽이 조용히 따라 바뀐다.
 */
export type SmoatPayMethod =
  | "card"
  | "virtualAccount"
  | "transfer"
  | "easyPay"
  | "mobile"
  | "bank";

export const SMOAT_PAY_METHODS: { value: SmoatPayMethod; label: string }[] = [
  { value: "card", label: "카드" },
  { value: "virtualAccount", label: "가상계좌" },
  { value: "transfer", label: "계좌이체" },
  { value: "easyPay", label: "간편결제" },
  { value: "mobile", label: "휴대폰" },
  { value: "bank", label: "무통장" },
];

export const smoatPayMethodLabel = (m: SmoatPayMethod) =>
  SMOAT_PAY_METHODS.find((x) => x.value === m)?.label ?? m;

/** 사이트의 결제수단 문자열 → 우리 축. 모르면 카드로 보지 않고 그대로 둔다 */
export function parseSmoatPayMethod(raw: string): SmoatPayMethod | undefined {
  const t = String(raw ?? "").trim().toUpperCase();
  if (!t) return undefined;
  if (t === "CARD") return "card";
  if (t === "VIRTUAL_ACCOUNT") return "virtualAccount";
  if (t === "TRANSFER" || t === "BANK_TRANSFER") return "transfer";
  if (t === "EASY_PAY") return "easyPay";
  if (t === "MOBILE") return "mobile";
  if (t === "BANK") return "bank";
  return undefined;
}

/** 결제 한 건 */
export interface SmoatSale {
  /** `${kind}_${사이트 id}` */
  id: string;
  kind: SmoatSaleKind;
  /** 결제 확정일 (KST, YYYY-MM-DD) */
  date: string;
  /** 결제액 (환불 전) */
  gross: number;
  /** 돌려준 금액 */
  refund: number;
  /** 이 줄의 매출 = gross − refund */
  amount: number;
  /** 사이트의 상태 문자열 그대로 (COMPLETED · REFUNDED …) */
  status: string;
  payMethod?: SmoatPayMethod;
  /** 학원 id. 무통장 수기 지급은 어느 학원인지 모를 수 있어 빈 값이다 */
  accountId: string;
  accountName: string;
  /** 스타터 · 스탠다드 · 프리미엄 · 엔터프라이즈 */
  packLabel?: string;
  credits?: number;
  planTier?: string;
  pgTxId?: string;
  syncedAt: number;
  updatedAt: number;
}

/** 월별 AI 원가·크레딧 (문서 id = YYYY-MM) */
export interface SmoatMonthlyCost {
  /** YYYY-MM */
  id: string;
  aiUsd: number;
  aiKrw: number;
  /** 실제로 쓰인 환율의 역산 (aiKrw ÷ aiUsd) — 우리가 정한 값이 아니다 */
  fxRate?: number;
  creditsSold: number;
  creditsUsed: number;
  syncedAt: number;
}

// ============================================================
//  집계
// ============================================================

export interface SmoatPackStat {
  label: string;
  count: number;
  amount: number;
  credits: number;
}

export interface SmoatMethodStat {
  method: SmoatPayMethod | "unknown";
  count: number;
  amount: number;
}

export interface SmoatMonthPnl {
  month: string;
  /** 환불 전 결제액 */
  gross: number;
  refund: number;
  /** 순매출 = gross − refund */
  revenue: number;
  count: number;
  /** AI 호출 원가 (원). 아직 안 받았으면 null */
  aiCost: number | null;
  /**
   * 공헌이익 = 순매출 − AI 원가. 원가를 모르면 null —
   * 0 으로 두면 이익이 부풀려 보인다.
   */
  contribution: number | null;
  contributionRate: number | null;
  /** 결제한 학원 수 */
  accounts: number;
  /** 그중 이 달에 처음 산 학원 */
  newAccounts: number;
  /** 학원당 평균 결제액 */
  arpa: number | null;
  creditsSold: number;
  creditsUsed: number;
  /**
   * 판 크레딧 − 쓰인 크레딧 누계 — **선수금의 근사치**다.
   *
   * 돈은 받았지만 서비스로 갚지 않은 몫이라 회계상 매출보다 부채에 가깝다.
   * 매출과 나란히 두는 이유는 "이 달 매출이 좋았다"가 "이 달에 그만큼
   * 일했다"와 같은 말이 아니라는 것을 드러내기 위해서다.
   *
   * ⚠️ 근사치인 이유: 쓰인 크레딧에는 **무료 체험·프로모션·추천으로 준
   *    크레딧의 사용분**도 섞여 있고, 사이트의 소비 기록에는 어느 크레딧에서
   *    나갔는지가 없다. 그래서 실제 선수금보다 작게 나오고, 무료 크레딧이
   *    많이 쓰인 달이 이어지면 음수로 갈 수도 있다. 음수는 0 으로 보이지
   *    않고 그대로 보여준다 — 근사가 깨졌다는 신호이기 때문이다.
   */
  unusedCredits: number;
  byPack: SmoatPackStat[];
  byMethod: SmoatMethodStat[];
}

const inMonth = (date: string, month: string) => date.slice(0, 7) === month;

/** 데이터가 있는 달 — 최신순 */
export function smoatMonths(sales: SmoatSale[]): string[] {
  const set = new Set(sales.map((s) => s.date.slice(0, 7)).filter((m) => /^\d{4}-\d{2}$/.test(m)));
  return [...set].sort().reverse();
}

/**
 * 한 달 손익.
 *
 * @param sales 전체 결제 (월 필터는 안에서 한다 — 신규 학원 판정에 과거가 필요하다)
 * @param costs 월별 원가 (id = YYYY-MM)
 */
export function buildSmoatPnl(
  month: string,
  sales: SmoatSale[],
  costs: SmoatMonthlyCost[],
): SmoatMonthPnl {
  const mine = sales.filter((s) => inMonth(s.date, month) && s.amount > 0);
  const gross = mine.reduce((s, x) => s + x.gross, 0);
  const refund = mine.reduce((s, x) => s + x.refund, 0);
  const revenue = mine.reduce((s, x) => s + x.amount, 0);

  // 신규 판정 — 그 학원의 첫 결제가 이 달인가. 무통장 수기(학원 미상)는
  // 세지 않는다. 학원 id 가 없는 줄을 「신규 학원」으로 세면 매달 늘어난다.
  const firstByAccount = new Map<string, string>();
  sales
    .filter((s) => s.accountId && s.amount > 0)
    .forEach((s) => {
      const cur = firstByAccount.get(s.accountId);
      if (!cur || s.date < cur) firstByAccount.set(s.accountId, s.date);
    });
  const accounts = new Set(mine.filter((s) => s.accountId).map((s) => s.accountId));
  let newAccounts = 0;
  accounts.forEach((id) => {
    if (inMonth(firstByAccount.get(id) ?? "", month)) newAccounts += 1;
  });

  const packs = new Map<string, SmoatPackStat>();
  mine.forEach((s) => {
    const label = s.packLabel ?? (s.credits ? `${s.credits.toLocaleString("ko-KR")} 크레딧` : "기타");
    const cur = packs.get(label) ?? { label, count: 0, amount: 0, credits: 0 };
    cur.count += 1;
    cur.amount += s.amount;
    cur.credits += s.credits ?? 0;
    packs.set(label, cur);
  });

  const methods = new Map<string, SmoatMethodStat>();
  mine.forEach((s) => {
    const key = s.payMethod ?? "unknown";
    const cur = methods.get(key) ?? { method: key as SmoatPayMethod | "unknown", count: 0, amount: 0 };
    cur.count += 1;
    cur.amount += s.amount;
    methods.set(key, cur);
  });

  const cost = costs.find((c) => c.id === month);
  const aiCost = cost ? cost.aiKrw : null;
  const contribution = aiCost === null ? null : revenue - aiCost;

  // 선수금 누계 — 이 달까지 판 크레딧에서 쓰인 크레딧을 뺀 것
  const upTo = costs.filter((c) => c.id <= month);
  const unusedCredits = upTo.reduce((s, c) => s + c.creditsSold - c.creditsUsed, 0);

  return {
    month,
    gross,
    refund,
    revenue,
    count: mine.length,
    aiCost,
    contribution,
    contributionRate: contribution === null || revenue <= 0 ? null : contribution / revenue,
    accounts: accounts.size,
    newAccounts,
    // 학원당 매출은 **학원이 확인된 매출**로만 나눈다. 무통장 수기 지급처럼
    // 학원을 모르는 돈을 분자에 넣으면 학원당 값이 부풀어 보인다.
    arpa:
      accounts.size > 0
        ? Math.round(mine.filter((s) => s.accountId).reduce((t, s) => t + s.amount, 0) / accounts.size)
        : null,
    creditsSold: cost?.creditsSold ?? 0,
    creditsUsed: cost?.creditsUsed ?? 0,
    unusedCredits,
    byPack: [...packs.values()].sort((a, b) => b.amount - a.amount),
    byMethod: [...methods.values()].sort((a, b) => b.amount - a.amount),
  };
}

/** 여러 달을 한 번에 — 추이 차트용 (오래된 달부터) */
export function smoatTrend(
  months: string[],
  sales: SmoatSale[],
  costs: SmoatMonthlyCost[],
): SmoatMonthPnl[] {
  return [...months].sort().map((m) => buildSmoatPnl(m, sales, costs));
}

/** 학원별 누계 — 누가 우리 매출을 떠받치나 */
export interface SmoatAccountStat {
  accountId: string;
  accountName: string;
  count: number;
  amount: number;
  firstDate: string;
  lastDate: string;
}

export function smoatAccounts(sales: SmoatSale[], month?: string): SmoatAccountStat[] {
  const out = new Map<string, SmoatAccountStat>();
  sales
    .filter((s) => s.amount > 0 && s.accountId && (!month || inMonth(s.date, month)))
    .forEach((s) => {
      const cur = out.get(s.accountId) ?? {
        accountId: s.accountId,
        accountName: s.accountName,
        count: 0,
        amount: 0,
        firstDate: s.date,
        lastDate: s.date,
      };
      cur.count += 1;
      cur.amount += s.amount;
      if (s.date < cur.firstDate) cur.firstDate = s.date;
      if (s.date > cur.lastDate) cur.lastDate = s.date;
      cur.accountName = cur.accountName || s.accountName;
      out.set(s.accountId, cur);
    });
  return [...out.values()].sort((a, b) => b.amount - a.amount);
}
