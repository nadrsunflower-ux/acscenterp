"use client";

// ============================================================
//  올리기 전 녹음 조각 — 브라우저 IndexedDB 에 잠깐 둔다
// ------------------------------------------------------------
//  3시간 녹음 중에 창이 닫히거나 인터넷이 끊겨도 녹음을 잃지 않게 한다.
//  ERP 녹음은 10초마다 나오는 토막(chunk)을 바로 여기 쓴다 — 창이 닫혀도
//  잃는 건 마지막 10초다. 다음에 ERP 를 열면 RecordingProvider 가 남은
//  조각을 찾아 이어서 올린다. 서버에 다 올라간 조각은 지운다.
//
//  IndexedDB 를 못 쓰는 창(사생활 보호 모드 등)이면 메모리에만 둔다 —
//  녹음은 되지만 창을 닫으면 올리지 못한 조각은 사라진다.
// ============================================================

import type { RecAudioFormat, RecordingSource } from "./recording";

export interface PendingSeg {
  recId: string;
  meetingId: string;
  source: RecordingSource;
  n: number;
  startSec: number;
  /** 닫힌 조각의 길이. 녹음 중인 조각은 토막 수로 어림한다 */
  durationSec: number;
  format: RecAudioFormat;
  /** 녹음이 끝난 조각인가 — false 면 녹음 중이었거나 창이 닫혀 끊긴 조각 */
  closed: boolean;
  createdAt: number;
}

interface ChunkRow {
  key: string;
  blob: Blob;
}

const DB_NAME = "neander-meeting-rec";
const SEGS = "segs";
const CHUNKS = "chunks";

const pad = (v: number, w: number) => String(v).padStart(w, "0");
const segKey = (recId: string, n: number) => `${recId}|${pad(n, 4)}`;
const chunkKey = (recId: string, n: number, i: number) => `${segKey(recId, n)}|${pad(i, 6)}`;
const chunkRange = (recId: string, n: number) => IDBKeyRange.bound(`${segKey(recId, n)}|`, `${segKey(recId, n)}|￿`);

// 메모리 대체 — IndexedDB 를 못 열면
const memSegs = new Map<string, PendingSeg>();
const memChunks = new Map<string, Blob>();

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(SEGS)) db.createObjectStore(SEGS);
        if (!db.objectStoreNames.contains(CHUNKS)) db.createObjectStore(CHUNKS, { keyPath: "key" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB 쓰기 실패"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB 쓰기 취소"));
  });
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB 읽기 실패"));
  });
}

/** 브라우저에 오래 남는 저장소인가 — 아니면 화면이 「창을 닫으면 사라진다」고 알린다 */
export async function isDurable(): Promise<boolean> {
  return (await openDb()) !== null;
}

export async function putSeg(seg: PendingSeg): Promise<void> {
  const db = await openDb();
  if (!db) return void memSegs.set(segKey(seg.recId, seg.n), seg);
  try {
    const tx = db.transaction(SEGS, "readwrite");
    tx.objectStore(SEGS).put(seg, segKey(seg.recId, seg.n));
    await done(tx);
  } catch {
    memSegs.set(segKey(seg.recId, seg.n), seg);
  }
}

export async function putChunk(recId: string, n: number, i: number, blob: Blob): Promise<void> {
  const db = await openDb();
  if (!db) return void memChunks.set(chunkKey(recId, n, i), blob);
  try {
    const tx = db.transaction(CHUNKS, "readwrite");
    tx.objectStore(CHUNKS).put({ key: chunkKey(recId, n, i), blob } satisfies ChunkRow);
    await done(tx);
  } catch {
    // 저장 공간이 모자라면 메모리에라도 — 녹음은 멈추지 않는다
    memChunks.set(chunkKey(recId, n, i), blob);
  }
}

export async function listSegs(): Promise<PendingSeg[]> {
  const db = await openDb();
  const out = [...memSegs.values()];
  if (db) {
    try {
      out.push(...(await request(db.transaction(SEGS).objectStore(SEGS).getAll() as IDBRequest<PendingSeg[]>)));
    } catch {
      // 읽지 못하면 메모리 것만
    }
  }
  return out.sort((a, b) => a.recId.localeCompare(b.recId) || a.n - b.n);
}

/** 조각의 토막들을 차례로 이어 붙인다 — webm·ogg·mp4 모두 이어 붙이면 온전한 파일이다 */
export async function segBlob(recId: string, n: number, type: string): Promise<{ blob: Blob; chunks: number }> {
  const db = await openDb();
  const parts: [string, Blob][] = [...memChunks.entries()].filter(([k]) => k.startsWith(`${segKey(recId, n)}|`));
  if (db) {
    try {
      const rows = await request(
        db.transaction(CHUNKS).objectStore(CHUNKS).getAll(chunkRange(recId, n)) as IDBRequest<ChunkRow[]>,
      );
      parts.push(...rows.map((r) => [r.key, r.blob] as [string, Blob]));
    } catch {
      // 메모리 것만
    }
  }
  parts.sort((a, b) => a[0].localeCompare(b[0]));
  return { blob: new Blob(parts.map((p) => p[1]), { type }), chunks: parts.length };
}

export async function deleteSeg(recId: string, n: number): Promise<void> {
  memSegs.delete(segKey(recId, n));
  for (const k of [...memChunks.keys()]) if (k.startsWith(`${segKey(recId, n)}|`)) memChunks.delete(k);
  const db = await openDb();
  if (!db) return;
  try {
    const tx = db.transaction([SEGS, CHUNKS], "readwrite");
    tx.objectStore(SEGS).delete(segKey(recId, n));
    tx.objectStore(CHUNKS).delete(chunkRange(recId, n));
    await done(tx);
  } catch {
    // 다음 복구 때 서버가 already 로 알려 주고 다시 지운다
  }
}
