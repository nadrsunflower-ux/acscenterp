// ============================================================
//  바이럴 형식 정찰 — 감시 채널 · 터진 영상 · 형식 카드 · 주간 보고 (순수 함수 + 타입)
// ------------------------------------------------------------
//  쇼핑쇼츠(쿠팡 제휴)와 브랜드 영상 대행이 같이 쓰는 「요즘 무엇이 먹히나」 정보.
//
//  · 바이럴 판정은 조회수가 아니라 「그 채널 평소의 몇 배」 다. 구독 100만 채널의
//    100만 조회는 평범하고, 평소 2만 나오는 채널의 30만은 형식이 먹힌 것이다.
//    평소 = 그 채널 최근 쇼츠(올린 지 7일 넘은 것) 조회수의 중앙값.
//  · 소재(무엇을)와 형식(어떻게)을 나눈다. 터진 영상을 형식 카드에 묶고, 카드마다
//    나라별로 처음 본 날 · 한국에 나타난 날을 쌓아 「어느 나라 형식이 몇 주 뒤
//    한국에 오나」 를 데이터로 배운다.
//  · 쇼츠 여부는 API 가 알려 주지 않는다 — 3분 이하 영상을 「쇼츠 추정」 으로 본다.
//  · 한국에 없다는 판정은 검색 「표본」 에서 못 찾았다는 뜻일 뿐이다.
//  · 정찰 자료는 회사 공용이다 (트렌드는 회사 자산). 지우기는 만든 사람 · 관리자.
// ============================================================

import type { Measured, ShortsPlatform } from "./types";

const DAY = 86_400_000;

// ---- 타입 -----------------------------------------------------------

/** 정찰 문서 공통 — 회사 공용이라 visibility 가 없다. owner 는 만든 사람 (자동 수집은 "company") */
export interface ScoutOwned {
  owner: string;
  createdAt: number;
  updatedAt: number;
  updatedBy: string;
}

export interface WatchChannelDoc extends ScoutOwned {
  platform: "youtube";
  /** UC 로 시작하는 채널 id */
  channelId: string;
  handle: string;
  title: string;
  thumbnail: string;
  /** 이 채널을 어느 나라 흐름으로 볼까 — 사람이 정한다 (API 의 국가는 비어 있는 일이 많다) */
  country: string;
  language: string;
  /** 분야 (뷰티 · 음식 · 코미디 …) */
  topics: string[];
  subscribers: number | null;
  active: boolean;
  note: string;
  scan: {
    at: number | null;
    /** 평소 조회수 (최근 쇼츠 중앙값) */
    baseline: number | null;
    baselineN: number;
    baselineBasis: BaselineBasis;
    /** 마지막 훑기에서 본 쇼츠 수 */
    shortsSeen: number;
    error: string | null;
  };
}

export type BaselineBasis = "mature" | "young" | "none";

export type LanguageDependence = "visual" | "mixed" | "verbal";
export type AiLevel = "easy" | "possible" | "hard";
export type ScoutRisk = "music" | "real_person" | "danger" | "claims" | "other";

/** 영상 하나를 보고 뽑은 형식 — AI 가 영상을 직접 보고 쓴다 (출처 「AI」, 사실 확인 아님) */
export interface HitAnalysis {
  formatName: string;
  summary: string;
  hook: string;
  structure: string[];
  editing: string;
  sound: string;
  textOverlay: string;
  whyItWorks: string;
  languageDependence: LanguageDependence;
  aiFeasibility: { level: AiLevel; easyParts: string; hardParts: string };
  risks: ScoutRisk[];
  riskNote: string;
  brandIdeas: string[];
  /** 한국에 이미 있는지 찾아볼 한국어 검색어 */
  koreanQueries: string[];
  totalSec: number | null;
  cutCount: number | null;
  /** 기존 형식 카드 중 같은 것 (없으면 null = 새 형식) */
  match: { formatId: string | null; reason: string };
  model: string;
  costUsd: number;
  at: number;
  by: string;
}

export type HitStatus = "new" | "assigned" | "dismissed";

