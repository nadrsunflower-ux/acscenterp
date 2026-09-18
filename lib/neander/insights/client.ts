"use client";

// ============================================================
//  월간 인사이트 클라이언트 — 서버 API 경유 (insights/types.ts)
// ------------------------------------------------------------
//  재무·매출과 같은 이유로 Firestore 에 직접 붙지 않는다 (보안 규칙 게시 권한 없음).
// ============================================================

import { getNeanderAuth } from "@/lib/neander/firebase";
import type { AgentMessage, AgentResult } from "@/lib/neander/ai/agent";
import type {
  InsightDiscussionMessage,
  InsightDoc,
  InsightDraft,
  InsightEditProposal,
  InsightItemRef,
  InsightModule,
  InsightPatch,
} from "./types";

const URL = "/api/neander/insights";

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

/** 저장된 해설 — 아직 없으면 null */
export async function fetchInsight(module: InsightModule, month: string, scope?: string): Promise<InsightDoc | null> {
  const q = new URLSearchParams({ module, month });
  if (scope) q.set("scope", scope);
  const res = await fetch(`${URL}?${q.toString()}`, { headers: await authHeaders(), cache: "no-store" });
  if (!res.ok) throw new Error(await readError(res));
  const body = (await res.json()) as { doc: InsightDoc | null };
  return body.doc;
}

/**
 * 해설을 새로 만든다 — 서버가 신호를 다시 뽑고 AI 에 해설을 맡겨 초안(draft)으로 저장한다.
 * 이미 있던 해설(사람이 고친 것 포함)은 덮어쓴다 — 부르는 쪽이 먼저 확인한다.
 */
export async function generateInsight(
  module: InsightModule,
  month: string,
  opts: { scope?: string; model?: string } = {},
): Promise<InsightDoc> {
  const res = await fetch(URL, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({ action: "generate", module, month, ...opts }),
  });
  if (!res.ok) throw new Error(await readError(res));
  return ((await res.json()) as { doc: InsightDoc }).doc;
}

/**
 * 「AI 와 고치기」 한 턴 — 편집 중인 초안(저장 전)을 함께 보낸다.
 * 수정안은 돌아오기만 하고 저장되지 않는다. discussion 은 서버에 쌓인 대화 전체.
 */
export async function discussInsight(
  module: InsightModule,
  month: string,
  args: { scope?: string; messages: AgentMessage[]; draft: InsightDraft; model?: string; focus?: InsightItemRef },
): Promise<{ result: AgentResult<InsightEditProposal>; discussion: InsightDiscussionMessage[] }> {
  const res = await fetch(URL, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({ action: "discuss", module, month, ...args }),
  });
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as { result: AgentResult<InsightEditProposal>; discussion: InsightDiscussionMessage[] };
}

export async function clearInsightDiscussion(module: InsightModule, month: string, scope?: string): Promise<void> {
  const res = await fetch(URL, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({ action: "clear-discussion", module, month, scope }),
  });
  if (!res.ok) throw new Error(await readError(res));
}

/** 사람이 고친 문장·승인 상태를 저장한다 */
export async function saveInsight(
  module: InsightModule,
  month: string,
  patch: InsightPatch,
  scope?: string,
): Promise<InsightDoc> {
  const res = await fetch(URL, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({ action: "save", module, month, scope, patch }),
  });
  if (!res.ok) throw new Error(await readError(res));
  return ((await res.json()) as { doc: InsightDoc }).doc;
}

/** 그 달 해설을 지운다 — 되돌릴 수 없다 (다시 만들기로 새 초안을 만들 수는 있다) */
export async function deleteInsight(module: InsightModule, month: string, scope?: string): Promise<void> {
  const res = await fetch(URL, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({ action: "delete", module, month, scope }),
  });
  if (!res.ok) throw new Error(await readError(res));
}
