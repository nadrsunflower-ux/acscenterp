import "server-only";

// ============================================================
//  쇼핑쇼츠 파일 — Firestore 768KB 조각
// ------------------------------------------------------------
//  Firebase Storage 버킷이 없다 (2026-09-18 · 09-19 · 10-14 확인). 회의 첨부
//  (meetings/server/files.ts)와 같은 길을 간다: 브라우저가 조각으로 보내고
//  (Vercel 요청 4.5MB 한도), 서버는 조각마다 문서 하나 (1MB 한도).
//
//    neander_shorts_media/{id}      소유자 · 프로젝트 · 종류 · 크기 · 조각 수 · complete
//      └─ parts/{n}                 data (bytes)
//
//  ⚠️ Firestore 저장 용량은 ERP 전체(장부·매출·회의)와 나눠 쓴다. 그래서
//     모듈 전체 상한(NEANDER_SHORTS_MEDIA_QUOTA_MB, 기본 500MB)과 파일 하나
//     상한(60MB)을 둔다. 버킷이 켜지면 이 파일만 바꾸면 된다 — 부르는 쪽은
//     createMedia · putPart · completeMedia · readParts · readWhole 만 안다.
// ============================================================

import { randomBytes } from "node:crypto";
import { AggregateField, type Firestore } from "firebase-admin/firestore";
import { NEANDER_COL } from "@/lib/neander/collections";
import type { MediaDoc, MediaKind, MediaView, ProjectDoc } from "../types";
import { AccessError } from "@/lib/neander/server/auth";
import { assertRead } from "./access";

export const PART_BYTES = 768 * 1024;
export const MAX_FILE_BYTES = 60 * 1024 * 1024;
const STALE_MS = 24 * 60 * 60 * 1000;

export const quotaBytes = () => Math.max(50, Number(process.env.NEANDER_SHORTS_MEDIA_QUOTA_MB) || 500) * 1024 * 1024;

const col = (db: Firestore) => db.collection(NEANDER_COL.shortsMedia);
const partRef = (db: Firestore, id: string, n: number) => col(db).doc(id).collection("parts").doc(String(n));
const isId = (id: unknown): id is string => typeof id === "string" && /^[\w-]{10,40}$/.test(id);

const KINDS: MediaKind[] = ["source", "ai_scene", "voice", "recording", "audio", "image", "render"];

const view = (id: string, d: MediaDoc): MediaView => {
  const { parts: _p, complete: _c, ...rest } = d;
  return { id, ...rest };
};

/**
 * 쓰는 양 — 올리는 중인 파일도 센다 (자리를 잡아 둔 것이라 한도에 넣는 게 맞다).
 * 조건(complete==true)을 붙이면 복합 색인이 필요한데 색인을 게시할 권한이 없다.
 */
export async function usedBytes(db: Firestore): Promise<number> {
  const snap = await col(db).aggregate({ total: AggregateField.sum("size") }).get();
  return Number(snap.data().total) || 0;
}

/** admin = 관리자 몰아보기(읽기). 올리기 · 지우기 경로는 넘기지 않는다 */
async function projectFor(db: Firestore, projectId: unknown, email: string, admin = false): Promise<ProjectDoc> {
  if (!isId(projectId)) throw new Error("영상 id 가 올바르지 않습니다.");
  const p = (await db.collection(NEANDER_COL.shortsProjects).doc(projectId).get()).data() as ProjectDoc | undefined;
  return assertRead(p, email, "영상", admin);
}

/** 고객사 자료(제품 사진) — 그 고객사 담당자 (관리자는 읽기) */
async function clientFor(db: Firestore, clientId: unknown, email: string, admin = false) {
  if (!isId(clientId)) throw new Error("고객사 id 가 올바르지 않습니다.");
  const c = (await db.collection(NEANDER_COL.shortsClients).doc(clientId).get()).data() as { members?: string[]; name?: string } | undefined;
  if (!c) throw new AccessError(404, "고객사를 찾지 못했습니다.");
  if (!c.members?.includes(email) && !admin) throw new AccessError(403, `「${c.name ?? "고객사"}」 의 담당자가 아닙니다.`);
  return c;
}

export async function getMedia(db: Firestore, id: unknown, email: string, admin = false): Promise<MediaDoc & { id: string }> {
  if (!isId(id)) throw new Error("파일 id 가 올바르지 않습니다.");
  const d = (await col(db).doc(id).get()).data() as MediaDoc | undefined;
  if (!d) throw new Error("파일을 찾지 못했습니다. 지워졌을 수 있습니다.");
  if (!d.projectId && d.clientId) await clientFor(db, d.clientId, email, admin);
  else await projectFor(db, d.projectId, email, admin);
  return { ...d, id };
}

