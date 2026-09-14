// ============================================================
//  단위경제 집계 — 엑셀 「매출집계 · 와우매장 · 아이디매장 · 온라인 ·
//  통합BEP」 다섯 시트가 하던 계산
// ------------------------------------------------------------
//  변동비를 하나로 뭉치지 않는다. 재료비 · 인건비 · 준비물 · 수수료를
//  각각 들고 다닌다 — 와우의 공헌이익률이 아이디보다 16%p 낮은 이유가
//  인건비와 준비물이라는 사실이 뭉쳐두면 보이지 않는다.
//
//  ⚠️ 해석 못 한 줄(needs_review)은 **이익률 계산에서 아예 뺀다.**
//
//     엑셀은 이 구간을 평균원가율로 메웠다. 그럼 원가가 사실과 다르게
//     잡힌다. 그렇다고 매출에만 넣고 원가를 0 으로 두면 **이익률이
//     부풀려진다** — 그쪽이 더 나쁘다. 두 방법 다 수량과 금액을 서로 다른
//     모집단에서 가져오는 오류이고, 그건 이 이관이 고치려던 바로 그 문제다.
//
//     그래서 숫자를 둘로 나눠 들고 다닌다:
//       revenue          적재된 전부 — POS·장부와 맞춰 볼 금액
//       confirmedRevenue 상품이 정해진 줄만 — 이익률의 분모
//     차액(pendingRevenue)은 화면에 항상 같이 내보낸다. "이 손익은 X원이
//     아직 미확정"이라고 말할 수 있어야 한다.
// ============================================================

import {
  resolveStoreLabor,
  type LaborContext,
  type LaborSource,
  type StoreLabor,
} from "./labor";
import {
  conversionRate,
  eventDays,
  feeRateOf,
  fixedTotal,
  ratio,
  valueAt,
  type SalesAssumptions,
  type SalesEvent,
  type SalesLine,
  type SalesProduct,
  type SalesStore,
} from "./types";

/** 변동비 네 갈래 */
export interface VariableCost {
  /** 직접재료비 */
  material: number;
  /** 접객 인건비 (타임) — laborMode 가 "excel" 일 때만 변동비에 들어간다 */
  serviceLabor: number;
  /** 제작 인건비 (3D프린팅 등) */
  makeLabor: number;
  /** 이벤트 스태프 인건비 */
  eventLabor: number;
  /** 이벤트 준비물 */
  supplies: number;
  /** 결제 수수료 */
  fee: number;
  /** 합계 */
  total: number;
}

const emptyVar = (): VariableCost => ({
  material: 0,
  serviceLabor: 0,
  makeLabor: 0,
  eventLabor: 0,
  supplies: 0,
  fee: 0,
  total: 0,
});

/** 상품 색인 */
export function productIndex(products: SalesProduct[]): Map<string, SalesProduct> {
  return new Map(products.map((p) => [p.id, p]));
}

/** 한 줄의 재료비 — 마스터에서 계산한다 (저장하지 않는다) */
export function lineMaterial(l: SalesLine, idx: Map<string, SalesProduct>): number {
  if (l.status === "manual") return l.manualMaterial ?? 0;
  const p = l.productId ? idx.get(l.productId) : undefined;
  if (!p) return 0; // 해석 못 한 줄 — 추정하지 않는다
  // 재료비도 시간에 따라 바뀐다 — 그 줄의 날짜 기준으로 본다
  return valueAt(p, l.date).material * l.qty;
}

/** 한 줄의 수수료 */
export function lineFee(l: SalesLine, a: SalesAssumptions): number {
  return Math.round(l.amount * feeRateOf(l.route, a.fee, l.payMethod));
}

// ============================================================
//  매장 손익
// ============================================================

