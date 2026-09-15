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
  /**
   * 고를 때 한 번 물어본다. 값이 있으면 그 글이 확인 창의 이유 줄로 나간다.
   *
   * 켜 두는 이유는 **돈**이다. 재무 비서는 장부 전체를 맥락으로 물고 다녀서
   * 한 번 물어보는 데 드는 토큰이 적지 않고, 기본 모델과 몇 배가 차이 난다.
   * 메뉴는 한 번 누르면 그만이라 바꾼 줄 모르고 한 달을 쓰기 쉽다 — 그래서
   * 고르는 순간에만 잠깐 막아 세운다.
   *
   * 새 모델을 넣을 때도 기본 모델보다 눈에 띄게 비싸면 이 칸을 채운다.
   */
  confirm?: string;
}

export const FIN_AI_MODELS: FinAiModelOption[] = [
  {
    id: "anthropic/claude-opus-5",
    label: "Claude Opus 5",
    note: "성능/비용 균형",
    confirm: "기본 모델(Gemini 3.7 Flash)보다 훨씬 비쌉니다.",
  },
  {
    id: "anthropic/claude-fable-5",
    label: "Claude Fable 5",
    note: "최고 성능 · 비용 2배",
    confirm: "이 목록에서 가장 비쌉니다 — Claude Opus 5 의 2배입니다.",
  },
  {
    id: "anthropic/claude-sonnet-5",
    label: "Claude Sonnet 5",
    note: "빠름 · 저렴",
    confirm: "Claude 중에서는 저렴하지만, 기본 모델보다는 비쌉니다.",
  },
  { id: "google/gemini-3.1-pro-preview", label: "Gemini 3.1 Pro", note: "구글 상위 모델" },
  { id: "google/gemini-3.7-flash", label: "Gemini 3.7 Flash", note: "기본 · 가장 저렴 · 빠름" },
];

export const DEFAULT_FIN_AI_MODEL = "google/gemini-3.7-flash";

/**
 * 월간 인사이트(만들기 · AI 와 고치기) 기본 모델 — 비서와 따로 둔다 (2026-09-15 사용자 결정).
 * 달에 몇 번만 쓰고 대표 보고 문장이라 판단 품질이 비용보다 중요하다 (1회 약 $0.03).
 * OPENROUTER_MODEL 환경변수의 영향을 받지 않는다 — 그건 비서 기본값이다.
 */
export const INSIGHT_AI_MODEL = "anthropic/claude-sonnet-5";

/** 허용 목록에 있는 모델 ID 인가 — 서버가 요청 본문을 검증할 때 쓴다 */
export const isFinAiModelId = (id: unknown): id is string =>
  typeof id === "string" && FIN_AI_MODELS.some((m) => m.id === id);

/** 목록에서 모델 하나를 찾는다. 없으면 undefined — 부르는 쪽이 기본값을 정한다 */
export const finAiModel = (id: string): FinAiModelOption | undefined =>
  FIN_AI_MODELS.find((m) => m.id === id);

/** 화면에 쓸 이름. 목록에 없는 ID(옛 저장값·서버 기본값)는 ID 를 그대로 보여준다 */
export const finAiModelLabel = (id: string): string => finAiModel(id)?.label ?? id;

/**
 * 고르기 전에 확인 창을 띄워야 하는가.
 *
 * 이미 쓰고 있는 모델을 다시 누른 것은 묻지 않는다 — 바뀌는 게 없는데
 * 물으면 확인 창이 값싸 보이고, 정작 바꿀 때 사람이 그냥 누르게 된다.
 */
export const finAiModelConfirm = (id: string, current: string): string | undefined =>
  id === current ? undefined : finAiModel(id)?.confirm;
