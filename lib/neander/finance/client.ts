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
import type { CloseSnapshot, MonthCloseDoc } from "./close";
import type { FinCardMemoView } from "./card-memo";
import type {
  FinAccountDoc,
  FinAllocationDoc,
  FinBudgetDoc,
  FinPaymentMethodDoc,
  FinSubscriptionDoc,
  FinVendorRuleDoc,
} from "./db-types";

const DATA_URL = "/api/neander/finance/data";
const MUTATE_URL = "/api/neander/finance/mutate";

export interface FinanceSnapshot {
  transactions: FinTransaction[];
  accounts: FinAccountDoc[];
  paymentMethods: FinPaymentMethodDoc[];
  vendorRules: FinVendorRuleDoc[];
  subscriptions: FinSubscriptionDoc[];
  allocations: FinAllocationDoc[];
  budgets: FinBudgetDoc[];
  imports: FinImportBatch[];
  closes: MonthCloseDoc[];
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

/** 원장 시트 일괄 저장 — 행별 패치·신규·삭제를 한 요청에 */
export const applyFinEdits = (edits: {
  updates: { id: string; patch: Partial<FinTransactionInput> }[];
  inserts: FinTransactionInput[];
  deletes: string[];
}) =>
  mutate<{ updated: number; inserted: number; deleted: number }>(
    "transaction.applyEdits",
    edits,
  );

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

// ---- 법인카드 사용 메모 ------------------------------------------

const CARD_MEMO_URL = "/api/neander/finance/card-memo";

export async function fetchCardMemos(): Promise<FinCardMemoView[]> {
  const res = await fetch(CARD_MEMO_URL, { headers: await authHeaders(), cache: "no-store" });
  if (!res.ok) throw new Error(await readError(res));
  return ((await res.json()) as { memos: FinCardMemoView[] }).memos;
}

/**
 * 사진이 붙으므로 multipart 다.
 * Content-Type 을 직접 넣지 않는다 — 브라우저가 boundary 를 붙여야 한다.
 */
export async function addCardMemo(form: FormData): Promise<{ id: string; warning?: string }> {
  const user = getNeanderAuth().currentUser;
  if (!user) throw new Error("로그인이 필요합니다.");
  const res = await fetch(CARD_MEMO_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${await user.getIdToken()}` },
    body: form,
  });
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as { id: string; warning?: string };
}

export async function deleteCardMemo(id: string): Promise<void> {
  const res = await fetch(`${CARD_MEMO_URL}?id=${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error(await readError(res));
}

/** 메모 ↔ 카드 명세서 대조. 확실한 짝만 붙는다. */
export const matchCardMemos = () =>
  mutate<{ matched: number; ambiguous: number; unmatched: number }>("cardMemo.match");

// ---- 월 마감 --------------------------------------------------

/** 마감. 스냅샷은 monthSnapshot() 으로 만든 그 달의 숫자다. */
export const closeFinMonth = (month: string, snapshot: CloseSnapshot, note?: string) =>
  mutate("close.set", { month, snapshot, note });

/** 마감 해제. 스냅샷도 함께 지운다 — 다시 마감할 때 새로 얼린다. */
export const reopenFinMonth = (month: string) => mutate("close.reopen", { month });

// ---- 임포트 이력 --------------------------------------------

export const createFinImport = (input: Omit<FinImportBatch, "id" | "createdAt">) =>
  mutate<{ id: string }>("import.create", input);

export const updateFinImport = (id: string, patch: Partial<FinImportBatch>) =>
  mutate("import.update", { id, patch });

export const undoFinImport = (id: string) =>
  mutate<{ deleted: number }>("import.undo", { id });

// ---- AI 분류 추천 ----------------------------------------------

export interface AiSuggestion {
  id: string;
  acctMajor: string;
  acctMid: string;
  acctMinor: string;
  bizMajor?: string;
  bizMinor?: string;
  confidence: number;
  reason: string;
}

export interface AiSuggestResult {
  suggestions: AiSuggestion[];
  rejected: { id: string; proposed: string; reason: string }[];
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    /** OpenRouter 가 알려주는 이번 호출 비용 (USD) */
    costUsd?: number;
  };
  model: string;
}

/**
 * 규칙이 못 맞힌 거래의 계정을 모델에게 물어본다.
 * 결과는 **제안**일 뿐이라 사람이 승인해야 저장된다.
 */
export const requestAiSuggestions = (ids: string[]) => {
  return mutateJson<AiSuggestResult>("/api/neander/finance/ai/suggest", { ids });
};

/** mutate URL 이 아닌 별도 라우트를 부를 때 */
async function mutateJson<T>(url: string, payload: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as T;
}

// ---- 재무 채팅 에이전트 ------------------------------------------

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChangeProposal {
  id: string;
  ids: string[];
  patch: Record<string, unknown>;
  reason: string;
  before: {
    id: string;
    date: string;
    vendor?: string;
    txType: string;
    acct: string;
    biz: string;
    amount: number;
    status: string;
  }[];
}

export interface ChatResult {
  reply: string;
  toolCalls: { name: string; args: Record<string, unknown>; summary: string }[];
  proposals: ChangeProposal[];
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    costUsd?: number;
  };
  model: string;
  truncated: boolean;
}

/**
 * 재무 비서와 대화한다. 대화 기록을 매번 통째로 보낸다 (서버는 상태를 갖지 않는다).
 * 응답의 proposals 는 **아직 저장되지 않은** 변경 제안이다.
 * model 은 ai-models.ts 허용 목록의 ID — 안 보내면 서버 기본값을 쓴다.
 */
export const sendFinanceChat = (messages: ChatMessage[], model?: string) =>
  mutateJson<ChatResult>("/api/neander/finance/ai/chat", { messages, model });

// ---- 암호 걸린 엑셀 --------------------------------------------

/**
 * 토스·카카오뱅크 거래내역은 암호가 걸려 있어 브라우저에서 못 읽는다.
 * 서버에 보내 풀어 온다. 파일도 비밀번호도 서버에 남지 않는다.
 */
export async function decryptFinanceFile(file: File, password: string): Promise<ArrayBuffer> {
  const user = getNeanderAuth().currentUser;
  if (!user) throw new Error("로그인이 필요합니다.");
  const form = new FormData();
  form.append("file", file);
  form.append("password", password);
  const res = await fetch("/api/neander/finance/decrypt", {
    method: "POST",
    headers: { Authorization: `Bearer ${await user.getIdToken()}` },
    body: form,
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.arrayBuffer();
}

// ---- 마스터 -------------------------------------------------

export const seedFinanceMaster = () =>
  mutate<{
    accounts: number;
    paymentMethods: number;
    vendorRules: number;
    subscriptions: number;
    allocations: number;
  }>("master.seed");

// ---- 구독 마스터 --------------------------------------------

export const upsertFinSubscription = (sub: Partial<FinSubscriptionDoc> & { service: string }) =>
  mutate("subscription.upsert", sub);

export const deleteFinSubscription = (id: string) => mutate("subscription.delete", { id });

// ---- 예산 ----------------------------------------------------

/** 한 달치 예산을 통째로 저장 (0 인 줄은 서버에서 버린다) */
export const saveFinBudget = (month: string, lines: Record<string, number>, note?: string) =>
  mutate<{ saved: number }>("budget.save", { month, lines, note });

// ---- 배분 규칙 ----------------------------------------------

export const upsertFinAllocation = (rule: Partial<FinAllocationDoc> & { name: string }) =>
  mutate("allocation.upsert", rule);

export const setFinAllocationActive = (id: string, active: boolean) =>
  mutate("allocation.setActive", { id, active });

export const deleteFinAllocation = (id: string) => mutate("allocation.delete", { id });

export const upsertFinVendorRule = (rule: {
  keyword: string;
  service: string;
  lookupKey?: string;
}) => mutate("vendorRule.upsert", rule);

export const deleteFinVendorRule = (id: string) => mutate("vendorRule.delete", { id });
