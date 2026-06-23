// ============================================================
//  공통 UI 프리미티브 (NEANDER ERP, Tailwind)
//  AC'SCENT의 components/ui 와 별개로 NEANDER 영역 전용.
// ============================================================
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
  ReactNode,
} from "react";
import { TASK_CATEGORIES, type TaskCategory } from "@/lib/neander/types";

export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}

// ---- Button ------------------------------------------------
type Variant = "primary" | "secondary" | "ghost" | "danger";
const variantCls: Record<Variant, string> = {
  primary: "bg-indigo-600 text-white hover:bg-indigo-700 disabled:bg-indigo-300",
  secondary:
    "bg-white text-zinc-800 border border-zinc-300 hover:bg-zinc-50 disabled:opacity-50",
  ghost: "text-zinc-600 hover:bg-zinc-100 disabled:opacity-50",
  danger: "bg-white text-red-600 border border-red-200 hover:bg-red-50 disabled:opacity-50",
};

export function Button({
  variant = "primary",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed",
        variantCls[variant],
        className,
      )}
      {...props}
    />
  );
}

// ---- Field (label + control) -------------------------------
export function Field({
  label,
  hint,
  required,
  className,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label className={cn("flex flex-col gap-1.5", className)}>
      <span className="text-sm font-medium text-zinc-700">
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </span>
      {children}
      {hint && <span className="text-xs text-zinc-400">{hint}</span>}
    </label>
  );
}

const controlCls =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 placeholder:text-zinc-400";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(controlCls, className)} {...props} />;
}

export function Textarea({
  className,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(controlCls, "resize-y", className)} {...props} />;
}

export function Select({
  className,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(controlCls, "cursor-pointer", className)} {...props}>
      {children}
    </select>
  );
}

// ---- Card --------------------------------------------------
export function Card({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-zinc-200 bg-white p-5 shadow-sm",
        className,
      )}
    >
      {children}
    </div>
  );
}

// ---- Badge -------------------------------------------------
export function Badge({
  children,
  color = "#71717a",
  className,
}: {
  children: ReactNode;
  color?: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
        className,
      )}
      style={{ backgroundColor: `${color}1a`, color }}
    >
      {children}
    </span>
  );
}

// ---- MemberAvatar ------------------------------------------
// 캐릭터(이모지)가 있으면 이모지를, 없으면 이름 첫 글자를 색상 원 안에 표시.
// className 으로 크기/글자크기 지정 (예: "h-10 w-10 text-lg").
export function MemberAvatar({
  name,
  color = "#71717a",
  avatar,
  className,
}: {
  name: string;
  color?: string;
  avatar?: string;
  className?: string;
}) {
  const initial = name.trim().charAt(0) || "?";
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full font-bold leading-none text-white",
        className ?? "h-10 w-10 text-lg",
      )}
      style={{ backgroundColor: color }}
    >
      {avatar || initial}
    </span>
  );
}

// ---- CategoryPicker ----------------------------------------
// 분류(스모트/아이디/와우/기타)를 칸(박스)으로 선택. 선택 시 분류 색상으로 채워짐.
export function CategoryPicker({
  value,
  onChange,
}: {
  /** undefined 면 어떤 칸도 선택되지 않은 '미분류' 상태 */
  value?: TaskCategory;
  onChange: (c: TaskCategory) => void;
}) {
  return (
    <div className="grid grid-cols-4 gap-1.5">
      {TASK_CATEGORIES.map((c) => {
        const active = value === c.value;
        return (
          <button
            type="button"
            key={c.value}
            onClick={() => onChange(c.value)}
            className={cn(
              "rounded-lg border py-2 text-xs font-medium transition",
              active ? "text-white" : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50",
            )}
            style={active ? { backgroundColor: c.color, borderColor: c.color } : undefined}
          >
            {c.label}
          </button>
        );
      })}
    </div>
  );
}

// ---- PageHeader --------------------------------------------
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900">{title}</h1>
        {description && <p className="mt-1 text-sm text-zinc-500">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

// ---- EmptyState --------------------------------------------
export function EmptyState({
  icon,
  title,
  description,
}: {
  icon?: string;
  title: string;
  description?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-zinc-300 py-14 text-center">
      {icon && <div className="mb-2 text-3xl">{icon}</div>}
      <p className="font-medium text-zinc-700">{title}</p>
      {description && <p className="mt-1 text-sm text-zinc-400">{description}</p>}
    </div>
  );
}
