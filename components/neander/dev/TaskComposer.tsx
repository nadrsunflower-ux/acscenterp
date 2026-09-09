"use client";

// ============================================================
//  작업 생성 모달 — 김주연(또는 팀원 누구나)이 작업 배분
//  제목/설명은 전체폭, 종류·우선순위·프로젝트·마감은 2컬럼 배치.
//  addDevTask 로 저장(order: Date.now() 항상 포함).
//  actor(currentMember) 전달 → 담당자 있으면 일일업무 미러+팀 알림.
// ============================================================

import { useEffect, useState } from "react";
import { addDevTask } from "@/lib/neander/dev/tasks";
import { emptyToUndef } from "@/lib/neander/db/helpers";
import { Button, Dialog, Field, Input, Select, Textarea, MemberAvatar, cn } from "@/components/neander/ui";
import {
  DEV_KINDS,
  DEV_PRIORITIES,
  DEV_STATUSES,
  devKindColor,
  devPriorityColor,
  type DevKind,
  type DevPriority,
  type DevStatus,
  type DevFeature,
} from "@/lib/neander/dev/types";
import type { Member } from "@/lib/neander/types";

export function TaskComposer({
  open,
  onClose,
  initialStatus,
  members,
  features,
  currentMember,
}: {
  open: boolean;
  onClose: () => void;
  initialStatus?: DevStatus;
  members: Member[];
  features: DevFeature[];
  currentMember: Member | null;
}) {
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<DevKind>("feature");
  const [priority, setPriority] = useState<DevPriority>("medium");
  const [featureId, setFeatureId] = useState("");
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [dueDate, setDueDate] = useState("");
  // 기본 상태는 "예정" — 백로그는 일일업무 미러 대상이 아니라서(브릿지 규칙 §2.4),
  // 담당자를 배정해 만들면 곧바로 일일업무·캘린더에 뜨는 것이 기대 동작이다.
  const [status, setStatus] = useState<DevStatus>(initialStatus ?? "todo");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);

  // 열릴 때/초기 상태 변경 시 상태 컬럼 동기화
  useEffect(() => {
    if (open) setStatus(initialStatus ?? "todo");
  }, [open, initialStatus]);

  // ESC 닫기·포커스 가두기·스크롤 잠금은 Dialog 가 담당한다.

  function reset() {
    setTitle("");
    setKind("feature");
    setPriority("medium");
    setFeatureId("");
    setAssigneeIds([]);
    setDueDate("");
    setDescription("");
  }

  function toggleAssignee(id: string) {
    setAssigneeIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  const canSubmit = !!currentMember && title.trim().length > 0 && !busy;

  async function submit() {
    if (!currentMember || !title.trim()) return;
    setBusy(true);
    try {
      const feature = features.find((f) => f.id === featureId);
      const assignees = assigneeIds
        .map((id) => members.find((m) => m.id === id))
        .filter((m): m is Member => !!m);
      await addDevTask({
        title: title.trim(),
        kind,
        status,
        priority,
        featureId: feature?.id,
        featureName: feature?.name,
        assigneeIds: assignees.map((m) => m.id),
        assigneeNames: assignees.map((m) => m.name),
        reporterId: currentMember.id,
        reporterName: currentMember.name,
        dueDate: emptyToUndef(dueDate),
        description: emptyToUndef(description),
        order: Date.now(),
      }, currentMember);
      reset();
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title="새 작업 만들기"
      footer={
        currentMember ? (
          <>
            <Button variant="secondary" onClick={onClose} disabled={busy}>
              취소
            </Button>
            <Button onClick={submit} disabled={!canSubmit} loading={busy}>
              {busy ? "만드는 중…" : "작업 만들기"}
            </Button>
          </>
        ) : undefined
      }
    >
      <div>
        {!currentMember ? (
          <p className="rounded-nd-md bg-nd-sunken px-4 py-6 text-center text-nd-body text-nd-fg-2">
            작업을 만들려면 <span className="font-medium text-nd-fg">팀원 계정</span>으로 로그인하세요.
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            <Field label="제목" required>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="예: 결제 실패 시 재시도 로직 추가"
                data-autofocus
              />
            </Field>

            {/* 종류·우선순위·프로젝트·마감(+상태) — 2컬럼 배치 */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="종류">
                <div className="flex flex-wrap gap-1.5">
                  {DEV_KINDS.map((k) => {
                    const active = kind === k.value;
                    return (
                      <button
                        key={k.value}
                        type="button"
                        onClick={() => setKind(k.value)}
                        aria-pressed={active}
                        className={cn(
                          "inline-flex h-ctl-sm items-center gap-1 rounded-[8px] border px-2.5 text-[13px] font-medium transition-colors duration-nd-fast",
                          active ? "text-white" : "border-nd-border bg-nd-content text-nd-fg-2 hover:bg-nd-sunken",
                        )}
                        style={active ? { backgroundColor: devKindColor(k.value), borderColor: devKindColor(k.value) } : undefined}
                      >
                        <span>{k.icon}</span>
                        {k.label}
                      </button>
                    );
                  })}
                </div>
              </Field>

              <Field label="우선순위">
                <div className="flex flex-wrap gap-1.5">
                  {DEV_PRIORITIES.map((p) => {
                    const active = priority === p.value;
                    return (
                      <button
                        key={p.value}
                        type="button"
                        onClick={() => setPriority(p.value)}
                        aria-pressed={active}
                        className={cn(
                          "inline-flex h-ctl-sm items-center gap-1 rounded-[8px] border px-2.5 text-[13px] font-medium transition-colors duration-nd-fast",
                          active ? "text-white" : "border-nd-border bg-nd-content text-nd-fg-2 hover:bg-nd-sunken",
                        )}
                        style={active ? { backgroundColor: devPriorityColor(p.value), borderColor: devPriorityColor(p.value) } : undefined}
                      >
                        <span>{p.icon}</span>
                        {p.label}
                      </button>
                    );
                  })}
                </div>
              </Field>

              <Field label="프로젝트">
                <Select value={featureId} onChange={(e) => setFeatureId(e.target.value)}>
                  <option value="">연결 안 함</option>
                  {features.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label="마감일" hint="선택 입력">
                <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              </Field>

              <Field label="상태(컬럼)">
                <Select value={status} onChange={(e) => setStatus(e.target.value as DevStatus)}>
                  {DEV_STATUSES.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            {/* 담당자 다중 토글 */}
            <Field
              label="담당자"
              hint={
                status === "backlog"
                  ? "여러 명 선택 가능 · 백로그 상태에선 일일업무에 등록되지 않아요 (예정으로 옮기면 자동 등록)"
                  : "여러 명 선택 가능 · 배정 시 일일업무·캘린더에 자동 등록"
              }
            >
              {members.length === 0 ? (
                <p className="text-nd-caption text-nd-fg-3">등록된 팀원이 없습니다.</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {members.map((m) => {
                    const active = assigneeIds.includes(m.id);
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => toggleAssignee(m.id)}
                        aria-pressed={active}
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-full border py-1 pl-1 pr-2.5 text-nd-caption font-medium transition-colors duration-nd-fast",
                          active
                            ? "border-nd-accent bg-nd-accent-soft text-nd-accent-strong"
                            : "border-nd-border bg-nd-content text-nd-fg-2 hover:bg-nd-sunken",
                        )}
                      >
                        <MemberAvatar
                          name={m.name}
                          color={m.color ?? "#71717a"}
                          avatar={m.avatar}
                          className="h-5 w-5 text-[10px]"
                        />
                        {m.name}
                      </button>
                    );
                  })}
                </div>
              )}
            </Field>

            <Field label="설명" hint="선택 입력">
              <Textarea
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="배경, 요구사항, 완료 조건 등"
              />
            </Field>
          </div>
        )}
      </div>
    </Dialog>
  );
}
