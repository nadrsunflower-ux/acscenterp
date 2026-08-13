"use client";

// ============================================================
//  재무 공통 표시 부품
// ------------------------------------------------------------
//  차트 색은 임의로 고르지 않았다. 2계열(수입·지출)은 검증된
//  categorical 슬롯 1·2(blue/orange)를 쓴다 — 색각 이상 조건에서도
//  구분되는 조합이다(ΔE 24.7). 수입=초록/지출=빨강 조합은 적록색약에서
//  붙어 보이므로 쓰지 않는다.
//
//  금액의 부호는 색에만 맡기지 않는다. 음수는 △ 표기를 함께 단다.
// ============================================================

import type { ReactNode } from "react";
import { cn } from "@/components/neander/ui";
import { formatSigned } from "@/lib/neander/finance/types";

/** 차트 계열 색 — 검증 통과 (light surface #ffffff) */
export const SERIES = {
  income: "#2a78d6",
  expense: "#eb6834",
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
        "tabular-nums",
        neg ? "text-rose-600" : muted ? "text-zinc-400" : "text-zinc-900",
        className,
      )}
    >
      {formatSigned(value)}
      {unit && <span className="ml-0.5 text-[0.85em] font-normal text-zinc-400">원</span>}
    </span>
  );
}

/** KPI 타일 — 헤드라인 숫자 몇 개를 나란히 놓을 때 */
export function StatTile({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: number;
  hint?: string;
  /** 왼쪽 색 바 (계열 식별용) */
  accent?: string;
}) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
      {accent && (
        <span
          className="absolute inset-y-0 left-0 w-1"
          style={{ backgroundColor: accent }}
          aria-hidden
        />
      )}
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="mt-1 text-xl font-bold tracking-tight">
        <Money value={value} />
      </p>
      {hint && <p className="mt-1 text-xs text-zinc-400">{hint}</p>}
    </div>
  );
}

/** 계열 범례 — 계열이 2개 이상이면 항상 표시한다 */
export function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div className="flex items-center gap-3">
      {items.map((i) => (
        <span key={i.label} className="flex items-center gap-1.5 text-xs text-zinc-600">
          <span
            className="inline-block h-2.5 w-2.5 rounded-sm"
            style={{ backgroundColor: i.color }}
            aria-hidden
          />
          {i.label}
        </span>
      ))}
    </div>
  );
}

/** 섹션 제목 */
export function SectionTitle({
  children,
  hint,
  action,
}: {
  children: ReactNode;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
      <h2 className="text-sm font-semibold text-zinc-700">
        {children}
        {hint && <span className="ml-2 font-normal text-zinc-400">{hint}</span>}
      </h2>
      {action}
    </div>
  );
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
  if (!max || value <= 0) return "text-zinc-300";
  const r = Math.min(1, value / max);
  return r > 0.6 ? "text-white" : "text-zinc-900";
}
