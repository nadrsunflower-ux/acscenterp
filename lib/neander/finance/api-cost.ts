// ============================================================
//  API 비용 — 오픈라우터 키마다 쓴 돈을 어느 프로젝트에 썼는지 (순수 함수)
// ------------------------------------------------------------
//  한 오픈라우터 계정에서 사람 · 서비스가 키를 하나씩 따서 쓴다. 키 하나가 한 프로젝트에만
//  쓰이지 않는다 — 김주연 키가 어느 주엔 B2B 개발, 어느 날엔 채널 영상에 쓰인다.
//  그래서 「키 → 프로젝트」 를 두 겹으로 정한다.
//
//    · 키의 기본 — 따로 정하지 않은 날은 모두 여기로 (예: 이태원 포토부스 키 → 공통)
//    · 시간 구간 — 그 키의 그 시간들만 다른 곳으로 (예: 11/7~11/8 → 안산 축제 · 11/5 19~23시 → 포유필름)
//
//  구간은 한 시간(`YYYY-MM-DDTHH`, 한국 시각) 단위로 저장하고, 한 키 안에서 서로 겹치지 않게
//  유지한다 (setRange 가 겹치던 구간을 잘라 낸다). 그래서 「어느 시간은 어디」 의 답이 늘 하나다 —
//  구간이 있으면 구간, 없으면 기본. 같은 날이 시간에 따라 여러 곳으로 나뉠 수 있다 (keyDay).
//
//  하루는 한국 날짜다 — 0시부터 24시까지. 오픈라우터의 시간별 기록(/analytics/query)을
//  한국 날짜로 모아 ERP 에 쌓는다 (server/api-cost.ts). 키 이름으로 나오므로 만료 · 삭제된
//  키의 돈까지 빠짐없이 잡힌다.
//
//  ⚠️ 오픈라우터는 시간별 기록을 약 35일만 남긴다. 그보다 오래된 것은 UTC 하루 묶음뿐이라
//  한국 날짜로 나눌 수 없다. 그래서 EXACT_FROM 앞의 날(legacy)은 한국 시각 오전 9시에 끊긴
//  하루 그대로 두고 화면에 「9시 기준」 으로 표시한다. 그 뒤로는 매일 쌓아 두므로 정확하다.
//  시간별 금액이 없는 날은 시간으로 나눌 수 없다 — 그날 0시 칸의 답을 하루 전체에 쓴다.
//
//  붙일 곳: 재무 프로젝트(fin:문서 id) · AI STUDIO 채널(studio:space id) · 공통(common:).
//  재무 프로젝트에 붙인 돈은 사람이 「원가로 보내기」 를 눌러야 그 프로젝트의 지출 줄
//  (id api-cost · 분류 「AI API」) 이 된다. 누르기 전에는 프로젝트 이익이 바뀌지 않는다.
// ============================================================

import type { FinProjectLine } from "./project";

// ---- 붙일 곳 ------------------------------------------------------

export type ApiTargetKind = "fin" | "studio" | "biz" | "common";
export interface ApiTarget {
  kind: ApiTargetKind;
  /**
   * fin → 재무 프로젝트 문서 id · studio → AI STUDIO 프로젝트 id ·
   * biz → 장부의 사업구분 `대분류|소분류` (예: `B2C|SMOAT`) · common → ""
   */
  id: string;
}

export const API_TARGET_KIND_LABEL: Record<ApiTargetKind, string> = {
  fin: "재무 프로젝트",
  studio: "AI STUDIO 채널",
  biz: "사업구분",
  common: "공통 · 내부",
};

/** 사업구분 붙일 곳의 id — 장부의 사업대분류 · 사업소분류 한 쌍 */
export const bizTargetId = (major: string, minor: string) => `${major}|${minor}`;
/** `B2C|SMOAT` → { major: "B2C", minor: "SMOAT" }. 모양이 틀리면 null */
export function splitBizId(id: string): { major: string; minor: string } | null {
  const i = id.indexOf("|");
  if (i <= 0 || i === id.length - 1) return null;
  const major = id.slice(0, i).trim();
  const minor = id.slice(i + 1).trim();
  if (!major || !minor || minor.includes("|") || major.length > 20 || minor.length > 40) return null;
  return { major, minor };
}
export const COMMON_LABEL = "공통 · 내부 (프로젝트 아님)";

/** 붙일 곳 → 문자열 열쇠 `kind:id` (Select 값 · 묶음 열쇠). 없으면 "" */
export const targetKey = (t: ApiTarget | null | undefined): string => (t ? `${t.kind}:${t.id}` : "");

