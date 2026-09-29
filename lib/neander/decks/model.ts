// ============================================================
//  장표 모델 — 가정값 + 실측 + 계산식 → 표와 결론 숫자
// ------------------------------------------------------------
//  화면은 가정을 하나 바꿀 때마다 buildModel 을 다시 부른다. 계산은 가볍고
//  (학원 수십 곳, 조합 몇 개) 전부 순수 함수라, 결과를 나눠 캐시하지 않는다.
//
//  값이 정해지는 순서
//    1) 내용의 기본값
//    2) 실측(ERP) — 받아 온 값이 있으면 기본값을 대신한다
//       ERP 를 못 읽은 부분은 내용의 스냅샷에서 같은 방법으로 꺼낸다
//    3) 사람이 덮어쓴 값 (가정 패널·칩·공유 링크·회의용 저장본)
//    4) 계산 값 — 덮어쓰지 않았으면 다른 값에서 따라 나온다
// ============================================================

import * as calc from "./calc";
import type {
  AssumptionDef,
  AssumptionValue,
  Block,
  DeckActuals,
  DeckContent,
  FinanceActuals,
  SlideSpec,
  SmoatActuals,
} from "./types";
import { tokenPaths } from "./template";

export type Values = Record<string, AssumptionValue>;

export type ValueOrigin = "erp" | "snapshot" | "content" | "derived";

export interface ValueMeta {
  /** 덮어쓰기 전 값 */
  base: AssumptionValue;
  origin: ValueOrigin;
  asOf?: string;
  overridden: boolean;
  /** 실측에 붙는 한 줄 (예: 동기화가 늦어 사용자 확인값을 썼다) */
  note?: string;
}

// ---- 실측 → 가정값 ------------------------------------------

const r0 = (n: number) => Math.round(n);
const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * 기준 기간 — 「최근 12개월」 · 「최근 6개월」. B2B 매출·월 지출·공통비가 같은 기간을 쓴다.
 * 내용에 이 가정이 없으면 예전처럼 6개월.
 */
export const basisMonths = (v: Values): 6 | 12 => (v.revenueBasis === 12 ? 12 : 6);

/**
 * ERP 에서 자동 계산되는 가정 — 키마다 실측의 어느 값을 어떤 단위로 쓰는가.
 * 둘째 인자는 먼저 정해진 가정값 (기준 기간처럼 실측을 고르는 값).
 */
const ACTUAL_SOURCES: Record<string, (a: DeckActuals, v: Values) => { value: number; asOf: string; note?: string } | null> = {
  revB2B: ({ finance: f }, v) => {
    if (!f) return null;
    const monthly = basisMonths(v) === 12 ? f.b2b.total / 12 : f.b2b.recentAvg;
    return { value: r0(monthly / 1e4), asOf: f.asOf };
  },
  b2bDealsPerMonth: ({ finance: f }) => (f ? { value: r1(f.b2b.dealsPerMonth), asOf: f.asOf } : null),
  b2bAvgDeal: ({ finance: f }) => (f ? { value: r0(f.b2b.perClient / 1e4), asOf: f.asOf } : null),
  b2bDirectCostRate: ({ finance: f }) =>
    f && f.projects.length ? { value: r1(f.projectsRate * 100), asOf: f.asOf } : null,
  subsidyMonthly: ({ finance: f }) => (f ? { value: r0(f.subsidy.monthlyAvg / 1e4), asOf: f.asOf } : null),
  costMonthly: ({ finance: f }, v) => {
    if (!f) return null;
    const x = basisMonths(v) === 12 && f.cost.monthlyAvg12 !== undefined ? f.cost.monthlyAvg12 : f.cost.monthlyAvg;
    return { value: r0(x / 1e4), asOf: f.asOf };
  },
  commonCostMonthly: ({ finance: f }, v) => {
    if (!f) return null;
    const x =
      basisMonths(v) === 12 && f.cost.commonMonthlyAvg12 !== undefined ? f.cost.commonMonthlyAvg12 : f.cost.commonMonthlyAvg;
    return { value: r0(x / 1e4), asOf: f.asOf };
  },
  revSmoat: ({ smoat: s }) =>
    s
      ? {
          value: r1(s.revMonth / 1e4),
          asOf: s.asOf,
          note: s.revMonthErp !== undefined ? `사용자 확인값 (ERP ${s.revMonthErp.toLocaleString("ko-KR")}원, 동기화 전)` : undefined,
        }
      : null,
  aiCostPerCredit: ({ smoat: s }) => (s && s.aiCost.creditsUsed > 0 ? { value: r2(s.aiCost.perCredit), asOf: s.asOf } : null),
};

export const ERP_KEYS = Object.keys(ACTUAL_SOURCES);

/** 계산 값 — 덮어쓰지 않았으면 이렇게 따라 나온다 */
const DERIVED: Record<string, (v: Values) => AssumptionValue> = {
  b2bContribRate: (v) => {
    const d = v.b2bDirectCostRate;
    const f = v.b2bFieldLaborRate;
    const h = typeof v.b2bHqLaborRate === "number" ? v.b2bHqLaborRate : 0;
    return typeof d === "number" && typeof f === "number" ? r1(calc.b2bContribRate(d, f, h)) : null;
  },
};

export interface EffectiveActuals {
  smoat: SmoatActuals | null;
  finance: FinanceActuals | null;
  /** 이 부분은 스냅샷을 쓰고 있다 */
  snapshot: { smoat: boolean; finance: boolean };
}

