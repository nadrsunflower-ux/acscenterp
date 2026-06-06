"use client";

import { useEffect, useMemo, useState } from "react";
import Section from "@/components/ui/Section";
import Badge from "@/components/ui/Badge";
import type { Store, CalendarEvent } from "@/lib/types";
import {
  listEvents,
  createEvent,
  updateEvent,
  deleteEvent,
  isFirebaseConfigured,
} from "@/lib/db";
import { storeLabel } from "@/lib/content";
import {
  formatMonthDay,
  todayYMD,
  getMonthMatrix,
  addMonths,
} from "@/lib/date";
import {
  Field,
  StoreSelect,
  StatusBanner,
  FirebaseNotice,
  MiniButton,
  type StatusMessage,
} from "./adminUi";

type EventStore = Store | "all";

// 매장별 색(아이디=보라, 와우=주황, 공통=초록)
function storeColor(store: EventStore): string {
  return store === "id" ? "#7c5cff" : store === "wow" ? "#ff8a3d" : "#22c55e";
}

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
const EVENT_STORES: EventStore[] = ["id", "wow", "all"];
const STORE_HEADER: Record<
  EventStore,
  { dot: string; text: string; bg: string; label: string }
> = {
  id: {
    dot: "bg-brand",
    text: "text-brand-dark",
    bg: "bg-brand-light/60",
    label: storeLabel.id,
  },
  wow: {
    dot: "bg-wow",
    text: "text-orange-700",
    bg: "bg-orange-50",
    label: storeLabel.wow,
  },
  all: {
    dot: "bg-emerald-500",
    text: "text-emerald-700",
    bg: "bg-emerald-50",
    label: "공통",
  },
};

// "2026-06" -> "2026년 6월"
function monthLabel(ym: string): string {
  const [y, m] = ym.split("-");
  return `${y}년 ${parseInt(m, 10)}월`;
}

interface FormState {
  store: EventStore;
  title: string;
  startDate: string;
  endDate: string;
}

function emptyForm(): FormState {
  const t = todayYMD();
  return { store: "id", title: "", startDate: t, endDate: t };
}