export interface StorePnl {
  store: SalesStore;
  /** 줄 수 */
  count: number;
  /** 판매 수량 (해석된 줄만) */
  qty: number;
  /** 적재된 전부 — POS 합계와 맞춰 볼 금액 */
  revenue: number;
  /** 상품이 정해진 줄만 — 이익률의 분모 */
  confirmedRevenue: number;
  /** 아직 상품이 안 정해진 금액 (= revenue − confirmedRevenue) */
  pendingRevenue: number;
  revenueRegular: number;
  revenueEvent: number;
  /** 해석 못 한 줄의 금액·건수 — 이 손익이 얼마나 확정적인지 */
  reviewAmount: number;
  reviewCount: number;
  variable: VariableCost;
  contribution: number;
  contributionRate: number | null;
  /** 배부된 공통 고정비 */
  allocatedFixed: number;
  /** 상시 인건비 — 아이디 전부 · 와우는 실측 달의 이벤트 없는 날 근무 (labor.ts) */
  regularLabor: number;
  /** 인건비의 출처(실측 · 추정)와 내역 — 이벤트 인건비·상시 인건비가 모두 여기서 왔다 */
  labor: StoreLabor;
  fixedTotal: number;
  operating: number;
  operatingRate: number | null;
  /** 손익분기 매출 = 고정비 / 공헌이익률 */
  bep: number | null;
  bepAchieved: number | null;
  /**
   * 접객 인건비 — laborMode "fixed" 에서는 비용이 아니라 참고 숫자다.
   * 상시 인건비 대비 얼마나 실제 접객에 쓰였는지 (가동률).
   */
  serviceLaborRef: number;
  serviceUtilization: number | null;
}

export interface SalesPnl {
  month: string;
  stores: StorePnl[];
  total: {
    revenue: number;
    confirmedRevenue: number;
    pendingRevenue: number;
    variable: VariableCost;
    contribution: number;
    contributionRate: number | null;
    fixedTotal: number;
    operating: number;
    operatingRate: number | null;
    bep: number | null;
    bepAchieved: number | null;
    reviewAmount: number;
    reviewCount: number;
  };
}

/** YYYY-MM 에 속하는가 */
export const inMonth = (date: string, month: string) => !!date && date.startsWith(month);

/** 해당 월에 데이터가 있는 달 목록 (최신순) */
export function availableMonths(lines: SalesLine[], events: SalesEvent[]): string[] {
  const s = new Set<string>();
  lines.forEach((l) => l.date && s.add(l.date.slice(0, 7)));
  events.forEach((e) => e.from && s.add(e.from.slice(0, 7)));
  return [...s].sort().reverse();
}

/**
 * 월 손익. 이벤트 인건비·준비물은 **이벤트 단위**로 한 번만 더한다
 * (줄마다 더하면 이벤트 하나가 판매 건수만큼 중복된다).
 */
