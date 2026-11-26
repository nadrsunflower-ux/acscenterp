// ============================================================
//  상하이 출장 일정(/neander/2026shanghai) — 누구나 고치는 일정의 규칙 (순수 함수)
// ------------------------------------------------------------
//  링크만 있으면 누구나 일정을 더하고 · 고치고 · 지울 수 있다(로그인 없음).
//  그래서 서버는 들어온 값을 믿지 않고 여기서 모양 · 길이 · 종류를 다시 맞춘다.
//  화면(lib/neander/trip/shanghai2026Html.ts)과 서버(server/shanghai2026.ts)가 같이 쓴다.
// ============================================================

export type Chip = [string, string];
export type Mode = "walk" | "taxi" | "subway" | "train";
export interface Leg { m: Mode; d?: string; c?: string; n?: string; from?: string; to?: string }
export interface TripItem {
  id: string; t: string; nd?: 1; k: string; title: string; sub?: string; img?: string;
  pin: string | null; pts: string[]; star?: 1; i?: Chip[]; w?: string; tip?: Chip[];
  menu?: string[]; menuSum?: string; go?: Leg[];
}
export interface TripDay {
  id: string; n: number; date: [number, number, number]; wd: string; title: string;
  ppl: string; ic: string; cover: string; fit: string[]; items: TripItem[];
}
/** [한국어 이름, 중국어 이름(고덕 검색어), 경도, 위도, 주소] — 좌표는 고덕(GCJ-02), 모르면 null */
export type Place = [string, string, number | null, number | null, string?];
export interface TripPlan { days: TripDay[]; places: Record<string, Place> }

export const CATS = ["food", "shop", "sight", "fun", "scent", "spa", "night", "stay", "fly", "rail", "meet"] as const;
export const MODES: Mode[] = ["walk", "taxi", "subway", "train"];
/** 화면 아이콘 묶음에 있는 이름만 받는다 */
export const ICONS = [
  "utensils", "bag", "landmark", "sparkles", "perfume", "leaf", "wine", "bed", "plane", "train", "subway", "car", "walk",
  "users", "clock", "yen", "star", "hourglass", "alert", "map", "pin", "nav", "copy", "target", "ext", "coffee", "id", "qr",
  "luggage", "ticket", "moon", "camera", "camoff", "gift", "store", "cart", "info", "phone", "up", "down", "shuffle",
  "repeat", "receipt", "card", "cash", "award", "home", "cal", "check", "tick", "door", "percent", "shirt", "waves", "fish",
  "building", "music", "zap", "ruler", "lock", "ban", "play",
];

export const LIMITS = { itemsPerDay: 40, chips: 8, tips: 12, menu: 16, legs: 3, pts: 6, userPlaces: 200 };

export class TripOpError extends Error {}

const clean = (v: unknown, max: number): string =>
  typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";

const PHOTO = /^(p\d{1,2}|g_[a-z]{2,12})$/;
const TIME = /^([01]\d|2[0-4]):([0-5]\d)$/;

/** 하루 안 순서 — 새벽 5시 전은 다음 날로 본다 (24:00 · 01:30 이 맨 뒤로) */
export function minuteOf(t: string): number {
  const m = TIME.exec(t);
  if (!m) return 0;
  const v = Number(m[1]) * 60 + Number(m[2]);
  return Number(m[1]) < 5 ? v + 24 * 60 : v;
}

export function sortItems(items: TripItem[]): TripItem[] {
  return items.map((it, i) => ({ it, i })).sort((a, b) => minuteOf(a.it.t) - minuteOf(b.it.t) || a.i - b.i).map((x) => x.it);
}

const hasCoords = (plan: TripPlan, k: unknown): k is string =>
  typeof k === "string" && !!plan.places[k] && plan.places[k][2] != null && plan.places[k][3] != null;
const known = (plan: TripPlan, k: unknown): k is string => typeof k === "string" && !!plan.places[k];

function chips(v: unknown, max: number, len: number): Chip[] {
  if (!Array.isArray(v)) return [];
  const out: Chip[] = [];
  for (const c of v.slice(0, max)) {
    if (!Array.isArray(c)) continue;
    const ic = ICONS.includes(String(c[0])) ? String(c[0]) : "info";
    const tx = clean(c[1], len);
    if (tx) out.push([ic, tx]);
  }
  return out;
}

/** 새 장소 { name, zh, addr } — 좌표 없이 고덕 검색어로만 남긴다 */
export interface NewPlace { name?: unknown; zh?: unknown; addr?: unknown }

export function placeKeyFor(zh: string): string {
  let h = 0;
  for (const ch of zh) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
  return "u_" + h.toString(36);
}

/**
 * 손님이 보낸 일정 한 줄을 받을 수 있는 모양으로 맞춘다.
 * 사진(img)은 원래 그 일정에 있던 것만 남긴다 — 밖의 주소를 끼워 넣지 못하게.
 */
