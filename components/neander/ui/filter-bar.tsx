"use client";

// ============================================================
//  FilterBar — 표 위에 놓이는 조회 조건 줄
// ------------------------------------------------------------
//  목업의 모든 목록 화면이 같은 줄을 쓴다: 왼쪽에 「라벨 + 컨트롤」 쌍이
//  늘어서고, 오른쪽 끝에 보기 설정·주요 동작이 붙는다.
//
//  화면마다 제각각 flex 를 짜면 필드 높이와 라벨 위치가 어긋난다. 여기서
//  한 번만 정한다 — 컨트롤은 모두 같은 높이(ctl-md), 라벨은 컨트롤 왼쪽에
//  같은 색·같은 크기로. 좁은 화면에서는 줄바꿈된다.
// ============================================================
import type { ReactNode } from "react";
import { cn } from "./cn";

export function FilterBar({
  children,
  /** 오른쪽 끝 (보기 설정 · 내보내기 · 주요 동작) */
  actions,
  className,
}: {
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "nd-surface flex flex-wrap items-center gap-x-4 gap-y-3 rounded-nd-lg px-4 py-3",
        className,
      )}
    >
      {children}
      {actions && <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/**
 * 라벨 + 컨트롤 한 쌍. 라벨은 <label> 이라 눌러도 컨트롤로 포커스가 간다
 * (htmlFor 를 주면). 라벨을 못 붙이는 컨트롤(SegmentedControl 처럼 자체
 * role 을 가진 것)에는 `as="div"` 로 두고 컨트롤에 ariaLabel 을 준다.
 */
export function FilterField({
  label,
  htmlFor,
  children,
  as = "label",
  className,
}: {
  label: ReactNode;
  htmlFor?: string;
  children: ReactNode;
  as?: "label" | "div";
  className?: string;
}) {
  const Tag = as;
  return (
    <Tag
      {...(as === "label" && htmlFor ? { htmlFor } : {})}
      className={cn("flex min-w-0 items-center gap-2", className)}
    >
      <span className="shrink-0 text-nd-caption font-medium text-nd-fg-2">{label}</span>
      {children}
    </Tag>
  );
}
