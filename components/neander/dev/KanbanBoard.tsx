"use client";

// ============================================================
//  칸반 보드 — DEV_STATUSES 5개 컬럼
//  네이티브 HTML5 드래그로 컬럼 간 이동(reorderDevTask).
//  넓은 화면은 5컬럼이 가용폭을 채우고(flex-1 + basis),
//  모바일은 가로 스크롤(overflow-x-auto), 컬럼 min-w-[300px].
// ============================================================

import { useMemo, useState } from "react";
import { TaskCard } from "@/components/neander/dev/TaskCard";
import { reorderDevTask } from "@/lib/neander/dev/tasks";
import { cn } from "@/components/neander/ui";
import {
  DEV_STATUSES,
  devPriorityRank,
  type DevStatus,
  type DevTask,
  type DevFeature,
} from "@/lib/neander/dev/types";
import type { Member } from "@/lib/neander/types";

// 컬럼 헤더 tooltip(title)용 상태 설명 — 비개발자도 이해하는 한 줄 안내
const STATUS_HINTS: Record<DevStatus, string> = {
  backlog: "아직 착수 전 — 아이디어·대기 중인 작업",
  todo: "곧 시작하기로 한 작업",
  in_progress: "지금 진행 중인 작업",
  review: "완료 후 확인(리뷰)을 기다리는 작업",
  done: "끝난 작업",
};

export function KanbanBoard({
  tasks,
  features,
  members,
  currentMember,
  onOpenTask,
  onAdd,
  onStatusChange,
  onCardStatusChange,
}: {
  tasks: DevTask[];
  features: DevFeature[];
  members: Member[];
  /** 드롭 상태 변경 시 브릿지(미러/알림)에 넘길 actor — 없으면 보기 전용(드래그 편집 차단). */
  currentMember?: Member | null;
  onOpenTask: (task: DevTask) => void;
  onAdd?: (status: DevStatus) => void;
  /** 드롭으로 컬럼(상태)이 실제로 바뀔 때만 호출(자동 진행기록용, 기록 전용). */
  onStatusChange?: (task: DevTask, next: DevStatus) => void;
  /** 카드 컴팩트 컨트롤(터치 대체 경로)의 상태 변경 콜백 — 없으면 컨트롤 미표시. */
  onCardStatusChange?: (task: DevTask, next: DevStatus) => void;
}) {
  const [dragOver, setDragOver] = useState<DevStatus | null>(null);

  const featureById = useMemo(() => {
    const m = new Map<string, DevFeature>();
    for (const f of features) m.set(f.id, f);
    return m;
  }, [features]);

  // 상태별 컬럼 그룹 + 컬럼 내 정렬(order asc → priority → createdAt desc)
  const columns = useMemo(() => {
    const map = new Map<DevStatus, DevTask[]>();
    for (const s of DEV_STATUSES) map.set(s.value, []);
    for (const t of tasks) map.get(t.status)?.push(t);
    for (const [, list] of map) {
      list.sort((a, b) => {
        const ao = a.order ?? 0;
        const bo = b.order ?? 0;
        if (ao !== bo) return ao - bo;
        const pr = devPriorityRank(a.priority) - devPriorityRank(b.priority);
        if (pr !== 0) return pr;
        return b.createdAt - a.createdAt;
      });
    }
    return map;
  }, [tasks]);

  function handleDrop(e: React.DragEvent, status: DevStatus) {
    e.preventDefault();
    setDragOver(null);
    // 보기 전용(비로그인) 게이트 — 다른 편집 경로(새 작업/카드 컨트롤)와 동일 기준.
    if (!currentMember) return;
    const id = e.dataTransfer.getData("text/plain");
    if (!id) return;
    const task = tasks.find((t) => t.id === id);
    if (!task) return;
    // 드랍한 컬럼 최상단에 배치: 현재 최소 order 보다 작게(비어있으면 Date.now()).
    const colTasks = columns.get(status) ?? [];
    const others = colTasks.filter((t) => t.id !== id);
    const newOrder = others.length ? Math.min(...others.map((t) => t.order ?? 0)) - 1 : Date.now();
    // 같은 컬럼 + 이미 최상단이면 no-op
    if (task.status === status && colTasks[0]?.id === id) return;
    reorderDevTask(id, status, newOrder, currentMember);
    // 상태가 실제로 '전이'된 경우에만 자동 진행기록(같은 컬럼 재정렬은 제외).
    if (task.status !== status) onStatusChange?.(task, status);
  }

  return (
    <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-2">
      {DEV_STATUSES.map((s) => {
        const list = columns.get(s.value) ?? [];
        const active = dragOver === s.value;
        return (
          <section
            key={s.value}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              if (dragOver !== s.value) setDragOver(s.value);
            }}
            onDragLeave={(e) => {
              // 컬럼 밖으로 나갈 때만 해제
              if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(null);
            }}
            onDrop={(e) => handleDrop(e, s.value)}
            className={cn(
              // 넓은 화면: flex-1 로 5컬럼이 가용폭을 채움 / 좁은 화면: min-w 유지 + 가로 스크롤
              "flex min-w-[300px] flex-1 basis-[300px] flex-col rounded-2xl border p-2 transition-colors",
              active
                ? "border-indigo-400 bg-indigo-50 ring-2 ring-indigo-200"
                : "border-zinc-200 bg-zinc-100/60",
            )}
          >
            {/* 컬럼 헤더 — title 로 상태 설명 tooltip 제공 */}
            <div
              className="flex cursor-help items-center gap-2 px-1.5 py-1.5"
              title={STATUS_HINTS[s.value]}
            >
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: s.color }}
              />
              <h3 className="text-sm font-semibold text-zinc-700">{s.label}</h3>
              <span className="rounded-full bg-white px-1.5 text-xs font-medium tabular-nums text-zinc-500 ring-1 ring-zinc-200">
                {list.length}
              </span>
            </div>

            {/* 카드 목록 */}
            <div className="flex flex-1 flex-col gap-2 py-1">
              {/* 드롭 위치 안내선 — 드롭하면 컬럼 최상단에 놓인다 */}
              {active && list.length > 0 && (
                <div className="h-1 shrink-0 rounded-full bg-indigo-400/70" aria-hidden />
              )}
              {list.length === 0 ? (
                <div
                  className={cn(
                    "rounded-xl border border-dashed px-2 py-6 text-center text-[11px] transition-colors",
                    active
                      ? "border-indigo-400 bg-indigo-100/60 font-medium text-indigo-600"
                      : "border-zinc-300 text-zinc-400",
                  )}
                >
                  {active ? "여기에 놓기" : "작업 없음"}
                </div>
              ) : (
                list.map((t) => (
                  <TaskCard
                    key={t.id}
                    task={t}
                    feature={t.featureId ? featureById.get(t.featureId) : undefined}
                    members={members}
                    onOpen={onOpenTask}
                    onChangeStatus={onCardStatusChange}
                    draggable={!!currentMember}
                  />
                ))
              )}
            </div>

            {/* 컬럼 하단 추가 */}
            {onAdd && (
              <button
                type="button"
                onClick={() => onAdd(s.value)}
                className="mt-1 rounded-lg px-2 py-1.5 text-left text-xs font-medium text-zinc-400 transition hover:bg-white hover:text-indigo-600"
                aria-label={`${s.label}에 작업 추가`}
              >
                ＋ 여기에 작업 추가
              </button>
            )}
          </section>
        );
      })}
    </div>
  );
}
