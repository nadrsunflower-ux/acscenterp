import assert from "node:assert/strict";
import { test } from "node:test";
import { SEED_ASSUMPTIONS } from "../master-data";
import type { SalesEvent, SalesLine, SalesProduct } from "../types";
import { allocateSplit, runSalesTool, type SalesProposal, type SalesToolContext } from "./ai-tools";

// 2026-10 비아이 이벤트(ID-036) 검토 대기함 — 비서가 「상품이 없어 제안할 수
// 없다」며 사람을 화면으로 돌려보냈던 상황을 그대로 옮겼다.

const EVENT: SalesEvent = {
  id: "ID-036",
  store: "id",
  name: "비아이",
  from: "2026-10-10",
  to: "2026-10-20",
  hoursPerDay: 7,
  staff: 1,
  supplies: 0,
};

const product = (p: Partial<SalesProduct> & Pick<SalesProduct, "id" | "name" | "price">): SalesProduct => ({
  store: "id",
  kind: "regular",
  option: "기본",
  material: 0,
  timeMin: 0,
  makeMin: 0,
  bottles: 1,
  ...p,
});

const line = (id: string, amount: number, patch: Partial<SalesLine> = {}): SalesLine => ({
  id,
  date: "2026-10-12",
  store: "id",
  route: "payhere",
  amount,
  qty: 1,
  status: "needs_review",
  reason: "amount_only",
  raw: "금액 입력",
  eventId: "ID-036",
  ...patch,
});

function makeCtx(): SalesToolContext {
  return {
    lines: [
      line("c1", 15_000),
      line("c2", 15_000),
      line("c3", 15_000),
      line("c4", 15_000),
      line("f1", 10_000),
      line("mix35", 35_000, { reason: "multi_item", raw: "클리커 외 2건" }),
      line("mix102", 102_000, { reason: "multi_item", raw: "향수 외 2건" }),
      line("other", 15_000, { eventId: "ID-030" }),
      line("done", 35_000, { status: "resolved", reason: undefined, productId: "IDI-002" }),
    ],
    products: [
      product({ id: "IDI-002", name: "AI 향수", option: "50ml", price: 48_000 }),
      product({ id: "IDE-011", name: "뉴진스 키링", price: 18_000, kind: "event", eventIds: ["ID-027"] }),
    ],
    events: [EVENT, { ...EVENT, id: "ID-030", name: "다른 행사", from: "2026-10-01", to: "2026-10-05" }],
    assumptions: SEED_ASSUMPTIONS,
    pending: [],
  };
}

type Outcome = { result: Record<string, unknown>; proposal?: SalesProposal };
const run = (ctx: SalesToolContext, name: string, args: Record<string, unknown>) =>
  runSalesTool(name, args, ctx) as Outcome;

/** 새 상품 둘을 제안하고 코드를 돌려준다 */
function proposeBiProducts(ctx: SalesToolContext) {
  const clicker = run(ctx, "propose_product", {
    store: "id",
    name: "비아이 클리커",
    price: 15_000,
    eventId: "ID-036",
    reason: "비아이 이벤트 전용 클리커",
  });
  const figure = run(ctx, "propose_product", {
    store: "id",
    name: "비아이 피규어",
    price: 10_000,
    eventId: "ID-036",
    reason: "비아이 이벤트 전용 피규어",
  });
  return { clicker, figure, clickerId: String(clicker.result.productId), figureId: String(figure.result.productId) };
}

test("propose_product: 행사 전용 · 다음 빈 코드 · 재료비 모르면 미확정", () => {
  const ctx = makeCtx();
  const { clicker, figure, clickerId, figureId } = proposeBiProducts(ctx);
  assert.equal(clicker.result.ok, true);
  assert.equal(clickerId, "IDE-012");
  assert.equal(figureId, "IDE-013", "같은 답에서 제안한 상품도 번호를 차지한다");
  assert.equal(clicker.proposal?.kind, "product");
  if (clicker.proposal?.kind !== "product") return;
  assert.deepEqual(clicker.proposal.product.eventIds, ["ID-036"]);
  assert.equal(clicker.proposal.product.kind, "event");
  assert.equal(clicker.proposal.product.unconfirmed, true);
  assert.equal(clicker.proposal.product.aliases, undefined, "별칭은 기본으로 비운다");
  // 다른 행사(ID-030)의 15,000 은 전용 상품의 후보가 아니다
  assert.equal(clicker.proposal.sameAmountCount, 4);
  assert.equal(figure.result.ok, true);
  assert.equal(ctx.pending?.length, 2);
});

