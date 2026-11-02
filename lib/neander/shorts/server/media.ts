import "server-only";

// ============================================================
//  쇼핑쇼츠 파일 — Firestore 768KB 조각 · 완성 파일은 Storage 버킷
// ------------------------------------------------------------
//  Firebase Storage 버킷이 없다 (2026-09-18 · 09-19 · 10-14 · 11-02 확인). 회의 첨부
//  (meetings/server/files.ts)와 같은 길을 간다: 브라우저가 조각으로 보내고
//  (Vercel 요청 4.5MB 한도), 서버는 조각마다 문서 하나 (1MB 한도).
//
//    neander_shorts_media/{id}      소유자 · 프로젝트 · 종류 · 크기 · 조각 수 · complete
//      └─ parts/{n}                 data (bytes)
//
//  ⚠️ Firestore 저장 용량은 ERP 전체(장부·매출·회의)와 나눠 쓴다. 그래서
//     모듈 전체 상한(NEANDER_SHORTS_MEDIA_QUOTA_MB, 기본 500MB)과 파일 하나
//     상한(60MB)을 둔다.
//
//  완성 파일(kind=render)은 버킷이 켜져 있으면 버킷으로 간다 (store=bucket ·
//  bucket.ts) — 하나 500MB · 버킷 전체 상한 NEANDER_SHORTS_BUCKET_QUOTA_MB(기본 5GB).
//  버킷이 없으면 예전처럼 조각(60MB). 부르는 쪽은 저장 방식을 모른다 —
//  createMedia · putPart · uploadStatus · completeMedia · readParts · readBytes ·
//  mediaUrl 만 안다.
//
//  완성 파일은 쌓아 두지 않는다 (사용자 결정 2026-11-02):
//   · 게시가 다 끝나면 내용을 지우고 기록만 남긴다 (purgeAfterPublish) — 링크로 본다.
//     올릴 수 있는 채널(연결된 계정)에 다 올렸으면 바로, 일부만이면 하루 뒤 (shouldPurgeRender)
//   · 아무 데도 안 올린 완성 파일은 7일 뒤 정리 (sweepExpiredRenders · 매일 cron)
//   · 영상 설정 「게시 뒤에도 파일 남기기」(publish.keepFiles)를 켜면 둘 다 안 한다
// ============================================================

import { randomBytes } from "node:crypto";
import { AggregateField, FieldValue, type Firestore } from "firebase-admin/firestore";
import { NEANDER_COL } from "@/lib/neander/collections";
import { canExpireRender, shouldPurgeRender } from "../model";
import type { MediaDoc, MediaKind, MediaView, ProjectDoc, PublicationDoc, PublishPlatform } from "../types";
import { AccessError } from "@/lib/neander/server/auth";
import { assertRead } from "./access";
import { listAccounts } from "./accounts";
import {
  bucketObjectSize,
  bucketReady,
  bucketSignedUrl,
  bucketUploadOffset,
  deleteBucketObject,
  objectPath,
  readBucketRange,
  startBucketUpload,
} from "./bucket";

export const PART_BYTES = 768 * 1024;
export const MAX_FILE_BYTES = 60 * 1024 * 1024;
/** 버킷에 두는 완성 파일 하나 */
export const MAX_BUCKET_FILE_BYTES = 500 * 1024 * 1024;
const STALE_MS = 24 * 60 * 60 * 1000;
/** 서명 URL 수명 — 화면 미리보기 · 받기 */
const VIEW_URL_TTL_MS = 60 * 60 * 1000;

export const quotaBytes = () => Math.max(50, Number(process.env.NEANDER_SHORTS_MEDIA_QUOTA_MB) || 500) * 1024 * 1024;
export const bucketQuotaBytes = () => Math.max(500, Number(process.env.NEANDER_SHORTS_BUCKET_QUOTA_MB) || 5000) * 1024 * 1024;

const col = (db: Firestore) => db.collection(NEANDER_COL.shortsMedia);
const partRef = (db: Firestore, id: string, n: number) => col(db).doc(id).collection("parts").doc(String(n));
const isId = (id: unknown): id is string => typeof id === "string" && /^[\w-]{10,40}$/.test(id);
const inBucket = (d: MediaDoc) => d.store === "bucket" && !!d.object;