/** 받아 온 실측과 스냅샷을 합친다 — 못 받은 부분만 스냅샷 */
export function effectiveActuals(content: DeckContent, live: DeckActuals | null | undefined): EffectiveActuals {
  const snap = content.snapshot;
  let smoat = live?.smoat ?? snap.smoat ?? null;
  // 기준 달 매출을 사람이 확인한 값 — 동기화가 늦어 ERP 가 모자랄 때만 쓴다 (ERP 가 따라오면 ERP)
  const confirmed = content.rules.smoat.confirmedRevMonth;
  if (smoat && confirmed && confirmed.month === smoat.baseMonth && smoat.revMonth < confirmed.amount) {
    smoat = { ...smoat, revMonth: confirmed.amount, revMonthErp: smoat.revMonth };
  }
  return {
    smoat,
    finance: live?.finance ?? snap.finance ?? null,
    snapshot: { smoat: !live?.smoat, finance: !live?.finance },
  };
}

export function resolveValues(
  defs: AssumptionDef[],
  eff: EffectiveActuals,
  overrides: Values,
): { values: Values; meta: Record<string, ValueMeta> } {
  const values: Values = {};
  const meta: Record<string, ValueMeta> = {};
  const actuals: DeckActuals = { smoat: eff.smoat ?? undefined, finance: eff.finance ?? undefined };

  const own = (key: string) => Object.prototype.hasOwnProperty.call(overrides, key);
  // 1) 실측이 아닌 가정 — 기준 기간처럼 실측을 고르는 값이 여기서 먼저 정해진다
  for (const d of defs) {
    if (DERIVED[d.key] || ACTUAL_SOURCES[d.key]) continue;
    const overridden = own(d.key);
    values[d.key] = overridden ? overrides[d.key] : d.default;
    meta[d.key] = { base: d.default, origin: "content", asOf: d.asOf, overridden };
  }
  // 2) 실측 — ERP(또는 스냅샷)가 있으면 그 값이 기본값
  for (const d of defs) {
    const src = ACTUAL_SOURCES[d.key];
    if (!src || DERIVED[d.key]) continue;
    let base: AssumptionValue = d.default;
    let origin: ValueOrigin = "content";
    let asOf = d.asOf;
    let note: string | undefined;
    const got = src(actuals, values);
    if (got) {
      base = got.value;
      asOf = got.asOf;
      note = got.note;
      const part = ["revSmoat", "aiCostPerCredit"].includes(d.key) ? "smoat" : "finance";
      origin = eff.snapshot[part] ? "snapshot" : "erp";
    }
    const overridden = own(d.key);
    values[d.key] = overridden ? overrides[d.key] : base;
    meta[d.key] = { base, origin, asOf, overridden, ...(note ? { note } : {}) };
  }
  for (const d of defs) {
    const derive = DERIVED[d.key];
    if (!derive) continue;
    const base = derive(values);
    const overridden = Object.prototype.hasOwnProperty.call(overrides, d.key);
    values[d.key] = overridden ? overrides[d.key] : base;
    meta[d.key] = { base, origin: "derived", overridden };
  }
  return { values, meta };
}

// ---- 계산 결과 ------------------------------------------------

const n = (v: Values, k: string): number => {
  const x = v[k];
  return typeof x === "number" && Number.isFinite(x) ? x : NaN;
};
const nn = (v: Values, k: string): number | null => {
  const x = v[k];
  return typeof x === "number" && Number.isFinite(x) ? x : null;
};
const round = (x: number | null) => (x === null || !Number.isFinite(x) ? null : Math.round(x));
const finite = (x: number) => (Number.isFinite(x) ? x : null);

export function tiersOf(content: DeckContent, v: Values): calc.Tier[] {
  return content.tierNames.map((name, i) => ({
    name,
    price: n(v, `tier${i + 1}Price`),
    credits: n(v, `tier${i + 1}Credits`),
  }));
}

