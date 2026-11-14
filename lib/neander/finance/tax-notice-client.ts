// 세금 고지서 — 화면 쪽 요청 (api/neander/finance/tax-notices)
import { getNeanderAuth } from "@/lib/neander/firebase";
import type { TaxNotice } from "./tax-notice";

export type TaxNoticeView = Omit<TaxNotice, "raw"> & { raw?: string };

async function call<T>(method: "GET" | "POST" | "PATCH", query: string, body?: unknown): Promise<T> {
  const user = getNeanderAuth().currentUser;
  if (!user) throw new Error("로그인이 필요합니다.");
  const res = await fetch(`/api/neander/finance/tax-notices${query}`, {
    method,
    headers: {
      Authorization: `Bearer ${await user.getIdToken()}`,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(json.error ?? `요청이 실패했습니다 (HTTP ${res.status})`);
  return json;
}

export const fetchTaxNotices = async () => (await call<{ notices: TaxNoticeView[] }>("GET", "")).notices;
export const fetchTaxNotice = async (id: string) => (await call<{ notice: TaxNoticeView }>("GET", `?id=${encodeURIComponent(id)}`)).notice;
export const createTaxNotice = async (n: Partial<TaxNotice>) => (await call<{ id: string }>("POST", "", n)).id;
/** null 은 그 칸을 지운다 */
export const patchTaxNotice = async (id: string, patch: Record<string, unknown>) =>
  (await call<{ notice: TaxNoticeView }>("PATCH", `?id=${encodeURIComponent(id)}`, patch)).notice;
