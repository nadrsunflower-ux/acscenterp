// ============================================================
//  상품 해석기 — 결제 내역 문자열을 상품으로 읽는다
// ------------------------------------------------------------
//  이 모듈이 이관에서 유일하게 "새로 쓰는" 계산이다. 나머지(파서·집계·
//  배분·검토 대기함)는 재무 모듈에 이미 있다.
//
//  엑셀은 상품을 **금액으로 역산**했다 — 24,000=10ml, 38,000=50ml,
//  53,000=50ml+사쉐, 7,200/14,400/21,600=쿠폰 오적용. 원본에 상품명이
//  찍혀 있는데 금액으로 되짚을 이유가 없고, 할인·세트·쿠폰이 겹치면
//  조합이 무너진다. 그래서 2026-07 매출의 15%(3,715,300원)가
//  「기타·미분류」로 묶여 평균원가율 추정을 받았다.
//
//  그래서 여기서는 순서를 바꾼다:
//    ① 이름을 읽는다 (별칭 표)
//    ② 이름이 여러 상품에 걸리면 금액으로 고른다
//    ③ 그래도 안 되면 **추정하지 않고** needs_review 로 남긴다
//
//  ③ 이 이 모듈의 값이다. 엑셀이 조용히 넘긴 15% 가 여기서 드러난다.
// ============================================================

import type { SalesAssumptions } from "./types";
import {
  coversDate,
  productInScope,
  shippingFeeAt,
  valueAt,
  type PayRoute,
  type SalesEvent,
  type SalesLineInput,
  type PayMethod,
  type SalesLineReason,
  type SalesProduct,
  type SalesStore,
} from "./types";

/** POS·예약 원본 한 줄 (재무 어댑터의 PosSale 에서 필요한 것만) */
export interface RawSaleRow {
  /** YYYY-MM-DD */
  date: string;
  /** 결제 내역 문자열. 네이버는 "상품 · 인원" */
  items: string;
  /** 실제 결제 금액 */
  total: number;
  /** 원본에 수량 열이 있으면 (온라인 주문) */
  qty?: number;
  /** 환불 표시가 있으면 */
  refundedAt?: string;
  /**
   * 돌려준 금액 — 원본이 알려줄 때만 (네이버 예약). 있으면 사람에게 묻지
   * 않고 적재가 정한다 (resolveRows 의 환불 분기). 없으면 옛날처럼 검토 대기함.
   */
  refundAmount?: number;
  /** 취소해도 받은 금액 (네이버 「취소수수료」). 없으면 total − refundAmount */
  cancelFee?: number;
  /**
   * 품목별 수량·금액 — 원본이 알려줄 때만 (네이버 옵션 열). 있으면 상품
   * 문구·인원으로 짐작하지 않고 이 내역대로 줄을 나눈다 (splitByOptions).
   */
  options?: { label: string; count: number; amount: number }[];
  /** 원본에 결제수단 열이 있으면 (네이버 「N페이」· 페이히어 「결제수단」) */
  payMethod?: PayMethod;
}

export interface ResolveContext {
  products: SalesProduct[];
  events: SalesEvent[];
  store: SalesStore;
  route: PayRoute;
  /**
   * 배송비를 알려면 기본가정이 필요하다. 없으면 배송비 없이 본다 —
   * 옛 호출부가 깨지지 않게 선택 값으로 둔다.
   */
  assumptions?: SalesAssumptions;
}

export interface ResolvedLine {
  productId?: string;
  qty: number;
  /** 이 결제에 포함된 배송비 (있을 때만) */
  shippingFee?: number;
  status: "resolved" | "needs_review";
  reason?: SalesLineReason;
  eventId?: string;
  /**
   * 한 결제가 여러 상품으로 쪼개진 경우의 줄별 금액.
   * 비어 있으면 원본 결제액 전체가 이 줄의 금액이다.
   */
  amount?: number;
  /**
   * 나눈 줄의 원본 문구 — 비어 있으면 원본 결제 내역 그대로. 대기함은
   * 문구·금액으로 묶으므로, 나눈 조각이 어느 품목인지 문구에 드러나야 한다.
   */
  raw?: string;
}

/** 비교용 정규화 — 공백·중점·괄호를 지우고 소문자로 */
function norm(s: string): string {
  return s.toLowerCase().replace(/[\s·,()[\]{}]/g, "");
}

