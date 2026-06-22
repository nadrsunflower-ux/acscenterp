"use client";

import { useEffect, useMemo, useState } from "react";
import { useAppData } from "@/components/neander/app-data";
import {
  subscribeMeetings,
  addMeeting,
  updateMeeting,
  deleteMeeting,
} from "@/lib/neander/db/meetings";
import { addTask, updateTask } from "@/lib/neander/db/tasks";
import { emptyToUndef } from "@/lib/neander/db/helpers";
import {
  Button,
  Card,
  Field,
  Input,
  Select,
  Textarea,
  PageHeader,
  Badge,
  EmptyState,
} from "@/components/neander/ui";
import type { Meeting, ActionItem } from "@/lib/neander/types";
import { todayStr, formatDateKo } from "@/lib/neander/format";

interface ActionDraft {
  key: string;
  id?: string; // 기존 액션플랜 id (수정 시)
  taskId?: string; // 연결된 일일업무 id (수정 시)
  text: string;
  assigneeId: string;
  dueDate: string;
}

let _seq = 0;
function newDraft(): ActionDraft {
  _seq += 1;
  return { key: `d${_seq}`, text: "", assigneeId: "", dueDate: "" };
}
function draftsFromMeeting(m: Meeting): ActionDraft[] {
  const ds = m.actionItems.map((a) => {
    _seq += 1;
    return {
      key: `e${_seq}`,
      id: a.id,
      taskId: a.taskId,
      text: a.text,
      assigneeId: a.assigneeId,
      dueDate: a.dueDate ?? "",
    };
  });
  return ds.length ? ds : [newDraft()];
}

