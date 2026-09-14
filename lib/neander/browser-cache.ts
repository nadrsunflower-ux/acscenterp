"use client";

// ============================================================
//  브라우저 캐시 (IndexedDB) — 매출·재무 스냅샷
// ------------------------------------------------------------
//  두 번째 방문부터 화면을 곧바로 띄우고, 최신 값은 뒤에서 받아 바꿔 끼운다
//  (FinanceProvider · SalesProvider).
//
//  ⚠️ 회사 재무·매출 데이터가 이 브라우저에 남는다 (사용자 동의 2026-09-15).
//     그래서 — 키에 로그인 계정 uid 를 넣고, 로그아웃·세션 만료 때 전부 지우고
//     (auth.tsx), 서버가 권한을 거부하면 그 키를 지운다 (Provider).
//     /clear-cache 페이지는 IndexedDB 를 통째로 지우므로 이것도 함께 지워진다.
//
//  저장 실패(사생활 보호 모드·용량 초과)는 조용히 넘어간다 — 캐시가 없으면
//  예전처럼 서버에서 받아 뜰 뿐이다.
// ============================================================

const DB_NAME = "neander-cache";
const STORE = "snapshots";

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function run<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest | void,
): Promise<T | undefined> {
  return openDb().then(
    (db) =>
      new Promise<T | undefined>((resolve) => {
        if (!db) return resolve(undefined);
        try {
          const tx = db.transaction(STORE, mode);
          const req = fn(tx.objectStore(STORE));
          tx.oncomplete = () => {
            db.close();
            resolve(req ? (req.result as T) : undefined);
          };
          const fail = () => {
            db.close();
            resolve(undefined);
          };
          tx.onerror = fail;
          tx.onabort = fail;
        } catch {
          db.close();
          resolve(undefined);
        }
      }),
  );
}

export const cacheGet = <T>(key: string) => run<T>("readonly", (s) => s.get(key));

export const cacheSet = (key: string, value: unknown) =>
  run<void>("readwrite", (s) => {
    s.put(value, key);
  }).then(() => undefined);

export const cacheDelete = (key: string) =>
  run<void>("readwrite", (s) => {
    s.delete(key);
  }).then(() => undefined);

/** 로그아웃·세션 만료 — 이 브라우저에 남긴 매출·재무 데이터를 모두 지운다 */
export const cacheClearAll = () =>
  run<void>("readwrite", (s) => {
    s.clear();
  }).then(() => undefined);