/** "외 3건" → 3. 없으면 0 */
function extraItemCount(raw: string): number {
  const m = raw.match(/외\s*(\d+)\s*건/);
  return m ? Number(m[1]) : 0;
}

/** 네이버 "3명" → 3. 없으면 0 */
function peopleCount(raw: string): number {
  const m = raw.match(/(\d+)\s*명/);
  return m ? Number(m[1]) : 0;
}

/**
 * 네이버 상품 문구에 병 수가 명시된 경우: "10ml 향수(3)" → { "10ml": 3 }.
 * 네이버 예약은 이 표기가 있는 줄과 없는 줄이 섞여 있다.
 */
function explicitBottles(raw: string): { option: string; count: number }[] {
  const out: { option: string; count: number }[] = [];
  const re = /(\d+\s*ml)[^(]*\(\s*(\d+)\s*\)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    out.push({ option: m[1].replace(/\s+/g, "").toLowerCase(), count: Number(m[2]) });
  }
  return out;
}

/**
 * 별칭으로 후보 상품을 찾는다. 긴 별칭이 먼저 걸려야 한다 —
 * "10ml" 보다 "일반 10ml 향수" 가 구체적이다.
 */
function byAlias(raw: string, pool: SalesProduct[]): SalesProduct[] {
  const n = norm(raw);
  const hits: { p: SalesProduct; len: number }[] = [];
  pool.forEach((p) => {
    const keys = [...(p.aliases ?? []), `${p.name} ${p.option}`, p.name];
    let best = 0;
    keys.forEach((k) => {
      const nk = norm(k);
      if (nk && n.includes(nk)) best = Math.max(best, nk.length);
    });
    if (best > 0) hits.push({ p, len: best });
  });
  if (hits.length === 0) return [];
  const top = Math.max(...hits.map((h) => h.len));
  // 같은 구체성으로 걸린 후보는 모두 넘긴다 — 금액으로 가른다
  return hits.filter((h) => h.len === top).map((h) => h.p);
}

/**
 * 이 상품으로 인정할 단가들.
 *
 * 세 가지를 모두 후보로 넣는다:
 *   ① 현재 정가
 *   ② 그 날짜에 유효했던 정가 (history)
 *   ③ ①②의 쿠폰 할인가 (상품마스터의 「할인율 0.3 · 적용가」)
 *
 * ⚠️ 현재 정가를 **항상** 넣는 이유: 가격이 내려가도 옛 가격 청구가 한동안
 *    남는다. 네이버 예약은 **예약 시점 가격**이 청구되고 우리 날짜는
 *    이용일시라, 2026-01 에 58,000 → 48,000 으로 내린 뒤에도 2026-03 까지
 *    58,000 건이 들어왔다(실측 30건). 반대 방향(내리기 전에 내린 값이 찍히는
 *    일)도 쿠폰 발행가로 실제로 나타난다. 그래서 한쪽만 인정하면 멀쩡한
 *    거래가 「금액 불일치」로 쌓인다.
 *
 *    금액을 넉넉히 인정해도 **매출은 실제 결제액 그대로** 기록되므로 숫자가
 *    부풀지 않는다. 달라지는 것은 수량·재료비의 귀속뿐이고, 10ml(24,000)과
 *    50ml(48,000·58,000)은 값이 겹치지 않아 오귀속 위험도 없다.
 */
function pricesOf(p: SalesProduct, date: string): number[] {
  const set = new Set<number>();
  const add = (base: number) => {
    if (base <= 0) return;
    set.add(base);
    const r = p.discountRate;
    if (r && r > 0 && r < 1) {
      const d = Math.round(base * (1 - r));
      if (d > 0) set.add(d);
    }
  };
  add(p.price);
  const at = valueAt(p, date).price;
  if (at !== p.price) add(at);
  return [...set];
}

/**
 * 금액이 정가(또는 할인가)의 정수배인가 → 수량.
 *
 * 배송비가 붙던 시기에는 **배송비를 뺀 금액**도 본다. 순서가 중요하다 —
 * 배송비 없는 해석을 먼저 시도해야, 복수 구매(배송비 0)가 엉뚱하게 배송비
 * 포함으로 읽히지 않는다.
 */
