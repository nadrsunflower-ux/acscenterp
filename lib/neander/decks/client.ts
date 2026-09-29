"use client";

// ============================================================
//  발표 장표 — 브라우저 쪽 요청 (로그인 토큰을 붙인다)
// ------------------------------------------------------------
//  사진·지도 타일은 <img src> 로 토큰을 못 실어서 fetch 로 받아 blob URL
//  로 바꾼다. 받은 것은 탭이 살아 있는 동안 기억한다 (장을 넘길 때마다
//  다시 받지 않게, 인쇄할 때 이미 그려져 있게).
// ============================================================

import { getNeanderAuth } from "@/lib/neander/firebase";
import type { AssumptionValue, DeckPayload, DeckScenario } from "./types";

async function authHeaders(json = false): Promise<HeadersInit> {
  const user = getNeanderAuth().currentUser;
  if (!user) throw new Error("로그인이 필요합니다.");
  const token = await user.getIdToken();
  return json ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } : { Authorization: `Bearer ${token}` };
}

async function readError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    return body.error || `요청이 실패했습니다 (HTTP ${res.status})`;
  } catch {
    return `요청이 실패했습니다 (HTTP ${res.status})`;
  }
}

const base = (slug: string) => `/api/neander/decks/${encodeURIComponent(slug)}`;

export async function fetchDeck(slug: string): Promise<DeckPayload> {
  const res = await fetch(base(slug), { headers: await authHeaders(), cache: "no-store" });
  if (!res.ok) throw Object.assign(new Error(await readError(res)), { status: res.status });
  return (await res.json()) as DeckPayload;
}

const assetCache = new Map<string, Promise<string | null>>();

/** 사진·타일 → blob URL. 없으면 null (「사진 없음」 자리표시) */
export function loadDeckAsset(slug: string, id: string): Promise<string | null> {
  const key = `${slug}/${id}`;
  const hit = assetCache.get(key);
  if (hit) return hit;
  const p = (async () => {
    const res = await fetch(`${base(slug)}/assets/${encodeURIComponent(id)}`, { headers: await authHeaders() });
    if (!res.ok) return null;
    return URL.createObjectURL(await res.blob());
  })().catch(() => null);
  assetCache.set(key, p);
  // 실패는 기억하지 않는다 — 다음에 다시 시도
  p.then((url) => {
    if (url === null) assetCache.delete(key);
  });
  return p;
}

export async function listDeckScenarios(slug: string): Promise<DeckScenario[]> {
  const res = await fetch(`${base(slug)}/scenarios`, { headers: await authHeaders(), cache: "no-store" });
  if (!res.ok) throw new Error(await readError(res));
  return ((await res.json()) as { scenarios: DeckScenario[] }).scenarios;
}

export async function saveDeckScenario(
  slug: string,
  name: string,
  values: Record<string, AssumptionValue>,
): Promise<DeckScenario> {
  const res = await fetch(`${base(slug)}/scenarios`, {
    method: "POST",
    headers: await authHeaders(true),
    body: JSON.stringify({ name, values }),
  });
  if (!res.ok) throw new Error(await readError(res));
  return ((await res.json()) as { scenario: DeckScenario }).scenario;
}

export async function deleteDeckScenario(slug: string, id: string): Promise<void> {
  const res = await fetch(`${base(slug)}/scenarios?id=${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error(await readError(res));
}
