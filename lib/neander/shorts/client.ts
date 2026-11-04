"use client";

// ============================================================
//  쇼핑쇼츠 — 화면에서 부르는 쪽 (api/neander/shorts/*)
// ------------------------------------------------------------
//  운영 데이터는 전부 서버에 있다. 브라우저 저장소(IndexedDB)는 내려받은 영상·음성
//  파일의 **사본**만 둔다 — 같은 파일을 편집·미리보기마다 다시 받지 않으려고.
//  사본이 없어도(다른 기기 · 지운 경우) 서버에서 다시 받는다.
// ============================================================

import { getNeanderAuth } from "@/lib/neander/firebase";
import { SPACE_HEADER } from "./spaces";
import type { MediaKind, MediaView } from "./types";

/** 지금 고른 프로젝트 — ShortsProvider 가 정하고, 모든 요청 머리글에 붙인다 (서버 space-db.ts) */
let currentSpace = "";
export const setShortsSpace = (id: string) => {
  currentSpace = id;
};
const spaceHeader = (): Record<string, string> => (currentSpace ? { [SPACE_HEADER]: currentSpace } : {});

async function token(): Promise<string> {
  const user = getNeanderAuth().currentUser;
  if (!user) throw new Error("로그인이 필요합니다.");
  return user.getIdToken();
}

export class ShortsApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

async function readError(res: Response): Promise<ShortsApiError> {
  try {
    const b = (await res.json()) as { error?: string; code?: string };
    return new ShortsApiError(b.error || `요청이 실패했습니다 (HTTP ${res.status})`, res.status, b.code);
  } catch {
    return new ShortsApiError(`요청이 실패했습니다 (HTTP ${res.status})`, res.status);
  }
}

export async function shortsGet<T>(path: string): Promise<T> {
  const res = await fetch(`/api/neander/shorts/${path}`, { headers: { Authorization: `Bearer ${await token()}`, ...spaceHeader() }, cache: "no-store" });
  if (!res.ok) throw await readError(res);
  return (await res.json()) as T;
}

/** 바이트로 답하는 읽기 (트렌드 노트 사진 등) — <img> 는 로그인 머리글을 못 붙여서 Blob 으로 받아 주소를 만든다 */
export async function shortsBlob(path: string, signal?: AbortSignal): Promise<Blob> {
  const res = await fetch(`/api/neander/shorts/${path}`, { headers: { Authorization: `Bearer ${await token()}`, ...spaceHeader() }, signal });
  if (!res.ok) throw await readError(res);
  return res.blob();
}

