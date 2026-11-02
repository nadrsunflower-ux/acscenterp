// ============================================================
//  바이럴 형식 정찰 자동화 — 매일 아침 07:00 (cron-scout) · 「지금 돌리기」
// ------------------------------------------------------------
//  ① 감시 채널 자동 채우기
//     · 한국: AI 레이더가 이미 찾은 영상 중 채널 평소의 N배 넘게 터진 것의 채널 (검색 추가 없음)
//     · 해외: 나라마다 하루 검색 1회(검색어를 날마다 돌림) → 채널 평소 대비 N배 넘은 영상이 있는 채널만
//     · 나라별 상한 · 하루 추가 상한 · 「자동 추가」 표시. 사람이 지운 채널은 다시 넣지 않는다
//  ② 형식 카드 자동 묶기 — AI 분석이 「기존 카드와 같음」 이라 본 영상은 바로 묶고,
//     안 맞는 영상들은 AI 가 하루 한 번 모아 보고 2편 이상 같은 형식이면 카드를 만든다
//  ③ 한국 확인 — 카드마다 주 1회, AI 가 뽑아 둔 한국어 검색어로 국내 검색 → AI 가 제목 · 설명으로
//     같은 형식인지 고른다(영상은 안 봄). 사람이 30일 안에 표시한 카드는 건드리지 않는다
//  ④ 주간 보고 AI 요약 — 보고를 새로 만들 때마다 붙인다
//
//  순수 함수 · 설정만 둔다 (브라우저 · 서버 공용). 실행은 server/scout-auto-run.ts.
// ============================================================

import type { KoreaStatus } from "./scout";

export type AutoCountry = "US" | "JP" | "TW" | "CN";

/**
 * 나라별 검색 — YouTube 에는 중국 본토 지역이 없어 「중국(간체)」 은 홍콩 지역 + 간체 검색어로 찾는다.
 * 감시 채널의 나라는 「어느 흐름으로 볼까」 라서 검색한 쪽으로 적는다 (채널의 실제 국적이 아니다).
 */
export const AUTO_COUNTRY_SEARCH: Record<AutoCountry, { label: string; region: string; lang: string; queries: string[] }> = {
  US: { label: "미국", region: "US", lang: "en", queries: ["kitchen gadgets", "home organization hacks", "cleaning hacks", "amazon home finds", "dollar tree hacks", "laundry hacks"] },
  JP: { label: "일본", region: "JP", lang: "ja", queries: ["100均 便利グッズ", "ダイソー 購入品", "収納 アイデア", "掃除 裏技", "キッチン 便利グッズ", "セリア 便利"] },
  TW: { label: "대만", region: "TW", lang: "zh", queries: ["生活好物", "收納 好物", "廚房 好物", "清潔 小技巧", "大創 好物", "居家 好物"] },
  CN: { label: "중국(간체)", region: "HK", lang: "zh", queries: ["家居好物", "收纳神器", "厨房好物", "清洁神器", "生活小妙招", "宿舍好物"] },
};
export const AUTO_COUNTRIES = Object.keys(AUTO_COUNTRY_SEARCH) as AutoCountry[];

export interface ScoutAutoSettings {
  enabled: boolean;
  /** 한국 감시 채널을 AI 레이더에서 채운다 */
  fillKorea: boolean;
  /** 해외에서 찾을 나라 */
  countries: AutoCountry[];
  /** 나라마다 자동으로 넣은 채널 상한 (사람이 넣은 채널은 세지 않는다) */
  perCountryCap: number;
  /** 하루에 나라마다 새로 넣는 채널 상한 */
  addsPerDay: number;
  /** 이 배수 넘게 터진 영상이 있어야 채널을 넣는다 */
  minMultiple: number;
  /** 해외 후보 영상의 최소 조회수 */
  minViewsAbroad: number;
  group: boolean;
  koreaCheck: boolean;
  /** 하루에 한국 확인할 카드 수 (카드 하나에 국내 검색 1회) */
  koreaPerDay: number;
  narrate: boolean;
  /**
   * 나라마다 해외 채널 찾기 검색어 — 비어 있으면 「살림설계사무소」 는 AUTO_COUNTRY_SEARCH 의 살림 검색어,
   * 다른 AI STUDIO 프로젝트는 그 나라를 건너뛴다 (주제가 달라서)
   */
  queries?: Partial<Record<AutoCountry, string[]>>;
  updatedAt: number;
  updatedBy: string;
}

