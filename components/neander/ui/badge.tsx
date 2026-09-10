// ============================================================
//  Badge · StatusDot · CountBadge
// ------------------------------------------------------------
//  상태는 tone(의미)으로 고른다. hex color 는 팀원 색처럼 데이터가
//  색을 갖는 경우에만 남겨 둔다. 색만으로 뜻을 전하지 않도록 글자를
//  항상 같이 둔다.
// ============================================================
import type { ReactNode } from "react";
import { cn } from "./cn";

export type Tone = "neutral" | "accent" | "success" | "warning" | "danger" | "info";

export const toneCls: Record<Tone, { soft: string; text: string; dot: string; solid: string }> = {
  neutral: { soft: "bg-nd-fg/[.07]", text: "text-nd-fg-2", dot: "bg-nd-fg-3", solid: "bg-nd-fg-2" },
  accent: { soft: "bg-nd-accent-soft", text: "text-nd-accent-strong", dot: "bg-nd-accent", solid: "bg-nd-accent" },
  success: { soft: "bg-nd-success-soft", text: "text-nd-success-text", dot: "bg-nd-success", solid: "bg-nd-success-text" },
  warning: { soft: "bg-nd-warning-soft", text: "text-nd-warning-text", dot: "bg-nd-warning", solid: "bg-nd-warning-text" },
  danger: { soft: "bg-nd-danger-soft", text: "text-nd-danger-text", dot: "bg-nd-danger", solid: "bg-nd-danger" },
  info: { soft: "bg-nd-info-soft", text: "text-nd-info-text", dot: "bg-nd-info", solid: "bg-nd-info-text" },
};

export function Badge({
  children,
  tone = "neutral",
  color,
  dot = false,
  size = "md",
  className,
}: {
  children: ReactNode;
  tone?: Tone;
  /** 데이터가 가진 색 (팀원·분류). 있으면 tone 대신 이 색을 쓴다 */
  color?: string;
  /** 왼쪽에 상태 점 */
  dot?: boolean;
  size?: "sm" | "md";
  className?: string;
}) {
  const t = toneCls[tone];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full font-medium",
        size === "sm" ? "h-5 px-1.5 text-nd-micro" : "h-6 px-2 text-nd-caption",
        !color && t.soft,
        !color && t.text,
        className,
      )}
      style={color ? { backgroundColor: `${color}1a`, color } : undefined}
    >
      {dot && (
        <span
          aria-hidden
          className={cn("h-1.5 w-1.5 shrink-0 rounded-full", !color && t.dot)}
          style={color ? { backgroundColor: color } : undefined}
        />
      )}
      {children}
    </span>
  );
}

/** 상태 점 + 글자 — 배지보다 가볍게 상태를 표시할 때 */
export function StatusDot({
  tone = "neutral",
  children,
  className,
  size = 8,
}: {
  tone?: Tone;
  children?: ReactNode;
  className?: string;
  size?: number;
}) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-nd-caption text-nd-fg-2", className)}>
      <span
        aria-hidden
        className={cn("shrink-0 rounded-full", toneCls[tone].dot)}
        style={{ width: size, height: size }}
      />
      {children}
    </span>
  );
}

/** 건수 배지 (탐색 메뉴·탭) */
export function CountBadge({
  count,
  tone = "danger",
  max = 99,
  className,
  label,
}: {
  count: number;
  tone?: Tone;
  max?: number;
  className?: string;
  /** 스크린리더용 설명 (예: "미확인 3건") */
  label?: string;
}) {
  if (count <= 0) return null;
  const shown = count > max ? `${max}+` : String(count);
  const solid = tone === "neutral" ? "bg-nd-fg/[.08] text-nd-fg-2" : `${toneCls[tone].solid} text-white`;
  return (
    <span
      className={cn(
        "nd-num inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1.5 text-nd-micro font-semibold leading-none",
        tone === "accent" ? "bg-nd-accent-soft text-nd-accent-strong" : solid,
        className,
      )}
      aria-label={label}
    >
      {shown}
    </span>
  );
}