test("propose_product: 같은 이름은 다시 만들지 않는다 · 매장이 다른 이벤트는 거부", () => {
  const ctx = makeCtx();
  proposeBiProducts(ctx);
  const again = run(ctx, "propose_product", { store: "id", name: "비아이  클리커", price: 15_000, reason: "x" });
  assert.equal(again.result.ok, false);
  assert.equal(again.result.existing, "IDE-012");
  const wrongStore = run(ctx, "propose_product", { store: "wow", name: "무엇", price: 1_000, eventId: "ID-036", reason: "x" });
  assert.equal(wrongStore.result.ok, false);
});

test("propose_resolve: 같은 답의 새 상품 코드로 확정 — 상품 정의가 함께 실린다", () => {
  const ctx = makeCtx();
  const { clickerId, figureId } = proposeBiProducts(ctx);
  const r = run(ctx, "propose_resolve", { ids: ["c1", "c2", "c3", "c4"], productId: clickerId, reason: "클리커 15,000" });
  assert.equal(r.result.ok, true);
  assert.equal(r.proposal?.kind, "resolve");
  if (r.proposal?.kind !== "resolve") return;
  assert.equal(r.proposal.qty, 1);
  assert.deepEqual(r.proposal.newProducts?.map((p) => p.id), [clickerId]);
  assert.equal(r.proposal.discount, undefined);

  const f = run(ctx, "propose_resolve", { ids: ["f1"], productId: figureId, reason: "피규어 10,000" });
  assert.equal(f.result.ok, true);

  // 전용 상품은 다른 행사의 같은 금액을 가져가지 못한다
  const other = run(ctx, "propose_resolve", { ids: ["other"], productId: clickerId, reason: "x" });
  assert.equal(other.result.ok, false);
});

test("propose_resolve: 마스터에 없는 상품이면 propose_product 를 안내한다", () => {
  const ctx = makeCtx();
  const r = run(ctx, "propose_resolve", { ids: ["c1"], productId: "IDE-099", reason: "x" });
  assert.equal(r.result.ok, false);
  assert.match(String(r.result.error), /propose_product/);
});

test("propose_split: 35,000 = 클리커 1 + 피규어 2 — 정가 그대로 나눈다", () => {
  const ctx = makeCtx();
  const { clickerId, figureId } = proposeBiProducts(ctx);
  const r = run(ctx, "propose_split", {
    ids: ["mix35"],
    parts: [
      { productId: clickerId, qty: 1 },
      { productId: figureId, qty: 2 },
    ],
    reason: "클리커 1 + 피규어 2",
  });
  assert.equal(r.result.ok, true);
  assert.equal(r.proposal?.kind, "split");
  if (r.proposal?.kind !== "split") return;
  assert.deepEqual(
    r.proposal.parts.map((p) => [p.productId, p.qty, p.amount, p.discount]),
    [
      [clickerId, 1, 15_000, undefined],
      [figureId, 2, 20_000, undefined],
    ],
  );
  assert.equal(r.proposal.discountRate, undefined);
  assert.deepEqual(r.proposal.newProducts?.map((p) => p.id).sort(), [clickerId, figureId].sort());
});

