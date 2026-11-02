import "server-only";

// ============================================================
//  큰 완성 파일 — Firebase Storage(GCS) 버킷
// ------------------------------------------------------------
//  게시할 완성 파일은 수백 MB 라 Firestore 조각(파일 하나 60MB)에 담기 어렵다.
//  버킷이 있으면 완성 파일만 여기에 잠깐 두고, 게시가 끝나면 지운다(media.ts).
//  버킷이 없으면(2026-11-02 기준 아직 없음) bucketReady() 가 false 라 모두
//  예전처럼 Firestore 조각으로 간다 — 버킷을 켜는 순간 코드 수정 없이 바뀐다.
//
//  브라우저는 객체에 직접 닿지 않는다 (storage.rules 의 neander_shorts 는 닫힘):
//   · 올리기 — 서버가 연 재개형 업로드 세션 주소(그 객체 하나만 쓸 수 있다)
//   · 보기 · 받기 — 만료되는 서명 URL
//   · Instagram — 같은 서명 URL 을 video_url 로 넘겨 Meta 가 직접 가져간다
// ============================================================

import { getStorage } from "firebase-admin/storage";
import { adminApp } from "@/lib/neander/server/admin";

const PREFIX = "neander_shorts/media";

export const bucketName = () => process.env.NEANDER_SHORTS_BUCKET?.trim() || process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET?.trim() || "";

const bucket = () => getStorage(adminApp()).bucket(bucketName());

let ready: { at: number; ok: boolean } | null = null;

/** 버킷이 실제로 있는가 — 있으면 10분, 없으면 2분 기억한다 (켜자마자 곧 바뀌게) */
export async function bucketReady(): Promise<boolean> {
  if (!bucketName()) return false;
  const now = Date.now();
  if (ready && now - ready.at < (ready.ok ? 10 * 60_000 : 2 * 60_000)) return ready.ok;
  let ok = false;
  try {
    [ok] = await bucket().exists();
  } catch {
    ok = false;
  }
  ready = { at: now, ok };
  return ok;
}

export const objectPath = (id: string) => `${PREFIX}/${id}`;

/**
 * 재개형 업로드 세션을 연다. origin 을 주면 그 사이트의 브라우저가 세션 주소로
 * 바로 PUT 할 수 있다 (GCS 가 세션 응답에 CORS 헤더를 붙인다).
 */
export async function startBucketUpload(path: string, type: string, size: number, origin: string | null): Promise<string> {
  const [uri] = await bucket()
    .file(path)
    .createResumableUpload({ metadata: { contentType: type, contentLength: size }, ...(origin ? { origin } : {}) });
  return uri;
}

/**
 * 세션이 어디까지 받았나 — 끊긴 올리기를 이어 갈 때.
 * 308 + Range: bytes=0-N → N+1 바이트 받음 · 200/201 → 다 받음 · 404/410 → 세션 만료
 */
export async function bucketUploadOffset(sessionUri: string, size: number): Promise<{ offset: number; complete: boolean; expired: boolean }> {
  const u = new URL(sessionUri);
  if (u.protocol !== "https:" || u.hostname !== "storage.googleapis.com") throw new Error("업로드 세션 주소가 올바르지 않습니다.");
  const res = await fetch(u.href, { method: "PUT", headers: { "Content-Range": `bytes */${size}` }, redirect: "manual", signal: AbortSignal.timeout(20_000) });
  await res.arrayBuffer().catch(() => undefined);
  if (res.status === 200 || res.status === 201) return { offset: size, complete: true, expired: false };
  if (res.status === 404 || res.status === 410) return { offset: 0, complete: false, expired: true };
  if (res.status !== 308) throw new Error(`업로드 상태를 확인하지 못했습니다 (${res.status}).`);
  const m = /bytes=0-(\d+)/.exec(res.headers.get("Range") ?? "");
  return { offset: m ? Number(m[1]) + 1 : 0, complete: false, expired: false };
}

export async function bucketObjectSize(path: string): Promise<number | null> {
  const f = bucket().file(path);
  const [exists] = await f.exists();
  if (!exists) return null;
  const [meta] = await f.getMetadata();
  return Number(meta.size ?? NaN);
}

/** [start, endExclusive) 바이트 */
export async function readBucketRange(path: string, start: number, endExclusive: number): Promise<Buffer> {
  if (endExclusive <= start) return Buffer.alloc(0);
  const [buf] = await bucket().file(path).download({ start, end: endExclusive - 1 });
  return buf;
}

/** 서명 URL (읽기) — 보기 · 받기 · Instagram video_url */
export async function bucketSignedUrl(path: string, opts: { ttlMs: number; downloadName?: string; type?: string }): Promise<string> {
  const [url] = await bucket()
    .file(path)
    .getSignedUrl({
      version: "v4",
      action: "read",
      expires: Date.now() + opts.ttlMs,
      ...(opts.downloadName ? { responseDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(opts.downloadName)}` } : {}),
      ...(opts.type ? { responseType: opts.type } : {}),
    });
  return url;
}

export async function deleteBucketObject(path: string): Promise<void> {
  await bucket().file(path).delete({ ignoreNotFound: true });
}