export async function listClientMedia(db: Firestore, clientId: string, email: string, admin = false): Promise<MediaView[]> {
  await clientFor(db, clientId, email, admin);
  const snap = await col(db).where("clientId", "==", clientId).get();
  return snap.docs
    .map((d) => ({ id: d.id, d: d.data() as MediaDoc }))
    .filter((x) => x.d.complete && !x.d.projectId)
    .map((x) => view(x.id, x.d))
    .sort((a, b) => a.createdAt - b.createdAt);
}

export async function listProjectMedia(db: Firestore, projectId: string, email: string, admin = false): Promise<MediaView[]> {
  await projectFor(db, projectId, email, admin);
  const snap = await col(db).where("projectId", "==", projectId).get();
  return snap.docs
    .map((d) => ({ id: d.id, d: d.data() as MediaDoc }))
    .filter((x) => x.d.complete)
    .map((x) => view(x.id, x.d))
    .sort((a, b) => a.createdAt - b.createdAt);
}

export interface CreateMediaInput {
  projectId?: unknown;
  clientId?: unknown;
  kind?: unknown;
  name?: unknown;
  type?: unknown;
  size?: unknown;
  duration?: unknown;
  width?: unknown;
  height?: unknown;
  codecs?: unknown;
  overlay?: unknown;
  origin?: MediaDoc["origin"];
}

const numOrNull = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);