export function buildResults(content: DeckContent, v: Values, eff: EffectiveActuals) {
  // ---- 매장 이전 ----
  const costs = [n(v, "relocCostLow"), n(v, "relocCostMid"), n(v, "relocCostHigh")];
  const gains = [n(v, "relocGainLow"), n(v, "relocGainHigh")];
  const pay = calc.relocPayback(costs, gains);
  const gray = n(v, "revGray");
  const mergedLow = calc.mergedEventRevenue(gray, n(v, "mergeKeepRateLow"));
  const mergedHigh = calc.mergedEventRevenue(gray, n(v, "mergeKeepRateHigh"));
  const reloc = {
    rows: pay.rows,
    min: round(pay.min),
    max: round(pay.max),
    midShort: round(calc.paybackMonths(costs[1], gains[1])),
    midLong: round(calc.paybackMonths(costs[1], gains[0])),
    current: gray,
    mergedLow: finite(mergedLow),
    mergedHigh: finite(mergedHigh),
    lossLow: finite(gray - mergedHigh),
    lossHigh: finite(gray - mergedLow),
    minYears: pay.min === null ? null : pay.min / 12,
    maxYears: pay.max === null ? null : pay.max / 12,
  };

  // ---- 매출 구성과 현금 ----
  const mixRows = content.mix.map((m) => ({ key: m.key, label: m.label, unit: m.unit, amount: n(v, m.key) }));
  const revenue = mixRows.reduce((s, r) => s + (Number.isFinite(r.amount) ? r.amount : 0), 0);
  const mix = {
    rows: mixRows.map((r) => ({ ...r, share: revenue > 0 ? r.amount / revenue : null })),
    total: revenue,
    cleanTotal: revenue - (Number.isFinite(gray) ? gray : 0),
    unit1Amount: revenue - (Number.isFinite(n(v, "revSmoat")) ? n(v, "revSmoat") : 0),
    gray: mixRows.find((r) => r.key === "revGray")?.amount ?? null,
    grayShare: revenue > 0 ? gray / revenue : null,
    smoatShare: revenue > 0 ? n(v, "revSmoat") / revenue : null,
    unit1Share: revenue > 0 ? (revenue - n(v, "revSmoat")) / revenue : null,
  };
  const vatIn = nn(v, "vatInFinance") ?? 0;
  const cost = n(v, "costMonthly") - vatIn;
  const subsidy = n(v, "subsidyMonthly");
  const cashIn = nn(v, "cashBalance");
  const cash0 = cashIn ?? 0;
  const inc = v.includeSubsidy === true;
  const rwMain = calc.runway({ cash: cash0, cost, revenue, subsidy, includeSubsidy: inc });
  const rwNo = calc.runway({ cash: cash0, cost, revenue, subsidy, includeSubsidy: false });
  const rwWith = calc.runway({ cash: cash0, cost, revenue, subsidy, includeSubsidy: true });
  const gap = cost - revenue;
  // 잔고가 0 이거나 비어 있으면 런웨이는 「0개월」 이 아니라 「잔고 입력 필요」
  const needsBalance = !(cashIn !== null && cashIn > 0);
  const floor1 = (x: number | null) => (x === null ? null : Math.floor(x * 10) / 10);
  const basis = basisMonths(v);
  // 두 기준 기간을 나란히 — ERP 실측으로 B2B 매출·월 지출만 바꾸고 나머지 매출은 같은 가정
  const fin = eff.finance;
  const revB2B = n(v, "revB2B");
  const byBasis = ([6, 12] as const).map((m) => {
    const b2b = fin ? (m === 12 ? fin.b2b.total / 12 : fin.b2b.recentAvg) / 1e4 : null;
    const costM = fin ? (m === 12 ? fin.cost.monthlyAvg12 ?? null : fin.cost.monthlyAvg) : null;
    const c = costM === null ? null : costM / 1e4 - vatIn;
    const rev = b2b === null ? null : revenue - (Number.isFinite(revB2B) ? revB2B : 0) + b2b;
    return {
      months: m,
      selected: m === basis,
      b2b,
      cost: c,
      revenue: rev,
      gap: c === null || rev === null ? null : c - rev,
      from: fin ? (m === 12 ? fin.b2b.from : fin.b2b.recentFrom) : null,
      to: fin?.ledgerEnd ?? null,
    };
  });
  const cash = {
    cost,
    revenue,
    subsidy,
    includeSubsidy: inc,
    subsidyMode: inc ? "포함" : "제외",
    gap,
    gapAfterSubsidy: gap - subsidy,
    subsidyCover: gap > 0 ? subsidy / gap : null,
    balance: cash0,
    needsBalance,
    burn: rwMain.burn,
    months: rwMain.months === null ? null : floor1(rwMain.months),
    surplus: rwMain.surplus,
    monthsNoSubsidy: rwNo.months === null ? null : floor1(rwNo.months),
    monthsWithSubsidy: rwWith.months === null ? null : floor1(rwWith.months),
    burnNoSubsidy: rwNo.burn,
    burnWithSubsidy: rwWith.burn,
    status: rwMain.surplus
      ? "흑자"
      : needsBalance
        ? "잔고 입력 필요"
        : `${(floor1(rwMain.months) ?? 0).toLocaleString("ko-KR")}개월`,
    basis,
    basisLabel: `최근 ${basis}개월`,
    byBasis,
  };

  // ---- 스모트 ----
  const tiers = tiersOf(content, v);
  const params: calc.SmoatParams = {
    vatRate: n(v, "vatRate"),
    pgFeeRate: n(v, "pgFeeRate"),
    aiCostPerCredit: n(v, "aiCostPerCredit"),
    usageRate: n(v, "usageRate"),
    creditsPerQuestion: n(v, "creditsPerQuestion"),
  };
  const econ = tiers.map((t) => calc.tierEconomics(t, params));
  const marginsFull = econ.map((e) => e.marginFull).filter((m): m is number => m !== null);
  const marginsSet = econ.map((e) => e.marginSet).filter((m): m is number => m !== null);
  const sm = eff.smoat;
  const academies = (sm?.academies ?? []).map((a) => ({
    ...a,
    compare: calc.compareAcademy(a, tiers, n(v, "tierHeadroom")),
  }));
  const sim = calc.simulateSubscriptions(
    academies,
    tiers,
    n(v, "tierHeadroom"),
    n(v, "subscribeRate"),
    n(v, "extraConversions"),
    0,
    { skipIfCostUpOverPct: nn(v, "skipIfCostUpOver"), profits: econ.map((e) => e.profitSet) },
  );
  const cum = calc.churnCumulative(sim.monthly, n(v, "monthlyChurn"), 12);
  // 학원당 공헌이익은 지금 결제 학원 전체의 요금제 구성으로 가중평균한다 (뺀 학원 포함)
  const avgContrib = calc.weightedContribution(
    sim.counts,
    econ.map((e) => e.profitSet),
  );
  // 지금 결제 학원들의 월 지출 합 — 구독 매출의 주 비교선
  const spendNow = academies.reduce((s2, a) => s2 + a.monthlySpend, 0);
  // 이익률 두 가지 — 유료 사용분 기준(기준 달) · 무료 포함 실제(AI 원가 기간 전체)
  const freeIncl = (() => {
    if (!sm) return null;
    const inWin = sm.months.filter((m) => m.month >= sm.aiCost.from && m.month <= sm.aiCost.to);
    // 기준 달은 revMonth(사용자 확인 값일 수 있다), 나머지 달은 학원 결제 + 이름 없는 입금
    const payments = inWin.reduce((t, m) => t + (m.month === sm.baseMonth ? sm.revMonth : m.academies + m.unnamed), 0);
    const margin = calc.marginInclFree(payments, sm.aiCost.krw, n(v, "vatRate"));
    return {
      from: sm.aiCost.from,
      to: sm.aiCost.to,
      payments,
      supply: payments / (1 + n(v, "vatRate") / 100),
      aiCost: sm.aiCost.krw,
      margin,
    };
  })();
  const fixedWon = n(v, "smoatFixedCost") * 1e4;
  const commonMonthly = nn(v, "commonCostMonthly") ?? 0;
  const commonShareAmt = commonMonthly * ((nn(v, "commonCostShareSmoat") ?? 0) / 100);
  const be = calc.breakevenAcademies(fixedWon, commonShareAmt * 1e4, avgContrib);
  const beCeil = be === null ? null : Math.ceil(be);
  const payingNow = sm?.totals.academies ?? 0;
  const packs = content.rules.smoat.creditTable.map((p) => ({
    ...p,
    perCredit: p.credits > 0 ? p.price / p.credits : null,
    perQuestion: p.credits > 0 ? (p.price / p.credits) * n(v, "creditsPerQuestion") : null,
  }));
  const packPer = packs.map((p) => p.perCredit).filter((x): x is number => x !== null);
  const packMix = sm?.packMix ?? [];
  const payCount = packMix.reduce((s, p) => s + p.count, 0);
  const smallest = packMix[0];
  const tierPer = econ.map((e) => e.perCredit).filter((x): x is number => x !== null);
  const smoat = {
    tiers: econ,
    marginFullMin: marginsFull.length ? Math.min(...marginsFull) : null,
    marginFullMax: marginsFull.length ? Math.max(...marginsFull) : null,
    marginSetMin: marginsSet.length ? Math.min(...marginsSet) : null,
    marginSetMax: marginsSet.length ? Math.max(...marginsSet) : null,
    academies,
    bands: calc.creditBands(sm?.academies ?? [], content.creditBands),
    sim: {
      ...sim,
      cumulative: cum.series,
      cumulativeTotal: cum.total,
      avgMonthly: sm?.avgMonthly ?? null,
      avgFrom: sm?.avgFrom ?? null,
      peak: sm?.peak ?? null,
      vsAvg: sm && sm.avgMonthly > 0 ? sim.monthly / sm.avgMonthly : null,
      vsPeak: sm && sm.peak.amount > 0 ? sim.monthly / sm.peak.amount : null,
    },
    extraRevenue: sim.extra,
    avgContrib,
    /** 구독으로 옮긴 매출 비교 — 주 비교선은 지금 결제 학원들의 월 지출 합 */
    sub: {
      spendNow,
      /** 같은 학원이 모두 추천 요금제로 구독할 때 */
      allBase: sim.base,
      allChange: spendNow > 0 ? sim.base / spendNow - 1 : null,
      /** 줄어드는 비율 (양수) */
      allDrop: spendNow > 0 ? 1 - sim.base / spendNow : null,
      /** 비용이 늘어 구독하지 않는다고 본 학원 */
      skipped: sim.skipped,
      keptBase: sim.keptBase,
      existing: sim.existing,
      extra: sim.extra,
      monthly: sim.monthly,
      monthlyChange: spendNow > 0 ? sim.monthly / spendNow - 1 : null,
      subscribers: sim.subscribers,
      /** 구독 학원 월 공헌이익 (원) */
      contribution: sim.contribution,
      cumulativeTotal: cum.total,
      spendNow12: spendNow * 12,
    },
    /** 이익률 두 가지 */
    margins: {
      paid: sm ? calc.paidMargin(sm.revMonth, sm.baseAiKrw) : null,
      paidMonth: sm?.baseMonth ?? null,
      free: freeIncl?.margin ?? null,
      freeFrom: freeIncl?.from ?? null,
      freeTo: freeIncl?.to ?? null,
      freePayments: freeIncl?.payments ?? null,
      freeSupply: freeIncl?.supply ?? null,
      freeAiCost: freeIncl?.aiCost ?? null,
      freeShare: sm?.aiCost.freeShare ?? null,
    },
    breakeven: {
      fixed: n(v, "smoatFixedCost"),
      commonMonthly,
      commonShare: commonShareAmt,
      total: n(v, "smoatFixedCost") + commonShareAmt,
      academies: beCeil,
      exact: be,
      /** 지금 결제 학원 → 손익분기 진행 */
      now: payingNow,
      progress: calc.progress(payingNow, beCeil),
      /** 필요한 가입 학원 = 손익분기 ÷ 무료 → 유료 전환율 */
      signups: (() => {
        const x = calc.signupsNeeded(beCeil, n(v, "freeToPaidRate"));
        return x === null ? null : Math.ceil(x);
      })(),
      signupsNow: nn(v, "smoatSignups"),
    },
    prepay: econ.map((e) => ({ name: e.name, ...calc.prepay(e.price, n(v, "semesterFreeMonths"), n(v, "annualFreeMonths")) })),
    packs,
    packPerMin: packPer.length ? Math.min(...packPer) : null,
    packPerMax: packPer.length ? Math.max(...packPer) : null,
    packPerQMin: packPer.length ? Math.min(...packPer) * n(v, "creditsPerQuestion") : null,
    packPerQMax: packPer.length ? Math.max(...packPer) * n(v, "creditsPerQuestion") : null,
    tierPerMin: tierPer.length ? Math.min(...tierPer) : null,
    tierPerMax: tierPer.length ? Math.max(...tierPer) : null,
    smallestPackShare: payCount > 0 && smallest ? smallest.count / payCount : null,
    smallestPackPrice: smallest?.price ?? null,
    aiPerQuestion: n(v, "aiCostPerCredit") * n(v, "creditsPerQuestion"),
    repurchaseRate: sm && sm.repurchase.cohort > 0 ? sm.repurchase.repeat / sm.repurchase.cohort : null,
    /** 기준 달 매출에서 AI 원가를 뺀 몫 — 「이익률 77%」 의 근거 */
    baseMargin: sm ? calc.paidMargin(sm.revMonth, sm.baseAiKrw) : null,
    /** 구독하면 덜 내는 학원 · 더 내는 학원 */
    savingCount: academies.filter((a) => a.compare.saving >= 0).length,
    upCount: academies.filter((a) => a.compare.saving < 0).length,
    savingsMin: academies.length ? Math.min(...academies.map((a) => a.compare.savingRate ?? 0)) : null,
    savingsMax: academies.length ? Math.max(...academies.map((a) => a.compare.savingRate ?? 0)) : null,
  };

  // ---- B2B ----
  const contrib = n(v, "b2bContribRate");
  const addKeys = ["addDeals1", "addDeals2", "addDeals3"];
  const fieldLabor = n(v, "b2bFieldLaborRate");
  const b2b = {
    contrib,
    current: {
      deals: n(v, "b2bDealsPerMonth"),
      avg: n(v, "b2bAvgDeal"),
      monthly: n(v, "b2bDealsPerMonth") * n(v, "b2bAvgDeal"),
    },
    hqLabor: nn(v, "b2bHqLaborRate") ?? 0,
    scenarios: addKeys.map((k) => calc.b2bScenario(n(v, k), n(v, "b2bAvgDeal"), contrib)),
    web: addKeys.map((k) => calc.b2bScenario(n(v, k), n(v, "webDealSize"), contrib)),
    target: n(v, "b2bDealsPerMonth") + n(v, "addDeals3"),
    products: content.products.map((p) => {
      const rate = nn(v, p.key);
      const res = rate === null ? null : calc.productProfit(p.startPrice, rate, fieldLabor);
      return { ...p, direct: rate, profit: res?.profit ?? null, profitRate: res?.rate ?? null };
    }),
    projects: eff.finance?.projects ?? [],
    projectsRate: eff.finance?.projectsRate ?? null,
    projectsMin: eff.finance?.projects.length ? Math.min(...eff.finance.projects.map((p) => p.rate)) : null,
    projectsMax: eff.finance?.projects.length ? Math.max(...eff.finance.projects.map((p) => p.rate)) : null,
  };

  // ---- 생카 ----
  const t1 = calc.t1WaiverCost({
    t1Count: n(v, "t1CountPerMonth"),
    shortfallProbPct: n(v, "t1WaiverShortfallProb"),
    avgShortfallPerDay: n(v, "t1AvgShortfall"),
    eventDays: n(v, "eventDays"),
    perkCost: n(v, "t1PerkCost"),
  });
  const funnel = calc.dmFunnel(n(v, "dmPerMonth"), n(v, "replyRate"), n(v, "bookRate"));
  const extGain = calc.externalGain(n(v, "externalNow"), n(v, "externalTarget"), nn(v, "externalEventContrib"));
  const sangka = {
    t1,
    funnel,
    ext: {
      now: n(v, "externalNow"),
      target: n(v, "externalTarget"),
      add: n(v, "externalTarget") - n(v, "externalNow"),
      gain: extGain,
      net: extGain === null ? null : extGain - t1.total,
      internalNow: n(v, "eventsPerMonth") - n(v, "externalNow"),
    },
    minPerEvent: n(v, "minPurchasePerDay") * n(v, "eventDays"),
  };

  // ---- 부족분을 메우는 레버 (월, 만원) ----
  //  부족분은 「지출 − 매출」, 레버는 「공헌이익」 — 성격이 달라 장표에 각주를 단다
  const leverDeals = n(v, "addDeals2");
  const b2bLever = calc.b2bMonthlyLever(leverDeals, n(v, "b2bAvgDeal"), contrib);
  const smoatLever =
    smoat.sub.contribution === null ? null : smoat.sub.contribution / 1e4 - n(v, "smoatFixedCost");
  const wf = calc.gapWaterfall(gap, [
    { key: "b2b", label: "B2B 추가 계약", value: finite(b2bLever) },
    { key: "ext", label: "외부 주최 생카", value: sangka.ext.net },
    { key: "smoat", label: "스모트 구독", value: smoatLever === null ? null : finite(smoatLever) },
    { key: "cut", label: "비용 절감", value: nn(v, "costCutMonthly") ?? 0 },
  ]);
  const levers = {
    gap,
    steps: wf.steps,
    covered: wf.covered,
    remaining: wf.remaining,
    closed: wf.remaining <= 0,
    remainingText: wf.remaining > 0 ? `아직 월 ${Math.round(wf.remaining).toLocaleString("ko-KR")}만원이 남습니다` : "모두 메워집니다",
    b2b: { deals: leverDeals, value: b2bLever },
    ext: sangka.ext.net,
    smoat: smoatLever,
    smoatSubscribers: smoat.sub.subscribers,
    cut: nn(v, "costCutMonthly") ?? 0,
  };

  // ---- 매장 (재계약 판단) ----
  const storeContrib = nn(v, "storeContrib");
  const store = {
    contrib: storeContrib,
    exGray: nn(v, "storeContribExGray"),
    /** 매장 기여이익을 스모트로 벌려면 구독 학원 몇 곳 — 매장 기여이익 ÷ 학원당 공헌이익 */
    vsSmoat: storeContrib !== null && avgContrib !== null && avgContrib > 0 ? (storeContrib * 1e4) / avgContrib : null,
  };

  // ---- 운영 ----
  const ops = {
    approveLow: nn(v, "approveLow"),
    approveHigh: nn(v, "approveHigh"),
    budget1: nn(v, "opportunityBudget1"),
    budget2: nn(v, "opportunityBudget2"),
    commonMonthly,
    smoatCommon: commonShareAmt,
    unit1Common: commonMonthly - commonShareAmt,
    smoatSharePct: nn(v, "commonCostShareSmoat"),
  };

  return {
    reloc,
    mix,
    cash,
    smoat,
    b2b,
    sangka,
    levers,
    store,
    ops,
    /** 실측 원본 — 문구가 기준일·건수를 직접 쓴다 */
    fin: eff.finance,
    sm: eff.smoat,
    snapshot: eff.snapshot,
  };
}

