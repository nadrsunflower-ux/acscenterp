// ============================================================
//  상태 — 불러오는 중 · 비어 있음 · 오류 · 안내
// ------------------------------------------------------------
//  14곳에 복제돼 있던 "불러오는 중…" 을 한 곳으로. 스피너는 상태를
//  알리는 최소한의 움직임만 쓴다 (reduced-motion 이면 멈춘다).
// ============================================================
import type { ReactNode } from "react";
import { CircleAlert, Inbox, Loader2 } from "lucide-react";
import { cn } from "./cn";
import { Icon, type LucideIcon } from "./icon";
import { toneCls, type Tone } from "./badge";

export function Spinner({ size = 18, className }: { size?: number; className?: string }) {
  return <Icon icon={Loader2} size={size} className={cn("animate-spin text-nd-fg-3", className)} />;
}

export function LoadingState({
  label = "불러오는 중…",
  size = "page",
  className,
}: {
  label?: string;
  size?: "page" | "block" | "inline";
  className?: string;
}) {
  if (size === "inline") {
    return (
      <span role="status" className={cn("inline-flex items-center gap-1.5 text-nd-caption text-nd-fg-3", className)}>
        <Spinner size={14} />
        {label}
      </span>
    );
  }
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex flex-col items-center justify-center gap-2 text-nd-body text-nd-fg-3",
        size === "page" ? "py-20" : "py-10",
        className,
      )}
    >
      <Spinner size={22} />
      <span>{label}</span>
    </div>
  );
}

/** 자리 표시 — 목록·표가 오기 전 */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("animate-pulse rounded-nd-md bg-nd-fg/[.06]", className)} />;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  compact = false,
}: {
  /** 선형 아이콘. 예전 호출부의 이모지 문자열도 받는다 */
  icon?: LucideIcon | string;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
  compact?: boolean;
}) {
  const I = typeof icon === "string" ? null : (icon ?? Inbox);
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-nd-lg border border-dashed border-nd-strong px-6 text-center",
        compact ? "py-8" : "py-14",
        className,
      )}
    >
      {typeof icon === "string" ? (
        <div className="mb-2 text-3xl" aria-hidden>
          {icon}
        </div>
      ) : (
        I && (
          <span className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-nd-fg/[.06] text-nd-fg-3">
            <Icon icon={I} size={20} />
          </span>
        )
      )}
      <p className="text-nd-body font-medium text-nd-fg">{title}</p>
      {description && <p className="mt-1 max-w-md text-nd-caption leading-relaxed text-nd-fg-3">{description}</p>}
      {action && <div className="mt-4 flex flex-wrap items-center justify-center gap-2">{action}</div>}
    </div>
  );
}

export function ErrorState({
  title = "문제가 생겼습니다",
  description,
  action,
  className,
}: {
  title?: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div role="alert" className={cn("flex gap-3 rounded-nd-lg bg-nd-danger-soft p-4 text-nd-danger-text", className)}>
      <Icon icon={CircleAlert} size={18} className="mt-0.5 text-nd-danger" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{title}</p>
        {description && <div className="mt-1 text-nd-body leading-relaxed">{description}</div>}
        {action && <div className="mt-3 flex flex-wrap gap-2">{action}</div>}
      </div>
    </div>
  );
}

/** 본문 안 짧은 안내 띠 */
export function InlineNotice({
  tone = "info",
  icon,
  children,
  className,
  action,
}: {
  tone?: Tone;
  icon?: LucideIcon;
  children: ReactNode;
  className?: string;
  action?: ReactNode;
}) {
  const t = toneCls[tone];
  return (
    <div className={cn("flex items-start gap-2.5 rounded-nd-md px-3.5 py-2.5 text-nd-body", t.soft, t.text, className)}>
      {icon && <Icon icon={icon} size={16} className="mt-0.5" />}
      <div className="min-w-0 flex-1 leading-relaxed">{children}</div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
