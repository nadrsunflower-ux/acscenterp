"use client";

// ============================================================
//  SMOAT · 자동 동기화 클라이언트 — 서버 API 경유
// ------------------------------------------------------------
//  매출·재무와 같은 이유로 서버를 거친다 (보안 규칙을 게시할 권한이 없다).
//
//  판매 줄과 달리 SMOAT 결제는 건수가 작아서(월 수십 건) 증분 동기화나
//  IndexedDB 캐시를 두지 않는다. 화면에 들어올 때 통째로 받는다 — 구조를
//  늘리는 값이 아직 없다. 건수가 커지면 SalesProvider 와 같은 길을 간다.
// ============================================================

import { getNeanderAuth } from "@/lib/neander/firebase";
import type { FeedSource } from "@/lib/neander/sync/contract";
import type { SyncIssue, SyncRun, SyncState } from "@/lib/neander/sync/types";
import type { SmoatMonthlyCost, SmoatSale } from "./types";

const SYNC_URL = "/api/neander/sync";

export interface SyncStateView extends SyncState {
  /** 환경변수가 설정돼 있어 부를 수 있는 피드인가 */
  configured: boolean;
}

export interface SyncSnapshot {
  states: SyncStateView[];
  /** 풀릴 때까지 남은 것 — 적재 못 한 주문·사람 손과 어긋난 줄 */
  issues: SyncIssue[];
  smoat: { sales: SmoatSale[]; costs: SmoatMonthlyCost[] };
  serverTime: number;
}

async function authHeaders(): Promise<HeadersInit> {
  const user = getNeanderAuth().currentUser;
  if (!user) throw new Error("로그인이 필요합니다.");
  return {
    Authorization: `Bearer ${await user.getIdToken()}`,
    "Content-Type": "application/json",
  };
}

async function readError(res: Response): Promise<string> {
  try {
    return ((await res.json()) as { error?: string }).error || `요청이 실패했습니다 (HTTP ${res.status})`;
  } catch {
    return `요청이 실패했습니다 (HTTP ${res.status})`;
  }
}

export async function fetchSyncSnapshot(): Promise<SyncSnapshot> {
  const res = await fetch(SYNC_URL, { headers: await authHeaders(), cache: "no-store" });
  if (!res.ok) throw Object.assign(new Error(await readError(res)), { status: res.status });
  return (await res.json()) as SyncSnapshot;
}

async function post<T>(body: unknown): Promise<T> {
  const res = await fetch(SYNC_URL, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as T;
}

/** 지금 동기화 — source 를 주면 그것만 */
export const runSyncNow = (source?: FeedSource) =>
  post<{ ok: true; runs: SyncRun[] }>({ action: "run", source });

/** 그 기간을 통째로 다시 받는다 (온라인만) */
export const backfillSync = (source: FeedSource, window: { from: string; to: string }) =>
  post<{ ok: true; runs: SyncRun[] }>({ action: "backfill", source, window });

/** 시작일·멈춤 고치기 */
export const patchSync = (source: FeedSource, patch: { startFrom?: string; paused?: boolean }) =>
  post<{ ok: true; state: SyncState }>({ action: "patch", source, patch });

/** 사람이 확인한 것을 목록에서 내린다 */
export const dismissSyncIssue = (id: string) => post<{ ok: true }>({ action: "dismissIssue", id });
