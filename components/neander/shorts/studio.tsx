"use client";

// ============================================================
//  AI STUDIO 화면 공통 조각 (2026-11 목업 개편)
// ------------------------------------------------------------
//  페이지 머리 · 지표 카드 · 확인할 일 · 영상 진행 단계 · AI 비용 · 반응형 표(모바일 카드) ·
//  공개 범위 · 연결 타일 · 자동 저장 표시 · 빈/오류 상태 묶음.
//  글씨는 모두 13px 이상 (AI STUDIO 는 큰 모니터에서 쓴다 — feedback-small-fonts).
//  색만으로 상태를 말하지 않는다 — 꼬리표 글자 · 아이콘을 함께 둔다.
// ============================================================

import Link from "next/link";
import { Fragment, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  CloudOff,
  Eye,
  Info,
  Loader2,
  Lock,
  Users,
  type LucideIcon,
} from "lucide-react";
import { Badge, buttonClass, cn, toneCls, type Tone } from "@/components/neander/ui";
import type { SpaceKind } from "@/lib/neander/shorts/spaces";

// ---- 페이지 머리 ------------------------------------------------------------

/**
 * 화면 제목 줄 — 위 작은 문맥(아이콘 + 글) · 큰 제목 · 한두 줄 설명 · 오른쪽 주요 버튼.
 * 모바일은 버튼이 설명 아래로 내려간다.
 */
export function StudioHeader({
  kicker,
  kickerIcon: KickerIcon,
  title,
  titleSuffix,
  description,
  actions,
  meta,
  chips,
  className,
}: {
  kicker?: ReactNode;
  kickerIcon?: LucideIcon;
  title: ReactNode;
  titleSuffix?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** 버튼 왼쪽에 붙는 조용한 상태 (저장됨 등) */
  meta?: ReactNode;
  /** 제목 아래 꼬리표 줄 (종류 · 단계 · 공개 범위) */
  chips?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("mb-6 flex flex-col gap-4 md:flex-row md:items-start md:justify-between md:gap-8", className)}>
      <div className="min-w-0">
        {kicker && (
          <div className="mb-1.5 flex items-center gap-1.5 text-[13px] font-medium text-nd-fg-3">
            {KickerIcon && <KickerIcon size={15} aria-hidden />}
            <span className="min-w-0 truncate">{kicker}</span>
          </div>
        )}
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <h1 className="min-w-0 break-keep text-nd-display text-nd-fg">{title}</h1>
          {titleSuffix}
        </div>
        {description && <p className="mt-2 max-w-[80ch] text-nd-body leading-relaxed text-nd-fg-2">{description}</p>}
        {chips && <div className="mt-3 flex flex-wrap items-center gap-2">{chips}</div>}
      </div>
      {(actions || meta) && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 md:justify-end md:pt-6">
          {meta}
          {actions}
        </div>
      )}
    </header>
  );
}

/** 화면 안 큰 구역 제목 — 제목 + 한 줄 설명 + 오른쪽 동작 */
export function StudioSection({
  title,
  description,
  icon: SIcon,
  action,
  children,
  className,
  id,
}: {
  title: ReactNode;
  description?: ReactNode;
  icon?: LucideIcon;
  action?: ReactNode;
  children?: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section id={id} className={cn("min-w-0 scroll-mt-24", className)}>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-[17px] font-semibold leading-snug text-nd-fg">
            {SIcon && <SIcon size={17} aria-hidden className="text-nd-fg-3" />}
            {title}
          </h2>
          {description && <p className="mt-0.5 text-[13px] text-nd-fg-3">{description}</p>}
        </div>
        {action && <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div>}
      </div>
      {children}
    </section>
  );
}

