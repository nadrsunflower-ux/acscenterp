"use client";

// ============================================================
//  입력 요소 — Field · Input · Select · Textarea · Checkbox · Switch
// ------------------------------------------------------------
//  높이는 컨트롤 토큰(28/36/44)을 따른다. 필터바처럼 작아야 하면
//  size="sm" 을 쓴다 — !py-1.5 같은 강제 오버라이드는 쓰지 않는다.
// ============================================================
import type {
  InputHTMLAttributes,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
  ButtonHTMLAttributes,
  ReactNode,
} from "react";
import { cn } from "./cn";

export type ControlSize = "sm" | "md" | "lg";

const base =
  "w-full border border-nd-border bg-nd-content text-nd-fg placeholder:text-nd-fg-3 transition-colors duration-nd-fast ease-nd focus:border-nd-accent disabled:cursor-not-allowed disabled:bg-nd-sunken disabled:text-nd-fg-3 aria-[invalid=true]:border-nd-danger";

const sizeCls: Record<ControlSize, string> = {
  sm: "h-ctl-sm rounded-[8px] px-2.5 text-[13px]",
  md: "h-ctl-md rounded-nd-md px-3 text-nd-body",
  lg: "h-ctl-lg rounded-nd-md px-3.5 text-[15px]",
};

export function controlClass(size: ControlSize = "md", className?: string) {
  return cn(base, sizeCls[size], className);
}

// ---- Field (label + control) -------------------------------
export function Field({
  label,
  hint,
  error,
  required,
  className,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label className={cn("flex flex-col gap-1.5", className)}>
      <span className="text-nd-caption font-medium text-nd-fg-2">
        {label}
        {required && (
          <span className="ml-0.5 text-nd-danger" aria-hidden>
            *
          </span>
        )}
      </span>
      {children}
      {error ? (
        <span className="text-nd-caption text-nd-danger-text" role="alert">
          {error}
        </span>
      ) : (
        hint && <span className="text-nd-caption text-nd-fg-3">{hint}</span>
      )}
    </label>
  );
}

// ---- Input ---------------------------------------------------
export function Input({
  className,
  size = "md",
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "size"> & { size?: ControlSize }) {
  return <input className={controlClass(size, className)} {...props} />;
}

// ---- Textarea ------------------------------------------------
export function Textarea({
  className,
  size = "md",
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { size?: ControlSize }) {
  return (
    <textarea
      className={cn(
        base,
        "min-h-[5.5rem] resize-y py-2 leading-relaxed",
        size === "sm" ? "rounded-[8px] px-2.5 text-[13px]" : "rounded-nd-md px-3 text-nd-body",
        className,
      )}
      {...props}
    />
  );
}

// ---- Select --------------------------------------------------
// 화살표는 배경 이미지로 그린다 — 래퍼 없이 className 이 그대로 select 에 붙는다.
const chevron =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%2364748b' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='m6 9 6 6 6-6'/></svg>\")";

export function Select({
  className,
  size = "md",
  children,
  style,
  ...props
}: Omit<SelectHTMLAttributes<HTMLSelectElement>, "size"> & { size?: ControlSize }) {
  return (
    <select
      className={cn(
        controlClass(size, className),
        "cursor-pointer appearance-none bg-no-repeat pr-8",
        size === "sm" ? "!pr-7" : "",
      )}
      style={{
        backgroundImage: chevron,
        backgroundPosition: size === "sm" ? "right 6px center" : "right 10px center",
        ...style,
      }}
      {...props}
    >
      {children}
    </select>
  );
}

// ---- Checkbox ------------------------------------------------
export function Checkbox({
  className,
  label,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & { label?: ReactNode }) {
  const box = (
    <input
      type="checkbox"
      className={cn(
        "h-4 w-4 shrink-0 cursor-pointer rounded-[4px] border-nd-border accent-nd-accent disabled:cursor-not-allowed",
        !label && className,
      )}
      {...props}
    />
  );
  if (!label) return box;
  return (
    <label className={cn("inline-flex cursor-pointer items-center gap-2 text-nd-body text-nd-fg", className)}>
      {box}
      <span>{label}</span>
    </label>
  );
}

// ---- Switch --------------------------------------------------
export function Switch({
  checked,
  onChange,
  label,
  size = "md",
  className,
  disabled,
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onChange"> & {
  checked: boolean;
  onChange: (next: boolean) => void;
  label?: ReactNode;
  size?: "sm" | "md";
}) {
  const track = size === "sm" ? "h-4 w-7" : "h-5 w-9";
  const knob = size === "sm" ? "h-3 w-3" : "h-4 w-4";
  const shift = size === "sm" ? "translate-x-3" : "translate-x-4";
  const control = (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex shrink-0 items-center rounded-full p-0.5 transition-colors duration-nd-fast ease-nd disabled:cursor-not-allowed disabled:opacity-50",
        track,
        checked ? "bg-nd-accent" : "bg-nd-fg/20",
        !label && className,
      )}
      {...props}
    >
      <span
        aria-hidden
        className={cn(
          "block rounded-full bg-white shadow-sm transition-transform duration-nd-fast ease-nd",
          knob,
          checked && shift,
        )}
      />
    </button>
  );
  if (!label) return control;
  return (
    <label className={cn("inline-flex cursor-pointer items-center gap-2 text-nd-body text-nd-fg", className)}>
      {control}
      <span>{label}</span>
    </label>
  );
}
