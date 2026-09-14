// ============================================================
//  재무 비서 대화 기록 — 공용 타입에 재무 제안을 끼운 별칭
// ------------------------------------------------------------
//  ⚠️ 예전에는 이 파일이 공용(lib/neander/ai/chat-log.ts)과 **같은 타입과
//     같은 함수**(titleFrom · trimForStore · summaryOf)를 한 벌 더 갖고
//     있었다. 상한값(MAX_MESSAGES)까지 같은 숫자를 두 곳에 적어 둬서,
//     한쪽만 고치면 재무와 매출의 저장 규칙이 조용히 갈라질 수 있었다.
//     이제 공용 것을 쓰고 여기에는 **재무라는 이름표**만 남긴다.
// ============================================================

import type { AssistantChatDoc, AssistantChatSummary, AssistantMessage } from "@/lib/neander/ai/chat-log";
import type { ChangeProposal } from "./client";

export type FinChatMessage = AssistantMessage<ChangeProposal>;
export type FinChatDoc = AssistantChatDoc<ChangeProposal>;
export type FinChatSummary = AssistantChatSummary;

export { MAX_MESSAGES, summaryOf, titleFrom, trimForStore } from "@/lib/neander/ai/chat-log";
