"use client";

// ============================================================
//  작업 상세 모달 — 우측 속성 사이드바 (TaskDetailModal 전용 helper)
//  상태/우선순위/종류/프로젝트/마감/담당자 인라인 수정 + 삭제
//  + "📅 일일업무 연동" 표시(dailyTaskIds — 브릿지가 관리, 여기선 읽기만).
//  상태가 실제로 '전이'될 때만 자동 진행기록(addActivity).
//  뮤테이션은 currentMember 를 actor 로 전달(미러 동기화+팀 알림).
//  ※ TaskDetailModal.tsx 를 500줄 미만으로 유지하기 위해 분리(무회귀).
// ============================================================

import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarSync, Trash2 } from "lucide-react";
import { useAppData } from "@/components/neander/app-data";
import { updateDevTask, setDevTaskStatus, deleteDevTask } from "@/lib/neander/dev/tasks";
import { addActivity } from "@/lib/neander/dev/activity";
import { emptyToUndef } from "@/lib/neander/db/helpers";
import { FeatureChip } from "@/components/neander/dev/atoms";
import { Badge, Button, Icon, Input, Select, MemberAvatar, cn, useConfirm, type Tone } from "@/components/neander/ui";
import {
  DEV_STATUSES,
  DEV_PRIORITIES,
  DEV_KINDS,
  devStatusLabel,
  type DevKind,
  type DevPriority,
  type DevStatus,
  type DevTask,
  type DevFeature,
} from "@/lib/neander/dev/types";
import { taskStatusLabel, type Member, type TaskStatus } from "@/lib/neander/types";

/** 일일업무 상태별 배지 톤 (예정/완료/연장/보류) */
const MIRROR_TONE: Record<TaskStatus, Tone> = {
  todo: "accent",
  done: "success",
  extended: "warning",
  on_hold: "neutral",
};

