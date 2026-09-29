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
  /** 요금제별 학원 수 — 모두 구독한다고 볼 때 (구독 전환 비율 적용 전) */
  counts: number[];
  /** Σ 추천 요금제 가격 — 모두 구독한다고 볼 때 */
  base: number;
  /** 비용이 늘어 구독하지 않는다고 본 학원을 뺀 요금제별 학원 수 */
  keptCounts: number[];
  keptBase: number;
  /** 구독하면 비용이 기준보다 더 늘어 뺀 학원 수 */
  skipped: number;
  /** 기존 학원 몫 = keptBase × 구독 전환 비율 */
  existing: number;
  /** 추가 전환 매출 */
  extra: number;
  /** 월 매출 = keptBase × 구독 전환 비율 + 추가 전환 수 × 첫 요금제 가격 */
  monthly: number;
  /** 구독 학원 수 = 남은 학원 × 전환 비율 + 추가 전환 */
  subscribers: number;
  /** 월 공헌이익 (profits 를 줬을 때) = Σ 요금제 이익 × 전환 비율 + 추가 전환 × 첫 요금제 이익 */
  contribution: number | null;
}

export interface SimOptions {
  /** 구독하면 지금보다 이 비율(%) 넘게 비용이 느는 학원은 구독하지 않는다고 본다. null = 모두 구독 */
  skipIfCostUpOverPct?: number | null;
  /** 요금제별 이익 (원) — 주면 월 공헌이익도 낸다 */
  profits?: number[];
}

