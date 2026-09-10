"use client";

// ============================================================
//  전체 화면 상태 — 로그인 · 불러오는 중 · 권한 없음 · 첫 설정
// ------------------------------------------------------------
//  네 상태가 같은 바탕·같은 카드를 쓴다. 카드는 불투명 콘텐츠 표면
//  (유리 아님) — 읽을 내용이 있는 곳이다.
// ============================================================
import type { ReactNode } from "react";
import { cn, Icon, Spinner, type LucideIcon, type Tone, toneCls } from "@/components/neander/ui";

export function StatusScreen({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div data-nd-status className={cn("nd-page-bg flex min-h-screen items-center justify-center p-6", className)}>
      {children}
    </div>
  );
}

export function Brand({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center justify-center gap-2", className)}>
      <span className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-nd-inverse text-[13px] font-bold text-white">
        N
      </span>
      <span className="text-[15px] font-bold tracking-tight text-nd-fg">NEANDER</span>
      <span className="text-nd-micro font-semibold tracking-wide text-nd-fg-3">ERP</span>
    </div>
  );
}

export function StatusCard({
  icon,
  tone = "neutral",
  title,
  description,
  children,
  className,
  brand = true,
}: {
  icon?: LucideIcon;
  tone?: Tone;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  className?: string;
  brand?: boolean;
}) {
  return (
    <div className={cn("nd-surface w-full max-w-sm rounded-nd-xl p-8 text-center", className)}>
      {brand && <Brand className="mb-6" />}
      {icon && (
        <span className={cn("mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full", toneCls[tone].soft, toneCls[tone].text)}>
          <Icon icon={icon} size={22} />
        </span>
      )}
      <h1 className="text-nd-title text-nd-fg">{title}</h1>
      {description && <div className="mt-2 text-nd-body leading-relaxed text-nd-fg-2">{description}</div>}
      {children}
    </div>
  );
}

export function LoadingScreen({ label = "불러오는 중…" }: { label?: string }) {
  return (
    <StatusScreen>
      <div role="status" aria-live="polite" className="flex flex-col items-center gap-4">
        <Brand />
        <div className="flex items-center gap-2 text-nd-body text-nd-fg-3">
          <Spinner size={16} />
          {label}
        </div>
      </div>
    </StatusScreen>
  );
}