function exactQty(
  amount: number,
  p: SalesProduct,
  date: string,
  shipping: number,
): { qty: number; shippingFee?: number } | null {
  if (amount <= 0) return null;
  for (const price of pricesOf(p, date)) {
    if (price > 0 && amount % price === 0) return { qty: amount / price };
  }
  if (shipping > 0 && amount > shipping) {
    const net = amount - shipping;
    for (const price of pricesOf(p, date)) {
      if (price > 0 && net % price === 0) return { qty: net / price, shippingFee: shipping };
    }
  }
  return null;
}

/**
 * 한 줄을 해석한다.
 *
 * 이벤트 귀속은 **날짜**로 정한다 (엑셀 이벤트마스터와 같은 방식).
 * 기간이 겹치는 이벤트가 없으면 상시다 — 엑셀은 이걸 버려서 와우
 * 30,000원이 분석에서 사라졌다.
 */
export function resolveRow(row: RawSaleRow, ctx: ResolveContext): ResolvedLine {
  const event = ctx.events.find((e) => e.store === ctx.store && coversDate(e, row.date));
  const eventId = event?.id;
  const base = { qty: 0, eventId } as const;

  if (row.refundedAt) {
    return { ...base, status: "needs_review", reason: "refunded" };
  }

  // 「금액 입력」 — POS 에서 상품 없이 금액만 찍은 건
  if (/금액\s*입력/.test(row.items)) {
    return { ...base, status: "needs_review", reason: "amount_only" };
  }

  // 「외 N건」 — 한 줄에 여러 상품. 수량을 나눌 근거가 없다.
  if (extraItemCount(row.items) > 0) {
    return { ...base, status: "needs_review", reason: "multi_item" };
  }

  // 이 매장의 상품만 본다. 같은 별칭("피규어 디퓨저")이 상시·이벤트에
  // 모두 있으므로, 이벤트 기간이면 이벤트 상품을 먼저 본다.
  //
  // 전용 이벤트가 지정된 상품은 그 이벤트의 줄에만 후보다 — 행사 전용 품목이
  // 다른 행사의 같은 금액을 잡아가면 안 된다.
  const all = ctx.products.filter((p) => p.store === ctx.store && productInScope(p, eventId));
  const preferred = eventId
    ? [...all.filter((p) => p.kind === "event"), ...all.filter((p) => p.kind === "regular")]
    : [...all.filter((p) => p.kind === "regular"), ...all.filter((p) => p.kind === "event")];

  let candidates = byAlias(row.items, preferred);
  if (candidates.length === 0) {
    return { ...base, status: "needs_review", reason: "unknown_item" };
  }

  // ---- 수량 정하기 -----------------------------------------
  // 원본에 수량 열이 있으면(온라인) 그걸 믿는다.
  if (row.qty && row.qty > 0) {
    const fit = candidates.find((p) =>
      pricesOf(p, row.date).some((pr) => pr * row.qty! === row.total),
    );
    if (fit) return { productId: fit.id, qty: row.qty, status: "resolved", eventId };
    // 수량은 알지만 금액이 정가와 안 맞는다 → 할인 의심
    return {
      productId: candidates[0].id,
      qty: row.qty,
      status: "needs_review",
      reason: "price_mismatch",
      eventId,
    };
  }

  // 네이버에 병 수가 명시된 줄: "10ml 향수(3)"
  const bottles = explicitBottles(row.items);
  if (bottles.length === 1) {
    const b = bottles[0];
    const fit = candidates.find(
      (p) =>
        norm(p.option).includes(b.option) &&
        pricesOf(p, row.date).some((pr) => pr * b.count === row.total),
    );
    if (fit) {
      return { productId: fit.id, qty: b.count, status: "resolved", eventId };
    }
  }

  const people = peopleCount(row.items);

  // 네이버 AI 퍼퓸: 한 사람이 한 병. 1인당 금액으로 용량을 가른다.
  //   1명 48,000 → 50ml ×1 · 2명 48,000 → 10ml ×2 · 3명 72,000 → 10ml ×3
  // 엑셀의 helper 열(AI정가여부·10ml병수·50ml병수)이 하던 판단을
  // 규칙으로 드러낸 것이다.
  if (ctx.route === "naver" && people > 0 && row.total % people === 0) {
    const unit = row.total / people;
    const fit = candidates.find((p) => p.bottles === 1 && pricesOf(p, row.date).includes(unit));
    if (fit) return { productId: fit.id, qty: people, status: "resolved", eventId };
  }

  // 세트 상품: 인원 ÷ 구성 병수 = 세트 수. 커플센트 2명이면 2병 세트 1개다.
  //   「1명/퍼퓸세트 (50ml*2ea)(1)」 88,000 → 50ml×2 세트 1개
  //   「2명」 88,000 → 44,000×2 가 아니라 88,000×1 이어야 맞는다
  if (people > 0) {
    for (const p of candidates) {
      if (p.bottles <= 1 || people % p.bottles !== 0) continue;
      const q = people / p.bottles;
      if (pricesOf(p, row.date).some((pr) => pr * q === row.total)) {
        return { productId: p.id, qty: q, status: "resolved", eventId };
      }
    }
  }

  // 정가의 정수배로 딱 맞는 후보 — 가장 흔한 경로
  const shipping = ctx.assumptions ? shippingFeeAt(ctx.assumptions, ctx.store, row.date) : 0;
  for (const p of candidates) {
    const hit = exactQty(row.total, p, row.date, shipping);
    if (hit) {
      return {
        productId: p.id,
        qty: hit.qty,
        status: "resolved",
        eventId,
        ...(hit.shippingFee ? { shippingFee: hit.shippingFee } : {}),
      };
    }
  }

  // 이름은 알았는데 금액이 안 맞는다. 상품은 남겨 대기함에서 판단을 돕는다.
  return {
    productId: candidates[0].id,
    qty: people > 0 ? people : 1,
    status: "needs_review",
    reason: "price_mismatch",
    eventId,
  };
}