/** 흰 카드 — 머리(제목 · 설명 · 오른쪽 동작) + 몸통. flush 면 몸통 안쪽 여백 없음(표) */
export function StudioCard({
  title,
  description,
  action,
  children,
  className,
  bodyClassName,
  flush = false,
  id,
}: {
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
  className?: string;
  bodyClassName?: string;
  flush?: boolean;
  id?: string;
}) {
  return (
    <section id={id} className={cn("nd-surface min-w-0 overflow-hidden rounded-nd-lg", className)}>
      {(title || action) && (
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-5 pt-4 sm:px-6 sm:pt-5">
          <div className="min-w-0">
            {title && <h3 className="text-[16px] font-semibold leading-snug text-nd-fg">{title}</h3>}
            {description && <p className="mt-0.5 text-[13px] leading-relaxed text-nd-fg-3">{description}</p>}
          </div>
          {action && <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div>}
        </div>
      )}
      <div className={cn(flush ? (title || action ? "pt-3" : "") : cn("px-5 pb-5 sm:px-6", title || action ? "pt-4" : "pt-5"), bodyClassName)}>{children}</div>
    </section>
  );
}

// ---- 지표 카드 ---------------------------------------------------------------

/** 큰 숫자 하나 — 라벨 · 값(단위는 작게) · 설명. href 면 카드 전체가 링크 */
export function StudioMetric({
  label,
  value,
  unit,
  detail,
  tone,
  href,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  unit?: ReactNode;
  detail?: ReactNode;
  /** 값 글자색 — accent(확인할 일) · danger(연체) 등. 기본은 본문색 */
  tone?: Tone;
  href?: string;
  className?: string;
}) {
  const body = (
    <>
      <div className="flex items-center justify-between gap-2 text-[13px] font-medium text-nd-fg-3">
        <span className="min-w-0 truncate">{label}</span>
        {href && <ChevronRight size={15} aria-hidden className="shrink-0 text-nd-fg-4" />}
      </div>
      <div className={cn("nd-num mt-2 text-[26px] font-bold leading-tight tracking-[-0.02em]", tone ? toneCls[tone].text : "text-nd-fg")}>
        {value}
        {unit && <span className="ml-1 text-[14px] font-medium tracking-normal text-nd-fg-2">{unit}</span>}
      </div>
      {detail && <div className="mt-1.5 text-[13px] leading-snug text-nd-fg-3">{detail}</div>}
    </>
  );
  const cls = cn("nd-surface block min-w-0 rounded-nd-lg px-5 py-4", href && "transition-colors hover:bg-nd-sunken", className);
  return href ? (
    <Link href={href} className={cls}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

// ---- 종류 꼬리표 -------------------------------------------------------------

/** 프로젝트 종류 — 자체 운영(회색) · 대행(주황). 대행이면 업체 이름을 함께 */
export function SpaceKindBadge({ kind, clientName, size = "lg" }: { kind: SpaceKind; clientName?: string | null; size?: "sm" | "md" | "lg" }) {
  return (
    <Badge tone={kind === "agency" ? "warning" : "neutral"} size={size}>
      {kind === "agency" ? `대행${clientName ? ` · ${clientName}` : ""}` : "자체 운영"}
    </Badge>
  );
}

// ---- 확인할 일 ---------------------------------------------------------------

export interface AttentionItem {
  key: string;
  /** 무슨 일인지 — 꼬리표 글자 (「결과 확인 필요」 「AI 장면 검토」 「고객 승인 대기」 「연체」) */
  label: string;
  tone: Tone;
  icon?: LucideIcon;
  title: ReactNode;
  detail?: ReactNode;
  href?: string;
  actionLabel?: string;
  /** 링크 대신 버튼 */
  onAction?: () => void;
}

/** 확인할 일 한 줄씩 — 아이콘 · 꼬리표 · 제목 · 설명 · 오른쪽 바로 가기 */
export function AttentionList({ items, className }: { items: AttentionItem[]; className?: string }) {
  return (
    <ul className={cn("divide-y divide-nd-line", className)}>
      {items.map((it) => {
        const I = it.icon ?? (it.tone === "danger" ? CircleAlert : it.tone === "warning" ? AlertTriangle : Info);
        const action = it.href ? (
          <Link href={it.href} className={buttonClass("secondary", "sm", "shrink-0 gap-1.5")}>
            <ArrowUpRight size={15} aria-hidden />
            {it.actionLabel ?? "열기"}
          </Link>
        ) : it.onAction ? (
          <button type="button" onClick={it.onAction} className={buttonClass("secondary", "sm", "shrink-0 gap-1.5")}>
            <ArrowUpRight size={15} aria-hidden />
            {it.actionLabel ?? "열기"}
          </button>
        ) : null;
        return (
          <li key={it.key} className="flex flex-col gap-3 py-3.5 first:pt-1 last:pb-1 sm:flex-row sm:items-center sm:gap-4">
            <div className="flex min-w-0 flex-1 items-start gap-3">
              <span className={cn("mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-nd-md border border-nd-line", toneCls[it.tone].text)}>
                <I size={16} aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                  <Badge tone={it.tone} size="lg">
                    {it.label}
                  </Badge>
                  <span className="min-w-0 break-keep text-nd-body font-semibold text-nd-fg">{it.title}</span>
                </div>
                {it.detail && <p className="mt-1 text-[13px] leading-relaxed text-nd-fg-2">{it.detail}</p>}
              </div>
            </div>
            {action && <div className="pl-11 sm:pl-0">{action}</div>}
          </li>
        );
      })}
    </ul>
  );
}

// ---- 영상 진행 단계 ----------------------------------------------------------

export type FlowState = "done" | "current" | "todo" | "skip";
export interface FlowStep {
  key: string;
  label: string;
  state: FlowState;
  /** 한 줄 더 (「고객 검토 2차」 「게시 2건」) */
  hint?: string;
  /** 누르면 그 탭으로 — 단계는 바뀌지 않는다 (보기만 옮긴다) */
  onSelect?: () => void;
}

/**
 * 영상 하나의 흐름 — 소재 → 대본 → 편집 → (승인) → 게시 → 성과.
 * 끝난 단계는 체크, 지금 단계는 파란 번호, 남은 단계는 옅은 번호, 해당 없음은 흐린 「해당 없음」.
 * 누르면 그 단계의 탭을 열 뿐 실제 단계(stage)를 바꾸지 않는다.
 */
export function StageFlow({ steps, className, ariaLabel = "영상 진행 단계" }: { steps: FlowStep[]; className?: string; ariaLabel?: string }) {
  return (
    <ol aria-label={ariaLabel} className={cn("nd-surface relative flex min-w-0 items-stretch overflow-x-auto rounded-nd-lg px-2 py-2 sm:px-3", className)}>
      {steps.map((s, i) => {
        const inner = (
          <>
            <span
              className={cn(
                "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold",
                s.state === "done" && "bg-nd-success-soft text-nd-success-text",
                s.state === "current" && "bg-nd-accent text-white",
                s.state === "todo" && "bg-nd-sunken text-nd-fg-3",
                s.state === "skip" && "bg-nd-sunken text-nd-fg-4",
              )}
            >
              {s.state === "done" ? <Check size={15} aria-hidden /> : i + 1}
            </span>
            <span className="min-w-0 text-left">
              <span
                className={cn(
                  "block whitespace-nowrap text-[14px]",
                  s.state === "current" ? "font-semibold text-nd-accent-strong" : s.state === "done" ? "font-medium text-nd-fg" : "text-nd-fg-3",
                  s.state === "skip" && "line-through decoration-nd-fg-4",
                )}
              >
                {s.label}
              </span>
              <span className="sr-only">{s.state === "done" ? " (끝남)" : s.state === "current" ? " (지금 단계)" : s.state === "skip" ? " (해당 없음)" : " (남음)"}</span>
              {s.hint && <span className="block whitespace-nowrap text-[13px] text-nd-fg-3">{s.hint}</span>}
            </span>
          </>
        );
        return (
          <Fragment key={s.key}>
            <li className="flex min-w-[112px] flex-1 items-center" aria-current={s.state === "current" ? "step" : undefined}>
              {s.onSelect ? (
                <button type="button" onClick={s.onSelect} className="flex w-full min-w-0 items-center gap-2.5 rounded-nd-md px-2 py-1.5 hover:bg-nd-sunken">
                  {inner}
                </button>
              ) : (
                <div className="flex w-full min-w-0 items-center gap-2.5 px-2 py-1.5">{inner}</div>
              )}
            </li>
            {i < steps.length - 1 && (
              <li aria-hidden className="flex shrink-0 items-center px-0.5 text-nd-fg-4">
                <ChevronRight size={15} />
              </li>
            )}
          </Fragment>
        );
      })}
    </ol>
  );
}

// ---- AI 비용 -----------------------------------------------------------------

const won = (n: number) => `${Math.round(n).toLocaleString("ko-KR")}원`;

/**
 * AI 실행 버튼 옆 비용 한 줄 — 「예상 약 16원 · 오늘 120원 / 하루 상한 200원」.
 * 숫자는 원(KRW). 문자열을 주면 그대로 쓴다 (달러 · 「모델마다 다름」 등). 모르면 빼고 그린다.
 * 상한에 닿으면 빨간 글자와 「상한 도달」 꼬리표.
 */
export function AiCostNote({
  estimate,
  used,
  cap,
  label = "AI 비용",
  className,
  compact = false,
}: {
  estimate?: number | string | null;
  used?: number | string | null;
  cap?: number | string | null;
  label?: string;
  className?: string;
  compact?: boolean;
}) {
  const f = (v: number | string) => (typeof v === "number" ? won(v) : v);
  const reached = typeof used === "number" && typeof cap === "number" && cap > 0 && used >= cap;
  const parts: ReactNode[] = [];
  if (estimate !== undefined && estimate !== null) parts.push(<span key="e">예상 {typeof estimate === "number" ? `약 ${won(estimate)}` : estimate}</span>);
  if (used !== undefined && used !== null)
    parts.push(
      <span key="u" className={cn(reached && "font-semibold text-nd-danger-text")}>
        오늘 {f(used)}
        {cap !== undefined && cap !== null ? ` / 하루 상한 ${f(cap)}` : ""}
      </span>,
    );
  else if (cap !== undefined && cap !== null) parts.push(<span key="c">하루 상한 {f(cap)}</span>);
  if (!parts.length) return null;
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[13px] text-nd-fg-3", className)}>
      {!compact && <span className="font-medium text-nd-fg-2">{label}</span>}
      {parts.map((p, i) => (
        <Fragment key={i}>
          {(i > 0 || !compact) && <span aria-hidden>·</span>}
          {p}
        </Fragment>
      ))}
      {reached && (
        <Badge tone="danger" size="lg">
          상한 도달
        </Badge>
      )}
    </span>
  );
}

// ---- 반응형 표 (모바일 카드) -------------------------------------------------

export interface RecordColumn<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  align?: "left" | "right" | "center";
  /** 데스크톱 칸 너비 클래스 (예: "w-[120px]") */
  className?: string;
  /** 모바일 카드에서 — title(맨 위 굵게) · field(이름: 값) · hide */
  mobile?: "title" | "field" | "hide";
  /** 모바일 카드 라벨 (기본은 header) */
  mobileLabel?: string;
}

