// ============================================================
//  온라인 주문 → 판매 줄
// ------------------------------------------------------------
//  acscent.co.kr 의 주문 한 건이 매출 모듈의 판매 줄 몇 개가 되는가.
//  입출력만 있는 순수 함수다 — Firestore 도 fetch 도 여기 없다. 그래야
//  스크립트로 값을 찍어 보며 규칙을 확인할 수 있다 (sync:verify).
//
//  ── 규칙 ────────────────────────────────────────────────
//  ① 품목 한 줄 = 판매 줄 한 개. 문서 id 는 `online_주문id_품목id` 로
//     **정해져 있다.** 같은 주문을 몇 번 받아도 문서는 하나다 — 신호가
//     겹쳐 오거나 폴링과 신호가 동시에 돌아도 매출이 두 배가 되지 않는다.
//
//  ② 상품은 **정가로** 찾고, 금액은 **실제 받은 값**을 적는다.
//     쿠폰 할인은 주문 단위(discountAmount)라 품목에 비율로 나눈다 —
//     관리자 엑셀 내보내기가 쓰던 방식 그대로다 (반올림 잔여는 마지막 품목).
//     나눈 뒤 금액으로 상품을 찾으면 멀쩡한 거래가 전부 「금액 불일치」가
//     되므로, 해석기에는 정가 합계를 주고 결과의 금액만 실제 값으로 바꾼다.
//     왜 그래도 되는가: 할인 근거(정가·할인율)를 discount 에 함께 남기므로
//     "왜 69,300 인가"를 나중에 되짚을 수 있다.
//
//  ③ 배송비는 **첫 줄의 금액에 더하고** shippingFee 에 얼마인지 남긴다.
//     매출 모듈의 약속이 그렇다 (types.ts SalesLine.shippingFee) — 배송비는
//     받은 돈이라 매출에 들어가고, 어느 줄이 품고 있는지만 기록한다.
//
//  ④ 전액 환불은 줄을 만들지 않는다. **부분 환불은 사람에게 묻는다** —
//     어느 품목을 돌려줬는지는 금액만으로 알 수 없다. 여러 품목 중 하나를
//     취소한 것인지 전 품목을 조금씩 깎아 준 것인지에 따라 수량·원가가
//     달라지는데, 그걸 기계가 고르면 원가가 조용히 틀린다. 이 모듈의
//     원칙대로 추정하지 않고 검토 대기함으로 보낸다 (reason: refunded).
//
//  ⑤ 합계 검산: Σ 줄 금액 = itemsTotal − discountAmount + shippingFee
//     = finalPrice. 어긋나면 그 주문은 적재하지 않고 알린다.
//     단 **1원**은 허용한다 — 사이트의 주문 생성 라우트가 쿠폰 반올림 때문에
//     ±1원 차이를 받아 준다(acscent src/app/api/orders/route.ts). 그 1원은
//     첫 줄에 얹어 Σ 가 결제액과 정확히 같게 만든다. 2원 이상은 사람에게.
// ============================================================

import { dateStrKST } from "@/lib/neander/format";
import { resolveRow, type RawSaleRow, type ResolveContext } from "@/lib/neander/sales/resolve";
import {
  coversDate,
  type PayMethod,
  type SalesLineInput,
} from "@/lib/neander/sales/types";
import { siteKeyOf, type OnlineOrderRow } from "./contract";

/** 이 줄의 주인이 자동 동기화라는 표시 */
export const SYNC_ACTOR = "sync:acscent-online";

/** 판매 줄 문서 id — 주문 id + 품목 id 로 정해진다 (멱등키) */
export const onlineLineId = (orderId: string, itemId: string) =>
  `online_${orderId}_${itemId}`;

/** 이 주문이 만든 줄인가 (id 앞부분으로 판정 — 지울 때 쓴다) */
export const onlineLinePrefix = (orderId: string) => `online_${orderId}_`;

/**
 * 사이트의 결제수단 → 수수료가 갈리는 축.
 *
 * ⚠️ 여기서 **추측하지 않는다.** 모르는 문구는 undefined 로 두어 경로
 *    기본값(자사몰 = 신용카드)이 걸리게 한다. 싼 요율로 임의로 깎으면
 *    공헌이익이 사실보다 좋아 보인다.
 *
 *    카카오페이·네이버페이는 자사몰(PortOne·KCP)을 거치는 **간편결제**라
 *    매장 네이버 예약(Npay 정산)과 요율 근거가 다르다. 카드로 결제한
 *    간편결제는 카드 우대요율을 받지만 머니·포인트 결제분은 못 받는다 —
 *    원본이 그 둘을 구분해 주지 않으므로 easyCash 로 둔다(비싼 쪽).
 */
export function onlinePayMethod(raw: string): PayMethod | undefined {
  const t = String(raw ?? "").trim().toLowerCase();
  if (!t) return undefined;
  if (t === "card") return "credit";
  if (t === "bank_transfer") return "cash";
  if (t === "kakao_pay" || t === "naver_pay") return "easyCash";
  return undefined;
}

export interface OnlineMapResult {
  /** 이 주문이 만들어야 할 판매 줄 (id 포함) */
  lines: (SalesLineInput & { id: string })[];
  /** 지워야 할 줄이 있는 주문인가 (매출이 아니게 됐다) */
  drop: boolean;
  /** 사람이 읽을 설명 — 적재하지 않았거나 대기함으로 보낸 이유 */
  note?: string;
}

/** 사이트가 받아 주는 반올림 차이 (위 규칙 ⑤) */
const ROUNDING_TOLERANCE = 1;

