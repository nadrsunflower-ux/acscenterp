"use client";

// ============================================================
//  입력 요소 — Field · Input · Select · Textarea · Checkbox · Switch
// ------------------------------------------------------------
//  높이는 컨트롤 토큰(28/36/44)을 따른다. 필터바처럼 작아야 하면
//  size="sm" 을 쓴다 — !py-1.5 같은 강제 오버라이드는 쓰지 않는다.
// ============================================================
import {
  forwardRef,
  type ElementType,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import { cn } from "./cn";

export type ControlSize = "sm" | "md" | "lg";

const base =
  "border border-nd-border bg-nd-content text-nd-fg placeholder:text-nd-fg-3 transition-colors duration-nd-fast ease-nd focus:border-nd-accent disabled:cursor-not-allowed disabled:bg-nd-sunken disabled:text-nd-fg-3 aria-[invalid=true]:border-nd-danger";

const sizeCls: Record<ControlSize, string> = {
  sm: "h-ctl-sm rounded-[8px] px-2.5 text-[13px]",
  md: "h-ctl-md rounded-nd-md px-3 text-nd-body",
  lg: "h-ctl-lg rounded-nd-md px-3.5 text-[15px]",
};

/** className 에 w-* 가 있으면 기본 w-full 을 겹치지 않는다 (필터바의 w-48, w-auto) */
const hasWidth = (cls?: string) => !!cls && /(^|\s)!?w-/.test(cls);

export function controlClass(size: ControlSize = "md", className?: string) {
  return cn(!hasWidth(className) && "w-full", base, sizeCls[size], className);
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

// ---- FormRow (폼 한 줄) --------------------------------------
/**
 * 라벨 · 입력칸 · 힌트가 각각 같은 높이에 서는 한 줄.
 *
 * ⚠️ `flex items-end` 로 늘어놓으면 **힌트가 달린 칸만 입력칸이 위로 밀린다.**
 *    힌트는 Field 높이 안에 있는데 정렬 기준이 아래 끝이라서다. 오류 문구처럼
 *    붙었다 떨어지는 칸은 타이핑할 때마다 줄 전체가 들썩인다.
 *
 * 그래서 줄을 격자로 두고 칸의 **위쪽**을 맞춘다. 라벨이 한 줄인 한 입력칸도
 * 힌트도 저절로 같은 높이에 선다 — 입력칸 높이가 모두 같기 때문이다.
 *
 * 칸 너비는 `className` 의 grid-cols-* 가 정한다. 입력칸에 w-24 를 박으면
 * 열과 어긋나므로, 너비는 열에 맡기고 입력칸은 기본값(w-full)으로 둔다.
 */
export function FormRow({
  as: Tag = "div",
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLElement> & { as?: ElementType; className?: string; children?: ReactNode }) {
  return (
    <Tag className={cn("grid items-start gap-3", className)} {...rest}>
      {children}
    </Tag>
  );
}

/**
 * 라벨 자리를 비워 두고 버튼·표시값을 **입력칸 줄에** 맞춘다.
 *
 * FormRow 안에 버튼만 놓으면 라벨 높이만큼 위로 올라붙는다. 빈 라벨을 함께
 * 두면 라벨 글자 크기가 바뀌어도 저절로 맞는다 — 여백을 숫자로 박으면 그때
 * 어긋난다.
 *
 * `center` 는 글로 된 값(비율·안내)을 입력칸 **높이 가운데**에 놓는다.
 *
 * 자식은 제 너비대로 선다. 칸을 가득 채우려면 `w-full` 을 준다 (좁은 화면의
 * 버튼처럼) — 늘 늘여 두면 넓은 화면에서 버튼만 덩그러니 커진다.
 */
export function FieldAction({
  className,
  center = false,
  size = "sm",
  children,
}: {
  className?: string;
  /** 입력칸 높이만큼의 상자 안에서 세로 가운데 정렬 */
  center?: boolean;
  /** 맞출 입력칸 크기 */
  size?: ControlSize;
  children: ReactNode;
}) {
  const h = size === "sm" ? "h-ctl-sm" : size === "lg" ? "h-ctl-lg" : "h-ctl-md";
  return (
    <div className={cn("flex flex-col items-start gap-1.5", className)}>
      <span className="text-nd-caption font-medium" aria-hidden>
        {"\u00a0"}
      </span>
      {center ? <div className={cn("flex items-center", h)}>{children}</div> : children}
    </div>
  );
}

// ---- Input ---------------------------------------------------
export type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "size"> & { size?: ControlSize };
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ className, size = "md", ...props }, ref) {
  return <input ref={ref} className={controlClass(size, className)} {...props} />;
});

// ---- Textarea ------------------------------------------------
export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & { size?: ControlSize };
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, size = "md", ...props },
  ref,
) {
  return (
    <textarea
      ref={ref}
      className={cn(
        base,
        "min-h-[5.5rem] resize-y py-2 leading-relaxed",
        size === "sm" ? "rounded-[8px] px-2.5 text-[13px]" : "rounded-nd-md px-3 text-nd-body",
        className,
      )}
      {...props}
    />
  );
});

// ---- Select --------------------------------------------------
// 화살표는 배경 이미지로 그린다 — 래퍼 없이 className 이 그대로 select 에 붙는다.
const chevron =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%2364748b' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='m6 9 6 6 6-6'/></svg>\")";

export type SelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, "size"> & { size?: ControlSize };
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className, size = "md", children, style, ...props },
  ref,
) {
  return (
    <select
      ref={ref}
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
});

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
