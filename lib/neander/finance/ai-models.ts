// ============================================================
//  재무 비서가 쓸 수 있는 모델 목록
// ------------------------------------------------------------
//  서버(허용 목록 검증)와 클라이언트(선택 UI)가 같이 쓴다.
//
//  OpenRouter 모델 ID 를 여기 추가하면 선택지가 늘어난다. 단, 도구 호출(tools)
//  과 reasoning_effort 를 지원하는 모델이어야 한다 — ai-chat.ts 가
//  provider.require_parameters 를 켜고 있어서, 파라미터를 못 받는 모델은
//  라우팅이 실패한다. https://openrouter.ai/api/v1/models 의
//  supported_parameters 로 확인할 것. (gemini-2.5-pro 가 이 이유로 빠져 있다.)
// ============================================================

export interface FinAiModelOption {
  /** OpenRouter 모델 ID */
  id: string;
  label: string;
  /** 고르는 데 도움이 되는 한 줄 — 성능/비용 감각 */
  note: string;
}

export const FIN_AI_MODELS: FinAiModelOption[] = [
  { id: "anthropic/claude-opus-5", label: "Claude Opus 5", note: "기본 · 성능/비용 균형" },
  { id: "anthropic/claude-fable-5", label: "Claude Fable 5", note: "최고 성능 · 비용 2배" },
  { id: "anthropic/claude-sonnet-5", label: "Claude Sonnet 5", note: "빠름 · 저렴" },
  { id: "google/gemini-3.1-pro-preview", label: "Gemini 3.1 Pro", note: "구글 상위 모델" },
  { id: "google/gemini-3.7-flash", label: "Gemini 3.7 Flash", note: "가장 저렴 · 빠름" },
];

export const DEFAULT_FIN_AI_MODEL = "anthropic/claude-opus-5";

/** 허용 목록에 있는 모델 ID 인가 — 서버가 요청 본문을 검증할 때 쓴다 */
export const isFinAiModelId = (id: unknown): id is string =>
  typeof id === "string" && FIN_AI_MODELS.some((m) => m.id === id);
