"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import Link from "next/link";
import { ArrowUpRight, Check, ClipboardCheck, Puzzle, Trash2, X } from "lucide-react";
import { useAppData } from "@/components/neander/app-data";
import {
  addTask,
  setTaskStatus,
  setTaskExtended,
  deleteTask,
  updateTask,
} from "@/lib/neander/db/tasks";
import { emptyToUndef } from "@/lib/neander/db/helpers";
import { MailChip } from "@/components/neander/mail/MailChip";
import {
  Button,
  Card,
  Checkbox,
  DateStepper,
  Field,
  IconButton,
  Icon,
  Input,
  Select,
  SegmentedControl,
  Textarea,
  EmptyState,
  Badge,
  CategoryPicker,
  useConfirm,
  useToast,
  cn,
} from "@/components/neander/ui";
import {
  TASK_STATUSES,
  TASK_CATEGORIES,
  taskCategoryLabel,
  taskCategoryColor,
  type TaskStatus,
  type TaskCategory,
  type DailyTask,
} from "@/lib/neander/types";
import {
  todayStr,
  thisMonthStr,
  formatDateKo,
  monthGrid,
  shiftMonth,
  monthLabel,
  weekDatesOf,
  weekLabelOf,
  addDays,
} from "@/lib/neander/format";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

/** 요일 글자색 — 일요일·토요일만 구분 */
const weekdayText = (i: number, base = "text-nd-fg-3") =>
  i === 0 ? "text-nd-danger" : i === 6 ? "text-nd-info" : base;

// 시작~종료 기간에서 선택한 요일(0=일~6=토)에 해당하는 날짜들
function datesByWeekday(start: string, end: string, weekdays: Set<number>): string[] {
  const out: string[] = [];
  if (!start || !end || end < start || weekdays.size === 0) return out;
  let cur = start;
  let guard = 0;
  while (cur <= end && guard < 400) {
    const [y, m, d] = cur.split("-").map(Number);
    if (weekdays.has(new Date(y, m - 1, d).getDay())) out.push(cur);
    cur = addDays(cur, 1);
    guard += 1;
  }
  return out;
}

const isExtended = (t: DailyTask) => t.status === "extended";
const isStruck = (t: DailyTask) => t.status === "done" || t.status === "on_hold";

// 상태 필터 세그먼트 (전체 + 4개 상태)
type StatusFilter = TaskStatus | "all";
const STATUS_TABS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "todo", label: "예정" },
  { value: "done", label: "완료" },
  { value: "extended", label: "연장" },
  { value: "on_hold", label: "보류" },
];

