"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useAppData } from "@/components/neander/app-data";
import { Card, Badge, EmptyState, cn } from "@/components/neander/ui";
import {
  SALES_CHANNELS,
  taskStatusLabel,
  type SalesChannel,
  type DailyTask,
  type Member,
} from "@/lib/neander/types";
import {
  formatKRW,
  thisMonthStr,
  todayStr,
  formatDateKo,
  isInMonth,
  weekDates,
  weekRangeLabel,
} from "@/lib/neander/format";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

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

  const openTasks = tasks.filter((t) => t.status !== "done");
  const todayTasks = tasks.filter((t) => t.date === today);
  const myReceived = currentMember
    ? requests.filter((r) => r.toId === currentMember.id && r.status !== "done")
    : [];

  const recentTasks = [...tasks]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 5);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900">
          {currentMember ? `안녕하세요, ${currentMember.name}님 👋` : "대시보드"}
        </h1>
        <p className="mt-1 text-sm text-zinc-500">{month} 현황 요약</p>
      </div>

      {/* 상단 지표 */}
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="이번 달 매출" value={formatKRW(totalSales)} href="/neander/sales" accent />
        <StatCard label="미완료 업무" value={`${openTasks.length}건`} href="/neander/tasks" />
        <StatCard label="오늘 등록 업무" value={`${todayTasks.length}건`} href="/neander/tasks" />
        <StatCard label="내 받은 요청" value={`${myReceived.length}건`} href="/neander/requests" />
      </div>

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
            <h2 className="text-sm font-semibold text-zinc-800">내 받은 요청 (미완료)</h2>
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

        {/* 최근 업무 */}
        <Card>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-zinc-800">최근 등록 업무</h2>
            <Link href="/neander/tasks" className="text-xs text-indigo-600 hover:underline">
              전체 →
            </Link>
          </div>
          {recentTasks.length === 0 ? (
            <EmptyState icon="✅" title="등록된 업무가 없습니다" />
          ) : (
            <ul className="flex flex-col gap-2">
              {recentTasks.map((t) => (
                <li key={t.id} className="flex items-center gap-2 text-sm">
                  <span className="text-xs text-zinc-400">{t.memberName}</span>
                  <span className="flex-1 truncate text-zinc-700">{t.title}</span>
                  <Badge>{taskStatusLabel(t.status)}</Badge>
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
        <div className="grid grid-cols-7 gap-2">
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
                  {dayTasks.map((t) => (
                    <div
                      key={t.id}
                      className={cn(
                        "rounded-md px-1.5 py-1 text-[11px] leading-tight",
                        t.status === "extended"
                          ? "bg-yellow-200 text-yellow-800"
                          : t.status === "done"
                            ? "bg-zinc-50 text-zinc-400 line-through"
                            : "bg-zinc-50 text-zinc-700",
                      )}
                      title={`${t.memberName}: ${t.title}`}
                    >
                      <div className="flex items-center gap-1">
                        <span
                          className="h-1.5 w-1.5 shrink-0 rounded-full"
                          style={{ backgroundColor: memberColor(t.memberId) }}
                        />
                        <span className="truncate font-medium text-zinc-500">{t.memberName}</span>
                      </div>
                      <div className="mt-0.5 line-clamp-2 break-words">{t.title}</div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
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
}: {
  label: string;
  value: string;
  href: string;
  accent?: boolean;
}) {
  return (
    <Link
      href={href}
      className={
        accent
          ? "rounded-xl bg-indigo-600 p-4 text-white shadow-sm transition hover:bg-indigo-700"
          : "rounded-xl border border-zinc-200 bg-white p-4 shadow-sm transition hover:border-indigo-300"
      }
    >
      <div className={accent ? "text-xs text-indigo-100" : "text-xs text-zinc-400"}>{label}</div>
      <div className={accent ? "mt-1 text-xl font-bold" : "mt-1 text-xl font-bold text-zinc-900"}>
        {value}
      </div>
    </Link>
  );
}
