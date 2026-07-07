"use client";

// ============================================================
//  작업 보드(칸반) — /neander/dev/board
//  김주연이 작업을 배분하고 개발자가 드래그로 진행 상태를 옮긴다.
//  딥링크(task/status/priority/feature/assignee/q) + 검색/필터 프리셋,
//  상태 전이 자동 진행기록, 카드 컴팩트 상태 컨트롤(터치 대체 경로).
// ============================================================

import { useEffect, useMemo, useState } from "react";
import { useAppData } from "@/components/neander/app-data";
import { useDevData } from "@/components/neander/dev/dev-data";
import { KanbanBoard } from "@/components/neander/dev/KanbanBoard";
import { TaskComposer } from "@/components/neander/dev/TaskComposer";
import { TaskDetailModal } from "@/components/neander/dev/TaskDetailModal";
import { addActivity } from "@/lib/neander/dev/activity";
import { setDevTaskStatus } from "@/lib/neander/dev/tasks";
import { Button, Input, Select } from "@/components/neander/ui";
import {
  DEV_KINDS,
  DEV_PRIORITIES,
  DEV_STATUSES,
  devStatusLabel,
  type DevStatus,
  type DevTask,
} from "@/lib/neander/dev/types";

const STATUS_VALUES = DEV_STATUSES.map((s) => s.value as string);
const PRIORITY_VALUES = DEV_PRIORITIES.map((p) => p.value as string);

