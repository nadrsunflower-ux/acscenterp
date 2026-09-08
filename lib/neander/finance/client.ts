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
import type { FinCardMemoView, ReceiptRead } from "./card-memo";
import type { FinChatDoc, FinChatSummary } from "./chat-log";
import type { FinProjectDoc, FinProjectInput } from "./project";
import type { FinDoc, FinDocFile, FinDocInput } from "./docs";
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
  projects: FinProjectDoc[];
  docs: FinDoc[];
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

/**
 * 거래 한 건 수정.
 *
 * ⚠️ `undefined` 를 `null` 로 바꿔 보낸다. 서버는 "undefined 면 필드를 비운다"
 *    로 짜여 있지만, JSON.stringify 가 undefined 키를 **통째로 지워** 버려서
 *    그 분기에 닿지 못했다 — 거래처나 프로젝트코드를 지우고 저장해도 옛 값이
 *    그대로 남았다. 명시적 null 로 보내야 비우기가 실제로 전달된다.
 */
export const updateFinTransaction = (id: string, patch: Partial<FinTransactionInput>) => {
  const wire: Record<string, unknown> = {};
  (Object.keys(patch) as (keyof FinTransactionInput)[]).forEach((k) => {
    wire[k] = patch[k] === undefined ? null : patch[k];
  });
  return mutate("transaction.update", { id, patch: wire });
};

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

// ---- 재무 비서 대화 기록 ------------------------------------------

const CHATS_URL = "/api/neander/finance/ai/chats";

/** 내 대화 목록 (본문 없이 요약만) */
export async function fetchChatList(): Promise<FinChatSummary[]> {
  const res = await fetch(CHATS_URL, { headers: await authHeaders(), cache: "no-store" });
  if (!res.ok) throw new Error(await readError(res));
  return ((await res.json()) as { chats: FinChatSummary[] }).chats;
}