/**
 * 네이버 예약의 「2명/50ml 향수(1),10ml 향수(1)」처럼 **상품별 병 수가
 * 명시된** 줄을 상품별로 쪼갠다.
 *
 * 각 상품의 (정가 × 병 수) 합이 결제액과 정확히 맞을 때만 쪼갠다. 맞지
 * 않으면 할인이 섞였거나 우리가 모르는 구성이라, 추측하지 않고 null 을
 * 돌려 검토 대기함으로 보낸다.
 *
 * 쪼갠 줄들의 금액 합은 원본 결제액과 같으므로 장부 대사가 깨지지 않는다.
 */
function splitByBottles(
  row: RawSaleRow,
  candidates: SalesProduct[],
  eventId: string | undefined,
): ResolvedLine[] | null {
  const groups = explicitBottles(row.items);
  if (groups.length < 2) return null;

  const picked: { p: SalesProduct; count: number; amount: number }[] = [];
  for (const g of groups) {
    const fit = candidates.find((p) => p.bottles === 1 && norm(p.option).includes(g.option));
    if (!fit) return null;
    // 그 날짜에 인정되는 단가 중 하나를 골라야 한다. 조합이 맞는지는 아래에서 본다.
    picked.push({ p: fit, count: g.count, amount: 0 });
  }

  // 후보 단가들의 조합 중 합계가 결제액과 맞는 하나를 찾는다 (상품 2~3개라
  // 조합 수가 작다). 먼저 맞은 조합을 쓴다.
  const options = picked.map((x) => pricesOf(x.p, row.date));
  const combo: number[] = new Array(picked.length).fill(0);
  const search = (i: number, sum: number): boolean => {
    if (i === picked.length) return sum === row.total;
    for (const pr of options[i]) {
      combo[i] = pr;
      if (search(i + 1, sum + pr * picked[i].count)) return true;
    }
    return false;
  };
  if (!search(0, 0)) return null;

  return picked.map((x, i) => ({
    productId: x.p.id,
    qty: x.count,
    status: "resolved" as const,
    eventId,
    amount: combo[i] * x.count,
  }));
}

/**
 * 한 줄을 해석한다 — 상품이 여러 개 명시돼 있으면 여러 줄이 나온다.
 * 대부분은 한 줄이다.
 */
