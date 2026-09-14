// ============================================================
//  PageShell · PageHeader — 화면 바깥틀과 제목 줄
// ------------------------------------------------------------
//  "지금 어디인가 · 무엇을 할 수 있는가" 를 제목 줄 하나에.
//
//  설명은 제목 **아래 줄**에 둔다. 옆에 붙이면 제목이 길어질수록(한국어
//  화면 이름은 길다) 설명이 오른쪽 끝으로 밀려 읽히지 않고, 좁은 화면에서
//  줄바꿈되면 제목과 구분이 안 된다. 승인 목업 19장이 모두 아래 줄이다.
//
//  폭은 화면이 제각각 정하지 않는다 — PageShell 이 네 가지만 준다.
//  (표가 넓은 화면은 wide, 일반 업무 화면은 default, 폼·읽을거리는 form,
//   손으로 쓰는 모바일 화면은 narrow)
// ============================================================
import type { ReactNode } from "react";
import { cn } from "./cn";

/** className 에 이미 mb-* 가 있으면 기본 아래 여백을 겹치지 않는다 (제목 아래 기준 줄을 붙일 때) */
const hasMargin = (cls?: string) => !!cls && /(^|\s)!?mb-(\d|\[)/.test(cls);

const widthCls = {
  /** 넓은 표·매트릭스 (원장·프로젝트·임포트) */
  wide: "max-w-[1400px]",
  /** 일반 업무 화면 */
  default: "max-w-[1240px]",
  /** 폼·읽을거리 — 한 줄이 길어지면 읽기 어렵다 */
  form: "max-w-[900px]",
  /** 손으로 쓰는 좁은 화면 (카드 기록) */
  narrow: "max-w-lg",
  /** 제한 없음 (뷰포트를 꽉 채우는 시트) */
  full: "",
} as const;

export type PageWidth = keyof typeof widthCls;

export function PageShell({
  width = "default",
  children,
  className,
}: {
  width?: PageWidth;
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn("mx-auto w-full", widthCls[width], className)}>{children}</div>;
}

export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
  meta,
  className,
  compact = false,
  /** 제목 바로 옆 (상태 배지 · 코드처럼 제목의 일부로 읽히는 것) */
  titleSuffix,
}: {
  title: ReactNode;
  description?: ReactNode;
  /** 오른쪽 동작 묶음 */
  actions?: ReactNode;
  /** 제목 위 작은 문맥 (예: 모듈명) */
  eyebrow?: ReactNode;
  /** 동작 왼쪽 상태 (예: 검토 대기 12건) */
  meta?: ReactNode;
  className?: string;
  compact?: boolean;
  titleSuffix?: ReactNode;
}) {
  return (
    <header
      className={cn(
        "flex flex-wrap items-start justify-between gap-x-6 gap-y-3",
        !hasMargin(className) && (compact ? "mb-4" : "mb-6"),
        className,
      )}
    >
      <div className="min-w-0">
        {eyebrow && <div className="mb-1 text-nd-caption font-medium text-nd-fg-3">{eyebrow}</div>}
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <h1 className={cn("min-w-0 text-nd-fg", compact ? "text-nd-title" : "text-nd-display")}>{title}</h1>
          {titleSuffix}
        </div>
        {description && <p className="mt-1 max-w-[70ch] text-nd-body text-nd-fg-2">{description}</p>}
      </div>
      {(actions || meta) && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {meta}
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
    </header>
  );
}
