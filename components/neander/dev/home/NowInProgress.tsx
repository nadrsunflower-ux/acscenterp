"use client";

// ============================================================
//  개발허브 홈 ② — "지금 — 진행중인 작업"
//  in_progress 작업을 팀원별로 그룹핑(내 것 먼저)해 카드 리스트로.
//  카드: 종류 아이콘 + 제목 + 프로젝트칩 + 마감 배지, 클릭 → 보드 상세.
//  담당자 없는 진행중 작업은 맨 아래 "미배정" 그룹으로.
// ============================================================

import { useMemo } from "react";
import Link from "next/link";
import { ArrowRight, UserRound, Zap } from "lucide-react";
import { Badge, Card, Icon, MemberAvatar, EmptyState } from "@/components/neander/ui";
import { FeatureChip, KindTag } from "@/components/neander/dev/atoms";
import { devPriorityRank, type DevFeature, type DevTask } from "@/lib/neander/dev/types";
import type { Member } from "@/lib/neander/types";
import { SectionHeader } from "./SectionHeader";
import { dueInfo } from "./due";

type Group = {
  /** null 이면 "미배정" 그룹 */
  member: Member | null;
  tasks: DevTask[];
};

export function NowInProgress({
  tasks,
  members,
  currentMemberId,
  featureById,
}: {
  tasks: DevTask[];
  members: Member[];
  currentMemberId?: string;
  featureById: (id?: string) => DevFeature | undefined;
}) {
  const groups = useMemo<Group[]>(() => {
    const inProgress = tasks.filter((t) => t.status === "in_progress");
    // 내(currentMember) 그룹이 항상 먼저 오도록 멤버 순서 재배열
    const ordered = currentMemberId
      ? [
          ...members.filter((m) => m.id === currentMemberId),
          ...members.filter((m) => m.id !== currentMemberId),
        ]
      : members;
    const out: Group[] = [];
    for (const m of ordered) {
      const mine = inProgress.filter((t) => (t.assigneeIds ?? []).includes(m.id));
      if (mine.length === 0) continue;
      mine.sort(
        (a, b) => devPriorityRank(a.priority) - devPriorityRank(b.priority) || a.order - b.order,
      );
      out.push({ member: m, tasks: mine });
    }
    const unassigned = inProgress.filter((t) => (t.assigneeIds ?? []).length === 0);
    if (unassigned.length > 0) {
      unassigned.sort(
        (a, b) => devPriorityRank(a.priority) - devPriorityRank(b.priority) || a.order - b.order,
      );
      out.push({ member: null, tasks: unassigned });
    }
    return out;
  }, [tasks, members, currentMemberId]);

  return (
    <section>
      <SectionHeader
        icon={Zap}
        title="지금 — 진행중인 작업"
        description="팀원별로 지금 손에 들고 있는 작업이에요. 카드를 누르면 자세한 내용을 볼 수 있어요."
        action={
          <Link
            href="/neander/dev/board?status=in_progress"
            className="inline-flex items-center gap-1 text-nd-caption font-medium text-nd-accent-strong hover:underline"
          >
            보드에서 보기
            <ArrowRight size={12} aria-hidden />
          </Link>
        }
      />

      <Card>
        {groups.length === 0 ? (
          <EmptyState
            icon={Zap}
            title="아직 진행중 작업이 없어요"
            description="작업 보드에서 카드를 '진행중'으로 옮기면 여기 나타납니다."
          />
        ) : (
          <div className="flex flex-col gap-5">
            {groups.map((g) => (
              <div key={g.member?.id ?? "__unassigned__"}>
                {/* 팀원 헤더 */}
                <div className="mb-2 flex items-center gap-2">
                  {g.member ? (
                    <>
                      <MemberAvatar
                        name={g.member.name}
                        color={g.member.color ?? "#71717a"}
                        avatar={g.member.avatar}
                        className="h-7 w-7 text-[11px]"
                      />
                      <span className="text-nd-body font-semibold text-nd-fg">
                        {g.member.name}
                      </span>
                      {g.member.id === currentMemberId && (
                        <Badge tone="accent" size="sm" className="font-semibold">
                          나
                        </Badge>
                      )}
                    </>
                  ) : (
                    <>
                      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-nd-fg/[.07] text-nd-fg-3">
                        <Icon icon={UserRound} size={14} />
                      </span>
                      <span className="text-nd-body font-semibold text-nd-fg-2">미배정</span>
                    </>
                  )}
                  <span className="nd-num text-nd-caption text-nd-fg-3">
                    {g.tasks.length}건
                  </span>
                </div>

                {/* 진행중 카드 리스트 */}
                <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  {g.tasks.map((t) => (
                    <TaskMiniCard key={t.id} task={t} feature={featureById(t.featureId)} />
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </Card>
    </section>
  );
}

/** 진행중 작업 미니 카드 — 클릭 시 보드 상세 모달 딥링크(board?task=<id>) */
function TaskMiniCard({ task: t, feature }: { task: DevTask; feature?: DevFeature }) {
  const due = t.dueDate ? dueInfo(t.dueDate) : null;
  return (
    <li>
      <Link
        href={`/neander/dev/board?task=${t.id}`}
        aria-label={`${t.title} — 작업 상세 보기`}
        className="flex h-full flex-col gap-1.5 rounded-nd-md border border-nd-line bg-nd-content px-3 py-2.5 transition-colors duration-nd-fast hover:border-nd-accent/40 hover:bg-nd-accent-soft/40 focus:outline-none focus-visible:shadow-nd-focus"
      >
        <div className="flex items-start gap-1.5">
          <KindTag kind={t.kind} iconOnly />
          <span className="min-w-0 flex-1 truncate text-nd-body font-medium text-nd-fg" title={t.title}>
            {t.title}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {(feature || t.featureName) && <FeatureChip feature={feature} name={t.featureName} />}
          {due && (
            <span className={`inline-flex h-5 items-center rounded-full px-1.5 text-nd-micro ${due.cls}`}>
              {due.label}
            </span>
          )}
        </div>
      </Link>
    </li>
  );
}