export function sanitizeItem(raw: unknown, plan: TripPlan, opts: { id: string; prevImg?: string; place?: NewPlace }): { item: TripItem; place?: [string, Place] } {
  const r = (raw ?? {}) as Record<string, unknown>;
  const t = clean(r.t, 5);
  if (!TIME.test(t)) throw new TripOpError("시간은 09:30 처럼 적어 주세요.");
  const title = clean(r.title, 60);
  if (!title) throw new TripOpError("제목을 적어 주세요.");
  const k = (CATS as readonly string[]).includes(String(r.k)) ? String(r.k) : "sight";
  const item: TripItem = { id: opts.id, t, k, title, pin: null, pts: [] };
  if (Number(t.slice(0, 2)) < 5) item.nd = 1;
  const sub = clean(r.sub, 120); if (sub) item.sub = sub;
  if (r.star) item.star = 1;
  const w = clean(r.w, 120); if (w) item.w = w;
  const i = chips(r.i, LIMITS.chips, 40); if (i.length) item.i = i;
  const tip = chips(r.tip, LIMITS.tips, 160); if (tip.length) item.tip = tip;
  if (Array.isArray(r.menu)) {
    const menu = r.menu.slice(0, LIMITS.menu).map((m) => clean(m, 40)).filter(Boolean);
    if (menu.length) item.menu = menu;
  }
  const menuSum = clean(r.menuSum, 40); if (menuSum && item.menu) item.menuSum = menuSum;
  // 사진은 이 사이트 img/ 폴더의 파일 이름만 (p14 · g_dimsum) — 밖의 주소를 끼워 넣지 못하게
  if (typeof r.img === "string" && PHOTO.test(r.img)) item.img = r.img;
  else if (opts.prevImg && r.img === opts.prevImg) item.img = opts.prevImg;

  let place: [string, Place] | undefined;
  const np = opts.place;
  if (np && clean(np.zh, 80)) {
    const zh = clean(np.zh, 80);
    const key = placeKeyFor(zh);
    const addr = clean(np.addr, 80);
    const p: Place = addr ? [clean(np.name, 40) || zh, zh, null, null, addr] : [clean(np.name, 40) || zh, zh, null, null];
    place = [key, p];
  }
  const allKnown = (k: unknown) => known(plan, k) || (place && k === place[0]);
  if (hasCoords(plan, r.pin)) item.pin = r.pin;
  if (Array.isArray(r.pts)) item.pts = [...new Set(r.pts.filter(allKnown).map(String))].slice(0, LIMITS.pts);
  if (place && !item.pts.includes(place[0])) item.pts.unshift(place[0]);
  if (item.pin && !item.pts.includes(item.pin)) item.pts.unshift(item.pin);
  item.pts = item.pts.slice(0, LIMITS.pts);

  if (Array.isArray(r.go)) {
    const go: Leg[] = [];
    for (const g0 of r.go.slice(0, LIMITS.legs)) {
      const g = (g0 ?? {}) as Record<string, unknown>;
      if (!MODES.includes(g.m as Mode)) continue;
      const leg: Leg = { m: g.m as Mode };
      const d = clean(g.d, 30); if (d) leg.d = d;
      const c = clean(g.c, 30); if (c) leg.c = c;
      const n = clean(g.n, 120); if (n) leg.n = n;
      if (hasCoords(plan, g.from)) leg.from = g.from;
      if (hasCoords(plan, g.to)) leg.to = g.to;
      go.push(leg);
    }
    if (go.length) item.go = go;
  }
  return { item, place };
}

export interface TripOp {
  op: "add" | "update" | "delete" | "reorder";
  day?: string;
  id?: string;
  /** reorder: 그날 일정 id 를 새 순서대로 전부 */
  ids?: unknown;
  item?: unknown;
  place?: NewPlace;
}

/** 바뀐 것 한 건 — 되돌리기에 쓴다 */
export interface Change {
  op: TripOp["op"]; id: string; day: string; beforeDay?: string; before?: TripItem; after?: TripItem; title: string;
  /** reorder: 그날 일정 전체 전후 */
  beforeItems?: TripItem[]; afterItems?: TripItem[];
}

/**
 * 끌어서 순서 바꾸기 — 시간 칸은 그대로 두고 일정만 옮긴다.
 * (10:00 A · 12:00 B · 14:00 C 에서 C 를 맨 위로 → 10:00 C · 12:00 A · 14:00 B)
 * 앞 일정이 바뀐 일정은 「오는 길」의 출발지를 비워서 새 앞 일정에서 오게 한다.
 */
export function reorderItems(items: TripItem[], ids: string[]): TripItem[] {
  const times = items.map((x) => x.t);
  const byId = new Map(items.map((x) => [x.id, x]));
  const prevOf = new Map(items.map((x, i) => [x.id, items[i - 1]?.id]));
  return ids.map((id, k) => {
    const it: TripItem = JSON.parse(JSON.stringify(byId.get(id)));
    it.t = times[k];
    if (Number(it.t.slice(0, 2)) < 5) it.nd = 1; else delete it.nd;
    if (prevOf.get(id) !== ids[k - 1] && it.go?.[0]?.from) delete it.go[0].from;
    return it;
  });
}

const findItem = (plan: TripPlan, id: string) => {
  for (const d of plan.days) {
    const i = d.items.findIndex((x) => x.id === id);
    if (i >= 0) return { day: d, index: i, item: d.items[i] };
  }
  return null;
};

