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
}

// ---- 실측 → 가정값 ------------------------------------------

const r0 = (n: number) => Math.round(n);
const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;

/** ERP 에서 자동 계산되는 가정 — 키마다 실측의 어느 값을 어떤 단위로 쓰는가 */
const ACTUAL_SOURCES: Record<string, (a: DeckActuals) => { value: number; asOf: string } | null> = {
  revB2B: ({ finance: f }) => (f ? { value: r0(f.b2b.recentAvg / 1e4), asOf: f.asOf } : null),
  b2bDealsPerMonth: ({ finance: f }) => (f ? { value: r1(f.b2b.dealsPerMonth), asOf: f.asOf } : null),
  b2bAvgDeal: ({ finance: f }) => (f ? { value: r0(f.b2b.perClient / 1e4), asOf: f.asOf } : null),
  b2bDirectCostRate: ({ finance: f }) =>
    f && f.projects.length ? { value: r1(f.projectsRate * 100), asOf: f.asOf } : null,
  subsidyMonthly: ({ finance: f }) => (f ? { value: r0(f.subsidy.monthlyAvg / 1e4), asOf: f.asOf } : null),
  costMonthly: ({ finance: f }) => (f ? { value: r0(f.cost.monthlyAvg / 1e4), asOf: f.asOf } : null),
  commonCostMonthly: ({ finance: f }) => (f ? { value: r0(f.cost.commonMonthlyAvg / 1e4), asOf: f.asOf } : null),
  revSmoat: ({ smoat: s }) => (s ? { value: r1(s.revMonth / 1e4), asOf: s.asOf } : null),
  aiCostPerCredit: ({ smoat: s }) => (s && s.aiCost.creditsUsed > 0 ? { value: r2(s.aiCost.perCredit), asOf: s.asOf } : null),
};

export const ERP_KEYS = Object.keys(ACTUAL_SOURCES);

