// ============================================================
//  그날 일정 — 구글 캘린더를 검토 대기함 옆에 둔다
// ------------------------------------------------------------
//  거래를 검토할 때 계정을 가르는 것은 대개 「그날 무슨 일이 있었나」 다.
//  9월 13일 이케아 72만 원은 그 주에 와우 리모델링이 있었다는 것을 알면
//  묻지 않아도 된다. 그 맥락이 구글 캘린더에 있다.
//
//  ── 연결 ──
//  사람마다 로그인(OAuth)하게 하지 않는다. 캘린더를 **ERP 서버 계정에 공유**
//  하면(일정 보기 권한) 서버가 그 계정으로 읽는다 — 재무 화면을 여는 사람이
//  구글에 따로 들어갈 필요가 없고, 공유를 끊으면 바로 막힌다.
//  어느 캘린더를 읽을지는 Firestore(neander_fin_settings/gcal)에 적는다.
//  서버 계정에는 「내 캘린더 목록」 이 없어서 캘린더 ID 를 알려 줘야 한다.
//
//  읽기만 한다 (calendar.readonly). 일정은 저장하지 않는다 — 물을 때마다
//  구글에서 받아 잠깐 들고 있을 뿐이다 (server/gcal.ts).
//
//  이 파일은 서버·화면 공용이다 (구글 SDK 를 끌어오지 않는다).
// ============================================================

/** 읽어 올 캘린더 하나 */
export interface GcalCalendar {
  /** 캘린더 ID — 내 기본 캘린더는 구글 계정 주소, 따로 만든 캘린더는 `…@group.calendar.google.com` */
  id: string;
  /** 화면에 적을 이름 (팀 · 대표 · 매장) */
  label: string;
}

/** 하루치 일정 한 줄 — 여러 날에 걸친 일정은 날마다 한 줄씩 나온다 */
export interface DayEvent {
  /** `캘린더|일정 id|날짜` */
  key: string;
  /** `YYYY-MM-DD` (한국 시간) */
  date: string;
  title: string;
  /** 시작 시각 `HH:mm` — 종일 일정과 이어지는 날에는 없다 */
  time?: string;
  allDay: boolean;
  /** 여러 날짜리 일정의 둘째 날부터 */
  continued?: boolean;
  location?: string;
  calendarId: string;
  calendar: string;
}

/** 캘린더 하나를 못 읽었을 때 — 무엇을 해야 하는지까지 적는다 */
export interface CalendarIssue {
  calendarId: string;
  label: string;
  /** api_off · not_shared · other */
  code: "api_off" | "not_shared" | "other";
  message: string;
}

export interface CalendarSnapshot {
  /** 캘린더가 하나라도 등록돼 있는가 */
  connected: boolean;
  calendars: GcalCalendar[];
  events: DayEvent[];
  issues: CalendarIssue[];
  /** 캘린더를 공유해 줄 서버 계정 주소 (연결 안내에 적는다) */
  serviceEmail: string;
}

/** 구글이 돌려주는 일정에서 쓰는 것만 */
export interface GoogleEventLike {
  id?: string;
  status?: string;
  summary?: string;
  location?: string;
  start?: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
}

const DAY = 86_400_000;
/** 한 일정이 덮는 날 수의 상한 — 「2026년 내내」 같은 일정이 줄을 수백 개 만들지 않게 */
const MAX_SPAN_DAYS = 45;

const toMs = (date: string) => Date.parse(`${date}T00:00:00Z`);
const toDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** 날짜에 n 일을 더한다 */
export const addDays = (date: string, n: number) => toDate(toMs(date) + n * DAY);

/** 그 달의 첫날과 끝날 */
export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
}

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
/** `9월 27일 (토)` */
export function dayLabel(date: string): string {
  const d = new Date(toMs(date));
  return `${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일 (${WEEKDAYS[d.getUTCDay()]})`;
}

/**
 * 구글 일정 하나 → 날마다 한 줄.
 *
 * 서버가 `timeZone=Asia/Seoul` 로 물으므로 `dateTime` 은 한국 시간으로 온다 —
 * 앞 10글자가 곧 한국 날짜다. 종일 일정의 끝 날짜는 **포함하지 않는 날**이다
 * (9/27 하루짜리는 start 9/27 · end 9/28). 자정에 끝나는 시간 일정도 그렇게 본다.
 *
 * `from`·`to` 를 주면 그 밖의 날은 버린다.
 */
