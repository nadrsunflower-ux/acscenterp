"use client";

// ============================================================
//  칸반 작업 카드 — 보드 컬럼 안의 한 장
//  네이티브 HTML5 드래그(draggable + dataTransfer(taskId)).
//  클릭 시 onOpen(task) 로 상세 모달 오픈.
// ============================================================

import { KindTag, PriorityTag, FeatureChip, AssigneeStack } from "@/components/neander/dev/atoms";
import { cn } from "@/components/neander/ui";
import { isOverdue, todayStr } from "@/lib/neander/format";
import {
  DEV_STATUSES,
  checklistProgress,
  type DevStatus,
  type DevTask,
  type DevFeature,
} from "@/lib/neander/dev/types";
import type { Member } from "@/lib/neander/types";

/** "YYYY-MM-DD" -> "M/D" (카드 컴팩트 표기) */
function shortDate(d: string): string {
  const [, m, day] = d.split("-");
  return m && day ? `${Number(m)}/${Number(day)}` : d;
}

/** 마감이 며칠 지났는지 (로컬 자정 기준, 오늘=0 · 미래=음수) */
function daysLate(dueDate: string): number {
  const [y, m, d] = dueDate.split("-").map(Number);
  if (!y || !m || !d) return 0;
  const due = new Date(y, m - 1, d).getTime();
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.round((now.getTime() - due) / 86_400_000);
}

export function TaskCard({
  task,
  feature,
  members,
  onOpen,
  onChangeStatus,
  draggable = true,
}: {
  task: DevTask;
  feature?: DevFeature;
  members: Member[];
  onOpen: (task: DevTask) => void;
  /** 터치/모바일 대체 경로: 드래그 없이 상태 이동. 없으면 컨트롤 미표시. */
  onChangeStatus?: (task: DevTask, next: DevStatus) => void;
  /** 보기 전용(비로그인) 등 편집 불가 상태에서는 false — 드래그 이동 차단. */
  draggable?: boolean;
}) {
  const assignees = task.assigneeIds.map((id, i) => {
    const m = members.find((mm) => mm.id === id);
    return {
      id,
      name: m?.name ?? task.assigneeNames[i] ?? "?",
      color: m?.color,
      avatar: m?.avatar,
    };
  });

  const { done, total } = checklistProgress(task.checklist);
  // 완료된 카드는 지연/오늘 강조 없이 중립 표기 (지난 마감을 빨갛게 남기지 않음)
  const overdue = task.status !== "done" && isOverdue(task.dueDate);
  const dueToday = task.status !== "done" && !!task.dueDate && task.dueDate === todayStr();
  const allDone = total > 0 && done === total;
  // 일일업무 미러 연동 여부 (브릿지가 관리하는 dailyTaskIds 존재로 판단, 읽기 전용)
  const linkedDaily = !!task.dailyTaskIds && Object.keys(task.dailyTaskIds).length > 0;

  return (
    <article
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", task.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      onClick={() => onOpen(task)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(task);
        }
      }}
      role="button"
      tabIndex={0}
      aria-label={`작업 열기: ${task.title}`}
      className={cn(
        "group rounded-xl border border-zinc-200 bg-white p-3 shadow-sm transition hover:border-indigo-300 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-indigo-100",
        draggable ? "cursor-grab active:cursor-grabbing" : "cursor-pointer",
      )}
    >
      {/* 제목 줄 */}
      <div className="flex items-start gap-2">
        <span className="mt-0.5 shrink-0">
          <KindTag kind={task.kind} iconOnly />
        </span>
        <p className="min-w-0 flex-1 text-sm font-semibold leading-snug text-zinc-900">
          {task.title}
        </p>
        <span className="shrink-0">
          <PriorityTag priority={task.priority} compact />
        </span>
      </div>

      {/* 프로젝트 칩 + 라벨 + 일일업무 연동 배지 */}
      {(feature || task.featureName || linkedDaily || (task.labels && task.labels.length > 0)) && (
        <div className="mt-2 flex flex-wrap items-center gap-1">
          {(feature || task.featureName) && (
            <FeatureChip feature={feature} name={task.featureName} />
          )}
          {task.labels?.map((l) => (
            <span
              key={l}
              className="inline-flex items-center rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-500"
            >
              #{l}
            </span>
          ))}
          {linkedDaily && (
            <span
              className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-600"
              title="담당자의 일일업무에 자동 등록되어 대시보드 캘린더에도 표시됩니다"
            >
              📅 일일업무 연동
            </span>
          )}
        </div>
      )}

      {/* 하단 메타 */}
      <div className="mt-2.5 flex items-center gap-2">
        <AssigneeStack members={assignees} size="xs" />
        <div className="ml-auto flex items-center gap-2 text-[11px]">
          {total > 0 && (
            <span
              className={cn(
                "inline-flex items-center gap-1 font-medium tabular-nums",
                allDone ? "text-emerald-600" : "text-zinc-400",
              )}
              title="체크리스트 진행"
            >
              ☑ {done}/{total}
            </span>
          )}
          {task.dueDate &&
            (overdue ? (
              <span
                className="inline-flex items-center gap-0.5 rounded-full bg-red-100 px-1.5 py-0.5 font-semibold tabular-nums text-red-700"
                title={`마감 ${task.dueDate} — 기한이 지났습니다`}
              >
                ⏰ {daysLate(task.dueDate)}일 지남
              </span>
            ) : dueToday ? (
              <span
                className="inline-flex items-center gap-0.5 rounded-full bg-orange-100 px-1.5 py-0.5 font-semibold text-orange-700"
                title={`오늘(${task.dueDate})이 마감입니다`}
              >
                오늘
              </span>
            ) : (
              <span
                className="inline-flex items-center gap-0.5 rounded-full bg-zinc-100 px-1.5 py-0.5 font-medium tabular-nums text-zinc-500"
                title="마감일"
              >
                📅 {shortDate(task.dueDate)}
              </span>
            ))}
        </div>
      </div>

      {/* 컴팩트 상태 컨트롤(터치 대체 경로) — 드래그가 어려운 모바일에서도 상태 이동.
          카드 클릭/드래그와 충돌하지 않도록 이벤트 전파를 막는다. */}
      {onChangeStatus && (
        <div
          className="mt-2.5 border-t border-zinc-100 pt-2"
          onClick={(e) => e.stopPropagation()}
        >
          <select
            value={task.status}
            draggable={false}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
            onChange={(e) => {
              e.stopPropagation();
              const next = e.target.value as DevStatus;
              if (next !== task.status) onChangeStatus(task, next);
            }}
            aria-label={`상태 변경: ${task.title}`}
            className="w-full cursor-pointer rounded-lg border border-zinc-200 bg-zinc-50 px-2 py-1 text-[11px] font-medium text-zinc-600 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
          >
            {DEV_STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
      )}
    </article>
  );
}