export function parseTargetKey(s: string): ApiTarget | null {
  const i = s.indexOf(":");
  if (i < 0) return null;
  const kind = s.slice(0, i);
  const id = s.slice(i + 1);
  if (kind === "common") return { kind: "common", id: "" };
  if ((kind === "fin" || kind === "studio") && id) return { kind, id };
  if (kind === "biz" && splitBizId(id)) return { kind, id };
  return null;
}

// ---- 날짜 (한국 날짜 `YYYY-MM-DD`) --------------------------------

const DAY = 86_400_000;
const HOUR = 3_600_000;
/** 열린 구간의 끝 — 「계속」 */
const OPEN_END = "9999-12-31T23";

export const isDate = (s: unknown): s is string =>
  typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
export const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
export const kstDate = (ms: number) => new Date(ms + 9 * 3600_000).toISOString().slice(0, 10);
/** 다 끝난 마지막 날 — 어제 (한국 날짜) */
export const lastCompletedDay = (now: number) => addDays(kstDate(now), -1);
/** 한국 날짜 하루 → 오픈라우터에 물을 UTC 범위 (0시 = 전날 15시 UTC · 끝은 14:59:59) */
export const kstDayRange = (date: string) => ({ start: `${addDays(date, -1)}T15:00:00Z`, end: `${date}T14:59:59Z` });
/**
 * 이 날부터 한국 날짜 0~24시로 정확하다. 앞의 날은 2026-11-09 에 UTC 하루 묶음으로 한 번 넣었고
 * (시간별 기록이 이미 없다) 다시 받지 않는다.
 */
export const EXACT_FROM = "2026-10-06";
/** 시간별 기록이 확실히 남아 있는 날 수 — 이보다 오래된 날을 다시 받으면 빈 값으로 덮어쓰게 된다 */
export const HOURLY_SAFE_DAYS = 33;
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);

const WEEKDAY = ["일", "월", "화", "수", "목", "금", "토"];
/** `11/5 (수)` */
export const dayLabel = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))} (${WEEKDAY[new Date(`${d}T00:00:00Z`).getUTCDay()]})`;
/** `11/5` · 해가 다르면 `2025/11/5` */
export const shortDate = (d: string, thisYear?: string) =>
  `${thisYear && d.slice(0, 4) !== thisYear ? `${d.slice(0, 4)}/` : ""}${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

// ---- 시간 칸 (한국 시각 한 시간 `YYYY-MM-DDTHH`) -----------------

export const isSlot = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3])$/.test(s) && isDate(s.slice(0, 10));
export const addHours = (slot: string, n: number) => new Date(Date.parse(`${slot}:00:00Z`) + n * HOUR).toISOString().slice(0, 13);
/** 구간의 시작 칸 — 날짜만 있으면 그날 0시 */
export const slotFrom = (s: string) => (s.length === 10 ? `${s}T00` : s);
/** 구간의 끝 칸 — 날짜만 있으면 그날 23시 (24시까지) */
export const slotTo = (s: string) => (s.length === 10 ? `${s}T23` : s);

/**
 * `11/5` · `11/5 ~ 11/6` · `11/5 19시` · `11/5 19~23시` · `11/5 19시 ~ 11/6 4시` · 끝이 없으면 `… ~ 계속`.
 * 끝 시각은 그 시간까지다 — 23시는 23:59 까지.
 */
export function rangeLabel(r: { from: string; to?: string }, thisYear?: string): string {
  const from = slotFrom(r.from);
  const fromDay = shortDate(from.slice(0, 10), thisYear);
  const fromHour = Number(from.slice(11, 13));
  if (!r.to) return fromHour === 0 ? `${fromDay} ~ 계속` : `${fromDay} ${fromHour}시 ~ 계속`;
  const to = slotTo(r.to);
  const toDay = shortDate(to.slice(0, 10), thisYear);
  const toHour = Number(to.slice(11, 13));
  const sameDay = from.slice(0, 10) === to.slice(0, 10);
  if (fromHour === 0 && toHour === 23) return sameDay ? fromDay : `${fromDay} ~ ${toDay}`;
  if (sameDay) return fromHour === toHour ? `${fromDay} ${fromHour}시` : `${fromDay} ${fromHour}~${toHour}시`;
  return `${fromDay} ${fromHour}시 ~ ${toDay} ${toHour}시`;
}

