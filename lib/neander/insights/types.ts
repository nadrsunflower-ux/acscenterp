// ============================================================
//  월간 인사이트 — 공통 계약 (매출·재무 보고)
// ------------------------------------------------------------
//  두 층으로 나눈다 (2026-09-15 사용자 결정):
//
//    1) 신호(Signal) — 코드가 데이터에서 뽑는 "평소와 다르거나 돈이 걸린 사실".
//       숫자는 전부 집계 함수에서 나오고 슬라이드 숫자와 원 단위로 맞는다. AI 없음.
//         매출: lib/neander/sales/signals.ts   buildSalesSignals
//         재무: lib/neander/finance/signals.ts buildFinanceSignals
//
//    2) 해설(InsightDoc) — 서버가 신호 목록만 AI 에 주고 우선순위·할 일·연결을
//       쓰게 한다. 신호에 없는 숫자는 쓰지 못하고, 문장마다 근거 신호 id 를 단다.
//       달마다 한 번 만들어 저장하고(neander_insights), 사람이 고치고 승인한 뒤
//       발표에 쓴다. 발표 중에 매번 AI 를 부르지 않는다 — 내용이 흔들리면 안 된다.
//         서버: app/api/neander/insights/route.neander.ts
//         클라: lib/neander/insights/client.ts · components/neander/insights/useInsight.ts
// ============================================================

export type InsightModule = "sales" | "finance";

export type SignalSeverity = "high" | "medium" | "low";

export interface SignalMetric {
  label: string;
  value: number;
  unit: "원" | "%" | "건" | "시간" | "일" | "배" | "개" | "";
}

/** 코드가 뽑은 사실 하나 */
export interface Signal {
  /** 안정적인 id — `topic:대상` (예: `event-efficiency:WE-053`). AI 가 근거로 인용한다 */
  id: string;
  module: InsightModule;
  /** 주제 (예: event-efficiency · bep-headroom · labor-productivity · fixed-cost-leak) */
  topic: string;
  severity: SignalSeverity;
  /** 한 줄 사실 — 숫자 포함 (예: 「와우 뉴진스 팝업 일당 공헌이익 -12만원」) */
  title: string;
  /** 두세 문장 설명 — 무엇과 비교했고 왜 중요한가 */
  detail: string;
  /** 월 영향 추정(원). + 이익을 늘릴 기회 · − 새는 돈. 추정할 근거가 없으면 비운다 */
  impact?: number;
  /** 근거 숫자 — 발표 화면에서 커서를 두면 보인다 */
  metrics: SignalMetric[];
  /** 연결할 슬라이드 장 이름 — DeckSlide.chapter 와 같은 문자열 (예: 「매장별 손익」) */
  chapter?: string;
  /** ERP 에서 확인할 곳 */
  href?: string;
}

/** AI(또는 사람)가 쓴 문장 하나 */
export interface InsightItem {
  id: string;
  /** 한 문장 */
  text: string;
  /** 부연 한두 문장 */
  detail?: string;
  /** 예상 영향 (예: 「월 +80만원」) — 근거 신호의 impact 에서만 */
  impact?: string;
  /** 근거 신호 id — 비어 있으면 안 된다 (서버가 거른다) */
  signalIds: string[];
}

export type InsightStatus = "draft" | "approved";

/** 한 달치 해설 — 문서 id = insightDocId(module, month, scope) */
export interface InsightDoc {
  id: string;
  module: InsightModule;
  /** `YYYY-MM` */
  month: string;
  /** 좁힌 범위 (재무 사업장 등). 비우면 전체 */
  scope?: string;
  status: InsightStatus;
  /** 이번 달 핵심 — 3개 안팎 */
  summary: InsightItem[];
  /** 다음 달 할 일 — 3개 안팎 */
  actions: InsightItem[];
  /** 확인이 필요한 것 — 리스크·데이터 신뢰도 */
  risks: InsightItem[];
  /** 장 이름(chapter) → 그 장 아래 한 줄 코멘트 */
  comments: Record<string, string>;
  /** 만들 때 쓴 신호 스냅샷 — 근거를 나중에 다시 볼 수 있게 */
  signals: Signal[];
  /** AI 없이 규칙으로만 만든 초안인가 (키 없음·AI 실패) */
  fallback?: boolean;
  model?: string;
  costUsd?: number;
  generatedAt: number;
  generatedBy?: string;
  updatedAt: number;
  updatedBy?: string;
  /**
   * 「AI 와 고치기」 대화 — 초안을 두고 묻고 고친 기록. 다시 만들기를 하면 사라진다
   * (그 대화가 가리키던 문장이 없어지기 때문). 서버 라우트의 discuss 가 덧붙인다.
   */
  discussion?: InsightDiscussionMessage[];
}

/** 사람이 고칠 수 있는 칸 */
export type InsightPatch = Partial<Pick<InsightDoc, "summary" | "actions" | "risks" | "comments" | "status">>;

export type InsightSection = "summary" | "actions" | "risks";

/** 편집 중인 문장들 — 저장 전 화면의 초안 */
export type InsightDraft = Pick<InsightDoc, InsightSection | "comments">;

/**
 * 대화에서 AI 가 낸 수정안 — 초안을 바꾸지 않는다. 사람이 「반영」을 누르면
 * 화면의 편집 초안에 들어가고(insights/edit.ts applyInsightEdit), 「저장」을
 * 눌러야 문서에 남는다.
 */
export type InsightEditProposal =
  | {
      id: string;
      kind: "item";
      section: InsightSection;
      op: "replace" | "add" | "remove";
      /** replace·remove 의 대상 문장 id */
      targetId?: string;
      /** replace·add 의 새 문장 */
      item?: Omit<InsightItem, "id">;
      /** 제안할 때의 원래 문장 — 전/후를 보여 주려고 */
      before?: InsightItem;
      reason: string;
    }
  | {
      id: string;
      kind: "comment";
      chapter: string;
      /** 비어 있으면 그 장의 코멘트를 지운다 */
      text: string;
      before?: string;
      reason: string;
    };

export interface InsightDiscussionMessage {
  role: "user" | "assistant";
  content: string;
  at: number;
  toolCalls?: { name: string; args: Record<string, unknown>; summary: string }[];
  proposals?: InsightEditProposal[];
  model?: string;
  costUsd?: number;
}

export const insightDocId = (module: InsightModule, month: string, scope?: string) =>
  `${module}_${month}${scope ? `_${scope.replace(/[^\w가-힣-]/g, "")}` : ""}`;

/**
 * 신호 함수 시그니처 (구현은 각 모듈 signals.ts).
 *
 *   buildSalesSignals(input: SalesSignalInput): Signal[]
 *   buildFinanceSignals(input: FinanceSignalInput): Signal[]
 *
 * 입력 타입은 각 모듈 파일이 export 한다 — 서버 라우트와 화면이 같은 함수를 부른다.
 * 결과는 severity(high→low) · |impact| 큰 순으로 정렬해 돌려준다.
 */
export const SEVERITY_ORDER: Record<SignalSeverity, number> = { high: 0, medium: 1, low: 2 };

export function sortSignals(signals: Signal[]): Signal[] {
  return [...signals].sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      Math.abs(b.impact ?? 0) - Math.abs(a.impact ?? 0),
  );
}