export type Results = ReturnType<typeof buildResults>;

export interface Model {
  v: Values;
  r: Results;
  meta: Record<string, ValueMeta>;
  eff: EffectiveActuals;
}

export function buildModel(content: DeckContent, live: DeckActuals | null | undefined, overrides: Values): Model {
  const eff = effectiveActuals(content, live);
  const { values, meta } = resolveValues(content.assumptions, eff, overrides);
  return { v: values, r: buildResults(content, values, eff), meta, eff };
}

// ---- 장표가 기대는 가정 (칩) ------------------------------------

const TIER_KEYS = [1, 2, 3, 4].flatMap((i) => [`tier${i}Price`, `tier${i}Credits`]);
const ECON_KEYS = ["vatRate", "pgFeeRate", "aiCostPerCredit", "usageRate", "creditsPerQuestion", ...TIER_KEYS];
const REV_KEYS = ["revGray", "revCleanScent", "revB2B", "revSmoat", "revenueBasis"];
const CONTRIB_KEYS = ["b2bContribRate", "b2bDirectCostRate", "b2bFieldLaborRate", "b2bHqLaborRate"];
const SIM_KEYS = [...TIER_KEYS, "tierHeadroom", "subscribeRate", "skipIfCostUpOver", "extraConversions", "monthlyChurn"];
const BE_KEYS = [...ECON_KEYS, "tierHeadroom", "smoatFixedCost", "commonCostShareSmoat", "commonCostMonthly", "revenueBasis"];
const EXT_KEYS = ["externalNow", "externalTarget", "externalEventContrib", "t1CountPerMonth", "t1WaiverShortfallProb", "t1AvgShortfall", "eventDays", "t1PerkCost"];
const CASH_KEYS = [...REV_KEYS, "costMonthly", "vatInFinance", "subsidyMonthly", "cashBalance", "includeSubsidy"];

