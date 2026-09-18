import "server-only";

// ============================================================
//  첨부 조각 저장소 — Firestore 에 768KB 씩
// ------------------------------------------------------------
//  두 한도 사이에 끼어 있다:
//    - Vercel 함수는 요청·응답 본문을 4.5MB 까지만 받는다
//    - 이 프로젝트에는 Firebase Storage 버킷이 없다 (parse.ts 주석)
//  그래서 20MB 첨부를 올릴 때는 브라우저가 조각으로 나눠 여러 번 보내고,
//  서버는 조각을 Firestore 문서(1MB 한도)에 하나씩 둔다. 보낼 때 모아 붙인다.
//  4MB 넘는 받은 첨부를 내려줄 때도 같은 길을 거꾸로 쓴다.
//
//    neander_mail_blobs/{id}            owner · 이름 · 크기 · 조각 수 · pinned
//      └─ parts/{n}                     data (bytes)
//
//  pinned 는 임시저장·예약이 잡고 있는 조각이다. 잡히지 않은 조각은 하루 뒤
//  지운다 (창을 닫아 버려진 첨부) — cleanupBlobs.
// ============================================================

import { randomBytes } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import { NEANDER_COL } from "@/lib/neander/collections";
import { BLOB_PART_BYTES, type MailBlobRef } from "../types";

export interface BlobDoc {
  owner: string;
  name: string;
  type: string;
  size: number;
  parts: number;
  pinned: boolean;
  createdAt: number;
}

const STALE_MS = 24 * 60 * 60 * 1000;

const blobRef = (db: Firestore, id: string) => db.collection(NEANDER_COL.mailBlobs).doc(id);
const partRef = (db: Firestore, id: string, n: number) => blobRef(db, id).collection("parts").doc(String(n));

const newId = () => randomBytes(12).toString("base64url");
const isId = (id: unknown): id is string => typeof id === "string" && /^[\w-]{10,40}$/.test(id);

async function ownBlob(db: Firestore, owner: string, id: unknown): Promise<BlobDoc> {
  if (!isId(id)) throw new Error("첨부 id 가 올바르지 않습니다.");
  const snap = await blobRef(db, id).get();
  const d = snap.data() as BlobDoc | undefined;
  if (!d || d.owner !== owner) throw new Error("첨부를 찾지 못했습니다. 다시 첨부해 주세요.");
  return d;
}

export async function createBlob(
  db: Firestore,
  owner: string,
  meta: { name: string; type: string; size: number },
): Promise<{ id: string; partBytes: number; parts: number }> {
  const parts = Math.max(1, Math.ceil(meta.size / BLOB_PART_BYTES));
  const id = newId();
  const doc: BlobDoc = {
    owner,
    name: String(meta.name).slice(0, 200) || "첨부",
    type: String(meta.type || "application/octet-stream").slice(0, 120),
    size: Number(meta.size) || 0,
    parts,
    pinned: false,
    createdAt: Date.now(),
  };
  await blobRef(db, id).set(doc);
  return { id, partBytes: BLOB_PART_BYTES, parts };
}

export async function putPart(db: Firestore, owner: string, id: string, n: number, data: Buffer): Promise<void> {
  const d = await ownBlob(db, owner, id);
  if (!Number.isInteger(n) || n < 0 || n >= d.parts) throw new Error("조각 번호가 올바르지 않습니다.");
  if (data.length > BLOB_PART_BYTES) throw new Error("조각이 너무 큽니다.");
  await partRef(db, id, n).set({ data });
}

/** 조각이 다 올라왔는지 */
export async function blobComplete(db: Firestore, owner: string, id: string): Promise<boolean> {
  const d = await ownBlob(db, owner, id);
  const agg = await blobRef(db, id).collection("parts").count().get();
  return agg.data().count === d.parts;
}

/** 조각 [from, from+count) 을 이어 붙인 바이트 */
export async function readParts(db: Firestore, owner: string, id: string, from: number, count: number) {
  const d = await ownBlob(db, owner, id);
  const refs = [];
  for (let n = from; n < Math.min(d.parts, from + count); n++) refs.push(partRef(db, id, n));
  const snaps = refs.length ? await db.getAll(...refs) : [];
  const bufs = snaps.map((s) => {
    const data = s.data()?.data as Buffer | undefined;
    if (!data) throw new Error("첨부 조각이 빠져 있습니다. 다시 첨부해 주세요.");
    return Buffer.from(data);
  });
  return { meta: d, bytes: Buffer.concat(bufs) };
}

export async function readBlob(db: Firestore, owner: string, id: string): Promise<{ meta: BlobDoc; bytes: Buffer }> {
  const d = await ownBlob(db, owner, id);
  const { bytes } = await readParts(db, owner, id, 0, d.parts);
  if (bytes.length !== d.size) throw new Error(`첨부 「${d.name}」이(가) 다 올라가지 않았습니다. 다시 첨부해 주세요.`);
  return { meta: d, bytes };
}

/** 서버가 만든 바이트를 조각으로 둔다 (큰 받은 첨부 내려주기) */
export async function saveBuffer(db: Firestore, owner: string, name: string, type: string, bytes: Buffer): Promise<MailBlobRef & { parts: number }> {
  const { id, parts } = await createBlob(db, owner, { name, type, size: bytes.length });
  // 한 번의 일괄 쓰기는 10MB 까지 — 8조각(6MB)씩 나눠 쓴다
  for (let start = 0; start < parts; start += 8) {
    const batch = db.batch();
    for (let n = start; n < Math.min(parts, start + 8); n++) {
      batch.set(partRef(db, id, n), { data: bytes.subarray(n * BLOB_PART_BYTES, (n + 1) * BLOB_PART_BYTES) });
    }
    await batch.commit();
  }
  return { id, name, type, size: bytes.length, parts };
}

export async function setPinned(db: Firestore, owner: string, ids: string[], pinned: boolean): Promise<void> {
  for (const id of ids) {
    if (!isId(id)) continue;
    const snap = await blobRef(db, id).get();
    if ((snap.data() as BlobDoc | undefined)?.owner === owner) await snap.ref.update({ pinned });
  }
}

export async function deleteBlobs(db: Firestore, owner: string, ids: string[]): Promise<void> {
  for (const id of ids) {
    if (!isId(id)) continue;
    const ref = blobRef(db, id);
    const snap = await ref.get();
    if ((snap.data() as BlobDoc | undefined)?.owner === owner) await db.recursiveDelete(ref);
  }
}

/** 하루 넘게 아무도 잡지 않은 조각을 지운다 (조금씩 — 확인 한 번에 몇 개만) */
export async function cleanupBlobs(db: Firestore, limit = 5): Promise<void> {
  const snap = await db
    .collection(NEANDER_COL.mailBlobs)
    .where("createdAt", "<", Date.now() - STALE_MS)
    .limit(limit * 4)
    .get();
  const stale = snap.docs.filter((d) => !(d.data() as BlobDoc).pinned).slice(0, limit);
  for (const d of stale) await db.recursiveDelete(d.ref);
}