export function buildPnl(
  month: string,
  lines: SalesLine[],
  products: SalesProduct[],
  events: SalesEvent[],
  a: SalesAssumptions,
  /** 근무 일지 실측. 없으면 인건비는 전부 가정값 (예전과 같다) */
  labor?: LaborContext,
): SalesPnl {
  const idx = productIndex(products);
  const monthLines = lines.filter((l) => inMonth(l.date, month));
  const monthEvents = events.filter((e) => inMonth(e.from, month));
  const fixedAll = fixedTotal(a);

  const stores: StorePnl[] = (["wow", "id", "online"] as SalesStore[]).map((store) => {
    const ls = monthLines.filter((l) => l.store === store);
    const evs = monthEvents.filter((e) => e.store === store);
    const v = emptyVar();
    // 인건비 출처는 한 곳(labor.ts)에서만 정한다 — 추이·이벤트 실적도 같은 판정을 쓴다
    const L = resolveStoreLabor(month, store, evs, a, labor);

    let revenue = 0;
    let confirmedRevenue = 0;
    let revenueRegular = 0;
    let revenueEvent = 0;
    let reviewAmount = 0;
    let reviewCount = 0;
    let qty = 0;
    let serviceLaborRef = 0;

    ls.forEach((l) => {
      revenue += l.amount;
      if (l.eventId) revenueEvent += l.amount;
      else revenueRegular += l.amount;

      if (l.status === "needs_review") {
        reviewAmount += l.amount;
        reviewCount += 1;
        return;
      }
      // 확정된 줄만 이익률 계산에 들어간다 — 매출도, 원가도 함께
      confirmedRevenue += l.amount;
      v.material += lineMaterial(l, idx);
      v.fee += lineFee(l, a);
      qty += l.qty;
      const p = l.productId ? idx.get(l.productId) : undefined;
      if (!p) return;
      // 접객 인건비는 늘 계산해 둔다. 변동비에 넣을지는 laborMode 가 정한다.
      const service = (p.timeMin / 60) * l.qty * a.wage.idRegular;
      serviceLaborRef += service;
      // 실측 달에는 넣지 않는다 — 실제 근무에 접객 시간이 이미 들어 있어 두 번 세게 된다
      if (a.laborMode === "excel" && L.source === "assumed") v.serviceLabor += service;
      v.makeLabor += (p.makeMin / 60) * l.qty * a.wage.puddi;
    });

    // 이벤트 인건비·준비물 — 이벤트당 한 번
    // 이벤트 인건비는 실측이면 그날 근무를 이벤트에 나눈 몫, 아니면 가정값
    v.eventLabor = L.eventLaborTotal;
    evs.forEach((e) => {
      v.supplies += e.supplies;
    });

    v.total =
      v.material + v.serviceLabor + v.makeLabor + v.eventLabor + v.supplies + v.fee;

    // 이벤트 인건비·준비물은 기간 비용이라 판매 확정 여부와 무관하게 전액
    const contribution = confirmedRevenue - v.total;
    const allocatedFixed = Math.round(fixedAll * (a.allocation[store] ?? 0));
    // 상시 인건비 — 추정이면 아이디만(가정), 실측이면 아이디 전부 + 와우 이벤트 없는 날
    const regularLabor = L.regularLabor;
    const fixed = allocatedFixed + regularLabor;
    const rate = ratio(contribution, confirmedRevenue);

    return {
      store,
      count: ls.length,
      qty,
      revenue,
      confirmedRevenue,
      pendingRevenue: revenue - confirmedRevenue,
      revenueRegular,
      revenueEvent,
      reviewAmount,
      reviewCount,
      variable: v,
      contribution,
      contributionRate: rate,
      allocatedFixed,
      regularLabor,
      fixedTotal: fixed,
      operating: contribution - fixed,
      operatingRate: ratio(contribution - fixed, confirmedRevenue),
      bep: rate && rate > 0 ? Math.round(fixed / rate) : null,
      bepAchieved:
        rate && rate > 0 && fixed > 0 ? confirmedRevenue / (fixed / rate) : null,
      serviceLaborRef,
      serviceUtilization: regularLabor ? serviceLaborRef / regularLabor : null,
      labor: L,
    };
  });

  const sum = <K extends keyof VariableCost>(k: K) =>
    stores.reduce((s, x) => s + x.variable[k], 0);
  const variable: VariableCost = {
    material: sum("material"),
    serviceLabor: sum("serviceLabor"),
    makeLabor: sum("makeLabor"),
    eventLabor: sum("eventLabor"),
    supplies: sum("supplies"),
    fee: sum("fee"),
    total: sum("total"),
  };
  const revenue = stores.reduce((s, x) => s + x.revenue, 0);
  const confirmedRevenue = stores.reduce((s, x) => s + x.confirmedRevenue, 0);
  const contribution = confirmedRevenue - variable.total;
  const fixed = stores.reduce((s, x) => s + x.fixedTotal, 0);
  const rate = ratio(contribution, confirmedRevenue);

  return {
    month,
    stores,
    total: {
      revenue,
      confirmedRevenue,
      pendingRevenue: revenue - confirmedRevenue,
      variable,
      contribution,
      contributionRate: rate,
      fixedTotal: fixed,
      operating: contribution - fixed,
      operatingRate: ratio(contribution - fixed, confirmedRevenue),
      bep: rate && rate > 0 ? Math.round(fixed / rate) : null,
      bepAchieved:
        rate && rate > 0 && fixed > 0 ? confirmedRevenue / (fixed / rate) : null,
      reviewAmount: stores.reduce((s, x) => s + x.reviewAmount, 0),
      reviewCount: stores.reduce((s, x) => s + x.reviewCount, 0),
    },
  };
}

