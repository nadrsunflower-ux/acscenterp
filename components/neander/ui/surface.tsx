// ============================================================
//  표면 — Card · Glass · Divider · SectionHeader
// ------------------------------------------------------------
//  Card 는 불투명 콘텐츠 표면(표·본문·폼). Glass 는 탐색·조작
//  레이어(사이드바·툴바 캡슐·팝오버)에만 쓴다. 둘을 겹치지 않는다.
// ============================================================
import type { ElementType, HTMLAttributes, ReactNode } from "react";
import { cn } from "./cn";

type Padding = "none" | "sm" | "md" | "lg";
const padCls: Record<Padding, string> = { none: "", sm: "p-4", md: "p-5", lg: "p-6" };

/** className 에 이미 p-* 가 있으면 기본 패딩을 겹치지 않는다 (예전 호출부 호환) */
const hasPadding = (cls?: string) => !!cls && /(^|\s)!?p-(\d|\[)/.test(cls);

export function Card({
  className,
  children,
  padding = "md",
  as: Tag = "div",
  ...rest
}: HTMLAttributes<HTMLElement> & {
  className?: string;
  children?: ReactNode;
  padding?: Padding;
  as?: ElementType;
}) {
  return (
    <Tag
      className={cn("nd-surface rounded-nd-lg", !hasPadding(className) && padCls[padding], className)}
      {...rest}
    >
      {children}
    </Tag>
  );
}

/** 유리 표면 — 탐색·조작 레이어 전용 */
export function Glass({
  className,
  children,
  strong = false,
  as: Tag = "div",
  ...rest
}: HTMLAttributes<HTMLElement> & {
  className?: string;
  children?: ReactNode;
  /** 팝오버·메뉴처럼 글자가 많은 작은 표면 */
  strong?: boolean;
  as?: ElementType;
}) {
  return (
    <Tag className={cn(strong ? "nd-glass-strong" : "nd-glass", "rounded-nd-xl", className)} {...rest}>
      {children}
    </Tag>
  );
}

export function Divider({ vertical = false, className }: { vertical?: boolean; className?: string }) {
  return (
    <div
      role="separator"
      aria-orientation={vertical ? "vertical" : "horizontal"}
      className={cn(vertical ? "h-5 w-px self-center bg-nd-fg/15" : "h-px w-full bg-nd-fg/10", className)}
    />
  );
}

/** 섹션 제목 줄 — 제목 + 힌트 + 오른쪽 동작 */
export function SectionHeader({
  title,
  hint,
  action,
  className,
  as: Tag = "h2",
}: {
  title: ReactNode;
  hint?: ReactNode;
  action?: ReactNode;
  className?: string;
  as?: "h2" | "h3";
}) {
  return (
    <div className={cn("mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1", className)}>
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
        <Tag className="text-nd-section text-nd-fg">{title}</Tag>
        {hint && <span className="text-nd-caption text-nd-fg-3">{hint}</span>}
      </div>
      {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
    </div>
  );
}