/** 결과 경로(가장 긴 접두어) → 그 결과가 기대는 가정 */
export const RESULT_DEPS: Record<string, string[]> = {
  "r.reloc": ["relocCostLow", "relocCostMid", "relocCostHigh", "relocGainLow", "relocGainHigh"],
  "r.reloc.current": ["revGray"],
  "r.reloc.merged": ["revGray", "mergeKeepRateLow", "mergeKeepRateHigh"],
  "r.reloc.loss": ["revGray", "mergeKeepRateLow", "mergeKeepRateHigh"],
  "r.mix": REV_KEYS,
  "r.cash": CASH_KEYS,
  "r.cash.byBasis": ["revenueBasis", ...REV_KEYS, "vatInFinance"],
  "r.cash.basis": ["revenueBasis"],
  "r.cash.subsidy": ["subsidyMonthly"],
  "r.cash.cost": ["costMonthly", "vatInFinance", "revenueBasis"],
  "r.smoat.tiers": ECON_KEYS,
  "r.smoat.margin": ECON_KEYS,
  "r.smoat.margins": ["vatRate"],
  "r.smoat.baseMargin": [],
  "r.smoat.academies": [...TIER_KEYS, "tierHeadroom"],
  "r.smoat.savings": [...TIER_KEYS, "tierHeadroom"],
  "r.smoat.bands": [],
  "r.smoat.sim": SIM_KEYS,
  "r.smoat.sub": [...SIM_KEYS, "usageRate", "aiCostPerCredit"],
  "r.smoat.extraRevenue": ["extraConversions", "tier1Price"],
  "r.smoat.avgContrib": [...ECON_KEYS, "tierHeadroom"],
  "r.smoat.breakeven": [...BE_KEYS, "freeToPaidRate", "smoatSignups"],
  "r.smoat.prepay": [...TIER_KEYS, "semesterFreeMonths", "annualFreeMonths"],
  "r.smoat.pack": ["creditsPerQuestion"],
  "r.smoat.tierPer": TIER_KEYS,
  "r.smoat.aiPerQuestion": ["aiCostPerCredit", "creditsPerQuestion"],
  "r.smoat.smallest": [],
  "r.smoat.repurchaseRate": [],
  "r.b2b": CONTRIB_KEYS,
  "r.b2b.current": ["b2bDealsPerMonth", "b2bAvgDeal"],
  "r.b2b.scenarios": ["addDeals1", "addDeals2", "addDeals3", "b2bAvgDeal", ...CONTRIB_KEYS],
  "r.b2b.web": ["addDeals1", "addDeals2", "addDeals3", "webDealSize", ...CONTRIB_KEYS],
  "r.b2b.target": ["b2bDealsPerMonth", "addDeals3"],
  "r.b2b.products": ["prodRate_perfume", "prodRate_photobooth", "prodRate_kiosk", "prodRate_mediaart", "prodRate_space", "b2bFieldLaborRate"],
  "r.b2b.projects": [],
  "r.sangka.t1": ["t1CountPerMonth", "t1WaiverShortfallProb", "t1AvgShortfall", "eventDays", "t1PerkCost"],
  "r.sangka.funnel": ["dmPerMonth", "replyRate", "bookRate"],
  "r.sangka.ext": ["externalNow", "externalTarget", "externalEventContrib", "eventsPerMonth"],
  "r.sangka.ext.net": EXT_KEYS,
  "r.sangka.minPerEvent": ["minPurchasePerDay", "eventDays"],
  "r.levers": ["addDeals2", "b2bAvgDeal", ...CONTRIB_KEYS, ...EXT_KEYS, ...SIM_KEYS, "smoatFixedCost", "costCutMonthly", ...CASH_KEYS],
  "r.levers.b2b": ["addDeals2", "b2bAvgDeal", ...CONTRIB_KEYS],
  "r.levers.ext": EXT_KEYS,
  "r.levers.smoat": [...SIM_KEYS, "usageRate", "aiCostPerCredit", "smoatFixedCost"],
  "r.levers.cut": ["costCutMonthly"],
  "r.levers.gap": CASH_KEYS,
  "r.store": ["storeContrib", "storeContribExGray"],
  "r.store.vsSmoat": ["storeContrib", ...ECON_KEYS, "tierHeadroom"],
  "r.ops": ["approveLow", "approveHigh", "opportunityBudget1", "opportunityBudget2", "commonCostMonthly", "commonCostShareSmoat", "revenueBasis"],
  "r.fin": [],
  "r.sm": [],
  "r.snapshot": [],
};