export default function TasksPage() {
  const { tasks, members, currentMember } = useAppData();

  const today = todayStr();
  const [viewMode, setViewMode] = useState<"week" | "month">("month"); // 월간 기본, 주간은 선택
  const [weekAnchor, setWeekAnchor] = useState(today); // 주간 스트립에 표시할 주(그 주의 한 날짜)
  const [viewMonth, setViewMonth] = useState(thisMonthStr());
  const [selectedDate, setSelectedDate] = useState(today);
  const [memberFilter, setMemberFilter] = useState(currentMember?.id ?? "all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  // 담당자 필터 적용
  const scoped = useMemo(
    () => tasks.filter((t) => memberFilter === "all" || t.memberId === memberFilter),
    [tasks, memberFilter],
  );

  const byDate = useMemo(() => {
    const map = new Map<string, DailyTask[]>();
    for (const t of scoped) {
      const arr = map.get(t.date);
      if (arr) arr.push(t);
      else map.set(t.date, [t]);
    }
    return map;
  }, [scoped]);

  // 선택일 업무 (상태 필터 적용)
  const dayTasks = useMemo(() => {
    const list = [...(byDate.get(selectedDate) ?? [])].sort((a, b) => b.createdAt - a.createdAt);
    return statusFilter === "all" ? list : list.filter((t) => t.status === statusFilter);
  }, [byDate, selectedDate, statusFilter]);

  const weekDays = useMemo(() => weekDatesOf(weekAnchor), [weekAnchor]);
  const grid = useMemo(() => monthGrid(viewMonth), [viewMonth]);

  function selectDate(date: string) {
    setSelectedDate(date);
    setWeekAnchor(date);
    const m = date.slice(0, 7);
    if (m !== viewMonth) setViewMonth(m);
  }

  function toggleMode() {
    if (viewMode === "week") {
      setViewMonth(selectedDate.slice(0, 7));
      setViewMode("month");
    } else {
      setWeekAnchor(selectedDate);
      setViewMode("week");
    }
  }

  return (
    <div>
      {/* 인사 헤더 */}
      <div className="mb-4">
        <h1 className="text-nd-display text-nd-fg">
          {currentMember ? `안녕하세요, ${currentMember.name}님 ` : "일일업무 "}
          <span className="align-middle">👋</span>
        </h1>
        <p className="mt-1 text-nd-body text-nd-fg-2">오늘도 좋은 하루 되세요!</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[360px_1fr] lg:gap-6 [&>*]:min-w-0">
        {/* 좌측: 업무 등록 */}
        <TaskForm me={currentMember} date={selectedDate} onDateChange={selectDate} />

        {/* 우측: 날짜 선택 + 상태 탭 + 목록 */}
        <div className="flex flex-col gap-3 sm:gap-4">
          {/* 날짜 카드 (주간 스트립 / 월 달력 토글) */}
          <Card
            padding="sm"
            style={{ ["--cal-cell" as string]: "clamp(44px, 6.8vh, 66px)" } as CSSProperties}
          >
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <DateStepper
                size="sm"
                icon={false}
                label={viewMode === "week" ? weekLabelOf(weekAnchor) : monthLabel(viewMonth)}
                onPrev={() =>
                  viewMode === "week"
                    ? setWeekAnchor(addDays(weekAnchor, -7))
                    : setViewMonth(shiftMonth(viewMonth, -1))
                }
                onNext={() =>
                  viewMode === "week"
                    ? setWeekAnchor(addDays(weekAnchor, 7))
                    : setViewMonth(shiftMonth(viewMonth, 1))
                }
              />
              <div className="flex items-center gap-2">
                <Select
                  size="sm"
                  value={memberFilter}
                  onChange={(e) => setMemberFilter(e.target.value)}
                  className="!w-28"
                  aria-label="담당자 필터"
                >
                  <option value="all">전체 담당자</option>
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </Select>
                <SegmentedControl<"week" | "month">
                  size="sm"
                  ariaLabel="보기 단위"
                  value={viewMode}
                  onChange={(v) => {
                    if (v !== viewMode) toggleMode();
                  }}
                  options={[
                    { value: "week", label: "주" },
                    { value: "month", label: "월" },
                  ]}
                />
              </div>
            </div>

            {viewMode === "week" ? (
              /* 주간 스트립 */
              <div className="grid grid-cols-7 gap-1 rounded-nd-lg bg-nd-sunken p-1.5">
                {weekDays.map((d, i) => {
                  const dayNum = Number(d.slice(8, 10));
                  const count = (byDate.get(d) ?? []).length;
                  const selected = d === selectedDate;
                  const isToday = d === today;
                  return (
                    <button
                      key={d}
                      type="button"
                      onClick={() => selectDate(d)}
                      aria-pressed={selected}
                      className={cn(
                        "flex flex-col items-center gap-1 rounded-nd-md py-2.5 transition-colors duration-nd-fast",
                        selected ? "bg-nd-content shadow-nd-card" : "hover:bg-nd-content/60",
                      )}
                    >
                      <span className={cn("text-nd-micro font-medium", weekdayText(i))}>{WEEKDAYS[i]}</span>
                      <span
                        className={cn(
                          "nd-num text-base font-bold",
                          selected ? "text-nd-fg" : isToday ? "text-nd-accent-strong" : "text-nd-fg-3",
                        )}
                      >
                        {dayNum}
                      </span>
                      <span
                        className={cn(
                          "h-1 w-1 rounded-full",
                          count > 0 ? (selected ? "bg-nd-accent" : "bg-nd-fg-4") : "bg-transparent",
                        )}
                      />
                    </button>
                  );
                })}
              </div>
            ) : (
              /* 월 달력 — 분류별(스모트/아이디/와우/기타) 업무 갯수 표시 */
              <div>
                <div className="grid grid-cols-7 gap-1">
                  {WEEKDAYS.map((w, i) => (
                    <div key={w} className={cn("py-1 text-center text-nd-caption font-medium", weekdayText(i))}>
                      {w}
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-7 gap-1">
                  {grid.map((date, idx) => {
                    if (!date)
                      return (
                        <div key={`e${idx}`} className="min-h-[var(--cal-cell)] rounded-nd-md" />
                      );
                    const dayNum = Number(date.slice(8, 10));
                    const dow = idx % 7;
                    const cellTasks = byDate.get(date) ?? [];
                    const selected = date === selectedDate;
                    const isToday = date === today;
                    // 분류별 업무 갯수 집계
                    const counts: Record<TaskCategory, number> = { smoat: 0, id: 0, wow: 0, dev: 0, etc: 0 };
                    for (const t of cellTasks) counts[t.category] = (counts[t.category] ?? 0) + 1;
                    const activeCats = TASK_CATEGORIES.filter((c) => counts[c.value] > 0);
                    return (
                      <button
                        key={date}
                        type="button"
                        onClick={() => selectDate(date)}
                        aria-pressed={selected}
                        className={cn(
                          "flex min-h-[var(--cal-cell)] min-w-0 flex-col gap-1 rounded-nd-md border p-1 text-left transition-colors duration-nd-fast",
                          selected ? "border-nd-accent bg-nd-accent-soft" : "border-nd-line hover:bg-nd-sunken",
                        )}
                      >
                        <span
                          className={cn(
                            "nd-num text-nd-caption font-medium leading-none",
                            isToday
                              ? "flex h-5 w-5 items-center justify-center rounded-full bg-nd-accent text-white"
                              : weekdayText(dow, "text-nd-fg-2"),
                          )}
                        >
                          {dayNum}
                        </span>
                        {activeCats.length > 0 && (
                          <div className="mt-auto flex flex-wrap gap-0.5 overflow-hidden">
                            {activeCats.map((c) => (
                              <span
                                key={c.value}
                                className="nd-num flex items-center gap-0.5 rounded-[4px] px-1 py-px text-nd-micro font-semibold leading-none"
                                style={{ backgroundColor: `${c.color}1f`, color: c.color }}
                                title={`${c.label} ${counts[c.value]}건`}
                              >
                                <span
                                  className="h-1 w-1 shrink-0 rounded-full"
                                  style={{ backgroundColor: c.color }}
                                />
                                {c.label.slice(0, 1)}
                                {counts[c.value]}
                              </span>
                            ))}
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
                {/* 분류 색상 범례 */}
                <div className="mt-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-t border-nd-line pt-2">
                  {TASK_CATEGORIES.map((c) => (
                    <span key={c.value} className="flex items-center gap-1 text-nd-micro text-nd-fg-2">
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: c.color }} />
                      {c.label}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </Card>

          {/* 상태 세그먼트 탭 */}
          <div className="nd-scroll overflow-x-auto">
            <SegmentedControl<StatusFilter>
              ariaLabel="상태 필터"
              value={statusFilter}
              onChange={setStatusFilter}
              options={STATUS_TABS}
            />
          </div>

          {/* 선택일 업무 목록 */}
          <Card padding="none" className="overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3">
              <h2 className="text-nd-section text-nd-fg">{formatDateKo(selectedDate)}</h2>
              <span className="nd-num text-nd-caption text-nd-fg-3">{dayTasks.length}건</span>
            </div>
            {dayTasks.length === 0 ? (
              <div className="px-4 pb-6 pt-1">
                <EmptyState
                  compact
                  icon={ClipboardCheck}
                  title="표시할 업무가 없습니다"
                  description="왼쪽에서 등록하거나 필터를 바꿔보세요."
                />
              </div>
            ) : (
              <ul className="divide-y divide-nd-line border-t border-nd-line">
                {dayTasks.map((t) => (
                  <TaskRow key={t.id} task={t} members={members} onMoved={selectDate} />
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

function TaskRow({
  task,
  members,
  onMoved,
}: {
  task: DailyTask;
  members: { id: string; name: string }[];
  onMoved?: (date: string) => void;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const [editing, setEditing] = useState(false);
  const [picking, setPicking] = useState(false);
  const [extDate, setExtDate] = useState("");

  const [title, setTitle] = useState(task.title);
  const [detail, setDetail] = useState(task.detail ?? "");
  const [memberId, setMemberId] = useState(task.memberId);
  const [date, setDate] = useState(task.date);
  const [category, setCategory] = useState<TaskCategory>(task.category);
  const [busy, setBusy] = useState(false);
  // 이미 등록된 업무를 다른 날짜에도 반복 등록
  const [editRecurring, setEditRecurring] = useState(false);
  const [editRecurDates, setEditRecurDates] = useState<string[]>([]);

  const extended = isExtended(task);
  const struck = isStruck(task);
  const done = task.status === "done";

  function startEdit() {
    setTitle(task.title);
    setDetail(task.detail ?? "");
    setMemberId(task.memberId);
    setDate(task.date);
    setCategory(task.category);
    setEditing(true);
  }

  async function saveEdit() {
    if (!title.trim()) {
      toast.error("업무 내용을 입력하세요.");
      return;
    }
    const member = members.find((m) => m.id === memberId);
    if (!member) {
      toast.error("담당자를 선택하세요.");
      return;
    }
    setBusy(true);
    try {
      await updateTask(task.id, {
        memberId: member.id,
        memberName: member.name,
        date,
        category,
        title: title.trim(),
        detail: emptyToUndef(detail),
      });
      setEditing(false);
    } finally {
      setBusy(false);
    }
  }

  // 수정 중인 업무를 선택한 (반복) 날짜들에 새로 등록
  async function addRecurring() {
    if (!title.trim()) {
      toast.error("업무 내용을 입력하세요.");
      return;
    }
    const member = members.find((m) => m.id === memberId);
    if (!member) {
      toast.error("담당자를 선택하세요.");
      return;
    }
    if (editRecurDates.length === 0) {
      toast.error("반복 등록할 날짜를 선택하세요.");
      return;
    }
    if (
      editRecurDates.length > 100 &&
      !(await confirm({
        title: `${editRecurDates.length}건을 등록합니다`,
        message: "계속할까요?",
        confirmLabel: "등록",
      }))
    )
      return;
    setBusy(true);
    try {
      await Promise.all(
        editRecurDates.map((d) =>
          addTask({
            memberId: member.id,
            memberName: member.name,
            date: d,
            category,
            title: title.trim(),
            detail: emptyToUndef(detail),
            status: "todo",
          }),
        ),
      );
      setEditRecurring(false);
      setEditRecurDates([]);
      setEditing(false);
    } finally {
      setBusy(false);
    }
  }

  function onStatusChange(next: TaskStatus) {
    if (next === "extended") {
      setExtDate(task.date);
      setPicking(true);
    } else {
      setPicking(false);
      setTaskStatus(task.id, next);
    }
  }

  function confirmExtend() {
    if (!extDate) {
      toast.error("연장할 날짜를 선택하세요.");
      return;
    }
    const original = task.originalDate ?? task.date;
    setTaskExtended(task.id, extDate, original);
    setPicking(false);
    onMoved?.(extDate);
  }

  async function remove() {
    if (!(await confirm({ title: "이 업무를 삭제할까요?", confirmLabel: "삭제", tone: "danger" }))) return;
    deleteTask(task.id);
  }

  if (editing) {
    return (
      <li className="flex flex-col gap-2 bg-nd-sunken/60 px-4 py-3">
        {task.sourceType === "dev" && (
          <p className="flex items-center gap-1 text-nd-micro text-nd-success-text">
            <Icon icon={Puzzle} size={12} /> 개발 보드와 연동된 업무입니다
          </p>
        )}
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="업무 내용" />
        <Textarea rows={2} value={detail} onChange={(e) => setDetail(e.target.value)} placeholder="상세 (선택)" />
        <div className="grid grid-cols-2 gap-2">
          <Select value={memberId} onChange={(e) => setMemberId(e.target.value)} aria-label="담당자">
            <option value="" disabled>
              담당자
            </option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="날짜" />
        </div>
        <CategoryPicker value={category} onChange={setCategory} />
        <p className="text-nd-micro text-nd-fg-3">상태(예정/완료/연장/보류)는 저장 후 목록의 상태 선택으로 변경하세요.</p>

        {/* 이미 등록된 업무 → 다른 날짜에도 반복 등록 */}
        <div className="border-t border-nd-line pt-3">
          <Checkbox
            checked={editRecurring}
            onChange={(e) => setEditRecurring(e.target.checked)}
            label={
              <>
                <span className="text-nd-caption font-medium text-nd-fg-2">반복 등록</span>
                <span className="ml-2 text-nd-micro text-nd-fg-3">이 업무를 다른 날짜에도 추가</span>
              </>
            }
          />
        </div>
        {editRecurring && (
          <>
            <RecurrenceControls baseDate={task.date} onDatesChange={setEditRecurDates} />
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="self-start"
              onClick={addRecurring}
              loading={busy}
              disabled={editRecurDates.length === 0 || !title.trim()}
            >
              {busy ? "등록 중…" : `반복으로 추가 등록 (${editRecurDates.length}건)`}
            </Button>
          </>
        )}

        <div className="flex gap-2">
          <Button size="sm" onClick={saveEdit} loading={busy} disabled={!title.trim()}>
            {busy ? "저장 중…" : "저장"}
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setEditing(false)} disabled={busy}>
            취소
          </Button>
        </div>
      </li>
    );
  }

  return (
    <li className={cn("flex flex-col gap-1.5 px-4 py-3", extended && "bg-nd-warning-soft/50")}>
      <div className="flex items-center gap-2.5">
        {/* 완료 체크박스 */}
        <button
          type="button"
          onClick={() => setTaskStatus(task.id, done ? "todo" : "done")}
          aria-label="완료 토글"
          aria-pressed={done}
          className={cn(
            "flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px] border transition-colors duration-nd-fast",
            done ? "border-nd-accent bg-nd-accent text-white" : "border-nd-border hover:border-nd-fg-3",
          )}
        >
          {done && <Icon icon={Check} size={12} />}
        </button>
        {task.sourceType === "dev" && task.sourceId ? (
          /* 개발 보드 미러 업무 — 칩 클릭 시 보드 상세로 딥링크 */
          <Link
            href={`/neander/dev/board?task=${task.sourceId}`}
            onClick={(e) => e.stopPropagation()}
            className="shrink-0 transition hover:opacity-80"
            title="개발 보드에서 열기"
          >
            <Badge color={taskCategoryColor("dev")}>
              개발 <Icon icon={ArrowUpRight} size={11} />
            </Badge>
          </Link>
        ) : (
          <Badge color={taskCategoryColor(task.category)}>{taskCategoryLabel(task.category)}</Badge>
        )}
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-nd-body",
            struck ? "text-nd-fg-3 line-through" : "font-medium text-nd-fg",
            extended && "rounded-[4px] bg-nd-warning-soft px-1 text-nd-warning-text",
          )}
          title={task.title}
        >
          {task.title}
        </span>
        <Select
          size="sm"
          value={task.status}
          onChange={(e) => onStatusChange(e.target.value as TaskStatus)}
          className="!w-[88px] shrink-0"
          aria-label="상태"
        >
          {TASK_STATUSES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </Select>
        <Button variant="ghost" size="sm" onClick={startEdit} className="shrink-0">
          수정
        </Button>
        <IconButton icon={Trash2} label="삭제" size="sm" onClick={remove} className="hover:text-nd-danger-text" />
      </div>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pl-[30px] text-nd-caption text-nd-fg-3">
        <span>{task.memberName}</span>
        {task.detail && <span className="text-nd-fg-2">· {task.detail}</span>}
        {task.mail && <MailChip mail={task.mail} />}
        {extended && task.originalDate && (
          <Badge tone="warning" size="sm">
            {formatDateKo(task.originalDate)} → {formatDateKo(task.date)}로 연장
          </Badge>
        )}
      </div>

      {picking && (
        <div className="flex flex-wrap items-center gap-2 pl-[30px]">
          <span className="text-nd-caption text-nd-fg-2">연장할 날짜</span>
          <Input
            size="sm"
            type="date"
            value={extDate}
            onChange={(e) => setExtDate(e.target.value)}
            className="!w-40"
            aria-label="연장할 날짜"
          />
          <Button size="sm" onClick={confirmExtend}>
            연장 확정
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setPicking(false)}>
            취소
          </Button>
        </div>
      )}
    </li>
  );
}

// 반복 등록 컨트롤 (요일 반복 / 날짜 직접 선택) — 등록 폼·수정 폼 공용.
// 선택된 날짜 목록을 onDatesChange 로 보고한다.
function RecurrenceControls({
  baseDate,
  onDatesChange,
}: {
  baseDate: string;
  onDatesChange: (dates: string[]) => void;
}) {
  const [recurMode, setRecurMode] = useState<"weekday" | "dates">("weekday");
  const [weekdaysSel, setWeekdaysSel] = useState<Set<number>>(new Set());
  const [startDate, setStartDate] = useState(baseDate);
  const [endDate, setEndDate] = useState(baseDate);
  const [specificDates, setSpecificDates] = useState<string[]>([]);
  const [pickMonth, setPickMonth] = useState(baseDate.slice(0, 7));

  const dates = useMemo(
    () =>
      recurMode === "weekday" ? datesByWeekday(startDate, endDate, weekdaysSel) : specificDates,
    [recurMode, startDate, endDate, weekdaysSel, specificDates],
  );
  useEffect(() => {
    onDatesChange(dates);
  }, [dates, onDatesChange]);

  function toggleWeekday(i: number) {
    setWeekdaysSel((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }
  function toggleSpecific(d: string) {
    setSpecificDates((prev) =>
      prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort(),
    );
  }
  function removeSpecific(d: string) {
    setSpecificDates((prev) => prev.filter((x) => x !== d));
  }

  return (
    <div className="flex flex-col gap-3 rounded-nd-md bg-nd-sunken p-3">
      {/* 반복 방식 */}
      <SegmentedControl<"weekday" | "dates">
        size="sm"
        fill
        ariaLabel="반복 방식"
        value={recurMode}
        onChange={setRecurMode}
        options={[
          { value: "weekday", label: "요일 반복" },
          { value: "dates", label: "날짜 직접 선택" },
        ]}
      />

      {recurMode === "weekday" ? (
        <>
          <div>
            <span className="mb-1 block text-nd-caption font-medium text-nd-fg-2">반복 요일</span>
            <div className="flex gap-1" role="group" aria-label="반복 요일">
              {WEEKDAYS.map((w, i) => {
                const on = weekdaysSel.has(i);
                return (
                  <button
                    type="button"
                    key={i}
                    onClick={() => toggleWeekday(i)}
                    aria-pressed={on}
                    className={cn(
                      "h-8 w-8 rounded-full text-nd-caption font-semibold transition-colors duration-nd-fast",
                      on
                        ? "bg-nd-accent text-white"
                        : cn("border border-nd-line bg-nd-content hover:bg-nd-fg/[.06]", weekdayText(i, "text-nd-fg-2")),
                    )}
                  >
                    {w}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="시작일">
              <Input size="sm" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </Field>
            <Field label="종료일">
              <Input size="sm" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </Field>
          </div>
        </>
      ) : (
        <div className="flex flex-col gap-2">
          <span className="text-nd-caption font-medium text-nd-fg-2">
            등록할 날짜 선택 <span className="font-normal text-nd-fg-3">(여러 날 클릭)</span>
          </span>
          <div className="rounded-nd-md border border-nd-line bg-nd-content p-2">
            <div className="mb-1 flex justify-center">
              <DateStepper
                size="sm"
                icon={false}
                label={monthLabel(pickMonth)}
                prevLabel="이전 달"
                nextLabel="다음 달"
                onPrev={() => setPickMonth(shiftMonth(pickMonth, -1))}
                onNext={() => setPickMonth(shiftMonth(pickMonth, 1))}
                className="!border-0"
              />
            </div>
            <div className="grid grid-cols-7 gap-0.5">
              {WEEKDAYS.map((w, i) => (
                <div key={w} className={cn("py-0.5 text-center text-nd-micro font-medium", weekdayText(i))}>
                  {w}
                </div>
              ))}
              {monthGrid(pickMonth).map((d, idx) =>
                d ? (
                  <button
                    type="button"
                    key={d}
                    onClick={() => toggleSpecific(d)}
                    aria-pressed={specificDates.includes(d)}
                    className={cn(
                      "nd-num flex h-8 items-center justify-center rounded-[8px] text-nd-caption transition-colors duration-nd-fast",
                      specificDates.includes(d)
                        ? "bg-nd-accent font-semibold text-white"
                        : "text-nd-fg-2 hover:bg-nd-fg/[.06]",
                    )}
                  >
                    {Number(d.slice(8, 10))}
                  </button>
                ) : (
                  <div key={`e${idx}`} className="h-8" />
                ),
              )}
            </div>
          </div>
          {specificDates.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              {specificDates.map((d) => (
                <span
                  key={d}
                  className="inline-flex h-6 items-center gap-1 rounded-full border border-nd-line bg-nd-content pl-2 pr-1 text-nd-micro text-nd-fg-2"
                >
                  {formatDateKo(d)}
                  <button
                    type="button"
                    onClick={() => removeSpecific(d)}
                    aria-label={`${formatDateKo(d)} 제거`}
                    className="flex h-4 w-4 items-center justify-center rounded-full text-nd-fg-3 hover:bg-nd-danger-soft hover:text-nd-danger-text"
                  >
                    <Icon icon={X} size={11} />
                  </button>
                </span>
              ))}
              <Button variant="ghost" size="sm" onClick={() => setSpecificDates([])}>
                전체 해제
              </Button>
            </div>
          )}
        </div>
      )}

      <p className="text-nd-micro text-nd-fg-3">
        {dates.length > 0 ? `총 ${dates.length}일에 등록됩니다.` : "조건에 맞는 날짜가 없습니다."}
      </p>
    </div>
  );
}

function TaskForm({
  me,
  date,
  onDateChange,
}: {
  me: { id: string; name: string } | null;
  date: string;
  onDateChange: (date: string) => void;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const [category, setCategory] = useState<TaskCategory>("id");
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [saving, setSaving] = useState(false);

  // 반복 등록
  const [recurring, setRecurring] = useState(false);
  const [recurDates, setRecurDates] = useState<string[]>([]);
  const [recurKey, setRecurKey] = useState(0); // 등록 후 반복 컨트롤 초기화용

  const targetDates = recurring ? recurDates : [date];

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    if (!me) {
      toast.error("로그인 계정이 팀원과 연결되어야 등록할 수 있습니다.");
      return;
    }
    if (recurring && targetDates.length === 0) {
      toast.error("반복 등록할 요일·기간 또는 날짜를 선택하세요.");
      return;
    }
    if (
      targetDates.length > 100 &&
      !(await confirm({
        title: `${targetDates.length}건을 등록합니다`,
        message: "계속할까요?",
        confirmLabel: "등록",
      }))
    )
      return;
    setSaving(true);
    try {
      await Promise.all(
        targetDates.map((d) =>
          addTask({
            memberId: me.id,
            memberName: me.name,
            date: d,
            category,
            title: title.trim(),
            detail: emptyToUndef(detail),
            status: "todo",
          }),
        ),
      );
      setTitle("");
      setDetail("");
      setRecurDates([]);
      setRecurKey((k) => k + 1);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="self-start">
      <h2 className="mb-4 text-nd-section text-nd-fg">업무 등록</h2>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="담당자">
          <div className="flex h-ctl-md items-center rounded-nd-md border border-nd-line bg-nd-sunken px-3 text-nd-body text-nd-fg-2">
            {me ? `${me.name} (나)` : "로그인 필요"}
          </div>
        </Field>

        {/* 반복 등록 토글 */}
        <Checkbox
          checked={recurring}
          onChange={(e) => setRecurring(e.target.checked)}
          label={
            <>
              <span className="font-medium">반복 등록</span>
              <span className="ml-2 text-nd-caption text-nd-fg-3">요일 주기 또는 지정한 날짜에 한 번에</span>
            </>
          }
        />

        {!recurring ? (
          <Field label="마감일" required hint="캘린더에서 선택 가능">
            <Input type="date" value={date} onChange={(e) => onDateChange(e.target.value)} />
          </Field>
        ) : (
          <RecurrenceControls key={recurKey} baseDate={date} onDatesChange={setRecurDates} />
        )}

        <Field label="분류" required>
          <CategoryPicker value={category} onChange={setCategory} />
        </Field>
        <Field label="업무 내용" required>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="예: 거래처 미팅 자료 작성" />
        </Field>
        <Field label="상세" hint="선택 입력">
          <Textarea rows={3} value={detail} onChange={(e) => setDetail(e.target.value)} />
        </Field>
        <Button type="submit" loading={saving} disabled={!title.trim() || !me}>
          {saving ? "등록 중…" : recurring ? `반복 등록 (${targetDates.length}건)` : "업무 등록"}
        </Button>
      </form>
    </Card>
  );
}