/** 고른 시간 칸 → 넣을 구간. usedHours — 그날 돈을 쓴 시간(정렬됨). 시간별 금액이 없는 날은 빈 목록 */
export function spansFromSlots(selected: Iterable<string>, usedHours: Record<string, string[]>): { from: string; to: string }[] {
  const byDate = new Map<string, Set<string>>();
  for (const slot of selected) {
    if (!isSlot(slot)) continue;
    const date = slot.slice(0, 10);
    if (!byDate.has(date)) byDate.set(date, new Set());
    byDate.get(date)?.add(slot.slice(11, 13));
  }
  const spans: { from: string; to: string }[] = [];
  for (const date of [...byDate.keys()].sort()) {
    const picked = byDate.get(date) ?? new Set<string>();
    const used = usedHours[date] ?? [];
    // 쓴 시간을 다 골랐으면 그날 통째로
    if (used.every((h) => picked.has(h))) {
      spans.push({ from: `${date}T00`, to: `${date}T23` });
      continue;
    }
    // 고르지 않은 「쓴 시간」 에서만 끊는다 — 사이에 안 쓴 시간이 끼어 있으면 이어 본다
    let run: { from: string; to: string } | null = null;
    for (const h of used) {
      if (!picked.has(h)) {
        if (run) spans.push(run);
        run = null;
      } else if (run) run.to = `${date}T${h}`;
      else run = { from: `${date}T${h}`, to: `${date}T${h}` };
    }
    if (run) spans.push(run);
  }
  // 붙어 있는 구간은 하나로 (통째로 고른 이어진 날들)
  const merged: { from: string; to: string }[] = [];
  for (const sp of spans) {
    const last = merged[merged.length - 1];
    if (last && addHours(last.to, 1) === sp.from) last.to = sp.to;
    else merged.push({ ...sp });
  }
  return merged;
}

/** 날짜 몇 개 → 이어진 덩어리 (정렬 · 중복 제거) */
export function dateRuns(dates: string[]): { from: string; to: string }[] {
  const sorted = [...new Set(dates.filter(isDate))].sort();
  const out: { from: string; to: string }[] = [];
  for (const d of sorted) {
    const last = out[out.length - 1];
    if (last && addDays(last.to, 1) === d) last.to = d;
    else out.push({ from: d, to: d });
  }
  return out;
}

// ---- 날짜별 기록 ---------------------------------------------------

export interface ApiDayModel {
  model: string;
  requests: number;
  usd: number;
}
/** 한 키의 한 시간 */
export interface ApiDayHour {
  usd: number;
  requests: number;
  /** 많이 쓴 모델 이름 두 개까지 — 그 시간에 무엇을 했는지 알아보라고 */
  models: string[];
}
export interface ApiDayKey {
  hash: string;
  name: string;
  usd: number;
  requests: number;
  models: ApiDayModel[];
  /** 한국 시각별 (`"00"`~`"23"`). 오픈라우터가 시간별 기록을 35일 뒤 지우므로 받을 때 남겨 둔다. 「9시 기준」 날에는 없다 */
  hours?: Record<string, ApiDayHour>;
}
/** neander_fin_api_days/{한국 날짜} */
export interface ApiDayDoc {
  date: string;
  at: number;
  keys: ApiDayKey[];
  /** 오늘 — 아직 끝나지 않은 날 (저장하지 않고 화면을 열 때 받는다) */
  partial?: boolean;
  /** EXACT_FROM 앞의 날 — 한국 시각 오전 9시에 끊긴 하루 (date 의 9시 ~ 다음 날 9시) */
  legacy?: boolean;
}

/** 오픈라우터 /analytics/query 의 한 줄 (키 · 모델 · 시간별) */
export interface AnalyticsRow {
  /** UTC `YYYY-MM-DD HH:00:00` — 시간 단위로 물었을 때만 */
  date__hour?: unknown;
  api_key_id?: unknown;
  model?: unknown;
  total_usage?: unknown;
  request_count?: unknown;
}

/** `google/gemini-3-flash-preview-20251217` → 날짜 꼬리를 뗀 이름 — 판이 바뀌어도 한 모델로 묶이게 */
export const cleanModel = (m: string) => m.replace(/-\d{8}$/, "");

/**
 * 한국 날짜 하루의 시간별 줄 → 그날 키 · 모델별 합.
 * 오픈라우터는 키를 이름으로 준다 — hashOf 가 이름을 ERP 가 쓰는 키 해시로 바꾼다.
 */
