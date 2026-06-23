"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useAppData } from "@/components/neander/app-data";
import { Card, Badge, cn } from "@/components/neander/ui";
import {
  SALES_CHANNELS,
  taskStatusLabel,
  taskCategoryLabel,
  taskCategoryColor,
  type SalesChannel,
  type DailyTask,
  type Member,
} from "@/lib/neander/types";
import {
  formatKRW,
  thisMonthStr,
  todayStr,
  todayStrKST,
  dateStrKST,
  formatDateKo,
  isInMonth,
  weekDates,
  weekRangeLabel,
} from "@/lib/neander/format";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

/** 하루치 업무를 팀원별로 묶는다 (members 배열 순서로 정렬). 업무는 입력 순서 유지(=createdAt). */
function groupByMember(
  dayTasks: DailyTask[],
  memberIndex: (id: string) => number,
): { memberId: string; memberName: string; items: DailyTask[] }[] {
  const map = new Map<string, { memberId: string; memberName: string; items: DailyTask[] }>();
  for (const t of dayTasks) {
    const g = map.get(t.memberId);
    if (g) g.items.push(t);
    else map.set(t.memberId, { memberId: t.memberId, memberName: t.memberName, items: [t] });
  }
  return [...map.values()].sort((a, b) => memberIndex(a.memberId) - memberIndex(b.memberId));
}

