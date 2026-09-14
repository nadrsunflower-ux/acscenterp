// ============================================================
//  휴지통 · 되쓰기 바탕 — 매출·재무 mutate 공용
// ------------------------------------------------------------
//  화면은 필드를 줄인 문서를 들고 있다 (finance/payload.ts · sales/payload.ts).
//  그 사본으로 되돌리기를 하면 숨긴 필드(dedupHash·importId 등)가 지워진다.
//  그래서 되쓸 때는 **지금 문서**에서 빠진 필드를 채우고, 이미 지워진 문서라면
//  지우기 직전에 남겨 둔 **휴지통 원본**에서 채운다.
// ============================================================

import type { Firestore } from "firebase-admin/firestore";

const CHUNK = 200;

/** 지우기 전에 원본을 휴지통에 남기고 지운다 (문서 id 는 그대로) */
export async function moveToTrash(
  db: Firestore,
  liveCol: string,
  trashCol: string,
  ids: string[],
  by: string | undefined,
  now: number,
): Promise<void> {
  const live = db.collection(liveCol);
  const trash = db.collection(trashCol);
  const uniq = [...new Set(ids.filter(Boolean))];
  for (let i = 0; i < uniq.length; i += CHUNK) {
    const snaps = await db.getAll(...uniq.slice(i, i + CHUNK).map((id) => live.doc(id)));
    const batch = db.batch();
    snaps.forEach((snap) => {
      if (snap.exists) {
        batch.set(trash.doc(snap.id), { doc: snap.data(), deletedAt: now, deletedBy: by ?? null });
      }
      batch.delete(live.doc(snap.id));
    });
    await batch.commit();
  }
}

/** 되쓸 행의 바탕 — 지금 문서, 없으면 휴지통 원본 */
export async function readBases(
  db: Firestore,
  liveCol: string,
  trashCol: string,
  ids: string[],
): Promise<Map<string, Record<string, unknown>>> {
  const out = new Map<string, Record<string, unknown>>();
  const uniq = [...new Set(ids.filter(Boolean))];
  const live = db.collection(liveCol);
  for (let i = 0; i < uniq.length; i += CHUNK) {
    const snaps = await db.getAll(...uniq.slice(i, i + CHUNK).map((id) => live.doc(id)));
    snaps.forEach((snap) => {
      if (snap.exists) out.set(snap.id, snap.data() as Record<string, unknown>);
    });
  }
  const missing = uniq.filter((id) => !out.has(id));
  const trash = db.collection(trashCol);
  for (let i = 0; i < missing.length; i += CHUNK) {
    const snaps = await db.getAll(...missing.slice(i, i + CHUNK).map((id) => trash.doc(id)));
    snaps.forEach((snap) => {
      const doc = snap.exists ? (snap.data()?.doc as Record<string, unknown> | undefined) : undefined;
      if (doc) out.set(snap.id, doc);
    });
  }
  return out;
}

/** 되쓸 행에 빠진 숨김 필드를 바탕 문서에서 채운다 */
export function fillHidden(
  row: Record<string, unknown>,
  base: Record<string, unknown> | undefined,
  fields: readonly string[],
): Record<string, unknown> {
  if (!base) return row;
  const out = { ...row };
  fields.forEach((f) => {
    if (out[f] === undefined && base[f] !== undefined) out[f] = base[f];
  });
  return out;
}
