"use client";

// ============================================================
//  팀원별 작업 부하 (대시보드)
//  - 담당(assigneeIds 포함) 기준으로 done 을 제외한 활성 작업을
//    상태별 가로 스택 바로 표시. 작업이 없는 팀원도 0 으로 노출.
//  - 정렬: 활성 작업이 많은 팀원부터.
// ============================================================

import { useMemo } from "react";
import Link from "next/link";
import { MemberAvatar, EmptyState, cn } from "@/components/neander/ui";
import {
  devStatusColor,
  devStatusLabel,
  type DevTask,
  type DevStatus,
} from "@/lib/neander/dev/types";
import type { Member } from "@/lib/neander/types";

/** 스택 바 세그먼트 순서(진행 파이프라인 역순 — 활발한 상태부터) */
const SEGMENT_ORDER: DevStatus[] = ["in_progress", "review", "todo", "backlog"];

type Row = {
  member: Member;
  total: number;
  counts: Record<DevStatus, number>;
};

export function MemberWorkload({
  tasks,
  members,
}: {
  tasks: DevTask[];
  members: Member[];
}) {
  const rows = useMemo<Row[]>(() => {
    const active = tasks.filter((t) => t.status !== "done");
    const data = members.map<Row>((m) => {
      const counts: Record<DevStatus, number> = {
        backlog: 0,
        todo: 0,
        in_progress: 0,
        review: 0,
        done: 0,
      };
      let total = 0;
      for (const t of active) {
        if ((t.assigneeIds ?? []).includes(m.id)) {
          counts[t.status] += 1;
          total += 1;
        }
      }
      return { member: m, total, counts };
    });
    data.sort((a, b) => b.total - a.total);
    return data;
  }, [tasks, members]);

  // 바 스케일: 팀 내 최대 활성 작업 수에 맞춰 상대 폭(부하 비교용)
  const max = useMemo(() => Math.max(1, ...rows.map((r) => r.total)), [rows]);

  if (members.length === 0) {
    return (
      <EmptyState
        icon="👥"
        title="팀원이 없습니다"
        description="팀원이 등록되면 담당 작업 부하가 여기에 표시됩니다."
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {rows.map(({ member: m, total, counts }) => (
        <Link
          key={m.id}
          href={`/neander/dev/board?assignee=${m.id}`}
          aria-label={`${m.name} 담당 작업 ${total}건 보기`}
          className="-mx-1 flex items-center gap-3 rounded-lg px-1 py-1 transition-colors hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-indigo-100"
        >
          {/* 팀원 */}
          <div className="flex w-24 shrink-0 items-center gap-2 sm:w-28">
            <MemberAvatar
              name={m.name}
              color={m.color ?? "#71717a"}
              avatar={m.avatar}
              className="h-7 w-7 text-[11px]"
            />
            <span className="min-w-0 truncate text-sm font-medium text-zinc-700">
              {m.name}
            </span>
          </div>

          {/* 상태별 스택 바 */}
          <div className="flex h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-zinc-100">
            {total === 0
              ? null
              : SEGMENT_ORDER.map((s) => {
                  const c = counts[s];
                  if (!c) return null;
                  return (
                    <div
                      key={s}
                      className="h-full"
                      style={{
                        width: `${(c / max) * 100}%`,
                        backgroundColor: devStatusColor(s),
                      }}
                      title={`${devStatusLabel(s)} ${c}건`}
                    />
                  );
                })}
          </div>

          {/* 총 진행중(미완료) 개수 */}
          <span
            className={cn(
              "w-8 shrink-0 text-right text-sm font-semibold tabular-nums",
              total > 0 ? "text-zinc-800" : "text-zinc-300",
            )}
          >
            {total}
          </span>
        </Link>
      ))}

      {/* 범례 */}
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-zinc-100 pt-3">
        {SEGMENT_ORDER.map((s) => (
          <span key={s} className="flex items-center gap-1 text-[11px] text-zinc-500">
            <span
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: devStatusColor(s) }}
            />
            {devStatusLabel(s)}
          </span>
        ))}
      </div>
    </div>
  );
}
