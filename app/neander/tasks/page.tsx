"use client";

import { useMemo, useState } from "react";
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
  PageHeader,
  EmptyState,
  Badge,
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
} from "@/lib/neander/format";

const STATUS_COLOR: Record<TaskStatus, string> = {
  todo: "#a1a1aa",
  done: "#16a34a",
  extended: "#ca8a04",
};

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

// 연장(노란 형광펜) 여부
const isExtended = (t: DailyTask) => t.status === "extended";

export default function TasksPage() {
  const { tasks, members, currentMember } = useAppData();

  const today = todayStr();
  const [viewMonth, setViewMonth] = useState(thisMonthStr());
  const [selectedDate, setSelectedDate] = useState(today);
  // 기본값: 본인 업무만 보이는 캘린더 (팀원 연결이 없으면 전체)
  const [memberFilter, setMemberFilter] = useState(currentMember?.id ?? "all");

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

  const dayTasks = useMemo(
    () => [...(byDate.get(selectedDate) ?? [])].sort((a, b) => b.createdAt - a.createdAt),
    [byDate, selectedDate],
  );

  const grid = useMemo(() => monthGrid(viewMonth), [viewMonth]);

  function selectDate(date: string) {
    setSelectedDate(date);
    const m = date.slice(0, 7);
    if (m !== viewMonth) setViewMonth(m);
  }

  return (
    <div>
      <PageHeader title="일일업무" description="좌측에서 업무를 등록하고, 우측 캘린더에서 날짜별 업무를 확인·관리합니다." />

      <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
        {/* 좌측: 업무 등록 */}
        <TaskForm
          members={members}
          defaultMemberId={currentMember?.id}
          date={selectedDate}
          onDateChange={selectDate}
        />

        {/* 우측: 캘린더 + 선택일 업무 */}
        <div className="flex flex-col gap-4">
          <Card className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
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
              </div>
              <Select
                value={memberFilter}
                onChange={(e) => setMemberFilter(e.target.value)}
                className="w-32"
              >
                <option value="all">전체 담당자</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </Select>
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
                const cellTasks = byDate.get(date) ?? [];
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
                      {cellTasks.slice(0, 3).map((t) => (
                        <span
                          key={t.id}
                          className={cn(
                            "flex items-center gap-1 truncate rounded px-1 text-[10px] leading-tight",
                            isExtended(t)
                              ? "bg-yellow-200 text-yellow-800"
                              : t.status === "done"
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
                      {cellTasks.length > 3 && (
                        <span className="text-[10px] text-zinc-400">+{cellTasks.length - 3}</span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </Card>

          {/* 선택일 업무 목록 */}
          <Card className="!p-0">
            <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-3">
              <h2 className="text-sm font-semibold text-zinc-800">{formatDateKo(selectedDate)} 업무</h2>
              <span className="text-xs text-zinc-400">
                {dayTasks.length}건
                {dayTasks.filter((t) => t.status === "done").length > 0 &&
                  ` · 완료 ${dayTasks.filter((t) => t.status === "done").length}건`}
              </span>
            </div>
            {dayTasks.length === 0 ? (
              <div className="px-4 py-10">
                <EmptyState icon="✅" title="이 날짜에 등록된 업무가 없습니다" description="왼쪽에서 등록하세요." />
              </div>
            ) : (
              <ul className="divide-y divide-zinc-100">
                {dayTasks.map((t) => (
                  <TaskRow key={t.id} task={t} members={members} />
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
}: {
  task: DailyTask;
  members: { id: string; name: string }[];
}) {
  const [editing, setEditing] = useState(false);
  const [picking, setPicking] = useState(false); // 연장 날짜 선택 중
  const [extDate, setExtDate] = useState(task.extendedDate ?? "");

  // 편집용 상태
  const [title, setTitle] = useState(task.title);
  const [detail, setDetail] = useState(task.detail ?? "");
  const [memberId, setMemberId] = useState(task.memberId);
  const [date, setDate] = useState(task.date);
  const [category, setCategory] = useState<TaskCategory>(task.category);
  const [status, setStatus] = useState<TaskStatus>(task.status);
  const [busy, setBusy] = useState(false);

  const extended = isExtended(task);

  function startEdit() {
    setTitle(task.title);
    setDetail(task.detail ?? "");
    setMemberId(task.memberId);
    setDate(task.date);
    setCategory(task.category);
    setStatus(task.status);
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
        status,
        // 연장이 아니면 연장일 제거
        extendedDate: status === "extended" ? emptyToUndef(task.extendedDate) : undefined,
      });
      setEditing(false);
    } finally {
      setBusy(false);
    }
  }

  // 상태 셀렉트 변경
  function onStatusChange(next: TaskStatus) {
    if (next === "extended") {
      setExtDate(task.extendedDate ?? "");
      setPicking(true);
    } else {
      setPicking(false);
      setTaskStatus(task.id, next);
    }
  }

  function confirmExtend() {
    if (!extDate) return alert("연장할 날짜를 선택하세요.");
    setTaskExtended(task.id, extDate);
    setPicking(false);
  }

  // ---- 편집 모드 ----
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
        <div className="grid grid-cols-2 gap-2">
          <Select value={category} onChange={(e) => setCategory(e.target.value as TaskCategory)}>
            {TASK_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </Select>
          <Select value={status} onChange={(e) => setStatus(e.target.value as TaskStatus)}>
            {TASK_STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
        </div>
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

  // ---- 표시 모드 ----
  return (
    <li className={cn("flex flex-col gap-1.5 px-4 py-3", extended && "bg-yellow-100")}>
      <div className="flex items-center gap-2">
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: STATUS_COLOR[task.status] }}
        />
        <Badge color={taskCategoryColor(task.category)}>{taskCategoryLabel(task.category)}</Badge>
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-sm",
            task.status === "done" ? "text-zinc-400 line-through" : "font-medium text-zinc-800",
            extended && "bg-yellow-200 px-1",
          )}
        >
          {task.title}
        </span>
        <div className="w-24 shrink-0">
          <Select value={task.status} onChange={(e) => onStatusChange(e.target.value as TaskStatus)}>
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

      {/* 상세 + 담당자 (가로 정렬) */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pl-[18px] text-xs text-zinc-400">
        <span>{task.memberName}</span>
        {task.detail && <span className="text-zinc-500">· {task.detail}</span>}
        {extended && task.extendedDate && (
          <span className="font-medium text-yellow-700">· 🟡 {formatDateKo(task.extendedDate)}로 연장</span>
        )}
      </div>

      {/* 연장 날짜 선택 */}
      {picking && (
        <div className="flex items-center gap-2 pl-[18px]">
          <span className="text-xs text-zinc-500">연장할 날짜</span>
          <Input
            type="date"
            value={extDate}
            onChange={(e) => setExtDate(e.target.value)}
            className="w-40"
          />
          <Button className="!px-3 !py-1 !text-xs" onClick={confirmExtend}>
            연장 확정
          </Button>
          <Button
            variant="secondary"
            className="!px-3 !py-1 !text-xs"
            onClick={() => setPicking(false)}
          >
            취소
          </Button>
        </div>
      )}
    </li>
  );
}

function TaskForm({
  members,
  defaultMemberId,
  date,
  onDateChange,
}: {
  members: { id: string; name: string }[];
  defaultMemberId?: string;
  date: string;
  onDateChange: (date: string) => void;
}) {
  const [memberId, setMemberId] = useState("");
  const [category, setCategory] = useState<TaskCategory>("id");
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [saving, setSaving] = useState(false);

  const effectiveMemberId = memberId || defaultMemberId || "";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    const member = members.find((m) => m.id === effectiveMemberId);
    if (!member) return alert("담당자를 선택하세요.");
    setSaving(true);
    try {
      await addTask({
        memberId: member.id,
        memberName: member.name,
        date,
        category,
        title: title.trim(),
        detail: emptyToUndef(detail),
        status: "todo",
      });
      setTitle("");
      setDetail("");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <h2 className="mb-4 text-sm font-semibold text-zinc-800">업무 등록</h2>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="담당자" required>
            <Select value={effectiveMemberId} onChange={(e) => setMemberId(e.target.value)}>
              <option value="" disabled>
                선택
              </option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="날짜" required hint="캘린더에서 선택 가능">
            <Input type="date" value={date} onChange={(e) => onDateChange(e.target.value)} />
          </Field>
        </div>
        <Field label="분류" required>
          <Select value={category} onChange={(e) => setCategory(e.target.value as TaskCategory)}>
            {TASK_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="업무 내용" required>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="예: 거래처 미팅 자료 작성" />
        </Field>
        <Field label="상세" hint="선택 입력">
          <Textarea rows={3} value={detail} onChange={(e) => setDetail(e.target.value)} />
        </Field>
        <Button type="submit" disabled={saving || !title.trim()}>
          {saving ? "등록 중…" : "업무 등록"}
        </Button>
      </form>
    </Card>
  );
}
