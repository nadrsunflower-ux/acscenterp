"use client";

import { useEffect, useMemo, useState } from "react";
import { useAppData } from "@/components/neander/app-data";
import {
  subscribeSchedules,
  addSchedule,
  updateSchedule,
  deleteSchedule,
} from "@/lib/neander/db/schedules";
import { emptyToUndef } from "@/lib/neander/db/helpers";
import {
  Button,
  Card,
  Field,
  Input,
  Textarea,
  PageHeader,
  Badge,
  EmptyState,
  MemberAvatar,
  cn,
} from "@/components/neander/ui";
import type { Schedule, Member } from "@/lib/neander/types";

// 대상자(팀원) 복수 선택기
function TargetPicker({
  members,
  value,
  onChange,
}: {
  members: Member[];
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  const allOn = members.length > 0 && value.length === members.length;
  function toggle(id: string) {
    onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  }
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => onChange(allOn ? [] : members.map((m) => m.id))}
        className={cn(
          "self-start rounded-full px-3 py-1 text-xs font-medium transition",
          allOn ? "bg-zinc-900 text-white" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200",
        )}
      >
        {allOn ? "전체 해제" : "전체 선택"}
      </button>
      <div className="flex flex-wrap gap-2">
        {members.map((m) => {
          const sel = value.includes(m.id);
          return (
            <button
              type="button"
              key={m.id}
              onClick={() => toggle(m.id)}
              className={cn(
                "flex items-center gap-1.5 rounded-full border py-1 pl-1 pr-2.5 transition",
                sel ? "border-indigo-500 bg-indigo-50" : "border-zinc-200 hover:bg-zinc-50",
              )}
            >
              <MemberAvatar name={m.name} color={m.color} avatar={m.avatar} className="h-6 w-6 text-xs" />
              <span className="text-xs font-medium text-zinc-700">{m.name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
import {
  todayStr,
  thisMonthStr,
  formatDateKo,
  isOverdue,
  monthGrid,
  shiftMonth,
  monthLabel,
} from "@/lib/neander/format";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

export default function SchedulePage() {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [viewMonth, setViewMonth] = useState(thisMonthStr());
  const [selectedDate, setSelectedDate] = useState(todayStr());

  useEffect(() => subscribeSchedules(setSchedules), []);

  const today = todayStr();
  const grid = useMemo(() => monthGrid(viewMonth), [viewMonth]);

  const byDate = useMemo(() => {
    const map = new Map<string, Schedule[]>();
    for (const s of schedules) {
      const arr = map.get(s.date);
      if (arr) arr.push(s);
      else map.set(s.date, [s]);
    }
    return map;
  }, [schedules]);

  const daySchedules = useMemo(
    () => [...(byDate.get(selectedDate) ?? [])].sort((a, b) => a.createdAt - b.createdAt),
    [byDate, selectedDate],
  );

  function selectDate(date: string) {
    setSelectedDate(date);
    const m = date.slice(0, 7);
    if (m !== viewMonth) setViewMonth(m);
  }

  return (
    <div>
      <PageHeader
        title="스케줄"
        description="대상자에게 공유할 일정을 등록합니다. 우측 캘린더에서 날짜별 일정을 확인·관리하세요."
      />

      <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
        {/* 좌측: 일정 등록 */}
        <ScheduleCreateForm dateValue={selectedDate} onDateChange={selectDate} />

        {/* 우측: 캘린더 + 선택일 일정 */}
        <div className="flex flex-col gap-4">
          <Card className="flex flex-col gap-3">
            <div className="flex items-center gap-1">
              <button
                onClick={() => setViewMonth(shiftMonth(viewMonth, -1))}
                className="rounded-lg px-2 py-1 text-sm text-zinc-500 hover:bg-zinc-100"
                aria-label="이전 달"
              >
                ‹
              </button>
              <span className="min-w-[110px] text-center text-sm font-semibold text-zinc-800">
                {monthLabel(viewMonth)}
              </span>
              <button
                onClick={() => setViewMonth(shiftMonth(viewMonth, 1))}
                className="rounded-lg px-2 py-1 text-sm text-zinc-500 hover:bg-zinc-100"
                aria-label="다음 달"
              >
                ›
              </button>
              <button
                onClick={() => {
                  setViewMonth(thisMonthStr());
                  setSelectedDate(today);
                }}
                className="ml-1 rounded-lg px-2 py-1 text-xs font-medium text-indigo-600 hover:bg-indigo-50"
              >
                오늘
              </button>
            </div>

            <div className="grid grid-cols-7 gap-1">
              {WEEKDAYS.map((w, i) => (
                <div
                  key={w}
                  className={cn(
                    "py-1 text-center text-xs font-medium",
                    i === 0 ? "text-red-400" : i === 6 ? "text-blue-400" : "text-zinc-400",
                  )}
                >
                  {w}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-1">
              {grid.map((date, idx) => {
                if (!date) return <div key={`e${idx}`} className="min-h-[64px] rounded-lg" />;
                const dayNum = Number(date.slice(8, 10));
                const dow = idx % 7;
                const cellItems = byDate.get(date) ?? [];
                const isSelected = date === selectedDate;
                const isToday = date === today;
                return (
                  <button
                    key={date}
                    onClick={() => selectDate(date)}
                    className={cn(
                      "flex min-h-[64px] flex-col gap-0.5 rounded-lg border p-1 text-left transition",
                      isSelected
                        ? "border-indigo-500 bg-indigo-50"
                        : "border-zinc-100 hover:border-indigo-200 hover:bg-zinc-50",
                    )}
                  >
                    <span
                      className={cn(
                        "text-xs font-medium",
                        isToday
                          ? "flex h-5 w-5 items-center justify-center rounded-full bg-indigo-600 text-white"
                          : dow === 0
                            ? "text-red-400"
                            : dow === 6
                              ? "text-blue-400"
                              : "text-zinc-600",
                      )}
                    >
                      {dayNum}
                    </span>
                    <div className="flex flex-col gap-0.5 overflow-hidden">
                      {cellItems.slice(0, 3).map((s) => (
                        <span
                          key={s.id}
                          className="flex items-center gap-1 truncate rounded bg-cyan-50 px-1 text-[10px] leading-tight text-cyan-700"
                          title={s.title}
                        >
                          <span className="truncate">{s.title}</span>
                        </span>
                      ))}
                      {cellItems.length > 3 && (
                        <span className="text-[10px] text-zinc-400">+{cellItems.length - 3}</span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </Card>

          {/* 선택일 일정 */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-zinc-800">{formatDateKo(selectedDate)} 일정</h2>
              <span className="text-xs text-zinc-400">{daySchedules.length}건</span>
            </div>
            {daySchedules.length === 0 ? (
              <EmptyState icon="🗓️" title="이 날짜에 등록된 일정이 없습니다" description="왼쪽에서 등록하세요." />
            ) : (
              daySchedules.map((s) => <ScheduleCard key={s.id} schedule={s} />)
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ScheduleCard({ schedule }: { schedule: Schedule }) {
  const { members } = useAppData();
  const [editing, setEditing] = useState(false);
  const past = isOverdue(schedule.date);

  const ids = schedule.targetIds ?? [];
  const targetMembers = ids
    .map((id) => members.find((m) => m.id === id))
    .filter((m): m is Member => Boolean(m));
  const allMembers = members.length > 0 && ids.length === members.length;

  if (editing) {
    return <ScheduleEditForm schedule={schedule} onDone={() => setEditing(false)} />;
  }

  return (
    <Card className="flex flex-col gap-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            {allMembers ? (
              <Badge color="#0891b2">🎯 전 직원</Badge>
            ) : targetMembers.length === 0 ? (
              <span className="text-xs text-zinc-400">대상자 미지정</span>
            ) : (
              targetMembers.map((m) => (
                <span
                  key={m.id}
                  className="inline-flex items-center gap-1 rounded-full bg-zinc-100 py-0.5 pl-0.5 pr-2"
                >
                  <MemberAvatar name={m.name} color={m.color} avatar={m.avatar} className="h-5 w-5 text-[10px]" />
                  <span className="text-[11px] text-zinc-600">{m.name}</span>
                </span>
              ))
            )}
            {past && <Badge color="#a1a1aa">지난 일정</Badge>}
          </div>
          <div className="mt-2 text-sm font-semibold text-zinc-900">{schedule.title}</div>
          {schedule.content && (
            <p className="mt-1 whitespace-pre-wrap text-sm text-zinc-600">{schedule.content}</p>
          )}
        </div>
        <div className="flex shrink-0 gap-1">
          <button
            onClick={() => setEditing(true)}
            className="rounded-lg px-2 py-1 text-xs font-medium text-zinc-500 hover:bg-zinc-100"
          >
            수정
          </button>
          <button
            onClick={() => {
              if (confirm("이 일정을 삭제할까요?")) deleteSchedule(schedule.id);
            }}
            className="rounded-lg px-2 py-1 text-xs font-medium text-zinc-400 hover:bg-red-50 hover:text-red-500"
          >
            삭제
          </button>
        </div>
      </div>
    </Card>
  );
}

// 생성 폼 (좌측) — 날짜는 캘린더 선택과 연동(controlled)
function ScheduleCreateForm({
  dateValue,
  onDateChange,
}: {
  dateValue: string;
  onDateChange: (d: string) => void;
}) {
  const { members } = useAppData();
  const [targetIds, setTargetIds] = useState<string[]>([]);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return alert("제목을 입력하세요.");
    if (targetIds.length === 0) return alert("대상자를 한 명 이상 선택하세요.");
    setSaving(true);
    try {
      await addSchedule({
        targetIds,
        date: dateValue,
        title: title.trim(),
        content: emptyToUndef(content),
      });
      setTargetIds([]);
      setTitle("");
      setContent("");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <h2 className="mb-4 text-sm font-semibold text-zinc-800">새 일정</h2>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="대상자" required hint="팀원을 복수 선택할 수 있습니다">
          <TargetPicker members={members} value={targetIds} onChange={setTargetIds} />
        </Field>
        <Field label="일정 날짜" required hint="캘린더에서 선택 가능">
          <Input type="date" value={dateValue} onChange={(e) => onDateChange(e.target.value)} />
        </Field>
        <Field label="제목" required>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="예: 월간 정기회의" />
        </Field>
        <Field label="내용" hint="선택 입력">
          <Textarea rows={4} value={content} onChange={(e) => setContent(e.target.value)} />
        </Field>
        <Button type="submit" disabled={saving}>
          {saving ? "저장 중…" : "일정 등록"}
        </Button>
      </form>
    </Card>
  );
}

// 수정 폼 (선택일 카드 인라인)
function ScheduleEditForm({
  schedule,
  onDone,
}: {
  schedule: Schedule;
  onDone: () => void;
}) {
  const { members } = useAppData();
  const [targetIds, setTargetIds] = useState<string[]>(schedule.targetIds ?? []);
  const [date, setDate] = useState(schedule.date);
  const [title, setTitle] = useState(schedule.title);
  const [content, setContent] = useState(schedule.content ?? "");
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return alert("제목을 입력하세요.");
    if (targetIds.length === 0) return alert("대상자를 한 명 이상 선택하세요.");
    setSaving(true);
    try {
      await updateSchedule(schedule.id, {
        targetIds,
        date,
        title: title.trim(),
        content: emptyToUndef(content),
      });
      onDone();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <h2 className="mb-4 text-sm font-semibold text-zinc-800">일정 수정</h2>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="대상자" required>
          <TargetPicker members={members} value={targetIds} onChange={setTargetIds} />
        </Field>
        <Field label="일정 날짜" required>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="제목" required>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="내용" hint="선택 입력">
          <Textarea rows={4} value={content} onChange={(e) => setContent(e.target.value)} />
        </Field>
        <div className="flex gap-2">
          <Button type="submit" disabled={saving} className="flex-1">
            {saving ? "저장 중…" : "수정 저장"}
          </Button>
          <Button type="button" variant="secondary" onClick={onDone} disabled={saving}>
            취소
          </Button>
        </div>
      </form>
    </Card>
  );
}
