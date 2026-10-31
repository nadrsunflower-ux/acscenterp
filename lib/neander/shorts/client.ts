"use client";

// ============================================================
//  쇼핑쇼츠 — 화면에서 부르는 쪽 (api/neander/shorts/*)
// ------------------------------------------------------------
//  운영 데이터는 전부 서버에 있다. 브라우저 저장소(IndexedDB)는 내려받은 영상·음성
//  파일의 **사본**만 둔다 — 같은 파일을 편집·미리보기마다 다시 받지 않으려고.
//  사본이 없어도(다른 기기 · 지운 경우) 서버에서 다시 받는다.
// ============================================================

import { getNeanderAuth } from "@/lib/neander/firebase";
import type { MediaKind, MediaView } from "./types";

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
  const res = await fetch(`/api/neander/shorts/${path}`, { headers: { Authorization: `Bearer ${await token()}` }, cache: "no-store" });
  if (!res.ok) throw await readError(res);
  return (await res.json()) as T;
}

export async function shortsPost<T>(path: string, body: object): Promise<T> {
  const res = await fetch(`/api/neander/shorts/${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" },
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
}

/** 768KB 조각으로 올린다 (동시에 3개). 다 오르면 서버가 조각 수를 세어 확정한다 */
export async function uploadMedia(blob: Blob, meta: UploadMeta, onProgress?: (p: number) => void, signal?: AbortSignal): Promise<MediaView> {
  const created = await shortsPost<{ id: string; partBytes: number; parts: number }>("media", { action: "create", size: blob.size, ...meta });
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
