// ============================================================
//  매출 마스터 적재 — 상품 · 기본가정 · 이벤트
// ------------------------------------------------------------
//  ⚠️ "server-only" 를 쓰지 않는다. 이 함수는 Firestore 인스턴스를 **인자로**
//     받아 비밀을 품지 않고, CLI(scripts/neander/import-sales-xlsx.ts)와
//     API 라우트가 같은 함수를 써야 적재 규칙이 갈라지지 않는다.
//     재무 finance/server/seed.ts 도 같은 이유로 가드를 두지 않았다.
//     (자격증명을 쥐는 admin.ts 쪽에 가드가 있다.)
//  재무 마스터 적재(finance/server/seed.ts)와 같은 규칙을 따른다:
//   - 상품 · 기본가정 : 엑셀이 정본이므로 **덮어쓴다** (문서 id = 상품코드)
//   - 이벤트          : 방문자수·준비물은 사람이 나중에 고치는 값이므로
//                       **이미 있으면 건드리지 않는다.** 덮어쓰면 손으로
//                       고친 전환율이 매번 날아간다.
// ============================================================

import type { Firestore } from "firebase-admin/firestore";
import { NEANDER_COL } from "../../collections";
import { SEED_ASSUMPTIONS, SEED_EVENTS, SEED_PRODUCTS } from "../master-data";

const BATCH_LIMIT = 450;

function clean(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  Object.keys(obj).forEach((k) => {
    if (obj[k] !== undefined) out[k] = obj[k];
  });
  return out;
}

export interface SalesSeedResult {
  products: number;
  events: number;
  eventsKept: number;
  assumptions: boolean;
}

export async function seedSalesMasterData(db: Firestore): Promise<SalesSeedResult> {
  const now = Date.now();

  // ---- 상품 (덮어쓰기) -------------------------------------
  let products = 0;
  for (let i = 0; i < SEED_PRODUCTS.length; i += BATCH_LIMIT) {
    const batch = db.batch();
    SEED_PRODUCTS.slice(i, i + BATCH_LIMIT).forEach((p) => {
      const { id, ...rest } = p;
      batch.set(db.collection(NEANDER_COL.salesProducts).doc(id), clean({ ...rest, id }), {
        merge: true,
      });
      products += 1;
    });
    await batch.commit();
  }

  // ---- 기본가정 (덮어쓰기) ---------------------------------
  await db
    .collection(NEANDER_COL.salesAssumptions)
    .doc("current")
    .set(clean({ ...SEED_ASSUMPTIONS, updatedAt: now }), { merge: true });

  // ---- 이벤트 (있으면 보존) --------------------------------
  const existing = await db.collection(NEANDER_COL.salesEvents).get();
  const have = new Set(existing.docs.map((d) => d.id));
  let events = 0;
  let eventsKept = 0;
  const batch = db.batch();
  SEED_EVENTS.forEach((e) => {
    if (have.has(e.id)) {
      eventsKept += 1;
      return;
    }
    const { id, ...rest } = e;
    batch.set(
      db.collection(NEANDER_COL.salesEvents).doc(id),
      clean({ ...rest, id, createdAt: now }),
    );
    events += 1;
  });
  if (events > 0) await batch.commit();

  return { products, events, eventsKept, assumptions: true };
}
