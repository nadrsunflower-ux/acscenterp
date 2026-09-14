// ============================================================
//  이벤트 저장 뒤 — 판매 줄을 기간에 맞게 다시 붙인다
// ------------------------------------------------------------
//  판매 줄의 이벤트 귀속(eventId)은 적재할 때 날짜로 정해져 **저장**된다
//  (resolve.ts). 그래서 파일을 먼저 올리고 이벤트를 나중에 적는 흐름에서는,
//  이벤트를 저장하는 순간 그 기간의 줄을 다시 붙여 줘야 한다. 안 그러면
//  화면은 "기간을 고치면 자동으로 붙는다"고 말하는데 실제로는 아무 일도
//  일어나지 않는다 — 실제로 그랬다.
//
//  하는 일 두 가지:
//    ① 귀속 — 그 매장의 줄마다 날짜로 이벤트를 다시 정한다 (없으면 상시).
//    ② 재해석 — 미확정(needs_review) 줄은 해석기를 다시 돌린다. 행사 전용
//       상품은 이벤트가 붙어야 후보가 되므로, 이벤트가 생기면 풀리는 줄이
//       있다. 사람이 이미 확정한 줄(resolved·manual)은 건드리지 않는다.
//
//  "server-only" 를 쓰지 않는 이유는 seed.ts 와 같다 — Firestore 를 인자로
//  받고 비밀을 품지 않는다.
// ============================================================

import type { Firestore } from "firebase-admin/firestore";
import { NEANDER_COL } from "../../collections";
import { SEED_ASSUMPTIONS } from "../master-data";
import { resolveRowAll, type RawSaleRow } from "../resolve";
import {
  coversDate,
  type SalesAssumptions,
  type SalesEvent,
  type SalesLine,
  type SalesProduct,
} from "../types";

const BATCH_LIMIT = 450;

export interface ReattachResult {
  /** 이번에 이 이벤트에 붙은 줄 */
  attached: number;
  /** 이 이벤트에서 떨어져 나간 줄 (기간 밖·매장 변경) */
  detached: number;
  /** 다시 해석해서 상품이 정해진 줄 */
  resolved: number;
}

/** 이벤트 목록을 화면과 같은 순서로 — 최근 시작순. 겹치는 기간이면 먼저 찾힌 것이 이긴다 */
function orderEvents(events: SalesEvent[]): SalesEvent[] {
  return [...events].sort((a, b) => String(b.from).localeCompare(String(a.from)));
}

/**
 * 한 이벤트가 바뀐 뒤(생성·수정) 그 매장의 줄을 다시 붙인다.
 *
 * @param saved   방금 저장한 이벤트 (정규화된 값)
 * @param previous 저장 전 값 — 매장이 바뀌었으면 옛 매장의 줄도 훑는다
 */
export async function reattachEventLines(
  db: Firestore,
  saved: SalesEvent,
  previous: SalesEvent | null,
  now: number,
): Promise<ReattachResult> {
  const [eventsSnap, productsSnap, assumptionsSnap] = await Promise.all([
    db.collection(NEANDER_COL.salesEvents).get(),
    db.collection(NEANDER_COL.salesProducts).get(),
    db.collection(NEANDER_COL.salesAssumptions).doc("current").get(),
  ]);
  const events = orderEvents(
    eventsSnap.docs
      .map((d) => ({ id: d.id, ...d.data() }) as SalesEvent)
      // 방금 저장한 값으로 바꿔 끼운다 — 읽기 지연이 있어도 최신을 본다
      .filter((e) => e.id !== saved.id)
      .concat([saved]),
  );
  const products = productsSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as SalesProduct);
  const assumptions = (
    assumptionsSnap.exists ? { id: "current", ...assumptionsSnap.data() } : SEED_ASSUMPTIONS
  ) as SalesAssumptions;

  // 훑을 줄: 새 매장의 줄 전부 + (매장이 바뀌었으면) 옛 매장에서 이 이벤트에 붙어 있던 줄
  const stores = new Set([saved.store, ...(previous ? [previous.store] : [])]);
  const byId = new Map<string, SalesLine>();
  for (const store of stores) {
    const snap = await db.collection(NEANDER_COL.salesLines).where("store", "==", store).get();
    snap.docs.forEach((d) => byId.set(d.id, { id: d.id, ...d.data() } as SalesLine));
  }

  const writes: { id: string; patch: Record<string, unknown> }[] = [];
  let attached = 0;
  let detached = 0;
  let resolved = 0;

  byId.forEach((l) => {
    if (l.status === "manual") return; // 사람이 직접 적은 줄은 그대로
    // 이벤트 기간의 일반 손님으로 뗀 줄은 날짜가 맞아도 다시 붙이지 않는다
    const expected = l.eventOptOut
      ? undefined
      : events.find((e) => e.store === l.store && coversDate(e, l.date));
    const expectedId = expected?.id;
    const patch: Record<string, unknown> = {};

    if ((l.eventId ?? undefined) !== expectedId) {
      patch.eventId = expectedId ?? null;
      if (expectedId === saved.id) attached += 1;
      if (l.eventId === saved.id) detached += 1;
    }

    // 미확정 줄만 다시 해석한다. 이벤트가 붙어야 전용 상품이 후보가 된다.
    if (l.status === "needs_review" && l.raw) {
      const row: RawSaleRow = {
        date: l.date,
        items: l.raw,
        total: l.amount,
        refundedAt: l.reason === "refunded" ? "환불" : undefined,
      };
      const out = resolveRowAll(row, {
        products,
        // 일반 손님 줄은 이벤트 전용 상품을 후보로 올리지 않는다
        events: l.eventOptOut ? [] : events,
        store: l.store,
        route: l.route,
        assumptions,
      });
      // 한 줄로 확정될 때만 반영한다. 여러 줄로 쪼개야 하는 경우는 대기함에서
      // 사람이 나눈다 — 여기서 줄을 늘리면 되돌리기 단위가 흐려진다.
      if (out.length === 1 && out[0].status === "resolved" && out[0].productId) {
        patch.productId = out[0].productId;
        patch.qty = out[0].qty;
        patch.status = "resolved";
        patch.reason = null;
        if (out[0].shippingFee) patch.shippingFee = out[0].shippingFee;
        resolved += 1;
      } else if (out[0]?.reason && out[0].reason !== l.reason) {
        // 이유가 달라졌으면(모르는 상품명 → 금액 불일치 등) 그것도 남긴다
        patch.reason = out[0].reason;
        if (out[0].productId) patch.productId = out[0].productId;
      }
    }

    if (Object.keys(patch).length > 0) {
      writes.push({ id: l.id, patch: { ...patch, updatedAt: now } });
    }
  });

  for (let i = 0; i < writes.length; i += BATCH_LIMIT) {
    const batch = db.batch();
    writes.slice(i, i + BATCH_LIMIT).forEach((w) => {
      batch.set(db.collection(NEANDER_COL.salesLines).doc(w.id), w.patch, { merge: true });
    });
    await batch.commit();
  }

  return { attached, detached, resolved };
}
