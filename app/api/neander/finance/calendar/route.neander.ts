import { NextResponse } from "next/server";
import { adminDb } from "@/lib/neander/server/admin";
import { requireErpUser, accessErrorResponse } from "@/lib/neander/server/auth";
import { NEANDER_COL } from "@/lib/neander/collections";
import { cleanCalendars, type CalendarSnapshot, type GcalCalendar } from "@/lib/neander/finance/calendar";
import { clearGcalCache, listDayEvents, serviceEmail } from "@/lib/neander/finance/server/gcal";

// 그날 일정 — 구글 캘린더를 서버 계정으로 읽어 준다 (finance/calendar.ts).
//
//   GET  ?from=YYYY-MM-DD&to=YYYY-MM-DD   그 기간의 일정 (한국 시간 · 양 끝 포함)
//   POST { calendars: [{ id, label }] }   읽어 올 캘린더 목록을 바꾼다
//
// 재무 접근 권한이 있는 사람만 부를 수 있다. 일정은 저장하지 않는다.
export const dynamic = "force-dynamic";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** 한 번에 물을 수 있는 기간 — 화면은 한 달씩 묻는다 */
const MAX_DAYS = 100;

const settingsRef = () => adminDb().collection(NEANDER_COL.finSettings).doc("gcal");

async function readCalendars(): Promise<GcalCalendar[]> {
  const snap = await settingsRef().get();
  return cleanCalendars(snap.get("calendars"));
}

function fail(e: unknown, where: string) {
  const denied = accessErrorResponse(e);
  if (denied) return denied;
  console.error(`[finance/calendar] ${where}`, e);
  return NextResponse.json({ error: e instanceof Error ? e.message : "알 수 없는 오류" }, { status: 500 });
}

export async function GET(req: Request) {
  try {
    await requireErpUser(req);
    const url = new URL(req.url);
    const from = url.searchParams.get("from") ?? "";
    const to = url.searchParams.get("to") ?? "";
    if (!DATE.test(from) || !DATE.test(to) || to < from) {
      return NextResponse.json({ error: "from · to 는 YYYY-MM-DD 이어야 합니다." }, { status: 400 });
    }
    if ((Date.parse(to) - Date.parse(from)) / 86_400_000 > MAX_DAYS) {
      return NextResponse.json({ error: `한 번에 ${MAX_DAYS}일까지만 물을 수 있습니다.` }, { status: 400 });
    }
    const calendars = await readCalendars();
    const { events, issues } = calendars.length
      ? await listDayEvents(calendars, from, to)
      : { events: [], issues: [] };
    const body: CalendarSnapshot = {
      connected: calendars.length > 0,
      calendars,
      events,
      issues,
      serviceEmail: serviceEmail(),
    };
    return NextResponse.json(body);
  } catch (e) {
    return fail(e, "GET");
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireErpUser(req);
    const body = (await req.json().catch(() => ({}))) as { calendars?: unknown };
    const calendars = cleanCalendars(body.calendars);
    await settingsRef().set({ calendars, updatedAt: Date.now(), updatedBy: user.email });
    clearGcalCache();
    // 바로 읽어 본다 — 공유가 안 됐거나 API 가 꺼져 있으면 저장하자마자 알 수 있게
    const today = new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);
    const { issues } = calendars.length ? await listDayEvents(calendars, today, today) : { issues: [] };
    const snap: CalendarSnapshot = {
      connected: calendars.length > 0,
      calendars,
      events: [],
      issues,
      serviceEmail: serviceEmail(),
    };
    return NextResponse.json(snap);
  } catch (e) {
    return fail(e, "POST");
  }
}