export default function MeetingsPage() {
  const { members } = useAppData();
  const [meetings, setMeetings] = useState<Meeting[]>([]);

  useEffect(() => subscribeMeetings(setMeetings), []);

  const memberColor = useMemo(() => {
    const map = new Map<string, string>();
    members.forEach((m) => map.set(m.id, m.color ?? "#71717a"));
    return (id: string) => map.get(id) ?? "#71717a";
  }, [members]);

  return (
    <div>
      <PageHeader
        title="회의록"
        description="회의 내용을 정리하고, 우선순위 액션플랜을 담당자·마감기한과 함께 기록합니다. 담당자가 지정된 액션플랜은 해당 담당자의 일일업무에 자동 등록됩니다."
      />

      <div className="grid gap-6 lg:grid-cols-[420px_1fr]">
        <MeetingEditor members={members} />

        <div className="flex flex-col gap-3">
          {meetings.length === 0 ? (
            <EmptyState icon="📝" title="작성된 회의록이 없습니다" description="왼쪽에서 새 회의록을 작성하세요." />
          ) : (
            meetings.map((m) => (
              <MeetingCard key={m.id} meeting={m} members={members} memberColor={memberColor} />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function MeetingCard({
  meeting,
  members,
  memberColor,
}: {
  meeting: Meeting;
  members: { id: string; name: string }[];
  memberColor: (id: string) => string;
}) {
  const [editing, setEditing] = useState(false);

  async function remove() {
    if (!confirm("이 회의록을 삭제할까요? (이미 등록된 일일업무는 그대로 유지됩니다)")) return;
    await deleteMeeting(meeting.id);
  }

  if (editing) {
    return <MeetingEditor members={members} initial={meeting} onDone={() => setEditing(false)} />;
  }

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge color="#6366f1">{formatDateKo(meeting.date)}</Badge>
            {meeting.title && (
              <span className="text-sm font-semibold text-zinc-900">{meeting.title}</span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 gap-1">
          <button
            onClick={() => setEditing(true)}
            className="rounded-lg px-2 py-1 text-xs font-medium text-zinc-500 hover:bg-zinc-100"
          >
            수정
          </button>
          <button
            onClick={remove}
            className="rounded-lg px-2 py-1 text-xs font-medium text-zinc-400 hover:bg-red-50 hover:text-red-500"
            aria-label="삭제"
          >
            삭제
          </button>
        </div>
      </div>

      {meeting.content && (
        <p className="whitespace-pre-wrap text-sm text-zinc-700">{meeting.content}</p>
      )}

      {meeting.actionItems.length > 0 && (
        <div className="flex flex-col gap-2 border-t border-zinc-100 pt-3">
          <span className="text-xs font-semibold text-zinc-500">우선순위 액션플랜</span>
          <ol className="flex flex-col gap-2">
            {meeting.actionItems.map((a, i) => (
              <li key={a.id} className="flex items-start gap-2 text-sm">
                <span className="mt-0.5 w-4 shrink-0 text-center text-xs font-bold text-zinc-400">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <span className="text-zinc-800">{a.text}</span>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-400">
                    {a.assigneeName ? (
                      <Badge color={memberColor(a.assigneeId)}>{a.assigneeName}</Badge>
                    ) : (
                      <span className="text-zinc-400">담당자 미지정</span>
                    )}
                    {a.dueDate && <span>· 마감 {formatDateKo(a.dueDate)}</span>}
                    {a.taskId && <span className="text-emerald-500">· ✅ 일일업무 등록됨</span>}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}
    </Card>
  );
}

function MeetingEditor({
  members,
  initial,
  onDone,
}: {
  members: { id: string; name: string }[];
  initial?: Meeting;
  onDone?: () => void;
}) {
  const isEdit = Boolean(initial);
  const [date, setDate] = useState(initial?.date ?? todayStr());
  const [title, setTitle] = useState(initial?.title ?? "");
  const [content, setContent] = useState(initial?.content ?? "");
  const [drafts, setDrafts] = useState<ActionDraft[]>(
    initial ? draftsFromMeeting(initial) : [newDraft()],
  );
  const [saving, setSaving] = useState(false);

  function updateDraft(key: string, patch: Partial<ActionDraft>) {
    setDrafts((ds) => ds.map((d) => (d.key === key ? { ...d, ...patch } : d)));
  }
  function addRow() {
    setDrafts((ds) => [...ds, newDraft()]);
  }
  function removeRow(key: string) {
    setDrafts((ds) => (ds.length === 1 ? ds : ds.filter((d) => d.key !== key)));
  }

  function resetForCreate() {
    setTitle("");
    setContent("");
    setDrafts([newDraft()]);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!content.trim() && drafts.every((d) => !d.text.trim())) {
      return alert("회의 내용 또는 액션플랜을 하나 이상 입력하세요.");
    }
    setSaving(true);
    try {
      const items: ActionItem[] = [];
      let idx = 0;
      for (const d of drafts) {
        if (!d.text.trim()) continue;
        idx += 1;
        const assignee = members.find((m) => m.id === d.assigneeId);
        const dueDate = emptyToUndef(d.dueDate);
        const text = d.text.trim();

        // 담당자가 지정된 액션플랜 → 일일업무 동기화
        let taskId = d.taskId;
        if (assignee) {
          if (taskId) {
            await updateTask(taskId, {
              memberId: assignee.id,
              memberName: assignee.name,
              date: dueDate || date,
              title: text,
            });
          } else {
            taskId = await addTask({
              memberId: assignee.id,
              memberName: assignee.name,
              date: dueDate || date,
              category: "etc",
              title: text,
              detail: `회의록(${date}) 액션플랜`,
              status: "todo",
            });
          }
        }

        // undefined 필드는 넣지 않는다 (Firestore는 배열 내부 undefined 거부)
        const item: ActionItem = {
          id: d.id ?? `${Date.now().toString(36)}-${idx}`,
          text,
          assigneeId: assignee?.id ?? "",
          assigneeName: assignee?.name ?? "",
        };
        if (dueDate) item.dueDate = dueDate;
        if (taskId) item.taskId = taskId;
        items.push(item);
      }

      const payload = {
        date,
        title: emptyToUndef(title),
        content: content.trim(),
        actionItems: items,
      };

      if (isEdit && initial) {
        await updateMeeting(initial.id, payload);
        onDone?.();
      } else {
        await addMeeting(payload);
        resetForCreate();
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <h2 className="mb-4 text-sm font-semibold text-zinc-800">{isEdit ? "회의록 수정" : "새 회의록"}</h2>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="회의 날짜" required>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="제목" hint="선택 입력">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="예: 6월 정기회의" />
          </Field>
        </div>

        <Field label="회의 내용 정리">
          <Textarea
            rows={5}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="논의 사항, 결정 사항 등을 정리하세요."
          />
        </Field>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-zinc-700">우선순위 액션플랜</span>
            <span className="text-xs text-zinc-400">위에서부터 높은 우선순위</span>
          </div>

          <div className="flex flex-col gap-3">
            {drafts.map((d, i) => (
              <div key={d.key} className="rounded-lg border border-zinc-200 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-semibold text-zinc-400">
                    #{i + 1}
                    {d.taskId && <span className="ml-1 text-emerald-500">· 일일업무 연결됨</span>}
                  </span>
                  {drafts.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeRow(d.key)}
                      className="text-xs text-zinc-300 hover:text-red-500"
                      aria-label="액션플랜 삭제"
                    >
                      ✕
                    </button>
                  )}
                </div>
                <Input
                  value={d.text}
                  onChange={(e) => updateDraft(d.key, { text: e.target.value })}
                  placeholder="액션 내용 (예: 신상품 입고 일정 확정)"
                  className="mb-2"
                />
                <div className="grid grid-cols-2 gap-2">
                  <Select
                    value={d.assigneeId}
                    onChange={(e) => updateDraft(d.key, { assigneeId: e.target.value })}
                  >
                    <option value="">담당자 (선택)</option>
                    {members.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </Select>
                  <Input
                    type="date"
                    value={d.dueDate}
                    onChange={(e) => updateDraft(d.key, { dueDate: e.target.value })}
                  />
                </div>
              </div>
            ))}
          </div>

          <Button type="button" variant="ghost" className="self-start !px-2 !py-1 !text-xs" onClick={addRow}>
            + 액션플랜 추가
          </Button>
          <p className="text-xs text-zinc-400">
            담당자를 지정한 항목은 저장 시 해당 담당자의 일일업무(마감일 또는 회의 날짜)에 자동 등록·갱신됩니다.
          </p>
        </div>

        <div className="flex gap-2">
          <Button type="submit" disabled={saving} className="flex-1">
            {saving ? "저장 중…" : isEdit ? "수정 저장" : "회의록 저장"}
          </Button>
          {isEdit && (
            <Button type="button" variant="secondary" onClick={onDone} disabled={saving}>
              취소
            </Button>
          )}
        </div>
      </form>
    </Card>
  );
}