export function dayFromAnalytics(date: string, rows: AnalyticsRow[], hashOf: (name: string) => string, at: number): ApiDayDoc {
  const num = (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };
  const round = (n: number) => Math.round(n * 1e6) / 1e6;
  const keys = new Map<string, ApiDayKey>();
  // 시간마다 모델별 금액 — 다 모은 뒤 많이 쓴 이름만 남긴다
  const hourModels = new Map<ApiDayHour, Map<string, number>>();
  for (const r of rows) {
    const usd = num(r.total_usage);
    const requests = num(r.request_count);
    if (!(usd > 0) && !(requests > 0)) continue;
    const name = typeof r.api_key_id === "string" && r.api_key_id ? r.api_key_id : "(키 없음)";
    const hash = hashOf(name);
    const k = keys.get(hash) ?? { hash, name, usd: 0, requests: 0, models: [] };
    k.usd += usd;
    k.requests += requests;
    const model = cleanModel(typeof r.model === "string" && r.model ? r.model : "?");
    const utcHour = typeof r.date__hour === "string" ? /\s(\d{2}):/.exec(r.date__hour)?.[1] : undefined;
    if (utcHour !== undefined) {
      const kstHour = String((Number(utcHour) + 9) % 24).padStart(2, "0");
      k.hours = k.hours ?? {};
      const h = (k.hours[kstHour] = k.hours[kstHour] ?? { usd: 0, requests: 0, models: [] });
      h.usd += usd;
      h.requests += requests;
      const byModel = hourModels.get(h) ?? new Map<string, number>();
      byModel.set(model, (byModel.get(model) ?? 0) + usd);
      hourModels.set(h, byModel);
    }
    const m = k.models.find((x) => x.model === model);
    if (m) {
      m.usd += usd;
      m.requests += requests;
    } else k.models.push({ model, requests, usd });
    keys.set(hash, k);
  }
  const list = [...keys.values()]
    .map((k) => {
      const out: ApiDayKey = {
        ...k,
        usd: round(k.usd),
        models: k.models.map((m) => ({ ...m, usd: round(m.usd) })).sort((a, b) => b.usd - a.usd),
      };
      if (k.hours) {
        out.hours = Object.fromEntries(
          Object.entries(k.hours).map(([hour, h]) => [
            hour,
            {
              usd: round(h.usd),
              requests: h.requests,
              models: [...(hourModels.get(h) ?? new Map<string, number>()).entries()]
                .sort((a, b) => b[1] - a[1])
                .slice(0, 2)
                .map(([m]) => modelName(m)),
            },
          ]),
        );
      }
      return out;
    })
    .filter((k) => k.usd > 0 || k.requests > 0)
    .sort((a, b) => b.usd - a.usd);
  return { date, at, keys: list };
}

// ---- 키별로 정한 것 ------------------------------------------------

export interface ApiRange {
  id: string;
  /** 시작 시간 칸 `YYYY-MM-DDTHH` (한국 시각) */
  from: string;
  /** 끝 시간 칸 (그 시간까지). 비우면 「계속」 — 이 뒤로 쭉 */
  to?: string;
  target: ApiTarget;
  note?: string;
  at: number;
  by?: string;
}
/** neander_fin_api_alloc/{키 해시} */
export interface ApiKeyAlloc {
  hash: string;
  /** 보이는 이름 (오픈라우터 이름의 사본 — 키가 사라져도 이름이 남게) */
  name: string;
  /** 따로 정하지 않은 날의 붙일 곳. 없으면 「안 정함」 */
  default?: ApiTarget | null;
  ranges: ApiRange[];
  updatedAt?: number;
  updatedBy?: string;
}

export interface ApiPushRecord {
  at: number;
  by?: string;
  usd: number;
  krw: number;
  rate: number;
  /** 보낸 돈에 들어간 마지막 날 */
  through: string;
}
/** neander_fin_settings/api-cost */
export interface ApiCostSettings {
  /** 크레딧 1달러가 원화로 얼마였나 — 카드 충전(수수료 · 환율 포함) 기준 */
  krwPerUsd: number;
  /** 재무 프로젝트 id → 마지막으로 원가로 보낸 것 */
  pushed: Record<string, ApiPushRecord>;
}

/** 2026-10 하순 $50 충전이 71,347~71,994원 → 크레딧 $1 ≈ 1,430원 (안산 축제 원가 줄과 같은 값) */
export const DEFAULT_KRW_PER_USD = 1430;

export function sanitizeSettings(raw: unknown): ApiCostSettings {
  const r = (raw ?? {}) as Partial<ApiCostSettings>;
  return {
    krwPerUsd: cleanRate(r.krwPerUsd) ?? DEFAULT_KRW_PER_USD,
    pushed: r.pushed && typeof r.pushed === "object" ? r.pushed : {},
  };
}

/** 환율 — 500~5,000원 사이 정수만 */
export function cleanRate(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n < 500 || n > 5000) return null;
  return Math.round(n);
}

export const cleanNote = (v: unknown) => (typeof v === "string" ? v.trim().slice(0, 120) : "");

// ---- 구간 다루기 ---------------------------------------------------

const endOf = (r: { to?: string }) => (r.to ? slotTo(r.to) : OPEN_END);
/** 그 시간 칸이 구간 안인가 — 날짜만 주면 그날 0시 칸 */
export const rangeHas = (r: { from: string; to?: string }, at: string) => {
  const slot = slotFrom(at);
  return slotFrom(r.from) <= slot && slot <= endOf(r);
};