// ============================================================
//  월별 추이
// ============================================================

/** 월별 추이 한 점 — 매장별로 나눠 들고 다닌다 */
export interface SalesMonthPoint {
  month: string;
  byStore: Record<
    SalesStore,
    {
      revenue: number;
      confirmedRevenue: number;
      contribution: number;
      operating: number;
    }
  >;
  total: {
    revenue: number;
    confirmedRevenue: number;
    contribution: number;
    operating: number;
  };
}

/** 추이 차트가 고를 수 있는 지표 */
export type TrendMetric = "revenue" | "contribution" | "operating";

export const TREND_METRICS: { value: TrendMetric; label: string; hint: string }[] = [
  { value: "revenue", label: "매출", hint: "적재된 전부" },
  { value: "contribution", label: "공헌이익", hint: "확정 매출 기준" },
  { value: "operating", label: "영업이익", hint: "고정비 차감 후" },
];

/**
 * 데이터가 있는 모든 달의 손익 — 오래된 달부터.
 *
 * 달마다 buildPnl 을 다시 부르는 이유는 고정비·배부가 월 단위 개념이라
 * 한 번에 합칠 수 없기 때문이다. 달 수가 많지 않아 비용도 문제되지 않는다.
 */
export function monthlyTrend(
  lines: SalesLine[],
  products: SalesProduct[],
  events: SalesEvent[],
  a: SalesAssumptions,
  labor?: LaborContext,
): SalesMonthPoint[] {
  const months = availableMonths(lines, events).slice().reverse();
  return months.map((month) => {
    const pnl = buildPnl(month, lines, products, events, a, labor);
    const byStore = {} as SalesMonthPoint["byStore"];
    pnl.stores.forEach((s) => {
      byStore[s.store] = {
        revenue: s.revenue,
        confirmedRevenue: s.confirmedRevenue,
        contribution: s.contribution,
        operating: s.operating,
      };
    });
    return {
      month,
      byStore,
      total: {
        revenue: pnl.total.revenue,
        confirmedRevenue: pnl.total.confirmedRevenue,
        contribution: pnl.total.contribution,
        operating: pnl.total.operating,
      },
    };
  });
}

// ============================================================
//  상품별 실적
// ============================================================

export interface ProductPerf {
  product: SalesProduct;
  qty: number;
  revenue: number;
  material: number;
  /** 인건비 (접객 + 제작) — 참고값. 변동비 포함 여부는 laborMode */
  labor: number;
  fee: number;
  variable: number;
  contribution: number;
  contributionRate: number | null;
  /** 1개당 공헌이익 — 무엇을 더 팔아야 하는지의 기준 */
  unitContribution: number;
}

/**
 * 상품별 집계. 수량과 금액이 **같은 모집단**에서 나온다.
 *
 * ⚠️ 엑셀 「아이디 상품별 상세」는 10ml 줄의 수량을 223건(현장 41 +
 *    네이버 182)으로 쓰면서 금액은 네이버분 4,368,000원(= 182 × 24,000)
 *    만 넣었다. 한 줄이 두 기준으로 말한 것이다. 여기서는 그럴 수 없다.
 */