export const DEFAULT_SCOUT_AUTO: ScoutAutoSettings = {
  enabled: true,
  fillKorea: true,
  countries: ["US", "JP", "TW", "CN"],
  perCountryCap: 20,
  addsPerDay: 5,
  minMultiple: 3,
  minViewsAbroad: 30_000,
  group: true,
  koreaCheck: true,
  koreaPerDay: 2,
  narrate: true,
  updatedAt: 0,
  updatedBy: "",
};

export interface ScoutAutoSummary {
  at: number;
  by: string;
  added: { country: string; title: string; why: string }[];
  searches: number;
  scanned: number;
  newHits: number;
  analyzed: number;
  assigned: number;
  cardsCreated: string[];
  korea: { name: string; status: KoreaStatus }[];
  narrated: boolean;
  aiUsd: number;
  notes: string[];
  ms: number;
}

/** 자동으로 넣은 감시 채널 표시 (주제 칸) */
export const AUTO_TOPIC = "자동 추가";

/** 날마다 검색어를 돌린다 — 같은 날 다시 돌리면 같은 검색어. custom 이 있으면 그것에서 */
export function pickAutoQuery(country: AutoCountry, day: string, custom?: readonly string[]): string {
  const qs = custom?.length ? custom : AUTO_COUNTRY_SEARCH[country].queries;
  const n = Math.floor(Date.parse(`${day}T00:00:00Z`) / 86_400_000);
  return qs[(Number.isFinite(n) ? n : 0) % qs.length];
}

/** 검색어 칸(쉼표 · 줄바꿈) → 목록 */
export const parseAutoQueries = (v: unknown): string[] =>
  [...new Set((Array.isArray(v) ? v.map(String) : String(v ?? "").split(/[,\n]/)).map((q) => q.replace(/\s+/g, " ").trim().slice(0, 60)).filter(Boolean))].slice(0, 12);

/** 국내 표본에서 같은 형식으로 고른 수 → 상태. 0 은 「표본에 없음」 일 뿐 국내에 없다는 단정이 아니다 */
export const koreaStatusFromMatches = (n: number): KoreaStatus => (n <= 0 ? "none_in_sample" : n >= 3 ? "spread" : "some");

/** 사람이 최근에 직접 확인한 카드는 자동 확인이 덮지 않는다 */
export function needsKoreaCheck(k: { status: KoreaStatus; checkedAt: number | null; by: string | null }, now: number, auto = "company"): boolean {
  if (!k.checkedAt || k.status === "unchecked") return true;
  const age = now - k.checkedAt;
  if (k.by && k.by !== auto) return age > 30 * 86_400_000;
  return age > 7 * 86_400_000;
}

export function sanitizeScoutAuto(input: unknown, prev: ScoutAutoSettings, by: string, now = Date.now()): ScoutAutoSettings {
  const r = (input ?? {}) as Record<string, unknown>;
  const num = (v: unknown, min: number, max: number, d: number) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d;
  };
  const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);
  const countries = Array.isArray(r.countries) ? (r.countries.filter((c) => AUTO_COUNTRIES.includes(c as AutoCountry)) as AutoCountry[]) : prev.countries;
  return {
    enabled: bool(r.enabled, prev.enabled),
    fillKorea: bool(r.fillKorea, prev.fillKorea),
    countries: [...new Set(countries)],
    perCountryCap: Math.round(num(r.perCountryCap, 0, 60, prev.perCountryCap)),
    addsPerDay: Math.round(num(r.addsPerDay, 0, 15, prev.addsPerDay)),
    minMultiple: num(r.minMultiple, 1.5, 50, prev.minMultiple),
    minViewsAbroad: Math.round(num(r.minViewsAbroad, 0, 10_000_000, prev.minViewsAbroad)),
    group: bool(r.group, prev.group),
    koreaCheck: bool(r.koreaCheck, prev.koreaCheck),
    koreaPerDay: Math.round(num(r.koreaPerDay, 0, 6, prev.koreaPerDay)),
    narrate: bool(r.narrate, prev.narrate),
    queries:
      r.queries && typeof r.queries === "object"
        ? Object.fromEntries(AUTO_COUNTRIES.map((c) => [c, parseAutoQueries((r.queries as Record<string, unknown>)[c])]).filter(([, q]) => (q as string[]).length))
        : (prev.queries ?? {}),
    updatedAt: now,
    updatedBy: by,
  };
}