export interface HitDoc extends ScoutOwned {
  platform: ShortsPlatform;
  url: string;
  /** YouTube 영상 id 등 */
  externalId: string | null;
  /** 감시 채널 문서 id (감시 밖이면 null) */
  watchId: string | null;
  channel: string;
  country: string;
  language: string;
  title: string;
  thumbnail: string;
  publishedAt: string | null;
  duration: number | null;
  views: Measured;
  likes: Measured;
  comments: Measured;
  /** 채널 평소 조회수 */
  baseline: Measured;
  /** 조회수 ÷ 평소 */
  multiple: number | null;
  viewHistory: { at: number; views: number }[];
  found: "scan" | "manual";
  analysis: HitAnalysis | null;
  formatId: string | null;
  status: HitStatus;
  /** 댓글 표본 중 한글 댓글 — 해외 영상을 한국 사람이 이미 보고 있나 */
  koreanComments: { sampled: number; korean: number; at: number } | null;
  note: string;
}

export type KoreaStatus = "unchecked" | "none_in_sample" | "some" | "spread";

export interface KoreaCheck {
  status: KoreaStatus;
  query: string;
  checkedAt: number | null;
  by: string | null;
  sampleSize: number | null;
  matches: { url: string; title: string; views: number | null; publishedAt: string | null }[];
  lastSearch: { query: string; at: number; results: { id: string; url: string; title: string; channel: string; views: number | null; publishedAt: string | null; thumbnail: string }[] } | null;
  note: string;
}

export interface FormatDoc extends ScoutOwned {
  name: string;
  summary: string;
  hook: string;
  structure: string[];
  editing: string;
  sound: string;
  textOverlay: string;
  whyItWorks: string;
  languageDependence: LanguageDependence;
  aiFeasibility: { level: AiLevel; easyParts: string; hardParts: string };
  risks: ScoutRisk[];
  riskNote: string;
  brandIdeas: string[];
  koreanQueries: string[];
  korea: KoreaCheck;
  archived: boolean;
  note: string;
}

export interface ScoutSettings {
  /** 평소의 몇 배부터 「터짐」 인가 */
  threshold: number;
  /** 조회수가 이보다 적으면 배수가 커도 뺀다 (작은 채널의 우연) */
  minViews: number;
  /** 올린 지 며칠 안의 영상만 본다 */
  maxAgeDays: number;
  /** 새로 찾은 영상을 하루 몇 편까지 자동 분석 (0 = 끔) — 한 편 약 10원 */
  autoAnalyzePerDay: number;
}

export const DEFAULT_SCOUT_SETTINGS: ScoutSettings = { threshold: 3, minViews: 10_000, maxAgeDays: 30, autoAnalyzePerDay: 10 };

export interface ReportFormatLine {
  formatId: string;
  name: string;
  stage: Lifecycle;
  basis: string;
  countries: string[];
  examples: number;
  medianMultiple: number | null;
  korea: KoreaStatus;
  ai: AiLevel;
  lang: LanguageDependence;
  top: { url: string; title: string; multiple: number | null; country: string } | null;
}

export interface ReportHitLine {
  hitId: string;
  url: string;
  title: string;
  channel: string;
  country: string;
  multiple: number | null;
  views: number | null;
  publishedAt: string | null;
  formatName: string | null;
  analyzed: boolean;
}

export interface LagLine {
  formatId: string;
  name: string;
  from: string;
  foreignFirst: string;
  koreaFirst: string;
  days: number;
}

export interface ScoutReportDoc {
  /** 2026-W44 (KST 기준 ISO 주) — 문서 id */
  week: string;
  from: number;
  to: number;
  createdAt: number;
  createdBy: string;
  counts: {
    channels: number;
    scanned: number;
    newHits: number;
    analyzed: number;
    unassigned: number;
    formats: number;
    byCountry: { country: string; hits: number }[];
  };
  rising: ReportFormatLine[];
  abroadOnly: ReportFormatLine[];
  saturating: ReportFormatLine[];
  newHits: ReportHitLine[];
  lags: LagLine[];
  narrative: { text: string; model: string; costUsd: number; at: number; by: string } | null;
}

// ---- 이름표 -----------------------------------------------------------