export function resolveRowAll(row: RawSaleRow, ctx: ResolveContext): ResolvedLine[] {
  const event = ctx.events.find((e) => e.store === ctx.store && coversDate(e, row.date));
  const all = ctx.products.filter(
    (p) => p.store === ctx.store && productInScope(p, event?.id),
  );

  // 원본이 품목별 내역을 주면 그게 정답이다 — 짐작보다 먼저 쓴다.
  // (2608 네이버: 「1명 · 10ml×2 = 48,000」 이 1인 1병 규칙으로 50ml 1병이
  //  되고 있었다. 옵션 열에는 10ml 2병이라고 적혀 있었다.)
  if (row.options && row.options.length > 0 && !row.refundedAt) {
    const sum = row.options.reduce((s, o) => s + o.amount, 0);
    if (sum === row.total) return splitByOptions(row, all, event?.id);
  }

  const one = resolveRow(row, ctx);
  if (one.status === "resolved") return [one];
  // 이름은 알았는데 금액이 안 맞으면 → 문구에 병 수가 적혀 있을 때 상품별 분리
  if (one.reason === "price_mismatch") return splitByBottles(row, all, event?.id) ?? [one];
  // 「외 N건」 → 금액이 딱 한 가지 조합으로만 설명될 때 나눈다
  if (one.reason === "multi_item") return splitBundle(row, all, event?.id) ?? [one];
  return [one];
}

/** 이벤트 기간이면 이벤트 상품을 먼저 — resolveRow 와 같은 순서 */
function tiersOf(pool: SalesProduct[], eventId: string | undefined): SalesProduct[][] {
  const ev = pool.filter((p) => p.kind === "event");
  const reg = pool.filter((p) => p.kind === "regular");
  return eventId ? [ev, reg] : [reg, ev];
}

/**
 * 네이버 옵션 열대로 줄을 나눈다 — 옵션마다 한 줄.
 *
 * 옵션 → 상품은 네 가지로 좁힌다: 예약 상품 문구(별칭) · 옵션의 용량 ·
 * 세트 병 수(「10ml*2ea」) · 「수량 × 단가 = 옵션 금액」. 용량이 없는 옵션
 * (「키캡클리커디퓨저」)은 **옵션 이름 자체**가 별칭에 걸릴 때만 인정한다 —
 * 예약 상품 문구로 찾으면 클리커가 뿌덕 향수로 잡힌다.
 *
 * 못 찾은 옵션은 그 옵션 금액만 대기함으로 간다. 나머지는 확정된다.
 * 줄 금액의 합은 늘 원본 결제액과 같다 (호출부가 합을 확인한다).
 */
function splitByOptions(
  row: RawSaleRow,
  pool: SalesProduct[],
  eventId: string | undefined,
): ResolvedLine[] {
  const preferred = tiersOf(pool, eventId).flat();
  const opts = row.options!;
  return opts.map((o) => {
    const vol = o.label.match(/(\d+)\s*ml/i)?.[1];
    const setOf = Number(o.label.match(/\*\s*(\d+)\s*ea/i)?.[1] ?? 0);
    const raw =
      opts.length > 1 ? `${row.items} › ${o.label} ×${o.count}` : row.items;
    let cands: SalesProduct[];
    if (vol) {
      const volOk = (p: SalesProduct) =>
        norm(p.option).includes(`${vol}ml`) && (setOf > 1 ? p.bottles === setOf : p.bottles === 1);
      // 옵션 이름에 곧바로 걸리는 상품이 있으면 그게 가장 구체적이다. 예약 상품
      // 문구와 합쳐서만 찾으면 「[풍성한 한가위] 퍼퓸(50ml)」 같은 옵션 전용 상품이
      // 더 긴 예약 문구(「뿌리는 덕질 AI 이미지 분석 퍼퓸」)에 밀려 뿌덕 향수로 잡힌다.
      const byLabel = byAlias(o.label, preferred).filter(volOk);
      cands = byLabel.length > 0 ? byLabel : byAlias(`${row.items} ${o.label}`, preferred).filter(volOk);
    } else {
      cands = byAlias(o.label, preferred);
    }
    const fit = cands.find((p) => pricesOf(p, row.date).some((pr) => pr * o.count === o.amount));
    if (fit) {
      return { productId: fit.id, qty: o.count, status: "resolved", eventId, amount: o.amount, raw };
    }
    const miss = opts.length > 1 || cands.length === 0 ? `${row.items} › ${o.label} ×${o.count}` : raw;
    return cands.length > 0
      ? { productId: cands[0].id, qty: o.count, status: "needs_review", reason: "price_mismatch", eventId, amount: o.amount, raw: miss }
      : { qty: o.count, status: "needs_review", reason: "unknown_item", eventId, amount: o.amount, raw: miss };
  });
}