export function buildProductPerf(
  month: string,
  lines: SalesLine[],
  products: SalesProduct[],
  a: SalesAssumptions,
  filter?: { store?: SalesStore },
): ProductPerf[] {
  const idx = productIndex(products);
  const acc = new Map<string, ProductPerf>();

  lines
    .filter(
      (l) =>
        inMonth(l.date, month) &&
        l.status === "resolved" &&
        l.productId &&
        (!filter?.store || l.store === filter.store),
    )
    .forEach((l) => {
      const p = idx.get(l.productId!);
      if (!p) return;
      const cur =
        acc.get(p.id) ??
        ({
          product: p,
          qty: 0,
          revenue: 0,
          material: 0,
          labor: 0,
          fee: 0,
          variable: 0,
          contribution: 0,
          contributionRate: null,
          unitContribution: 0,
        } satisfies ProductPerf);

      cur.qty += l.qty;
      cur.revenue += l.amount;
      cur.material += valueAt(p, l.date).material * l.qty;
      cur.labor +=
        (p.timeMin / 60) * l.qty * a.wage.idRegular +
        (p.makeMin / 60) * l.qty * a.wage.puddi;
      cur.fee += lineFee(l, a);
      acc.set(p.id, cur);
    });

  return [...acc.values()]
    .map((x) => {
      // 변동비에 접객 인건비를 넣을지는 laborMode 를 따른다
      const labor =
        a.laborMode === "excel"
          ? x.labor
          : (x.product.makeMin / 60) * x.qty * a.wage.puddi;
      const variable = x.material + labor + x.fee;
      const contribution = x.revenue - variable;
      return {
        ...x,
        variable,
        contribution,
        contributionRate: ratio(contribution, x.revenue),
        unitContribution: x.qty ? Math.round(contribution / x.qty) : 0,
      };
    })
    .sort((a2, b) => b.contribution - a2.contribution);
}

/**
 * 상품 1개의 수익성 — 판매 실적과 무관한 "구조" 비교.
 * 엑셀 「매출시뮬레이션 › 상품별 수익성 비교」에 해당한다.
 */
export interface ProductEconomics {
  product: SalesProduct;
  price: number;
  material: number;
  labor: number;
  fee: number;
  variable: number;
  contribution: number;
  contributionRate: number | null;
}

export function productEconomics(
  products: SalesProduct[],
  a: SalesAssumptions,
): ProductEconomics[] {
  return products
    .map((p) => {
      // 세트·네이버 전용 상품은 네이버 수수료, 나머지는 카드 수수료
      const route = p.bottles > 1 ? "naver" : p.store === "online" ? "online" : "payhere";
      const labor =
        (a.laborMode === "excel" ? (p.timeMin / 60) * a.wage.idRegular : 0) +
        (p.makeMin / 60) * a.wage.puddi;
      const fee = Math.round(p.price * feeRateOf(route, a.fee));
      const variable = p.material + labor + fee;
      const contribution = p.price - variable;
      return {
        product: p,
        price: p.price,
        material: p.material,
        labor,
        fee,
        variable,
        contribution,
        contributionRate: ratio(contribution, p.price),
      };
    })
    .sort((x, y) => (y.contributionRate ?? 0) - (x.contributionRate ?? 0));
}

// ============================================================
//  이벤트별 실적
// ============================================================

export interface EventPerf {
  event: SalesEvent;
  days: number;
  /** 적재된 전부 */
  revenue: number;
  /** 상품이 정해진 줄만 — 이익률의 분모 */
  confirmedRevenue: number;
  pendingRevenue: number;
  /** 해석된 줄의 수량 */
  qty: number;
  material: number;
  /** 제작 인건비 + 이벤트 인건비(실측이면 그날 근무를 나눈 몫) */
  labor: number;
  /** 이벤트 인건비의 출처 */
  laborSource: LaborSource;
  supplies: number;
  fee: number;
  variable: number;
  contribution: number;
  contributionRate: number | null;
  /** 일당 공헌이익 — 이벤트를 며칠 열지 판단하는 기준 */
  contributionPerDay: number;
  conversion: number | null;
  reviewAmount: number;
  reviewCount: number;
}