export async function shortsPost<T>(path: string, body: object): Promise<T> {
  const res = await fetch(`/api/neander/shorts/${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json", ...spaceHeader() },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await readError(res);
  return (await res.json()) as T;
}

export const mutate = <T = { ok: true }>(action: string, body: object = {}) => shortsPost<T>("mutate", { action, ...body });

// ---- 파일 올리기 · 받기 ------------------------------------------------

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export interface UploadMeta {
  /** 고객사 자료(제품 사진)면 "" 와 clientId */
  projectId: string;
  clientId?: string;
  kind: MediaKind;
  name: string;
  type: string;
  duration?: number | null;
  width?: number | null;
  height?: number | null;
  codecs?: { video: string | null; audio: string | null } | null;
  overlay?: { disclosure: boolean; text: string } | null;
  /** 다른 도구로 다 만든 영상을 바로 올린다 (kind=render) — 다 오르면 영상의 완성 파일이 된다 */
  direct?: boolean;
}

interface Created {
  id: string;
  partBytes: number;
  parts: number;
  store: "firestore" | "bucket";
  uploadUrl?: string;
}

/** 버킷 세션 주소로 from 바이트부터 끝까지 한 번에 보낸다 (진행률은 XHR 로) */
function putToBucket(url: string, blob: Blob, from: number, onBytes: (sent: number) => void, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    if (from > 0) xhr.setRequestHeader("Content-Range", `bytes ${from}-${blob.size - 1}/${blob.size}`);
    xhr.upload.onprogress = (e) => onBytes(from + e.loaded);
    xhr.onload = () => (xhr.status === 200 || xhr.status === 201 ? resolve() : reject(new Error(`저장소가 파일을 받지 않았습니다 (HTTP ${xhr.status}).`)));
    xhr.onerror = () => reject(new Error("올리는 도중 연결이 끊겼습니다."));
    xhr.onabort = () => reject(new DOMException("올리기를 멈췄습니다.", "AbortError"));
    signal?.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(from > 0 ? blob.slice(from) : blob);
  });
}

/**
 * 저장소(버킷)로 바로 — 끊기면 서버에 「어디까지 받았나」 를 물어 그 자리부터 이어 보낸다 (5번까지).
 * 브라우저 사본은 남기지 않는다 (수백 MB · 게시가 끝나면 서버에서도 지운다).
 */
async function uploadToBucket(blob: Blob, created: Created, onProgress?: (p: number) => void, signal?: AbortSignal) {
  let from = 0;
  for (let attempt = 0; ; attempt++) {
    try {
      await putToBucket(created.uploadUrl!, blob, from, (sent) => onProgress?.(Math.min(0.99, sent / blob.size)), signal);
      return;
    } catch (e) {
      if (signal?.aborted || (e instanceof DOMException && e.name === "AbortError") || attempt >= 4) throw e;
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      const st = await shortsPost<{ offset: number; complete: boolean }>("media", { action: "status", id: created.id });
      if (st.complete) return;
      from = st.offset;
    }
  }
}

/**
 * 올리기. 서버가 저장 방식을 정한다 — 완성 파일은 버킷(켜져 있으면), 나머지는 768KB 조각(동시에 3개).
 * 다 오르면 서버가 크기 · 조각 수를 확인해 확정한다.
 */
export async function uploadMedia(blob: Blob, meta: UploadMeta, onProgress?: (p: number) => void, signal?: AbortSignal): Promise<MediaView> {
  const created = await shortsPost<Created>("media", { action: "create", size: blob.size, ...meta });
  if (created.store === "bucket") {
    try {
      await uploadToBucket(blob, created, onProgress, signal);
      const { media } = await shortsPost<{ media: MediaView }>("media", { action: "done", id: created.id });
      onProgress?.(1);
      return media;
    } catch (e) {
      await shortsPost("media", { action: "delete", id: created.id }).catch(() => undefined);
      throw e;
    }
  }
  let done = 0;
  const queue = Array.from({ length: created.parts }, (_, n) => n);
  const worker = async () => {
    for (let n = queue.shift(); n !== undefined; n = queue.shift()) {
      if (signal?.aborted) throw new DOMException("올리기를 멈췄습니다.", "AbortError");
      const part = await blob.slice(n * created.partBytes, (n + 1) * created.partBytes).arrayBuffer();
      await shortsPost("media", { action: "part", id: created.id, n, base64: toBase64(part) });
      done++;
      onProgress?.(done / created.parts);
    }
  };
  try {
    await Promise.all([worker(), worker(), worker()]);
    const { media } = await shortsPost<{ media: MediaView }>("media", { action: "done", id: created.id });
    await cachePut(media.id, blob).catch(() => undefined);
    return media;
  } catch (e) {
    await shortsPost("media", { action: "delete", id: created.id }).catch(() => undefined);
    throw e;
  }
}

const inflight = new Map<string, Promise<Blob>>();

/** 파일 내용 — 브라우저 사본이 있으면 그것, 없으면 서버에서 조각으로 받는다 */
export function loadMedia(id: string, onProgress?: (p: number) => void): Promise<Blob> {
  const hit = inflight.get(id);
  if (hit) return hit;
  const p = (async () => {
    const cached = await cacheGet(id).catch(() => null);
    if (cached) return cached;
    const { media } = await shortsGet<{ media: MediaView & { parts?: number } }>(`media?id=${encodeURIComponent(id)}&meta=1`);
    const parts = Math.ceil(media.size / (768 * 1024));
    const chunks: ArrayBuffer[] = [];
    for (let from = 0; from < parts; from += 5) {
      const res = await fetch(`/api/neander/shorts/media?id=${encodeURIComponent(id)}&from=${from}&count=5`, {
        headers: { Authorization: `Bearer ${await token()}` },
        cache: "no-store",
      });
      if (!res.ok) throw await readError(res);
      chunks.push(await res.arrayBuffer());
      onProgress?.(Math.min(1, (from + 5) / parts));
    }
    const blob = new Blob(chunks, { type: media.type });
    if (blob.size !== media.size) throw new Error(`「${media.name}」 을(를) 다 받지 못했습니다. 다시 시도해 주세요.`);
    await cachePut(id, blob).catch(() => undefined);
    return blob;
  })().finally(() => inflight.delete(id));
  inflight.set(id, p);
  return p;
}

export type MediaSource = { kind: "url"; url: string; revoke: boolean } | { kind: "purged"; reason: "published" | "expired" };

/**
 * 미리보기용 주소 — 브라우저 사본 → (저장소 파일이면) 서명 URL → 조각으로 받은 Blob.
 * 게시 뒤 내용을 지운 파일이면 purged.
 */
export async function mediaSource(id: string): Promise<MediaSource> {
  const cached = await cacheGet(id).catch(() => null);
  if (cached) return { kind: "url", url: URL.createObjectURL(cached), revoke: true };
  const { media } = await shortsGet<{ media: MediaView }>(`media?id=${encodeURIComponent(id)}&meta=1`);
  if (media.purged) return { kind: "purged", reason: media.purged.reason };
  if (media.store === "bucket") {
    const { url } = await shortsGet<{ url: string | null }>(`media?id=${encodeURIComponent(id)}&url=1`);
    if (url) return { kind: "url", url, revoke: false };
  }
  return { kind: "url", url: URL.createObjectURL(await loadMedia(id)), revoke: true };
}

/** 받기 — 저장소 파일은 서명 URL(첨부로 받기)로, 조각 파일은 Blob 으로 */
export async function downloadMedia(m: Pick<MediaView, "id" | "store">, name: string) {
  if (m.store === "bucket") {
    const { url } = await shortsGet<{ url: string | null }>(`media?id=${encodeURIComponent(m.id)}&url=1&download=1`);
    if (url) {
      const a = document.createElement("a");
      a.href = url;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
      return;
    }
  }
  downloadBlob(await loadMedia(m.id), name);
}

export async function deleteMedia(id: string) {
  await shortsPost("media", { action: "delete", id });
  await cacheDelete(id).catch(() => undefined);
}

export const listProjectMedia = (projectId: string) => shortsGet<{ media: MediaView[] }>(`media?projectId=${encodeURIComponent(projectId)}`).then((r) => r.media);
export const listClientMedia = (clientId: string) => shortsGet<{ media: MediaView[] }>(`media?clientId=${encodeURIComponent(clientId)}`).then((r) => r.media);

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export const safeFileName = (s: string) => s.replace(/[\\/:*?"<>|]+/g, "_").slice(0, 80) || "shorts";

// ---- 브라우저 사본 (IndexedDB · 보조) --------------------------------------

const DB = "neander-shorts-media";
const STORE = "files";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) return reject(new Error("no idb"));
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => {
      if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE);
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const req = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(req.result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  } finally {
    db.close();
  }
}

const cacheGet = async (id: string) => {
  const v = await tx<unknown>("readonly", (s) => s.get(id));
  return v instanceof Blob ? v : null;
};
const cachePut = (id: string, b: Blob) => tx("readwrite", (s) => s.put(b, id));
const cacheDelete = (id: string) => tx("readwrite", (s) => s.delete(id));

/** 브라우저 사본을 모두 지운다 (설정 화면) */
export const clearMediaCache = () => tx("readwrite", (s) => s.clear());

// ---- 실행기 신호 -------------------------------------------------------

/** 서버 작업을 만든 브라우저 — 셸 실행기가 이 값을 보고 더 자주 확인한다 */
export const PENDING_KEY = "neander.shorts.pendingJobsUntil";
export function notePendingJobs(untilMs = Date.now() + 6 * 3600_000) {
  try {
    const prev = Number(localStorage.getItem(PENDING_KEY)) || 0;
    localStorage.setItem(PENDING_KEY, String(Math.max(prev, untilMs)));
    window.dispatchEvent(new Event("neander-shorts-pending"));
  } catch {
    /* 저장소 접근 불가 */
  }
}
