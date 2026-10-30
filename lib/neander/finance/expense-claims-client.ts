"use client";

import { getNeanderAuth } from "@/lib/neander/firebase";
import type { FinTransaction } from "./types";
import type { ExpenseClaimDoc, ExpenseClaimImportInput } from "./expense-claims";

const URL_ = "/api/neander/finance/expense-claims";

export interface ExpenseClaimImportResult {
  claim: ExpenseClaimDoc;
  transactions: FinTransaction[];
  inserted: number;
  skipped: number;
}

export interface ExpenseClaimChangeResult {
  ok: true;
  transactions: FinTransaction[];
}

export interface ExpenseClaimDeleteResult extends ExpenseClaimChangeResult {
  removed: number;
  removedIds: string[];
}

async function authToken(): Promise<string> {
  const user = getNeanderAuth().currentUser;
  if (!user) throw new Error("로그인이 필요합니다.");
  return user.getIdToken();
}

/** 테스트에서는 요청과 인증만 대체하며 실제 API에는 접근하지 않는다. */
export function createExpenseClaimsClient(getToken = authToken, request: typeof fetch = (...args) => fetch(...args)) {
  async function send<T>(method: "GET" | "POST" | "DELETE", body?: object, id?: string, signal?: AbortSignal): Promise<T> {
    const response = await request(id ? `${URL_}?id=${encodeURIComponent(id)}` : URL_, {
      method,
      headers: { Authorization: `Bearer ${await getToken()}`, "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
      cache: "no-store",
      signal,
    });
    if (!response.ok) {
      let message = `요청이 실패했습니다 (HTTP ${response.status})`;
      try { message = ((await response.json()) as { error?: string }).error || message; } catch { /* 응답 본문이 없을 수 있다. */ }
      throw Object.assign(new Error(message), { status: response.status });
    }
    return response.json() as Promise<T>;
  }
  return {
    async list(signal?: AbortSignal): Promise<ExpenseClaimDoc[]> {
      return (await send<{ claims: ExpenseClaimDoc[] }>("GET", undefined, undefined, signal)).claims;
    },
    import(input: ExpenseClaimImportInput) {
      return send<ExpenseClaimImportResult>("POST", { action: "import", input });
    },
    linkSettlement(claimId: string, txId: string) {
      return send<ExpenseClaimChangeResult>("POST", { action: "linkSettlement", claimId, txId });
    },
    unlinkSettlement(claimId: string, txId: string) {
      return send<ExpenseClaimChangeResult>("POST", { action: "unlinkSettlement", claimId, txId });
    },
    cancel(id: string) { return send<ExpenseClaimDeleteResult>("DELETE", undefined, id); },
  };
}

const client = createExpenseClaimsClient();
export const fetchExpenseClaims = client.list;
export const importExpenseClaim = client.import;
export const linkExpenseClaimSettlement = client.linkSettlement;
export const unlinkExpenseClaimSettlement = client.unlinkSettlement;
export const cancelExpenseClaim = client.cancel;
