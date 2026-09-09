"use client";

// ============================================================
//  재무 공통 표시 부품
// ------------------------------------------------------------
//  차트 색은 임의로 고르지 않았다. 2계열(수입·지출)은 검증된
//  categorical 슬롯 1·2(blue/orange)를 쓴다 — 색각 이상 조건에서도
//  구분되는 조합이다(ΔE 24.7). 수입=초록/지출=빨강 조합은 적록색약에서
//  붙어 보이므로 쓰지 않는다. 같은 값이 neander.css 의 --nd-series-* 다.
//
//  금액의 부호는 색에만 맡기지 않는다. 음수는 △ 표기를 함께 단다.
// ============================================================

import type { ReactNode } from "react";
import { cn, KpiItem, SectionHeader, type Tone } from "@/components/neander/ui";
import { formatSigned } from "@/lib/neander/finance/types";

/** 차트 계열 색 — 검증 통과 (light surface #ffffff) */
export const SERIES = {
  income: "#2a78d6",
  expense: "#eb6834",
  neutral: "#94a3b8",
} as const;

/** 순차 램프 — 매트릭스 히트맵의 농도 (하나의 hue, 밝음→어두움) */
export const BLUE_RAMP = [
  "#eff6ff",
  "#cde2fb",
  "#9ec5f4",
  "#6da7ec",
  "#3987e5",
  "#256abf",
  "#184f95",
] as const;

/** 금액 표시. 음수는 △ + 붉은 글씨(색 단독에 의존하지 않음). */
export function Money({
  value,
  className,
  unit = true,
  muted = false,
}: {
  value: number;
  className?: string;
  unit?: boolean;
  muted?: boolean;
}) {
  const neg = value < 0;
  return (
    <span
      className={cn(
        "nd-num",
        neg ? "text-nd-danger-text" : muted ? "text-nd-fg-3" : "text-nd-fg",
        className,
      )}
    >
      {formatSigned(value)}
      {unit && <span className="ml-0.5 text-[0.85em] font-normal text-nd-fg-3">원</span>}
    </span>
  );
}

/**
 * KPI 타일 — 헤드라인 숫자 몇 개를 나란히 놓을 때.
 * KpiStrip 안에 놓으면 한 표면에 얇은 선으로 나뉜다.
 */
export function StatTile({
  label,
  value,
  hint,
  accent,
  tone,
  size = "md",
  tag,
}: {
  label: string;
  value: number;
  hint?: ReactNode;
  /** 계열 식별 점 색 (hex) */
  accent?: string;
  tone?: Tone;
  size?: "md" | "lg";
  /** 숫자 옆 작은 태그 (예: 손실) */
  tag?: ReactNode;
}) {
  return (
    <KpiItem
      tag={tag}
      label={label}
      value={<Money value={value} unit={false} />}
      unit="원"
      hint={hint}
      marker={accent}
      tone={tone}
      size={size}
    />
  );
}

/** 계열 범례 — 계열이 2개 이상이면 항상 표시한다 */
export function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div className="flex items-center gap-3">
      {items.map((i) => (
        <span key={i.label} className="flex items-center gap-1.5 text-nd-caption text-nd-fg-2">
          <span
            className="inline-block h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: i.color }}
            aria-hidden
          />
          {i.label}
        </span>
      ))}
    </div>
  );
}

/** 섹션 제목 (공통 SectionHeader 의 재무용 별칭) */
export function SectionTitle({
  children,
  hint,
  action,
  className,
}: {
  children: ReactNode;
  hint?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return <SectionHeader title={children} hint={hint} action={action} className={className} />;
}

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

/** "2026-07" → "2026년 7월" */
export function monthLabel(m: string): string {
  const [y, mm] = m.split("-");
  if (!y || !mm) return m;
  return `${y}년 ${Number(mm)}월`;
}
