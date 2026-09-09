"use client";

// ============================================================
//  DateStepper — ‹ 라벨 › 캡슐
// ------------------------------------------------------------
//  대시보드·일일업무·스케줄·재무 월 선택이 같은 컨트롤을 쓴다.
//  가운데에 children(예: <Select>)을 넣으면 라벨 대신 그것을 그린다.
// ============================================================
import type { ReactNode } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "./cn";
import { Icon } from "./icon";

export function DateStepper({
  label,
  onPrev,
  onNext,
  prevDisabled = false,
  nextDisabled = false,
  prevLabel = "이전",
  nextLabel = "다음",
  onToday,
  todayLabel = "오늘",
  size = "md",
  glass = false,
  icon = true,
  className,
  children,
}: {
  label?: ReactNode;
  onPrev: () => void;
  onNext: () => void;
  prevDisabled?: boolean;
  nextDisabled?: boolean;
  prevLabel?: string;
  nextLabel?: string;
  onToday?: () => void;
  todayLabel?: string;
  size?: "sm" | "md";
  /** 상단 툴바 위 — 유리 캡슐 */
  glass?: boolean;
  /** 왼쪽 달력 아이콘 */
  icon?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  const h = size === "sm" ? "h-ctl-sm" : "h-ctl-md";
  const btn = cn(
    "inline-flex shrink-0 items-center justify-center rounded-full text-nd-fg-2 transition-colors duration-nd-fast hover:bg-nd-fg/[.06] hover:text-nd-fg disabled:cursor-not-allowed disabled:opacity-35",
    size === "sm" ? "h-6 w-6" : "h-8 w-8",
  );
  return (
    <div
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full px-1",
        h,
        glass ? "nd-glass" : "border border-nd-border bg-nd-content",
        className,
      )}
    >
      {icon && <Icon icon={CalendarDays} size={15} className="ml-1.5 mr-0.5 text-nd-fg-3" />}
      <button type="button" className={btn} onClick={onPrev} disabled={prevDisabled} aria-label={prevLabel} title={prevLabel}>
        <Icon icon={ChevronLeft} size={16} />
      </button>
      {children ?? (
        <span className={cn("nd-num min-w-[6.5rem] px-1 text-center font-semibold text-nd-fg", size === "sm" ? "text-[13px]" : "text-nd-body")}>
          {label}
        </span>
      )}
      <button type="button" className={btn} onClick={onNext} disabled={nextDisabled} aria-label={nextLabel} title={nextLabel}>
        <Icon icon={ChevronRight} size={16} />
      </button>
      {onToday && (
        <>
          <span aria-hidden className="mx-0.5 h-4 w-px bg-nd-fg/15" />
          <button
            type="button"
            onClick={onToday}
            className={cn("rounded-full px-2 font-medium text-nd-fg-2 hover:bg-nd-fg/[.06] hover:text-nd-fg", size === "sm" ? "h-6 text-[12px]" : "h-8 text-[13px]")}
          >
            {todayLabel}
          </button>
        </>
      )}
    </div>
  );
}