export default function BoardPage() {
  const { members, currentMember } = useAppData();
  const { tasks, features, loading } = useDevData();

  const [composerOpen, setComposerOpen] = useState(false);
  const [composerStatus, setComposerStatus] = useState<DevStatus | undefined>(undefined);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pendingTaskId, setPendingTaskId] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [featureFilter, setFeatureFilter] = useState("all");
  const [assigneeFilter, setAssigneeFilter] = useState("all");
  const [kindFilter, setKindFilter] = useState("all");
  const [search, setSearch] = useState("");

  // 딥링크/필터 프리셋. ⚠️ next/navigation 의 useSearchParams 금지(정적 생성 시
  // Suspense 경계 없으면 build 깨짐) → 마운트 후 window.location 에서 직접 읽는다.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const status = p.get("status");
    if (status && STATUS_VALUES.includes(status)) setStatusFilter(status);
    const priority = p.get("priority");
    if (priority && PRIORITY_VALUES.includes(priority)) setPriorityFilter(priority);
    const feature = p.get("feature");
    if (feature) setFeatureFilter(feature);
    const assignee = p.get("assignee");
    if (assignee) setAssigneeFilter(assignee);
    const q = p.get("q");
    if (q) setSearch(q);
    const task = p.get("task");
    if (task) setPendingTaskId(task);
  }, []);

  // tasks 가 로드되어 해당 작업이 존재하면 상세 모달을 한 번 자동 오픈.
  useEffect(() => {
    if (pendingTaskId && tasks.some((t) => t.id === pendingTaskId)) {
      setSelectedId(pendingTaskId);
      setPendingTaskId(null);
    }
  }, [pendingTaskId, tasks]);

  // 모든 필터를 AND 로 적용
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tasks.filter((t) => {
      if (statusFilter !== "all" && t.status !== statusFilter) return false;
      if (priorityFilter !== "all" && t.priority !== priorityFilter) return false;
      if (featureFilter !== "all" && t.featureId !== featureFilter) return false;
      if (assigneeFilter !== "all" && !t.assigneeIds.includes(assigneeFilter)) return false;
      if (kindFilter !== "all" && t.kind !== kindFilter) return false;
      if (q) {
        const hay = `${t.title} ${t.description ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [tasks, statusFilter, priorityFilter, featureFilter, assigneeFilter, kindFilter, search]);

  // 선택 작업은 실시간 tasks 에서 다시 찾아 최신 상태 반영
  const selectedTask = useMemo(
    () => (selectedId ? tasks.find((t) => t.id === selectedId) ?? null : null),
    [selectedId, tasks],
  );

  function openComposer(status?: DevStatus) {
    setComposerStatus(status);
    setComposerOpen(true);
  }

  // 상태 '전이'가 실제로 일어날 때만 자동 진행기록(같은 상태 재정렬은 제외).
  // currentMember 없으면 기록 생략. 기록 실패는 조용히 무시 — 상태변경은 이미 진행됨.
  function recordStatusChange(task: DevTask, next: DevStatus) {
    if (task.status === next || !currentMember) return;
    addActivity({
      type: "status",
      source: "manual",
      authorId: currentMember.id,
      authorName: currentMember.name,
      taskId: task.id,
      taskTitle: task.title,
      featureId: task.featureId,
      featureName: task.featureName,
      title: `"${task.title}" 상태: ${devStatusLabel(task.status)} → ${devStatusLabel(next)}`,
    }).catch(() => {});
  }

  // 카드 컴팩트 상태 컨트롤(터치 대체 경로): 상태 이동 + 자동기록.
  // actor(currentMember)를 넘겨 일일업무 미러 동기화 + 리뷰/완료 팀 알림까지 연동.
  function changeCardStatus(task: DevTask, next: DevStatus) {
    if (task.status === next) return;
    setDevTaskStatus(task.id, next, undefined, currentMember);
    recordStatusChange(task, next);
  }

  // 활성 필터 개수(검색 포함) — 배지 표시 + 초기화 버튼 노출 조건
  const activeFilterCount = [
    statusFilter !== "all",
    priorityFilter !== "all",
    featureFilter !== "all",
    assigneeFilter !== "all",
    kindFilter !== "all",
    search.trim() !== "",
  ].filter(Boolean).length;

  function resetFilters() {
    setStatusFilter("all");
    setPriorityFilter("all");
    setFeatureFilter("all");
    setAssigneeFilter("all");
    setKindFilter("all");
    setSearch("");
  }

  return (
    <div>
      {/* 상단: 얇은 설명 한 줄 + 새 작업 (H1 은 dev layout 이 유일 — 여기선 헤더 없음) */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-zinc-500">카드를 끌어 상태를 바꾸고, 눌러서 상세를 여세요</p>
        <Button
          onClick={() => openComposer(undefined)}
          disabled={!currentMember}
          title={currentMember ? undefined : "팀원 계정으로 로그인하면 작업을 만들 수 있어요"}
        >
          ＋ 새 작업
        </Button>
      </div>

      {/* 검색 + 필터 (한 줄 wrap) + 활성 개수 배지 + 초기화 */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-zinc-400">필터</span>
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="제목·설명 검색"
          aria-label="작업 검색"
          className="!w-40 !py-1.5 !text-xs sm:!w-52"
        />
        <Select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="!w-auto !py-1.5 !text-xs"
          aria-label="상태 필터"
        >
          <option value="all">전체 상태</option>
          {DEV_STATUSES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </Select>
        <Select
          value={priorityFilter}
          onChange={(e) => setPriorityFilter(e.target.value)}
          className="!w-auto !py-1.5 !text-xs"
          aria-label="우선순위 필터"
        >
          <option value="all">전체 우선순위</option>
          {DEV_PRIORITIES.map((p) => (
            <option key={p.value} value={p.value}>
              {p.icon} {p.label}
            </option>
          ))}
        </Select>
        <Select
          value={featureFilter}
          onChange={(e) => setFeatureFilter(e.target.value)}
          className="!w-auto !py-1.5 !text-xs"
          aria-label="프로젝트 필터"
        >
          <option value="all">전체 프로젝트</option>
          {features.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </Select>
        <Select
          value={assigneeFilter}
          onChange={(e) => setAssigneeFilter(e.target.value)}
          className="!w-auto !py-1.5 !text-xs"
          aria-label="담당자 필터"
        >
          <option value="all">전체 담당자</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </Select>
        <Select
          value={kindFilter}
          onChange={(e) => setKindFilter(e.target.value)}
          className="!w-auto !py-1.5 !text-xs"
          aria-label="종류 필터"
        >
          <option value="all">전체 종류</option>
          {DEV_KINDS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.icon} {k.label}
            </option>
          ))}
        </Select>
        {activeFilterCount > 0 && (
          <>
            <span
              className="inline-flex items-center rounded-full bg-indigo-600 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-white"
              title="현재 적용 중인 검색·필터 개수"
            >
              필터 {activeFilterCount}
            </span>
            <button
              type="button"
              onClick={resetFilters}
              className="rounded-lg px-2 py-1 text-xs font-medium text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-700"
            >
              초기화
            </button>
          </>
        )}
        {!currentMember && (
          <span className="ml-auto text-xs text-zinc-400">보기 전용 — 로그인 시 편집 가능</span>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center rounded-2xl border border-dashed border-zinc-300 py-20 text-sm text-zinc-400">
          <span className="animate-pulse">보드를 불러오는 중…</span>
        </div>
      ) : (
        <KanbanBoard
          tasks={filtered}
          features={features}
          members={members}
          currentMember={currentMember}
          onOpenTask={(t) => setSelectedId(t.id)}
          onAdd={currentMember ? openComposer : undefined}
          onStatusChange={recordStatusChange}
          onCardStatusChange={currentMember ? changeCardStatus : undefined}
        />
      )}

      <TaskComposer
        open={composerOpen}
        onClose={() => setComposerOpen(false)}
        initialStatus={composerStatus}
        members={members}
        features={features}
        currentMember={currentMember}
      />

      <TaskDetailModal
        task={selectedTask}
        onClose={() => setSelectedId(null)}
        members={members}
        features={features}
      />
    </div>
  );
}