/**
 * 페이히어 「포도알 50ml 향수 외 1건」 62,000 — 원본은 첫 품목 이름과 합계만 준다.
 *
 * 첫 품목은 이름으로 정하고, 나머지 N개는 **서로 다른** 상품 중에서
 * 「단가 × 수량」의 합이 결제액과 맞는 조합을 찾는다. **조합이 딱 하나일
 * 때만** 나눈다 — 둘 이상이면(와우 「샤쉐 외 1건」 53,000 = 사쉐 + 50ml 향수
 * 또는 피규어 디퓨저, 둘 다 38,000) 추측하지 않고 대기함에 남긴다.
 *
 * 수량은 1개씩인 조합을 먼저 본다. 「이벤트 50ml 외 1건」 72,000 은
 * 10ml 1병(24,000)으로도, 입장권 4장(6,000×4)으로도 맞는데, 한 결제에 같이
 * 찍힌 다른 품목이 1개일 때가 압도적으로 흔하다. 1개짜리 조합이 없을 때만
 * 수량을 늘려 본다 (그때도 조합이 하나여야 한다).
 */
function splitBundle(
  row: RawSaleRow,
  pool: SalesProduct[],
  eventId: string | undefined,
): ResolvedLine[] | null {
  const n = extraItemCount(row.items);
  if (n < 1 || n > 2 || row.total <= 0) return null;
  const headText = row.items.replace(/외\s*\d+\s*건/, "").trim();
  const firsts = byAlias(headText, tiersOf(pool, eventId).flat());
  if (new Set(firsts.map((p) => p.id)).size !== 1) return null;
  const first = firsts[0];

  for (const cap of [1, 3]) {
    for (const tier of tiersOf(pool, eventId)) {
      const others = tier.filter((p) => p.id !== first.id);
      const found = new Map<string, { id: string; qty: number; amount: number }[]>();
      const pick = (start: number, left: number, sum: number, acc: { id: string; qty: number; amount: number }[]) => {
        if (left === 0) {
          if (sum === 0) {
            const key = acc.map((x) => `${x.id}×${x.qty}`).sort().join("+");
            if (!found.has(key)) found.set(key, [...acc]);
          }
          return;
        }
        for (let i = start; i < others.length; i++) {
          for (const pr of pricesOf(others[i], row.date)) {
            for (let q = 1; q <= cap; q++) {
              if (pr * q > sum) break;
              acc.push({ id: others[i].id, qty: q, amount: pr * q });
              pick(i + 1, left - 1, sum - pr * q, acc);
              acc.pop();
            }
          }
        }
      };
      for (const pr of pricesOf(first, row.date)) {
        for (let q = 1; q <= cap; q++) {
          if (pr * q >= row.total) break;
          pick(0, n, row.total - pr * q, [{ id: first.id, qty: q, amount: pr * q }]);
        }
      }
      if (found.size > 1) return null;
      if (found.size === 1) {
        const combo = [...found.values()][0];
        return combo.map((x) => {
          const p = pool.find((pp) => pp.id === x.id)!;
          return {
            productId: x.id,
            qty: x.qty,
            status: "resolved" as const,
            eventId,
            amount: x.amount,
            raw: `${row.items} › ${p.name} ${p.option} ×${x.qty}`,
          };
        });
      }
    }
  }
  return null;
}