/** r 에서 [from, to] 를 뺀 조각 (0~2개). to 가 없으면 from 뒤로 전부 뺀다. 조각은 시간 칸으로 돌려준다 */
export function cutRange<R extends { from: string; to?: string }>(r: R, from: string, to: string | undefined): R[] {
  const rFrom = slotFrom(r.from);
  const rEnd = endOf(r);
  const cutFrom = slotFrom(from);
  const cutEnd = to ? slotTo(to) : OPEN_END;
  if (cutEnd < rFrom || cutFrom > rEnd) return [r];
  const out: R[] = [];
  if (rFrom < cutFrom) out.push({ ...r, from: rFrom, to: addHours(cutFrom, -1) });
  if (cutEnd < rEnd) {
    const right = { ...r, from: addHours(cutEnd, 1) };
    if (r.to) right.to = rEnd;
    else delete right.to;
    out.push(right);
  }
  return out;
}

const byFrom = (a: ApiRange, b: ApiRange) => a.from.localeCompare(b.from);

/** 붙은 두 구간이 같은 곳 · 같은 메모면 하나로 — 날을 하나씩 골라 붙여도 목록이 길어지지 않게 */
function mergeAdjacent(sorted: ApiRange[]): ApiRange[] {
  const out: ApiRange[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && last.to && addHours(last.to, 1) === r.from && targetKey(last.target) === targetKey(r.target) && (last.note ?? "") === (r.note ?? "")) {
      const merged: ApiRange = { ...last, at: Math.max(last.at, r.at) };
      if (r.to) merged.to = r.to;
      else delete merged.to;
      out[out.length - 1] = merged;
    } else out.push(r);
  }
  return out;
}

/**
 * 키의 구간 목록에 [from, to] → target 을 넣는다. 겹치던 구간은 그 시간만큼 잘라 낸다.
 * target 이 null 이면 잘라 내기만 한다 — 그 시간들은 다시 키의 기본을 따른다.
 */
export function setRange(
  ranges: ApiRange[],
  span: { from: string; to?: string },
  target: ApiTarget | null,
  meta: { at: number; by?: string; note?: string },
  newId: () => string,
): ApiRange[] {
  const out: ApiRange[] = [];
  for (const r of ranges) {
    cutRange(r, span.from, span.to).forEach((p, i, all) => {
      // 한 구간이 둘로 갈라지면 뒤 조각에 새 id
      out.push(all.length === 2 && i === 1 ? { ...p, id: newId() } : p);
    });
  }
  if (target) {
    const add: ApiRange = { id: newId(), from: slotFrom(span.from), target, at: meta.at };
    if (span.to) add.to = slotTo(span.to);
    if (meta.note) add.note = meta.note;
    if (meta.by) add.by = meta.by;
    out.push(add);
  }
  // 예전 모양(날짜만)이 남아 있어도 시간 칸으로 맞춘 뒤 정렬 · 합치기
  const normal = out.map((r) => {
    const n: ApiRange = { ...r, from: slotFrom(r.from) };
    if (r.to) n.to = slotTo(r.to);
    return n;
  });
  return mergeAdjacent(normal.sort(byFrom));
}

/** 그 키의 그 시간은 어디에 붙나 — 날짜만 주면 그날 0시 칸 */
export function targetOn(
  alloc: ApiKeyAlloc | undefined,
  at: string,
): { target: ApiTarget | null; via: "range" | "default" | null; rangeId?: string } {
  if (!alloc) return { target: null, via: null };
  const r = alloc.ranges.find((x) => rangeHas(x, at));
  if (r) return { target: r.target, via: "range", rangeId: r.id };
  if (alloc.default) return { target: alloc.default, via: "default" };
  return { target: null, via: null };
}

// ---- 붙여 보기 ----------------------------------------------------

const r6 = (n: number) => Math.round(n * 1e6) / 1e6;

export interface ApiHourRow {
  hour: string;
  slot: string;
  usd: number;
  requests: number;
  models: string[];
  target: ApiTarget | null;
  via: "range" | "default" | null;
}
/** 한 키의 하루 중 한 곳에 붙은 몫 */
export interface ApiDaySplit {
  key: string;
  target: ApiTarget | null;
  via: "range" | "default" | null;
  usd: number;
  requests: number;
  /** 그중 첫 · 마지막 시간 (시간별 금액이 있을 때) */
  hourFrom?: string;
  hourTo?: string;
}
export interface ApiKeyDay {
  date: string;
  hash: string;
  name: string;
  usd: number;
  requests: number;
  models: ApiDayModel[];
  partial: boolean;
  legacy: boolean;
  /** 돈을 쓴 시간들 — 시간별 금액이 없는 날은 빈 목록 */
  hours: ApiHourRow[];
  /** 붙은 곳별 몫 — 하나면 그날이 나뉘지 않은 것. 합은 그날 금액과 같다 */
  splits: ApiDaySplit[];
}

