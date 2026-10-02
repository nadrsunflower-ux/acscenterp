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

// ---- 보고 있는 것 ---------------------------------------------
//  화면 → 비서: 지금 고른 대상 (검토 대기함의 커서 거래). null 이면 없음.
//  비서 패널은 화면보다 **늦게** 귀를 열 수 있다 (레이아웃의 효과가 화면의 효과 뒤에
//  돈다). 그래서 이벤트만 쏘지 않고 마지막 값을 들고 있는다 — 패널이 뜰 때 읽어 간다.

export const ASSISTANT_FOCUS_EVENT = "neander:assistant-focus";
export type { AssistantFocus } from "@/lib/neander/ai/focus";
import type { AssistantFocus } from "@/lib/neander/ai/focus";

let currentFocus: AssistantFocus | null = null;

/** 보고 있는 대상을 비서에게 알린다 (null = 고른 것 없음 · 화면을 떠남) */
export function setAssistantFocus(focus: AssistantFocus | null) {
  currentFocus = focus;
  window.dispatchEvent(new CustomEvent(ASSISTANT_FOCUS_EVENT, { detail: focus }));
}

export const getAssistantFocus = () => currentFocus;

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
