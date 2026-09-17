"use client";

// ============================================================
//  매출 클라이언트 — 서버 API 경유
// ------------------------------------------------------------
//  재무와 같은 이유로 서버를 거친다: neander_sales_* 보안 규칙을 게시할
//  Firebase 소유자 권한이 없어서, 브라우저에서 직접 붙을 수 없다. 서버의
//  Admin SDK 는 규칙을 우회하므로 게시 없이 동작한다.
//  (lib/neander/finance/client.ts 주석 참고)
//
//  실시간 구독은 쓸 수 없다. 월 마감 때 몰아서 적재하는 데이터라
//  "불러오기 + 변경 후 새로고침" 으로 충분하다.
// ============================================================

import { getNeanderAuth } from "@/lib/neander/firebase";
import type { AssistantChatDoc, AssistantChatSummary } from "@/lib/neander/ai/chat-log";
import type { AgentMessage, AgentResult } from "@/lib/neander/ai/agent";
import type { SalesProposal } from "@/lib/neander/sales/server/ai-tools";
import type { LaborActuals } from "@/lib/neander/sales/labor";
import type {
  SalesAssumptions,
  SalesEvent,
  SalesImportBatch,
  SalesLine,
  SalesLineDiscount,
  SalesLineInput,
  SalesProduct,
  SalesStore,
} from "./types";

const DATA_URL = "/api/neander/sales/data";
const MUTATE_URL = "/api/neander/sales/mutate";
const SUMMARY_URL = "/api/neander/sales/summary";
const CHAT_URL = "/api/neander/sales/ai/chat";
const CHATS_URL = "/api/neander/sales/ai/chats";
const DECRYPT_URL = "/api/neander/sales/decrypt";

export interface SalesSnapshot {
  /** 판매 줄 — 화면이 읽는 필드만 온다 (sales/payload.ts) */
  lines: SalesLine[];
  /** full = 전부 · delta = since 뒤로 바뀐 줄만 (lineIds 와 함께) */
  mode?: "full" | "delta";
  /** 서버가 읽기 시작한 시각 — 다음 since 의 기준 */
  serverTime?: number;
  /** delta 일 때 지금 있는 줄 id 전부 — 지운 줄을 알아내는 근거 */
  lineIds?: string[];
  products: SalesProduct[];
  events: SalesEvent[];
  imports: SalesImportBatch[];
  assumptions: SalesAssumptions | null;
  /** 근무 일지 실측 인건비 집계 — 못 읽었으면 null (인건비는 가정값) */
  labor?: LaborActuals | null;
}

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

/**
 * 매출 데이터. since(ms)를 주면 그 뒤로 바뀐 판매 줄과 전체 id 목록만 온다 (delta).
 * 실패는 status 를 달아 던진다 — 권한 거부(401·403)면 Provider 가 캐시를 지운다.
 */
export async function fetchSalesData(since?: number): Promise<SalesSnapshot> {
  const url = since ? `${DATA_URL}?since=${since}` : DATA_URL;
  const res = await fetch(url, { headers: await authHeaders(), cache: "no-store" });
  if (!res.ok) throw Object.assign(new Error(await readError(res)), { status: res.status });
  return (await res.json()) as SalesSnapshot;
}

/** id 로 판매 줄 몇 건 — 동기화 중 캐시에 없는 줄을 채울 때 */
export async function fetchSalesLinesByIds(ids: string[]): Promise<SalesLine[]> {
  const res = await fetch(DATA_URL, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({ ids }),
    cache: "no-store",
  });
  if (!res.ok) throw Object.assign(new Error(await readError(res)), { status: res.status });
  return ((await res.json()) as { lines?: SalesLine[] }).lines ?? [];
}

/** 한 달 요약 — ERP 대시보드 타일이 쓴다 (판매 줄 전체를 끌어오지 않는다) */
export interface SalesMonthSummary {
  month: string;
  revenue: number;
  contribution: number;
  contributionRate: number | null;
  operating: number;
  reviewCount: number;
  reviewAmount: number;
  stores: {
    store: SalesStore;
    revenue: number;
    contribution: number;
    contributionRate: number | null;
  }[];
}

