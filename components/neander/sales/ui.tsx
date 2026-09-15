// ============================================================
//  매출 표시 부품 모음 (배럴)
// ------------------------------------------------------------
//  매출이 **소유한** 것만 모은다. 금액(Money·StatTile)·월 고르기
//  (MonthStepper)·월 이름(monthLabel)처럼 두 모듈이 함께 쓰는 것은
//  공통 자리에 있고, 화면이 거기서 바로 가져간다:
//    @/components/neander/ui        금액·차트·컨트롤
//    @/lib/neander/format           monthLabel · formatSigned · shortWon
//
//  ⚠️ 예전에는 이 파일이 `@/components/neander/finance/ui` 를 다시
//     내보냈다. 매출 화면이 금액 하나 찍으려고 **재무 모듈을 거쳐야**
//     했고, 재무 파일을 고치면 매출이 깨졌다. 두 모듈은 서로를 모른다.
// ============================================================

export { COST_LEGEND, COST_SERIES, HATCH, PNL_BAR, STORE_SERIES, STORE_TOTAL_COLOR } from "./series";
export { Rate, RateTile, ReviewBadge, StoreBadge } from "./format";
export { PnlBar, PnlBarLegend, pnlBarExtent, type PnlBarInput } from "./PnlBar";
export { ProductCell, ProductHero, ProductThumb } from "./ProductMedia";
export { SalesDrill, type SalesDrillProps } from "./SalesDrill";