/** 키의 하루를 시간별로 정한 곳에 나눈다 */
export function keyDay(day: ApiDayDoc, k: ApiDayKey, alloc: ApiKeyAlloc | undefined): ApiKeyDay {
  const hours: ApiHourRow[] = Object.entries(k.hours ?? {})
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([hour, h]) => {
      const slot = `${day.date}T${hour}`;
      const t = targetOn(alloc, slot);
      return { hour, slot, usd: h.usd, requests: h.requests, models: h.models ?? [], target: t.target, via: t.via };
    });
  const groups = new Map<string, ApiDaySplit>();
  if (hours.length) {
    for (const h of hours) {
      const key = targetKey(h.target);
      const g = groups.get(key) ?? { key, target: h.target, via: h.via, usd: 0, requests: 0, hourFrom: h.hour, hourTo: h.hour };
      g.usd = r6(g.usd + h.usd);
      g.requests += h.requests;
      g.hourTo = h.hour;
      if (h.via === "range") g.via = "range";
      groups.set(key, g);
    }
  } else {
    const t = targetOn(alloc, day.date);
    groups.set(targetKey(t.target), { key: targetKey(t.target), target: t.target, via: t.via, usd: k.usd, requests: k.requests });
  }
  const paid = [...groups.values()].filter((g) => g.usd > 0).sort((a, b) => b.usd - a.usd);
  const splits = paid.length ? paid : [...groups.values()].slice(0, 1);
  // 시간별로 반올림한 끝자리 차이는 가장 큰 몫에 — 나눠도 그날 금액이 그대로 남게
  const sum = splits.reduce((n, g) => n + g.usd, 0);
  if (splits[0]) splits[0].usd = r6(splits[0].usd + (k.usd - sum));
  return { date: day.date, hash: k.hash, name: k.name, usd: k.usd, requests: k.requests, models: k.models, partial: !!day.partial, legacy: !!day.legacy, hours, splits };
}

export interface ApiCostRow {
  date: string;
  hash: string;
  name: string;
  usd: number;
  requests: number;
  partial: boolean;
  legacy: boolean;
  target: ApiTarget | null;
  /** 그날이 여러 곳으로 나뉘었을 때만 — 이 몫의 첫 · 마지막 시간 */
  hourFrom?: string;
  hourTo?: string;
}

/** 날짜별 기록 × 정한 것 → 키 · 날 · 붙은 곳 한 줄씩 (나뉜 날은 여러 줄) */
export function costRows(days: ApiDayDoc[], allocs: Record<string, ApiKeyAlloc>): ApiCostRow[] {
  const out: ApiCostRow[] = [];
  for (const d of days) {
    for (const k of d.keys) {
      if (!(k.usd > 0)) continue;
      const kd = keyDay(d, k, allocs[k.hash]);
      const split = kd.splits.length > 1;
      for (const g of kd.splits) {
        const row: ApiCostRow = { date: d.date, hash: k.hash, name: k.name, usd: g.usd, requests: g.requests, partial: kd.partial, legacy: kd.legacy, target: g.target };
        if (split && g.hourFrom !== undefined) {
          row.hourFrom = g.hourFrom;
          row.hourTo = g.hourTo;
        }
        out.push(row);
      }
    }
  }
  return out;
}


export interface ApiKeySum {
  hash: string;
  name: string;
  usd: number;
  assigned: number;
  unassigned: number;
  days: number;
}
export function sumByKey(rows: ApiCostRow[]): ApiKeySum[] {
  const m = new Map<string, ApiKeySum>();
  const dates = new Map<string, Set<string>>();
  for (const r of rows) {
    const s = m.get(r.hash) ?? { hash: r.hash, name: r.name, usd: 0, assigned: 0, unassigned: 0, days: 0 };
    s.usd = r6(s.usd + r.usd);
    if (r.target) s.assigned = r6(s.assigned + r.usd);
    else s.unassigned = r6(s.unassigned + r.usd);
    m.set(r.hash, s);
    // 나뉜 날은 줄이 여러 개다 — 날은 한 번만 센다
    const seen = dates.get(r.hash) ?? new Set<string>();
    seen.add(r.date);
    dates.set(r.hash, seen);
    s.days = seen.size;
  }
  return [...m.values()].sort((a, b) => b.usd - a.usd);
}

