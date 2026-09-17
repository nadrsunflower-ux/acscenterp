// ============================================================
//  온라인 자동 적재 검증 — 돈이 사라지지 않는가
// ------------------------------------------------------------
//  acscent.co.kr 주문이 판매 줄로 바뀌는 규칙(lib/neander/sync/online.ts)을
//  Firestore 도 네트워크도 없이 돌려 본다. 확인하는 것 넷:
//
//    ① 합계   Σ 줄 금액 = 주문 결제액. 한 원도 새지 않아야 한다.
//    ② 멱등   같은 주문을 두 번 넣어도 문서 번호가 같아야 한다.
//    ③ 판정   상품·수량·할인·배송비·환불이 뜻대로 붙어야 한다.
//    ④ 안전   금액이 안 맞는 주문은 **적재하지 않고** 알려야 한다.
//
//  실행: npm run sync:verify
// ============================================================

import { SEED_ASSUMPTIONS, SEED_EVENTS, SEED_PRODUCTS } from "../../lib/neander/sales/master-data";
import type { ResolveContext } from "../../lib/neander/sales/resolve";
import { mapOnlineOrder, onlineLineId } from "../../lib/neander/sync/online";
import type { OnlineOrderRow } from "../../lib/neander/sync/contract";

const won = (n: number) => n.toLocaleString("ko-KR");

const ctx: ResolveContext = {
  products: SEED_PRODUCTS,
  events: SEED_EVENTS,
  store: "online",
  route: "online",
  assumptions: SEED_ASSUMPTIONS,
};

const NOW = 1_770_000_000_000;

/** 주문 뼈대 — 검사마다 필요한 것만 덮어쓴다 */
function order(over: Partial<OnlineOrderRow> & { id: string }): OnlineOrderRow {
  const items = over.items ?? [];
  const itemsTotal = items.reduce((s, i) => s + i.subtotal, 0);
  const shippingFee = over.shippingFee ?? 0;
  const discountAmount = over.discountAmount ?? 0;
  return {
    orderNumber: `ORD-${over.id}`,
    paidAt: "2026-09-10T05:30:00.000Z", // KST 2026-09-10 14:30
    createdAt: "2026-09-10T05:25:00.000Z",
    updatedAt: "2026-09-10T05:30:00.000Z",
    status: "paid",
    revenue: true,
    paymentMethod: "card",
    itemsTotal,
    shippingFee,
    discountAmount,
    finalPrice: itemsTotal - discountAmount + shippingFee,
    refundAmount: 0,
    refundedAt: null,
    ...over,
    items,
  };
}

const item = (id: string, productType: string, size: string, unitPrice: number, qty = 1) => ({
  id,
  productType,
  size,
  name: "테스트 향수",
  unitPrice,
  qty,
  subtotal: unitPrice * qty,
});

// ============================================================

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};

function sumOf(lines: { amount: number }[]) {
  return lines.reduce((s, l) => s + l.amount, 0);
}

