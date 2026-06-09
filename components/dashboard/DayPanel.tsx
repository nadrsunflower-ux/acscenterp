"use client";

import type { Store, WorkShift, Task, CalendarEvent } from "@/lib/types";
import { formatKoreanDate, formatMonthDay } from "@/lib/date";
import { storeLabel } from "@/lib/content";
import Badge from "@/components/ui/Badge";
import TaskChecklist, { type CheckState } from "./TaskChecklist";

type StoreFilter = "all" | Store;

interface DayPanelProps {
  // 선택한 날짜 (YYYY-MM-DD)
  date: string;
  // 매장 필터 (all 이면 두 매장 모두 표시)
  storeFilter: StoreFilter;
  shifts: WorkShift[];
  tasks: Task[];
  events: CalendarEvent[];
  // taskId -> {checked, note, approved}
  checks: Record<string, CheckState>;
  onChecked: (taskId: string, checked: boolean) => void;
  onNote: (taskId: string, note: string) => void;
  onApproved: (taskId: string, approved: boolean) => void;
  // Firebase 미설정 시 체크 저장 불가
  checkDisabled?: boolean;
}

// 매장 안의 소제목
function SubTitle({ children }: { children: React.ReactNode }) {
  return (
    <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-400">
      {children}
    </h4>
  );
}

function EmptyBox({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-xl bg-gray-50 px-3 py-3 text-center text-sm text-gray-400">
      {children}
    </p>
  );
}

const SHIFT_TYPE_LABEL: Record<string, string> = {
  basic: "기본",
  extended: "확장",
};

const STORE_STYLE: Record<Store, { dot: string; bar: string; barBg: string }> =
  {
    id: { dot: "bg-brand", bar: "text-brand-dark", barBg: "bg-brand-light/60" },
    wow: { dot: "bg-wow", bar: "text-orange-700", barBg: "bg-orange-50" },
  };

// 한 매장(아이디 or 와우)의 근무·업무·생일이벤트 묶음
function StoreBlock({
  store,
  date,
  shifts,
  tasks,
  events,
  checks,
  onChecked,
  onNote,
  onApproved,
  checkDisabled,
}: {
  store: Store;
  date: string;
  shifts: WorkShift[];
  tasks: Task[];
  events: CalendarEvent[];
  checks: Record<string, CheckState>;
  onChecked: (taskId: string, checked: boolean) => void;
  onNote: (taskId: string, note: string) => void;
  onApproved: (taskId: string, approved: boolean) => void;
  checkDisabled: boolean;
}) {
  const style = STORE_STYLE[store];
  const storeShifts = shifts.filter((s) => s.store === store);
  const storeTasks = tasks.filter((t) => t.store === store);
  // 생일 이벤트: 해당 매장 + 'all'(전 매장 공통)
  const storeEvents = events.filter(
    (e) => e.store === store || e.store === "all"
  );

  return (
    <div className="space-y-4">
      {/* 매장 헤더 */}
      <div
        className={`flex items-center gap-2 rounded-xl px-3 py-2 ${style.barBg}`}
      >
        <span className={`h-2.5 w-2.5 rounded-full ${style.dot}`} />
        <span className={`text-base font-bold ${style.bar}`}>
          {storeLabel[store]}
        </span>
      </div>

      {/* 근무 스케줄 */}
      <section>
        <SubTitle>근무 스케줄</SubTitle>
        {storeShifts.length === 0 ? (
          <EmptyBox>등록된 근무가 없습니다.</EmptyBox>
        ) : (
          <ul className="space-y-2">
            {storeShifts.map((s) => (
              <li
                key={s.id}
                className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-3 py-2.5"
              >
                <span
                  className={`h-9 w-1.5 shrink-0 rounded-full ${style.dot}`}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-1.5 text-sm font-semibold text-gray-900">
                    {s.staffName || (
                      <span className="text-gray-300">(미입력)</span>
                    )}
                    <Badge color="gray">
                      {SHIFT_TYPE_LABEL[s.shiftType] ?? "기본"}
                    </Badge>
                  </p>
                  <p className="mt-0.5 text-xs text-gray-500">
                    {s.start} ~ {s.end}
                    {s.memo ? ` · ${s.memo}` : ""}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 업무 체크리스트 */}
      <section>
        <SubTitle>업무 체크리스트</SubTitle>
        <TaskChecklist
          date={date}
          tasks={storeTasks}
          checks={checks}
          onChecked={onChecked}
          onNote={onNote}
          onApproved={onApproved}
          disabled={checkDisabled}
          hideStore
        />
      </section>

      {/* 생일 이벤트 */}
      <section>
        <SubTitle>생일 이벤트</SubTitle>
        {storeEvents.length === 0 ? (
          <EmptyBox>생일 이벤트가 없습니다.</EmptyBox>
        ) : (
          <ul className="space-y-2">
            {storeEvents.map((e) => (
              <li
                key={e.id}
                className="rounded-xl border border-gray-200 bg-white px-3 py-2.5"
              >
                <p className="flex flex-wrap items-center gap-1.5 text-sm font-semibold text-gray-900">
                  <span
                    className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: e.color || "#7c5cff" }}
                    aria-hidden
                  />
                  {e.title}
                  {e.store === "all" ? <Badge color="gray">공통</Badge> : null}
                </p>
                <p className="mt-0.5 text-xs text-gray-500">
                  {formatMonthDay(e.startDate)} ~ {formatMonthDay(e.endDate)}
                  {e.memo ? ` · ${e.memo}` : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export default function DayPanel({
  date,
  storeFilter,
  shifts,
  tasks,
  events,
  checks,
  onChecked,
  onNote,
  onApproved,
  checkDisabled = false,
}: DayPanelProps) {
  const stores: Store[] = storeFilter === "all" ? ["id", "wow"] : [storeFilter];

  return (
    <div className="space-y-6">
      <div>
        <p className="text-base font-bold text-gray-900">
          {formatKoreanDate(date)}
        </p>
        <p className="mt-0.5 text-xs text-gray-400">선택한 날짜의 상세 정보</p>
      </div>

      {checkDisabled && tasks.length > 0 ? (
        <p className="text-xs text-orange-500">
          Firebase 미설정 상태입니다. 체크 상태는 저장되지 않습니다.
        </p>
      ) : null}

      {stores.map((store) => (
        <StoreBlock
          key={store}
          store={store}
          date={date}
          shifts={shifts}
          tasks={tasks}
          events={events}
          checks={checks}
          onChecked={onChecked}
          onNote={onNote}
          onApproved={onApproved}
          checkDisabled={checkDisabled}
        />
      ))}
    </div>
  );
}