/** 원본 여러 줄 → 저장할 SalesLine 초안 */
export function resolveRows(
  rows: RawSaleRow[],
  ctx: ResolveContext,
  meta: { importId?: string; createdAt?: number },
): SalesLineInput[] {
  const now = meta.createdAt ?? Date.now();
  return rows.flatMap((r): SalesLineInput[] => {
    // ---- 환불 — 금액을 아는 원본이면 사람에게 묻지 않는다 --------------
    // 전액 환불·입금대기취소는 판매가 아니다 → 줄을 만들지 않는다 (0원 결제를
    // 건너뛰는 것과 같다). 일부만 돌려줬으면 남은 돈(취소수수료)만 매출이다.
    // 향수를 만들지 않았으니 원가는 0 — 그래서 상품 없는 manual 줄로 둔다.
    //
    // ⚠️ 이 줄을 검토 대기함에서 「확정」하면 결제액 전체가 판매로 잡혔다.
    //    환불인지 모르는 확정 버튼 앞에 환불을 세워 두지 않는다.
    if (r.refundedAt && r.refundAmount !== undefined) {
      const kept = Math.min(r.total, r.cancelFee ?? Math.max(0, r.total - r.refundAmount));
      if (kept <= 0) return [];
      const event = ctx.events.find((e) => e.store === ctx.store && coversDate(e, r.date));
      const fee: SalesLineInput = {
        date: r.date,
        store: ctx.store,
        route: ctx.route,
        amount: kept,
        qty: 0,
        status: "manual",
        manualMaterial: 0,
        raw: `취소 수수료 · ${r.items || "(내역 없음)"}`,
        memo: `예약 취소 — 결제 ${r.total.toLocaleString("ko-KR")} · 환불 ${r.refundAmount.toLocaleString("ko-KR")}`,
        createdAt: now,
      };
      if (r.payMethod) fee.payMethod = r.payMethod;
      if (event) fee.eventId = event.id;
      if (meta.importId) fee.importId = meta.importId;
      return [fee];
    }

    // 금액이 0 인 환불 줄(페이히어가 환불을 합계 0 줄로 따로 찍는다)은 매출이 없다
    if (r.refundedAt && r.total <= 0) return [];

    const results = resolveRowAll(r, ctx);
    return results.map((res) => {
      const line: SalesLineInput = {
        date: r.date,
        store: ctx.store,
        route: ctx.route,
        amount: res.amount ?? r.total,
        qty: res.qty,
        status: res.status,
        raw: res.raw || r.items || "(내역 없음)",
        createdAt: now,
      };
      if (r.payMethod) line.payMethod = r.payMethod;
      if (res.productId) line.productId = res.productId;
      if (res.shippingFee) line.shippingFee = res.shippingFee;
      if (res.reason) line.reason = res.reason;
      if (res.eventId) line.eventId = res.eventId;
      if (meta.importId) line.importId = meta.importId;
      return line;
    });
  });
}

/** 해석 결과 요약 — 적재 전 미리보기에 쓴다 */
export interface ResolveSummary {
  rows: number;
  resolved: number;
  needsReview: number;
  total: number;
  resolvedAmount: number;
  reviewAmount: number;
  /** 실패 이유별 건수·금액 — 규칙을 어디부터 고칠지 알려준다 */
  byReason: { reason: SalesLineReason; count: number; amount: number }[];
  /** 이벤트에 귀속되지 않은 줄 (엑셀이 버렸던 부분) */
  unattributed: { count: number; amount: number };
}

export function summarize(lines: SalesLineInput[]): ResolveSummary {
  const reasons = new Map<SalesLineReason, { count: number; amount: number }>();
  let resolved = 0;
  let resolvedAmount = 0;
  let reviewAmount = 0;
  let unCount = 0;
  let unAmount = 0;

  lines.forEach((l) => {
    // manual(취소 수수료 등)은 이미 정해진 줄이다 — 미확정으로 세면 대기함
    // 건수와 적재 칸의 「미확정」이 어긋난다
    if (l.status === "resolved" || l.status === "manual") {
      resolved += 1;
      resolvedAmount += l.amount;
    } else {
      reviewAmount += l.amount;
      if (l.reason) {
        const cur = reasons.get(l.reason) ?? { count: 0, amount: 0 };
        reasons.set(l.reason, { count: cur.count + 1, amount: cur.amount + l.amount });
      }
    }
    if (!l.eventId) {
      unCount += 1;
      unAmount += l.amount;
    }
  });

  return {
    rows: lines.length,
    resolved,
    needsReview: lines.length - resolved,
    total: lines.reduce((s, l) => s + l.amount, 0),
    resolvedAmount,
    reviewAmount,
    byReason: [...reasons.entries()]
      .map(([reason, v]) => ({ reason, ...v }))
      .sort((a, b) => b.amount - a.amount),
    unattributed: { count: unCount, amount: unAmount },
  };
}