export interface ApiTargetSum {
  /** targetKey — 안 정한 돈은 "" */
  key: string;
  target: ApiTarget | null;
  usd: number;
  /** 그중 오늘(진행 중) 몫 */
  partialUsd: number;
  keys: { hash: string; name: string; usd: number; from: string; to: string }[];
}
export function sumByTarget(rows: ApiCostRow[]): ApiTargetSum[] {
  const m = new Map<string, ApiTargetSum>();
  for (const r of rows) {
    const key = targetKey(r.target);
    const s = m.get(key) ?? { key, target: r.target, usd: 0, partialUsd: 0, keys: [] };
    s.usd = r6(s.usd + r.usd);
    if (r.partial) s.partialUsd = r6(s.partialUsd + r.usd);
    let k = s.keys.find((x) => x.hash === r.hash);
    if (!k) s.keys.push((k = { hash: r.hash, name: r.name, usd: 0, from: r.date, to: r.date }));
    k.usd = r6(k.usd + r.usd);
    if (r.date < k.from) k.from = r.date;
    if (r.date > k.to) k.to = r.date;
    m.set(key, s);
  }
  for (const s of m.values()) s.keys.sort((a, b) => b.usd - a.usd);
  // 안 정한 돈은 맨 아래
  return [...m.values()].sort((a, b) => (a.key === "" ? 1 : b.key === "" ? -1 : b.usd - a.usd));
}

/** 하루 모델 몇 개를 한 줄로 — `Kling v3.0 Pro $36.51 · GPT Image 2 $28.03 외 4` */
export function modelsLine(models: ApiDayModel[], max = 2): string {
  const byModel = new Map<string, number>();
  for (const m of models) byModel.set(m.model, (byModel.get(m.model) ?? 0) + m.usd);
  const sorted = [...byModel.entries()].sort((a, b) => b[1] - a[1]);
  const head = sorted.slice(0, max).map(([m, u]) => `${modelName(m)} ${usdText(u)}`);
  return head.join(" · ") + (sorted.length > max ? ` 외 ${sorted.length - max}` : "");
}
/** 키를 마지막으로 쓴 때 — 쌓인 기록에서 가장 늦은 날의 가장 늦은 시간 */
export interface ApiLastUse {
  date: string;
  /** 한국 시각 `"00"`~`"23"` — 시간별 기록이 없는 날(9시 기준)은 없다 */
  hour?: string;
  /** 그 시간(시간이 없으면 그날) 쓴 돈 · 요청 · 모델 */
  usd: number;
  requests: number;
  models: string[];
  /** 오늘(진행 중) 기록 */
  partial: boolean;
}

/** 키마다 마지막으로 쓴 때. days 는 순서가 어떻든 된다 */
export function lastUses(days: ApiDayDoc[]): Map<string, ApiLastUse> {
  const out = new Map<string, ApiLastUse>();
  const sorted = [...days].sort((a, b) => b.date.localeCompare(a.date));
  for (const d of sorted) {
    for (const k of d.keys) {
      if (out.has(k.hash) || !(k.usd > 0 || k.requests > 0)) continue;
      const hours = Object.entries(k.hours ?? {}).filter(([, h]) => h.usd > 0 || h.requests > 0);
      if (hours.length) {
        const [hour, h] = hours.sort((a, b) => b[0].localeCompare(a[0]))[0];
        out.set(k.hash, { date: d.date, hour, usd: h.usd, requests: h.requests, models: h.models ?? [], partial: !!d.partial });
      } else {
        out.set(k.hash, { date: d.date, usd: k.usd, requests: k.requests, models: k.models.slice(0, 2).map((m) => modelName(m.model)), partial: !!d.partial });
      }
    }
  }
  return out;
}

/** 마지막으로 쓴 때가 지금(now, ms)에서 얼마나 지났나 — `이번 시간` · `3시간 전` · `2일 전` */
export function agoText(u: Pick<ApiLastUse, "date" | "hour">, now: number): string {
  // 그 시간이 끝난 때부터 센다 (19시 = 19:00~19:59)
  const end = Date.parse(`${u.date}T${u.hour ?? "23"}:00:00+09:00`) + HOUR;
  const h = Math.floor((now - end) / HOUR);
  if (u.hour !== undefined && h < 0) return "이번 시간";
  if (u.hour !== undefined && h < 24) return `${Math.max(1, h + 1)}시간 전`;
  const days = daysBetween(u.date, kstDate(now));
  return days <= 0 ? "오늘" : days === 1 ? "어제" : `${days}일 전`;
}

/** `google/gemini-3.8-flash-tts` → `gemini-3.8-flash-tts` */
export const modelName = (m: string) => m.split("/").pop() || m;

