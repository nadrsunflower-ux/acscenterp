"use client";

// ============================================================
//  Button · IconButton
// ------------------------------------------------------------
//  색조는 primary 하나에만 준다 (HIG: 색조는 주요 동작에 집중).
//  secondary/ghost 는 중성, danger 는 파괴적 동작에만.
//  size 가 있으므로 !px-3 같은 강제 오버라이드는 더 이상 쓰지 않는다.
// ============================================================
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "./cn";
import { Icon, type LucideIcon } from "./icon";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "soft";
export type ButtonSize = "sm" | "md" | "lg";

const variantCls: Record<ButtonVariant, string> = {
  primary:
    "bg-nd-accent text-white hover:bg-nd-accent-strong active:bg-nd-accent-strong disabled:bg-nd-accent/45",
  secondary:
    "bg-nd-content text-nd-fg border border-nd-border hover:bg-nd-sunken active:bg-nd-fg/10 disabled:text-nd-fg-3",
  ghost: "text-nd-fg-2 hover:bg-nd-fg/[.06] hover:text-nd-fg active:bg-nd-fg/10 disabled:text-nd-fg-4",
  danger:
    "bg-nd-content text-nd-danger-text border border-nd-danger/30 hover:bg-nd-danger-soft active:bg-nd-danger/15 disabled:text-nd-fg-3",
  soft: "bg-nd-accent-soft text-nd-accent-strong hover:bg-nd-accent/20 active:bg-nd-accent/25 disabled:text-nd-fg-3",
};

const sizeCls: Record<ButtonSize, string> = {
  sm: "h-ctl-sm px-2.5 text-[13px] rounded-[8px] gap-1",
  md: "h-ctl-md px-3.5 text-nd-body rounded-nd-md gap-1.5",
  lg: "h-ctl-lg px-4 text-[15px] rounded-nd-md gap-2",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** 왼쪽 아이콘 */
  icon?: LucideIcon;
  /** 오른쪽 아이콘 */
  trailingIcon?: LucideIcon;
  /** 진행 중 — 스피너를 보이고 누르지 못하게 */
  loading?: boolean;
  /** 캡슐형 (툴바) */
  pill?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "primary",
    size = "md",
    icon,
    trailingIcon,
    loading = false,
    pill = false,
    className,
    children,
    disabled,
    type = "button",
    ...props
  },
  ref,
) {
  const iconSize = size === "sm" ? 14 : 16;
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        "inline-flex select-none items-center justify-center whitespace-nowrap font-medium transition-colors duration-nd-fast ease-nd disabled:cursor-not-allowed",
        variantCls[variant],
        sizeCls[size],
        pill && "rounded-full",
        className,
      )}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? (
        <Icon icon={Loader2} size={iconSize} className="animate-spin" />
      ) : (
        icon && <Icon icon={icon} size={iconSize} />
      )}
      {children}
      {trailingIcon && !loading && <Icon icon={trailingIcon} size={iconSize} />}
    </button>
  );
});

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  icon: LucideIcon;
  /** 접근 가능한 이름 — 필수 */
  label: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  pill?: boolean;
  /** 토글 상태(눌림) */
  active?: boolean;
  iconSize?: number;
}

/** 아이콘만 있는 버튼 — 접근 가능한 이름(label)이 필수다 */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, label, variant = "ghost", size = "md", pill = false, active = false, className, iconSize, ...props },
  ref,
) {
  const box: Record<ButtonSize, string> = {
    sm: "h-ctl-sm w-7 rounded-[8px]",
    md: "h-ctl-md w-9 rounded-nd-md",
    lg: "h-ctl-lg w-11 rounded-nd-md",
  };
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active || undefined}
      className={cn(
        "inline-flex shrink-0 items-center justify-center transition-colors duration-nd-fast ease-nd disabled:cursor-not-allowed",
        variantCls[variant],
        box[size],
        pill && "rounded-full",
        active && "bg-nd-accent-soft text-nd-accent-strong",
        className,
      )}
      {...props}
    >
      <Icon icon={icon} size={iconSize ?? (size === "sm" ? 15 : 17)} />
    </button>
  );
});

/** 툴바에서 버튼 몇 개를 한 캡슐로 묶는다 (HIG Toolbars: 기능별 그룹) */
export function ButtonGroup({
  children,
  className,
  glass = false,
  label,
}: {
  children: ReactNode;
  className?: string;
  /** 상단 툴바에 놓일 때 — 유리 캡슐 */
  glass?: boolean;
  label?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full p-0.5",
        glass ? "nd-glass" : "border border-nd-border bg-nd-content",
        className,
      )}
    >
      {children}
    </div>
  );
}