/** 계산 블록 종류 → 기대는 결과 경로 (칩에 보일 가정) */
export const KIND_DEPS: Record<string, string[]> = {
  engines: ["r.mix"],
  relocTimeline: ["r.reloc"],
  relocPayback: ["r.reloc"],
  revenueMix: ["r.mix"],
  cashWaterfall: ["r.cash"],
  basisCompare: ["r.cash.byBasis"],
  runwayKpi: ["r.cash"],
  smoatMonthly: ["v.revSmoat"],
  freeDonut: [],
  marginPair: ["r.smoat.margins"],
  matrix2x2: ["r.mix"],
  b2bMonthly: ["v.revenueBasis"],
  tierPyramid: [],
  dmFunnel: ["r.sangka.funnel"],
  sangkaT1: ["r.sangka.t1", "r.sangka.ext.net"],
  priceRange: [],
  projectBars: ["v.b2bFieldLaborRate"],
  contribBadge: ["r.b2b"],
  scenarioBars: ["r.b2b.scenarios", "r.b2b.web"],
  leverWaterfall: ["r.levers"],
  scaleCurves: ["r.smoat.margins", "r.smoat.avgContrib"],
  optionBars: [
    "v.optDirectMonthsLow", "v.optDirectMonthsHigh", "v.optAcquireMonthsLow", "v.optAcquireMonthsHigh", "v.optPartnerMonths",
    "v.optDirectCapital", "v.optAcquireCapitalLow", "v.optAcquireCapitalHigh", "v.optPartnerCapital",
  ],
  bandBars: [],
  perQuestionCompare: ["r.smoat.pack", "r.smoat.tierPer"],
  priceLadder: ["r.smoat.tierPer"],
  academyDumbbell: ["r.smoat.academies", "v.skipIfCostUpOver"],
  tierStack: ["r.smoat.tiers"],
  subscriptionCompare: ["r.smoat.sim"],
  churnLine: ["r.smoat.sim"],
  breakevenProgress: ["r.smoat.breakeven"],
  smoatPrepay: ["r.smoat.prepay"],
  commonCostBar: ["r.ops"],
  seasonHeatmap: [],
  decisionFlow: ["r.ops"],
  gantt: [],
  scoreboard: [],
  propertyOverview: [],
  propertyCards: [],
  propertyTable: [],
  academyTable: ["r.smoat.academies"],
  b2bProjects: [],
  smoatTiers: ["r.smoat.tiers"],
  assumptionTable: [],
  sources: [],
  gallery: [],
};