/** 달러 — 0 은 `$0`, 1센트 아래는 `<$0.01` */
export function usdText(n: number): string {
  if (!n) return "$0";
  if (Math.abs(n) < 0.01) return "<$0.01";
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
export const krwOf = (usd: number, rate: number) => Math.round(usd * rate);

// ---- 재무 프로젝트 원가로 보내기 ------------------------------------

export const API_COST_LINE_ID = "api-cost";
export const API_COST_CATEGORY = "AI API";

export interface ProjectApiCost {
  usd: number;
  /** 들어간 마지막 날 (없으면 "") */
  through: string;
  /** 키별 · 이어진 날 덩어리별. 나뉜 날의 몫은 따로 한 줄 (from · to 가 시간 칸) */
  parts: { hash: string; name: string; from: string; to: string; usd: number }[];
}

/** 그 재무 프로젝트에 붙은 돈 — 끝난 날만 (오늘은 숫자가 아직 움직인다) */
export function projectApiCost(rows: ApiCostRow[], projectId: string): ProjectApiCost {
  const mine = rows.filter((r) => !r.partial && r.target?.kind === "fin" && r.target.id === projectId);
  const parts: ProjectApiCost["parts"] = [];
  const byKey = new Map<string, ApiCostRow[]>();
  for (const r of mine) byKey.set(r.hash, [...(byKey.get(r.hash) ?? []), r]);
  for (const [hash, list] of byKey) {
    // 하루 통째인 날은 이어 묶고, 나뉜 날의 몫은 어느 시간인지 보이게 따로 적는다
    const whole = list.filter((r) => r.hourFrom === undefined);
    const usdOn = new Map(whole.map((r) => [r.date, r.usd]));
    for (const run of dateRuns(whole.map((r) => r.date))) {
      let usd = 0;
      for (let d = run.from; d <= run.to; d = addDays(d, 1)) usd += usdOn.get(d) ?? 0;
      parts.push({ hash, name: list[0].name, from: run.from, to: run.to, usd: r6(usd) });
    }
    for (const r of list) {
      if (r.hourFrom === undefined) continue;
      parts.push({ hash, name: r.name, from: `${r.date}T${r.hourFrom}`, to: `${r.date}T${r.hourTo}`, usd: r.usd });
    }
  }
  parts.sort((a, b) => a.from.localeCompare(b.from) || b.usd - a.usd);
  return {
    usd: r6(mine.reduce((n, r) => n + r.usd, 0)),
    through: mine.reduce((m, r) => (r.date > m ? r.date : m), ""),
    parts,
  };
}

/** 사람이 손으로 적은 AI API 줄인가 — 「원가로 보내기」 줄과 겹칠 수 있는 것 */
export function isManualApiLine(l: Pick<FinProjectLine, "id" | "category" | "item" | "vendor">): boolean {
  if (l.id === API_COST_LINE_ID) return false;
  const text = `${l.category} ${l.item} ${l.vendor ?? ""}`;
  return l.category.trim().toUpperCase() === API_COST_CATEGORY || /open\s*router|오픈라우터/i.test(text);
}

/** 원가로 보낼 지출 줄 — 견적 = 실제 = 원화. 메모에 키 · 날 · 달러 · 환율을 남긴다 */
export function apiCostLine(cost: ProjectApiCost, rate: number, today: string): FinProjectLine {
  const krw = krwOf(cost.usd, rate);
  const year = today.slice(0, 4);
  const shown = cost.parts.slice(0, 8).map((p) => `${p.name} ${rangeLabel(p, year)} ${usdText(p.usd)}`);
  const more = cost.parts.length > 8 ? ` 외 ${cost.parts.length - 8}건` : "";
  return {
    id: API_COST_LINE_ID,
    category: API_COST_CATEGORY,
    item: "오픈라우터 API 사용료",
    qty: 1,
    unit: "식",
    unitPrice: krw,
    actual: krw,
    vendor: "OpenRouter",
    note:
      `${shown.join(" · ")}${more} = ${usdText(cost.usd)} × ${rate.toLocaleString("ko-KR")}원. ` +
      `재무 › API 비용에서 ${shortDate(today)}에 보냄 — 다시 보내면 이 줄을 고친다.`,
  };
}

/**
 * 프로젝트 지출 줄에 보낸 줄을 넣는다 — 예전에 보낸 줄이 있던 자리에, 없으면 맨 끝에.
 * line 이 null 이면(붙은 돈이 0) 예전 줄을 지우기만 한다. 다른 줄은 순서 · 내용을 그대로 둔다.
 * removeIds — 사람이 겹친다고 고른 줄. 손으로 적은 API 줄로 보이는 것만 지운다.
 */
export function replaceApiCostLine(
  lines: FinProjectLine[],
  line: FinProjectLine | null,
  removeIds: ReadonlySet<string>,
): { lines: FinProjectLine[]; removed: number } {
  const out: FinProjectLine[] = [];
  let placed = false;
  let removed = 0;
  for (const l of lines) {
    if (l.id === API_COST_LINE_ID) {
      if (line && !placed) out.push(line);
      placed = true;
      continue;
    }
    if (removeIds.has(l.id) && isManualApiLine(l)) {
      removed += 1;
      continue;
    }
    out.push(l);
  }
  if (line && !placed) out.push(line);
  return { lines: out, removed };
}
