"use client";

// ============================================================
//  지표 — KpiStrip(요약 띠) · Metric(작은 지표 카드)
// ------------------------------------------------------------
//  숫자가 중요한 화면에서 숫자가 먼저 보이게: 큰 tabular 숫자,
//  절제된 구분선, 색은 계열 식별 점에만.
// ============================================================
import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "./cn";
import { Icon } from "./icon";
import { Badge, type Tone } from "./badge";
import { Meter } from "./meter";

/** 핵심 지표 여러 개를 하나의 표면에 — 칸 사이는 얇은 선(gap-px 트릭) */
export function KpiStrip({
  children,
  columns = 4,
  className,
}: {
  children: ReactNode;
  columns?: 2 | 3 | 4 | 5 | 6;
  className?: string;
}) {
  // 뷰포트가 아니라 컨테이너 폭에 맞춰 칸 수가 정해진다 — 오른쪽에 패널이
  // 도킹돼 본문이 좁아져도 숫자가 잘리지 않는다 (auto-fit + 칸 최소 폭)
  const minCol: Record<number, number> = { 2: 240, 3: 220, 4: 210, 5: 190, 6: 170 };
  return (
    <div
      data-nd-kpi
      className={cn(
        "nd-surface grid gap-px overflow-hidden rounded-nd-lg bg-[var(--nd-line)] [&>*]:bg-nd-content",
        className,
      )}
      style={{ gridTemplateColumns: `repeat(auto-fit, minmax(min(${minCol[columns]}px, 100%), 1fr))` }}
    >
      {children}
    </div>
  );
}

export function KpiItem({
  label,
  value,
  unit,
  hint,
  marker,
  tone,
  tag,
  className,
  size = "md",
}: {
  label: ReactNode;
  value: ReactNode;
  unit?: string;
  hint?: ReactNode;
  /** 계열 식별 점 색 (hex) */
  marker?: string;
  /** 점 색을 tone 으로 */
  tone?: Tone;
  /** 오른쪽 작은 태그 (예: 손실) */
  tag?: ReactNode;
  className?: string;
  size?: "md" | "lg";
}) {
  const dotTone: Record<Tone, string> = {
    neutral: "bg-nd-fg-3",
    accent: "bg-nd-accent",
    success: "bg-nd-success",
    warning: "bg-nd-warning",
    danger: "bg-nd-danger",
    info: "bg-nd-info",
  };
  return (
    <div
      className={cn(
        // 모바일: 라벨·힌트 왼쪽, 숫자 오른쪽 한 줄. sm 이상: 세로 쌓기(라벨 → 숫자 → 힌트)
        "grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0 px-4 py-3 sm:flex sm:flex-col sm:items-stretch sm:gap-1 sm:px-5 sm:py-4",
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-2 text-nd-caption font-medium text-nd-fg-2 sm:mb-1">
        {(marker || tone) && (
          <span
            aria-hidden
            className={cn("h-2.5 w-2.5 shrink-0 rounded-full", !marker && tone && dotTone[tone])}
            style={marker ? { backgroundColor: marker } : undefined}
          />
        )}
        <span className="truncate">{label}</span>
        {tag && <span className="ml-auto sm:ml-2">{tag}</span>}
      </div>
      <div className="row-span-2 flex items-baseline gap-x-1.5 whitespace-nowrap sm:row-span-1">
        <span className={cn("nd-num text-nd-fg", size === "lg" ? "text-nd-kpi" : "text-[22px] font-bold leading-tight tracking-[-0.02em]")}>
          {value}
        </span>
        {unit && <span className="text-nd-body text-nd-fg-2">{unit}</span>}
      </div>
      {/* 힌트는 sm 이상에서 항상 한 줄을 차지해 이웃 칸과 숫자 높이가 맞는다 */}
      <div className={cn("truncate text-nd-caption text-nd-fg-3 sm:min-h-[1.1rem]", !hint && "hidden sm:block")}>
        {hint ?? "\u00a0"}
      </div>
    </div>
  );
}

/** 작은 지표 카드 — 대시보드 상단. href 가 있으면 카드 전체가 링크 */
export function Metric({
  label,
  value,
  hint,
  href,
  onClick,
  expanded,
  badge,
  badgeTone = "danger",
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  href?: string;
  onClick?: () => void;
  /** 펼침 토글일 때 상태 */
  expanded?: boolean;
  badge?: ReactNode;
  badgeTone?: Tone;
  className?: string;
}) {
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-nd-caption font-medium text-nd-fg-2">{label}</span>
        {badge !== undefined && badge !== null && (
          <Badge tone={badgeTone} size="sm">
            {badge}
          </Badge>
        )}
      </div>
      <div className="mt-1.5 flex items-end justify-between gap-2">
        <span className="nd-num text-[22px] font-bold leading-tight tracking-[-0.02em] text-nd-fg">{value}</span>
        {(href || onClick) && (
          <Icon
            icon={ChevronRight}
            size={16}
            className={cn("mb-1 text-nd-fg-4 transition-transform duration-nd-fast", expanded && "rotate-90")}
          />
        )}
      </div>
      {hint && <div className="mt-1 text-nd-caption text-nd-fg-3">{hint}</div>}
    </>
  );
  const base = cn(
    "nd-surface block rounded-nd-lg p-4 text-left transition-colors duration-nd-fast",
    (href || onClick) && "hover:bg-nd-sunken",
    className,
  );
  if (href) return <Link href={href} className={base}>{body}</Link>;
  if (onClick)
    return (
      <button type="button" onClick={onClick} aria-expanded={expanded} className={cn(base, "w-full")}>
        {body}
      </button>
    );
  return <div className={base}>{body}</div>;
}

/**
 * 비율 타일 — 큰 퍼센트 + 그 아래 진행 막대.
 *
 * 구독 리포트와 예산 리포트가 거의 같은 코드를 각자 손으로 만들고 있었다
 * (양쪽 주석에 「공통화 후보」라고 적혀 있었다). 막대만으로는 정확한 값을
 * 알 수 없어 숫자를 늘 함께 찍고, 기준을 넘긴 값은 색과 함께 「초과」
 * 글자로도 알린다 — 색만으로 뜻을 전하지 않는다.
 */
export function RatioTile({
  label,
  /** 0~1. null 이면 분모가 없다는 뜻 — 0% 로 보이면 거짓말이 된다 */
  value,
  hint,
  /** 이 값을 넘으면 경고 (예산 1 = 100%) */
  warnAbove,
  /** 막대의 최대값 (기본 1). 달성률처럼 100% 를 넘을 수 있으면 늘린다 */
  max = 1,
  digits = 1,
  tag,
}: {
  label: ReactNode;
  value: number | null | undefined;
  hint?: ReactNode;
  warnAbove?: number;
  max?: number;
  digits?: number;
  tag?: ReactNode;
}) {
  const has = value !== null && value !== undefined && Number.isFinite(value);
  const over = has && warnAbove !== undefined && (value as number) > warnAbove;
  return (
    <KpiItem
      label={label}
      tag={tag ?? (over ? <Badge tone="danger" size="sm">초과</Badge> : undefined)}
      value={<span className={cn("nd-num", over && "text-nd-danger-text")}>{has ? `${((value as number) * 100).toFixed(digits)}%` : "—"}</span>}
      hint={
        <span className="flex items-center gap-2">
          <Meter value={has ? (value as number) : null} max={max} warnAbove={warnAbove} width={72} />
          {hint}
        </span>
      }
    />
  );
}
