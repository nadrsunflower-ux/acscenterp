"use client";

// ============================================================
//  재무 클라이언트 — 서버 API 경유
// ------------------------------------------------------------
//  다른 NEANDER 모듈은 브라우저에서 Firestore 에 직접 붙지만, 재무만
//  서버를 거친다. neander_fin_* 보안 규칙을 게시하려면 Firebase 프로젝트
//  소유자 권한이 필요한데 우리에게 없기 때문이다. 서버의 Admin SDK 는
//  규칙을 우회하므로 게시 없이 동작한다.
//
//  대신 실시간 구독(onSnapshot)은 쓸 수 없다. 재무는 초 단위로 바뀌는
//  데이터가 아니라서 "불러오기 + 변경 후 새로고침"으로 충분하다.
// ============================================================

import { getNeanderAuth } from "@/lib/neander/firebase";
import type { FinTransaction, FinImportBatch, FinTransactionInput } from "./types";
import type { FinAccountDoc, FinPaymentMethodDoc, FinVendorRuleDoc } from "./db-types";

const DATA_URL = "/api/neander/finance/data";
const MUTATE_URL = "/api/neander/finance/mutate";

export interface FinanceSnapshot {
  transactions: FinTransaction[];
  accounts: FinAccountDoc[];
  paymentMethods: FinPaymentMethodDoc[];
  vendorRules: FinVendorRuleDoc[];
  imports: FinImportBatch[];
}

/** 서버가 신원을 검증할 수 있게 로그인 ID 토큰을 붙인다 */
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

export async function fetchFinanceData(): Promise<FinanceSnapshot> {
  const res = await fetch(DATA_URL, { headers: await authHeaders(), cache: "no-store" });
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as FinanceSnapshot;
}

async function mutate<T = unknown>(action: string, payload?: unknown): Promise<T> {
  const res = await fetch(MUTATE_URL, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({ action, payload }),
  });
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as T;
}

// ---- 거래 --------------------------------------------------

export const addFinTransaction = (input: FinTransactionInput) =>
  mutate("transaction.add", input);

export const updateFinTransaction = (id: string, patch: Partial<FinTransactionInput>) =>
  mutate("transaction.update", { id, patch });

export const deleteFinTransaction = (id: string) => mutate("transaction.delete", { id });

export const bulkUpdateFinStatus = (ids: string[], status: string) =>
  mutate("transaction.bulkStatus", { ids, status });

/** 여러 거래에 같은 값을 한 번에 적용 (계정 일괄 교정 등) */
export const bulkPatchFinTransactions = (
  ids: string[],
  patch: Partial<FinTransactionInput>,
) => mutate<{ updated: number }>("transaction.bulkPatch", { ids, patch });

/**
 * 임포트 대량 적재.
 * 한 요청에 수백 건을 통째로 보내면 본문이 커지고 실패 시 전부 날아가므로,
 * 200건씩 끊어 보내며 진행률을 알린다.
 */
export async function bulkAddFinTransactions(
  rows: FinTransactionInput[],
  onProgress?: (done: number, total: number) => void,
) {
  const CHUNK = 200;
  for (let i = 0; i < rows.length; i += CHUNK) {
    await mutate("transaction.bulkAdd", { rows: rows.slice(i, i + CHUNK) });
    onProgress?.(Math.min(i + CHUNK, rows.length), rows.length);
  }
}

// ---- 임포트 이력 --------------------------------------------

export const createFinImport = (input: Omit<FinImportBatch, "id" | "createdAt">) =>
  mutate<{ id: string }>("import.create", input);

export const updateFinImport = (id: string, patch: Partial<FinImportBatch>) =>
  mutate("import.update", { id, patch });

export const undoFinImport = (id: string) =>
  mutate<{ deleted: number }>("import.undo", { id });

// ---- 마스터 -------------------------------------------------

export const seedFinanceMaster = () =>
  mutate<{ accounts: number; paymentMethods: number; vendorRules: number }>("master.seed");

export const upsertFinVendorRule = (rule: {
  keyword: string;
  service: string;
  lookupKey?: string;
}) => mutate("vendorRule.upsert", rule);

export const deleteFinVendorRule = (id: string) => mutate("vendorRule.delete", { id });