const KINDS: MediaKind[] = ["source", "ai_scene", "voice", "recording", "audio", "image", "render"];

export const toMediaView = (id: string, d: MediaDoc): MediaView => {
  const { parts: _p, complete: _c, object: _o, uploadSession: _u, purgedSize: _s, bucketBytes: _b, ...rest } = d;
  return { id, ...rest };
};
const view = toMediaView;

/**
 * 지금 쥐고 있는 양 — 올리는 중인 파일도 센다 (자리를 잡아 둔 것이라 한도에 넣는 게 맞다).
 * 조건을 붙이거나 두 필드를 한 번에 합하면 복합 색인이 필요한데 색인을 게시할 권한이 없다
 * (2026-11-02 확인) — 그래서 필드 하나씩 전체 합만 세 번 구한다:
 *   size 전체 − purgedSize(지운 것) − bucketBytes(버킷에 쥔 것) = Firestore 조각으로 쥔 것
 */
export async function heldBytes(db: Firestore): Promise<{ firestore: number; bucket: number }> {
  const sum = async (field: string) => Number((await col(db).aggregate({ v: AggregateField.sum(field) }).get()).data().v) || 0;
  const [size, purged, bucket] = await Promise.all([sum("size"), sum("purgedSize"), sum("bucketBytes")]);
  return { firestore: Math.max(0, size - purged - bucket), bucket: Math.max(0, bucket) };
}

/** Firestore 조각으로 쥔 양 (예전 이름 — 상태 화면 · 한도) */
export async function usedBytes(db: Firestore): Promise<number> {
  return (await heldBytes(db)).firestore;
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

/** 지운(purged) 완성 파일도 기록으로 함께 준다 — 화면이 「게시 뒤 지움 · 링크」 로 보여 준다 */
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
  /** 다른 도구로 다 만든 영상을 바로 올린다 (kind=render) — 다 오르면 영상의 완성 파일 목록에 들어간다 */
  direct?: unknown;
  origin?: MediaDoc["origin"];
}

export interface CreatedMedia {
  id: string;
  partBytes: number;
  parts: number;
  store: "firestore" | "bucket";
  /** store=bucket — 브라우저가 파일을 바로 PUT 하는 재개형 세션 주소 (그 객체 하나만) */
  uploadUrl?: string;
}

const numOrNull = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);
const mb = (n: number) => Math.round(n / 1024 / 1024);

