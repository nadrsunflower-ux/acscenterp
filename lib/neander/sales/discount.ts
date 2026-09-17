// ============================================================
//  할인 추정 — 「금액 입력 69,300」 같은 줄을 상품 × 수량 − 할인으로 읽는다
// ------------------------------------------------------------
//  검토 대기함의 금액이 어느 상품의 정수배도 아니면 대개 할인이 섞였다.
//  그런데 할인율만으로 역산하면 후보가 너무 많다 (5%씩 10단계 × 상품 27종 ×
//  수량). 그래서 근거를 붙여 순서를 정한다:
//
//    ① 같은 달 네이버 예약 — 네이버는 예약 상품이 찍혀 있어 정가를 알고,
//       할인 행사를 달 단위로 건다. 실측(아이디): 2026-03·04 20% · 05 15% ·
//       06 10% · 07·08 없음. 같은 달 매장 결제도 같은 행사일 가능성이 높다.
//    ② 상품의 쿠폰 할인율 (상품마스터 「할인율」)
//    ③ 같은 이벤트·매장·달에서 이미 확정된 상품
//    ④ 원본 문구의 인원 (네이버 「· 2명」 — 한 사람이 한 병)
//
//  ⚠️ 추천은 **미리 고르지 않는다.** 누르면 입력칸이 채워질 뿐이고, 확정은
//     정가 − 할인 = 결제액이 원 단위로 맞을 때만 된다 (검토 대기함 원칙).
// ============================================================

import { valueAt, type SalesLine, type SalesProduct, type SalesStore } from "./types";

/** 시도해 볼 할인율 — 5% 단위. 행사 할인은 거의 이 단위다 */
const STEP_RATES = [0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5];
const MAX_QTY = 12;

/** 0.1 → "10%" · 0.125 → "12.5%" */
export const rateLabel = (r: number) => `${Number((r * 100).toFixed(1))}%`;

/** 네이버 예약 한 달의 할인 분포 */
export interface NaverTrend {
  month: string;
  /** 정가 그대로 받은 예약 */
  full: number;
  /** 할인율 → 예약 수 (많은 순) */
  rates: { rate: number; count: number }[];
}

const snap = (r: number) => Math.round(r * 200) / 200; // 0.5% 단위

/** 그 날짜의 정가 후보 — 현재 정가 · 그 날짜 정가 (가격 변경 직후 옛 가격 청구가 남는다) */
function listPrices(p: SalesProduct, date: string): number[] {
  return [...new Set([valueAt(p, date).price, p.price].filter((v) => v > 0))];
}

/**
 * 한 네이버 예약 줄의 할인율. 모르면 null.
 *  - 확정된 줄: 정가 × 수량과 비교
 *  - 금액 불일치로 남은 줄: 이 매장 상품 중 5% 단위 할인으로 맞는 가장 작은 할인율
 */
function naverRate(l: SalesLine, byId: Map<string, SalesProduct>, pool: SalesProduct[]): number | null {
  if (l.amount <= 0) return null;
  if (l.status === "resolved" && l.productId) {
    const p = byId.get(l.productId);
    if (!p || !(l.qty > 0)) return null;
    const lists = listPrices(p, l.date).map((v) => v * l.qty);
    if (lists.includes(l.amount)) return 0;
    const r = snap(1 - l.amount / lists[0]);
    return r > 0 && r < 1 ? r : null;
  }
  if (l.status === "needs_review" && l.reason === "price_mismatch") {
    for (const r of STEP_RATES) {
      for (const p of pool) {
        for (const unit of listPrices(p, l.date)) {
          for (let q = 1; q <= 8; q++) if (Math.round(unit * q * (1 - r)) === l.amount) return r;
        }
      }
    }
  }
  return null;
}