test("propose_split: 102,000 = 50ml×2 + 피규어 (정가 106,000) — 할인 확인 없이는 거부, 확인하면 비율로 나눈다", () => {
  const ctx = makeCtx();
  const { figureId } = proposeBiProducts(ctx);
  const parts = [
    { productId: "IDI-002", qty: 2 },
    { productId: figureId, qty: 1 },
  ];
  const ask = run(ctx, "propose_split", { ids: ["mix102"], parts, reason: "50ml 2 + 피규어" });
  assert.equal(ask.result.ok, false);
  assert.equal(ask.result.needsConfirmation, true);
  assert.equal(ask.proposal, undefined);

  const r = run(ctx, "propose_split", { ids: ["mix102"], parts, discount: true, reason: "실결제 102,000" });
  assert.equal(r.result.ok, true);
  if (r.proposal?.kind !== "split") return assert.fail("split 제안이어야 한다");
  const amounts = r.proposal.parts.map((p) => p.amount);
  assert.equal(amounts.reduce((a, b) => a + b, 0), 102_000, "line.split 은 합계 ≠ 결제액이면 거절한다");
  assert.equal(r.proposal.list, 106_000);
  assert.ok(Math.abs((r.proposal.discountRate ?? 0) - 4_000 / 106_000) < 1e-9);
  assert.deepEqual(
    r.proposal.parts.map((p) => p.discount?.list),
    [96_000, 10_000],
  );
  assert.deepEqual(r.proposal.newProducts?.map((p) => p.id), [figureId], "기존 상품은 다시 만들지 않는다");
});

test("propose_split: 빠진 상품 · 확정된 줄 · 한 상품뿐인 조합은 거부", () => {
  const ctx = makeCtx();
  const { clickerId, figureId } = proposeBiProducts(ctx);
  const short = run(ctx, "propose_split", {
    ids: ["mix35"],
    parts: [
      { productId: clickerId, qty: 1 },
      { productId: figureId, qty: 1 },
    ],
    discount: true,
    reason: "x",
  });
  // 25,000 < 35,000 — 할인이 아니라 빠진 상품
  assert.equal(short.result.ok, false);

  const done = run(ctx, "propose_split", {
    ids: ["done"],
    parts: [
      { productId: clickerId, qty: 1 },
      { productId: figureId, qty: 2 },
    ],
    reason: "x",
  });
  assert.equal(done.result.ok, false);

  const single = run(ctx, "propose_split", { ids: ["mix35"], parts: [{ productId: clickerId, qty: 2 }], reason: "x" });
  assert.equal(single.result.ok, false);
  assert.match(String(single.result.error), /propose_resolve/);

  const mixedAmounts = run(ctx, "propose_split", {
    ids: ["mix35", "mix102"],
    parts: [
      { productId: clickerId, qty: 1 },
      { productId: figureId, qty: 2 },
    ],
    reason: "x",
  });
  assert.equal(mixedAmounts.result.ok, false);
});

test("propose_resolve discount: 정가보다 덜 받은 줄을 할인으로 기록한다", () => {
  const ctx = makeCtx();
  ctx.lines.push(line("d1", 43_200, { eventId: undefined }));
  const r = run(ctx, "propose_resolve", { ids: ["d1"], productId: "IDI-002", qty: 1, discount: true, reason: "10% 할인" });
  assert.equal(r.result.ok, true);
  if (r.proposal?.kind !== "resolve") return assert.fail("resolve 제안이어야 한다");
  assert.equal(r.proposal.discount?.list, 48_000);
  assert.ok(Math.abs((r.proposal.discount?.rate ?? 0) - 0.1) < 1e-9);

  // 정가보다 더 받았으면 할인이 아니다
  ctx.lines.push(line("d2", 50_000, { eventId: undefined }));
  const bad = run(ctx, "propose_resolve", { ids: ["d2"], productId: "IDI-002", qty: 1, discount: true, reason: "x" });
  assert.equal(bad.result.ok, false);
});

test("propose_alias: 아직 제안만 한 상품에는 별칭을 따로 붙이지 않는다", () => {
  const ctx = makeCtx();
  const { clickerId } = proposeBiProducts(ctx);
  const r = run(ctx, "propose_alias", { productId: clickerId, alias: "비아이 클리커", reason: "x" });
  assert.equal(r.result.ok, false);
});

test("allocateSplit: 합계는 언제나 결제액과 같다", () => {
  assert.deepEqual(allocateSplit([15_000, 20_000], 35_000), [15_000, 20_000]);
  assert.deepEqual(allocateSplit([96_000, 10_000], 102_000), [92_377, 9_623]);
  for (const [lists, amount] of [
    [[33_333, 33_333, 33_334], 99_999],
    [[10_000, 10_000, 10_000], 20_000],
    [[7_000, 3_000, 1], 9_000],
  ] as [number[], number][]) {
    assert.equal(allocateSplit(lists, amount).reduce((a, b) => a + b, 0), amount);
  }
});
