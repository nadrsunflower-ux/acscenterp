"use client";

// ============================================================
//  그날 일정 — 검토 중인 거래의 날짜에 무슨 일이 있었나
// ------------------------------------------------------------
//  검토 대기함의 커서 행에 한 줄로 붙는다. 구글 캘린더의 그날 일정을
//  보여 주고, 「앞뒤 일정」 으로 사흘 전후까지 편다 — 행사 준비물은 행사
//  며칠 전에 사고, 정산은 며칠 뒤에 나간다.
//
//  일정은 한 달씩 받아 들고 있는다 (useDayEvents). 커서를 옮길 때마다
//  묻지 않는다. 캘린더가 아직 연결되지 않았으면 그 자리에서 연결 창을 연다.
//
//  읽기만 한다. 누가 무엇을 볼 수 있는지는 서버가 정한다 (재무 접근 권한 ·
//  서버 계정에 공유된 캘린더만) — finance/calendar.ts.
// ============================================================

import { useCallback, useEffect, useRef, useState } from "react";
import { CalendarDays, Check, ChevronDown, Copy, Plus, Settings2, Trash2, TriangleAlert } from "lucide-react";
import {
  Button,
  cn,
  Dialog,
  FormRow,
  Icon,
  IconButton,
  InlineNotice,
  Input,
  Popover,
  useToast,
} from "@/components/neander/ui";
import { fetchDayEvents, saveGcalCalendars } from "@/lib/neander/finance/client";
import {
  addDays,
  dayLabel,
  monthRange,
  sortDayEvents,
  type CalendarIssue,
  type CalendarSnapshot,
  type DayEvent,
  type GcalCalendar,
} from "@/lib/neander/finance/calendar";

/** 「앞뒤 일정」 이 펴는 날 수 (앞으로 · 뒤로) */
const AROUND = 3;
/** 한 줄에 늘어놓는 일정 수 — 넘치면 「+N」 */
const MAX_INLINE = 5;

type Meta = Pick<CalendarSnapshot, "connected" | "calendars" | "issues" | "serviceEmail">;

export interface DayEventsStore {
  /** 서버가 알려 준 연결 상태 — 아직 한 번도 못 받았으면 null */
  meta: Meta | null;
  error: string | null;
  /** 그날 일정. 그 달을 아직 못 받았으면 undefined */
  eventsOn: (date: string) => DayEvent[] | undefined;
  /** 그 날짜(와 앞뒤 며칠)가 든 달을 받아 둔다 */
  ensure: (date: string) => void;
  /** 캘린더 목록을 바꾼 뒤 — 들고 있던 것을 버리고 다시 받는다 */
  reset: (meta?: Meta) => void;
}

/** 일정을 한 달씩 받아 들고 있는다. 화면에 하나만 둔다 (커서 행은 수시로 바뀐다) */
export function useDayEvents(): DayEventsStore {
  const [byMonth, setByMonth] = useState<Record<string, DayEvent[]>>({});
  const [meta, setMeta] = useState<Meta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const asked = useRef(new Set<string>());

  const load = useCallback((month: string) => {
    if (asked.current.has(month)) return;
    asked.current.add(month);
    const { from, to } = monthRange(month);
    fetchDayEvents(from, to)
      .then((snap) => {
        setMeta({ connected: snap.connected, calendars: snap.calendars, issues: snap.issues, serviceEmail: snap.serviceEmail });
        setByMonth((prev) => ({ ...prev, [month]: sortDayEvents(snap.events) }));
        setError(null);
      })
      .catch((e) => {
        // 다음에 다시 물을 수 있게 표시를 거둔다
        asked.current.delete(month);
        setError(e instanceof Error ? e.message : "일정을 불러오지 못했습니다.");
      });
  }, []);

  const ensure = useCallback(
    (date: string) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
      new Set([date, addDays(date, -AROUND), addDays(date, AROUND)].map((d) => d.slice(0, 7))).forEach(load);
    },
    [load],
  );

  const eventsOn = useCallback(
    (date: string) => byMonth[date.slice(0, 7)]?.filter((e) => e.date === date),
    [byMonth],
  );

  const reset = useCallback((next?: Meta) => {
    asked.current.clear();
    setByMonth({});
    setError(null);
    if (next) setMeta(next);
  }, []);

  return { meta, error, eventsOn, ensure, reset };
}

