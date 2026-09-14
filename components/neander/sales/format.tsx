"use client";

// ============================================================
//  매출 전용 표시 부품 — 비율 · 매장 뱃지 · 미확정 뱃지
// ------------------------------------------------------------
//  금액(Money·StatTile)과 월 이름은 재무와 같은 것을 쓴다
//  (components/neander/ui). 여기 있는 것은 매출에만 있는 개념이다.
// ============================================================

import type { ReactNode } from "react";
import { Badge, KpiItem, cn, type Tone } from "@/components/neander/ui";
import { pct, storeLabel, type SalesStore } from "@/lib/neander/sales/types";
import { STORE_SERIES } from "./series";

/** 비율 표시. 분모가 0 이면 「—」 (0% 로 보이면 거짓말이 된다) */
export function Rate({
  value,
  digits = 1,
  className,
  tone,
}: {
  value: number | null | undefined;
  digits?: number;
  className?: string;
  tone?: "auto" | "plain";
}) {
  const auto =
    tone === "auto" && value !== null && value !== undefined
      ? value >= 0.7
        ? "text-nd-success-text"
        : value >= 0.4
          ? "text-nd-fg"
          : "text-nd-warning-text"
      : "text-nd-fg";
  return <span className={cn("nd-num", auto, className)}>{pct(value, digits)}</span>;
}

/** 비율 KPI 타일 — StatTile 이 금액 전용이라 비율은 따로 둔다 */
export function RateTile({
  label,
  value,
  hint,
  tone,
  digits = 1,
}: {
  label: string;
  value: number | null | undefined;
  hint?: ReactNode;
  tone?: Tone;
  digits?: number;
}) {
  return (
    <KpiItem
      label={label}
      value={<span className="nd-num">{pct(value, digits)}</span>}
      hint={hint}
      tone={tone}
    />
  );
}

/**
 * 매장 뱃지 — 차트와 **같은 색**을 쓴다.
 *
 * 테마 톤(accent/warning/info)으로 두면 표의 뱃지와 차트의 막대가 서로
 * 다른 색이 된다. 온라인이 뱃지에서는 하늘색, 막대에서는 보라색이면 같은
 * 매장으로 읽히지 않는다. Badge 의 color 는 "데이터가 가진 색" 을 받는
 * 자리이므로 여기에 STORE_SERIES 를 그대로 넘긴다.
 */
export function StoreBadge({ store, size = "md" }: { store: SalesStore; size?: "sm" | "md" }) {
  return (
    <Badge color={STORE_SERIES[store]} size={size}>
      {storeLabel(store)}
    </Badge>
  );
}

/**
 * 미확정 금액 알림용 뱃지 — 이 숫자에 아직 원가를 모르는 매출이 얼마
 * 섞여 있는지 항상 같이 보여준다. 엑셀이 조용히 평균원가율로 메운 지점.
 */
export function ReviewBadge({ count, amount }: { count: number; amount: number }) {
  if (count === 0) return null;
  return (
    <Badge tone="warning" size="sm">
      미확정 {count.toLocaleString("ko-KR")}건 · {amount.toLocaleString("ko-KR")}원
    </Badge>
  );
}
