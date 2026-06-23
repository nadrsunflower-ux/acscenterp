"use client";

import { useEffect, useMemo, useState } from "react";
import { useAppData } from "@/components/neander/app-data";
import {
  addTask,
  setTaskStatus,
  setTaskExtended,
  deleteTask,
  updateTask,
} from "@/lib/neander/db/tasks";
import { emptyToUndef } from "@/lib/neander/db/helpers";
import {
  Button,
  Card,
  Field,
  Input,
  Select,
  Textarea,
  EmptyState,
  Badge,
  CategoryPicker,
  cn,
} from "@/components/neander/ui";
import {
  TASK_STATUSES,
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

const STATUS_COLOR: Record<TaskStatus, string> = {
  todo: "#a1a1aa",
  done: "#16a34a",
  extended: "#ca8a04",
  on_hold: "#64748b",
};

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

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
const STATUS_TABS: { value: TaskStatus | "all"; label: string }[] = [
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
  const [statusFilter, setStatusFilter] = useState<TaskStatus | "all">("all");

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
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900">
          {currentMember ? `안녕하세요, ${currentMember.name}님 ` : "일일업무 "}
          <span className="align-middle">👋</span>
        </h1>
        <p className="mt-1 text-sm text-zinc-500">오늘도 좋은 하루 되세요!</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
        {/* 좌측: 업무 등록 */}
        <TaskForm me={currentMember} date={selectedDate} onDateChange={selectDate} />

        {/* 우측: 날짜 선택 + 상태 탭 + 목록 */}
        <div className="flex flex-col gap-4">
          {/* 날짜 카드 (주간 스트립 / 월 달력 토글) */}
          <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/5">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="flex items-center gap-1">
                <button
                  onClick={() =>
                    viewMode === "week"
                      ? setWeekAnchor(addDays(weekAnchor, -7))
                      : setViewMonth(shiftMonth(viewMonth, -1))
                  }
                  className="rounded-lg px-2 py-1 text-sm text-zinc-500 hover:bg-zinc-100"
                  aria-label="이전"
                >
                  ‹
                </button>
                <span className="min-w-[140px] text-center text-sm font-semibold text-zinc-800">
                  {viewMode === "week" ? weekLabelOf(weekAnchor) : monthLabel(viewMonth)}
                </span>
                <button
                  onClick={() =>
                    viewMode === "week"
                      ? setWeekAnchor(addDays(weekAnchor, 7))
                      : setViewMonth(shiftMonth(viewMonth, 1))
                  }
                  className="rounded-lg px-2 py-1 text-sm text-zinc-500 hover:bg-zinc-100"
                  aria-label="다음"
                >
                  ›
                </button>
              </div>
              <div className="flex items-center gap-2">
                <Select
                  value={memberFilter}
                  onChange={(e) => setMemberFilter(e.target.value)}
                  className="!w-28 !py-1.5 !text-xs"
                >
                  <option value="all">전체 담당자</option>
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </Select>
                <button
                  onClick={toggleMode}
                  className="rounded-lg bg-zinc-100 px-2.5 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-200"
                >
                  {viewMode === "week" ? "월 보기" : "주 보기"}
                </button>
              </div>
            </div>

            {viewMode === "week" ? (
              /* 주간 스트립 */
              <div className="grid grid-cols-7 gap-1 rounded-2xl bg-zinc-50 p-1.5">
                {weekDays.map((d, i) => {
                  const dayNum = Number(d.slice(8, 10));
                  const count = (byDate.get(d) ?? []).length;
                  const selected = d === selectedDate;
                  const isToday = d === today;
                  return (
                    <button
                      key={d}
                      onClick={() => selectDate(d)}
                      className={cn(
                        "flex flex-col items-center gap-1 rounded-xl py-2.5 transition",
                        selected ? "bg-white shadow-sm ring-1 ring-zinc-200" : "hover:bg-white/60",
                      )}
                    >
                      <span
                        className={cn(
                          "text-[11px] font-medium",
                          i === 0 ? "text-red-300" : i === 6 ? "text-blue-300" : "text-zinc-400",
                        )}
                      >
                        {WEEKDAYS[i]}
                      </span>
                      <span
                        className={cn(
                          "text-base font-bold",
                          selected ? "text-zinc-900" : isToday ? "text-indigo-500" : "text-zinc-400",
                        )}
                      >
                        {dayNum}
                      </span>
                      <span
                        className={cn(
                          "h-1 w-1 rounded-full",
                          count > 0 ? (selected ? "bg-indigo-500" : "bg-zinc-300") : "bg-transparent",
                        )}
                      />
                    </button>
                  );
                })}
              </div>
            ) : (
              /* 월 달력 */
              <div>
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
                    if (!date) return <div key={`e${idx}`} className="min-h-[60px] rounded-lg" />;
                    const dayNum = Number(date.slice(8, 10));
                    const dow = idx % 7;
                    const cellTasks = byDate.get(date) ?? [];
                    const selected = date === selectedDate;
                    const isToday = date === today;
                    return (
                      <button
                        key={date}
                        onClick={() => selectDate(date)}
                        className={cn(
                          "flex min-h-[60px] flex-col gap-0.5 rounded-lg border p-1 text-left transition",
                          selected ? "border-indigo-500 bg-indigo-50" : "border-zinc-100 hover:bg-zinc-50",
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
                          {cellTasks.slice(0, 2).map((t) => (
                            <span
                              key={t.id}
                              className={cn(
                                "flex items-center gap-1 truncate rounded px-1 text-[10px] leading-tight",
                                isExtended(t)
                                  ? "bg-yellow-200 text-yellow-800"
                                  : isStruck(t)
                                    ? "text-zinc-400 line-through"
                                    : "text-zinc-700",
                              )}
                            >
                              <span
                                className="h-1.5 w-1.5 shrink-0 rounded-full"
                                style={{ backgroundColor: taskCategoryColor(t.category) }}
                              />
                              <span className="truncate">{t.title}</span>
                            </span>
                          ))}
                          {cellTasks.length > 2 && (
                            <span className="text-[10px] text-zinc-400">+{cellTasks.length - 2}</span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* 상태 세그먼트 탭 */}
          <div className="flex gap-1 overflow-x-auto rounded-full bg-zinc-100 p-1">
            {STATUS_TABS.map((s) => (
              <button
                key={s.value}
                onClick={() => setStatusFilter(s.value)}
                className={cn(
                  "whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-medium transition",
                  statusFilter === s.value
                    ? "bg-zinc-900 text-white shadow-sm"
                    : "text-zinc-500 hover:text-zinc-800",
                )}
              >
                {s.label}
              </button>
            ))}
          </div>

          {/* 선택일 업무 목록 */}
          <div className="rounded-2xl bg-white shadow-sm ring-1 ring-black/5">
            <div className="flex items-center justify-between px-4 py-3">
              <h2 className="text-sm font-semibold text-zinc-800">{formatDateKo(selectedDate)}</h2>
              <span className="text-xs text-zinc-400">{dayTasks.length}건</span>
            </div>
            {dayTasks.length === 0 ? (
              <div className="px-4 pb-10 pt-2">
                <EmptyState icon="✅" title="표시할 업무가 없습니다" description="왼쪽에서 등록하거나 필터를 바꿔보세요." />
              </div>
            ) : (
              <ul className="divide-y divide-zinc-100">
                {dayTasks.map((t) => (
                  <TaskRow key={t.id} task={t} members={members} onMoved={selectDate} />
                ))}
              </ul>
            )}
          </div>
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
    if (!title.trim()) return alert("업무 내용을 입력하세요.");
    const member = members.find((m) => m.id === memberId);
    if (!member) return alert("담당자를 선택하세요.");
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
    if (!title.trim()) return alert("업무 내용을 입력하세요.");
    const member = members.find((m) => m.id === memberId);
    if (!member) return alert("담당자를 선택하세요.");
    if (editRecurDates.length === 0) return alert("반복 등록할 날짜를 선택하세요.");
    if (editRecurDates.length > 100 && !confirm(`${editRecurDates.length}건을 등록합니다. 계속할까요?`))
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
    if (!extDate) return alert("연장할 날짜를 선택하세요.");
    const original = task.originalDate ?? task.date;
    setTaskExtended(task.id, extDate, original);
    setPicking(false);
    onMoved?.(extDate);
  }

  if (editing) {
    return (
      <li className="flex flex-col gap-2 bg-zinc-50/60 px-4 py-3">
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="업무 내용" />
        <Textarea rows={2} value={detail} onChange={(e) => setDetail(e.target.value)} placeholder="상세 (선택)" />
        <div className="grid grid-cols-2 gap-2">
          <Select value={memberId} onChange={(e) => setMemberId(e.target.value)}>
            <option value="" disabled>
              담당자
            </option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <CategoryPicker value={category} onChange={setCategory} />
        <p className="text-[11px] text-zinc-400">상태(예정/완료/연장/보류)는 저장 후 목록의 상태 선택으로 변경하세요.</p>

        {/* 이미 등록된 업무 → 다른 날짜에도 반복 등록 */}
        <label className="flex cursor-pointer items-center gap-2 border-t border-zinc-200 pt-3">
          <input
            type="checkbox"
            checked={editRecurring}
            onChange={(e) => setEditRecurring(e.target.checked)}
            className="h-4 w-4 accent-indigo-600"
          />
          <span className="text-xs font-medium text-zinc-700">반복 등록</span>
          <span className="text-[11px] text-zinc-400">이 업무를 다른 날짜에도 추가</span>
        </label>
        {editRecurring && (
          <>
            <RecurrenceControls baseDate={task.date} onDatesChange={setEditRecurDates} />
            <Button
              type="button"
              variant="secondary"
              className="!px-3 !py-1.5 !text-xs"
              onClick={addRecurring}
              disabled={busy || editRecurDates.length === 0 || !title.trim()}
            >
              {busy ? "등록 중…" : `반복으로 추가 등록 (${editRecurDates.length}건)`}
            </Button>
          </>
        )}

        <div className="flex gap-2">
          <Button className="!px-3 !py-1.5 !text-xs" onClick={saveEdit} disabled={busy || !title.trim()}>
            {busy ? "저장 중…" : "저장"}
          </Button>
          <Button
            variant="secondary"
            className="!px-3 !py-1.5 !text-xs"
            onClick={() => setEditing(false)}
            disabled={busy}
          >
            취소
          </Button>
        </div>
      </li>
    );
  }

  return (
    <li className={cn("flex flex-col gap-1.5 px-4 py-3", extended && "bg-yellow-100")}>
      <div className="flex items-center gap-2.5">
        {/* 완료 체크박스 */}
        <button
          onClick={() => setTaskStatus(task.id, done ? "todo" : "done")}
          className={cn(
            "flex h-5 w-5 shrink-0 items-center justify-center rounded-md border text-[11px] transition",
            done ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-300 hover:border-zinc-500",
          )}
          aria-label="완료 토글"
        >
          {done && "✓"}
        </button>
        <Badge color={taskCategoryColor(task.category)}>{taskCategoryLabel(task.category)}</Badge>
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-sm",
            struck ? "text-zinc-400 line-through" : "font-medium text-zinc-800",
            extended && "bg-yellow-200 px-1",
          )}
        >
          {task.title}
        </span>
        <div className="w-[88px] shrink-0">
          <Select
            value={task.status}
            onChange={(e) => onStatusChange(e.target.value as TaskStatus)}
            className="!py-1.5 !text-xs"
          >
            {TASK_STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
        </div>
        <button
          onClick={startEdit}
          className="shrink-0 text-xs font-medium text-zinc-400 hover:text-indigo-600"
        >
          수정
        </button>
        <button
          onClick={() => {
            if (confirm("이 업무를 삭제할까요?")) deleteTask(task.id);
          }}
          className="shrink-0 text-xs text-zinc-300 hover:text-red-500"
          aria-label="삭제"
        >
          ✕
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pl-[30px] text-xs text-zinc-400">
        <span>{task.memberName}</span>
        {task.detail && <span className="text-zinc-500">· {task.detail}</span>}
        {extended && task.originalDate && (
          <span className="rounded bg-yellow-200 px-1 font-medium text-yellow-800">
            🟡 {formatDateKo(task.originalDate)} → {formatDateKo(task.date)}로 연장
          </span>
        )}
      </div>

      {picking && (
        <div className="flex items-center gap-2 pl-[30px]">
          <span className="text-xs text-zinc-500">연장할 날짜</span>
          <Input type="date" value={extDate} onChange={(e) => setExtDate(e.target.value)} className="w-40" />
          <Button className="!px-3 !py-1 !text-xs" onClick={confirmExtend}>
            연장 확정
          </Button>
          <Button variant="secondary" className="!px-3 !py-1 !text-xs" onClick={() => setPicking(false)}>
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
    <div className="flex flex-col gap-3 rounded-lg bg-zinc-50 p-3">
      {/* 반복 방식 */}
      <div className="flex rounded-lg border border-zinc-200 bg-white p-0.5">
        <button
          type="button"
          onClick={() => setRecurMode("weekday")}
          className={cn(
            "flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition",
            recurMode === "weekday" ? "bg-indigo-600 text-white" : "text-zinc-500 hover:bg-zinc-100",
          )}
        >
          요일 반복
        </button>
        <button
          type="button"
          onClick={() => setRecurMode("dates")}
          className={cn(
            "flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition",
            recurMode === "dates" ? "bg-indigo-600 text-white" : "text-zinc-500 hover:bg-zinc-100",
          )}
        >
          날짜 직접 선택
        </button>
      </div>

      {recurMode === "weekday" ? (
        <>
          <div>
            <span className="mb-1 block text-xs font-medium text-zinc-500">반복 요일</span>
            <div className="flex gap-1">
              {WEEKDAYS.map((w, i) => (
                <button
                  type="button"
                  key={i}
                  onClick={() => toggleWeekday(i)}
                  className={cn(
                    "h-8 w-8 rounded-full text-xs font-semibold transition",
                    weekdaysSel.has(i)
                      ? "bg-indigo-600 text-white"
                      : "bg-white ring-1 ring-zinc-200 hover:bg-zinc-100",
                    !weekdaysSel.has(i) && (i === 0 ? "text-red-400" : i === 6 ? "text-blue-400" : "text-zinc-500"),
                  )}
                >
                  {w}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <span className="mb-1 block text-xs font-medium text-zinc-500">시작일</span>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div>
              <span className="mb-1 block text-xs font-medium text-zinc-500">종료일</span>
              <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
          </div>
        </>
      ) : (
        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium text-zinc-500">
            등록할 날짜 선택 <span className="text-zinc-400">(여러 날 클릭)</span>
          </span>
          <div className="rounded-lg border border-zinc-200 bg-white p-2">
            <div className="mb-1 flex items-center justify-between">
              <button
                type="button"
                onClick={() => setPickMonth(shiftMonth(pickMonth, -1))}
                className="rounded px-1.5 py-0.5 text-zinc-500 hover:bg-zinc-100"
                aria-label="이전 달"
              >
                ‹
              </button>
              <span className="text-xs font-semibold text-zinc-700">{monthLabel(pickMonth)}</span>
              <button
                type="button"
                onClick={() => setPickMonth(shiftMonth(pickMonth, 1))}
                className="rounded px-1.5 py-0.5 text-zinc-500 hover:bg-zinc-100"
                aria-label="다음 달"
              >
                ›
              </button>
            </div>
            <div className="grid grid-cols-7 gap-0.5">
              {WEEKDAYS.map((w, i) => (
                <div
                  key={w}
                  className={cn(
                    "py-0.5 text-center text-[10px] font-medium",
                    i === 0 ? "text-red-400" : i === 6 ? "text-blue-400" : "text-zinc-400",
                  )}
                >
                  {w}
                </div>
              ))}
              {monthGrid(pickMonth).map((d, idx) =>
                d ? (
                  <button
                    type="button"
                    key={d}
                    onClick={() => toggleSpecific(d)}
                    className={cn(
                      "flex h-8 items-center justify-center rounded-md text-xs transition",
                      specificDates.includes(d)
                        ? "bg-indigo-600 font-semibold text-white"
                        : "text-zinc-600 hover:bg-zinc-100",
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
                  className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-1 text-[11px] text-zinc-600 ring-1 ring-zinc-200"
                >
                  {formatDateKo(d)}
                  <button
                    type="button"
                    onClick={() => removeSpecific(d)}
                    className="text-zinc-400 hover:text-red-500"
                    aria-label="날짜 제거"
                  >
                    ✕
                  </button>
                </span>
              ))}
              <button
                type="button"
                onClick={() => setSpecificDates([])}
                className="rounded-full px-2 py-1 text-[11px] text-zinc-400 hover:text-red-500"
              >
                전체 해제
              </button>
            </div>
          )}
        </div>
      )}

      <p className="text-[11px] text-zinc-400">
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
    if (!me) return alert("로그인 계정이 팀원과 연결되어야 등록할 수 있습니다.");
    if (recurring && targetDates.length === 0)
      return alert("반복 등록할 요일·기간 또는 날짜를 선택하세요.");
    if (targetDates.length > 100 && !confirm(`${targetDates.length}건을 등록합니다. 계속할까요?`)) return;
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
    <Card className="!rounded-2xl">
      <h2 className="mb-4 text-sm font-semibold text-zinc-800">업무 등록</h2>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="담당자">
          <div className="flex h-[42px] items-center rounded-lg border border-zinc-200 bg-zinc-50 px-3 text-sm text-zinc-700">
            {me ? `${me.name} (나)` : "로그인 필요"}
          </div>
        </Field>

        {/* 반복 등록 토글 */}
        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={recurring}
            onChange={(e) => setRecurring(e.target.checked)}
            className="h-4 w-4 accent-indigo-600"
          />
          <span className="text-sm font-medium text-zinc-700">반복 등록</span>
          <span className="text-xs text-zinc-400">요일 주기 또는 지정한 날짜에 한 번에</span>
        </label>

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
        <Button type="submit" disabled={saving || !title.trim() || !me}>
          {saving ? "등록 중…" : recurring ? `반복 등록 (${targetDates.length}건)` : "업무 등록"}
        </Button>
      </form>
    </Card>
  );
}