function addPlace(plan: TripPlan, place?: [string, Place]) {
  if (!place) return;
  const userPlaces = Object.keys(plan.places).filter((k) => k.startsWith("u_")).length;
  if (!plan.places[place[0]] && userPlaces >= LIMITS.userPlaces) throw new TripOpError("새 장소가 너무 많아요.");
  if (!plan.places[place[0]]) plan.places[place[0]] = place[1];
}

/** 일정 바꾸기 한 번. plan 을 고쳐 쓰지 않고 새 plan 을 돌려준다. */
export function applyOp(plan0: TripPlan, op: TripOp, newId: () => string): { plan: TripPlan; change: Change } {
  const plan: TripPlan = JSON.parse(JSON.stringify(plan0));
  if (op.op === "add") {
    const day = plan.days.find((d) => d.id === op.day);
    if (!day) throw new TripOpError("날짜를 골라 주세요.");
    if (day.items.length >= LIMITS.itemsPerDay) throw new TripOpError("하루에 일정이 너무 많아요.");
    const { item, place } = sanitizeItem(op.item, plan, { id: newId(), place: op.place });
    addPlace(plan, place);
    day.items = sortItems([...day.items, item]);
    return { plan, change: { op: "add", id: item.id, day: day.id, after: item, title: item.title } };
  }
  if (op.op === "reorder") {
    const day = plan.days.find((d) => d.id === op.day);
    if (!day) throw new TripOpError("날짜를 골라 주세요.");
    const ids = Array.isArray(op.ids) ? op.ids.map(String) : [];
    const cur = day.items.map((x) => x.id);
    if (ids.length !== cur.length || new Set(ids).size !== ids.length || !ids.every((x) => cur.includes(x))) {
      throw new TripOpError("다른 사람이 방금 이 날을 바꿨어요. 다시 해 주세요.");
    }
    const before = day.items;
    day.items = reorderItems(before, ids);
    return { plan, change: { op: "reorder", id: day.id, day: day.id, title: "순서 바꾸기", beforeItems: before, afterItems: day.items } };
  }
  const id = String(op.id ?? "");
  const found = findItem(plan, id);
  if (!found) throw new TripOpError("그 일정이 이미 지워졌어요. 새로고침해 주세요.");
  if (op.op === "delete") {
    found.day.items.splice(found.index, 1);
    return { plan, change: { op: "delete", id, day: found.day.id, before: found.item, title: found.item.title } };
  }
  if (op.op === "update") {
    const target = op.day ? plan.days.find((d) => d.id === op.day) : found.day;
    if (!target) throw new TripOpError("날짜를 골라 주세요.");
    const { item, place } = sanitizeItem(op.item, plan, { id, prevImg: found.item.img, place: op.place });
    addPlace(plan, place);
    found.day.items.splice(found.index, 1);
    if (target !== found.day && target.items.length >= LIMITS.itemsPerDay) throw new TripOpError("하루에 일정이 너무 많아요.");
    target.items = sortItems([...target.items, item]);
    return { plan, change: { op: "update", id, day: target.id, beforeDay: found.day.id, before: found.item, after: item, title: item.title } };
  }
  throw new TripOpError("알 수 없는 요청이에요.");
}

/** 바뀐 것 되돌리기 — 더한 건 지우고, 지운 건 되살리고, 고친 건 예전 모양으로 */
export function revertChange(plan0: TripPlan, ch: Change): { plan: TripPlan; change: Change } {
  const plan: TripPlan = JSON.parse(JSON.stringify(plan0));
  if (ch.op === "reorder") {
    const day = plan.days.find((d) => d.id === ch.day);
    const back = ch.beforeItems ?? [];
    const same = (a: TripItem[], b: TripItem[]) => a.length === b.length && a.every((x) => b.some((y) => y.id === x.id));
    if (!day || !same(day.items, back)) throw new TripOpError("그 뒤로 이 날이 바뀌어서 순서를 되돌릴 수 없어요.");
    const now = day.items;
    day.items = back;
    return { plan, change: { op: "reorder", id: day.id, day: day.id, title: "순서 바꾸기", beforeItems: now, afterItems: back } };
  }
  const found = findItem(plan, ch.id);
  if (ch.op === "add") {
    if (!found) throw new TripOpError("이미 지워진 일정이에요.");
    found.day.items.splice(found.index, 1);
    return { plan, change: { op: "delete", id: ch.id, day: found.day.id, before: found.item, title: found.item.title } };
  }
  const back = ch.before!;
  const dayId = ch.op === "update" ? ch.beforeDay ?? ch.day : ch.day;
  const day = plan.days.find((d) => d.id === dayId) ?? plan.days[0];
  if (found) found.day.items.splice(found.index, 1);
  day.items = sortItems([...day.items, back]);
  return found
    ? { plan, change: { op: "update", id: ch.id, day: day.id, beforeDay: found.day.id, before: found.item, after: back, title: back.title } }
    : { plan, change: { op: "add", id: ch.id, day: day.id, after: back, title: back.title } };
}