export default function DashboardPage() {
  const { sales, tasks, requests, members, currentMember } = useAppData();
  const month = thisMonthStr();
  const today = todayStr();

  const monthSales = useMemo(() => sales.filter((s) => isInMonth(s.date, month)), [sales, month]);
  const totalSales = monthSales.reduce((sum, s) => sum + s.amount, 0);

  const byChannel = SALES_CHANNELS.map((c) => ({
    ...c,
    amount: monthSales
      .filter((s) => s.channel === (c.value as SalesChannel))
      .reduce((sum, s) => sum + s.amount, 0),
  }));
  const maxChannel = Math.max(1, ...byChannel.map((c) => c.amount));

  const myId = currentMember?.id ?? null;
  const todayKST = todayStrKST();

  // 미완료 업무 토글(목록 펼치기)
  const [showOpen, setShowOpen] = useState(false);

  // 로그인 담당자 기준 지표
  const myOpenTasks = myId ? tasks.filter((t) => t.memberId === myId && t.status !== "done") : [];
  const myTodayTasks = myId ? tasks.filter((t) => t.memberId === myId && t.date === todayKST) : [];
  // 미완료 업무 목록: 마감기한(date) 빠른 순 (지난 것 먼저)
  const myOpenSorted = useMemo(
    () => [...myOpenTasks].sort((a, b) => a.date.localeCompare(b.date)),
    [myOpenTasks],
  );

  // 받은 요청: (지표) 오늘(KST) 받은 개수 + 미확인 존재 여부 N
  const myReceivedAll = myId ? requests.filter((r) => r.toId === myId) : [];
  const myReceivedToday = myReceivedAll.filter((r) => dateStrKST(r.createdAt) === todayKST);
  const hasUnacked = myReceivedAll.some((r) => !r.acknowledged);

  // 하단 '받은 요청 (미완료)' 리스트 카드용 (기존 유지)
  const myReceived = myReceivedAll.filter((r) => r.status !== "done");

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900">
          {currentMember ? `안녕하세요, ${currentMember.name}님 👋` : "대시보드"}
        </h1>
        <p className="mt-1 text-sm text-zinc-500">{month} 현황 요약</p>
      </div>

      {/* 상단 지표 */}
      <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="이번 달 매출" value={formatKRW(totalSales)} href="/neander/sales" accent />
        <StatCard label="오늘의 업무" value={`${myTodayTasks.length}건`} href="/neander/tasks" />
        <StatCard
          label="미완료 업무"
          value={`${myOpenTasks.length}건`}
          onToggle={() => setShowOpen((v) => !v)}
          open={showOpen}
        />
        <StatCard
          label="받은 요청"
          value={`${myReceivedToday.length}건`}
          href="/neander/requests"
          badge={hasUnacked ? "N" : undefined}
        />
      </div>

      {/* 미완료 업무 펼침 목록 (마감기한 포함) */}
      {showOpen && (
        <Card className="mb-6">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-zinc-800">
              미완료 업무 <span className="font-normal text-zinc-400">({myOpenTasks.length})</span>
            </h2>
            <Link href="/neander/tasks" className="text-xs text-indigo-600 hover:underline">
              일일업무 →
            </Link>
          </div>
          {myOpenSorted.length === 0 ? (
            <p className="py-4 text-center text-sm text-zinc-400">미완료 업무가 없습니다. 👍</p>
          ) : (
            <ul className="flex flex-col divide-y divide-zinc-100">
              {myOpenSorted.map((t) => {
                const overdue = t.date < todayKST;
                return (
                  <li key={t.id} className="flex items-center gap-2 py-2 text-sm">
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: taskCategoryColor(t.category) }}
                      title={taskCategoryLabel(t.category)}
                    />
                    <span className="min-w-0 flex-1 truncate text-zinc-800">{t.title}</span>
                    <span className="shrink-0 text-[11px] text-zinc-400">{taskStatusLabel(t.status)}</span>
                    <span
                      className={cn(
                        "shrink-0 text-xs",
                        overdue ? "font-semibold text-red-500" : "text-zinc-500",
                      )}
                    >
                      {formatDateKo(t.date)}
                      {overdue && " · 지남"}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      )}

      {/* 주간 업무 (모두의 이번 주 일일업무) */}
      <WeeklyTasks tasks={tasks} members={members} today={today} />

      <div className="grid gap-6 lg:grid-cols-2">
        {/* 채널별 매출 */}
        <Card>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-zinc-800">채널별 매출 ({month})</h2>
            <Link href="/neander/sales" className="text-xs text-indigo-600 hover:underline">
              자세히 →
            </Link>
          </div>
          <div className="flex flex-col gap-3">
            {byChannel.map((c) => (
              <div key={c.value}>
                <div className="mb-1 flex justify-between text-sm">
                  <span className="text-zinc-600">{c.label}</span>
                  <span className="font-semibold text-zinc-900">{formatKRW(c.amount)}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-zinc-100">
                  <div
                    className="h-full rounded-full bg-indigo-500 transition-all"
                    style={{ width: `${(c.amount / maxChannel) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </Card>

        {/* 내 받은 요청 */}
        <Card>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-zinc-800">받은 요청 (미완료)</h2>
            <Link href="/neander/requests" className="text-xs text-indigo-600 hover:underline">
              전체 →
            </Link>
          </div>
          {!currentMember ? (
            <p className="py-6 text-center text-sm text-zinc-400">
              로그인 계정이 팀원과 연결되면 받은 요청이 표시됩니다.
            </p>
          ) : myReceived.length === 0 ? (
            <p className="py-6 text-center text-sm text-zinc-400">받은 요청이 없습니다. 👍</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {myReceived.slice(0, 5).map((r) => (
                <li key={r.id} className="flex items-center gap-2 text-sm">
                  <Badge color="#6366f1">{r.fromName}</Badge>
                  <span className="flex-1 truncate text-zinc-700">{r.title}</span>
                  {r.dueDate && (
                    <span className="text-xs text-zinc-400">{formatDateKo(r.dueDate)}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

function WeeklyTasks({
  tasks,
  members,
  today,
}: {
  tasks: DailyTask[];
  members: Member[];
  today: string;
}) {
  // 팀원별 토글: excluded 에 담긴 담당자는 숨김 (기본=전원 표시)
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const toggleMember = (id: string) =>
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allOn = excluded.size === 0;
  const allOff = members.length > 0 && excluded.size >= members.length;

  const days = useMemo(() => weekDates(Date.now()), []);
  const memberColor = useMemo(() => {
    const map = new Map<string, string>();
    members.forEach((m) => map.set(m.id, m.color ?? "#71717a"));
    return (id: string) => map.get(id) ?? "#71717a";
  }, [members]);

  // 팀원 표시 순서 (members 배열 순) — 날짜 칸 안 그룹 정렬용
  const memberIndex = useMemo(() => {
    const map = new Map<string, number>();
    members.forEach((m, i) => map.set(m.id, i));
    return (id: string) => map.get(id) ?? 999;
  }, [members]);

  // 날짜 칸 안에서 팀원별 묶음 접기: collapsed 에 담긴 `${date}|${memberId}` 는 접힘 (기본=펼침)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggleCollapse = (date: string, memberId: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      const k = `${date}|${memberId}`;
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  // 이번 주 + 담당자 토글 적용
  const byDate = useMemo(() => {
    const map = new Map<string, DailyTask[]>();
    for (const t of tasks) {
      if (!days.includes(t.date)) continue;
      if (excluded.has(t.memberId)) continue;
      const arr = map.get(t.date);
      if (arr) arr.push(t);
      else map.set(t.date, [t]);
    }
    return map;
  }, [tasks, days, excluded]);

  const weekTotal = days.reduce((sum, d) => sum + (byDate.get(d)?.length ?? 0), 0);

  return (
    <Card className="mb-6">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-800">
          주간 업무 <span className="ml-1 text-xs font-normal text-zinc-400">{weekRangeLabel(Date.now())}</span>
        </h2>
        <Link href="/neander/tasks" className="text-xs text-indigo-600 hover:underline">
          일일업무 →
        </Link>
      </div>

      {/* 담당자별 토글 (각자 켜고 끌 수 있음) */}
      <div className="mb-3 flex flex-wrap gap-1.5">
        <FilterTab active={allOn} onClick={() => setExcluded(new Set())}>
          전체
        </FilterTab>
        {members.map((m) => (
          <FilterTab
            key={m.id}
            active={!excluded.has(m.id)}
            color={m.color ?? "#71717a"}
            onClick={() => toggleMember(m.id)}
          >
            {m.name}
          </FilterTab>
        ))}
      </div>

      {weekTotal === 0 ? (
        <p className="py-10 text-center text-sm text-zinc-400">
          {allOff ? "표시할 팀원을 선택하세요." : "이번 주 등록된 업무가 없습니다."}
        </p>
      ) : (
        <div className="-mx-1 overflow-x-auto px-1">
          <div className="grid grid-cols-7 gap-2 min-w-[680px] md:min-w-0">
          {days.map((d, i) => {
            const dayTasks = [...(byDate.get(d) ?? [])].sort((a, b) => a.createdAt - b.createdAt);
            const isToday = d === today;
            return (
              <div
                key={d}
                className={cn(
                  "flex min-h-[200px] flex-col gap-1 rounded-lg border p-2",
                  isToday ? "border-indigo-300 bg-indigo-50/50" : "border-zinc-100",
                )}
              >
                <div className="flex items-baseline justify-between border-b border-zinc-100 pb-1">
                  <span
                    className={cn(
                      "text-xs font-semibold",
                      i === 0 ? "text-red-400" : i === 6 ? "text-blue-400" : "text-zinc-500",
                    )}
                  >
                    {WEEKDAYS[i]}
                  </span>
                  <span className={cn("text-xs", isToday ? "font-bold text-indigo-600" : "text-zinc-400")}>
                    {Number(d.slice(8, 10))}
                  </span>
                </div>
                <div className="flex flex-col gap-1.5 overflow-y-auto">
                  {groupByMember(dayTasks, memberIndex).map((g) => {
                    // 팀원별 묶음: 이름 토글 1회 + 그 아래 그 팀원의 (여러) 업무 (단건 포함 항상)
                    const open = !collapsed.has(`${d}|${g.memberId}`);
                    const ext = g.items.filter((t) => t.status === "extended").length;
                    const hold = g.items.filter((t) => t.status === "on_hold").length;
                    return (
                      <div key={g.memberId} className="rounded-md border border-zinc-100 bg-zinc-50/60">
                        <button
                          type="button"
                          onClick={() => toggleCollapse(d, g.memberId)}
                          aria-expanded={open}
                          className="flex min-h-[32px] w-full items-center gap-1 rounded-md px-1.5 py-1 text-left active:bg-zinc-100"
                          title={`${g.memberName} · ${g.items.length}건`}
                        >
                          <span
                            className="h-1.5 w-1.5 shrink-0 rounded-full"
                            style={{ backgroundColor: memberColor(g.memberId) }}
                          />
                          <span className="truncate text-[11px] font-semibold text-zinc-600">
                            {g.memberName}
                          </span>
                          <span className="shrink-0 text-[10px] text-zinc-400">{g.items.length}</span>
                          {ext > 0 && (
                            <span className="shrink-0 rounded-sm bg-yellow-200 px-1 text-[9px] font-semibold leading-tight text-yellow-800">
                              연장 {ext}
                            </span>
                          )}
                          {hold > 0 && (
                            <span className="shrink-0 rounded-sm bg-orange-100 px-1 text-[9px] font-semibold leading-tight text-orange-700">
                              보류 {hold}
                            </span>
                          )}
                          <span className="ml-auto shrink-0 px-0.5 text-[11px] font-semibold leading-none text-zinc-500">
                            {open ? "▾" : "▸"}
                          </span>
                        </button>
                        {open && (
                          <div className="flex flex-col gap-0.5 px-1 pb-1">
                            {g.items.map((t) => (
                              <div
                                key={t.id}
                                className={cn(
                                  "rounded px-1.5 py-0.5 text-[11px] leading-tight",
                                  t.status === "extended"
                                    ? "bg-yellow-200 text-yellow-800"
                                    : t.status === "done"
                                      ? "bg-white text-zinc-400 line-through"
                                      : "bg-white text-zinc-700",
                                )}
                                title={`${t.memberName}: ${t.title}`}
                              >
                                <span className="line-clamp-2 break-words">{t.title}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
          </div>
        </div>
      )}
    </Card>
  );
}

function FilterTab({
  active,
  color,
  onClick,
  children,
}: {
  active: boolean;
  color?: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition",
        active ? "bg-indigo-600 text-white" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200",
      )}
    >
      {color && (
        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
      )}
      {children}
    </button>
  );
}

function StatCard({
  label,
  value,
  href,
  accent,
  badge,
  onToggle,
  open,
}: {
  label: string;
  value: string;
  href?: string;
  accent?: boolean;
  /** 값 옆 작은 표시 (예: 미확인 'N') */
  badge?: string;
  /** 지정 시 Link 대신 펼침 토글 버튼으로 렌더 (▸/▾) */
  onToggle?: () => void;
  open?: boolean;
}) {
  const cardCls = accent
    ? "rounded-xl bg-indigo-600 p-4 text-white shadow-sm transition hover:bg-indigo-700"
    : "rounded-xl border border-zinc-200 bg-white p-4 shadow-sm transition hover:border-indigo-300";
  const inner = (
    <>
      <div className="flex items-center justify-between gap-1">
        <span className={accent ? "text-xs text-indigo-100" : "text-xs text-zinc-400"}>{label}</span>
        {onToggle && (
          <span className="text-[11px] font-semibold leading-none text-zinc-400">
            {open ? "▾" : "▸"}
          </span>
        )}
      </div>
      <div className="mt-1 flex items-center gap-1.5">
        <span className={accent ? "text-xl font-bold" : "text-xl font-bold text-zinc-900"}>{value}</span>
        {badge && (
          <span className="rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">
            {badge}
          </span>
        )}
      </div>
    </>
  );

  if (onToggle) {
    return (
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={cn(cardCls, "text-left", open && "border-indigo-300 bg-indigo-50/40")}
      >
        {inner}
      </button>
    );
  }
  return (
    <Link href={href ?? "#"} className={cardCls}>
      {inner}
    </Link>
  );
}