export function TaskDetailSidebar({
  task,
  onClose,
  members,
  features,
}: {
  task: DevTask;
  onClose: () => void;
  members: Member[];
  features: DevFeature[];
}) {
  const { currentMember, tasks: dailyTasks } = useAppData();
  const confirm = useConfirm();
  const canEdit = !!currentMember;

  const feature = task.featureId ? features.find((f) => f.id === task.featureId) : undefined;

  // 일일업무 미러 현황 — dailyTaskIds(assigneeId→dailyTaskId)를 담당자 순서로 정리.
  const mirrors = useMemo(() => {
    const map = task.dailyTaskIds ?? {};
    return Object.entries(map)
      .map(([memberId, dailyId]) => {
        const idx = task.assigneeIds.indexOf(memberId);
        const name =
          members.find((m) => m.id === memberId)?.name ??
          (idx >= 0 ? task.assigneeNames[idx] : undefined) ??
          memberId;
        return { memberId, name, order: idx < 0 ? 99 : idx, daily: dailyTasks.find((t) => t.id === dailyId) };
      })
      .sort((a, b) => a.order - b.order);
  }, [task.dailyTaskIds, task.assigneeIds, task.assigneeNames, members, dailyTasks]);

  function setFeature(fid: string) {
    const f = features.find((x) => x.id === fid);
    updateDevTask(task.id, { featureId: f?.id, featureName: f?.name }, currentMember);
  }

  // 담당자 로컬 낙관 버퍼 — updateDevTask 가 actor+assigneeIds 패치일 때 getDoc
  // 왕복을 먼저 하므로 onSnapshot 반영이 늦다. 연속 토글이 스테일 prop 에서
  // 계산되어 배정이 유실되지 않도록, 체크리스트/라벨(TaskDetailModal)과 동일하게
  // 렌더용 state 와 최신값 ref 를 함께 둔다. 서버 확정본 변화 시 재동기화.
  const [assignees, setAssignees] = useState<{ ids: string[]; names: string[] }>({
    ids: task.assigneeIds,
    names: task.assigneeNames,
  });
  const assigneesRef = useRef(assignees);
  useEffect(() => {
    const server = { ids: task.assigneeIds, names: task.assigneeNames };
    assigneesRef.current = server;
    setAssignees(server);
  }, [task.assigneeIds, task.assigneeNames]);

  function toggleAssignee(id: string) {
    const cur = assigneesRef.current;
    const has = cur.ids.includes(id);
    const ids = has ? cur.ids.filter((x) => x !== id) : [...cur.ids, id];
    // ids 와 names 를 항상 1:1 로 유지. members 에 없는 담당자는 기존 이름 보존.
    const names = ids.map((x) => {
      const m = members.find((mm) => mm.id === x);
      return m?.name ?? cur.names[cur.ids.indexOf(x)] ?? x;
    });
    const next = { ids, names };
    assigneesRef.current = next;
    setAssignees(next);
    updateDevTask(task.id, { assigneeIds: ids, assigneeNames: names }, currentMember);
  }

  // 상태 변경: 실제 '전이'일 때만 자동 진행기록. 기록 실패는 조용히 무시.
  function changeStatus(next: DevStatus) {
    const prev = task.status;
    if (prev === next) return;
    setDevTaskStatus(task.id, next, undefined, currentMember);
    if (currentMember) {
      addActivity({
        type: "status",
        source: "manual",
        authorId: currentMember.id,
        authorName: currentMember.name,
        taskId: task.id,
        taskTitle: task.title,
        featureId: task.featureId,
        featureName: task.featureName,
        title: `"${task.title}" 상태: ${devStatusLabel(prev)} → ${devStatusLabel(next)}`,
      }).catch(() => {});
    }
  }

  return (
    <aside className="flex flex-col gap-3 lg:border-l lg:border-nd-line lg:pl-5">
      <EnumSelectRow
        label="상태"
        value={task.status}
        options={DEV_STATUSES}
        disabled={!canEdit}
        onChange={(v) => changeStatus(v as DevStatus)}
      />
      <EnumSelectRow
        label="우선순위"
        value={task.priority}
        options={DEV_PRIORITIES}
        disabled={!canEdit}
        onChange={(v) => updateDevTask(task.id, { priority: v as DevPriority }, currentMember)}
      />
      <EnumSelectRow
        label="종류"
        value={task.kind}
        options={DEV_KINDS}
        disabled={!canEdit}
        onChange={(v) => updateDevTask(task.id, { kind: v as DevKind }, currentMember)}
      />

      <SideRow label="프로젝트">
        <Select
          value={task.featureId ?? ""}
          disabled={!canEdit}
          onChange={(e) => setFeature(e.target.value)}
          size="sm"
          aria-label="프로젝트"
        >
          <option value="">연결 안 함</option>
          {features.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </Select>
        {feature && (
          <div className="mt-1.5">
            <FeatureChip feature={feature} />
          </div>
        )}
      </SideRow>

      <SideRow label="마감일">
        <Input
          type="date"
          value={task.dueDate ?? ""}
          disabled={!canEdit}
          onChange={(e) => updateDevTask(task.id, { dueDate: emptyToUndef(e.target.value) }, currentMember)}
          size="sm"
          aria-label="마감일"
        />
      </SideRow>

      <SideRow label="담당자">
        {members.length === 0 ? (
          <p className="text-nd-caption text-nd-fg-3">팀원 없음</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {members.map((m) => {
              const active = assignees.ids.includes(m.id);
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => canEdit && toggleAssignee(m.id)}
                  disabled={!canEdit}
                  aria-label={`${active ? "담당 해제" : "담당 지정"}: ${m.name}`}
                  aria-pressed={active}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full border py-0.5 pl-0.5 pr-2 text-nd-micro transition-colors duration-nd-fast disabled:opacity-60",
                    active
                      ? "border-nd-accent bg-nd-accent-soft text-nd-accent-strong"
                      : "border-nd-border bg-nd-content text-nd-fg-2 hover:bg-nd-sunken",
                  )}
                >
                  <MemberAvatar
                    name={m.name}
                    color={m.color ?? "#71717a"}
                    avatar={m.avatar}
                    className="h-4 w-4 text-[9px]"
                  />
                  {m.name}
                </button>
              );
            })}
          </div>
        )}
      </SideRow>

      {/* 일일업무 연동 현황 — dailyTaskIds 는 브릿지가 관리(읽기 전용 표시) */}
      <SideRow
        label={
          <span className="inline-flex items-center gap-1">
            <Icon icon={CalendarSync} size={12} />
            일일업무 연동
          </span>
        }
      >
        {mirrors.length === 0 ? (
          <p className="text-nd-caption leading-relaxed text-nd-fg-3">
            담당자 배정 시 일일업무·캘린더에 자동 등록됩니다.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-nd-line rounded-nd-md border border-nd-line bg-nd-sunken">
            {mirrors.map((m) => (
              <li key={m.memberId} className="flex items-center gap-2 px-2 py-1.5">
                <span className="min-w-0 flex-1 truncate text-nd-caption text-nd-fg-2" title={m.name}>
                  {m.name}
                </span>
                {m.daily?.date && (
                  <span className="nd-num shrink-0 text-nd-micro font-normal text-nd-fg-3">{m.daily.date}</span>
                )}
                <Badge size="sm" tone={m.daily ? MIRROR_TONE[m.daily.status] : "neutral"} className="font-semibold">
                  {m.daily ? taskStatusLabel(m.daily.status) : "등록됨"}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </SideRow>

      {canEdit && (
        <Button
          variant="danger"
          size="sm"
          icon={Trash2}
          onClick={async () => {
            if (
              await confirm({
                title: "이 작업을 삭제할까요?",
                message: "삭제한 작업은 되돌릴 수 없습니다.",
                confirmLabel: "삭제",
                tone: "danger",
              })
            ) {
              deleteDevTask(task.id);
              onClose();
            }
          }}
          aria-label="작업 삭제"
          className="mt-2 self-start"
        >
          작업 삭제
        </Button>
      )}
    </aside>
  );
}

function SideRow({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <span className="mb-1 block text-nd-micro font-semibold uppercase tracking-wide text-nd-fg-3">
        {label}
      </span>
      {children}
    </div>
  );
}

/** 열거형 속성(상태/우선순위/종류) 공통 Select 행 — 아이콘이 있으면 함께 표시. */
function EnumSelectRow({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly { value: string; label: string; icon?: string; color?: string }[];
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <SideRow label={label}>
      <Select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        size="sm"
        aria-label={label}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.icon ? `${o.icon} ` : ""}
            {o.label}
          </option>
        ))}
      </Select>
    </SideRow>
  );
}
