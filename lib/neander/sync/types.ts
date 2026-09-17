// ============================================================
//  동기화 상태 — 어디까지 가져왔나, 지난번에 무슨 일이 있었나
// ------------------------------------------------------------
//  자동으로 도는 일은 **보이지 않으면 믿을 수 없다.** 조용히 멈춘 동기화는
//  틀린 숫자보다 나쁘다 — 화면은 멀쩡해 보이는데 지난주부터 매출이 안
//  들어오고 있는 상태가 되기 때문이다.
//
//  그래서 매번의 결과를 남긴다: 몇 건 받았고, 몇 줄이 새로 생기고 고쳐지고
//  지워졌고, 몇 줄을 **건드리지 않았고**(사람이 고친 줄), 왜 그랬는지.
//  /neander/sales/sync 가 이 문서를 그대로 보여준다.
// ============================================================

import type { FeedSource } from "./contract";

/** 동기화 상태 (문서 id = FeedSource) */
export interface SyncState {
  id: FeedSource;
  /** 여기까지 받았다 (사이트의 수정 시각, ms) — 화면에 보여줄 때만 쓴다 */
  cursor: number;
  /**
   * 사이트에 돌려줄 커서 열쇠 (contract.ts FeedEnvelope.cursorKey). ERP 는 속을
   * 보지 않고 저장했다가 after 로 돌려준다. 비어 있으면 처음부터 받는다.
   */
  cursorKey?: string;
  /**
   * 이 날짜 이전의 매출은 가져오지 않는다 (YYYY-MM-DD).
   *
   * 온라인은 2026-02~08 을 이미 엑셀로 적재해 두었다. 자동 적재를 그
   * 구간까지 켜면 같은 판매가 두 번 잡힌다 — 엑셀 줄은 문서 id 가 달라
   * 멱등키로 막히지 않기 때문이다. 겹치지 않는 달부터 켠다.
   */
  startFrom?: string;
  /** 자동으로 돌지 않게 멈춰 둔다 (사람이 부르는 「지금 동기화」는 된다) */
  paused?: boolean;
  lastRunAt?: number;
  lastRun?: SyncRun;
  /** 마지막으로 **성공한** 동기화 — 실패가 이어질 때 언제부터인지 보려고 */
  lastOkAt?: number;
  /**
   * 이 시각까지 누가 돌고 있다 (임대). 신호와 주기 실행이 겹쳐 서로의 쓰기를
   * 되돌리지 않게 한 번에 하나만 돈다. 0 이면 비어 있다.
   */
  leaseUntil?: number;
  /**
   * 도는 동안 신호가 또 왔다. 도는 실행은 이미 피드를 읽은 뒤일 수 있어서,
   * 그 사이 결제는 다음 실행까지 기다려야 한다 — 주기 실행이 하루 한 번이라
   * 최대 하루다. 그래서 끝날 때 이 표시가 있으면 **한 번 더** 돈다.
   */
  rerunRequested?: boolean;
}

/**
 * 풀릴 때까지 남기는 것 (문서 id = `${source}_${주문·결제·줄 id}`).
 *
 *   not_loaded  적재하지 못한 주문 — 금액이 안 맞거나 날짜·품목이 없다.
 *               커서는 이미 지나갔으니, 사이트에서 그 주문이 고쳐져 다시
 *               오거나 사람이 확인할 때까지 여기 남는다.
 *   conflict    사람이 고친 줄과 사이트 값이 어긋났다. 사람 것이 이기므로
 *               동기화는 손대지 않고, 어긋났다는 사실만 남긴다.
 */
export interface SyncIssue {
  id: string;
  source: FeedSource;
  kind: "not_loaded" | "conflict";
  /** 주문번호·학원 이름처럼 사람이 알아볼 열쇠 */
  key: string;
  note: string;
  /** 그 판매의 날짜 (알 때만) */
  date?: string;
  /** 마지막으로 확인한 시각 */
  at: number;
}

/** 한 번 돈 결과 */
export interface SyncRun {
  source: FeedSource;
  at: number;
  ok: boolean;
  /** 사람이 불렀나, 신호를 받았나, 주기로 돌았나 */
  trigger: SyncTrigger;
  /** 누가 불렀나 (사람일 때만) */
  by?: string;
  durationMs: number;
  /** 피드를 몇 번 불렀나 */
  pages: number;
  /** 피드가 준 줄 수 */
  fetched: number;
  created: number;
  updated: number;
  deleted: number;
  /** 사람이 고친 줄이라 건드리지 않았다 */
  skipped: number;
  /** 검토 대기함으로 간 줄 */
  needsReview: number;
  /**
   * 사람이 읽어야 할 것 — 적재하지 않은 주문, 사람 손이 닿아 건너뛴 줄,
   * 금액이 맞지 않은 주문. 조용히 넘어가면 안 되는 것만 담는다.
   */
  notes: SyncNote[];
  error?: string;
  /**
   * 이미 도는 실행이 있어 이번에는 돌지 않았다. 도는 실행이 끝나면 한 번 더
   * 돌도록 표시해 두었다 — 화면은 "완료"가 아니라 "곧 반영"이라고 말한다.
   */
  deferred?: boolean;
}

export type SyncTrigger = "manual" | "signal" | "cron";

export const TRIGGER_LABEL: Record<SyncTrigger, string> = {
  manual: "직접 실행",
  signal: "사이트 신호",
  cron: "주기 실행",
};

export interface SyncNote {
  /** 주문번호·결제 id 처럼 되짚을 수 있는 열쇠 */
  key: string;
  note: string;
  /** 이 줄을 사람이 봐야 하는가 */
  level: "info" | "warn";
}

export const EMPTY_RUN = (source: FeedSource, trigger: SyncTrigger): SyncRun => ({
  source,
  at: Date.now(),
  ok: false,
  trigger,
  durationMs: 0,
  pages: 0,
  fetched: 0,
  created: 0,
  updated: 0,
  deleted: 0,
  skipped: 0,
  needsReview: 0,
  notes: [],
});

/** 이번 실행이 실제로 무언가를 바꿨나 — 화면이 "변화 없음"을 말할 근거 */
export const runChanged = (r: SyncRun) => r.created + r.updated + r.deleted > 0;

/**
 * 온라인 자동 적재를 켜는 기본 시작일.
 *
 * 2026-02~08 은 관리자 엑셀(「페이히어 온라인」 시트)로 이미 적재돼 있다.
 * 9월부터 자동으로 받는다 — 8월까지는 엑셀이 정본, 9월부터는 피드가 정본.
 * 과거를 자동으로 다시 받고 싶으면 그 달의 엑셀 적재를 **먼저 되돌리고**
 * (적재 이력 › 되돌리기) startFrom 을 옮긴다.
 */
export const DEFAULT_ONLINE_START = "2026-09-01";
