// ============================================================
//  급여 지급 — 화면에서 부르는 API (api/neander/finance/payroll)
// ------------------------------------------------------------
//  재무 데이터 묶음(/data)에 끼우지 않는다 — 계좌번호가 들어 있어 이 화면이 열릴
//  때만 읽는다. 인증 헤더는 payback-client.ts 와 같은 모양이다.
// ============================================================

import { getNeanderAuth } from "@/lib/neander/firebase";
import type { PayrollDoc, PayrollInput } from "./payroll";

const URL_ = "/api/neander/finance/payroll";

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

export async function fetchPayrolls(): Promise<PayrollDoc[]> {
  const res = await fetch(URL_, { headers: await authHeaders(), cache: "no-store" });
  if (!res.ok) throw new Error(await readError(res));
  return ((await res.json()) as { plans?: PayrollDoc[] }).plans ?? [];
}

export async function savePayroll(plan: PayrollInput): Promise<PayrollDoc> {
  const res = await fetch(URL_, { method: "POST", headers: await authHeaders(), body: JSON.stringify({ plan }) });
  if (!res.ok) throw new Error(await readError(res));
  return ((await res.json()) as { plan: PayrollDoc }).plan;
}

export async function deletePayroll(id: string): Promise<void> {
  const res = await fetch(`${URL_}?id=${encodeURIComponent(id)}`, { method: "DELETE", headers: await authHeaders() });
  if (!res.ok) throw new Error(await readError(res));
}
