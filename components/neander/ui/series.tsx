// ============================================================
//  차트 계열 색 — 재무·매출이 같은 색을 쓴다
// ------------------------------------------------------------
//  색은 임의로 고르지 않았다. 2계열(수입·지출)은 검증된 categorical
//  슬롯 1·2(blue/orange)다 — 색각 이상 조건에서도 구분되는 조합이다
//  (ΔE 24.7). 수입=초록/지출=빨강 조합은 적록색약에서 붙어 보이므로
//  쓰지 않는다. 같은 값이 app/neander/neander.css 의 --nd-series-* 다.
//
//  ⚠️ 재무 폴더에 있던 것을 여기로 옮겼다. 매출도 같은 색을 써야 하는데
//     매출이 재무를 import 하는 모양이 되어 있었다 — 두 모듈은 서로를
//     모르는 편이 맞다.
// ============================================================

/** 차트 계열 색 — 검증 통과 (light surface #ffffff) */
export const SERIES = {
  income: "#2a78d6",
  expense: "#eb6834",
  neutral: "#94a3b8",
} as const;

/** 순차 램프 — 히트맵의 농도 (하나의 hue, 밝음→어두움) */
export const BLUE_RAMP = [
  "#eff6ff",
  "#cde2fb",
  "#9ec5f4",
  "#6da7ec",
  "#3987e5",
  "#256abf",
  "#184f95",
] as const;

/** 셀 배경 농도 — 값이 클수록 진하게 (순차 램프) */
export function rampColor(value: number, max: number): string {
  if (!max || value <= 0) return "transparent";
  const r = Math.min(1, value / max);
  // 0 에 가까운 값이 흰 배경에 묻히지 않도록 최소 1단계는 준다
  const i = Math.min(BLUE_RAMP.length - 1, Math.max(1, Math.round(r * (BLUE_RAMP.length - 1))));
  return BLUE_RAMP[i];
}

/** 진한 배경 위에서는 흰 글씨로 (대비 확보) */
export function rampTextClass(value: number, max: number): string {
  if (!max || value <= 0) return "text-nd-fg-4";
  const r = Math.min(1, value / max);
  return r > 0.6 ? "text-white" : "text-nd-fg";
}
