// ============================================================
//  비서 대화 기록 — 모듈 공용 타입과 저장 규칙
// ------------------------------------------------------------
//  재무 비서의 chat-log.ts 와 같은 규칙이다. 제안(proposal)의 모양만 모듈마다
//  달라서 제네릭으로 뺐다 — 재무는 「거래를 이렇게 고치자」, 매출은 「이
//  줄들을 이 상품으로 확정하자」.
//
//  비서는 답만 하는 게 아니라 **바꾸자고 제안**한다. 그 제안을 받아들여
//  데이터가 바뀌었는데 나중에 "왜 이렇게 됐지?" 를 되짚을 수 없으면
//  곤란하다. 그래서 답변만이 아니라 **무엇을 조회했는지와 무엇을 제안했는지**
//  를 함께 남긴다. 근거가 빠진 로그는 감사 추적이 되지 못한다.
//
//  ⚠️ Firestore 문서는 1MB 가 상한이다. 대화가 길어지면 조용히 저장이
//     실패하는데, 그게 로그에서 가장 나쁜 실패다(있는 줄 알았는데 없다).
//     그래서 저장 직전에 오래된 것부터 덜어낸다.
//
//  재무 비서는 아직 자기 chat-log.ts 를 쓴다. 그쪽 작업이 잠잠해지면 이
//  파일로 옮기면 된다 — 구조가 같다.
// ============================================================

export interface AssistantToolCall {
  name: string;
  args: Record<string, unknown>;
  /** 화면에 한 줄로 보여줄 요약 */
  summary: string;
}

/** 한 번의 발화 */
export interface AssistantMessage<P = unknown> {
  role: "user" | "assistant";
  content: string;
  at: number;
  /** 비서가 무엇을 조회했는지 — 답의 근거 */
  toolCalls?: AssistantToolCall[];
  /** 이 답에서 제안한 변경 */
  proposals?: P[];
}

export interface AssistantChatDoc<P = unknown> {
  id: string;
  /** 소유자 이메일. 목록은 이 값으로 갈린다 */
  owner: string;
  /** 목록에 보일 제목 — 첫 질문에서 만든다 */
  title: string;
  messages: AssistantMessage<P>[];
  createdAt: number;
  updatedAt: number;
  /** 이 대화에 든 누적 비용(USD) */
  costUsd?: number;
}

/** 목록에 쓸 요약 — 본문을 다 내려받지 않는다 */
export interface AssistantChatSummary {
  id: string;
  title: string;
  updatedAt: number;
  messageCount: number;
  hasProposals: boolean;
}

export const MAX_MESSAGES = 200;
const MAX_CONTENT = 8000;
const MAX_BYTES = 700_000;

export function titleFrom(messages: AssistantMessage[]): string {
  const first = messages.find((m) => m.role === "user")?.content?.trim() ?? "";
  const line = first.split("\n").find((l) => l.trim()) ?? first;
  const t = line.trim().slice(0, 40);
  return t || "새 대화";
}

const bytes = (v: unknown) => new TextEncoder().encode(JSON.stringify(v)).length;

/** 저장 전에 크기를 맞춘다 — 최근 것을 지키고 오래된 것부터 버린다 */
export function trimForStore<P>(messages: AssistantMessage<P>[]): AssistantMessage<P>[] {
  let out = messages.slice(-MAX_MESSAGES).map((m) =>
    m.content.length > MAX_CONTENT
      ? { ...m, content: `${m.content.slice(0, MAX_CONTENT)}\n\n…(길어서 줄임)` }
      : m,
  );
  while (out.length > 2 && bytes(out) > MAX_BYTES) out = out.slice(1);
  return out;
}

export const summaryOf = (doc: AssistantChatDoc): AssistantChatSummary => ({
  id: doc.id,
  title: doc.title,
  updatedAt: doc.updatedAt,
  messageCount: doc.messages?.length ?? 0,
  hasProposals: (doc.messages ?? []).some((m) => (m.proposals?.length ?? 0) > 0),
});