/** webOrigin — 브라우저가 버킷에 바로 올릴 때 그 사이트 주소 (CORS) */
export async function createMedia(db: Firestore, email: string, meta: CreateMediaInput, webOrigin: string | null = null): Promise<CreatedMedia> {
  // 고객사 자료(제품 실사진)는 프로젝트가 아니라 고객사에 묶는다
  const clientId = !meta.projectId && meta.clientId ? meta.clientId : null;
  if (clientId) await clientFor(db, clientId, email);
  else await projectFor(db, meta.projectId, email);
  const kind = KINDS.includes(meta.kind as MediaKind) ? (meta.kind as MediaKind) : null;
  if (!kind) throw new Error("파일 종류가 올바르지 않습니다.");
  const size = Number(meta.size) || 0;
  if (size <= 0) throw new Error("빈 파일은 올릴 수 없습니다.");
  const type = String(meta.type || "application/octet-stream").slice(0, 120);
  if (!/^(video|audio|image)\//.test(type)) throw new Error("영상 · 음성 · 이미지 파일만 올릴 수 있습니다.");
  const direct = kind === "render" && meta.direct === true && !clientId;
  if (direct && !/^video\/(mp4|quicktime)$/.test(type)) throw new Error("완성 파일은 MP4(또는 MOV) 영상이어야 합니다.");
  // 완성 파일은 버킷이 켜져 있으면 버킷으로 (게시 뒤 지우므로 쌓이지 않는다)
  const toBucket = kind === "render" && !clientId && (await bucketReady());
  const held = await heldBytes(db);
  if (toBucket) {
    if (size > MAX_BUCKET_FILE_BYTES) throw new Error(`완성 파일 하나는 ${mb(MAX_BUCKET_FILE_BYTES)}MB 까지 올릴 수 있습니다. 내보내기 화질을 낮춰 다시 만들어 주세요.`);
    if (held.bucket + size > bucketQuotaBytes()) {
      throw new Error(`게시를 기다리는 완성 파일이 저장 한도(${mb(bucketQuotaBytes())}MB)에 찼습니다. 지금 ${mb(held.bucket)}MB — 게시를 마치거나 안 쓸 완성 파일을 지워 주세요.`);
    }
  } else {
    if (size > MAX_FILE_BYTES) {
      throw new Error(
        kind === "render"
          ? `완성 파일은 지금 ${mb(MAX_FILE_BYTES)}MB 까지 올릴 수 있습니다. Firebase Storage 를 켜면 ${mb(MAX_BUCKET_FILE_BYTES)}MB 까지 됩니다.`
          : `파일 하나는 ${mb(MAX_FILE_BYTES)}MB 까지 올릴 수 있습니다. 원본을 줄여 올려 주세요.`,
      );
    }
    if (held.firestore + size > quotaBytes()) {
      throw new Error(
        `AI STUDIO 파일 저장 한도(${mb(quotaBytes())}MB)를 넘습니다. 지금 ${mb(held.firestore)}MB 를 쓰고 있습니다 — 끝난 영상의 원본을 지우거나 한도를 늘려 주세요.`,
      );
    }
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
    // 버킷 파일도 768KB 「가상 조각」 수를 적어 둔다 — 조각 단위로 받는 쪽(readParts · 검토 링크)이 그대로 쓴다
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
    store: toBucket ? "bucket" : "firestore",
    object: toBucket ? objectPath(id) : null,
    ...(toBucket ? { bucketBytes: size } : {}),
    direct,
  };
  if (toBucket) {
    doc.uploadSession = await startBucketUpload(doc.object!, type, size, webOrigin);
    await col(db).doc(id).set(doc);
    return { id, partBytes: PART_BYTES, parts: doc.parts, store: "bucket", uploadUrl: doc.uploadSession };
  }
  await col(db).doc(id).set(doc);
  return { id, partBytes: PART_BYTES, parts: doc.parts, store: "firestore" };
}

export async function putPart(db: Firestore, email: string, id: unknown, n: number, data: Buffer): Promise<void> {
  if (!isId(id)) throw new Error("파일 id 가 올바르지 않습니다.");
  const d = (await col(db).doc(id).get()).data() as MediaDoc | undefined;
  if (!d || d.owner !== email || d.complete || inBucket(d)) throw new Error("이 파일에는 조각을 더 넣을 수 없습니다.");
  if (!Number.isInteger(n) || n < 0 || n >= d.parts) throw new Error("조각 번호가 올바르지 않습니다.");
  if (data.length > PART_BYTES || data.length === 0) throw new Error("조각 크기가 올바르지 않습니다.");
  await partRef(db, id, n).set({ data });
}

/** 버킷 올리기가 끊겼을 때 — 어디서부터 이어 보내면 되나 */
export async function uploadStatus(db: Firestore, email: string, id: unknown): Promise<{ offset: number; complete: boolean }> {
  if (!isId(id)) throw new Error("파일 id 가 올바르지 않습니다.");
  const d = (await col(db).doc(id).get()).data() as MediaDoc | undefined;
  if (!d || d.owner !== email) throw new Error("올리기 시작한 사람만 확인할 수 있습니다.");
  if (!inBucket(d) || !d.uploadSession) throw new Error("이어 올릴 수 있는 파일이 아닙니다.");
  const st = await bucketUploadOffset(d.uploadSession, d.size);
  if (st.expired) throw new Error("업로드 세션이 만료됐습니다. 처음부터 다시 올려 주세요.");
  return { offset: st.offset, complete: st.complete };
}

export async function completeMedia(db: Firestore, email: string, id: unknown): Promise<MediaView> {
  if (!isId(id)) throw new Error("파일 id 가 올바르지 않습니다.");
  const d = (await col(db).doc(id).get()).data() as MediaDoc | undefined;
  if (!d || d.owner !== email) throw new Error("올리기 시작한 사람만 마칠 수 있습니다.");
  if (inBucket(d)) {
    const size = await bucketObjectSize(d.object!);
    if (size !== d.size) throw new Error(`「${d.name}」 이(가) 다 올라가지 않았습니다. 다시 올려 주세요.`);
    await col(db).doc(id).update({ complete: true, uploadSession: FieldValue.delete() });
  } else {
    const agg = await col(db).doc(id).collection("parts").count().get();
    if (agg.data().count !== d.parts) throw new Error(`「${d.name}」 이(가) 다 올라가지 않았습니다. 다시 올려 주세요.`);
    await col(db).doc(id).update({ complete: true });
  }
  // 바로 올린 완성 파일 — 출력 작업을 거치지 않으니 여기서 영상의 완성 파일 목록에 넣는다
  if (d.direct && d.kind === "render" && d.projectId) {
    const { patchProject } = await import("./store");
    await patchProject(db, d.projectId, email, (p) => {
      if (!p.renderIds.includes(id)) p.renderIds.push(id);
      if (["research", "sourcing", "matching", "scripting", "editing"].includes(p.stage)) p.stage = "ready";
    });
  }
  const { uploadSession: _u, ...rest } = d;
  return view(id, { ...rest, complete: true });
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

const purgedMessage = (d: MediaDoc) =>
  `「${d.name}」 은(는) ${d.purged?.reason === "published" ? "게시가 끝나" : "오래 쓰이지 않아"} 내용을 지웠습니다 — 게시물 링크로 보거나 새 완성 파일을 올려 주세요.`;

export async function readParts(db: Firestore, email: string, id: unknown, from: number, count: number, admin = false): Promise<Buffer> {
  const d = await getMedia(db, id, email, admin);
  if (!d.complete) throw new Error("아직 올라가는 중인 파일입니다.");
  if (d.purged) throw new Error(purgedMessage(d));
  return readRange(db, d.id, d, from, count);
}

/** 조각 단위 받기 — 접근 확인은 부르는 쪽이 했다 (검토 링크 · readParts) */
export async function readRange(db: Firestore, id: string, d: MediaDoc, from: number, count: number): Promise<Buffer> {
  if (inBucket(d)) return readBucketRange(d.object!, from * PART_BYTES, Math.min(d.size, (from + count) * PART_BYTES));
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

/** 바이트 [start, endExclusive) — 게시(YouTube 나눠 보내기)용. 접근 확인은 부르는 쪽이 이미 했다 */
export async function readBytes(db: Firestore, id: string, d: MediaDoc, start: number, endExclusive: number): Promise<Buffer> {
  const end = Math.min(d.size, endExclusive);
  if (end <= start) return Buffer.alloc(0);
  if (d.purged) throw new Error(purgedMessage(d));
  if (inBucket(d)) return readBucketRange(d.object!, start, end);
  const first = Math.floor(start / PART_BYTES);
  const last = Math.ceil(end / PART_BYTES);
  const buf = await readRange(db, id, d, first, last - first);
  return buf.subarray(start - first * PART_BYTES, end - first * PART_BYTES);
}

/** 게시 · 서버 처리용 — 접근 확인은 부르는 쪽이 이미 했다 */
export async function readWhole(db: Firestore, id: string): Promise<{ doc: MediaDoc; bytes: Buffer }> {
  const d = (await col(db).doc(id).get()).data() as MediaDoc | undefined;
  if (!d || !d.complete) throw new Error("파일을 찾지 못했습니다.");
  if (d.purged) throw new Error(purgedMessage(d));
  return { doc: d, bytes: await readRange(db, id, d, 0, d.parts) };
}

/** 버킷 파일의 서명 URL — 조각 파일이면 null (조각으로 받는다) */
export async function mediaUrl(db: Firestore, email: string, id: unknown, opts: { admin?: boolean; download?: boolean } = {}): Promise<string | null> {
  const d = await getMedia(db, id, email, opts.admin);
  if (!d.complete) throw new Error("아직 올라가는 중인 파일입니다.");
  if (d.purged) throw new Error(purgedMessage(d));
  if (!inBucket(d)) return null;
  return bucketSignedUrl(d.object!, { ttlMs: VIEW_URL_TTL_MS, type: d.type, ...(opts.download ? { downloadName: d.name } : {}) });
}

/** 버킷 파일 보기 주소 (접근 확인은 부르는 쪽이 했다 — 검토 링크) · 조각 파일이면 null */
export async function viewUrl(d: MediaDoc): Promise<string | null> {
  if (!inBucket(d) || d.purged) return null;
  return bucketSignedUrl(d.object!, { ttlMs: VIEW_URL_TTL_MS, type: d.type });
}

/** Instagram 이 직접 가져갈 주소 (video_url) — 처리가 몇 분 걸려도 넉넉하게 */
export async function publishUrl(d: MediaDoc): Promise<string | null> {
  if (!inBucket(d) || d.purged) return null;
  return bucketSignedUrl(d.object!, { ttlMs: 6 * 60 * 60 * 1000, type: d.type });
}

/** 내용(조각 · 버킷 객체)만 지운다 */
async function dropBytes(db: Firestore, id: string, d: MediaDoc) {
  if (inBucket(d)) await deleteBucketObject(d.object!);
  else await db.recursiveDelete(col(db).doc(id).collection("parts"));
}

/** 내용은 지우고 기록(이름 · 크기 · 길이 · 코덱)은 남긴다 — 게시 기록 · 화면이 이 id 를 계속 가리킨다 */
export async function purgeMedia(db: Firestore, id: string, reason: "published" | "expired", by: string): Promise<boolean> {
  const ref = col(db).doc(id);
  const d = (await ref.get()).data() as MediaDoc | undefined;
  if (!d || !d.complete || d.purged) return false;
  await dropBytes(db, id, d);
  await ref.update({
    purged: { at: Date.now(), reason, by },
    // 지운 크기는 한도 계산에서 뺀다 (size 는 기록으로 남긴다) — heldBytes 참고
    ...(inBucket(d) ? { bucketBytes: 0 } : { purgedSize: d.size }),
    uploadSession: FieldValue.delete(),
  });
  return true;
}

async function renderPublications(db: Firestore, renderId: string) {
  const snap = await db.collection(NEANDER_COL.shortsPublications).where("renderId", "==", renderId).get();
  return snap.docs.map((x) => x.data() as PublicationDoc);
}

/**
 * 이 영상을 올릴 수 있는 채널 — 파일을 올린 사람 · 게시한 사람이 쓸 수 있는 계정의 플랫폼
 * (게시 탭의 계정 고르기와 같은 기준: 고객사 영상은 그 고객사 계정 + 우리 채널, 나머지는 고객사 계정 빼고)
 */
async function publishablePlatforms(db: Firestore, p: ProjectDoc, emails: string[]): Promise<PublishPlatform[]> {
  const out = new Set<PublishPlatform>();
  for (const email of new Set(emails)) {
    for (const a of await listAccounts(db, email).catch(() => [])) {
      if (!a.canPublish) continue;
      if (p.kind === "brand" ? !!a.clientId && a.clientId !== p.clientId : !!a.clientId) continue;
      out.add(a.platform);
    }
  }
  return [...out];
}

async function purgeDue(db: Firestore, d: MediaDoc, p: ProjectDoc, renderId: string, now: number): Promise<{ due: boolean; pubs: PublicationDoc[] }> {
  const pubs = await renderPublications(db, renderId);
  if (!pubs.some((x) => x.status === "published")) return { due: false, pubs };
  const platforms = await publishablePlatforms(db, p, [d.owner, ...pubs.map((x) => x.owner)]);
  const due = shouldPurgeRender({ pubs: pubs.map((x) => ({ status: x.status, platform: x.platform, at: x.result?.at ?? x.updatedAt })), platforms, now });
  return { due, pubs };
}

/**
 * 게시가 하나 끝날 때마다 부른다 — 올릴 수 있는 채널에 다 올렸으면 내용을 지운다.
 * 일부만 올렸거나 실패 · 결과 확인 필요 · 보내는 중 · 예약이 남아 있으면 그대로 둔다 (매일 정리가 하루 뒤 본다).
 */
export async function purgeAfterPublish(db: Firestore, renderId: string, now = Date.now()): Promise<boolean> {
  const d = (await col(db).doc(renderId).get()).data() as MediaDoc | undefined;
  if (!d || d.kind !== "render" || !d.complete || d.purged) return false;
  const p = (await db.collection(NEANDER_COL.shortsProjects).doc(d.projectId).get()).data() as ProjectDoc | undefined;
  if (!p || p.publish.keepFiles) return false;
  if (!(await purgeDue(db, d, p, renderId, now)).due) return false;
  return purgeMedia(db, renderId, "published", "게시 완료");
}

/**
 * 완성 파일 하나 정리 — 게시가 끝났으면(하루 유예 포함) 「published」, 7일 넘게 아무 데도
 * 안 올렸으면 「expired」 로 내용을 지운다. 지우지 않으면 null.
 */
export async function tidyRender(db: Firestore, id: string, now = Date.now()): Promise<"published" | "expired" | null> {
  const d = (await col(db).doc(id).get()).data() as MediaDoc | undefined;
  if (!d || d.kind !== "render" || !d.complete || d.purged || !d.projectId) return null;
  const p = (await db.collection(NEANDER_COL.shortsProjects).doc(d.projectId).get()).data() as ProjectDoc | undefined;
  if (!p) return null; // 영상이 지워지면 deleteProjectMedia 가 함께 지운다
  if (p.publish.keepFiles) return null;
  const { due, pubs } = await purgeDue(db, d, p, id, now);
  if (due) return (await purgeMedia(db, id, "published", "매일 정리")) ? "published" : null;
  // 게시된 파일은 위 규칙(하루 유예)만 따른다 — 7일 규칙은 아무 데도 안 올린 파일용
  if (pubs.some((y) => y.status === "published")) return null;
  const inReview = (p.review?.rounds ?? []).some((r) => r.renderId === id && (r.decision === "pending" || r.decision === "approved"));
  if (!canExpireRender({ createdAt: d.createdAt, statuses: pubs.map((y) => y.status), inReview, now })) return null;
  return (await purgeMedia(db, id, "expired", "매일 정리")) ? "expired" : null;
}

/** 매일 cron — 모든 완성 파일에 tidyRender (게시 끝난 것을 놓친 경우도 여기서) */
export async function sweepExpiredRenders(db: Firestore, now = Date.now()): Promise<number> {
  const snap = await col(db).where("kind", "==", "render").get();
  let n = 0;
  for (const x of snap.docs) {
    const d = x.data() as MediaDoc;
    if (!d.complete || d.purged) continue;
    if (await tidyRender(db, x.id, now).catch(() => null)) n++;
  }
  return n;
}

export async function deleteMedia(db: Firestore, email: string, id: unknown): Promise<void> {
  const d = await getMedia(db, id, email);
  // 팀 프로젝트의 파일은 팀 누구나 지운다 (회의 첨부와 같다). 비공개는 getMedia 가 이미 막았다
  if (inBucket(d)) await deleteBucketObject(d.object!);
  await db.recursiveDelete(col(db).doc(d.id));
}

export async function deleteProjectMedia(db: Firestore, projectId: string): Promise<number> {
  const snap = await col(db).where("projectId", "==", projectId).get();
  for (const d of snap.docs) {
    const m = d.data() as MediaDoc;
    if (inBucket(m)) await deleteBucketObject(m.object!).catch(() => undefined);
    await db.recursiveDelete(d.ref);
  }
  return snap.size;
}

/** 끊긴 업로드 치우기 (하루 지난 미완성) */
export async function sweepStaleMedia(db: Firestore): Promise<number> {
  const snap = await col(db).where("complete", "==", false).get();
  let n = 0;
  for (const d of snap.docs) {
    const m = d.data() as MediaDoc;
    if (m.createdAt < Date.now() - STALE_MS) {
      if (inBucket(m)) await deleteBucketObject(m.object!).catch(() => undefined);
      await db.recursiveDelete(d.ref);
      n++;
    }
  }
  return n;
}