export async function createMedia(db: Firestore, email: string, meta: CreateMediaInput): Promise<{ id: string; partBytes: number; parts: number }> {
  // 고객사 자료(제품 실사진)는 프로젝트가 아니라 고객사에 묶는다
  const clientId = !meta.projectId && meta.clientId ? meta.clientId : null;
  if (clientId) await clientFor(db, clientId, email);
  else await projectFor(db, meta.projectId, email);
  const kind = KINDS.includes(meta.kind as MediaKind) ? (meta.kind as MediaKind) : null;
  if (!kind) throw new Error("파일 종류가 올바르지 않습니다.");
  const size = Number(meta.size) || 0;
  if (size <= 0) throw new Error("빈 파일은 올릴 수 없습니다.");
  if (size > MAX_FILE_BYTES) throw new Error(`파일 하나는 ${MAX_FILE_BYTES / 1024 / 1024}MB 까지 올릴 수 있습니다. 원본을 줄여 올려 주세요.`);
  const type = String(meta.type || "application/octet-stream").slice(0, 120);
  if (!/^(video|audio|image)\//.test(type)) throw new Error("영상 · 음성 · 이미지 파일만 올릴 수 있습니다.");
  const used = await usedBytes(db);
  if (used + size > quotaBytes()) {
    throw new Error(
      `AI STUDIO 파일 저장 한도(${Math.round(quotaBytes() / 1024 / 1024)}MB)를 넘습니다. 지금 ${Math.round(used / 1024 / 1024)}MB 를 쓰고 있습니다 — 끝난 영상의 원본을 지우거나 한도를 늘려 주세요.`,
    );
  }
  const codecs = meta.codecs as MediaDoc["codecs"];
  const overlay = meta.overlay as MediaDoc["overlay"];
  const id = randomBytes(12).toString("base64url");
  const doc: MediaDoc = {
    owner: email,
    projectId: clientId ? "" : (meta.projectId as string),
    clientId: clientId ? String(clientId) : null,
    kind,
    name: String(meta.name ?? "").slice(0, 200) || "파일",
    type,
    size,
    duration: numOrNull(meta.duration),
    width: numOrNull(meta.width),
    height: numOrNull(meta.height),
    parts: Math.ceil(size / PART_BYTES),
    complete: false,
    createdAt: Date.now(),
    origin: meta.origin ?? null,
    codecs:
      codecs && typeof codecs === "object"
        ? { video: typeof codecs.video === "string" ? codecs.video.slice(0, 40) : null, audio: typeof codecs.audio === "string" ? codecs.audio.slice(0, 40) : null }
        : null,
    overlay:
      overlay && typeof overlay === "object"
        ? { disclosure: overlay.disclosure === true, text: String(overlay.text ?? "").slice(0, 120) }
        : null,
  };
  await col(db).doc(id).set(doc);
  return { id, partBytes: PART_BYTES, parts: doc.parts };
}

export async function putPart(db: Firestore, email: string, id: unknown, n: number, data: Buffer): Promise<void> {
  if (!isId(id)) throw new Error("파일 id 가 올바르지 않습니다.");
  const d = (await col(db).doc(id).get()).data() as MediaDoc | undefined;
  if (!d || d.owner !== email || d.complete) throw new Error("이 파일에는 조각을 더 넣을 수 없습니다.");
  if (!Number.isInteger(n) || n < 0 || n >= d.parts) throw new Error("조각 번호가 올바르지 않습니다.");
  if (data.length > PART_BYTES || data.length === 0) throw new Error("조각 크기가 올바르지 않습니다.");
  await partRef(db, id, n).set({ data });
}

export async function completeMedia(db: Firestore, email: string, id: unknown): Promise<MediaView> {
  if (!isId(id)) throw new Error("파일 id 가 올바르지 않습니다.");
  const d = (await col(db).doc(id).get()).data() as MediaDoc | undefined;
  if (!d || d.owner !== email) throw new Error("올리기 시작한 사람만 마칠 수 있습니다.");
  const agg = await col(db).doc(id).collection("parts").count().get();
  if (agg.data().count !== d.parts) throw new Error(`「${d.name}」 이(가) 다 올라가지 않았습니다. 다시 올려 주세요.`);
  await col(db).doc(id).update({ complete: true });
  return view(id, { ...d, complete: true });
}

/** 서버가 만든 파일 (AI 영상 · 음성) 을 한 번에 저장한다 */
export async function saveBytes(
  db: Firestore,
  owner: string,
  meta: Omit<MediaDoc, "owner" | "parts" | "complete" | "createdAt" | "size">,
  bytes: Buffer,
): Promise<MediaView> {
  if (!bytes.length) throw new Error("빈 파일은 저장할 수 없습니다.");
  if (bytes.length > MAX_FILE_BYTES) throw new Error("생성된 파일이 저장 한도보다 큽니다.");
  const used = await usedBytes(db);
  if (used + bytes.length > quotaBytes()) throw new Error("AI STUDIO 파일 저장 한도를 넘어 생성 결과를 저장하지 못했습니다.");
  const id = randomBytes(12).toString("base64url");
  const parts = Math.ceil(bytes.length / PART_BYTES);
  const doc: MediaDoc = { ...meta, owner, size: bytes.length, parts, complete: false, createdAt: Date.now() };
  await col(db).doc(id).set(doc);
  for (let n = 0; n < parts; n++) {
    await partRef(db, id, n).set({ data: bytes.subarray(n * PART_BYTES, (n + 1) * PART_BYTES) });
  }
  await col(db).doc(id).update({ complete: true });
  return view(id, { ...doc, complete: true });
}

export async function readParts(db: Firestore, email: string, id: unknown, from: number, count: number, admin = false): Promise<Buffer> {
  const d = await getMedia(db, id, email, admin);
  if (!d.complete) throw new Error("아직 올라가는 중인 파일입니다.");
  return readRange(db, d.id, d, from, count);
}

async function readRange(db: Firestore, id: string, d: MediaDoc, from: number, count: number): Promise<Buffer> {
  const refs = [];
  for (let n = from; n < Math.min(d.parts, from + count); n++) refs.push(partRef(db, id, n));
  const snaps = refs.length ? await db.getAll(...refs) : [];
  return Buffer.concat(
    snaps.map((s) => {
      const data = s.data()?.data as Buffer | undefined;
      if (!data) throw new Error(`「${d.name}」 의 조각이 빠져 있습니다. 다시 올려 주세요.`);
      return Buffer.from(data);
    }),
  );
}

/** 게시 · 서버 처리용 — 접근 확인은 부르는 쪽이 이미 했다 */
export async function readWhole(db: Firestore, id: string): Promise<{ doc: MediaDoc; bytes: Buffer }> {
  const d = (await col(db).doc(id).get()).data() as MediaDoc | undefined;
  if (!d || !d.complete) throw new Error("파일을 찾지 못했습니다.");
  return { doc: d, bytes: await readRange(db, id, d, 0, d.parts) };
}

export async function deleteMedia(db: Firestore, email: string, id: unknown): Promise<void> {
  const d = await getMedia(db, id, email);
  // 팀 프로젝트의 파일은 팀 누구나 지운다 (회의 첨부와 같다). 비공개는 getMedia 가 이미 막았다
  await db.recursiveDelete(col(db).doc(d.id));
}

export async function deleteProjectMedia(db: Firestore, projectId: string): Promise<number> {
  const snap = await col(db).where("projectId", "==", projectId).get();
  for (const d of snap.docs) await db.recursiveDelete(d.ref);
  return snap.size;
}

/** 끊긴 업로드 치우기 (하루 지난 미완성) */
export async function sweepStaleMedia(db: Firestore): Promise<number> {
  const snap = await col(db).where("complete", "==", false).get();
  let n = 0;
  for (const d of snap.docs) {
    if ((d.data() as MediaDoc).createdAt < Date.now() - STALE_MS) {
      await db.recursiveDelete(d.ref);
      n++;
    }
  }
  return n;
}
