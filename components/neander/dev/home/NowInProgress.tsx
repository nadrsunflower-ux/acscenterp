"use client";

// ============================================================
//  개발허브 홈 ② — "지금 — 진행중인 작업"
//  in_progress 작업을 팀원별로 그룹핑(내 것 먼저)해 카드 리스트로.
//  카드: 종류 아이콘 + 제목 + 프로젝트칩 + 마감 배지, 클릭 → 보드 상세.
//  담당자 없는 진행중 작업은 맨 아래 "미배정" 그룹으로.
// ============================================================

import { useMemo } from "react";
import Link from "next/link";
import { Card, MemberAvatar, EmptyState } from "@/components/neander/ui";
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
        icon="⚡"
        title="지금 — 진행중인 작업"
        description="팀원별로 지금 손에 들고 있는 작업이에요. 카드를 누르면 자세한 내용을 볼 수 있어요."
        action={
          <Link
            href="/neander/dev/board?status=in_progress"
            className="text-xs font-medium text-indigo-600 hover:underline"
          >
            보드에서 보기 →
          </Link>
        }
      />

      <Card className="!rounded-2xl">
        {groups.length === 0 ? (
          <EmptyState
            icon="⚡"
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
                      <span className="text-sm font-semibold text-zinc-800">
                        {g.member.name}
                      </span>
                      {g.member.id === currentMemberId && (
                        <span className="rounded-full bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-600">
                          나
                        </span>
                      )}
                    </>
                  ) : (
                    <>
                      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-zinc-100 text-[13px]">
                        🫥
                      </span>
                      <span className="text-sm font-semibold text-zinc-500">미배정</span>
                    </>
                  )}
                  <span className="text-xs tabular-nums text-zinc-400">
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
        className="flex h-full flex-col gap-1.5 rounded-xl border border-zinc-200 bg-white px-3 py-2.5 transition-colors hover:border-indigo-200 hover:bg-indigo-50/40 focus:outline-none focus:ring-2 focus:ring-indigo-100"
      >
        <div className="flex items-start gap-1.5">
          <KindTag kind={t.kind} iconOnly />
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-800">
            {t.title}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {(feature || t.featureName) && (
            <FeatureChip feature={feature} name={t.featureName} className="!py-0" />
          )}
          {due && (
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${due.cls}`}
            >
              {due.label}
            </span>
          )}
        </div>
      </Link>
    </li>
  );
}
