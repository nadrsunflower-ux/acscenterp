// ============================================================
//  매출이 쓰는 색 — 매장 · 비용 갈래 · 손익 막대
// ------------------------------------------------------------
//  표의 뱃지와 차트의 막대가 같은 매장이면 같은 색이어야 한다. 화면마다
//  색을 적으면 반드시 갈라지므로 여기 한 곳에서만 정한다.
//  (수입·지출 같은 **공통** 계열 색은 components/neander/ui/series 에 있다)
// ============================================================

import type { SalesStore } from "@/lib/neander/sales/types";

/**
 * 매장 계열 색 — 표·뱃지·차트에서 같은 매장이 같은 색이어야 한다.
 *
 * 아이디·와우는 검증된 categorical 슬롯 1·2(blue/orange)를 쓴다. 재무
 * 차트의 수입·지출과 같은 색이라 두 화면의 색 감각이 어긋나지 않는다.
 * 온라인은 세 번째 계열이라 명도까지 다른 보라를 쓴다 — 적록색약에서
 * 초록을 세 번째로 쓰면 주황과 붙어 보인다.
 */
export const STORE_SERIES: Record<SalesStore, string> = {
  id: "#2a78d6",
  wow: "#eb6834",
  online: "#6d4bb8",
};

/**
 * 매장 셋을 합친 막대 — 회색. 매장 색 셋과 겹치지 않고, 「어느 매장도 아닌
 * 전체」라는 뜻이 색으로 읽힌다. 공통 계열의 neutral(ui/series)과 같은 값.
 */
export const STORE_TOTAL_COLOR = "#94a3b8";

/** 변동비 네 갈래의 색 — 어디서 새는지 한눈에 보이려면 색이 고정이어야 한다 */
export const COST_SERIES = {
  /** 직접재료비 */
  material: "#eb6834",
  /** 인건비 (이벤트 스태프 · 제작) */
  labor: "#e0a92f",
  /**
   * 아이디 상시 인건비 — 인건비와 같은 계열의 짙은 황토. 성격은 고정비(매장을
   * 여는 한 매달 나간다)지만 사람에게 가는 돈이라 회색 고정비에 섞으면
   * 아이디만 인건비가 없는 것처럼 보였다.
   */
  regularLabor: "#a8741a",
  /** 이벤트 준비물 */
  supplies: "#9b6dd6",
  /** 결제 수수료 */
  fee: "#7a8899",
  /** 공헌이익 */
  contribution: "#2a78d6",
  /** 배부 고정비 */
  fixed: "#94a3b8",
} as const;

export const COST_LEGEND = [
  { key: "material", label: "재료비", color: COST_SERIES.material },
  { key: "labor", label: "인건비", color: COST_SERIES.labor },
  { key: "supplies", label: "준비물", color: COST_SERIES.supplies },
  { key: "fee", label: "수수료", color: COST_SERIES.fee },
] as const;

/** 빗금 — 「금액은 있지만 원가를 모른다(미확정)」 를 색이 아니라 무늬로 */
export const HATCH =
  "repeating-linear-gradient(135deg, rgba(15,23,42,0.22) 0 3px, rgba(15,23,42,0.04) 3px 7px)";

/** 손익 막대의 색 — 매출 줄은 옅게, 비용 줄은 COST_SERIES, 손실은 danger */
export const PNL_BAR = {
  confirmed: "#c7dcf6",
  loss: "#dc2626",
} as const;