export const COUNTRIES: { code: string; label: string; lang: string }[] = [
  { code: "KR", label: "한국", lang: "ko" },
  { code: "US", label: "미국", lang: "en" },
  { code: "JP", label: "일본", lang: "ja" },
  { code: "CN", label: "중국", lang: "zh" },
  { code: "TW", label: "대만", lang: "zh" },
  { code: "GB", label: "영국", lang: "en" },
  { code: "ID", label: "인도네시아", lang: "id" },
  { code: "TH", label: "태국", lang: "th" },
  { code: "VN", label: "베트남", lang: "vi" },
  { code: "PH", label: "필리핀", lang: "en" },
  { code: "IN", label: "인도", lang: "en" },
  { code: "BR", label: "브라질", lang: "pt" },
  { code: "MX", label: "멕시코", lang: "es" },
  { code: "ES", label: "스페인", lang: "es" },
  { code: "FR", label: "프랑스", lang: "fr" },
  { code: "DE", label: "독일", lang: "de" },
];

export const countryLabel = (code: string) => (code ? COUNTRIES.find((c) => c.code === code)?.label ?? code : "나라 모름");
export const languageOf = (code: string) => COUNTRIES.find((c) => c.code === code)?.lang ?? "en";

export const LIFECYCLE_LABEL: Record<Lifecycle, string> = {
  seed: "씨앗",
  rising: "떠오름",
  steady: "유지",
  saturating: "포화 조짐",
  faded: "식음",
  unknown: "모름",
};

export const KOREA_LABEL: Record<KoreaStatus, string> = {
  unchecked: "확인 전",
  none_in_sample: "국내 표본에 없음",
  some: "국내에 조금 있음",
  spread: "국내에 이미 퍼짐",
};

export const AI_LEVEL_LABEL: Record<AiLevel, string> = { easy: "AI로 쉬움", possible: "AI로 가능", hard: "AI로 어려움" };
export const LANG_DEP_LABEL: Record<LanguageDependence, string> = { visual: "화면으로 먹힘", mixed: "화면 + 말", verbal: "말·자막에 기댐" };
export const RISK_LABEL: Record<ScoutRisk, string> = {
  music: "유행 음원",
  real_person: "실존 인물·밈",
  danger: "위험 행동",
  claims: "효능·과장 표현",
  other: "기타",
};

// ---- 계산 -------------------------------------------------------------