export function buildEventPerf(
  month: string,
  lines: SalesLine[],
  products: SalesProduct[],
  events: SalesEvent[],
  a: SalesAssumptions,
  labor?: LaborContext,
): EventPerf[] {
  const idx = productIndex(products);
  const monthLines = lines.filter((l) => inMonth(l.date, month));
  // 매장마다 한 번 판정 — buildPnl 과 같은 이벤트 모음(이 달 시작)을 넘겨야 몫이 같다
  const monthEvents = events.filter((e) => inMonth(e.from, month));
  const laborByStore = new Map<SalesStore, StoreLabor>();
  const laborOf = (store: SalesStore) => {
    let L = laborByStore.get(store);
    if (!L) {
      L = resolveStoreLabor(month, store, monthEvents.filter((e) => e.store === store), a, labor);
      laborByStore.set(store, L);
    }
    return L;
  };

  return events
    .filter((e) => inMonth(e.from, month))
    .map((e) => {
      const ls = monthLines.filter((l) => l.eventId === e.id);
      let revenue = 0;
      let confirmedRevenue = 0;
      let material = 0;
      let fee = 0;
      let qty = 0;
      let reviewAmount = 0;
      let reviewCount = 0;
      let makeLabor = 0;

      ls.forEach((l) => {
        revenue += l.amount;
        if (l.status === "needs_review") {
          reviewAmount += l.amount;
          reviewCount += 1;
          return;
        }
        confirmedRevenue += l.amount;
        material += lineMaterial(l, idx);
        fee += lineFee(l, a);
        qty += l.qty;
        const p = l.productId ? idx.get(l.productId) : undefined;
        if (p) makeLabor += (p.makeMin / 60) * l.qty * a.wage.puddi;
      });

      const L = laborOf(e.store);
      const labor = (L.eventLabor[e.id] ?? 0) + makeLabor;
      const variable = material + labor + e.supplies + fee;
      // 확정 매출 기준 — 미확정을 매출에만 넣으면 이익률이 부풀려진다
      const contribution = confirmedRevenue - variable;
      const days = eventDays(e);

      return {
        event: e,
        days,
        revenue,
        confirmedRevenue,
        pendingRevenue: revenue - confirmedRevenue,
        qty,
        material,
        labor,
        laborSource: L.source,
        supplies: e.supplies,
        fee,
        variable,
        contribution,
        contributionRate: ratio(contribution, confirmedRevenue),
        contributionPerDay: days ? Math.round(contribution / days) : 0,
        conversion: conversionRate(e),
        reviewAmount,
        reviewCount,
      };
    })
    .sort((x, y) => (x.event.from < y.event.from ? 1 : -1));
}

// ============================================================
//  장부 대사
// ============================================================

export interface ReconcileRow {
  store: SalesStore;
  /** 이 모듈이 적재한 판매 합계 (POS·예약 원본 기준) */
  posTotal: number;
  /** 결제 수수료 — 정산 입금은 이만큼 적게 들어온다 */
  fee: number;
  /** 수수료를 뺀 예상 입금액 */
  expectedDeposit: number;
}

/**
 * POS 합계와 예상 입금액. 실제 장부 입금액은 재무 모듈이 들고 있으므로,
 * 화면에서 두 숫자를 나란히 놓는다 — 차이 = 미정산 + 수수료 오차.
 *
 * ⚠️ 이 함수는 장부를 고치지 않는다. 매출을 두 번 잡지 않으려면 이 모듈은
 *    **대사만** 해야 한다 (adapters/pos.ts 주석).
 */
export function buildReconcile(
  month: string,
  lines: SalesLine[],
  a: SalesAssumptions,
): ReconcileRow[] {
  return (["wow", "id", "online"] as SalesStore[]).map((store) => {
    const ls = lines.filter((l) => inMonth(l.date, month) && l.store === store);
    const posTotal = ls.reduce((s, l) => s + l.amount, 0);
    const fee = ls.reduce((s, l) => s + lineFee(l, a), 0);
    return { store, posTotal, fee, expectedDeposit: posTotal - fee };
  });
}
