"use client";

import type { WorkShift, Task, CalendarEvent } from "@/lib/types";
import {
  getMonthMatrix,
  formatKoreanMonth,
  weekdayKo,
  isWithinRange,
} from "@/lib/date";
import { tasksForDate } from "./taskMatch";

interface CalendarProps {
  year: number;
  month: number; // 1-base
  selectedDate: string; // YYYY-MM-DD
  seoulToday: string; // 서울(KST) 기준 오늘 YYYY-MM-DD
  shifts: WorkShift[];
  tasks: Task[];
  events: CalendarEvent[];
  // `${taskId}_${date}` -> checked (월범위 완료 여부)
  monthChecks: Record<string, boolean>;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  onSelect: (ymd: string) => void;
}

const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];

export default function Calendar({
  year,
  month,
  selectedDate,
  seoulToday,
  shifts,
  tasks,
  events,
  monthChecks,
  onPrev,
  onNext,
  onToday,
  onSelect,
}: CalendarProps) {
  const weeks = getMonthMatrix(year, month);

  // 날짜별 빠른 조회를 위해 그룹핑
  const shiftsByDate = new Map<string, WorkShift[]>();
  for (const s of shifts) {
    const arr = shiftsByDate.get(s.date);
    if (arr) arr.push(s);
    else shiftsByDate.set(s.date, [s]);
  }

  return (
    <div>
      {/* 헤더: 월 이동 */}
      <div className="mb-4 flex items-center justify-between">
        <p className="text-lg font-bold text-gray-900">
          {formatKoreanMonth(year, month)}
        </p>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onToday}
            className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-brand-dark hover:bg-brand-light"
          >
            오늘
          </button>
          <button
            type="button"
            onClick={onPrev}
            aria-label="이전 달"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100"
          >
            ‹
          </button>
          <button
            type="button"
            onClick={onNext}
            aria-label="다음 달"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100"
          >
            ›
          </button>
        </div>
      </div>

      {/* 요일 헤더 */}
      <div className="grid grid-cols-7 gap-1 sm:gap-1.5">
        {WEEKDAYS.map((wd) => (
          <div
            key={wd}
            className={
              "pb-1 text-center text-xs font-semibold " +
              (wd === 0
                ? "text-red-500"
                : wd === 6
                ? "text-blue-500"
                : "text-gray-400")
            }
          >
            {weekdayKo(wd)}
          </div>
        ))}
      </div>

      {/* 날짜 그리드 */}
      <div className="grid grid-cols-7 gap-1 sm:gap-1.5">
        {weeks.flat().map((cell) => {
          // 아이디(id) 근무자를 위에, 와우(wow) 근무자를 아래에 정렬
          const cellShifts = [...(shiftsByDate.get(cell.ymd) ?? [])].sort(
            (a, b) => (a.store === "id" ? 0 : 1) - (b.store === "id" ? 0 : 1)
          );
          const cellTasks = tasksForDate(tasks, cell.ymd);
          const cellEvents = events.filter((e) =>
            isWithinRange(cell.ymd, e.startDate, e.endDate)
          );
          const isSelected = cell.ymd === selectedDate;
          const isToday = cell.ymd === seoulToday;
          const isPast = cell.ymd < seoulToday;
          const hasTask = cellTasks.length > 0;
          // 과거 날짜에 완료되지 않은 업무가 하나라도 있으면 미완료 경고
          const hasIncomplete =
            hasTask &&
            cellTasks.some(
              (t) => monthChecks[`${t.id}_${cell.ymd}`] !== true
            );
          const showWarn = isPast && hasIncomplete;

          return (
            <button
              type="button"
              key={cell.ymd}
              onClick={() => onSelect(cell.ymd)}
              aria-pressed={isSelected}
              className={
                "flex min-h-[64px] flex-col rounded-xl border p-1 text-left transition-colors sm:min-h-[88px] sm:p-1.5 " +
                (isSelected
                  ? "border-brand bg-brand-light ring-1 ring-brand"
                  : isPast
                  ? "border-gray-100 bg-gray-50/70"
                  : "border-gray-100 hover:bg-gray-50") +
                (cell.inMonth ? "" : " opacity-40")
              }
            >
              {/* 날짜 숫자 + 마커 */}
              <div className="flex items-center justify-between">
                <span
                  className={
                    "flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold " +
                    (isToday
                      ? "bg-brand text-white"
                      : cell.weekday === 0
                      ? isPast
                        ? "text-red-300"
                        : "text-red-500"
                      : cell.weekday === 6
                      ? isPast
                        ? "text-blue-300"
                        : "text-blue-500"
                      : isPast
                      ? "text-gray-400"
                      : "text-gray-700")
                  }
                >
                  {cell.day}
                </span>
                {showWarn ? (
                  <span
                    className="text-xs font-bold leading-none text-red-500"
                    title="미완료 업무가 있습니다"
                    aria-label="미완료 업무 있음"
                  >
                    ❗
                  </span>
                ) : hasTask ? (
                  <span
                    className="text-xs leading-none"
                    title={`${cellTasks.length}건의 업무`}
                    aria-label={`${cellTasks.length}건의 업무`}
                  >
                    🔔
                  </span>
                ) : null}
              </div>

              {/* 근무 스케줄 요약 (매장 색) - 근무자 전원 표시 */}
              <div className="mt-1 flex-1 space-y-0.5">
                {cellShifts.map((s) => (
                  <div
                    key={s.id}
                    className={
                      "truncate rounded px-1 py-0.5 text-[10px] font-medium leading-tight sm:text-[11px] " +
                      (s.store === "id"
                        ? "bg-brand-light text-brand-dark"
                        : "bg-wow-light text-wow")
                    }
                    title={`${s.staffName} (${s.start}~${s.end})`}
                  >
                    {s.staffName}
                  </div>
                ))}
              </div>

              {/* 생일 이벤트 마커 (점) */}
              {cellEvents.length > 0 ? (
                <div className="mt-0.5 flex flex-wrap items-center gap-0.5">
                  {cellEvents.slice(0, 4).map((e) => (
                    <span
                      key={e.id}
                      className="inline-block h-1.5 w-1.5 rounded-full"
                      style={{ backgroundColor: e.color || "#ff8a3d" }}
                      title={e.title}
                      aria-hidden
                    />
                  ))}
                </div>
              ) : null}
            </button>
          );
        })}
      </div>

      {/* 범례 */}
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
        <span className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded bg-brand-light ring-1 ring-brand/30" />
          악센트 아이디
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded bg-wow-light ring-1 ring-wow/30" />
          악센트 와우
        </span>
        <span className="flex items-center gap-1">🔔 업무</span>
        <span className="flex items-center gap-1">❗ 미완료</span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-wow" />
          생일 이벤트
        </span>
      </div>
    </div>
  );
}
