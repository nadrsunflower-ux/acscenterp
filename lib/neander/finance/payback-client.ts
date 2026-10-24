// ============================================================
//  돌려줄 돈 — 화면에서 부르는 API (api/neander/finance/paybacks)
// ------------------------------------------------------------
//  재무 데이터 묶음(/data · /mutate)에 끼우지 않고 따로 둔다 — 문서가 몇십 건이라
//  화면이 열릴 때 한 번 읽으면 되고, 원장 동기화와 엮을 이유가 없다.
//  인증 헤더는 client.ts 와 같은 모양이다.
// ============================================================

import { getNeanderAuth } from "@/lib/neander/firebase";
import type { FinPaybackDoc, FinPaybackInput } from "./payback";

const URL_ = "/api/neander/finance/paybacks";

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

export async function fetchPaybacks(): Promise<FinPaybackDoc[]> {
  const res = await fetch(URL_, { headers: await authHeaders(), cache: "no-store" });
  if (!res.ok) throw new Error(await readError(res));
  return ((await res.json()) as { paybacks?: FinPaybackDoc[] }).paybacks ?? [];
}

export async function savePayback(payback: FinPaybackInput, id?: string): Promise<{ id: string }> {
  const res = await fetch(URL_, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({ id, payback }),
  });
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as { id: string };
}

export async function deletePayback(id: string): Promise<void> {
  const res = await fetch(`${URL_}?id=${encodeURIComponent(id)}`, { method: "DELETE", headers: await authHeaders() });
  if (!res.ok) throw new Error(await readError(res));
}
