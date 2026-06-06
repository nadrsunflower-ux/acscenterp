"use client";

import { useState } from "react";
import type { Task } from "@/lib/types";
import { setTaskCheck } from "@/lib/db";
import { storeLabel } from "@/lib/content";
import Badge from "@/components/ui/Badge";

export interface CheckState {
  checked: boolean;
  note: string;
}

interface TaskChecklistProps {
  // 선택한 날짜
  date: string;
  // 그 날 해당하는 업무들
  tasks: Task[];
  // 그 날의 체크/비고 상태 (taskId -> {checked, note})
  checks: Record<string, CheckState>;
  // 완료/미완료 토글 후 부모 상태 갱신 (낙관적)
  onChecked: (taskId: string, checked: boolean) => void;
  // 비고 변경 후 부모 상태 갱신
  onNote: (taskId: string, note: string) => void;
  // Firebase 미설정 여부(저장 불가)
  disabled?: boolean;
  // 매장 뱃지 숨김(매장별 그룹 안에서 중복 방지)
  hideStore?: boolean;
}

const RECURRENCE_LABEL: Record<string, string> = {
  daily: "매일",
  weekly: "매주",
  monthly: "매월",
};

export default function TaskChecklist({
  date,
  tasks,
  checks,
  onChecked,
  onNote,
  disabled = false,
  hideStore = false,
}: TaskChecklistProps) {
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());

  async function toggle(task: Task) {
    if (disabled) return;
    const next = !checks[task.id]?.checked;
    onChecked(task.id, next); // 낙관적 반영
    setSavingIds((prev) => new Set(prev).add(task.id));
    try {
      await setTaskCheck(task.id, date, { checked: next });
    } catch {
      onChecked(task.id, !next); // 실패 롤백
    } finally {
      setSavingIds((prev) => {
        const n = new Set(prev);
        n.delete(task.id);
        return n;
      });
    }
  }

  function saveNote(task: Task) {
    if (disabled) return;
    void setTaskCheck(task.id, date, {
      note: (checks[task.id]?.note ?? "").trim(),
    }).catch(() => {});
  }

  if (tasks.length === 0) {
    return (
      <p className="rounded-xl bg-gray-50 px-3 py-4 text-center text-sm text-gray-400">
        이 날 해당하는 업무가 없습니다.
      </p>
    );
  }

  return (
    <ul className="space-y-2">
      {tasks.map((task) => {
        const state = checks[task.id];
        const checked = !!state?.checked;
        const note = state?.note ?? "";
        const saving = savingIds.has(task.id);
        return (
          <li
            key={task.id}
            className={
              "rounded-xl border " +
              (checked ? "border-emerald-200 bg-emerald-50" : "border-gray-200 bg-white")
            }
          >
            {/* 완료/미완료 + 업무명 */}
            <button
              type="button"
              onClick={() => toggle(task)}
              disabled={disabled || saving}
              className={
                "flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors " +
                (checked ? "" : "hover:bg-gray-50") +
                (disabled ? " cursor-not-allowed opacity-60" : "")
              }
              aria-pressed={checked}
            >
              <span
                className={
                  "flex h-5 w-5 shrink-0 items-center justify-center rounded-md border text-xs " +
                  (checked
                    ? "border-emerald-500 bg-emerald-500 text-white"
                    : "border-gray-300 bg-white text-transparent")
                }
                aria-hidden
              >
                {checked ? "✓" : ""}
              </span>
              <span className="min-w-0 flex-1">
                <span
                  className={
                    "block text-sm font-medium " +
                    (checked ? "text-gray-400 line-through" : "text-gray-900")
                  }
                >
                  {task.title}
                </span>
                {task.description ? (
                  <span
                    className={
                      "mt-0.5 block whitespace-pre-wrap text-xs " +
                      (checked ? "text-gray-300" : "text-gray-500")
                    }
                  >
                    {task.description}
                  </span>
                ) : null}
                <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
                  {!hideStore ? (
                    <Badge color={task.store === "id" ? "brand" : "orange"}>
                      {storeLabel[task.store]}
                    </Badge>
                  ) : null}
                  {task.type === "recurring" && task.recurrence ? (
                    <Badge color="gray">
                      {RECURRENCE_LABEL[task.recurrence] ?? "주기"}
                    </Badge>
                  ) : null}
                  <span
                    className={
                      "text-[11px] font-semibold " +
                      (checked ? "text-emerald-600" : "text-gray-400")
                    }
                  >
                    {checked ? "완료" : "미완료"}
                  </span>
                </span>
              </span>
              {saving ? (
                <span className="shrink-0 text-xs text-gray-400">저장중…</span>
              ) : null}
            </button>

            {/* 비고/사유 */}
            <div className="px-3 pb-2.5">
              <input
                className="w-full rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs outline-none focus:border-brand focus:ring-1 focus:ring-brand/20"
                value={note}
                placeholder="비고/사유 (예: 미완료 사유, 인수인계 등)"
                disabled={disabled}
                onChange={(e) => onNote(task.id, e.target.value)}
                onBlur={() => saveNote(task)}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
