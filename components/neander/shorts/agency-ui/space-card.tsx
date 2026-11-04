"use client";

// ============================================================
//  프로젝트(채널) 한 장 — 대시보드 「프로젝트별 현황」 · 프로젝트 화면이 함께 쓴다
// ------------------------------------------------------------
//  이름 · 종류 · 운영 중/준비 중 · 지금 프로젝트 · 설명 · 기본값 꼬리표 · 숫자 6칸 · 연결 계정 ·
//  진행 중 영상 하나 · 아래 줄(누구의 프로젝트인가 · 고치기 · 이 프로젝트로).
//  운영 중 = 연결 계정(실제 채널)이 있다. 채널도 영상도 없는 「준비 중」 은 숫자 칸 대신 한 줄.
//  숫자는 부르는 화면이 센다 (대시보드는 「보기」 범위, 프로젝트 화면은 볼 수 있는 전체).
// ============================================================

import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowUpRight, Camera, Link2, Pencil, Sparkles } from "lucide-react";
import { Badge, Button, buttonClass, cn } from "@/components/neander/ui";
import { StageBadge } from "@/components/neander/shorts/parts";
import { SpaceKindBadge } from "@/components/neander/shorts/studio";
import { PLATFORM_LABEL } from "@/lib/neander/shorts/model";
import { PRODUCTION_LABEL, spaceKind, type SpaceView } from "@/lib/neander/shorts/spaces";
import type { ProjectStage, PublishPlatform } from "@/lib/neander/shorts/types";

export const SPACE_DEFAULT_KIND_LABEL = { coupang: "쿠팡 제휴", general: "일반 정보" } as const;
export const SPACE_STYLE_LABEL = { intro: "제품 소개", story: "스토리 광고" } as const;

export interface SpaceCardStat {
  videos: number;
  inProgress: number;
  published: number;
  /** 조회 합 — 기록이 하나도 없으면 null(미확인) */
  views: number | null;
  accounts: { name: string; platform: PublishPlatform; reauth?: boolean }[];
  attention: number;
  /** 가장 최근에 고친 만드는 중 영상 */
  latest?: { id: string; title: string; stage: ProjectStage } | null;
}

function Cell({ label, value, tone }: { label: string; value: ReactNode; tone?: "danger" | "warning" }) {
  return (
    <div className="min-w-0">
      <dd className={cn("nd-num text-[20px] font-bold leading-tight tracking-[-0.01em]", tone === "danger" ? "text-nd-danger-text" : tone === "warning" ? "text-nd-warning-text" : "text-nd-fg")}>{value}</dd>
      <dt className="mt-0.5 text-[13px] text-nd-fg-3">{label}</dt>
    </div>
  );
}

const n = (v: number, unit = "") => `${v.toLocaleString("ko-KR")}${unit}`;