/**
 * 데스크톱은 표, 모바일(768px 미만)은 이름이 붙은 카드 목록.
 * 머리글은 표 위에 붙어 있고 숫자 칸은 오른쪽 정렬. 줄을 누르면 onRowClick / rowHref.
 */
export function RecordTable<T>({
  rows,
  columns,
  rowKey,
  rowHref,
  onRowClick,
  empty,
  className,
  ariaLabel,
  rowClassName,
}: {
  rows: T[];
  columns: RecordColumn<T>[];
  rowKey: (row: T) => string;
  rowHref?: (row: T) => string | undefined;
  onRowClick?: (row: T) => void;
  empty?: ReactNode;
  className?: string;
  ariaLabel?: string;
  rowClassName?: (row: T) => string | undefined;
}) {
  if (!rows.length && empty) return <>{empty}</>;
  const titleCol = columns.find((c) => c.mobile === "title") ?? columns[0];
  const fields = columns.filter((c) => c !== titleCol && c.mobile !== "hide");
  const align = (a?: RecordColumn<T>["align"]) => (a === "right" ? "text-right" : a === "center" ? "text-center" : "text-left");
  return (
    <div className={cn("min-w-0", className)}>
      {/* 데스크톱 표 */}
      <div className="nd-scroll hidden overflow-x-auto md:block">
        <table className="w-full border-collapse text-[14px]" aria-label={ariaLabel}>
          <thead>
            <tr className="border-y border-nd-line bg-nd-sunken/70">
              {columns.map((c) => (
                <th key={c.key} scope="col" className={cn("whitespace-nowrap px-4 py-2.5 text-[13px] font-medium text-nd-fg-3 first:pl-5 last:pr-5 sm:first:pl-6 sm:last:pr-6", align(c.align), c.className)}>
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-nd-line">
            {rows.map((r) => {
              const href = rowHref?.(r);
              const click = onRowClick ? () => onRowClick(r) : undefined;
              return (
                <tr key={rowKey(r)} className={cn("align-middle", (href || click) && "cursor-pointer hover:bg-nd-sunken/60", rowClassName?.(r))} onClick={click}>
                  {columns.map((c, i) => (
                    <td key={c.key} className={cn("px-4 py-3 text-nd-fg first:pl-5 last:pr-5 sm:first:pl-6 sm:last:pr-6", align(c.align), c.align === "right" && "nd-num", c.className)}>
                      {href && i === 0 ? (
                        <Link href={href} className="block min-w-0 hover:underline" onClick={(e) => e.stopPropagation()}>
                          {c.cell(r)}
                        </Link>
                      ) : (
                        c.cell(r)
                      )}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {/* 모바일 카드 */}
      <ul className="flex flex-col gap-2.5 md:hidden" aria-label={ariaLabel}>
        {rows.map((r) => {
          const href = rowHref?.(r);
          const body = (
            <>
              <div className="text-[15px] font-semibold leading-snug text-nd-fg">{titleCol.cell(r)}</div>
              {fields.length > 0 && (
                <dl className="mt-2.5 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-[13px]">
                  {fields.map((c) => (
                    <Fragment key={c.key}>
                      <dt className="whitespace-nowrap text-nd-fg-3">{c.mobileLabel ?? c.header}</dt>
                      <dd className="min-w-0 text-right text-nd-fg">{c.cell(r)}</dd>
                    </Fragment>
                  ))}
                </dl>
              )}
            </>
          );
          const cls = cn("block rounded-nd-lg border border-nd-line bg-nd-content px-4 py-3.5", (href || onRowClick) && "active:bg-nd-sunken", rowClassName?.(r));
          return (
            <li key={rowKey(r)}>
              {href ? (
                <Link href={href} className={cls}>
                  {body}
                </Link>
              ) : onRowClick ? (
                <button type="button" className={cn(cls, "w-full text-left")} onClick={() => onRowClick(r)}>
                  {body}
                </button>
              ) : (
                <div className={cls}>{body}</div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ---- 공개 범위 ---------------------------------------------------------------

/**
 * 영상 · 소재 공개 범위 꼬리표 — 「나만 보기 · 이동주」 · 「팀 공개 · 이동주」 · 「읽기 전용 · 김주연 것」.
 * readOnly 는 관리자가 남의 비공개 자료를 몰아 볼 때.
 */
export function VisibilityChip({ visibility, ownerName, readOnly = false, className }: { visibility: "private" | "team" | string; ownerName?: string; readOnly?: boolean; className?: string }) {
  const I = readOnly ? Eye : visibility === "team" ? Users : Lock;
  const text = readOnly ? `읽기 전용${ownerName ? ` · ${ownerName} 것` : ""}` : `${visibility === "team" ? "팀 공개" : "나만 보기"}${ownerName ? ` · ${ownerName}` : ""}`;
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap text-[13px]", readOnly ? "font-medium text-nd-warning-text" : "text-nd-fg-2", className)}>
      <I size={14} aria-hidden />
      {text}
    </span>
  );
}

// ---- 연결 타일 ---------------------------------------------------------------

/** 연결 · 설정 상태 한 칸 — 이름 · 상태 꼬리표(색 + 글자) · 한 줄 설명 */
export function StatusTile({ label, status, tone, detail, href, className }: { label: ReactNode; status: string; tone: Tone; detail?: ReactNode; href?: string; className?: string }) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <span className="min-w-0 text-[14px] font-semibold text-nd-fg">{label}</span>
        <Badge tone={tone} size="lg" className="shrink-0">
          {status}
        </Badge>
      </div>
      {detail && <div className="mt-1 text-[13px] leading-snug text-nd-fg-3">{detail}</div>}
    </>
  );
  const cls = cn("block min-w-0 rounded-nd-md border border-nd-line bg-nd-sunken/60 px-4 py-3", href && "hover:bg-nd-sunken", className);
  return href ? (
    <Link href={href} className={cls}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

// ---- 자동 저장 표시 ----------------------------------------------------------

export type StudioSaveState = "saved" | "dirty" | "saving" | "conflict" | "error";

/** 조용한 자동 저장 표시 — 저장됨 · 저장 중 · 고친 내용 저장 대기 · 다른 곳에서 바뀜 · 저장 실패 */
export function SaveIndicator({ state, savedAt, onRetry, className }: { state: StudioSaveState; savedAt?: number | null; onRetry?: () => void; className?: string }) {
  const at = savedAt ? new Date(savedAt + 9 * 3600_000) : null;
  const atText = at ? ` · ${at.getUTCMonth() + 1}/${at.getUTCDate()} ${String(at.getUTCHours()).padStart(2, "0")}:${String(at.getUTCMinutes()).padStart(2, "0")}` : "";
  const map: Record<StudioSaveState, { icon: LucideIcon; text: string; cls: string; spin?: boolean }> = {
    saved: { icon: CheckCircle2, text: `저장됨${atText}`, cls: "text-nd-fg-3" },
    dirty: { icon: Loader2, text: "고친 내용 저장 대기", cls: "text-nd-fg-3" },
    saving: { icon: Loader2, text: "저장 중…", cls: "text-nd-fg-3", spin: true },
    conflict: { icon: AlertTriangle, text: "다른 곳에서 바뀌어 합쳐 저장했습니다", cls: "text-nd-warning-text" },
    error: { icon: CloudOff, text: "저장하지 못했습니다", cls: "font-medium text-nd-danger-text" },
  };
  const m = map[state];
  return (
    <span role="status" aria-live="polite" className={cn("inline-flex items-center gap-1.5 whitespace-nowrap text-[13px]", m.cls, className)}>
      <m.icon size={14} aria-hidden className={cn(m.spin && "animate-spin")} />
      {m.text}
      {state === "error" && onRetry && (
        <button type="button" onClick={onRetry} className="ml-1 rounded px-1 font-semibold underline underline-offset-2">
          다시 저장
        </button>
      )}
    </span>
  );
}

// ---- 지속되는 안내 -----------------------------------------------------------

/**
 * 머무는 안내 — 잠깐 떴다 사라지는 띠 대신, 문제가 이어지는 동안만 남는다.
 * 무엇을 하면 되는지(action)를 함께 둔다.
 */
export function StudioNotice({
  tone = "info",
  title,
  children,
  action,
  icon,
  className,
}: {
  tone?: Tone;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  icon?: LucideIcon;
  className?: string;
}) {
  const I = icon ?? (tone === "danger" ? CircleAlert : tone === "warning" ? AlertTriangle : tone === "success" ? CheckCircle2 : Info);
  return (
    <div className={cn("flex flex-col gap-3 rounded-nd-md border px-4 py-3 sm:flex-row sm:items-center", toneCls[tone].soft, "border-current/10", className)}>
      <div className={cn("flex min-w-0 flex-1 items-start gap-2.5", toneCls[tone].text)}>
        <I size={18} aria-hidden className="mt-0.5 shrink-0" />
        <div className="min-w-0 text-[14px] leading-relaxed">
          {title && <div className="font-semibold">{title}</div>}
          {children && <div className={cn(title ? "mt-0.5" : undefined, "text-nd-fg-2")}>{children}</div>}
        </div>
      </div>
      {action && <div className="flex shrink-0 flex-wrap items-center gap-2 pl-7 sm:pl-0">{action}</div>}
    </div>
  );
}

// ---- 진행 막대 ---------------------------------------------------------------

/** 이번 달 n / N 편 같은 진행 — 숫자를 늘 함께 (막대만으로 말하지 않는다) */
export function ProgressLine({ value, total, tone = "accent", label, className }: { value: number; total: number; tone?: Tone; label?: ReactNode; className?: string }) {
  const pct = total > 0 ? Math.max(0, Math.min(100, (value / total) * 100)) : 0;
  return (
    <div className={cn("min-w-0", className)}>
      {label && <div className="mb-1 text-[13px] text-nd-fg-2">{label}</div>}
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-nd-sunken" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={value}>
        <span className={cn("block h-full rounded-full", toneCls[tone].solid)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