export default function EventAdmin() {
  const configured = isFirebaseConfigured();
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<StatusMessage | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  // 목록 보기 모드
  const [viewMode, setViewMode] = useState<"month" | "store">("month");

  // 캘린더가 보고 있는 월
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1); // 1-base

  async function refresh() {
    if (!configured) return;
    setLoading(true);
    try {
      setEvents(await listEvents());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function resetForm() {
    setForm(emptyForm());
    setEditingId(null);
  }

  function startEdit(ev: CalendarEvent) {
    setEditingId(ev.id);
    setForm({
      store: ev.store,
      title: ev.title,
      startDate: ev.startDate,
      endDate: ev.endDate,
    });
    setStatus(null);
  }

  // 캘린더 날짜 클릭 → 폼 시작/종료일을 그 날짜로
  function selectDate(ymd: string) {
    setForm((f) => ({ ...f, startDate: ymd, endDate: ymd }));
  }

  function goPrevMonth() {
    const d = addMonths(new Date(year, month - 1, 1), -1);
    setYear(d.getFullYear());
    setMonth(d.getMonth() + 1);
  }
  function goNextMonth() {
    const d = addMonths(new Date(year, month - 1, 1), 1);
    setYear(d.getFullYear());
    setMonth(d.getMonth() + 1);
  }
  function goThisMonth() {
    const t = new Date();
    setYear(t.getFullYear());
    setMonth(t.getMonth() + 1);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus(null);
    if (!configured) {
      setStatus({ kind: "error", text: "Firebase 미설정으로 저장할 수 없습니다." });
      return;
    }
    if (!form.title.trim()) {
      setStatus({ kind: "error", text: "이벤트명을 입력하세요." });
      return;
    }
    if (form.endDate < form.startDate) {
      setStatus({ kind: "error", text: "종료일은 시작일 이후여야 합니다." });
      return;
    }
    const payload: Omit<CalendarEvent, "id"> = {
      store: form.store,
      title: form.title.trim(),
      startDate: form.startDate,
      endDate: form.endDate,
      color: storeColor(form.store),
    };
    try {
      if (editingId) {
        await updateEvent(editingId, payload);
        setStatus({ kind: "success", text: "생일 이벤트를 수정했습니다." });
      } else {
        await createEvent(payload);
        setStatus({ kind: "success", text: "생일 이벤트를 등록했습니다." });
      }
      resetForm();
      await refresh();
    } catch {
      setStatus({ kind: "error", text: "저장 중 오류가 발생했습니다." });
    }
  }

  async function handleDelete(id: string) {
    if (!configured) return;
    if (!window.confirm("이 생일 이벤트를 삭제할까요?")) return;
    try {
      await deleteEvent(id);
      if (editingId === id) resetForm();
      setStatus({ kind: "success", text: "삭제했습니다." });
      await refresh();
    } catch {
      setStatus({ kind: "error", text: "삭제 중 오류가 발생했습니다." });
    }
  }

  const matrix = getMonthMatrix(year, month);

  // 월별 그룹
  const byMonth = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const e of events) {
      const ym = (e.startDate || "").slice(0, 7);
      const arr = map.get(ym) ?? [];
      arr.push(e);
      map.set(ym, arr);
    }
    return Array.from(map.entries())
      .map(
        ([ym, list]) =>
          [
            ym,
            [...list].sort((a, b) => a.startDate.localeCompare(b.startDate)),
          ] as [string, CalendarEvent[]]
      )
      .sort((a, b) => a[0].localeCompare(b[0]));
  }, [events]);

  // 매장별 그룹
  const byStore = useMemo(() => {
    const result: Record<EventStore, CalendarEvent[]> = {
      id: [],
      wow: [],
      all: [],
    };
    for (const e of events) result[e.store].push(e);
    for (const k of EVENT_STORES)
      result[k].sort((a, b) => a.startDate.localeCompare(b.startDate));
    return result;
  }, [events]);

  // 목록 한 줄 (showStore=매장 뱃지 표시 여부)
  function eventRow(ev: CalendarEvent, showStore: boolean) {
    return (
      <li
        key={ev.id}
        className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-gray-100 bg-gray-50 px-3 py-2"
      >
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span
            className="h-3 w-3 shrink-0 rounded-full"
            style={{ backgroundColor: ev.color ?? storeColor(ev.store) }}
          />
          {showStore ? (
            <Badge
              color={
                ev.store === "id"
                  ? "brand"
                  : ev.store === "wow"
                    ? "orange"
                    : "gray"
              }
            >
              {STORE_HEADER[ev.store].label}
            </Badge>
          ) : null}
          <span className="font-medium text-gray-900">{ev.title}</span>
          <span className="text-gray-600">
            {formatMonthDay(ev.startDate)} ~ {formatMonthDay(ev.endDate)}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <MiniButton tone="brand" onClick={() => startEdit(ev)}>
            수정
          </MiniButton>
          <MiniButton tone="red" onClick={() => handleDelete(ev.id)}>
            삭제
          </MiniButton>
        </div>
      </li>
    );
  }

  return (
    <Section
      title="생일 이벤트"
      subtitle="좌측에서 등록하고 우측 캘린더에서 일정을 확인합니다. 매장(아이디/와우/공통)별로 색이 구분됩니다."
    >
      {!configured ? <FirebaseNotice /> : null}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* 좌측: 등록/수정 폼 */}
        <div>
          <p className="mb-2 text-sm font-bold text-gray-800">
            {editingId ? "생일 이벤트 수정" : "새 생일 이벤트 등록"}
          </p>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-3">
            <Field label="이벤트명">
              <input
                className="input"
                value={form.title}
                onChange={(e) =>
                  setForm((f) => ({ ...f, title: e.target.value }))
                }
                placeholder="예: ○○○ 생일 이벤트 / 포도알 이벤트"
              />
            </Field>
            <Field label="매장 구분">
              <StoreSelect
                value={form.store}
                includeAll
                onChange={(v) => setForm((f) => ({ ...f, store: v }))}
              />
            </Field>
            <Field label="시작일 (운영 시작)">
              <input
                type="date"
                className="input"
                value={form.startDate}
                onChange={(e) =>
                  setForm((f) => ({ ...f, startDate: e.target.value }))
                }
              />
            </Field>
            <Field label="종료일 (운영 종료)">
              <input
                type="date"
                className="input"
                value={form.endDate}
                onChange={(e) =>
                  setForm((f) => ({ ...f, endDate: e.target.value }))
                }
              />
            </Field>
            <div className="flex items-center gap-2">
              <button type="submit" className="btn-primary">
                {editingId ? "수정 저장" : "이벤트 등록"}
              </button>
              {editingId ? (
                <button type="button" className="btn-ghost" onClick={resetForm}>
                  취소
                </button>
              ) : null}
            </div>
            <p className="text-xs text-gray-400">
              우측 캘린더에서 날짜를 클릭하면 운영기간이 자동 입력됩니다.
            </p>
          </form>

          <div className="mt-3">
            <StatusBanner message={status} />
          </div>
        </div>

        {/* 우측: 캘린더 */}
        <div className="lg:border-l lg:border-gray-100 lg:pl-6">
          {/* 월 네비 */}
          <div className="mb-3 flex items-center justify-between">
            <div className="text-base font-bold text-gray-900">
              {year}년 {month}월
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                className="btn-ghost px-2.5 py-1 text-xs"
                onClick={goPrevMonth}
              >
                ←
              </button>
              <button
                type="button"
                className="btn-ghost px-2.5 py-1 text-xs"
                onClick={goThisMonth}
              >
                이번 달
              </button>
              <button
                type="button"
                className="btn-ghost px-2.5 py-1 text-xs"
                onClick={goNextMonth}
              >
                →
              </button>
            </div>
          </div>

          {/* 캘린더 그리드 */}
          <div className="overflow-hidden rounded-2xl border border-gray-200">
            <div className="grid grid-cols-7 border-b border-gray-200 bg-gray-50">
              {WEEKDAYS.map((w, i) => (
                <div
                  key={w}
                  className={
                    "py-2 text-center text-xs font-bold " +
                    (i === 0
                      ? "text-red-500"
                      : i === 6
                        ? "text-blue-600"
                        : "text-gray-500")
                  }
                >
                  {w}
                </div>
              ))}
            </div>
            {matrix.map((week, wi) => {
              const weekStart = week[0].ymd;
              const weekEnd = week[6].ymd;
              const segs = events
                .filter((e) => e.startDate <= weekEnd && e.endDate >= weekStart)
                .map((e) => {
                  const sIdx = week.findIndex((c) => c.ymd === e.startDate);
                  const eIdx = week.findIndex((c) => c.ymd === e.endDate);
                  return {
                    event: e,
                    startCol: e.startDate < weekStart || sIdx < 0 ? 0 : sIdx,
                    endCol: e.endDate > weekEnd || eIdx < 0 ? 6 : eIdx,
                    lane: 0,
                  };
                })
                .sort((a, b) => a.startCol - b.startCol || b.endCol - a.endCol);
              const laneEnds: number[] = [];
              for (const seg of segs) {
                let lane = 0;
                while (lane < laneEnds.length && laneEnds[lane] >= seg.startCol)
                  lane++;
                laneEnds[lane] = seg.endCol;
                seg.lane = lane;
              }
              const laneCount = laneEnds.length;
              return (
                <div
                  key={wi}
                  className="grid min-h-[72px] grid-cols-7"
                  style={{
                    gridTemplateRows: `1.5rem repeat(${laneCount}, 1.4rem) 1fr`,
                  }}
                >
                  {week.map((cell, ci) => {
                    const selected =
                      form.startDate <= cell.ymd && form.endDate >= cell.ymd;
                    return (
                      <div
                        key={`bg-${cell.ymd}`}
                        onClick={() => selectDate(cell.ymd)}
                        style={{ gridColumn: ci + 1, gridRow: "1 / -1" }}
                        className={
                          "cursor-pointer border-b border-gray-100 transition-colors hover:bg-brand-light/30 " +
                          (ci < 6 ? "border-r " : "") +
                          (cell.inMonth ? "bg-white" : "bg-gray-50/60") +
                          (selected ? " ring-2 ring-inset ring-brand" : "")
                        }
                      />
                    );
                  })}
                  {week.map((cell, ci) => (
                    <div
                      key={`d-${cell.ymd}`}
                      style={{ gridColumn: ci + 1, gridRow: 1 }}
                      className={
                        "pointer-events-none relative z-10 px-1.5 pt-1 text-right text-xs " +
                        (cell.isToday
                          ? "font-bold text-brand-dark"
                          : cell.inMonth
                            ? cell.weekday === 0
                              ? "text-red-400"
                              : cell.weekday === 6
                                ? "text-blue-400"
                                : "text-gray-500"
                            : "text-gray-300")
                      }
                    >
                      {cell.day}
                    </div>
                  ))}
                  {segs.map((seg) => (
                    <div
                      key={seg.event.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        startEdit(seg.event);
                      }}
                      style={{
                        gridColumn: `${seg.startCol + 1} / ${seg.endCol + 2}`,
                        gridRow: seg.lane + 2,
                        backgroundColor:
                          seg.event.color ?? storeColor(seg.event.store),
                      }}
                      className="relative z-10 mx-0.5 cursor-pointer truncate rounded px-1.5 text-[11px] font-medium leading-[1.4rem] text-white"
                      title={`${seg.event.title} (${STORE_HEADER[seg.event.store].label})`}
                    >
                      {seg.event.title}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* 하단: 등록된 목록 (탭: 월별 / 매장별) */}
      <div className="mt-6 border-t border-gray-100 pt-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-gray-700">
            등록된 생일 이벤트 ({events.length})
          </h3>
          <div className="flex items-center gap-1 rounded-xl bg-gray-100 p-1">
            {(
              [
                { key: "month", label: "월별" },
                { key: "store", label: "매장별" },
              ] as const
            ).map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setViewMode(t.key)}
                className={
                  "rounded-lg px-3 py-1 text-xs font-medium transition-colors " +
                  (viewMode === t.key
                    ? "bg-white text-brand-dark shadow-sm"
                    : "text-gray-500 hover:text-gray-700")
                }
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <p className="text-sm text-gray-500">불러오는 중...</p>
        ) : events.length === 0 ? (
          <p className="text-sm text-gray-500">등록된 생일 이벤트가 없습니다.</p>
        ) : viewMode === "month" ? (
          <div className="space-y-4">
            {byMonth.map(([ym, list]) => (
              <div key={ym}>
                <h4 className="mb-2 flex items-center gap-2 text-sm font-bold text-gray-800">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-brand" />
                  {monthLabel(ym)}
                  <span className="text-xs font-normal text-gray-400">
                    {list.length}건
                  </span>
                </h4>
                <ul className="space-y-2">
                  {list.map((ev) => eventRow(ev, true))}
                </ul>
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-4">
            {EVENT_STORES.map((store) => {
              const meta = STORE_HEADER[store];
              const list = byStore[store];
              if (list.length === 0) return null;
              return (
                <div key={store}>
                  <div
                    className={`mb-2 flex items-center gap-2 rounded-lg px-2.5 py-1.5 ${meta.bg}`}
                  >
                    <span className={`h-2 w-2 rounded-full ${meta.dot}`} />
                    <span className={`text-sm font-bold ${meta.text}`}>
                      {meta.label}
                    </span>
                    <span className="text-xs font-normal text-gray-400">
                      {list.length}건
                    </span>
                  </div>
                  <ul className="space-y-2">
                    {list.map((ev) => eventRow(ev, false))}
                  </ul>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Section>
  );
}
