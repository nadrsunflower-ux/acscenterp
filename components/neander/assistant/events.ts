// ============================================================
//  비서 호출 이벤트 — 도구 막대가 가려진 화면에서도 비서를 부른다
// ------------------------------------------------------------
//  재무·매출 비서(AssistantChat)는 모듈 레이아웃에 붙어 상단 도구 막대에 버튼을
//  올린다. 발표 화면(Deck)은 화면 전체를 덮어 그 버튼이 보이지 않으므로, 두 쪽이
//  창 이벤트로 이야기한다 — Deck 은 어느 비서가 있는지 몰라도 된다.
//
//    Deck → 비서   ASSISTANT_EVENT        { action: "toggle" | "open" | "close" | "ping" }
//    비서 → Deck   ASSISTANT_STATE_EVENT  { name, open }  (name 이 null 이면 비서 없음)
// ============================================================

export const ASSISTANT_EVENT = "neander:assistant";
export const ASSISTANT_STATE_EVENT = "neander:assistant-state";
/** Deck → 비서: 지금 발표 중인 달·장. detail 이 null 이면 발표 끝 */
export const ASSISTANT_CONTEXT_EVENT = "neander:assistant-context";

export type { PresentationContext } from "@/lib/neander/ai/presentation";
import type { PresentationContext } from "@/lib/neander/ai/presentation";

/** 발표 맥락을 비서에게 알린다 (null = 발표 끝) */
export function setAssistantContext(ctx: PresentationContext | null) {
  window.dispatchEvent(new CustomEvent(ASSISTANT_CONTEXT_EVENT, { detail: ctx }));
}

export type AssistantAction = "toggle" | "open" | "close" | "ping";

export interface AssistantState {
  /** 지금 화면에 붙은 비서 이름 (재무 비서 · 매출 비서). 없으면 null */
  name: string | null;
  open: boolean;
}

export function callAssistant(action: AssistantAction) {
  window.dispatchEvent(new CustomEvent(ASSISTANT_EVENT, { detail: { action } }));
}

export function announceAssistant(state: AssistantState) {
  window.dispatchEvent(new CustomEvent(ASSISTANT_STATE_EVENT, { detail: state }));
}