export function median(values: number[]): number | null {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

/** 쇼츠 추정 — API 는 쇼츠인지 알려 주지 않는다. 3분 이하(2024-10 부터 쇼츠 최대 길이) */
export const SHORTS_MAX_SEC = 180;
export const isShortLike = (durationSec: number | null | undefined) => typeof durationSec === "number" && durationSec > 0 && durationSec <= SHORTS_MAX_SEC;

export const ageDays = (publishedAt: string | null | undefined, now: number) => {
  const t = publishedAt ? Date.parse(publishedAt) : NaN;
  return Number.isFinite(t) ? (now - t) / DAY : null;
};

/**
 * 채널 평소 조회수. 올린 지 7일 넘은 쇼츠(조회수가 거의 다 찬 것) 최근 30편의 중앙값.
 * 그런 영상이 5편 안 되면 나이와 상관없이 전부의 중앙값(「young」), 그래도 5편이 안 되면 모른다.
 */
export function computeBaseline(videos: { views: number | null; publishedAt: string | null }[], now: number): { value: number | null; n: number; basis: BaselineBasis } {
  const withViews = videos
    .filter((v): v is { views: number; publishedAt: string | null } => typeof v.views === "number")
    .map((v) => ({ views: v.views, age: ageDays(v.publishedAt, now) }))
    .sort((a, b) => (a.age ?? 1e9) - (b.age ?? 1e9));
  const mature = withViews.filter((v) => v.age !== null && v.age >= 7).slice(0, 30);
  if (mature.length >= 5) return { value: median(mature.map((v) => v.views)), n: mature.length, basis: "mature" };
  if (withViews.length >= 5) return { value: median(withViews.slice(0, 30).map((v) => v.views)), n: Math.min(30, withViews.length), basis: "young" };
  return { value: null, n: withViews.length, basis: "none" };
}

export const multipleOf = (views: number | null, baseline: number | null) =>
  views === null || baseline === null || baseline <= 0 ? null : Math.round((views / baseline) * 10) / 10;

/** 평소의 threshold 배 이상 · minViews 이상 · maxAgeDays 안 */
export function pickHits<T extends { views: number | null; publishedAt: string | null }>(
  videos: T[],
  baseline: number | null,
  s: Pick<ScoutSettings, "threshold" | "minViews" | "maxAgeDays">,
  now: number,
): (T & { multiple: number })[] {
  if (baseline === null) return [];
  return videos.flatMap((v) => {
    const age = ageDays(v.publishedAt, now);
    const m = multipleOf(v.views, baseline);
    if (m === null || age === null || age > s.maxAgeDays || (v.views ?? 0) < s.minViews || m < s.threshold) return [];
    return [{ ...v, multiple: m }];
  });
}

const HANGUL = /[가-힣ᄀ-ᇿ㄰-㆏]/;
export const hasHangul = (s: string) => HANGUL.test(s);

/** 댓글 중 한글이 들어간 것 */
export const koreanCommentCount = (comments: string[]) => ({ sampled: comments.length, korean: comments.filter(hasHangul).length });

export type Lifecycle = "seed" | "rising" | "steady" | "saturating" | "faded" | "unknown";

/**
 * 형식의 수명. 형식 카드에 묶인 터진 영상들의 게시일과 배수로 본다.
 *   씨앗      한 편만 보임
 *   떠오름    최근 2주에 두 채널 이상 · 주당 편수가 그 전 4주보다 같거나 많다
 *   포화 조짐 6편 이상인데 최근 2주 배수 중앙값이 그 전 4주의 60% 밑
 *   식음      6주 넘게 새로 터진 게 없다
 *   유지      그 밖
 */
export function lifecycleOf(
  hits: { publishedAt: string | null; channel: string; multiple: number | null }[],
  now: number,
): { stage: Lifecycle; basis: string; recent: number; prior: number; recentChannels: number } {
  const dated = hits.map((h) => ({ ...h, age: ageDays(h.publishedAt, now) })).filter((h): h is typeof h & { age: number } => h.age !== null);
  if (!dated.length) return { stage: "unknown", basis: "게시일을 아는 영상이 없습니다", recent: 0, prior: 0, recentChannels: 0 };
  const recent = dated.filter((h) => h.age <= 14);
  const prior = dated.filter((h) => h.age > 14 && h.age <= 42);
  const recentChannels = new Set(recent.map((h) => h.channel)).size;
  const basis = `최근 2주 ${recent.length}편(채널 ${recentChannels}곳) · 그 전 4주 ${prior.length}편`;
  const out = (stage: Lifecycle) => ({ stage, basis, recent: recent.length, prior: prior.length, recentChannels });
  if (dated.length === 1) return out(recent.length ? "seed" : "faded");
  const newest = Math.min(...dated.map((h) => h.age));
  if (newest > 42) return out("faded");
  const mr = median(recent.flatMap((h) => (h.multiple === null ? [] : [h.multiple])));
  const mp = median(prior.flatMap((h) => (h.multiple === null ? [] : [h.multiple])));
  if (dated.length >= 6 && mr !== null && mp !== null && mr < mp * 0.6) return out("saturating");
  if (recentChannels >= 2 && recent.length / 2 >= prior.length / 4) return out("rising");
  return out("steady");
}

const minDate = (dates: (string | null | undefined)[]) => {
  const ts = dates.map((d) => (d ? Date.parse(d) : NaN)).filter(Number.isFinite);
  return ts.length ? new Date(Math.min(...ts)).toISOString() : null;
};

/** 그 영상을 「본 날」 — 게시일을 모르면(직접 등록) 우리가 찾은 날 */
export const seenAt = (h: { publishedAt: string | null; createdAt?: number }) => h.publishedAt ?? (h.createdAt ? new Date(h.createdAt).toISOString() : null);

/**
 * 형식 카드 한 장의 집계 — 예시 수 · 나라별 처음 본 날 · 한국 상태 · 시차.
 * 한국 상태: 사람이 검색 표본에서 고른 것 + 국내(KR) 터진 영상. 국내 터진 영상이 있으면 적어도 「조금 있음」.
 */
export function formatStats(
  f: Pick<FormatDoc, "korea">,
  hits: Pick<HitDoc, "country" | "publishedAt" | "createdAt" | "channel" | "multiple" | "url" | "title" | "status">[],
  now: number,
) {
  // 게시일을 모르는 영상은 찾은 날로 센다 (나라별 처음 본 날 · 수명 모두)
  const live = hits.filter((h) => h.status !== "dismissed").map((h) => ({ ...h, publishedAt: seenAt(h) }));
  const byCountry = new Map<string, string[]>();
  for (const h of live) {
    if (!h.country) continue;
    byCountry.set(h.country, [...(byCountry.get(h.country) ?? []), h.publishedAt ?? ""]);
  }
  const countries = [...byCountry.entries()]
    .map(([code, dates]) => ({ code, n: dates.length, firstSeen: minDate(dates) }))
    .sort((a, b) => (a.firstSeen ?? "9").localeCompare(b.firstSeen ?? "9"));
  const kr = live.filter((h) => h.country === "KR");
  const foreign = countries.filter((c) => c.code !== "KR" && c.firstSeen);
  const foreignFirst = foreign[0] ?? null;
  const koreaFirst = minDate([...kr.map((h) => h.publishedAt), ...f.korea.matches.map((m) => m.publishedAt)]);
  let korea: KoreaStatus = f.korea.status;
  if (kr.length && (korea === "unchecked" || korea === "none_in_sample")) korea = "some";
  const lagDays =
    foreignFirst?.firstSeen && koreaFirst && Date.parse(koreaFirst) > Date.parse(foreignFirst.firstSeen)
      ? Math.round((Date.parse(koreaFirst) - Date.parse(foreignFirst.firstSeen)) / DAY)
      : null;
  const top = [...live].sort((a, b) => (b.multiple ?? -1) - (a.multiple ?? -1))[0] ?? null;
  return {
    examples: live.length,
    countries,
    korea,
    koreaFirst,
    foreignFirst: foreignFirst ? { code: foreignFirst.code, at: foreignFirst.firstSeen as string } : null,
    lagDays,
    medianMultiple: median(live.flatMap((h) => (h.multiple === null ? [] : [h.multiple]))),
    life: lifecycleOf(live, now),
    top: top ? { url: top.url, title: top.title, multiple: top.multiple, country: top.country } : null,
  };
}

// ---- 주간 보고 --------------------------------------------------------

/** KST 기준 ISO 주 (2026-W44) */
export function isoWeekKey(ms: number): string {
  const k = new Date(ms + 9 * 3600_000);
  const d = new Date(Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const y = d.getUTCFullYear();
  const week = Math.ceil(((d.getTime() - Date.UTC(y, 0, 1)) / DAY + 1) / 7);
  return `${y}-W${String(week).padStart(2, "0")}`;
}

type IdOf<T> = T & { id: string };

/**
 * 보고서 본문 — 사람 손 없이 데이터만으로 만든다 (AI 요약은 따로 붙인다).
 *   떠오름 / 해외에만 있음(국내 표본에 없거나 확인 전) / 포화 조짐 / 이번 주 새로 터진 영상 / 시차
 */
export function buildReport(input: {
  formats: IdOf<FormatDoc>[];
  hits: IdOf<HitDoc>[];
  channels: IdOf<WatchChannelDoc>[];
  now: number;
}): Omit<ScoutReportDoc, "createdAt" | "createdBy" | "narrative"> {
  const { now } = input;
  const from = now - 7 * DAY;
  const live = input.hits.filter((h) => h.status !== "dismissed");
  const byFormat = new Map<string, IdOf<HitDoc>[]>();
  for (const h of live) if (h.formatId) byFormat.set(h.formatId, [...(byFormat.get(h.formatId) ?? []), h]);
  const formatName = new Map(input.formats.map((f) => [f.id, f.name]));

  const lines = input.formats
    .filter((f) => !f.archived)
    .map((f) => {
      const s = formatStats(f, byFormat.get(f.id) ?? [], now);
      const line: ReportFormatLine = {
        formatId: f.id,
        name: f.name,
        stage: s.life.stage,
        basis: s.life.basis,
        countries: s.countries.map((c) => c.code),
        examples: s.examples,
        medianMultiple: s.medianMultiple,
        korea: s.korea,
        ai: f.aiFeasibility.level,
        lang: f.languageDependence,
        top: s.top,
      };
      return { line, s, f };
    })
    .filter((x) => x.s.examples > 0);

  const byStrength = (a: ReportFormatLine, b: ReportFormatLine) => (b.medianMultiple ?? 0) - (a.medianMultiple ?? 0);
  const rising = lines.filter((x) => x.line.stage === "rising" || x.line.stage === "seed").map((x) => x.line);
  rising.sort((a, b) => (a.stage === b.stage ? byStrength(a, b) : a.stage === "rising" ? -1 : 1));
  const abroadOnly = lines
    .filter((x) => x.s.foreignFirst && (x.line.korea === "unchecked" || x.line.korea === "none_in_sample") && x.line.stage !== "faded")
    .map((x) => x.line)
    .sort((a, b) => (a.stage === "rising" ? 0 : 1) - (b.stage === "rising" ? 0 : 1) || byStrength(a, b));
  const saturating = lines.filter((x) => x.line.stage === "saturating").map((x) => x.line).sort(byStrength);

  const fresh = live.filter((h) => h.createdAt >= from);
  const newHits: ReportHitLine[] = [...fresh]
    .sort((a, b) => (b.multiple ?? -1) - (a.multiple ?? -1))
    .slice(0, 15)
    .map((h) => ({
      hitId: h.id,
      url: h.url,
      title: h.title,
      channel: h.channel,
      country: h.country,
      multiple: h.multiple,
      views: h.views.v,
      publishedAt: h.publishedAt,
      formatName: h.formatId ? formatName.get(h.formatId) ?? null : null,
      analyzed: !!h.analysis,
    }));

  const lags: LagLine[] = lines
    .flatMap((x) =>
      x.s.lagDays !== null && x.s.foreignFirst && x.s.koreaFirst
        ? [{ formatId: x.f.id, name: x.f.name, from: x.s.foreignFirst.code, foreignFirst: x.s.foreignFirst.at, koreaFirst: x.s.koreaFirst, days: x.s.lagDays }]
        : [],
    )
    .sort((a, b) => a.days - b.days);

  const countryCount = new Map<string, number>();
  for (const h of fresh) countryCount.set(h.country || "", (countryCount.get(h.country || "") ?? 0) + 1);

  return {
    week: isoWeekKey(now),
    from,
    to: now,
    counts: {
      channels: input.channels.filter((c) => c.active).length,
      scanned: input.channels.filter((c) => (c.scan.at ?? 0) >= from).length,
      newHits: fresh.length,
      analyzed: fresh.filter((h) => h.analysis).length,
      unassigned: live.filter((h) => h.status === "new").length,
      formats: lines.length,
      byCountry: [...countryCount.entries()].map(([country, hits]) => ({ country, hits })).sort((a, b) => b.hits - a.hits),
    },
    rising: rising.slice(0, 10),
    abroadOnly: abroadOnly.slice(0, 10),
    saturating: saturating.slice(0, 10),
    newHits,
    lags,
  };
}

// ---- 입력 해석 ----------------------------------------------------------

/** 채널 · 영상 주소 해석 — @핸들 · UC 채널 id · 채널 주소 · 영상 주소(쇼츠 포함) */
export function parseYoutubeRef(input: string): { kind: "handle" | "channel" | "video"; value: string } | null {
  const s = input.trim();
  if (!s) return null;
  if (/^@[\w.\-À-￿]{2,100}$/.test(s)) return { kind: "handle", value: s };
  if (/^UC[\w-]{22}$/.test(s)) return { kind: "channel", value: s };
  if (/^[\w-]{11}$/.test(s)) return { kind: "video", value: s };
  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase().replace(/^(www|m)\./, "");
  if (host === "youtu.be") {
    const id = u.pathname.slice(1, 12);
    return /^[\w-]{11}$/.test(id) ? { kind: "video", value: id } : null;
  }
  if (host !== "youtube.com") return null;
  const parts = u.pathname.split("/").filter(Boolean);
  if (parts[0]?.startsWith("@")) return { kind: "handle", value: decodeURIComponent(parts[0]) };
  if (parts[0] === "channel" && /^UC[\w-]{22}$/.test(parts[1] ?? "")) return { kind: "channel", value: parts[1] };
  if ((parts[0] === "shorts" || parts[0] === "live" || parts[0] === "embed") && /^[\w-]{11}$/.test(parts[1] ?? "")) return { kind: "video", value: parts[1] };
  const v = u.searchParams.get("v");
  if (parts[0] === "watch" && v && /^[\w-]{11}$/.test(v)) return { kind: "video", value: v };
  return null;
}

export const fmtMultiple = (m: number | null | undefined) => (m === null || m === undefined ? "—" : `${m >= 10 ? Math.round(m) : m.toFixed(1)}배`);
