// ============================================================
//  생일 이벤트 발주 알림 — 무엇을 언제 알리나 (순수 함수)
// ------------------------------------------------------------
//  생일 이벤트는 두 곳에 적힌다.
//    · 매장 앱 캘린더(`events` — 관리자 「생일 이벤트」 탭). 가장 먼저 등록된다
//    · ERP 매출 › 이벤트 입력(`neander_sales_events`). 준비물과 발주한 날이 여기 있다
//  캘린더에는 있는데 ERP 에 발주 기록이 없으면 = 「일정은 다가오는데 발주가 안 된 이벤트」.
//
//  발주한 날은 이벤트의 `orderedAt` 이 정본이다. 비어 있으면 메모의 「10/13 발주 (레드 …)」 를
//  읽는다 — 2026-11 까지는 메모에만 적었다.
//
//  알리는 때 — 2026-10~11 이벤트 15건은 행사 15일쯤 전에 발주했고, 가장 늦은 것이 8일 전이었다.
//    · D-15 「발주할 때」 · D-10 「발주 늦음」 한 번씩
//    · D-8 부터 행사 전날까지 매일
//  날을 건너뛰어도(점검이 하루 안 돌아도) 놓치지 않게 「그 단계에 들어섰는데 아직 안 보냈으면」 보낸다.
//
//  서버(노션 표 · 멘션)는 server/order-alert.ts.
// ============================================================

import type { SalesEvent, SalesStore } from "./types";

/** 매장 앱 캘린더의 이벤트 (lib/types.ts CalendarEvent 와 같은 모양) */
export interface CalendarBirthday {
  id: string;
  store: "id" | "wow" | "all";
  title: string;
  startDate: string;
  endDate: string;
}

export type OrderStage = "early" | "due" | "late" | "daily" | "ordered" | "running";

export const ORDER_STAGE_LABEL: Record<OrderStage, string> = {
  early: "여유",
  due: "발주할 때",
  late: "발주 늦음",
  daily: "발주 늦음",
  ordered: "발주함",
  running: "진행 중",
};

/** 알림 단계 경계 — 행사 시작까지 남은 날 */
export const ORDER_DAYS = { due: 15, late: 10, daily: 8 } as const;
/** 노션 표에 올리는 범위 — 앞으로 이만큼 안에 시작하는 이벤트 */
export const ORDER_HORIZON_DAYS = 45;

const DAY = 86_400_000;
export const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 메모에서 발주한 날 — 「10/13 발주」 「10/21~22 발주」 「9/22 발주분」. 가장 이른 날.
 * 「11/20 발주 예정」 「발주 전」 은 발주가 아니다. 해는 행사 시작 해 — 그보다 뒤면 지난해.
 */
export function orderedFromNote(note: string | undefined, eventFrom: string): string | null {
  if (!note || !ISO.test(eventFrom)) return null;
  const re = /(\d{1,2})\/(\d{1,2})(?:\s*[~∼-]\s*(?:\d{1,2}\/)?\d{1,2})?\s*발주(?!\s*(?:예정|할|전|해야|필요))/g;
  let best: string | null = null;
  for (const m of note.matchAll(re)) {
    const mo = Number(m[1]);
    const d = Number(m[2]);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) continue;
    let y = Number(eventFrom.slice(0, 4));
    let iso = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    if (iso > eventFrom) {
      y -= 1;
      iso = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    }
    if (!best || iso < best) best = iso;
  }
  return best;
}

/** 발주한 날 — 칸이 정본, 없으면 메모 */
export function orderedDate(e: Pick<SalesEvent, "orderedAt" | "note" | "from">): { date: string; from: "field" | "note" } | null {
  if (e.orderedAt && ISO.test(e.orderedAt)) return { date: e.orderedAt, from: "field" };
  const n = orderedFromNote(e.note, e.from);
  return n ? { date: n, from: "note" } : null;
}

// ---- 캘린더 ↔ ERP 짝 맞추기 ---------------------------------------
//
//  이름이 조금씩 다르다 — 「B.I (비아이)」↔「비아이」 · 「NCTWISH 사쿠야」↔「NCT WISH 사쿠야」 ·
//  「소디엑 웨인 (포도알)」↔「소디엑 웨인」. 매장도 어긋날 때가 있다(라이즈 소희). 그래서
//  기간이 겹치는(앞뒤 2일 여유) 것 중에서 이름 낱말이 가장 많이 겹치는 것을 고른다.

const tokens = (s: string) =>
  s
    .toLowerCase()
    .split(/[\s()[\]&·,/+]+/)
    .map((t) => t.replace(/[^0-9a-z가-힣]/g, ""))
    .filter((t) => t.length >= 2);
const compact = (s: string) => s.toLowerCase().replace(/[^0-9a-z가-힣]/g, "");

/** 두 이름이 얼마나 같은가 — 서로의 낱말이 상대 이름 안에 든 글자 수 */
export function nameScore(a: string, b: string): number {
  const ca = compact(a);
  const cb = compact(b);
  if (!ca || !cb) return 0;
  if (ca === cb) return 100;
  const hit = (ts: string[], c: string) => ts.filter((t) => c.includes(t)).reduce((s, t) => s + t.length, 0);
  return Math.max(hit(tokens(a), cb), hit(tokens(b), ca));
}

