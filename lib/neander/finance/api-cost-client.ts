// ============================================================
//  API 비용 — 화면에서 부르는 API (api/neander/finance/api-costs)
// ------------------------------------------------------------
//  재무 데이터 묶음(/data · /mutate)에 끼우지 않고 따로 둔다 — 열 때마다 서버가
//  오픈라우터를 다시 읽어야 하고(잔액 · 오늘), 원장 동기화와 엮을 이유가 없다.
//  인증 헤더는 payback-client.ts 와 같은 모양이다.
// ============================================================

import { getNeanderAuth } from "@/lib/neander/firebase";
import type { ApiCostView } from "./server/api-cost";
import type { ApiCostSettings, ApiKeyAlloc, ApiTarget } from "./api-cost";

const URL_ = "/api/neander/finance/api-costs";

export type ApiCostResponse = { configured: false } | { configured: true; view: ApiCostView };

async function authHeaders(): Promise<HeadersInit> {
  const user = getNeanderAuth().currentUser;
  if (!user) throw new Error("로그인이 필요합니다.");
  const token = await user.getIdToken();
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

async function readError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    return body.error || `요청이 실패했습니다 (HTTP ${res.status})`;
  } catch {
    return `요청이 실패했습니다 (HTTP ${res.status})`;
  }
}

export async function fetchApiCosts(): Promise<ApiCostResponse> {
  const res = await fetch(URL_, { headers: await authHeaders(), cache: "no-store" });
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as ApiCostResponse;
}

async function post<T>(action: string, payload: Record<string, unknown>): Promise<T> {
  const res = await fetch(URL_, { method: "POST", headers: await authHeaders(), body: JSON.stringify({ action, ...payload }) });
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as T;
}

type AllocResp = { alloc: ApiKeyAlloc };

export const setApiKeyDefault = (hash: string, name: string, target: ApiTarget | null) =>
  post<AllocResp>("key.default", { hash, name, target }).then((r) => r.alloc);

export const setApiKeyRange = (hash: string, name: string, span: { from: string; to?: string }, target: ApiTarget | null, note?: string) =>
  post<AllocResp>("key.range", { hash, name, ...span, target, note }).then((r) => r.alloc);

export const setApiKeySpans = (hash: string, name: string, spans: { from: string; to: string }[], target: ApiTarget | null) =>
  post<AllocResp>("key.spans", { hash, name, spans, target }).then((r) => r.alloc);

export const deleteApiKeyRange = (hash: string, id: string) => post<AllocResp>("key.rangeDelete", { hash, id }).then((r) => r.alloc);

export const saveApiCostRate = (krwPerUsd: number) => post<{ settings: ApiCostSettings }>("settings", { krwPerUsd }).then((r) => r.settings);

export const pushApiCostToProject = (projectId: string, removeLineIds: string[]) =>
  post<{ usd: number; krw: number; rate: number; removed: number; through: string }>("project.push", { projectId, removeLineIds });

export const syncApiCosts = (back: number, force = false) => post<{ dates: string[]; through: string }>("sync", { back, force });
