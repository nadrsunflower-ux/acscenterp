"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Store, WorkShift, Task, CalendarEvent, TaskCheck } from "@/lib/types";
import {
  listScheduleShifts,
  listTasks,
  listEvents,
  getTaskChecks,
  listTaskChecks,
  isFirebaseConfigured,
} from "@/lib/db";
import {
  seoulTodayYMD,
  formatYMD,
  daysInMonth,
  addMonths,
  parseYMD,
} from "@/lib/date";
import { storeLabel } from "@/lib/content";
import Section from "@/components/ui/Section";
import Calendar from "@/components/dashboard/Calendar";
import DayPanel from "@/components/dashboard/DayPanel";
import type { CheckState } from "@/components/dashboard/TaskChecklist";
import { tasksForDate } from "@/components/dashboard/taskMatch";

type StoreFilter = "all" | Store;

const STORE_FILTERS: { value: StoreFilter; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "id", label: storeLabel.id },
  { value: "wow", label: storeLabel.wow },
];

export default function DashboardPage() {
  // 서울(KST) 기준 오늘
  const seoulToday = seoulTodayYMD();
  const todayDate = parseYMD(seoulToday);

  // 현재 보고 있는 월
  const [year, setYear] = useState(todayDate.getFullYear());
  const [month, setMonth] = useState(todayDate.getMonth() + 1); // 1-base
  // 선택한 날짜
  const [selectedDate, setSelectedDate] = useState(seoulToday);
  // 매장 필터
  const [storeFilter, setStoreFilter] = useState<StoreFilter>("all");

  // 원본 데이터 (해당 월 + 인접 범위)
  const [shifts, setShifts] = useState<WorkShift[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  // 선택 날짜의 체크/비고 상태 (taskId -> {checked, note})
  const [checks, setChecks] = useState<Record<string, CheckState>>({});
  // 월 범위 완료 여부 (key = `${taskId}_${date}` -> checked) — 캘린더 미완료 마커용
  const [monthChecks, setMonthChecks] = useState<Record<string, boolean>>({});
  // 월 범위 관리자 확인 여부 (key = `${taskId}_${date}` -> approved) — 미완료 집계 제외용
  const [monthApprovals, setMonthApprovals] = useState<Record<string, boolean>>(
    {}
  );

  const [loading, setLoading] = useState(true);
  const configured = isFirebaseConfigured();

  // 표시 월의 그리드 범위(앞뒤 달 일부 포함)를 넉넉히 잡아 from/to 산출.
  const range = useMemo(() => {
    const base = new Date(year, month - 1, 1);
    const fromDate = addMonths(base, -1);
    const from = formatYMD(fromDate.getFullYear(), fromDate.getMonth() + 1, 1);
    const toDate = addMonths(base, 1);
    const toY = toDate.getFullYear();
    const toM = toDate.getMonth() + 1;
    const to = formatYMD(toY, toM, daysInMonth(toY, toM));
    return { from, to };
  }, [year, month]);

  // 월/매장 변경 시 데이터 로드 (근무·업무·이벤트 + 월범위 체크상태)
  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    const storeOpt: Store | undefined =
      storeFilter === "all" ? undefined : storeFilter;

    async function load() {
      try {
        const [shiftRows, taskRows, eventRows, checkRows] = await Promise.all([
          listScheduleShifts({ store: storeOpt, from: range.from, to: range.to }),
          listTasks(storeOpt),
          listEvents({ store: storeOpt, from: range.from, to: range.to }),
          listTaskChecks({ from: range.from, to: range.to }),
        ]);
        if (cancelled) return;
        setShifts(shiftRows);
        setTasks(taskRows);
        setEvents(eventRows);
        const m: Record<string, boolean> = {};
        const a: Record<string, boolean> = {};
        for (const r of checkRows) {
          m[`${r.taskId}_${r.date}`] = !!r.checked;
          a[`${r.taskId}_${r.date}`] = !!r.adminApproved;
        }
        setMonthChecks(m);
        setMonthApprovals(a);
      } catch {
        if (cancelled) return;
        setShifts([]);
        setTasks([]);
        setEvents([]);
        setMonthChecks({});
        setMonthApprovals({});
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [range.from, range.to, storeFilter]);

  // 선택 날짜 변경 시 그 날 체크/비고 상태 로드
  useEffect(() => {
    let cancelled = false;
    async function loadChecks() {
      try {
        const rows: TaskCheck[] = await getTaskChecks(selectedDate);
        if (cancelled) return;
        const map: Record<string, CheckState> = {};
        for (const r of rows)
          map[r.taskId] = {
            checked: !!r.checked,
            note: r.note ?? "",
            approved: !!r.adminApproved,
          };
        setChecks(map);
      } catch {
        if (!cancelled) setChecks({});
      }
    }
    loadChecks();
    return () => {
      cancelled = true;
    };
  }, [selectedDate]);

  // 완료/미완료 토글(낙관적) — 선택 날짜 + 월범위 마커 동시 갱신
  const handleChecked = useCallback(
    (taskId: string, checked: boolean) => {
      setChecks((prev) => ({
        ...prev,
        [taskId]: {
          checked,
          note: prev[taskId]?.note ?? "",
          approved: prev[taskId]?.approved ?? false,
        },
      }));
      setMonthChecks((prev) => ({
        ...prev,
        [`${taskId}_${selectedDate}`]: checked,
      }));
    },
    [selectedDate]
  );

  // 비고 입력(낙관적)
  const handleNote = useCallback((taskId: string, note: string) => {
    setChecks((prev) => ({
      ...prev,
      [taskId]: {
        checked: prev[taskId]?.checked ?? false,
        note,
        approved: prev[taskId]?.approved ?? false,
      },
    }));
  }, []);

  // 관리자 확인 토글(낙관적) — 선택 날짜 + 월범위 마커 동시 갱신
  const handleApproved = useCallback(
    (taskId: string, approved: boolean) => {
      setChecks((prev) => ({
        ...prev,
        [taskId]: {
          checked: prev[taskId]?.checked ?? false,
          note: prev[taskId]?.note ?? "",
          approved,
        },
      }));
      setMonthApprovals((prev) => ({
        ...prev,
        [`${taskId}_${selectedDate}`]: approved,
      }));
    },
    [selectedDate]
  );

  // 월 이동 핸들러
  const goPrev = useCallback(() => {
    const d = addMonths(new Date(year, month - 1, 1), -1);
    setYear(d.getFullYear());
    setMonth(d.getMonth() + 1);
  }, [year, month]);

  const goNext = useCallback(() => {
    const d = addMonths(new Date(year, month - 1, 1), 1);
    setYear(d.getFullYear());
    setMonth(d.getMonth() + 1);
  }, [year, month]);

  const goToday = useCallback(() => {
    const t = seoulTodayYMD();
    const d = parseYMD(t);
    setYear(d.getFullYear());
    setMonth(d.getMonth() + 1);
    setSelectedDate(t);
  }, []);

  // 선택 날짜의 상세 데이터
  const dayShifts = useMemo(
    () => shifts.filter((s) => s.date === selectedDate),
    [shifts, selectedDate]
  );
  const dayTasks = useMemo(
    () => tasksForDate(tasks, selectedDate),
    [tasks, selectedDate]
  );
  const dayEvents = useMemo(
    () =>
      events.filter(
        (e) => selectedDate >= e.startDate && selectedDate <= e.endDate
      ),
    [events, selectedDate]
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">대시보드</h1>
        <p className="mt-1 text-sm text-gray-500">
          근무 스케줄과 업무 체크리스트, 생일 이벤트를 한눈에 확인하세요.
        </p>
      </div>

      {!configured ? (
        <div className="card border-l-4 border-orange-400 p-4 text-sm text-gray-700">
          <p className="font-semibold text-orange-600">Firebase 미설정</p>
          <p className="mt-1 text-gray-500">
            데이터 연결이 설정되지 않아 근무/업무/이벤트가 비어 있습니다.
            관리자 환경변수(NEXT_PUBLIC_FIREBASE_*) 설정 후 표시됩니다.
          </p>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* 캘린더 */}
        <div className="lg:col-span-2">
          <Section
            title="월간 캘린더"
            subtitle={loading ? "불러오는 중…" : "날짜를 선택하면 상세가 표시됩니다."}
            action={
              <div className="flex items-center gap-1 rounded-xl bg-gray-100 p-1">
                {STORE_FILTERS.map((f) => (
                  <button
                    key={f.value}
                    type="button"
                    onClick={() => setStoreFilter(f.value)}
                    className={
                      "rounded-lg px-2.5 py-1 text-xs font-medium transition-colors " +
                      (storeFilter === f.value
                        ? "bg-white text-brand-dark shadow-sm"
                        : "text-gray-500 hover:text-gray-700")
                    }
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            }
          >
            <Calendar
              year={year}
              month={month}
              selectedDate={selectedDate}
              seoulToday={seoulToday}
              shifts={shifts}
              tasks={tasks}
              events={events}
              monthChecks={monthChecks}
              monthApprovals={monthApprovals}
              onPrev={goPrev}
              onNext={goNext}
              onToday={goToday}
              onSelect={setSelectedDate}
            />
          </Section>
        </div>

        {/* 선택 날짜 패널 */}
        <div className="lg:col-span-1">
          <Section title="선택한 날짜">
            <DayPanel
              date={selectedDate}
              storeFilter={storeFilter}
              shifts={dayShifts}
              tasks={dayTasks}
              events={dayEvents}
              checks={checks}
              onChecked={handleChecked}
              onNote={handleNote}
              onApproved={handleApproved}
              checkDisabled={!configured}
            />
          </Section>
        </div>
      </div>
    </div>
  );
}
