// ============================================================
//  장표 계산식 — 전부 순수 함수 (calc.test.ts)
// ------------------------------------------------------------
//  입력과 출력의 단위는 부르는 쪽이 정한다. 스모트 요금제는 원,
//  매장·B2B·현금은 만원으로 넣는다. 퍼센트 인자는 46 처럼 퍼센트 숫자다.
//  값이 모자라면(나누는 수가 0 이하, 입력 필요) null 을 돌려준다 —
//  화면은 null 을 「미정」으로 쓴다.
// ============================================================

const pct = (p: number) => p / 100;

// ---- 매장 이전 -----------------------------------------------

/** 회수 개월 = 이전 비용 ÷ 월 이익 개선 */
export function paybackMonths(cost: number, monthlyGain: number): number | null {
  if (!(monthlyGain > 0)) return null;
  return cost / monthlyGain;
}

export interface RelocPayback {
  rows: { cost: number; cells: { gain: number; months: number | null }[] }[];
  /** 가장 짧은 회수 (가장 싼 비용 ÷ 가장 큰 개선) */
  min: number | null;
  /** 가장 긴 회수 */
  max: number | null;
}

/** 비용 여러 개 × 개선 여러 개의 조합표와 범위 */
export function relocPayback(costs: number[], gains: number[]): RelocPayback {
  const rows = costs.map((cost) => ({
    cost,
    cells: gains.map((gain) => ({ gain, months: paybackMonths(cost, gain) })),
  }));
  const all = rows.flatMap((r) => r.cells.map((c) => c.months)).filter((m): m is number => m !== null);
  return {
    rows,
    min: all.length ? Math.min(...all) : null,
    max: all.length ? Math.max(...all) : null,
  };
}

/** 한 매장으로 합친 뒤 이벤트 매출 = 현재 이벤트 매출 × 유지율 */
export function mergedEventRevenue(current: number, keepRatePct: number): number {
  return current * pct(keepRatePct);
}

// ---- 현금 -----------------------------------------------------

export interface Runway {
  /** 한 달에 줄어드는 현금 (양수면 적자) */
  burn: number;
  /** 버틸 수 있는 개월. 흑자면 null */
  months: number | null;
  surplus: boolean;
}

/** 런웨이 = 현금 잔고 ÷ (월 지출 − 월 매출 − [지원금]) — 분모가 0 이하이면 흑자 */
export function runway(i: {
  cash: number;
  cost: number;
  revenue: number;
  subsidy: number;
  includeSubsidy: boolean;
}): Runway {
  const burn = i.cost - i.revenue - (i.includeSubsidy ? i.subsidy : 0);
  if (burn <= 0) return { burn, months: null, surplus: true };
  return { burn, months: Math.max(0, i.cash) / burn, surplus: false };
}

// ---- 스모트 요금제 --------------------------------------------

export interface Tier {
  name: string;
  /** 월 가격 (원, 부가세 포함) */
  price: number;
  /** 매달 지급 크레딧 */
  credits: number;
}

export interface SmoatParams {
  vatRate: number;
  pgFeeRate: number;
  /** 원/C */
  aiCostPerCredit: number;
  usageRate: number;
  creditsPerQuestion: number;
}

export interface TierEconomics extends Tier {
  supply: number;
  fee: number;
  /** 크레딧을 전부 쓸 때 AI 원가 */
  aiFull: number;
  /** 설정한 사용률일 때 AI 원가 */
  aiSet: number;
  profitFull: number;
  profitSet: number;
  marginFull: number | null;
  marginSet: number | null;
  /** 1C 당 가격 */
  perCredit: number | null;
  /** 약 문항 수 */
  questions: number | null;
  perQuestion: number | null;
}

/**
 * 공급가 = 가격 ÷ (1 + 부가세율), 결제 수수료 = 가격 × 수수료율,
 * AI 원가 = 월 크레딧 × 사용률 × 원가/C, 이익 = 공급가 − 수수료 − AI 원가.
 */
export function tierEconomics(t: Tier, p: SmoatParams): TierEconomics {
  const supply = t.price / (1 + pct(p.vatRate));
  const fee = t.price * pct(p.pgFeeRate);
  const aiFull = t.credits * p.aiCostPerCredit;
  const aiSet = t.credits * pct(p.usageRate) * p.aiCostPerCredit;
  const profitFull = supply - fee - aiFull;
  const profitSet = supply - fee - aiSet;
  const questions = p.creditsPerQuestion > 0 ? t.credits / p.creditsPerQuestion : null;
  return {
    ...t,
    supply,
    fee,
    aiFull,
    aiSet,
    profitFull,
    profitSet,
    marginFull: supply > 0 ? profitFull / supply : null,
    marginSet: supply > 0 ? profitSet / supply : null,
    perCredit: t.credits > 0 ? t.price / t.credits : null,
    questions,
    perQuestion: questions ? t.price / questions : null,
  };
}