/** 매장·달의 네이버 예약 할인 분포. 네이버 예약이 없으면 null */
export function naverTrend(
  lines: SalesLine[],
  products: SalesProduct[],
  store: SalesStore,
  month: string,
): NaverTrend | null {
  const byId = new Map(products.map((p) => [p.id, p]));
  const pool = products.filter((p) => p.store === store);
  let full = 0;
  const m = new Map<number, number>();
  let any = false;
  for (const l of lines) {
    if (l.route !== "naver" || l.store !== store || !l.date.startsWith(month)) continue;
    any = true;
    const r = naverRate(l, byId, pool);
    if (r === null) continue;
    if (r === 0) full += 1;
    else m.set(r, (m.get(r) ?? 0) + 1);
  }
  if (!any) return null;
  return {
    month,
    full,
    rates: [...m.entries()].map(([rate, count]) => ({ rate, count })).sort((a, b) => b.count - a.count),
  };
}

export interface DiscountSuggestion {
  product: SalesProduct;
  qty: number;
  unit: number;
  list: number;
  rate: number;
  /** 할인 뒤 금액 — 결제액과 같다 */
  amount: number;
  /** 같은 달 네이버 예약에서 이 할인율이 쓰인 건수 */
  naverCount: number;
  coupon: boolean;
  /** 같은 범위에서 이 상품으로 확정된 줄 */
  rows: number;
  score: number;
}

/**
 * 결제액을 정가 × 수량 − 할인율로 설명하는 조합들 — 근거 순.
 * 할인 없이 맞는 조합은 넣지 않는다 (그건 기존 후보 카드가 보여준다).
 */
export function suggestDiscounts(args: {
  amount: number;
  date: string;
  pool: SalesProduct[];
  trend: NaverTrend | null;
  /** 상품 id → 같은 범위에서 확정된 줄 수 */
  evidence: Map<string, { rows: number }>;
  /** 원본 문구 — 「· 2명」 이 있으면 그 수량을 앞에 둔다 */
  raw?: string;
  limit?: number;
}): DiscountSuggestion[] {
  const { amount, date, pool, trend, evidence, raw = "", limit = 5 } = args;
  const people = Number(/(\d+)\s*명/.exec(raw)?.[1] ?? 0);
  if (amount <= 0) return [];
  const naverCount = (r: number) => trend?.rates.find((x) => Math.abs(x.rate - r) < 1e-9)?.count ?? 0;
  const out: DiscountSuggestion[] = [];
  for (const p of pool) {
    const rates = new Set([...STEP_RATES, ...(trend?.rates.map((x) => x.rate) ?? [])]);
    if (p.discountRate && p.discountRate > 0 && p.discountRate < 1) rates.add(p.discountRate);
    let best: DiscountSuggestion | null = null;
    for (const unit of listPrices(p, date)) {
      for (let q = 1; q <= MAX_QTY; q++) {
        const list = unit * q;
        if (list <= amount) continue;
        for (const r of rates) {
          if (Math.round(list * (1 - r)) !== amount) continue;
          const n = naverCount(r);
          const coupon = !!p.discountRate && Math.abs(p.discountRate - r) < 1e-9;
          const rows = evidence.get(p.id)?.rows ?? 0;
          // 네이버 같은 달 행사가 가장 강한 근거, 그다음 팔린 상품 · 쿠폰 · 적은 수량
          const score = (n > 0 ? 100 + Math.min(n, 50) : 0) + (rows > 0 ? 20 + Math.min(rows, 20) : 0) + (coupon ? 15 : 0) + (people > 0 && q * Math.max(1, p.bottles) === people ? 30 : 0) - q;
          const s: DiscountSuggestion = { product: p, qty: q, unit, list, rate: r, amount, naverCount: n, coupon, rows, score };
          if (!best || s.score > best.score) best = s;
        }
      }
    }
    if (best) out.push(best);
  }
  return out.sort((a, b) => b.score - a.score || a.qty - b.qty || a.product.id.localeCompare(b.product.id)).slice(0, limit);
}