/** 일정 하나 — `14:00 제목` */
function EventChip({ ev, showCalendar }: { ev: DayEvent; showCalendar: boolean }) {
  return (
    <span
      className="inline-flex max-w-[22rem] items-baseline gap-x-1.5 rounded-nd-md bg-nd-sunken px-2.5 py-0.5 text-[15px] leading-snug text-nd-fg"
      title={[ev.title, ev.location, showCalendar ? ev.calendar : ""].filter(Boolean).join(" · ")}
    >
      {ev.time && <span className="nd-num shrink-0 text-nd-table text-nd-fg-2">{ev.time}</span>}
      <span className="min-w-0 truncate font-medium">{ev.title}</span>
      {showCalendar && <span className="shrink-0 text-nd-table text-nd-fg-3">{ev.calendar}</span>}
    </span>
  );
}

/**
 * 커서 행의 「그날 일정」 한 줄. 높이를 늘 차지한다 — 일정을 받는 동안 줄이
 * 생겼다 없어졌다 하면 그 아래 선택기가 덜컥거린다.
 */
export function DayEventsLine({ date, store, className }: { date: string; store: DayEventsStore; className?: string }) {
  const { meta, error, eventsOn, ensure, reset } = store;
  const [setup, setSetup] = useState(false);
  const [around, setAround] = useState(false);
  const aroundRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    ensure(date);
  }, [date, ensure]);

  const events = eventsOn(date);
  const many = (meta?.calendars.length ?? 0) > 1;
  const issues = meta?.issues ?? [];

  let body;
  if (error && !meta) {
    body = (
      <>
        <span className="text-nd-body text-nd-danger-text">일정을 불러오지 못했습니다 — {error}</span>
        <Button size="sm" variant="ghost" onClick={() => reset()}>
          다시
        </Button>
      </>
    );
  } else if (!meta) {
    body = <span className="text-nd-body text-nd-fg-3">일정을 불러오는 중…</span>;
  } else if (!meta.connected) {
    body = (
      <>
        <span className="text-nd-body text-nd-fg-2">구글 캘린더를 연결하면 그날 무슨 일이 있었는지 여기에 보입니다</span>
        <Button size="sm" variant="secondary" onClick={() => setSetup(true)}>
          연결하기
        </Button>
      </>
    );
  } else {
    const list = events ?? [];
    body = (
      <>
        {events === undefined ? (
          <span className="text-nd-body text-nd-fg-3">불러오는 중…</span>
        ) : list.length === 0 ? (
          <span className="text-nd-body text-nd-fg-3">{issues.length > 0 ? "읽은 일정이 없습니다" : "일정 없음"}</span>
        ) : (
          <>
            {list.slice(0, MAX_INLINE).map((ev) => (
              <EventChip key={ev.key} ev={ev} showCalendar={many} />
            ))}
            {list.length > MAX_INLINE && (
              <span className="nd-num text-nd-body text-nd-fg-2">+{list.length - MAX_INLINE}</span>
            )}
          </>
        )}
        {issues.length > 0 && (
          <Button size="sm" variant="ghost" icon={TriangleAlert} className="text-nd-warning-text" onClick={() => setSetup(true)}>
            못 읽은 캘린더 {issues.length}개
          </Button>
        )}
        <Button
          ref={aroundRef}
          size="sm"
          variant="ghost"
          trailingIcon={ChevronDown}
          aria-expanded={around}
          aria-haspopup="dialog"
          onClick={() => setAround((v) => !v)}
        >
          앞뒤 일정
        </Button>
        <IconButton icon={Settings2} label="캘린더 설정" size="sm" variant="ghost" onClick={() => setSetup(true)} />
      </>
    );
  }

  return (
    <div
      className={cn("flex min-h-[32px] flex-wrap items-center gap-x-2 gap-y-1.5", className)}
      onClick={(e) => e.stopPropagation()}
    >
      <span className="flex shrink-0 items-center gap-1.5 text-nd-body font-semibold text-nd-fg">
        <Icon icon={CalendarDays} size={16} className="text-nd-fg-2" />
        {dayLabel(date)}
      </span>
      {body}

      <Popover
        open={around}
        onClose={() => setAround(false)}
        anchorRef={aroundRef}
        placement="bottom-start"
        ariaLabel="앞뒤 일정"
        unpadded
        className="w-[min(34rem,calc(100vw-2rem))]"
      >
        <ul className="max-h-[min(26rem,65vh)] divide-y divide-nd-border overflow-y-auto px-4 py-1">
          {Array.from({ length: AROUND * 2 + 1 }, (_, i) => addDays(date, i - AROUND)).map((d) => {
            const dayEvents = eventsOn(d);
            const here = d === date;
            return (
              <li key={d} className={cn("flex gap-3 py-2", here && "-mx-4 bg-nd-accent-soft px-4")}>
                <span className={cn("w-[7.5rem] shrink-0 text-nd-body", here ? "font-semibold text-nd-fg" : "text-nd-fg-2")}>
                  {dayLabel(d)}
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  {dayEvents === undefined ? (
                    <span className="text-nd-body text-nd-fg-3">불러오는 중…</span>
                  ) : dayEvents.length === 0 ? (
                    <span className="text-nd-body text-nd-fg-3">—</span>
                  ) : (
                    dayEvents.map((ev) => (
                      <span key={ev.key} className="flex min-w-0 items-baseline gap-x-2 text-nd-body leading-snug text-nd-fg">
                        {ev.time && <span className="nd-num shrink-0 text-nd-table text-nd-fg-2">{ev.time}</span>}
                        <span className="min-w-0 break-words">
                          {ev.title}
                          {ev.location && <span className="text-nd-fg-3"> · {ev.location}</span>}
                        </span>
                        {many && <span className="shrink-0 text-nd-table text-nd-fg-3">{ev.calendar}</span>}
                      </span>
                    ))
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      </Popover>

      {meta && (
        <GcalSetupDialog
          open={setup}
          onClose={() => setSetup(false)}
          meta={meta}
          onSaved={(next) => reset(next)}
        />
      )}
    </div>
  );
}

// ---- 연결 창 --------------------------------------------------

/** 서버 계정 주소에서 구글 클라우드 프로젝트 이름을 읽는다 (`…@프로젝트.iam.gserviceaccount.com`) */
const projectOf = (email: string) => email.match(/@([^.]+)\.iam\.gserviceaccount\.com$/)?.[1];

function GcalSetupDialog({
  open,
  onClose,
  meta,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  meta: Meta;
  onSaved: (next: Meta) => void;
}) {
  const toast = useToast();
  const [rows, setRows] = useState<GcalCalendar[]>([]);
  const [issues, setIssues] = useState<CalendarIssue[]>(meta.issues);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  // 열 때마다 저장된 목록에서 시작한다 (없으면 빈 줄 하나)
  useEffect(() => {
    if (!open) return;
    setRows(meta.calendars.length > 0 ? meta.calendars : [{ id: "", label: "" }]);
    setIssues(meta.issues);
    setFailed(null);
  }, [open, meta]);

  const project = projectOf(meta.serviceEmail);
  const apiUrl = `https://console.cloud.google.com/apis/library/calendar-json.googleapis.com${project ? `?project=${project}` : ""}`;
  const setRow = (i: number, patch: Partial<GcalCalendar>) =>
    setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const save = async () => {
    setSaving(true);
    setFailed(null);
    try {
      const snap = await saveGcalCalendars(rows.filter((r) => r.id.trim()));
      setIssues(snap.issues);
      onSaved({ connected: snap.connected, calendars: snap.calendars, issues: snap.issues, serviceEmail: snap.serviceEmail });
      if (snap.issues.length === 0) {
        toast.success(snap.connected ? "캘린더를 연결했습니다." : "캘린더 연결을 풀었습니다.");
        onClose();
      }
    } catch (e) {
      setFailed(e instanceof Error ? e.message : "저장하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title="구글 캘린더 연결"
      description="캘린더를 ERP 서버 계정에 공유하면, 검토 대기함에서 거래 날짜의 일정을 함께 볼 수 있습니다. 읽기만 하고 저장하지 않습니다."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            닫기
          </Button>
          <Button onClick={() => void save()} loading={saving}>
            저장하고 연결 확인
          </Button>
        </>
      }
    >
      <ol className="space-y-3 text-nd-body leading-relaxed text-nd-fg">
        <li>
          <b className="font-semibold">① Google Calendar API 켜기</b> (처음 한 번) —{" "}
          <a href={apiUrl} target="_blank" rel="noreferrer" className="font-medium text-nd-accent underline">
            구글 클라우드에서 열기
          </a>{" "}
          → 「사용」
        </li>
        <li>
          <b className="font-semibold">② 캘린더를 서버 계정에 공유</b> — 구글 캘린더 설정 → 해당 캘린더 → 「특정 사용자 또는
          그룹과 공유」 에 아래 주소를 넣고 권한은 <b className="font-semibold">모든 일정 세부정보 보기</b>
          <span className="mt-1.5 flex flex-wrap items-center gap-2">
            <code className="min-w-0 break-all rounded-nd-md bg-nd-sunken px-2.5 py-1 text-nd-table">{meta.serviceEmail}</code>
            <Button
              size="sm"
              variant="secondary"
              icon={copied ? Check : Copy}
              onClick={() => {
                void navigator.clipboard?.writeText(meta.serviceEmail).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                });
              }}
            >
              {copied ? "복사됨" : "주소 복사"}
            </Button>
          </span>
        </li>
        <li>
          <b className="font-semibold">③ 캘린더 ID 적기</b> — 같은 설정 화면의 「캘린더 통합 → 캘린더 ID」. 기본 캘린더는 그
          구글 계정 주소입니다.
        </li>
      </ol>

      <div className="mt-4 space-y-2">
        {rows.map((r, i) => {
          const issue = issues.find((x) => x.calendarId === r.id.trim());
          return (
            <div key={i}>
              <FormRow className="grid-cols-[minmax(0,10rem)_minmax(0,1fr)_auto] items-center">
                <Input
                  aria-label="이름"
                  placeholder="이름 (팀 · 대표)"
                  value={r.label}
                  onChange={(e) => setRow(i, { label: e.target.value })}
                />
                <Input
                  aria-label="캘린더 ID"
                  placeholder="캘린더 ID — 예: name@gmail.com"
                  value={r.id}
                  autoComplete="off"
                  onChange={(e) => setRow(i, { id: e.target.value })}
                />
                <IconButton
                  icon={Trash2}
                  label="이 캘린더 빼기"
                  variant="ghost"
                  onClick={() => setRows((prev) => prev.filter((_, j) => j !== i))}
                />
              </FormRow>
              {issue && <p className="mt-1 text-nd-table text-nd-danger-text">{issue.message}</p>}
            </div>
          );
        })}
        <Button size="sm" variant="ghost" icon={Plus} onClick={() => setRows((prev) => [...prev, { id: "", label: "" }])}>
          캘린더 추가
        </Button>
      </div>

      {failed && (
        <InlineNotice tone="danger" icon={TriangleAlert} className="mt-3">
          {failed}
        </InlineNotice>
      )}
      <p className="mt-3 text-nd-table text-nd-fg-3">
        일정은 재무 접근 권한이 있는 사람에게만 보입니다. 공유를 끊으면 바로 읽지 못합니다.
      </p>
    </Dialog>
  );
}