/** 경로 하나가 기대는 가정 키 */
export function depsOfPath(path: string): string[] {
  if (path.startsWith("v.")) return [path.slice(2).split(/[.[]/)[0]];
  const clean = path.replace(/\[\d+\]/g, "");
  let best = "";
  for (const prefix of Object.keys(RESULT_DEPS)) {
    if ((clean === prefix || clean.startsWith(`${prefix}.`) || clean.startsWith(prefix)) && prefix.length > best.length) {
      best = prefix;
    }
  }
  return best ? RESULT_DEPS[best] : [];
}

function blockTexts(b: Block): string[] {
  switch (b.type) {
    case "text":
    case "callout":
      return [b.md, ...(b.type === "callout" && b.label ? [b.label] : [])];
    case "bullets":
      return b.items.flatMap((it) => (typeof it === "string" ? [it] : [it.t, ...(it.sub ?? [])]));
    case "table":
      return [...b.head, ...b.rows.flat(), ...(b.note ? [b.note] : [])];
    case "kpis":
      return b.items.flatMap((it) => [it.label, it.value, ...(it.sub ? [it.sub] : [])]);
    case "cols":
      return b.cols.flat().flatMap(blockTexts);
    case "card":
      return [...(b.title ? [b.title] : []), ...b.blocks.flatMap(blockTexts)];
    case "steps":
    case "stairs":
      return b.items.flatMap((it) => [it.title, ...(it.body ? [it.body] : [])]);
    case "icons":
      return b.items.flatMap((it) => [it.title, ...(it.body ? [it.body] : []), ...(it.tag ? [it.tag] : [])]);
    case "flow":
      return b.rows.flatMap((r) => [r.label, ...r.steps, ...(r.result ? [r.result] : [])]);
    case "computed":
      return computedTexts(b.opts);
    default:
      return [];
  }
}

/** 계산 블록 opts 안의 글자 (이름표·설명) — 자리표시·각주 검사와 칩이 같이 본다 */
function computedTexts(opts: Record<string, unknown> | undefined): string[] {
  const out: string[] = [];
  const walk = (x: unknown) => {
    if (typeof x === "string") out.push(x);
    else if (Array.isArray(x)) x.forEach(walk);
    else if (x && typeof x === "object") Object.values(x).forEach(walk);
  };
  walk(opts);
  return out;
}

function blockKinds(b: Block): string[] {
  if (b.type === "computed") return [b.kind];
  if (b.type === "cols") return b.cols.flat().flatMap(blockKinds);
  if (b.type === "card") return b.blocks.flatMap(blockKinds);
  return [];
}

/** 장표 전체의 글자 — 각주·검사에 쓴다 */
export function slideTexts(s: SlideSpec): string[] {
  return [s.title, ...(s.kicker ? [s.kicker] : []), ...(s.lead ? [s.lead] : []), ...s.blocks.flatMap(blockTexts)];
}

/**
 * 이 장표가 기대는 가정 키 — 칩에 앞에서부터 보인다. 칩 자리가 좁아 순서가 중요하다:
 *   1) 장에 직접 지정한 가정(keys)  2) 문구에 쓰인 가정({{v.…}})
 *   3) 문구의 계산 결과가 기대는 가정  4) 계산 블록이 기대는 가정
 * 같은 층 안에서는 가정 목록 순서.
 */
export function slideDeps(s: SlideSpec, defs: AssumptionDef[]): string[] {
  const known = new Set(defs.map((d) => d.key));
  const order = new Map(defs.map((d, i) => [d.key, i]));
  const texts = slideTexts(s);
  const paths = texts.flatMap(tokenPaths);
  // 계산 블록 opts 에 경로를 그대로 적은 값 (점수판의 현재·목표 등)
  const optPaths = texts.filter((t) => /^[vr]\.[\w.[\]]+$/.test(t));
  const tiers: string[][] = [
    s.keys ?? [],
    [...paths, ...optPaths].filter((p) => p.startsWith("v.")).flatMap(depsOfPath),
    [...paths, ...optPaths].filter((p) => !p.startsWith("v.")).flatMap(depsOfPath),
    s.blocks.flatMap(blockKinds).flatMap((kind) => (KIND_DEPS[kind] ?? []).flatMap(depsOfPath)),
  ];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const tier of tiers) {
    const add = [...new Set(tier)].filter((k) => known.has(k) && !seen.has(k));
    // 계산 값(공헌이익률)이 쓰이면 그 재료도 같은 층에
    if (add.includes("b2bContribRate")) {
      for (const k of ["b2bDirectCostRate", "b2bFieldLaborRate", "b2bHqLaborRate"]) {
        if (known.has(k) && !seen.has(k) && !add.includes(k)) add.push(k);
      }
    }
    add.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
    for (const k of add) {
      seen.add(k);
      out.push(k);
    }
  }
  return out;
}