export function simulateSubscriptions(
  academies: { monthlyCredits: number; monthlySpend?: number }[],
  tiers: Tier[],
  headroomPct: number,
  subscribeRatePct: number,
  extraConversions: number,
  extraTierIndex = 0,
  opts: SimOptions = {},
): SubscriptionSim {
  const counts = tiers.map(() => 0);
  const keptCounts = tiers.map(() => 0);
  let base = 0;
  let keptBase = 0;
  let skipped = 0;
  for (const a of academies) {
    const { index } = recommendTier(a.monthlyCredits, tiers, headroomPct);
    const price = tiers[index].price;
    counts[index] += 1;
    base += price;
    const limit = opts.skipIfCostUpOverPct;
    const up = a.monthlySpend && a.monthlySpend > 0 ? (price - a.monthlySpend) / a.monthlySpend : 0;
    if (limit !== null && limit !== undefined && up > pct(limit)) {
      skipped += 1;
      continue;
    }
    keptCounts[index] += 1;
    keptBase += price;
  }
  const rate = pct(subscribeRatePct);
  const extraN = Math.max(0, extraConversions);
  const extra = extraN * (tiers[extraTierIndex]?.price ?? 0);
  const existing = keptBase * rate;
  const kept = keptCounts.reduce((s, c) => s + c, 0);
  const contribution = opts.profits
    ? keptCounts.reduce((s, c, i) => s + c * (opts.profits![i] ?? 0), 0) * rate + extraN * (opts.profits[extraTierIndex] ?? 0)
    : null;
  return {
    counts,
    base,
    keptCounts,
    keptBase,
    skipped,
    existing,
    extra,
    monthly: existing + extra,
    subscribers: kept * rate + extraN,
    contribution,
  };
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

/**
 * 공헌이익률(계산) = 100 − 직접비율 − 현장 인건비율 − 본사 인력 투입률.
 * 직접비율(ERP 프로젝트)에는 본사 사람 시간이 들어 있지 않다 — 그 몫을 따로 뺀다.
 */
export const b2bContribRate = (directPct: number, fieldLaborPct: number, hqLaborPct = 0) =>
  100 - directPct - fieldLaborPct - hqLaborPct;

/** 월 B2B 레버 = 추가 건수 × 건당 금액 × 공헌이익률 */
export const b2bMonthlyLever = (addPerMonth: number, dealSize: number, contribRatePct: number) =>
  addPerMonth * dealSize * pct(contribRatePct);

// ---- 부족분을 메우는 레버 ----------------------------------------

export interface WaterfallStep {
  key: string;
  label: string;
  /** 이 레버가 메우는 금액 (음수면 오히려 벌어진다). 모르면 null — 0 으로 센다 */
  value: number | null;
  /** 이 레버 전·후의 남는 부족분 */
  from: number;
  to: number;
}

/**
 * 부족분 폭포 — 부족분에서 레버를 하나씩 빼 간다.
 * 부족분은 「지출 − 매출」, 레버는 「공헌이익」이라 성격이 다르다 (장표 각주).
 */
export function gapWaterfall(gap: number, levers: { key: string; label: string; value: number | null }[]) {
  let cur = gap;
  const steps: WaterfallStep[] = levers.map((l) => {
    const from = cur;
    cur = cur - (l.value ?? 0);
    return { ...l, from, to: cur };
  });
  return { gap, steps, remaining: cur, covered: gap - cur };
}

// ---- 스모트 이익률 두 가지 ----------------------------------------

/** 유료 사용분 기준 = (매출 − 그 달 AI 원가) ÷ 매출 — 무료로 쓴 원가가 매출에 묻힌다 */
export function paidMargin(revenue: number, aiCost: number | null): number | null {
  if (aiCost === null || !(revenue > 0)) return null;
  return (revenue - aiCost) / revenue;
}

/**
 * 무료 포함 실제 이익률 = (학원 결제 공급가 − 같은 기간 AI 원가 전체) ÷ 공급가.
 * 무료 크레딧으로 쓴 원가까지 결제가 떠안는다고 본 값이다.
 */
export function marginInclFree(payments: number, aiCost: number, vatPct: number): number | null {
  const supply = payments / (1 + pct(vatPct));
  if (!(supply > 0)) return null;
  return (supply - aiCost) / supply;
}

/** 필요한 가입 학원 수 = 손익분기 학원 수 ÷ 무료 → 유료 전환율 */
export function signupsNeeded(breakeven: number | null, freeToPaidPct: number): number | null {
  if (breakeven === null || !(freeToPaidPct > 0)) return null;
  return breakeven / pct(freeToPaidPct);
}

/** 낮을수록 좋은 목표의 진행률 (0~1) — 지금이 목표 이하면 1, 아니면 목표 ÷ 지금 */
export function progressDown(current: number | null, target: number | null): number | null {
  if (current === null || target === null || !Number.isFinite(current) || !Number.isFinite(target)) return null;
  if (current <= target) return 1;
  return current > 0 ? Math.max(0, Math.min(1, target / current)) : 0;
}

/** 진행률 (0~1) — 목표나 현재를 모르면 null */
export function progress(current: number | null, target: number | null): number | null {
  if (current === null || target === null || !Number.isFinite(current) || !Number.isFinite(target)) return null;
  if (target === 0) return current >= 0 ? 1 : 0;
  return Math.max(0, Math.min(1, current / target));
}

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

// ---- 백억 산수 --------------------------------------------------

/**
 * 목표 매출에 필요한 학원 수 = (목표 − ① 천장) × 1억 ÷ (학원당 월 매출 × 12).
 * 목표·천장은 억원/년, 학원당 월 매출은 원.
 */
export function academiesForTarget(targetEok: number, ceilingEok: number, arpuWon: number | null): number | null {
  if (arpuWon === null || !(arpuWon > 0)) return null;
  return (Math.max(0, targetEok - ceilingEok) * 1e8) / (arpuWon * 12);
}

/** 향 브랜드 하루 판매량 = 목표 × 1억 ÷ 평균 판매가 ÷ 365 */
export function brandDailyUnits(targetEok: number, avgPriceWon: number): number | null {
  if (!(avgPriceWon > 0)) return null;
  return (targetEok * 1e8) / avgPriceWon / 365;
}

// ---- 약정 ------------------------------------------------------

/** 무약정 12개월 기대 개월 = (1 − (1 − 해지율)^12) ÷ 해지율. 해지율 0 이면 12 */
export function expectedMonths(churnPct: number, n = 12): number {
  const c = pct(Math.min(100, Math.max(0, churnPct)));
  if (c === 0) return n;
  return (1 - (1 - c) ** n) / c;
}

/**
 * 무약정 vs 1년 약정 연 매출 (학원 한 곳).
 *   무약정 = 기대 개월 × 정가
 *   약정   = (1 − 중도 해지) × 12 × 약정가 + 중도 해지 × 기대 개월 × 정가
 * 중도 해지한 학원은 무약정처럼 평균 기대 개월만 쓰고, 받은 할인액을 돌려준다 —
 * 결국 쓴 개월을 정가로 낸 셈이다.
 */
export function commitmentEconomics(price: number, commitPrice: number, churnPct: number, earlyExitPct: number) {
  const months = expectedMonths(churnPct);
  const noCommit = months * price;
  const e = pct(Math.min(100, Math.max(0, earlyExitPct)));
  const commit = (1 - e) * 12 * commitPrice + e * months * price;
  const commitNoExit = 12 * commitPrice;
  return {
    months,
    noCommit,
    commit,
    commitNoExit,
    lift: noCommit > 0 ? commit / noCommit - 1 : null,
    liftNoExit: noCommit > 0 ? commitNoExit / noCommit - 1 : null,
    discount: price > 0 ? 1 - commitPrice / price : null,
  };
}

// ---- 품질 환불 ----------------------------------------------------

/**
 * 월 환불 크레딧 = 지급 × 사용률 × 오류 문항 비율 + 지급 × 환불 한도 × 한도 사용 비율.
 * 추가 AI 원가 = 환불 크레딧 × 원가/C. 이익률 감소폭 = 추가 원가 ÷ 공급가.
 */
export function qualityRefund(
  i: { credits: number; usagePct: number; errorPct: number; capPct: number; capUsePct: number; aiCostPerCredit: number },
  supply: number,
) {
  const errorCredits = i.credits * pct(i.usagePct) * pct(i.errorPct);
  const capCredits = i.credits * pct(i.capPct) * pct(i.capUsePct);
  const credits = errorCredits + capCredits;
  const cost = credits * i.aiCostPerCredit;
  /** 한도를 다 쓸 때의 재생성 원가 */
  const capFullCost = i.credits * pct(i.capPct) * i.aiCostPerCredit;
  return { credits, cost, capFullCost, marginDrop: supply > 0 ? cost / supply : null };
}

// ---- B2B 표준화 · 매장 기회 비교 ------------------------------------------

/** 표준화 레버(월) = B2B 월 매출 × (지금 직접비율 − 목표 직접비율) */
export function standardizationLever(monthlyRevenue: number, currentDirectPct: number, targetDirectPct: number): number {
  return monthlyRevenue * pct(currentDirectPct - targetDirectPct);
}

/**
 * 매장을 닫고 그 사람이 벌어야 하는 공헌이익 = 매장 기여이익 + 매장발 B2B + 대체 마케팅 비용 (만원/월).
 * 모르는 칸(null)은 0 으로 더하고 missing 에 적는다.
 */
export function storeOpportunity(
  i: { storeContrib: number | null; storeB2B: number | null; replacementMarketing: number | null },
  perAcademyWon: number | null,
  dealSizeMan: number,
  contribRatePct: number,
) {
  const missing = [
    ...(i.storeB2B === null ? ["storeB2B"] : []),
    ...(i.replacementMarketing === null ? ["replacementMarketing"] : []),
  ];
  const need = (i.storeContrib ?? 0) + (i.storeB2B ?? 0) + (i.replacementMarketing ?? 0);
  const perDeal = dealSizeMan * pct(contribRatePct);
  return {
    need,
    missing,
    academies: perAcademyWon !== null && perAcademyWon > 0 ? (need * 1e4) / perAcademyWon : null,
    deals: perDeal > 0 ? need / perDeal : null,
  };
}
