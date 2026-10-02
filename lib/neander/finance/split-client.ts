// 거래 나누기 · 합치기 — 화면에서 부르는 쪽 (finance/split.ts · api/neander/finance/split)

import { getNeanderAuth } from "@/lib/neander/firebase";
import type { SplitPart } from "./split";
import type { FinTransaction } from "./types";

async function post<T>(body: unknown): Promise<T> {
  const user = getNeanderAuth().currentUser;
  if (!user) throw new Error("로그인이 필요합니다.");
  const res = await fetch("/api/neander/finance/split", {
    method: "POST",
    headers: { Authorization: `Bearer ${await user.getIdToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(json.error || `요청이 실패했습니다 (HTTP ${res.status})`);
  return json;
}

/** 한 거래를 여러 조각으로. 돌아오는 것은 바뀐 원래 거래와 새 조각들, 새 조각의 id */
export const splitFinTransaction = (id: string, parts: SplitPart[]) =>
  post<{ ok: true; created: string[]; transactions: FinTransaction[] }>({ action: "split", id, parts });

/** 그 거래가 든 묶음을 다시 한 줄로. 돌아오는 것은 남은 한 줄과 지워진 조각의 id */
export const mergeFinSplit = (id: string) =>
  post<{ ok: true; removed: string[]; transactions: FinTransaction[] }>({ action: "merge", id });