/**
 * 그 날짜에 걸린 이벤트 — **이벤트 저장 뒤 다시 붙이기(attach.ts)와 같은
 * 순서**로 고른다: 최근에 시작한 것이 먼저. 기간이 겹칠 때 둘이 다른
 * 이벤트를 고르면, 동기화가 돌 때마다 귀속이 뒤집힌다.
 */
function eventOn(ctx: ResolveContext, date: string) {
  return [...ctx.events]
    .filter((e) => e.store === "online")
    .sort((a, b) => String(b.from).localeCompare(String(a.from)))
    .find((e) => coversDate(e, date));
}

/** 할인액을 품목 소계 비율로 나눈다. 반올림 잔여는 마지막 품목이 흡수한다 */
function allocate(discount: number, subtotals: number[]): number[] {
  const gross = subtotals.reduce((s, v) => s + v, 0);
  let used = 0;
  return subtotals.map((v, i) => {
    const last = i === subtotals.length - 1;
    const share = last ? discount - used : gross > 0 ? Math.round((discount * v) / gross) : 0;
    used += share;
    return share;
  });
}

/**
 * 주문 한 건 → 판매 줄.
 *
 * @param order 피드가 준 주문
 * @param ctx   상품·이벤트·기본가정 (해석기가 쓰는 것과 같은 묶음)
 * @param now   적재 시각
 */
export function mapOnlineOrder(
  order: OnlineOrderRow,
  ctx: ResolveContext,
  now: number,
): OnlineMapResult {
  if (!order.revenue) {
    const why =
      order.excluded === "influencer"
        ? "인플루언서 증정"
        : order.excluded === "cancelled"
          ? "취소"
          : order.excluded === "refunded"
            ? "전액 환불"
            : order.excluded === "test"
              ? "테스트·0원"
              : "결제 전";
    return { lines: [], drop: true, note: `매출 아님 (${why})` };
  }

  // 날짜는 결제 확정 시각이 정본이다. 무통장처럼 paid_at 이 비어 있는 옛
  // 주문만 주문 시각으로 물러선다 (관리자 엑셀은 늘 주문 시각을 썼다).
  const at = Date.parse(order.paidAt ?? order.createdAt);
  if (!Number.isFinite(at)) {
    return { lines: [], drop: false, note: "날짜를 읽지 못했습니다" };
  }
  const date = dateStrKST(at);

  const items = order.items.filter((i) => i.subtotal > 0 || i.unitPrice > 0);
  if (items.length === 0) {
    return { lines: [], drop: false, note: "품목이 없습니다" };
  }

  // 검산 — 사이트가 준 값끼리 맞지 않으면 우리 쪽에서 메우지 않는다
  const itemsTotal = items.reduce((s, i) => s + i.subtotal, 0);
  const expected = itemsTotal - order.discountAmount + order.shippingFee;
  const rounding = order.finalPrice - expected;
  if (Math.abs(rounding) > ROUNDING_TOLERANCE) {
    return {
      lines: [],
      drop: false,
      note: `금액이 맞지 않습니다 — 품목 ${itemsTotal.toLocaleString("ko-KR")} − 할인 ${order.discountAmount.toLocaleString("ko-KR")} + 배송 ${order.shippingFee.toLocaleString("ko-KR")} ≠ 결제 ${order.finalPrice.toLocaleString("ko-KR")}`,
    };
  }

  const partialRefund = order.refundAmount > 0 && order.refundAmount < order.finalPrice;
  const shares = allocate(order.discountAmount, items.map((i) => i.subtotal));
  const payMethod = onlinePayMethod(order.paymentMethod);
  const event = eventOn(ctx, date);

  const lines = items.map((item, i) => {
    const share = shares[i];
    // 반올림 1원은 첫 줄이 받는다 — Σ 줄 금액이 결제액과 정확히 같아야 한다
    const net = item.subtotal - share + (i === 0 ? rounding : 0);
    const shipping = i === 0 ? order.shippingFee : 0;

    // 해석기에는 **정가 합계**를 준다 (위 규칙 ②)
    const raw = `${item.name || item.productType} · ${siteKeyOf(item.productType, item.size)}`;
    const probe: RawSaleRow = { date, items: raw, total: item.subtotal, qty: item.qty };
    const res = resolveRow(probe, ctx);

    const line: SalesLineInput & { id: string } = {
      id: onlineLineId(order.id, item.id),
      date,
      store: "online",
      route: "online",
      amount: net + shipping,
      qty: res.qty || item.qty,
      status: res.status,
      raw,
      memo: `주문 ${order.orderNumber}`,
      syncSource: "acscent-online",
      syncOrderId: order.id,
      syncedAt: now,
      createdAt: now,
    };
    if (res.productId) line.productId = res.productId;
    if (res.reason) line.reason = res.reason;
    if (payMethod) line.payMethod = payMethod;
    if (shipping > 0) line.shippingFee = shipping;
    if (event) line.eventId = event.id;
    if (share > 0 && item.subtotal > 0) {
      line.discount = { list: item.subtotal, rate: share / item.subtotal };
    }
    if (partialRefund) {
      // 어느 품목이 환불됐는지는 금액만으로 알 수 없다 — 사람이 정한다
      line.status = "needs_review";
      line.reason = "refunded";
      line.memo = `주문 ${order.orderNumber} · 부분환불 ${order.refundAmount.toLocaleString("ko-KR")}원 — 어느 품목인지 정해 주세요`;
      delete line.productId;
    }
    return line;
  });

  return {
    lines,
    drop: false,
    ...(partialRefund
      ? { note: `부분환불 ${order.refundAmount.toLocaleString("ko-KR")}원 — 검토 대기함으로 보냈습니다` }
      : {}),
  };
}
