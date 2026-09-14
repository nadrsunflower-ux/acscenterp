"use client";

// ============================================================
//  전체 화면 상태 — 로그인 · 불러오는 중 · 권한 없음 · 첫 설정
// ------------------------------------------------------------
//  네 상태가 같은 바탕·같은 카드를 쓴다. 카드는 불투명 콘텐츠 표면
//  (유리 아님) — 읽을 내용이 있는 곳이다.
// ============================================================
import type { ReactNode } from "react";
import { BrandMark, ProductWordmark, cn, Icon, Spinner, type LucideIcon, type Tone, toneCls } from "@/components/neander/ui";

export function StatusScreen({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div data-nd-status className={cn("nd-page-bg flex min-h-screen items-center justify-center p-6", className)}>
      {children}
    </div>
  );
}

/**
 * 로그인·불러오는 중·권한 없음 화면의 머리. 로고 파일이 들어오면
 * `ProductWordmark` 가 글자 대신 그 파일을 그린다 (brand.tsx 의 BRAND_LOGO).
 */
export function Brand({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-col items-center gap-1.5", className)}>
      <BrandMark />
      <ProductWordmark height={16} />
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