const overlaps = (a1: string, a2: string, b1: string, b2: string, slack = 2) =>
  daysBetween(b2, a1) <= slack && daysBetween(a2, b1) <= slack;

export interface OrderEvent {
  /** 알림 기록 열쇠 — 캘린더 이벤트면 cal:<id>, ERP 에만 있으면 erp:<코드> */
  key: string;
  name: string;
  store: CalendarBirthday["store"] | SalesStore;
  from: string;
  to: string;
  calendarId?: string;
  /** 짝이 된 ERP 이벤트 코드 */
  erpId?: string;
  ordered?: { date: string; from: "field" | "note" };
  /** 캘린더와 ERP 의 매장이 다르다 */
  storeMismatch?: boolean;
}

/** 캘린더 이벤트마다 ERP 이벤트를 하나씩 붙이고, ERP 에만 있는 것도 더한다 */
export function pairEvents(calendar: CalendarBirthday[], sales: SalesEvent[]): OrderEvent[] {
  const cands: { c: number; s: number; score: number }[] = [];
  calendar.forEach((c, ci) =>
    sales.forEach((s, si) => {
      if (!c.startDate || !s.from) return;
      if (!overlaps(c.startDate, c.endDate || c.startDate, s.from, s.to || s.from)) return;
      const score = nameScore(c.title, s.name);
      if (score >= 2) cands.push({ c: ci, s: si, score });
    }),
  );
  cands.sort((a, b) => b.score - a.score);
  const cUsed = new Map<number, number>();
  const sUsed = new Set<number>();
  for (const x of cands) {
    if (cUsed.has(x.c) || sUsed.has(x.s)) continue;
    cUsed.set(x.c, x.s);
    sUsed.add(x.s);
  }
  const out: OrderEvent[] = calendar
    .filter((c) => c.startDate)
    .map((c, ci) => {
      const si = cUsed.get(ci);
      const s = si === undefined ? undefined : sales[si];
      return {
        key: `cal:${c.id}`,
        name: c.title.trim(),
        store: c.store,
        from: c.startDate,
        to: c.endDate || c.startDate,
        calendarId: c.id,
        ...(s
          ? {
              erpId: s.id,
              ...(orderedDate(s) ? { ordered: orderedDate(s)! } : {}),
              ...(c.store !== "all" && c.store !== s.store ? { storeMismatch: true } : {}),
            }
          : {}),
      };
    });
  sales.forEach((s, si) => {
    if (sUsed.has(si) || !s.from) return;
    const o = orderedDate(s);
    out.push({ key: `erp:${s.id}`, name: s.name, store: s.store, from: s.from, to: s.to || s.from, erpId: s.id, ...(o ? { ordered: o } : {}) });
  });
  return out.sort((a, b) => a.from.localeCompare(b.from) || a.name.localeCompare(b.name));
}

/** 오늘 이 이벤트의 단계 */
export function orderStage(e: Pick<OrderEvent, "from" | "ordered">, today: string): OrderStage {
  const d = daysBetween(today, e.from);
  if (d <= 0) return "running";
  if (e.ordered) return "ordered";
  if (d <= ORDER_DAYS.daily) return "daily";
  if (d <= ORDER_DAYS.late) return "late";
  if (d <= ORDER_DAYS.due) return "due";
  return "early";
}

/** 오늘 보낼 알림의 기록 열쇠 — 보낼 것이 없으면 null. daily 는 날마다 다른 열쇠 */
export function alertKey(e: OrderEvent, today: string): string | null {
  const st = orderStage(e, today);
  if (st === "due" || st === "late") return `${e.key}¦${st}`;
  if (st === "daily") return `${e.key}¦day-${today}`;
  return null;
}

/** 노션 표에 올릴 이벤트 — 오늘 끝나지 않았고 45일 안에 시작 (온라인 이벤트는 발주가 다르다) */
export function inWindow(e: OrderEvent, today: string): boolean {
  return e.store !== "online" && e.to >= today && daysBetween(today, e.from) <= ORDER_HORIZON_DAYS;
}

const STORE_NAME: Record<OrderEvent["store"], string> = { id: "아이디", wow: "와우", all: "공통", online: "온라인" };
export const orderStoreLabel = (s: OrderEvent["store"]) => STORE_NAME[s] ?? s;

const md = (iso: string) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`;
export const periodText = (e: Pick<OrderEvent, "from" | "to">) => (e.from === e.to ? md(e.from) : `${md(e.from)}~${md(e.to)}`);

/** 폰 알림 글 — 무엇이 · 언제 · 얼마나 남았나가 미리보기 한 줄에 */
export function orderAlertText(e: OrderEvent, today: string): string {
  const d = daysBetween(today, e.from);
  const st = orderStage(e, today);
  const head = st === "due" ? "🎂 발주할 때" : "🎂 발주 늦음";
  const where = e.erpId ? `ERP ${e.erpId} 에 발주일이 없습니다` : "ERP 이벤트 입력에 아직 없습니다";
  const when = st === "daily" ? ` · 평소 가장 늦게 한 발주가 8일 전이었습니다` : "";
  return `${head} — ${e.name} (${orderStoreLabel(e.store)} ${periodText(e)}) D-${d}. ${where}${when}.`;
}