/** 대화 하나를 통째로 (이어가기용) */
export async function fetchChat(id: string): Promise<FinChatDoc> {
  const res = await fetch(`${CHATS_URL}?id=${encodeURIComponent(id)}`, {
    headers: await authHeaders(),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(await readError(res));
  return ((await res.json()) as { chat: FinChatDoc }).chat;
}

export async function deleteChat(id: string): Promise<void> {
  const res = await fetch(`${CHATS_URL}?id=${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error(await readError(res));
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

/**
 * 결제 캡처를 읽어 값을 돌려받는다. **저장하지 않는다** — 화면을 채워 줄 뿐이다.
 * 큰 사진을 그대로 보내면 느리고 비싸므로 브라우저에서 미리 줄여 보낸다.
 */
export async function readCardReceipt(files: File[]): Promise<ReceiptRead> {
  const user = getNeanderAuth().currentUser;
  if (!user) throw new Error("로그인이 필요합니다.");
  const form = new FormData();
  for (const f of files) form.append("photos", await shrinkImage(f));
  const res = await fetch(`${CARD_MEMO_URL}/read`, {
    method: "POST",
    headers: { Authorization: `Bearer ${await user.getIdToken()}` },
    body: form,
  });
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as ReceiptRead;
}

/**
 * 긴 변을 1400px 로 줄이고 JPEG 로 다시 굽는다.
 * 휴대폰 스크린샷은 3~5MB 인데, 글자를 읽는 데는 이 정도면 충분하다.
 * 업로드 시간과 모델 비용이 같이 줄어든다. 실패하면 원본을 그대로 쓴다.
 */
async function shrinkImage(file: File, maxEdge = 1400): Promise<File> {
  if (!file.type.startsWith("image/")) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size < 1_500_000) return file;
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.82));
    if (!blob) return file;
    return new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    return file;
  }
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
  /** 이 답이 기록된 대화의 id. 다음 턴에 그대로 돌려보내면 이어진다 */
  conversationId?: string;
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
  /** 첨부가 있을 때만: 파일별로 몇 글자를 읽었는지 (잘렸는지) */
  attachments?: { name: string; chars: number; truncated: boolean }[];
  /**
   * 첨부가 있을 때만: 첨부 텍스트까지 붙여 실제로 모델에 간 마지막 사용자
   * 메시지. 다음 턴 히스토리에 이걸 실어야 대화 맥락에 첨부가 남는다.
   */
  sentUserContent?: string;
}

/**
 * 재무 비서와 대화한다. 대화 기록을 매번 통째로 보낸다 (서버는 상태를 갖지 않는다).
 * 응답의 proposals 는 **아직 저장되지 않은** 변경 제안이다.
 * model 은 ai-models.ts 허용 목록의 ID — 안 보내면 서버 기본값을 쓴다.
 * files 를 주면 multipart 로 보내고, 서버가 텍스트를 추출해 마지막 메시지에 붙인다.
 * conversationId 를 주면 그 대화에 이어 붙고, 비우면 새 대화가 만들어진다.
 * 서버가 만든/이어붙인 대화 id 를 응답으로 돌려준다.
 */
export async function sendFinanceChat(
  messages: ChatMessage[],
  model?: string,
  files?: File[],
  conversationId?: string,
): Promise<ChatResult> {
  if (!files || files.length === 0) {
    return mutateJson<ChatResult>("/api/neander/finance/ai/chat", {
      messages,
      model,
      conversationId,
    });
  }
  const user = getNeanderAuth().currentUser;
  if (!user) throw new Error("로그인이 필요합니다.");
  const form = new FormData();
  form.append("messages", JSON.stringify(messages));
  if (model) form.append("model", model);
  if (conversationId) form.append("conversationId", conversationId);
  for (const f of files) form.append("files", f);
  const res = await fetch("/api/neander/finance/ai/chat", {
    method: "POST",
    // Content-Type 은 브라우저가 boundary 와 함께 넣는다
    headers: { Authorization: `Bearer ${await user.getIdToken()}` },
    body: form,
  });
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as ChatResult;
}

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

// ---- 프로젝트 손익 ------------------------------------------

/** 프로젝트를 통째로 저장. id 가 없으면 새로 만들고 id 를 돌려준다. */
export const saveFinProject = (project: FinProjectInput, id?: string) =>
  mutate<{ id: string }>("project.save", { id, project });

export const deleteFinProject = (id: string) => mutate("project.delete", { id });

// ---- 프로젝트 문서 (견적서·계약서) --------------------------------

const DOC_FILES_URL = "/api/neander/finance/docs/files";

/** 문서를 통째로 저장. 파일 목록은 서버가 지키고 있어 여기서 보내지 않는다. */
export const saveFinDoc = (doc: FinDocInput, id?: string) =>
  mutate<{ id: string }>("doc.save", { id, doc });

/** 문서와 붙은 파일을 모두 지운다 */
export const deleteFinDoc = (id: string) => mutate("doc.delete", { id });

/** 파일 하나만 뗀다 (Storage 에서도 지운다) */
export const removeFinDocFile = (id: string, path: string) =>
  mutate<{ files: FinDocFile[] }>("doc.removeFile", { id, path });

/**
 * 문서에 파일을 붙인다. multipart 라 mutate 를 못 탄다.
 * 한 번에 한 파일씩 보낸다 — Vercel 함수 본문 한도(4.5MB)가 요청 단위라,
 * 여러 파일을 한 요청에 실으면 합계가 걸린다.
 */
export async function uploadFinDocFiles(
  id: string,
  files: File[],
  onProgress?: (done: number, total: number) => void,
): Promise<FinDocFile[]> {
  const user = getNeanderAuth().currentUser;
  if (!user) throw new Error("로그인이 필요합니다.");
  let last: FinDocFile[] = [];
  for (let i = 0; i < files.length; i += 1) {
    const form = new FormData();
    form.append("id", id);
    form.append("file", files[i]);
    const res = await fetch(DOC_FILES_URL, {
      method: "POST",
      // Content-Type 은 브라우저가 boundary 와 함께 넣는다
      headers: { Authorization: `Bearer ${await user.getIdToken()}` },
      body: form,
    });
    if (!res.ok) throw new Error(await readError(res));
    last = ((await res.json()) as { files: FinDocFile[] }).files;
    onProgress?.(i + 1, files.length);
  }
  return last;
}

/** 파일을 여는 서명 URL. 한 시간 뒤 만료되므로 누를 때마다 받는다. */
export async function finDocFileUrl(path: string): Promise<string> {
  const res = await fetch(`${DOC_FILES_URL}?path=${encodeURIComponent(path)}`, {
    headers: await authHeaders(),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(await readError(res));
  return ((await res.json()) as { url: string }).url;
}

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