function main() {
  console.log("\n══ 온라인 자동 적재 검증 ══\n");

  // ---- ① 단품 ------------------------------------------------
  {
    const o = order({ id: "A1", items: [item("i1", "image_analysis", "50ml", 48_000)] });
    const r = mapOnlineOrder(o, ctx, NOW);
    console.log("① 단품 50ml 48,000");
    check("줄 1개", r.lines.length === 1);
    check("합계 = 결제액", sumOf(r.lines) === o.finalPrice, `${won(sumOf(r.lines))} vs ${won(o.finalPrice)}`);
    check("상품 확정", r.lines[0]?.status === "resolved", r.lines[0]?.productId ?? "(없음)");
    check("수량 1", r.lines[0]?.qty === 1);
    check("날짜 KST", r.lines[0]?.date === "2026-09-10", r.lines[0]?.date);
    check("결제수단 신용카드", r.lines[0]?.payMethod === "credit");
  }

  // ---- ② 복수 품목 + 쿠폰 + 배송비 -----------------------------
  {
    const o = order({
      id: "A2",
      items: [
        item("i1", "image_analysis", "50ml", 48_000),
        item("i2", "image_analysis", "10ml", 24_000),
      ],
      discountAmount: 7_200, // 10%
      shippingFee: 3_000,
    });
    const r = mapOnlineOrder(o, ctx, NOW);
    console.log("\n② 50ml + 10ml · 쿠폰 7,200 · 배송비 3,000");
    check("줄 2개", r.lines.length === 2);
    check(
      "합계 = 결제액",
      sumOf(r.lines) === o.finalPrice,
      `${won(sumOf(r.lines))} vs ${won(o.finalPrice)}`,
    );
    check("배송비는 첫 줄에만", r.lines[0]?.shippingFee === 3_000 && !r.lines[1]?.shippingFee);
    check("둘 다 상품 확정", r.lines.every((l) => l.status === "resolved"));
    check(
      "할인 근거가 붙었다",
      r.lines.every((l) => !!l.discount),
      r.lines.map((l) => (l.discount ? `${(l.discount.rate * 100).toFixed(1)}%` : "—")).join(" · "),
    );
    // 정가로 상품을 찾았으므로 할인돼도 50ml·10ml 가 제대로 갈려야 한다
    const ids = r.lines.map((l) => l.productId).join(",");
    check("50ml·10ml 가 갈렸다", ids === "ONL-002,ONL-001", ids);
  }

  // ---- ③ 수량 2 ----------------------------------------------
  {
    const o = order({ id: "A3", items: [item("i1", "image_analysis", "10ml", 24_000, 2)] });
    const r = mapOnlineOrder(o, ctx, NOW);
    console.log("\n③ 10ml × 2");
    check("수량 2", r.lines[0]?.qty === 2, String(r.lines[0]?.qty));
    check("합계 = 결제액", sumOf(r.lines) === o.finalPrice);
  }

  // ---- ④ 전액 환불 --------------------------------------------
  {
    const o = order({
      id: "A4",
      items: [item("i1", "image_analysis", "50ml", 48_000)],
      refundAmount: 48_000,
      refundedAt: "2026-09-12T01:00:00.000Z",
      revenue: false,
      excluded: "refunded",
      status: "cancelled",
    });
    const r = mapOnlineOrder(o, ctx, NOW);
    console.log("\n④ 전액 환불");
    check("줄을 만들지 않는다", r.lines.length === 0);
    check("지우라고 알린다", r.drop === true);
  }

  // ---- ⑤ 부분 환불 → 사람에게 -----------------------------------
  {
    const o = order({
      id: "A5",
      items: [
        item("i1", "image_analysis", "50ml", 48_000),
        item("i2", "image_analysis", "10ml", 24_000),
      ],
      refundAmount: 24_000,
      refundedAt: "2026-09-12T01:00:00.000Z",
    });
    const r = mapOnlineOrder(o, ctx, NOW);
    console.log("\n⑤ 부분 환불 24,000 (72,000 중)");
    check("검토 대기함으로", r.lines.every((l) => l.status === "needs_review"));
    check("이유는 환불", r.lines.every((l) => l.reason === "refunded"));
    check("상품을 정하지 않는다", r.lines.every((l) => !l.productId));
    check("사람에게 알린다", !!r.note, r.note ?? "");
  }

  // ---- ⑥ 모르는 상품 -------------------------------------------
  {
    const o = order({ id: "A6", items: [item("i1", "mystery_box", "unknown", 33_000)] });
    const r = mapOnlineOrder(o, ctx, NOW);
    console.log("\n⑥ 마스터에 없는 상품");
    check("검토 대기함으로", r.lines[0]?.status === "needs_review");
    check("금액은 그대로 남는다", sumOf(r.lines) === o.finalPrice);
  }

  // ---- ⑦ 사이트 금액이 안 맞을 때 --------------------------------
  {
    const o = order({ id: "A7", items: [item("i1", "image_analysis", "50ml", 48_000)] });
    o.finalPrice = 40_000; // 우리가 메우면 안 되는 어긋남
    const r = mapOnlineOrder(o, ctx, NOW);
    console.log("\n⑦ 사이트 금액이 서로 안 맞는 주문");
    check("적재하지 않는다", r.lines.length === 0);
    check("지우지도 않는다", r.drop === false);
    check("왜인지 알린다", !!r.note, r.note ?? "");
  }

  // ---- ⑦-2 쿠폰 반올림 1원 ---------------------------------------
  {
    // 사이트의 주문 생성 라우트는 쿠폰 반올림으로 ±1원 차이를 받아 준다
    const o = order({
      id: "A7b",
      items: [
        item("i1", "image_analysis", "50ml", 48_000),
        item("i2", "image_analysis", "10ml", 24_000),
      ],
      discountAmount: 7_199,
    });
    o.finalPrice = 72_000 - 7_199 + 1; // 사이트가 1원 더 받았다
    const r = mapOnlineOrder(o, ctx, NOW);
    console.log("\n⑦-2 사이트가 1원 반올림해 받은 주문");
    check("적재한다", r.lines.length === 2);
    check(
      "합계 = 결제액 (1원까지)",
      sumOf(r.lines) === o.finalPrice,
      `${won(sumOf(r.lines))} vs ${won(o.finalPrice)}`,
    );
    const o2 = order({ id: "A7c", items: [item("i1", "image_analysis", "50ml", 48_000)] });
    o2.finalPrice = 47_998; // 2원 차이는 사람에게
    check("2원 차이는 적재하지 않는다", mapOnlineOrder(o2, ctx, NOW).lines.length === 0);
  }

  // ---- ⑧ 멱등 --------------------------------------------------
  {
    const o = order({ id: "A8", items: [item("i1", "image_analysis", "50ml", 48_000)] });
    const a = mapOnlineOrder(o, ctx, NOW);
    const b = mapOnlineOrder(o, ctx, NOW + 60_000);
    console.log("\n⑧ 같은 주문을 두 번");
    check("문서 번호가 같다", a.lines[0]?.id === b.lines[0]?.id, a.lines[0]?.id ?? "");
    check("정해진 규칙대로", a.lines[0]?.id === onlineLineId("A8", "i1"));
  }

  // ---- ⑨ 사주 상품 (별칭이 정확히 갈리는가) ------------------------
  {
    const o = order({ id: "A9", items: [item("i1", "saju_perfume", "50ml", 44_000)] });
    const r = mapOnlineOrder(o, ctx, NOW);
    console.log("\n⑨ 사주 50ml 44,000 (일반 50ml 48,000 과 갈려야 한다)");
    check("오행 퍼퓸으로", r.lines[0]?.productId === "ONL-005", r.lines[0]?.productId ?? "(미확정)");
  }

  // ---- ⑩ 자사몰 상품 키가 전부 마스터에 걸리는가 -------------------
  {
    const cases: [string, string, number, string][] = [
      ["image_analysis", "10ml", 24_000, "ONL-001"],
      ["image_analysis", "50ml", 48_000, "ONL-002"],
      ["figure_diffuser", "set", 48_000, "ONL-003"],
      ["image_analysis", "scent_paper", 4_000, "ONL-004"],
      ["saju_perfume", "50ml", 44_000, "ONL-005"],
      ["saju_perfume", "10ml", 22_000, "ONL-006"],
      ["saju_perfume", "clicker", 12_900, "ONL-007"],
      ["chemistry_set", "set_10ml", 44_000, "ONL-008"],
      ["chemistry_set", "set_50ml", 88_000, "ONL-009"],
    ];
    console.log("\n⑩ 자사몰 상품 키 → 상품 마스터");
    cases.forEach(([type, size, price, want], i) => {
      const o = order({ id: `K${i}`, items: [item("i1", type, size, price)] });
      const r = mapOnlineOrder(o, ctx, NOW);
      const got = r.lines[0];
      check(
        `${type}/${size} ${won(price)}`,
        got?.productId === want && got?.status === "resolved",
        `${got?.productId ?? "(미확정)"} · ${got?.status ?? "-"}`,
      );
    });
  }

  // ---- ⑪ 인플루언서 증정 ----------------------------------------
  {
    const o = order({
      id: "A11",
      items: [item("i1", "image_analysis", "50ml", 48_000)],
      revenue: false,
      excluded: "influencer",
    });
    const r = mapOnlineOrder(o, ctx, NOW);
    console.log("\n⑪ 인플루언서 증정");
    check("매출로 잡지 않는다", r.lines.length === 0 && r.drop === true);
  }

  console.log(
    failures === 0
      ? "\n── 전부 통과했습니다.\n"
      : `\n── ${failures}건이 어긋났습니다.\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main();