export interface TierPick {
  index: number;
  /** 가장 큰 요금제로도 여유분까지 덮지 못함 — 추가 묶음이 필요 */
  over: boolean;
}

/**
 * 추천 요금제 = 월 크레딧이 필요량 × (1 + 여유율) 이상인 가장 싼 요금제.
 * 어떤 요금제로도 모자라면 가장 큰 요금제 + over.
 */
export function recommendTier(needCredits: number, tiers: Tier[], headroomPct: number): TierPick {
  const target = needCredits * (1 + pct(headroomPct));
  const order = tiers.map((t, i) => ({ t, i })).sort((a, b) => a.t.price - b.t.price);
  const hit = order.find((o) => o.t.credits >= target - 1e-9);
  if (hit) return { index: hit.i, over: false };
  const biggest = order.reduce((a, b) => (b.t.credits > a.t.credits ? b : a), order[0]);
  return { index: biggest?.i ?? 0, over: true };
}

export interface AcademyCompare {
  index: number;
  over: boolean;
  price: number;
  /** 절감액 = 현재 월 지출 − 구독 가격 (음수면 더 냄) */
  saving: number;
  savingRate: number | null;
  /** 크레딧 배수 = 요금제 크레딧 ÷ 필요량 */
  multiple: number | null;
}

export function compareAcademy(
  a: { monthlySpend: number; monthlyCredits: number },
  tiers: Tier[],
  headroomPct: number,
): AcademyCompare {
  const pick = recommendTier(a.monthlyCredits, tiers, headroomPct);
  const tier = tiers[pick.index];
  const saving = a.monthlySpend - tier.price;
  return {
    ...pick,
    price: tier.price,
    saving,
    savingRate: a.monthlySpend > 0 ? saving / a.monthlySpend : null,
    multiple: a.monthlyCredits > 0 ? tier.credits / a.monthlyCredits : null,
  };
}

export interface SubscriptionSim {
  /** 요금제별 학원 수 (구독 전환 비율 적용 전) */
  counts: number[];
  /** Σ 추천 요금제 가격 */
  base: number;
  /** 기존 학원 몫 = base × 구독 전환 비율 */
  existing: number;
  /** 추가 전환 매출 */
  extra: number;
  /** 월 매출 = base × 구독 전환 비율 + 추가 전환 수 × 첫 요금제 가격 */
  monthly: number;
}

export function simulateSubscriptions(
  academies: { monthlyCredits: number }[],
  tiers: Tier[],
  headroomPct: number,
  subscribeRatePct: number,
  extraConversions: number,
  extraTierIndex = 0,
): SubscriptionSim {
  const counts = tiers.map(() => 0);
  let base = 0;
  for (const a of academies) {
    const { index } = recommendTier(a.monthlyCredits, tiers, headroomPct);
    counts[index] += 1;
    base += tiers[index].price;
  }
  const extra = Math.max(0, extraConversions) * (tiers[extraTierIndex]?.price ?? 0);
  const existing = base * pct(subscribeRatePct);
  return { counts, base, existing, extra, monthly: existing + extra };
}

/** 월 해지율을 적용한 n개월 누적 — m 번째 달 매출 = 첫 달 × (1 − 해지율)^(m−1) */
export function churnCumulative(monthly: number, churnPct: number, n = 12): { series: number[]; total: number } {
  const keep = 1 - pct(Math.min(100, Math.max(0, churnPct)));
  const series: number[] = [];
  let cur = monthly;
  for (let m = 0; m < n; m++) {
    series.push(cur);
    cur *= keep;
  }
  return { series, total: series.reduce((s, x) => s + x, 0) };
}

/** 학원당 평균 공헌이익 = 요금제 구성 비율로 가중평균한 요금제별 이익 */
export function weightedContribution(counts: number[], profits: number[]): number | null {
  const n = counts.reduce((s, c) => s + c, 0);
  if (n <= 0) return null;
  return counts.reduce((s, c, i) => s + c * (profits[i] ?? 0), 0) / n;
}

/** 손익분기 학원 수 = (사업부 고정비 + 공통비 부담액) ÷ 학원당 평균 공헌이익 */
export function breakevenAcademies(fixed: number, commonShare: number, avgContribution: number | null): number | null {
  if (avgContribution === null || !(avgContribution > 0)) return null;
  return (fixed + commonShare) / avgContribution;
}

