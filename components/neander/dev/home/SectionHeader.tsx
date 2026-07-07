"use client";

// ============================================================
//  개발허브 홈 — 섹션 공통 헤더
//  이모지 + h2 제목 + 옅은 설명 한 줄 (+ 우측 액션 링크).
//  ⚠️ H1 은 dev layout 이 유일 — 홈 섹션은 전부 h2 로 통일한다.
// ============================================================

import type { ReactNode } from "react";

export function SectionHeader({
  icon,
  title,
  description,
  action,
}: {
  icon: string;
  title: string;
  /** 비개발자도 이해할 수 있는 한 줄 설명 */
  description?: string;
  /** 우측 액션 (예: "전체 보기 →" 링크) */
  action?: ReactNode;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-x-3 gap-y-1">
      <div className="min-w-0">
        <h2 className="flex items-center gap-2 text-base font-bold tracking-tight text-zinc-900">
          <span aria-hidden className="text-lg leading-none">
            {icon}
          </span>
          {title}
        </h2>
        {description && <p className="mt-0.5 text-xs text-zinc-400">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