export function SpaceSummaryCard({
  s,
  stat,
  current,
  clientName,
  onOpen,
  onEdit,
  editHref,
  foot,
  className,
}: {
  s: SpaceView;
  stat: SpaceCardStat;
  current: boolean;
  clientName?: string | null;
  /** 이 프로젝트로 — 보관한 프로젝트면 빼고 부른다 */
  onOpen?: () => void;
  onEdit?: () => void;
  editHref?: string;
  /** 아래 줄 왼쪽 한 마디 (「현재 선택한 프로젝트」 · 「팀 공용 프로젝트」) */
  foot?: ReactNode;
  className?: string;
}) {
  const agency = spaceKind(s) === "agency";
  const Icon = s.production === "ai" ? Sparkles : Camera;
  // 실제 채널이 있는가 — 연결 계정이 하나라도 있으면 운영 중 (spaces.ts 의 spaceAccounts 와 같은 기준)
  const running = stat.accounts.length > 0;
  // 채널도 영상도 아직 없으면 0 만 늘어선 숫자 칸 대신 한 줄로
  const empty = !running && stat.videos === 0;
  const footText = foot ?? (current ? "현재 선택한 프로젝트" : agency ? "관리자 · 업체 담당자만" : "팀 공용 프로젝트");
  return (
    <article className={cn("nd-surface flex min-w-0 flex-col rounded-nd-lg px-5 pb-4 pt-5 sm:px-6", current && "ring-2 ring-nd-accent/40", s.archived && "opacity-75", className)}>
      <div className="flex items-start gap-3.5">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-nd-md border border-nd-line bg-nd-sunken text-nd-fg-2">
          <Icon size={20} aria-hidden />
          <span className="sr-only">{PRODUCTION_LABEL[s.production]}</span>
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <SpaceKindBadge kind={spaceKind(s)} clientName={clientName} />
            {!s.archived &&
              (running ? (
                <Badge tone="success" size="lg" dot>
                  운영 중
                </Badge>
              ) : (
                <Badge tone="warning" size="lg">
                  준비 중 · 채널 없음
                </Badge>
              ))}
            {current && (
              <Badge tone="accent" size="lg">
                지금 프로젝트
              </Badge>
            )}
            {s.archived && (
              <Badge tone="neutral" size="lg">
                보관
              </Badge>
            )}
          </div>
          <h3 className="mt-1.5 break-keep text-[17px] font-semibold leading-snug text-nd-fg">{s.name}</h3>
        </div>
      </div>
      <p className="mt-3 line-clamp-3 text-[14px] leading-relaxed text-nd-fg-2" title={s.description || undefined}>
        {s.description || <span className="text-nd-fg-3">설명 없음 — 「고치기」 에서 어떤 채널인지 적어 두면 AI 가 소재를 고를 때 참고합니다.</span>}
      </p>
      <div className="mt-3 flex flex-wrap gap-1.5">
        <Badge tone="neutral" size="lg">
          {PRODUCTION_LABEL[s.production]}
        </Badge>
        <Badge tone="neutral" size="lg">
          기본 · {agency ? "고객사 브랜드" : SPACE_DEFAULT_KIND_LABEL[s.defaultKind]}
        </Badge>
        <Badge tone="neutral" size="lg">
          대본 · {SPACE_STYLE_LABEL[s.writerStyle]}
        </Badge>
      </div>
      {empty ? (
        <p className="mt-4 rounded-nd-md border border-dashed border-nd-line px-3.5 py-3 text-[14px] leading-relaxed text-nd-fg-2">
          아직 채널도 영상도 없습니다. 채널을 만들면 이 프로젝트를 고른 채 「연결」 에서 계정을 붙이세요 — 붙이면 「운영 중」 으로 바뀝니다.
        </p>
      ) : (
        <>
          <dl className="mt-4 grid grid-cols-3 gap-x-4 gap-y-3">
            <Cell label="영상" value={n(stat.videos)} />
            <Cell label="만드는 중" value={n(stat.inProgress)} />
            <Cell label="게시" value={n(stat.published)} />
            <Cell label="조회 합" value={stat.views === null ? <span className="text-nd-fg-2" title="아직 확인한 조회 기록이 없습니다 (0 이 아닙니다)">미확인</span> : n(stat.views)} />
            <Cell label="연결 계정" value={n(stat.accounts.length, "개")} />
            <Cell label="확인할 일" value={n(stat.attention, "건")} tone={stat.attention > 0 ? "danger" : undefined} />
          </dl>
          <p className="mt-3 flex min-w-0 items-start gap-1.5 text-[13px] text-nd-fg-2">
            <Link2 size={14} aria-hidden className="mt-0.5 shrink-0 text-nd-fg-3" />
            {stat.accounts.length ? (
              <span className="min-w-0 break-words">
                연결 계정 ·{" "}
                {stat.accounts.map((a, i) => (
                  <span key={`${a.platform}-${a.name}-${i}`}>
                    {i > 0 && ", "}
                    {a.name}
                    <span className="text-nd-fg-3"> ({PLATFORM_LABEL[a.platform]})</span>
                    {a.reauth && <span className="font-medium text-nd-danger-text"> · 다시 연결 필요</span>}
                  </span>
                ))}
              </span>
            ) : (
              <span className="text-nd-fg-3">아직 채널이 없습니다 — 채널을 만들었으면 이 프로젝트를 고른 채 「연결」 에서 계정을 붙이세요</span>
            )}
          </p>
        </>
      )}
      {stat.latest && (
        <Link href={`/neander/shorts/projects/${stat.latest.id}`} className="mt-3 flex min-w-0 items-center gap-2.5 rounded-nd-md border border-nd-line bg-nd-sunken/60 px-3.5 py-2.5 hover:bg-nd-sunken">
          <StageBadge stage={stat.latest.stage} size="lg" />
          <span className="min-w-0 truncate text-[14px] font-medium text-nd-fg" title={stat.latest.title}>
            {stat.latest.title}
          </span>
        </Link>
      )}
      <div aria-hidden className="min-h-[1rem] flex-1" />
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-nd-line pt-3.5">
        <span className="min-w-0 text-[13px] text-nd-fg-3">{footText}</span>
        <span className="ml-auto flex shrink-0 flex-wrap items-center gap-2">
          {editHref ? (
            <Link href={editHref} className={buttonClass("ghost", "sm", "gap-1.5")}>
              <Pencil size={15} aria-hidden />
              고치기
            </Link>
          ) : onEdit ? (
            <Button size="sm" variant="ghost" icon={Pencil} onClick={onEdit}>
              고치기
            </Button>
          ) : null}
          {onOpen && (
            <Button size="sm" variant={current ? "primary" : "secondary"} icon={ArrowUpRight} onClick={onOpen}>
              이 프로젝트로
            </Button>
          )}
        </span>
      </div>
    </article>
  );
}
