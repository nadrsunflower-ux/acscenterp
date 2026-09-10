"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarDays, Pencil, Trash2, Users } from "lucide-react";
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
  DateStepper,
  Field,
  Icon,
  IconButton,
  Input,
  Textarea,
  PageHeader,
  Badge,
  EmptyState,
  MemberAvatar,
  SectionHeader,
  useConfirm,
  useToast,
  cn,
} from "@/components/neander/ui";
import type { Schedule, Member } from "@/lib/neander/types";
import { listScheduleShifts, listEvents } from "@/lib/db";
import type { WorkShift, CalendarEvent, Store } from "@/lib/types";
import {
  todayStr,
  thisMonthStr,
  formatDateKo,
  isOverdue,
  monthGrid,
  shiftMonth,
  monthLabel,
} from "@/lib/neander/format";

// AC'SCENT 매장 라벨/색상 (아이디=보라, 와우=주황) — 매장이 가진 브랜드 색이라 그대로 둔다
const STORE_LABEL: Record<Store, string> = { id: "악센트 아이디", wow: "악센트 와우" };
const storeCellCls = (store: Store) =>
  store === "id" ? "bg-brand-light text-brand-dark" : "bg-wow-light text-wow";
// AC'SCENT 이벤트 기본 색 (데이터 기본값)
const EVENT_DEFAULT_COLOR = "#ff8a3d";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

