// ============================================================
//  구글 캘린더 읽기 (서버 전용) — finance/calendar.ts 의 서버 쪽
// ------------------------------------------------------------
//  ERP 서버 계정(Firebase 서비스 계정)으로 Calendar API 를 부른다.
//  라이브러리를 더 들이지 않는다 — 서비스 계정의 열쇠로 JWT 를 직접 서명해
//  토큰을 받는다 (RS256 · 구글 OAuth 의 jwt-bearer).
//
//  구글 쪽에서 해 둬야 하는 것은 둘이다:
//    ① 구글 클라우드 프로젝트에서 Google Calendar API 켜기
//    ② 캘린더를 서버 계정 주소에 공유 (일정 보기)
//  둘 중 하나라도 빠지면 구글이 403 · 404 를 준다. 그 응답을 **무엇을 하면
//  되는지**로 바꿔서 돌려준다 — 화면이 그대로 보여 준다.
//
//  읽기만 한다 (calendar.readonly). 받은 일정은 메모리에 잠깐 들고 있을 뿐
//  저장하지 않는다.
// ============================================================

import { createSign } from "node:crypto";
import { loadServiceAccount } from "@/lib/neander/server/admin";
import {
  expandGoogleEvent,
  sortDayEvents,
  type CalendarIssue,
  type DayEvent,
  type GcalCalendar,
  type GoogleEventLike,
} from "../calendar";

const SCOPE = "https://www.googleapis.com/auth/calendar.readonly";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API = "https://www.googleapis.com/calendar/v3";
/** 같은 기간을 다시 물으면 이만큼은 구글에 가지 않는다 */
const CACHE_MS = 5 * 60_000;
/** 한 번에 받을 일정 수 · 쪽 수의 상한 */
const PAGE_SIZE = 250;
const MAX_PAGES = 8;

/** 캘린더를 공유해 줄 서버 계정 주소 */
export const serviceEmail = () => loadServiceAccount().client_email;

let token: { value: string; until: number } | null = null;

const b64url = (v: object) => Buffer.from(JSON.stringify(v)).toString("base64url");

async function accessToken(): Promise<string> {
  if (token && token.until > Date.now() + 60_000) return token.value;
  const sa = loadServiceAccount();
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64url({ alg: "RS256", typ: "JWT" })}.${b64url({
    iss: sa.client_email,
    scope: SCOPE,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  })}`;
  const signature = createSign("RSA-SHA256").update(unsigned).sign(sa.private_key).toString("base64url");
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsigned}.${signature}`,
    }),
    cache: "no-store",
  });
  const body = (await res.json()) as { access_token?: string; expires_in?: number; error_description?: string };
  if (!res.ok || !body.access_token) {
    throw new Error(`구글 인증에 실패했습니다 — ${body.error_description ?? `HTTP ${res.status}`}`);
  }
  token = { value: body.access_token, until: Date.now() + (body.expires_in ?? 3600) * 1000 };
  return token.value;
}

/** 구글의 오류를 「무엇을 하면 되는지」 로 */
function issueOf(cal: GcalCalendar, status: number, message: string): CalendarIssue {
  if (status === 403 && /has not been used|is disabled|accessNotConfigured/i.test(message)) {
    return {
      calendarId: cal.id,
      label: cal.label,
      code: "api_off",
      message: "구글 클라우드에서 Google Calendar API 가 꺼져 있습니다. 한 번 켜면 됩니다 (켠 뒤 몇 분 걸릴 수 있습니다).",
    };
  }
  if (status === 404 || status === 403) {
    return {
      calendarId: cal.id,
      label: cal.label,
      code: "not_shared",
      message: "이 캘린더를 읽을 수 없습니다. 캘린더가 서버 계정에 공유됐는지, 캘린더 ID 가 맞는지 확인해 주세요.",
    };
  }
  return { calendarId: cal.id, label: cal.label, code: "other", message: `구글 캘린더 오류 (HTTP ${status}) — ${message.slice(0, 160)}` };
}

const cache = new Map<string, { at: number; events: DayEvent[] }>();

/** 캘린더 하나의 그 기간 일정 (한국 시간 기준 · 양 끝 날짜 포함) */
async function eventsOf(cal: GcalCalendar, from: string, to: string): Promise<DayEvent[] | CalendarIssue> {
  const key = `${cal.id}|${from}|${to}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.events.map((e) => ({ ...e, calendar: cal.label }));

  const bearer = await accessToken();
  const items: GoogleEventLike[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const q = new URLSearchParams({
      timeMin: `${from}T00:00:00+09:00`,
      timeMax: `${to}T23:59:59+09:00`,
      timeZone: "Asia/Seoul",
      // 반복 일정을 낱낱의 일정으로 펴서 받는다
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: String(PAGE_SIZE),
      fields: "nextPageToken,items(id,status,summary,location,start,end)",
      ...(pageToken ? { pageToken } : {}),
    });
    const res = await fetch(`${API}/calendars/${encodeURIComponent(cal.id)}/events?${q}`, {
      headers: { Authorization: `Bearer ${bearer}` },
      cache: "no-store",
    });
    const body = (await res.json()) as {
      items?: GoogleEventLike[];
      nextPageToken?: string;
      error?: { message?: string };
    };
    if (!res.ok) return issueOf(cal, res.status, body.error?.message ?? "");
    items.push(...(body.items ?? []));
    pageToken = body.nextPageToken;
    if (!pageToken) break;
  }

  const events = items.flatMap((ev) => expandGoogleEvent(ev, cal, { from, to }));
  cache.set(key, { at: Date.now(), events });
  return events;
}

/** 등록된 캘린더 전부의 그 기간 일정. 못 읽은 캘린더는 issues 로 따로 온다 */
export async function listDayEvents(
  calendars: GcalCalendar[],
  from: string,
  to: string,
): Promise<{ events: DayEvent[]; issues: CalendarIssue[] }> {
  const results = await Promise.all(
    calendars.map((cal) =>
      eventsOf(cal, from, to).catch(
        (e): CalendarIssue => ({
          calendarId: cal.id,
          label: cal.label,
          code: "other",
          message: e instanceof Error ? e.message : "알 수 없는 오류",
        }),
      ),
    ),
  );
  const events: DayEvent[] = [];
  const issues: CalendarIssue[] = [];
  results.forEach((r) => {
    if (Array.isArray(r)) events.push(...r);
    else issues.push(r);
  });
  return { events: sortDayEvents(events), issues };
}

/** 캘린더 목록이 바뀌면 들고 있던 일정을 버린다 */
export const clearGcalCache = () => cache.clear();