/** 계산 값 — 덮어쓰지 않았으면 이렇게 따라 나온다 */
const DERIVED: Record<string, (v: Values) => AssumptionValue> = {
  b2bContribRate: (v) => {
    const d = v.b2bDirectCostRate;
    const f = v.b2bFieldLaborRate;
    return typeof d === "number" && typeof f === "number" ? r1(calc.b2bContribRate(d, f)) : null;
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
  return {
    smoat: live?.smoat ?? snap.smoat ?? null,
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

  for (const d of defs) {
    if (DERIVED[d.key]) continue;
    let base: AssumptionValue = d.default;
    let origin: ValueOrigin = "content";
    let asOf = d.asOf;
    const src = ACTUAL_SOURCES[d.key];
    const got = src ? src(actuals) : null;
    if (got) {
      base = got.value;
      asOf = got.asOf;
      const part = ["revSmoat", "aiCostPerCredit"].includes(d.key) ? "smoat" : "finance";
      origin = eff.snapshot[part] ? "snapshot" : "erp";
    }
    const overridden = Object.prototype.hasOwnProperty.call(overrides, d.key);
    values[d.key] = overridden ? overrides[d.key] : base;
    meta[d.key] = { base, origin, asOf, overridden };
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
  const cost = n(v, "costMonthly") - (nn(v, "vatInFinance") ?? 0);
  const subsidy = n(v, "subsidyMonthly");
  const cashIn = nn(v, "cashBalance") ?? 0;
  const inc = v.includeSubsidy === true;
  const rwMain = calc.runway({ cash: cashIn, cost, revenue, subsidy, includeSubsidy: inc });
  const rwNo = calc.runway({ cash: cashIn, cost, revenue, subsidy, includeSubsidy: false });
  const rwWith = calc.runway({ cash: cashIn, cost, revenue, subsidy, includeSubsidy: true });
  const gap = cost - revenue;
  const cash = {
    cost,
    revenue,
    subsidy,
    includeSubsidy: inc,
    subsidyMode: inc ? "포함" : "제외",
    gap,
    gapAfterSubsidy: gap - subsidy,
    subsidyCover: gap > 0 ? subsidy / gap : null,
    balance: cashIn,
    burn: rwMain.burn,
    months: rwMain.months === null ? null : Math.floor(rwMain.months * 10) / 10,
    surplus: rwMain.surplus,
    monthsNoSubsidy: rwNo.months === null ? null : Math.floor(rwNo.months * 10) / 10,
    monthsWithSubsidy: rwWith.months === null ? null : Math.floor(rwWith.months * 10) / 10,
    burnNoSubsidy: rwNo.burn,
    burnWithSubsidy: rwWith.burn,
    status: rwMain.surplus ? "흑자" : `${(Math.floor((rwMain.months ?? 0) * 10) / 10).toLocaleString("ko-KR")}개월`,
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
  );
  const cum = calc.churnCumulative(sim.monthly, n(v, "monthlyChurn"), 12);
  const avgContrib = calc.weightedContribution(
    sim.counts,
    econ.map((e) => e.profitSet),
  );
  const fixedWon = n(v, "smoatFixedCost") * 1e4;
  const commonMonthly = nn(v, "commonCostMonthly") ?? 0;
  const commonShareAmt = commonMonthly * ((nn(v, "commonCostShareSmoat") ?? 0) / 100);
  const be = calc.breakevenAcademies(fixedWon, commonShareAmt * 1e4, avgContrib);
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
    breakeven: {
      fixed: n(v, "smoatFixedCost"),
      commonMonthly,
      commonShare: commonShareAmt,
      total: n(v, "smoatFixedCost") + commonShareAmt,
      academies: be === null ? null : Math.ceil(be),
      exact: be,
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
    baseMargin: sm && sm.baseAiKrw !== null && sm.revMonth > 0 ? (sm.revMonth - sm.baseAiKrw) / sm.revMonth : null,
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
const REV_KEYS = ["revGray", "revCleanScent", "revB2B", "revSmoat"];
const CONTRIB_KEYS = ["b2bContribRate", "b2bDirectCostRate", "b2bFieldLaborRate"];

/** 결과 경로(가장 긴 접두어) → 그 결과가 기대는 가정 */
export const RESULT_DEPS: Record<string, string[]> = {
  "r.reloc": ["relocCostLow", "relocCostMid", "relocCostHigh", "relocGainLow", "relocGainHigh"],
  "r.reloc.current": ["revGray"],
  "r.reloc.merged": ["revGray", "mergeKeepRateLow", "mergeKeepRateHigh"],
  "r.reloc.loss": ["revGray", "mergeKeepRateLow", "mergeKeepRateHigh"],
  "r.mix": REV_KEYS,
  "r.cash": [...REV_KEYS, "costMonthly", "vatInFinance", "subsidyMonthly", "cashBalance", "includeSubsidy"],
  "r.cash.subsidy": ["subsidyMonthly"],
  "r.cash.cost": ["costMonthly", "vatInFinance"],
  "r.smoat.tiers": ECON_KEYS,
  "r.smoat.margin": ECON_KEYS,
  "r.smoat.academies": [...TIER_KEYS, "tierHeadroom"],
  "r.smoat.savings": [...TIER_KEYS, "tierHeadroom"],
  "r.smoat.bands": [],
  "r.smoat.sim": [...TIER_KEYS, "tierHeadroom", "subscribeRate", "extraConversions", "monthlyChurn"],
  "r.smoat.extraRevenue": ["extraConversions", "tier1Price"],
  "r.smoat.avgContrib": [...ECON_KEYS, "tierHeadroom"],
  "r.smoat.breakeven": [...ECON_KEYS, "tierHeadroom", "smoatFixedCost", "commonCostShareSmoat", "commonCostMonthly"],
  "r.smoat.prepay": [...TIER_KEYS, "semesterFreeMonths", "annualFreeMonths"],
  "r.smoat.pack": ["creditsPerQuestion"],
  "r.smoat.tierPer": TIER_KEYS,
  "r.smoat.aiPerQuestion": ["aiCostPerCredit", "creditsPerQuestion"],
  "r.smoat.smallest": [],
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
  "r.sangka.ext.net": ["externalNow", "externalTarget", "externalEventContrib", "t1CountPerMonth", "t1WaiverShortfallProb", "t1AvgShortfall", "eventDays", "t1PerkCost"],
  "r.sangka.minPerEvent": ["minPurchasePerDay", "eventDays"],
  "r.ops": ["approveLow", "approveHigh", "opportunityBudget1", "opportunityBudget2", "commonCostMonthly", "commonCostShareSmoat"],
  "r.fin": [],
  "r.sm": [],
  "r.snapshot": [],
};

/** 계산 블록 종류 → 기대는 결과 경로 */
export const KIND_DEPS: Record<string, string[]> = {
  relocPayback: ["r.reloc"],
  relocSummary: ["r.reloc", "r.reloc.merged", "r.reloc.loss"],
  revenueMix: ["r.mix", "r.cash"],
  runway: ["r.cash"],
  smoatMonthly: [],
  smoatTiers: ["r.smoat.tiers"],
  smoatBands: ["r.smoat.bands"],
  academyCompare: ["r.smoat.academies"],
  academyTable: ["r.smoat.academies"],
  smoatSimulation: ["r.smoat.sim"],
  smoatBreakeven: ["r.smoat.breakeven"],
  smoatPrepay: ["r.smoat.prepay"],
  b2bScenarios: ["r.b2b.scenarios", "r.b2b.web"],
  b2bProducts: ["r.b2b.products"],
  b2bProjects: ["r.b2b.projects"],
  sangkaT1: ["r.sangka.t1", "r.sangka.ext", "r.sangka.ext.net"],
  sangkaFunnel: ["r.sangka.funnel"],
  approval: ["r.ops"],
  commonCost: ["r.ops"],
  propertyRegion: [],
  propertyTable: [],
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
      return b.items.flatMap((it) => [it.title, ...(it.body ? [it.body] : [])]);
    default:
      return [];
  }
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
  const paths = slideTexts(s).flatMap(tokenPaths);
  const tiers: string[][] = [
    s.keys ?? [],
    paths.filter((p) => p.startsWith("v.")).flatMap(depsOfPath),
    paths.filter((p) => !p.startsWith("v.")).flatMap(depsOfPath),
    s.blocks.flatMap(blockKinds).flatMap((kind) => (KIND_DEPS[kind] ?? []).flatMap(depsOfPath)),
  ];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const tier of tiers) {
    const add = [...new Set(tier)].filter((k) => known.has(k) && !seen.has(k));
    // 계산 값(공헌이익률)이 쓰이면 그 재료도 같은 층에
    if (add.includes("b2bContribRate")) {
      for (const k of ["b2bDirectCostRate", "b2bFieldLaborRate"]) if (!seen.has(k) && !add.includes(k)) add.push(k);
    }
    add.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
    for (const k of add) {
      seen.add(k);
      out.push(k);
    }
  }
  return out;
}