/** 요일 글자색 — 일요일·토요일만 구분 */
const weekdayText = (i: number, base = "text-nd-fg-3") =>
  i === 0 ? "text-nd-danger" : i === 6 ? "text-nd-info" : base;

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
      <Button
        type="button"
        variant={allOn ? "primary" : "soft"}
        size="sm"
        pill
        className="self-start"
        onClick={() => onChange(allOn ? [] : members.map((m) => m.id))}
      >
        {allOn ? "전체 해제" : "전체 선택"}
      </Button>
      <div className="flex flex-wrap gap-2" role="group" aria-label="대상자">
        {members.map((m) => {
          const sel = value.includes(m.id);
          return (
            <button
              type="button"
              key={m.id}
              onClick={() => toggle(m.id)}
              aria-pressed={sel}
              className={cn(
                "flex h-8 items-center gap-1.5 rounded-full border pl-1 pr-2.5 transition-colors duration-nd-fast",
                sel ? "border-nd-accent bg-nd-accent-soft" : "border-nd-line hover:bg-nd-sunken",
              )}
            >
              <MemberAvatar name={m.name} color={m.color} avatar={m.avatar} className="h-6 w-6 text-xs" />
              <span className="text-nd-caption font-medium text-nd-fg-2">{m.name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function SchedulePage() {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [shifts, setShifts] = useState<WorkShift[]>([]);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [viewMonth, setViewMonth] = useState(thisMonthStr());
  const [selectedDate, setSelectedDate] = useState(todayStr());

  // NEANDER 팀 일정 (실시간)
  useEffect(() => subscribeSchedules(setSchedules), []);

  // 보는 달의 AC'SCENT 근무자(schedules→shifts) + 생일·이벤트 로드
  useEffect(() => {
    const from = `${viewMonth}-01`;
    const [y, m] = viewMonth.split("-").map(Number);
    const to = `${viewMonth}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`;
    let alive = true;
    Promise.all([listScheduleShifts({ from, to }), listEvents({ from, to })])
      .then(([s, e]) => {
        if (!alive) return;
        setShifts(s);
        setEvents(e);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [viewMonth]);

  const today = todayStr();
  const grid = useMemo(() => monthGrid(viewMonth), [viewMonth]);

  // 날짜별 근무자 (아이디 먼저, 와우 다음)
  const shiftsByDate = useMemo(() => {
    const map = new Map<string, WorkShift[]>();
    for (const s of shifts) {
      const arr = map.get(s.date);
      if (arr) arr.push(s);
      else map.set(s.date, [s]);
    }
    for (const arr of map.values())
      arr.sort((a, b) => (a.store === "id" ? 0 : 1) - (b.store === "id" ? 0 : 1));
    return map;
  }, [shifts]);

  // 날짜별 NEANDER 팀 일정
  const schedulesByDate = useMemo(() => {
    const map = new Map<string, Schedule[]>();
    for (const s of schedules) {
      const arr = map.get(s.date);
      if (arr) arr.push(s);
      else map.set(s.date, [s]);
    }
    return map;
  }, [schedules]);

  const eventsForDate = (date: string) =>
    events.filter((e) => e.startDate <= date && date <= e.endDate);

  const dayShifts = useMemo(
    () => [...(shiftsByDate.get(selectedDate) ?? [])],
    [shiftsByDate, selectedDate],
  );
  const dayEvents = useMemo(
    () => eventsForDate(selectedDate),
    [events, selectedDate], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const daySchedules = useMemo(
    () => [...(schedulesByDate.get(selectedDate) ?? [])].sort((a, b) => a.createdAt - b.createdAt),
    [schedulesByDate, selectedDate],
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
        description="AC'SCENT 매장 근무자와 생일·이벤트 일정을 한눈에 봅니다. 팀 일정도 등록·공유할 수 있어요."
      />

      <div className="grid gap-6 lg:grid-cols-[380px_1fr] [&>*]:min-w-0">
        {/* 좌측: 팀 일정 등록 */}
        <ScheduleCreateForm dateValue={selectedDate} onDateChange={selectDate} />

        {/* 우측: 캘린더 + 선택일 상세 */}
        <div className="flex flex-col gap-4">
          <Card padding="sm" className="flex flex-col gap-3">
            <DateStepper
              label={monthLabel(viewMonth)}
              prevLabel="이전 달"
              nextLabel="다음 달"
              onPrev={() => setViewMonth(shiftMonth(viewMonth, -1))}
              onNext={() => setViewMonth(shiftMonth(viewMonth, 1))}
              onToday={() => {
                setViewMonth(thisMonthStr());
                setSelectedDate(today);
              }}
              className="self-start"
            />

            <div className="grid grid-cols-7 gap-1">
              {WEEKDAYS.map((w, i) => (
                <div key={w} className={cn("py-1 text-center text-nd-caption font-medium", weekdayText(i))}>
                  {w}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-1">
              {grid.map((date, idx) => {
                if (!date) return <div key={`e${idx}`} className="min-h-[72px] rounded-nd-md sm:min-h-[92px]" />;
                const dayNum = Number(date.slice(8, 10));
                const dow = idx % 7;
                const cellShifts = shiftsByDate.get(date) ?? [];
                const cellEvents = eventsForDate(date);
                const hasSchedule = (schedulesByDate.get(date)?.length ?? 0) > 0;
                const isSelected = date === selectedDate;
                const isToday = date === today;
                return (
                  <button
                    key={date}
                    type="button"
                    onClick={() => selectDate(date)}
                    aria-pressed={isSelected}
                    className={cn(
                      "flex min-h-[72px] min-w-0 flex-col gap-0.5 rounded-nd-md border p-1 text-left transition-colors duration-nd-fast sm:min-h-[92px]",
                      isSelected
                        ? "border-nd-accent bg-nd-accent-soft"
                        : "border-nd-line hover:border-nd-accent/40 hover:bg-nd-sunken",
                    )}
                  >
                    <span
                      className={cn(
                        "nd-num text-nd-caption font-medium",
                        isToday
                          ? "flex h-5 w-5 items-center justify-center rounded-full bg-nd-accent text-white"
                          : weekdayText(dow, "text-nd-fg-2"),
                      )}
                    >
                      {dayNum}
                    </span>
                    {/* 근무자 (매장 색) */}
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5 overflow-hidden">
                      {cellShifts.slice(0, 4).map((s) => (
                        <span
                          key={s.id}
                          className={cn(
                            "truncate rounded-[4px] px-1 text-nd-micro font-medium leading-tight",
                            storeCellCls(s.store),
                          )}
                          title={`${STORE_LABEL[s.store]} · ${s.staffName}${s.start ? ` (${s.start}~${s.end})` : ""}`}
                        >
                          {s.staffName}
                        </span>
                      ))}
                      {cellShifts.length > 4 && (
                        <span className="nd-num text-nd-micro text-nd-fg-3">+{cellShifts.length - 4}</span>
                      )}
                    </div>
                    {/* 하단 점: 생일·이벤트 + 팀 일정 */}
                    {(cellEvents.length > 0 || hasSchedule) && (
                      <div className="mt-0.5 flex flex-wrap items-center gap-0.5">
                        {cellEvents.slice(0, 4).map((e) => (
                          <span
                            key={e.id}
                            className="inline-block h-1.5 w-1.5 rounded-full"
                            style={{ backgroundColor: e.color || EVENT_DEFAULT_COLOR }}
                            title={e.title}
                          />
                        ))}
                        {hasSchedule && (
                          <span className="inline-block h-1.5 w-1.5 rounded-full bg-nd-info" title="팀 일정" />
                        )}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>

            {/* 범례 */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-nd-micro text-nd-fg-2">
              <span className="flex items-center gap-1">
                <span className="inline-block h-2.5 w-2.5 rounded-[3px] bg-brand-light ring-1 ring-brand/30" />
                악센트 아이디
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block h-2.5 w-2.5 rounded-[3px] bg-wow-light ring-1 ring-wow/30" />
                악센트 와우
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: EVENT_DEFAULT_COLOR }} />
                생일·이벤트
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-nd-info" />
                팀 일정
              </span>
            </div>
          </Card>

          {/* 선택일 상세 */}
          <div className="flex flex-col gap-3">
            <h2 className="text-nd-section text-nd-fg">{formatDateKo(selectedDate)}</h2>

            {/* 근무자 */}
            <Card padding="sm" className="flex flex-col gap-2">
              <SectionHeader as="h3" title="근무자" hint={`${dayShifts.length}명`} className="mb-0" />
              {dayShifts.length === 0 ? (
                <p className="text-nd-body text-nd-fg-3">근무자 일정이 없습니다.</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {(["id", "wow"] as Store[]).map((store) => {
                    const list = dayShifts.filter((s) => s.store === store);
                    if (list.length === 0) return null;
                    return (
                      <div key={store} className="flex flex-col gap-1">
                        <span className="text-nd-micro font-medium text-nd-fg-3">{STORE_LABEL[store]}</span>
                        <div className="flex flex-wrap gap-1.5">
                          {list.map((s) => (
                            <span
                              key={s.id}
                              className={cn("rounded-[8px] px-2 py-1 text-nd-caption font-medium", storeCellCls(store))}
                            >
                              {s.staffName}
                              {s.start && <span className="nd-num ml-1 opacity-70">{s.start}~{s.end}</span>}
                            </span>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>

            {/* 생일·이벤트 */}
            {dayEvents.length > 0 && (
              <Card padding="sm" className="flex flex-col gap-2">
                <h3 className="text-nd-section text-nd-fg">생일·이벤트</h3>
                <ul className="flex flex-col gap-1.5">
                  {dayEvents.map((e) => (
                    <li key={e.id} className="flex flex-wrap items-center gap-2 text-nd-body">
                      <Badge color={e.color || EVENT_DEFAULT_COLOR} dot>
                        {e.title}
                      </Badge>
                      {e.memo && <span className="text-nd-caption text-nd-fg-3">· {e.memo}</span>}
                    </li>
                  ))}
                </ul>
              </Card>
            )}

            {/* 팀 일정 (NEANDER) */}
            <div className="flex flex-col gap-2">
              <SectionHeader as="h3" title="팀 일정" hint={`${daySchedules.length}건`} className="mb-0" />
              {daySchedules.length === 0 ? (
                <EmptyState
                  compact
                  icon={CalendarDays}
                  title="등록된 팀 일정이 없습니다"
                  description="왼쪽에서 등록하세요."
                />
              ) : (
                daySchedules.map((s) => <ScheduleCard key={s.id} schedule={s} />)
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ScheduleCard({ schedule }: { schedule: Schedule }) {
  const { members } = useAppData();
  const confirm = useConfirm();
  const [editing, setEditing] = useState(false);
  const past = isOverdue(schedule.date);

  const ids = schedule.targetIds ?? [];
  const targetMembers = ids
    .map((id) => members.find((m) => m.id === id))
    .filter((m): m is Member => Boolean(m));
  const allMembers = members.length > 0 && ids.length === members.length;

  async function remove() {
    if (!(await confirm({ title: "이 일정을 삭제할까요?", confirmLabel: "삭제", tone: "danger" }))) return;
    deleteSchedule(schedule.id);
  }

  if (editing) {
    return <ScheduleEditForm schedule={schedule} onDone={() => setEditing(false)} />;
  }

  return (
    <Card padding="sm" className="flex flex-col gap-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            {allMembers ? (
              <Badge tone="info">
                <Icon icon={Users} size={12} /> 전 직원
              </Badge>
            ) : targetMembers.length === 0 ? (
              <span className="text-nd-caption text-nd-fg-3">대상자 미지정</span>
            ) : (
              targetMembers.map((m) => (
                <span
                  key={m.id}
                  className="inline-flex h-6 items-center gap-1 rounded-full bg-nd-fg/[.06] pl-0.5 pr-2"
                >
                  <MemberAvatar name={m.name} color={m.color} avatar={m.avatar} className="h-5 w-5 text-[10px]" />
                  <span className="text-nd-micro text-nd-fg-2">{m.name}</span>
                </span>
              ))
            )}
            {past && <Badge tone="neutral">지난 일정</Badge>}
          </div>
          <div className="mt-2 text-nd-body font-semibold text-nd-fg">{schedule.title}</div>
          {schedule.content && (
            <p className="mt-1 whitespace-pre-wrap text-nd-body text-nd-fg-2">{schedule.content}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button variant="ghost" size="sm" icon={Pencil} onClick={() => setEditing(true)}>
            수정
          </Button>
          <IconButton icon={Trash2} label="삭제" size="sm" onClick={remove} className="hover:text-nd-danger-text" />
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
  const toast = useToast();
  const [targetIds, setTargetIds] = useState<string[]>([]);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      toast.error("제목을 입력하세요.");
      return;
    }
    if (targetIds.length === 0) {
      toast.error("대상자를 한 명 이상 선택하세요.");
      return;
    }
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
    <Card className="self-start">
      <h2 className="mb-4 text-nd-section text-nd-fg">새 일정</h2>
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
        <Button type="submit" loading={saving}>
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
  const toast = useToast();
  const [targetIds, setTargetIds] = useState<string[]>(schedule.targetIds ?? []);
  const [date, setDate] = useState(schedule.date);
  const [title, setTitle] = useState(schedule.title);
  const [content, setContent] = useState(schedule.content ?? "");
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      toast.error("제목을 입력하세요.");
      return;
    }
    if (targetIds.length === 0) {
      toast.error("대상자를 한 명 이상 선택하세요.");
      return;
    }
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
    <Card className="ring-2 ring-nd-accent/60">
      <h2 className="mb-4 text-nd-section text-nd-fg">일정 수정</h2>
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
          <Button type="submit" loading={saving} className="flex-1">
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