/** 학기(6개월)·연간 선결제 금액 */
export function prepay(monthlyPrice: number, semesterFree: number, annualFree: number) {
  const semester = monthlyPrice * Math.max(0, 6 - semesterFree);
  const annual = monthlyPrice * Math.max(0, 12 - annualFree);
  return {
    semester,
    annual,
    semesterPerMonth: semester / 6,
    annualPerMonth: annual / 12,
    semesterDiscount: semesterFree / 6,
    annualDiscount: annualFree / 12,
  };
}

// ---- B2B ------------------------------------------------------

/** 연 추가 매출 = 추가 건수 × 건당 금액 × 12, 연 추가 공헌이익 = 연 추가 매출 × 공헌이익률 */
export function b2bScenario(addPerMonth: number, dealSize: number, contribRatePct: number) {
  const annualRevenue = addPerMonth * dealSize * 12;
  return { add: addPerMonth, dealSize, annualRevenue, annualContrib: annualRevenue * pct(contribRatePct) };
}

/** 상품별 예상 이익 = 시작가 × (1 − 상품별 직접비율 − 현장 인건비율) */
export function productProfit(startPrice: number, directPct: number, fieldLaborPct: number) {
  const rate = 1 - pct(directPct) - pct(fieldLaborPct);
  return { profit: startPrice * rate, rate };
}

/** 공헌이익률(계산) = 100 − 직접비율 − 현장 인건비율 */
export const b2bContribRate = (directPct: number, fieldLaborPct: number) => 100 - directPct - fieldLaborPct;

// ---- 생카 -----------------------------------------------------

/**
 * T1 면제 기대 비용(월) = T1 건수 × 미달 확률 × 평균 미달액 × 이벤트 일수 + T1 건수 × 특전 지원 비용
 */
export function t1WaiverCost(i: {
  t1Count: number;
  shortfallProbPct: number;
  avgShortfallPerDay: number;
  eventDays: number;
  perkCost: number;
}): { waiver: number; perk: number; total: number } {
  const waiver = i.t1Count * pct(i.shortfallProbPct) * i.avgShortfallPerDay * i.eventDays;
  const perk = i.t1Count * i.perkCost;
  return { waiver, perk, total: waiver + perk };
}

/** 예약 기대 건수 = 월 DM 수 × 응답률 × 예약 전환율 */
export function dmFunnel(dmPerMonth: number, replyRatePct: number, bookRatePct: number) {
  const replies = dmPerMonth * pct(replyRatePct);
  return { dm: dmPerMonth, replies, bookings: replies * pct(bookRatePct) };
}

/** 외부 주최 증가분의 공헌이익 — 1건 공헌이익을 모르면 null */
export function externalGain(now: number, target: number, perEvent: number | null): number | null {
  if (perEvent === null || !Number.isFinite(perEvent)) return null;
  return (target - now) * perEvent;
}

// ---- 학원 월 크레딧 구간 ---------------------------------------

export interface CreditBand {
  label: string;
  from: number;
  to: number | null;
  count: number;
  spendMin: number | null;
  spendMax: number | null;
  spendAvg: number | null;
  perCreditMin: number | null;
  perCreditMax: number | null;
}

/** 경계 [300, 800, 2000] → 300 이하 · 301~800 · 801~2,000 · 2,000 초과 */
export function creditBands(
  academies: { monthlySpend: number; monthlyCredits: number }[],
  edges: number[],
): CreditBand[] {
  const fmt = (n: number) => n.toLocaleString("ko-KR");
  const ranges: { from: number; to: number | null; label: string }[] = [];
  let prev = 0;
  edges.forEach((e, i) => {
    ranges.push({ from: prev, to: e, label: i === 0 ? `${fmt(e)}C 이하` : `${fmt(prev + 1)}~${fmt(e)}C` });
    prev = e;
  });
  ranges.push({ from: prev, to: null, label: `${fmt(prev)}C 초과` });

  return ranges.map((r) => {
    // 첫 구간은 0 부터(0C 도 포함), 나머지는 경계 초과부터
    const above = (c: number) => (r.from === 0 ? c >= 0 : c > r.from);
    const inBand = academies.filter((a) => above(a.monthlyCredits) && (r.to === null || a.monthlyCredits <= r.to));
    const spends = inBand.map((a) => a.monthlySpend);
    const per = inBand.filter((a) => a.monthlyCredits > 0).map((a) => a.monthlySpend / a.monthlyCredits);
    const avg = spends.length ? spends.reduce((s, x) => s + x, 0) / spends.length : null;
    return {
      label: r.label,
      from: r.from,
      to: r.to,
      count: inBand.length,
      spendMin: spends.length ? Math.min(...spends) : null,
      spendMax: spends.length ? Math.max(...spends) : null,
      spendAvg: avg,
      perCreditMin: per.length ? Math.min(...per) : null,
      perCreditMax: per.length ? Math.max(...per) : null,
    };
  });
}
