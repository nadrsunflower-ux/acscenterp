import "server-only";

// ============================================================
//  AI STUDIO 일정 — 손으로 적는 일정 저장 (규칙 · 모으기는 ../calendar.ts)
// ------------------------------------------------------------
//  일정은 프로젝트(space)에 매인다 — 볼 수 있는 사람은 그 프로젝트 권한을 따른다
//  (자체 운영은 팀 공용 · 대행은 관리자와 그 업체 담당자). 고치기 · 지우기는 적은 사람이나 관리자.
//  늘 원래 컬렉션(neander_shorts_events)에 둔다 — 「모든 프로젝트」 로도 보려고.
// ============================================================

import { randomBytes } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import { AccessError } from "@/lib/neander/server/auth";
import { NEANDER_COL } from "@/lib/neander/collections";
import { sanitizeEvent, type ShortsEventDoc, type ShortsEventView } from "../calendar";
import { isSpaceId, spaceKind } from "../spaces";
import { isShortsAdmin } from "./access";
import { listSpacesFor, rootDb } from "./space-db";

const col = (db: Firestore) => rootDb(db).collection(NEANDER_COL.shortsEvents);
const isId = (v: unknown): v is string => typeof v === "string" && /^[\w-]{6,40}$/.test(v);

/** 볼 수 있는 프로젝트의 일정 — 최근 1년 · 앞으로 1년 */
export async function listEvents(db: Firestore, email: string, admin: boolean): Promise<ShortsEventView[]> {
  const visible = new Set((await listSpacesFor(db, email, admin, true)).map((s) => s.id));
  const from = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);
  const snap = await col(db).where("date", ">=", from).get();
  return snap.docs.map((d) => ({ ...(d.data() as ShortsEventDoc), id: d.id })).filter((e) => visible.has(e.spaceId)).sort((a, b) => a.date.localeCompare(b.date));
}

export async function saveEvent(db: Firestore, email: string, id: unknown, input: unknown): Promise<ShortsEventView> {
  const r = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const admin = isShortsAdmin(email);
  const prev = id ? ((await col(db).doc(String(id)).get()).data() as ShortsEventDoc | undefined) : undefined;
  if (id && (!isId(id) || !prev)) throw new AccessError(404, "일정을 찾지 못했습니다.");
  if (prev && prev.createdBy !== email && !admin) throw new AccessError(403, "적은 사람이나 AI STUDIO 관리자만 고칩니다.");
  const spaceId = typeof r.spaceId === "string" ? r.spaceId : prev?.spaceId;
  if (!isSpaceId(spaceId)) throw new Error("일정을 둘 프로젝트를 골라 주세요.");
  const space = (await listSpacesFor(db, email, admin, true)).find((s) => s.id === spaceId);
  if (!space) throw new AccessError(403, "그 프로젝트의 일정을 적을 수 없습니다.");
  const doc = sanitizeEvent(r, prev ?? null, email, space.id, spaceKind(space) === "agency" ? (space.clientId ?? null) : null);
  const ref = prev ? col(db).doc(String(id)) : col(db).doc(randomBytes(9).toString("base64url"));
  await ref.set(doc);
  return { ...doc, id: ref.id };
}

export async function deleteEvent(db: Firestore, email: string, id: unknown): Promise<void> {
  if (!isId(id)) throw new Error("일정 id 가 올바르지 않습니다.");
  const prev = (await col(db).doc(id).get()).data() as ShortsEventDoc | undefined;
  if (!prev) return;
  if (prev.createdBy !== email && !isShortsAdmin(email)) throw new AccessError(403, "적은 사람이나 AI STUDIO 관리자만 지웁니다.");
  await col(db).doc(id).delete();
}
