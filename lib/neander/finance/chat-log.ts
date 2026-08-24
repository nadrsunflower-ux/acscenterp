// ============================================================
//  재무 비서 대화 기록
// ------------------------------------------------------------
//  비서는 묻는 말에 답만 하는 게 아니라 **장부를 고치자고 제안**한다.
//  그 제안을 받아들여 장부가 바뀌었는데 나중에 "왜 이렇게 됐지?" 를
//  되짚을 수 없으면 곤란하다. 그래서 답변만이 아니라 **비서가 무엇을
//  조회했는지와 무엇을 제안했는지**를 함께 남긴다. 근거가 빠진 로그는
//  감사 추적이 되지 못한다.
//
//  대화는 **사람마다 따로** 쌓인다. 남의 대화 목록에 내 것이 섞이면
//  이어가기가 무의미해진다.
//
//  ⚠️ Firestore 문서는 1MB 가 상한이다. 대화가 길어지면 조용히 저장이
//     실패하는데, 그게 로그에서 가장 나쁜 실패다(있는 줄 알았는데 없다).
//     그래서 저장 직전에 오래된 것부터 덜어낸다.
// ============================================================

import type { ChangeProposal } from "./client";

/** 한 번의 발화 */
export interface FinChatMessage {
  role: "user" | "assistant";
  content: string;
  at: number;
  /** 비서가 무엇을 조회했는지 — 답의 근거 */
  toolCalls?: { name: string; summary: string }[];
  /** 이 답에서 제안한 변경 */
  proposals?: ChangeProposal[];
}

export interface FinChatDoc {
  id: string;
  /** 소유자 이메일. 목록은 이 값으로 갈린다 */
  owner: string;
  /** 목록에 보일 제목 — 첫 질문에서 만든다 */
  title: string;
  messages: FinChatMessage[];
  createdAt: number;
  updatedAt: number;
  /** 이 대화에 든 누적 비용(USD) */
  costUsd?: number;
}

/** 목록에 쓸 요약 — 본문을 다 내려받지 않는다 */
export interface FinChatSummary {
  id: string;
  title: string;
  updatedAt: number;
  messageCount: number;
  /** 제안이 하나라도 있었나 — 목록에서 눈에 띄게 */
  hasProposals: boolean;
}

/** 문서 하나에 담는 상한. 넘으면 오래된 발화부터 덜어낸다 */
export const MAX_MESSAGES = 200;
/** 발화 하나의 길이 상한 (자) */
const MAX_CONTENT = 8000;
/** 대략적인 문서 크기 상한 — 1MB 보다 넉넉히 아래 */
const MAX_BYTES = 700_000;

/** 첫 질문에서 제목을 만든다. 목록에서 알아볼 수 있을 만큼만. */
export function titleFrom(messages: FinChatMessage[]): string {
  const first = messages.find((m) => m.role === "user")?.content?.trim() ?? "";
  const line = first.split("\n").find((l) => l.trim()) ?? first;
  const t = line.trim().slice(0, 40);
  return t || "새 대화";
}

const bytes = (v: unknown) => new TextEncoder().encode(JSON.stringify(v)).length;

/**
 * 저장 전에 크기를 맞춘다.
 *
 * 최근 것을 지키고 오래된 것부터 버린다 — 되짚을 때 보통 최근을 본다.
 * 아주 긴 발화 하나가 문서를 통째로 밀어낼 수 있어 본문도 자른다.
 */
export function trimForStore(messages: FinChatMessage[]): FinChatMessage[] {
  let out = messages.slice(-MAX_MESSAGES).map((m) =>
    m.content.length > MAX_CONTENT
      ? { ...m, content: `${m.content.slice(0, MAX_CONTENT)}\n\n…(길어서 줄임)` }
      : m,
  );
  // 그래도 크면 앞에서부터 덜어낸다
  while (out.length > 2 && bytes(out) > MAX_BYTES) {
    out = out.slice(1);
  }
  return out;
}

export const summaryOf = (doc: FinChatDoc): FinChatSummary => ({
  id: doc.id,
  title: doc.title,
  updatedAt: doc.updatedAt,
  messageCount: doc.messages?.length ?? 0,
  hasProposals: (doc.messages ?? []).some((m) => (m.proposals?.length ?? 0) > 0),
});