export async function fetchSalesSummary(month: string): Promise<SalesMonthSummary> {
  const res = await fetch(`${SUMMARY_URL}?month=${encodeURIComponent(month)}`, {
    headers: await authHeaders(),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as SalesMonthSummary;
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

// ---- 마스터 --------------------------------------------------

export interface SalesSeedResult {
  products: number;
  events: number;
  eventsKept: number;
}

export const seedSalesMaster = () =>
  mutate<{ ok: true; result: SalesSeedResult }>("master.seed");

export const upsertSalesProduct = (product: SalesProduct) =>
  mutate("product.upsert", { product });

export const deleteSalesProduct = (id: string) => mutate("product.delete", { id });

export const saveSalesAssumptions = (assumptions: SalesAssumptions) =>
  mutate("assumptions.save", { assumptions });

// ---- 이벤트 --------------------------------------------------

/** 저장 뒤 서버가 그 기간의 판매 줄을 다시 붙인 결과 */
export interface SalesEventSaveResult {
  ok: true;
  id: string;
  lines: { attached: number; detached: number; resolved: number };
}

export const upsertSalesEvent = (event: SalesEvent) =>
  mutate<SalesEventSaveResult>("event.upsert", { event });

export const deleteSalesEvent = (id: string) =>
  mutate<{ ok: true; detached: number }>("event.delete", { id });

// ---- 판매 줄 -------------------------------------------------

export const addSalesLine = (line: SalesLineInput) => mutate("line.add", line);

export const updateSalesLine = (id: string, patch: Partial<SalesLine>) =>
  mutate<{ ok: true; lines: SalesLine[] }>("line.update", { id, patch });

export const deleteSalesLine = (id: string) => mutate("line.delete", { id });

/** discount 를 주면 할인해서 받은 줄로 확정한다 (매출은 결제액 그대로) */
export const bulkResolveSalesLines = (
  ids: string[],
  productId: string,
  qty?: number,
  discount?: SalesLineDiscount,
) =>
  mutate<{ ok: true; count: number; lines: SalesLine[] }>("line.bulkResolve", { ids, productId, qty, discount });

/**
 * 처리 직전의 줄 전체를 되쓴다 — 대기함의 확정·직접입력·삭제·조합 되돌리기.
 * deleteIds 는 처리 때 새로 생긴 줄(조합으로 나눈 나머지 상품)이다.
 */
export const restoreSalesLines = (lines: SalesLine[], deleteIds: string[] = []) =>
  mutate<{ ok: true; count: number; deleted: number; lines: SalesLine[] }>("line.restore", { lines, deleteIds });

/** 한 결제를 여러 상품으로 나눠 확정 — 합계가 결제액과 같아야 한다 */
export const splitSalesLines = (
  ids: string[],
  parts: { productId: string; qty: number; amount: number }[],
) => mutate<{ ok: true; count: number; created: string[]; lines: SalesLine[] }>("line.split", { ids, parts });

/** 이벤트 기간의 일반 손님 — 이벤트 매출에서 떼거나(true) 날짜로 다시 붙인다(false) */
export const setSalesEventOptOut = (ids: string[], optOut: boolean) =>
  mutate<{ ok: true; count: number; lines: SalesLine[] }>("line.setEventOptOut", { ids, optOut });

// ---- 적재 ----------------------------------------------------

export const commitSalesImport = (
  batch: Omit<SalesImportBatch, "id" | "createdAt">,
  rows: SalesLineInput[],
) => mutate<{ ok: true; importId: string; written: number }>("import.commit", { batch, rows });

export const undoSalesImport = (id: string) =>
  mutate<{ ok: true; removed: number }>("import.undo", { id });

/**
 * 암호 걸린 원본(네이버 예약자관리)을 서버에서 푼다. 비밀번호는 서버
 * 환경변수에 있어 보통은 보낼 것이 없다 — 서버에 없을 때만 password 를 준다.
 */
export async function decryptSalesFile(file: File, password?: string): Promise<ArrayBuffer> {
  const user = getNeanderAuth().currentUser;
  if (!user) throw new Error("로그인이 필요합니다.");
  const form = new FormData();
  form.append("file", file);
  if (password) form.append("password", password);
  const res = await fetch(DECRYPT_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${await user.getIdToken()}` },
    body: form,
  });
  if (!res.ok) {
    let msg = `복호화에 실패했습니다 (HTTP ${res.status})`;
    let needsPassword = false;
    try {
      const body = (await res.json()) as { error?: string; needsPassword?: boolean };
      msg = body.error || msg;
      needsPassword = !!body.needsPassword;
    } catch {
      /* 본문 없음 */
    }
    const err = new Error(msg) as Error & { needsPassword?: boolean };
    err.needsPassword = needsPassword;
    throw err;
  }
  return res.arrayBuffer();
}

// ---- 매출 비서 ------------------------------------------------
//  서버가 도구 루프를 돌리고 대화를 기록한다. 클라이언트는 대화 기록만 들고
//  다닌다 (재무 비서와 같은 구조).

export type { SalesProposal };
export type SalesChatMessage = AgentMessage;
export type SalesChatResult = AgentResult<SalesProposal> & {
  /** 이 답이 기록된 대화의 id. 다음 턴에 그대로 돌려보내면 이어진다 */
  conversationId?: string;
};
export type SalesChatDoc = AssistantChatDoc<SalesProposal>;

export async function sendSalesChat(
  messages: SalesChatMessage[],
  model?: string,
  files?: File[],
  conversationId?: string,
  /** 보고 슬라이드 발표 중이면 그 달 — 기간 없는 질문의 기준 (ai/presentation.ts) */
  context?: import("@/lib/neander/ai/presentation").PresentationContext,
): Promise<SalesChatResult> {
  if (!files || files.length === 0) {
    const res = await fetch(CHAT_URL, {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify({ messages, model, conversationId, context }),
    });
    if (!res.ok) throw new Error(await readError(res));
    return (await res.json()) as SalesChatResult;
  }
  const user = getNeanderAuth().currentUser;
  if (!user) throw new Error("로그인이 필요합니다.");
  const form = new FormData();
  form.append("messages", JSON.stringify(messages));
  if (model) form.append("model", model);
  if (conversationId) form.append("conversationId", conversationId);
  if (context) form.append("context", JSON.stringify(context));
  for (const f of files) form.append("files", f);
  const res = await fetch(CHAT_URL, {
    method: "POST",
    // Content-Type 은 브라우저가 boundary 와 함께 넣는다
    headers: { Authorization: `Bearer ${await user.getIdToken()}` },
    body: form,
  });
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as SalesChatResult;
}

export async function fetchSalesChatList(): Promise<AssistantChatSummary[]> {
  const res = await fetch(CHATS_URL, { headers: await authHeaders(), cache: "no-store" });
  if (!res.ok) throw new Error(await readError(res));
  return ((await res.json()) as { chats: AssistantChatSummary[] }).chats;
}

export async function fetchSalesChat(id: string): Promise<SalesChatDoc> {
  const res = await fetch(`${CHATS_URL}?id=${encodeURIComponent(id)}`, {
    headers: await authHeaders(),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(await readError(res));
  return ((await res.json()) as { chat: SalesChatDoc }).chat;
}

export async function deleteSalesChat(id: string): Promise<void> {
  const res = await fetch(`${CHATS_URL}?id=${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error(await readError(res));
}
