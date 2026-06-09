"use client";

import { useState } from "react";
import type { Task } from "@/lib/types";
import { setTaskCheck } from "@/lib/db";
import { storeLabel } from "@/lib/content";
import Badge from "@/components/ui/Badge";

export interface CheckState {
  checked: boolean;
  note: string;
  // 관리자 확인 — 완료와 별개. true 면 노란색 + 미완료로 집계하지 않음.
  approved: boolean;
}

interface TaskChecklistProps {
  // 선택한 날짜
  date: string;
  // 그 날 해당하는 업무들
  tasks: Task[];
  // 그 날의 체크/비고 상태 (taskId -> {checked, note, approved})
  checks: Record<string, CheckState>;
  // 완료/미완료 토글 후 부모 상태 갱신 (낙관적)
  onChecked: (taskId: string, checked: boolean) => void;
  // 비고 변경 후 부모 상태 갱신
  onNote: (taskId: string, note: string) => void;
  // 관리자 확인 토글 후 부모 상태 갱신 (낙관적)
  onApproved: (taskId: string, approved: boolean) => void;
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
  onApproved,
  disabled = false,
  hideStore = false,
}: TaskChecklistProps) {
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());
  // 관리자 비밀번호 모달 상태
  const [pending, setPending] = useState<{ task: Task; approve: boolean } | null>(
    null
  );
  const [password, setPassword] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState("");

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

  // 관리자 확인/해제 — 비밀번호 모달 열기
  function openPassword(task: Task, approve: boolean) {
    if (disabled) return;
    setPending({ task, approve });
    setPassword("");
    setError("");
  }

  function closePassword() {
    setPending(null);
    setPassword("");
    setError("");
    setVerifying(false);
  }

  // 비밀번호 검증 후 관리자 확인 적용
  async function submitPassword() {
    if (!pending || verifying) return;
    setVerifying(true);
    setError("");
    try {
      const res = await fetch("/api/admin-verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        setError("비밀번호가 일치하지 않습니다.");
        setVerifying(false);
        return;
      }
      const { task, approve } = pending;
      onApproved(task.id, approve); // 낙관적 반영
      try {
        await setTaskCheck(task.id, date, {
          adminApproved: approve,
          adminApprovedAt: Date.now(),
        });
      } catch {
        onApproved(task.id, !approve); // 실패 롤백
      }
      closePassword();
    } catch {
      setError("처리 중 오류가 발생했습니다.");
      setVerifying(false);
    }
  }

  if (tasks.length === 0) {
    return (
      <p className="rounded-xl bg-gray-50 px-3 py-4 text-center text-sm text-gray-400">
        이 날 해당하는 업무가 없습니다.
      </p>
    );
  }

  return (
    <>
      <ul className="space-y-2">
        {tasks.map((task) => {
          const state = checks[task.id];
          const checked = !!state?.checked;
          const approved = !!state?.approved;
          const note = state?.note ?? "";
          const saving = savingIds.has(task.id);
          return (
            <li
              key={task.id}
              className={
                "rounded-xl border " +
                (approved
                  ? "border-amber-300 bg-amber-50"
                  : checked
                  ? "border-emerald-200 bg-emerald-50"
                  : "border-gray-200 bg-white")
              }
            >
              <div className="flex items-stretch">
                {/* 완료/미완료 + 업무명 */}
                <button
                  type="button"
                  onClick={() => toggle(task)}
                  disabled={disabled || saving}
                  className={
                    "flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5 text-left transition-colors " +
                    (checked || approved ? "" : "hover:bg-gray-50") +
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
                      {approved ? (
                        <Badge color="amber">관리자 확인</Badge>
                      ) : null}
                      <span
                        className={
                          "text-[11px] font-semibold " +
                          (approved
                            ? "text-amber-600"
                            : checked
                            ? "text-emerald-600"
                            : "text-gray-400")
                        }
                      >
                        {approved ? "관리자 확인됨" : checked ? "완료" : "미완료"}
                      </span>
                    </span>
                  </span>
                  {saving ? (
                    <span className="shrink-0 text-xs text-gray-400">저장중…</span>
                  ) : null}
                </button>

                {/* 관리자 확인 버튼 */}
                <button
                  type="button"
                  onClick={() => openPassword(task, !approved)}
                  disabled={disabled}
                  className={
                    "flex shrink-0 items-center justify-center border-l px-3 text-xs font-semibold transition-colors " +
                    (approved
                      ? "border-amber-200 text-amber-700 hover:bg-amber-100"
                      : "border-gray-200 text-gray-500 hover:bg-gray-50 hover:text-amber-600") +
                    (disabled ? " cursor-not-allowed opacity-60" : "")
                  }
                  title={
                    approved
                      ? "관리자 확인 해제 (비밀번호 필요)"
                      : "관리자 확인 (비밀번호 필요)"
                  }
                >
                  {approved ? "확인 해제" : "관리자 확인"}
                </button>
              </div>

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

      {/* 관리자 비밀번호 모달 */}
      {pending ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={closePassword}
        >
          <div
            className="w-full max-w-xs rounded-2xl bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-sm font-bold text-gray-900">
              {pending.approve ? "관리자 확인" : "관리자 확인 해제"}
            </p>
            <p className="mt-1 text-xs text-gray-500">
              <span className="font-medium text-gray-700">
                {pending.task.title}
              </span>{" "}
              업무를 {pending.approve ? "확인 처리" : "확인 해제"}하려면 관리자
              비밀번호를 입력하세요.
            </p>
            <input
              type="password"
              autoFocus
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (error) setError("");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitPassword();
                if (e.key === "Escape") closePassword();
              }}
              placeholder="관리자 비밀번호"
              className="mt-3 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand focus:ring-1 focus:ring-brand/20"
            />
            {error ? (
              <p className="mt-1.5 text-xs font-medium text-red-500">{error}</p>
            ) : null}
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={closePassword}
                disabled={verifying}
                className="rounded-lg px-3 py-1.5 text-sm font-medium text-gray-500 hover:bg-gray-100 disabled:opacity-60"
              >
                취소
              </button>
              <button
                type="button"
                onClick={submitPassword}
                disabled={verifying || password.length === 0}
                className="rounded-lg bg-amber-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-60"
              >
                {verifying ? "확인 중…" : "확인"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