export function expandGoogleEvent(
  ev: GoogleEventLike,
  cal: GcalCalendar,
  range?: { from: string; to: string },
): DayEvent[] {
  if (ev.status === "cancelled") return [];
  const allDay = !!ev.start?.date;
  const startDate = ev.start?.date ?? ev.start?.dateTime?.slice(0, 10);
  if (!startDate) return [];
  const endRaw = ev.end?.date ?? ev.end?.dateTime?.slice(0, 10) ?? startDate;
  // 끝이 「다음 날 0시」 면 그날은 들지 않는다
  const endsAtMidnight = allDay || ev.end?.dateTime?.slice(11, 19) === "00:00:00";
  let lastDate = endsAtMidnight && endRaw > startDate ? addDays(endRaw, -1) : endRaw;
  if (lastDate < startDate) lastDate = startDate;

  const out: DayEvent[] = [];
  const title = (ev.summary ?? "").trim() || "(제목 없음)";
  // 물은 기간보다 먼저 시작한 일정은 기간의 첫날부터 센다 — 처음부터 세면 「연중 내내」
  // 같은 일정이 상한에 걸려 정작 물은 달에는 안 나온다
  const first = range && range.from > startDate ? range.from : startDate;
  for (let i = 0; i < MAX_SPAN_DAYS; i++) {
    const date = addDays(first, i);
    if (date > lastDate || (range && date > range.to)) break;
    const opening = date === startDate;
    out.push({
      key: `${cal.id}|${ev.id ?? title}|${date}`,
      date,
      title,
      allDay,
      ...(opening && !allDay && ev.start?.dateTime ? { time: ev.start.dateTime.slice(11, 16) } : {}),
      ...(opening ? {} : { continued: true }),
      ...(ev.location ? { location: ev.location } : {}),
      calendarId: cal.id,
      calendar: cal.label,
    });
  }
  return out;
}

/** 하루 안에서의 순서 — 종일 · 이어지는 일정이 먼저, 그다음 시각순 */
export function sortDayEvents(events: DayEvent[]): DayEvent[] {
  return [...events].sort(
    (a, b) =>
      (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) ||
      (a.time ? 1 : 0) - (b.time ? 1 : 0) ||
      (a.time ?? "").localeCompare(b.time ?? "") ||
      a.title.localeCompare(b.title, "ko"),
  );
}

/** 같은 제목의 일정 묶음 — 예약 시간대처럼 하루에 여러 번 나오는 것 */
export interface DayEventGroup {
  /** 그날 가장 이른 것 */
  first: DayEvent;
  count: number;
  /** 시작 시각들 (이른 순) */
  times: string[];
}

/**
 * 하루치 일정을 **같은 제목 · 같은 캘린더**끼리 묶는다.
 * 예약 캘린더는 한 프로그램이 시간대마다 한 줄씩 들어 있어서(13:00 · 14:30 · 15:00 …),
 * 그대로 늘어놓으면 같은 말이 세 줄을 채운다. 「13:00 제목 ×9」 한 줄이면 된다.
 */
export function groupDayEvents(events: DayEvent[]): DayEventGroup[] {
  const groups = new Map<string, DayEventGroup>();
  sortDayEvents(events).forEach((e) => {
    const k = `${e.calendarId}|${e.title}`;
    const g = groups.get(k);
    if (g) {
      g.count += 1;
      if (e.time) g.times.push(e.time);
    } else groups.set(k, { first: e, count: 1, times: e.time ? [e.time] : [] });
  });
  return [...groups.values()];
}

/** 사람이 적은 캘린더 목록을 다듬는다 — 빈 줄·중복을 버리고 이름이 없으면 ID 앞머리로 */
export function cleanCalendars(input: unknown): GcalCalendar[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: GcalCalendar[] = [];
  input.forEach((raw) => {
    const id = String((raw as { id?: unknown })?.id ?? "").trim();
    if (!id || seen.has(id.toLowerCase())) return;
    seen.add(id.toLowerCase());
    const label = String((raw as { label?: unknown })?.label ?? "").trim() || id.split("@")[0];
    out.push({ id: id.slice(0, 200), label: label.slice(0, 40) });
  });
  return out.slice(0, 10);
}
