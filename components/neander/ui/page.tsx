// ============================================================
//  PageHeader — 화면 제목 줄
// ------------------------------------------------------------
//  "지금 어디인가 · 무엇을 할 수 있는가" 를 한 줄에. 주요 동작은
//  오른쪽에 하나(primary), 나머지는 보조 버튼이나 더보기 메뉴로.
// ============================================================
import type { ReactNode } from "react";
import { cn } from "./cn";

export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
  meta,
  className,
  compact = false,
}: {
  title: ReactNode;
  description?: ReactNode;
  /** 오른쪽 동작 묶음 */
  actions?: ReactNode;
  /** 제목 위 작은 문맥 (예: 모듈명) */
  eyebrow?: ReactNode;
  /** 제목 옆 상태 (예: 검토 대기 12건) */
  meta?: ReactNode;
  className?: string;
  compact?: boolean;
}) {
  return (
    <header className={cn("flex flex-wrap items-end justify-between gap-x-6 gap-y-3", compact ? "mb-4" : "mb-6", className)}>
      <div className="min-w-0">
        {eyebrow && <div className="mb-1 text-nd-caption font-medium text-nd-fg-3">{eyebrow}</div>}
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className={cn("text-nd-fg", compact ? "text-nd-title" : "text-nd-display")}>{title}</h1>
          {description && <p className="text-nd-body text-nd-fg-2">{description}</p>}
        </div>
      </div>
      {(actions || meta) && (
        <div className="flex flex-wrap items-center gap-3">
          {meta}
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
    </header>
  );
}
