"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Check, ChevronRight, ThumbsUp } from "lucide-react";
import { useAppData } from "@/components/neander/app-data";
import { useAuth } from "@/components/neander/auth";
import { fetchSalesSummary, type SalesMonthSummary } from "@/lib/neander/sales/client";
import { storeLabel } from "@/lib/neander/sales/types";
import {
  Badge,
  Card,
  DateStepper,
  Icon,
  KpiItem,
  KpiStrip,
  SectionHeader,
  SegmentedControl,
  cn,
} from "@/components/neander/ui";
import {
  taskStatusLabel,
  taskCategoryLabel,
  taskCategoryColor,
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
  weekDatesOf,
  weekLabelOf,
  addDays,
  shiftMonth,
  monthGrid,
  monthLabel,
} from "@/lib/neander/format";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
const DEFAULT_MEMBER_COLOR = "#71717a"; // 팀원 색이 비어 있을 때의 데이터 기본값

/** 요일 글자색 — 일요일·토요일만 구분 */
const weekdayText = (i: number, base = "text-nd-fg-3") =>
  i === 0 ? "text-nd-danger" : i === 6 ? "text-nd-info" : base;

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
  const { tasks, requests, members, currentMember } = useAppData();
  const { user } = useAuth();
  const month = thisMonthStr();
  const today = todayStr();

  // 매출은 매출 모듈(단위경제)에서 가져온다. 판매 줄 전체가 아니라 이 달
  // 요약만 받는다 — 타일 하나에 만 건을 끌어올 이유가 없다.
  const [salesSummary, setSalesSummary] = useState<SalesMonthSummary | null>(null);
  const [salesError, setSalesError] = useState(false);
  useEffect(() => {
    if (!user) return;
    let alive = true;
    fetchSalesSummary(month)
      .then((s) => {
        if (alive) setSalesSummary(s);
      })
      .catch(() => {
        // 매출 접근 권한이 없을 수도 있다 — 대시보드 전체를 깨뜨리지 않는다
        if (alive) setSalesError(true);
      });
    return () => {
      alive = false;
    };
  }, [user, month]);

  const byStore = salesSummary?.stores.filter((s) => s.revenue > 0) ?? [];
  const maxStore = Math.max(1, ...byStore.map((s) => s.revenue));

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

  const kpiLink = "block transition-colors duration-nd-fast hover:!bg-nd-sunken";

  return (
    <div className="mx-auto w-full max-w-[1400px]">
      <div className="mb-6">
        <h1 className="text-nd-display text-nd-fg">
          {currentMember ? `안녕하세요, ${currentMember.name}님 👋` : "대시보드"}
        </h1>
        <p className="mt-1 text-nd-body text-nd-fg-2">{month} 현황 요약</p>
      </div>

      {/* 상단 지표 */}
      <KpiStrip columns={4} className="mb-3">
        <Link href="/neander/sales" className={kpiLink}>
          <KpiItem
            label="이번 달 매출"
            value={salesSummary ? formatKRW(salesSummary.revenue) : salesError ? "—" : "…"}
            tone="accent"
            hint={
              salesSummary
                ? `공헌이익률 ${salesSummary.contributionRate === null ? "—" : `${(salesSummary.contributionRate * 100).toFixed(1)}%`}`
                : "매출로 이동"
            }
          />
        </Link>
        <Link href="/neander/tasks" className={kpiLink}>
          <KpiItem label="오늘의 업무" value={myTodayTasks.length} unit="건" hint="일일업무로 이동" />
        </Link>
        <button
          type="button"
          onClick={() => setShowOpen((v) => !v)}
          aria-expanded={showOpen}
          aria-controls="dash-open-tasks"
          className={cn(kpiLink, "w-full text-left", showOpen && "!bg-nd-accent-soft/40")}
        >
          <KpiItem
            label="미완료 업무"
            value={myOpenTasks.length}
            unit="건"
            hint={showOpen ? "목록 접기" : "목록 펼치기"}
            tag={
              <Icon
                icon={ChevronRight}
                size={14}
                className={cn("text-nd-fg-4 transition-transform duration-nd-fast", showOpen && "rotate-90")}
              />
            }
          />
        </button>
        <Link href="/neander/requests" className={kpiLink}>
          <KpiItem
            label="받은 요청"
            value={myReceivedToday.length}
            unit="건"
            hint="오늘 받은 요청"
            tag={
              hasUnacked ? (
                <Badge tone="danger" size="sm">
                  N
                </Badge>
              ) : undefined
            }
          />
        </Link>
      </KpiStrip>

      {/* 미완료 업무 펼침 목록 (마감기한 포함) */}
      {showOpen && (
        <Card id="dash-open-tasks" className="mb-6">
          <SectionHeader
            title="미완료 업무"
            hint={`${myOpenTasks.length}건`}
            action={
              <Link href="/neander/tasks" className="text-nd-caption font-medium text-nd-accent-strong hover:underline">
                일일업무 →
              </Link>
            }
          />
          {myOpenSorted.length === 0 ? (
            <p className="flex items-center justify-center gap-1.5 py-4 text-nd-body text-nd-fg-3">
              <Icon icon={ThumbsUp} size={15} /> 미완료 업무가 없습니다.
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-nd-line">
              {myOpenSorted.map((t) => {
                const overdue = t.date < todayKST;
                return (
                  <li key={t.id} className="flex items-center gap-2 py-2 text-nd-body">
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: taskCategoryColor(t.category) }}
                      title={taskCategoryLabel(t.category)}
                    />
                    <span className="min-w-0 flex-1 truncate text-nd-fg" title={t.title}>
                      {t.title}
                    </span>
                    <span className="shrink-0 text-nd-micro text-nd-fg-3">{taskStatusLabel(t.status)}</span>
                    <span
                      className={cn(
                        "nd-num shrink-0 text-nd-caption",
                        overdue ? "font-semibold text-nd-danger-text" : "text-nd-fg-2",
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

      <div className="grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
        {/* 매장별 매출 — 와우 · 아이디 · 온라인 */}
        <Card>
          <SectionHeader
            title={`매장별 매출 (${month})`}
            hint={
              salesSummary && salesSummary.reviewCount > 0
                ? `미확정 ${salesSummary.reviewCount.toLocaleString("ko-KR")}건`
                : undefined
            }
            action={
              <Link href="/neander/sales" className="text-nd-caption font-medium text-nd-accent-strong hover:underline">
                자세히 →
              </Link>
            }
          />
          {byStore.length === 0 ? (
            <p className="text-nd-body text-nd-fg-3">
              {salesError
                ? "매출 데이터를 볼 권한이 없습니다."
                : salesSummary
                  ? "이 달 적재된 판매가 없습니다."
                  : "불러오는 중…"}
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              {byStore.map((s) => (
                <div key={s.store}>
                  <div className="mb-1 flex justify-between text-nd-body">
                    <span className="text-nd-fg-2">
                      {storeLabel(s.store)}
                      <span className="ml-1.5 text-nd-caption text-nd-fg-3">
                        공헌 {s.contributionRate === null ? "—" : `${(s.contributionRate * 100).toFixed(0)}%`}
                      </span>
                    </span>
                    <span className="nd-num font-semibold text-nd-fg">{formatKRW(s.revenue)}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-nd-fg/[.06]">
                    <div
                      className="h-full rounded-full bg-nd-accent transition-all"
                      style={{ width: `${(s.revenue / maxStore) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* 내 받은 요청 */}
        <Card>
          <SectionHeader
            title="받은 요청 (미완료)"
            action={
              <Link href="/neander/requests" className="text-nd-caption font-medium text-nd-accent-strong hover:underline">
                전체 →
              </Link>
            }
          />
          {!currentMember ? (
            <p className="py-6 text-center text-nd-body text-nd-fg-3">
              로그인 계정이 팀원과 연결되면 받은 요청이 표시됩니다.
            </p>
          ) : myReceived.length === 0 ? (
            <p className="flex items-center justify-center gap-1.5 py-6 text-nd-body text-nd-fg-3">
              <Icon icon={ThumbsUp} size={15} /> 받은 요청이 없습니다.
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-nd-line">
              {myReceived.slice(0, 5).map((r) => (
                <li key={r.id} className="flex items-center gap-2 py-2 text-nd-body">
                  <Badge tone="accent">{r.fromName}</Badge>
                  <span className="min-w-0 flex-1 truncate text-nd-fg-2" title={r.title}>
                    {r.title}
                  </span>
                  {r.dueDate && (
                    <span className="nd-num shrink-0 text-nd-caption text-nd-fg-3">{formatDateKo(r.dueDate)}</span>
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
  // 월간 기본, 주간은 선택해서 보기
  const [mode, setMode] = useState<"week" | "month">("month");
  const [anchor, setAnchor] = useState(today);

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

  const memberColor = useMemo(() => {
    const map = new Map<string, string>();
    members.forEach((m) => map.set(m.id, m.color ?? DEFAULT_MEMBER_COLOR));
    return (id: string) => map.get(id) ?? DEFAULT_MEMBER_COLOR;
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

  const month = anchor.slice(0, 7);
  const weekDays = useMemo(() => weekDatesOf(anchor), [anchor]);
  const monthCells = useMemo(() => monthGrid(month), [month]); // (string|null)[] 6주
  const goPrev = () =>
    setAnchor((a) => (mode === "week" ? addDays(a, -7) : `${shiftMonth(a.slice(0, 7), -1)}-01`));
  const goNext = () =>
    setAnchor((a) => (mode === "week" ? addDays(a, 7) : `${shiftMonth(a.slice(0, 7), 1)}-01`));
  const goToday = () => setAnchor(today);

  // byDate 필터용 유효 날짜
  const validDays = useMemo(
    () => (mode === "week" ? weekDays : monthCells.filter((c): c is string => !!c)),
    [mode, weekDays, monthCells],
  );

  const byDate = useMemo(() => {
    const valid = new Set(validDays);
    const map = new Map<string, DailyTask[]>();
    for (const t of tasks) {
      if (!valid.has(t.date)) continue;
      if (excluded.has(t.memberId)) continue;
      const arr = map.get(t.date);
      if (arr) arr.push(t);
      else map.set(t.date, [t]);
    }
    return map;
  }, [tasks, validDays, excluded]);

  const total = validDays.reduce((sum, d) => sum + (byDate.get(d)?.length ?? 0), 0);

  // 날짜 칸 내부: 팀원별 묶음(이름 토글 + 그 아래 업무)
  const renderGroups = (d: string) => {
    const dayTasks = [...(byDate.get(d) ?? [])].sort((a, b) => a.createdAt - b.createdAt);
    return (
      <div className="flex min-w-0 flex-col gap-1.5">
        {groupByMember(dayTasks, memberIndex).map((g) => {
          const open = !collapsed.has(`${d}|${g.memberId}`);
          const ext = g.items.filter((t) => t.status === "extended").length;
          const hold = g.items.filter((t) => t.status === "on_hold").length;
          return (
            <div key={g.memberId} className="min-w-0 overflow-hidden rounded-nd-sm border border-nd-line bg-nd-sunken/60">
              <button
                type="button"
                onClick={() => toggleCollapse(d, g.memberId)}
                aria-expanded={open}
                className="flex min-h-[32px] w-full min-w-0 items-center gap-1 rounded-nd-sm px-1.5 py-1 text-left active:bg-nd-fg/[.06]"
                title={`${g.memberName} · ${g.items.length}건`}
              >
                <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: memberColor(g.memberId) }} />
                <span className="min-w-0 truncate text-nd-micro font-semibold text-nd-fg-2">{g.memberName}</span>
                <span className="nd-num shrink-0 text-nd-micro text-nd-fg-3">{g.items.length}</span>
                {ext > 0 && (
                  <Badge tone="warning" size="sm" className="shrink-0 !h-4 !px-1">
                    연장 {ext}
                  </Badge>
                )}
                {hold > 0 && (
                  <Badge tone="neutral" size="sm" className="shrink-0 !h-4 !px-1">
                    보류 {hold}
                  </Badge>
                )}
                <Icon
                  icon={ChevronRight}
                  size={12}
                  className={cn("ml-auto shrink-0 text-nd-fg-3 transition-transform duration-nd-fast", open && "rotate-90")}
                />
              </button>
              {open && (
                <div className="flex flex-col gap-0.5 px-1 pb-1">
                  {g.items.map((t) => (
                    <div
                      key={t.id}
                      className={cn(
                        "flex min-w-0 items-center gap-1 rounded-[4px] px-1.5 py-0.5 text-nd-micro leading-tight",
                        t.status === "extended"
                          ? "bg-nd-warning-soft text-nd-warning-text"
                          : t.status === "done"
                            ? "bg-nd-content text-nd-fg-3 line-through"
                            : "bg-nd-content text-nd-fg-2",
                      )}
                      title={`${t.memberName}: ${t.title}`}
                    >
                      {/* 업무가 여러 건이면 앞에 작은 체크로 구분 */}
                      {g.items.length > 1 && <Icon icon={Check} size={9} className="text-nd-fg-3" />}
                      <span className="min-w-0 truncate">{t.title}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  // 날짜 칸 (week: 요일 라벨 표시, month: 숫자만)
  const renderCell = (d: string, colIdx: number, weekdayLabel: boolean, minH: string) => {
    const isToday = d === today;
    return (
      <div
        key={d}
        className={cn(
          "flex min-w-0 flex-col gap-1 rounded-nd-md border p-1 sm:p-2",
          minH,
          isToday ? "border-nd-accent bg-nd-accent-soft/40" : "border-nd-line",
        )}
      >
        <div className="flex items-baseline justify-between border-b border-nd-line pb-1">
          {weekdayLabel ? (
            <span className={cn("text-nd-caption font-semibold", weekdayText(colIdx, "text-nd-fg-2"))}>
              {WEEKDAYS[colIdx]}
            </span>
          ) : (
            <span />
          )}
          <span
            className={cn(
              "nd-num text-nd-caption",
              isToday ? "font-bold text-nd-accent-strong" : weekdayText(colIdx),
            )}
          >
            {Number(d.slice(8, 10))}
          </span>
        </div>
        {renderGroups(d)}
      </div>
    );
  };

  return (
    <Card className="mb-6">
      {/* 헤더 + 이동 네비 + 주간/월간 전환 */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-nd-section text-nd-fg">{mode === "week" ? "주간 업무" : "월간 업무"}</h2>
          <DateStepper
            size="sm"
            icon={false}
            label={mode === "week" ? weekLabelOf(anchor) : monthLabel(month)}
            onPrev={goPrev}
            onNext={goNext}
            onToday={goToday}
          />
        </div>
        <div className="flex items-center gap-2">
          <SegmentedControl<"week" | "month">
            size="sm"
            ariaLabel="보기 단위"
            value={mode}
            onChange={setMode}
            options={[
              { value: "week", label: "주간" },
              { value: "month", label: "월간" },
            ]}
          />
          <Link href="/neander/tasks" className="text-nd-caption font-medium text-nd-accent-strong hover:underline">
            일일업무 →
          </Link>
        </div>
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
            color={m.color ?? DEFAULT_MEMBER_COLOR}
            onClick={() => toggleMember(m.id)}
          >
            {m.name}
          </FilterTab>
        ))}
      </div>

      {total === 0 ? (
        <p className="py-10 text-center text-nd-body text-nd-fg-3">
          {allOff
            ? "표시할 팀원을 선택하세요."
            : mode === "week"
              ? "이번 주 등록된 업무가 없습니다."
              : "이번 달 등록된 업무가 없습니다."}
        </p>
      ) : mode === "week" ? (
        <div className="grid grid-cols-7 gap-1 sm:gap-2">
          {weekDays.map((d, i) => renderCell(d, i, true, "min-h-[200px]"))}
        </div>
      ) : (
        <div>
          {/* 요일 헤더 */}
          <div className="mb-1 grid grid-cols-7 gap-1 sm:gap-2">
            {WEEKDAYS.map((w, i) => (
              <div key={w} className={cn("text-center text-nd-caption font-semibold", weekdayText(i))}>
                {w}
              </div>
            ))}
          </div>
          {/* 월 그리드 (6주) — 칸은 내용만큼만 차지(업무 없으면 최소화) */}
          <div className="grid grid-cols-7 gap-1 sm:gap-2">
            {monthCells.map((c, idx) =>
              c ? (
                renderCell(c, idx % 7, false, "min-h-[44px]")
              ) : (
                <div key={`e${idx}`} className="min-h-[44px] rounded-nd-md" />
              ),
            )}
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
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-nd-caption font-medium transition-colors duration-nd-fast",
        active
          ? "bg-nd-accent-soft text-nd-accent-strong"
          : "bg-nd-fg/[.06] text-nd-fg-2 hover:bg-nd-fg/10",
      )}
    >
      {color && (
        <span
          className={cn("h-2 w-2 rounded-full", !active && "opacity-40")}
          style={{ backgroundColor: color }}
        />
      )}
      {children}
    </button>
  );
}
