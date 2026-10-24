"use client";

// ============================================================
//  지원사업 — 화면에서 부르는 쪽 (api/neander/finance/grants)
// ------------------------------------------------------------
//  재무 데이터(/data · FinanceProvider)에 싣지 않고 따로 받는다. 지원사업은
//  열 건 남짓이라 화면을 열 때 한 번 받으면 되고, 원장처럼 증분 동기화할
//  이유가 없다. 목록 · 상세가 같은 사본을 보도록 모듈에 하나만 둔다.
// ============================================================

import { useCallback, useEffect, useState } from "react";
import { getNeanderAuth } from "@/lib/neander/firebase";
import type { FinGrantDoc, FinGrantInput } from "./grant";

const URL_ = "/api/neander/finance/grants";

async function authHeaders(): Promise<HeadersInit> {
  const user = getNeanderAuth().currentUser;
  if (!user) throw new Error("로그인이 필요합니다.");
  return { Authorization: `Bearer ${await user.getIdToken()}`, "Content-Type": "application/json" };
}

async function readError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    return body.error || `요청이 실패했습니다 (HTTP ${res.status})`;
  } catch {
    return `요청이 실패했습니다 (HTTP ${res.status})`;
  }
}

export async function fetchGrants(): Promise<FinGrantDoc[]> {
  const res = await fetch(URL_, { headers: await authHeaders(), cache: "no-store" });
  if (!res.ok) throw new Error(await readError(res));
  return ((await res.json()) as { grants?: FinGrantDoc[] }).grants ?? [];
}

export async function saveGrant(grant: FinGrantInput, id?: string): Promise<{ id: string }> {
  const res = await fetch(URL_, { method: "POST", headers: await authHeaders(), body: JSON.stringify({ id, grant }) });
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as { id: string };
}

export async function deleteGrant(id: string): Promise<void> {
  const res = await fetch(`${URL_}?id=${encodeURIComponent(id)}`, { method: "DELETE", headers: await authHeaders() });
  if (!res.ok) throw new Error(await readError(res));
}

// ---- 함께 보는 사본 ------------------------------------------------

let cache: FinGrantDoc[] | null = null;
const listeners = new Set<(list: FinGrantDoc[]) => void>();

async function reload(): Promise<FinGrantDoc[]> {
  const list = await fetchGrants();
  cache = list;
  listeners.forEach((fn) => fn(list));
  return list;
}

/**
 * 지원사업 목록. 처음 부르면 받아 오고, 그 뒤로는 사본을 바로 준다.
 * 로그인 상태가 늦게 잡히면(새로 고침 직후) 로그인이 잡힐 때 다시 받는다.
 */
export function useGrants() {
  const [grants, setGrants] = useState<FinGrantDoc[]>(cache ?? []);
  const [loading, setLoading] = useState(cache === null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setError(null);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "지원사업을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    listeners.add(setGrants);
    const auth = getNeanderAuth();
    const off = auth.onAuthStateChanged((u) => {
      if (u) void refresh();
    });
    return () => {
      listeners.delete(setGrants);
      off();
    };
  }, [refresh]);

  return { grants, loading, error, refresh };
}
