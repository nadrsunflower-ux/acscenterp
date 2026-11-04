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
  /** 마지막 「터진 영상 vs 평소」 비교 — 회사 공용이라 누가 눌렀든 함께 본다 (예전 문서에는 없다) */
  compare?: ChannelCompare;
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
  /** 분석할 때 참고한 사람 메모 (그때의 글 그대로 · 메모 없이 분석했으면 "" · 예전 분석에는 없다) */
  note?: string;
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

/** 보고의 형식 한 줄 — 카드 + 집계 (buildReport · 보고 화면 공용) */
function reportLine(f: IdOf<Pick<FormatDoc, "name" | "aiFeasibility" | "languageDependence">>, s: ReturnType<typeof formatStats>): ReportFormatLine {
  return {
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
}

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
      return { line: reportLine(f, s), s, f };
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

/** 터진 영상의 메모와 AI 분석의 관계 — none(메모 없음) · applied(지금 메모로 분석) · stale(분석 뒤에 메모가 바뀜) · pending(분석 전) */
export function hitNoteState(h: { note: string; analysis: { note?: string } | null }): "none" | "pending" | "applied" | "stale" {
  const note = h.note.trim();
  const used = (h.analysis?.note ?? "").trim();
  if (!note) return used ? "stale" : "none";
  if (!h.analysis) return "pending";
  return used === note ? "applied" : "stale";
}

// ---- 보고 화면용 ---------------------------------------------------------

/** 보고 기간 날수 — 저장된 from · to 그대로 센다 (주 이름 2026-W45 를 다시 풀지 않는다) */
export const reportDays = (r: Pick<ScoutReportDoc, "from" | "to">) => Math.max(1, Math.round((r.to - r.from) / DAY));

export type ReportSection = "abroadOnly" | "rising" | "saturating";
export const REPORT_SECTION_LABEL: Record<ReportSection, string> = { abroadOnly: "해외 먼저", rising: "떠오름", saturating: "포화 조짐" };

/**
 * 보고에 오른 형식 — 해외 먼저 · 떠오름 · 포화 조짐 구간에 겹쳐 오른 형식을 한 번씩만.
 * 순서는 처음 나온 구간 순 (해외 먼저 → 떠오름 → 포화 조짐), 구간 안에서는 보고에 적힌 순서 그대로.
 */
export function reportFormatList(r: Pick<ScoutReportDoc, ReportSection>): (ReportFormatLine & { sections: ReportSection[] })[] {
  const out = new Map<string, ReportFormatLine & { sections: ReportSection[] }>();
  for (const s of ["abroadOnly", "rising", "saturating"] as const) {
    for (const l of r[s] ?? []) {
      const x = out.get(l.formatId);
      if (!x) out.set(l.formatId, { ...l, sections: [s] });
      else if (!x.sections.includes(s)) x.sections.push(s);
    }
  }
  return [...out.values()];
}

/**
 * 보고 화면의 형식 카드 — 보고 구간에 오른 형식(보고에 저장된 줄 그대로)을 먼저, 그다음 구간에 오르지 않은
 * 나머지 형식 카드(보관 안 함 · 예시 있음)를 보고 시각(to)까지 찾은 영상으로 buildReport 와 같은 식으로 센다.
 * 보고는 구간 밖 형식의 줄을 저장하지 않는다 — 「형식 카드 N장」 이 구간 밖에만 있으면 카드가 비지 않게.
 * 나머지는 예시 많은 순 → 배수 중앙값 큰 순.
 */
export function reportFormatCards(
  r: Pick<ScoutReportDoc, ReportSection | "to">,
  formats: IdOf<FormatDoc>[],
  hits: IdOf<HitDoc>[],
): (ReportFormatLine & { sections: ReportSection[] })[] {
  const listed = reportFormatList(r);
  const seen = new Set(listed.map((l) => l.formatId));
  const byFormat = new Map<string, IdOf<HitDoc>[]>();
  for (const h of hits) if (h.formatId && h.status !== "dismissed" && h.createdAt <= r.to) byFormat.set(h.formatId, [...(byFormat.get(h.formatId) ?? []), h]);
  const rest = formats
    .filter((f) => !f.archived && !seen.has(f.id) && byFormat.has(f.id))
    .map((f) => reportLine(f, formatStats(f, byFormat.get(f.id)!, r.to)))
    .filter((l) => l.examples > 0)
    .sort((a, b) => b.examples - a.examples || (b.medianMultiple ?? 0) - (a.medianMultiple ?? 0));
  return [...listed, ...rest.map((l) => ({ ...l, sections: [] as ReportSection[] }))];
}

/**
 * 국내 상태의 근거 한 줄 — 카드에 적힌 확인 기록에서만 만든다 (지어낸 숫자 없음).
 *   ai = 자동 확인(by = 회사 자동화)이 이 상태를 정했을 때만. 사람이 고른 것 · 국내 영상이 묶여 「조금」 이 된 것은 아니다.
 */
export function koreaEvidence(
  status: KoreaStatus,
  k: Pick<KoreaCheck, "status" | "checkedAt" | "by" | "sampleSize" | "matches"> | null | undefined,
  auto = "company",
): { text: string; ai: boolean } {
  if (status === "unchecked") return { text: "아직 국내 검색 전", ai: false };
  // 보고의 상태가 카드의 확인 기록과 다르면 — 국내(KR) 영상이 같은 카드에 묶여 「조금 있음」 이 된 것
  if (!k || k.status !== status) return { text: status === "some" ? "국내 영상이 이 형식에 묶여 있음" : "국내 확인 기록 없음", ai: false };
  const ai = !!k.checkedAt && k.by === auto;
  const n = k.sampleSize;
  const m = k.matches.length;
  const base =
    status === "none_in_sample"
      ? n
        ? `국내 검색 표본 ${n}편에서 같은 형식을 못 찾음`
        : "국내 검색 표본에서 같은 형식을 못 찾음"
      : n && m
        ? `국내 검색 표본 ${n}편 중 ${m}편이 같은 형식`
        : m
          ? `국내 사례 ${m}편`
          : "국내 사례 표시";
  return { text: `${base} · ${ai ? "제목·설명 기반 AI 판단" : k.by ? "사람이 확인" : "확인한 사람 모름"}`, ai };
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

// ---- 터진 영상 vs 평소 (같은 감시 채널 안) ---------------------------------------
//  같은 채널이라 구독자 · 주제가 같다 — 터진 영상과 평소 영상의 차이는 형식(제목 · 썸네일 · 길이 · 올린 때) 쪽에서
//  나왔을 가능성이 크다. 숫자(편수 · 중앙값 · 비율 · 요일 · 시간대)는 여기서만 계산하고, AI 는 차이를 「가설」 로만 쓴다.
//
//  표본 = 평소 조회수를 낸 그 표본 (올린 지 7일 넘은 최근 쇼츠 30편 — computeBaseline 의 mature).
//  · 7일 안 영상은 조회수가 아직 차는 중이라 어느 쪽에도 넣지 않는다.
//  · maxAgeDays(새로 터진 것만 줍는 신선도 기준)는 쓰지 않는다 — 이 비교는 그 채널의 평소 틀을 보는 것이라
//    평소를 낸 표본과 같은 데서 골라야 「평소의 몇 배」 가 같은 뜻이 된다.

/** 하루 상한 — 프로젝트마다 (한 번에 약 25원 — COMPARE_MEASURED_USD) */
export const CHANNEL_COMPARE_DAILY_LIMIT = 20;
export const COMPARE_MAX_HITS = 6;
export const COMPARE_MAX_USUAL = 8;
/** 평소 = 배수 0.6~1.5 (중앙값 근처) */
export const COMPARE_USUAL_MIN = 0.6;
export const COMPARE_USUAL_MAX = 1.5;
/** 조회수가 거의 다 찬 영상만 — computeBaseline 의 「mature」 와 같은 7일 */
export const COMPARE_MIN_AGE_DAYS = 7;
/**
 * 비교 한 번 실측 비용 — 2026-11-04 실제 호출 2번 평균 (Gemini 3.7 Flash · 썸네일 12~14장 + 제목 · 분석 글 ·
 * 국내 살림 채널 둘: $0.0160 · 12초 / $0.0176 · 13초). 저장된 비교가 있으면 화면은 그 평균을 먼저 쓴다.
 */
export const COMPARE_MEASURED_USD = 0.017;

export type CompareAspect = "title" | "thumbnail" | "length" | "hook" | "topic" | "timing" | "other";
export const COMPARE_ASPECTS: readonly CompareAspect[] = ["title", "thumbnail", "length", "hook", "topic", "timing", "other"];
export const COMPARE_ASPECT_LABEL: Record<CompareAspect, string> = { title: "제목", thumbnail: "썸네일", length: "길이", hook: "훅", topic: "주제", timing: "올린 때", other: "기타" };
export type CompareStrength = "clear" | "weak";
export const COMPARE_STRENGTH_LABEL: Record<CompareStrength, string> = { clear: "분명", weak: "약함" };

/** 올린 시간대 (KST) — 0~6 · 6~12 · 12~18 · 18~24 */
export const TIME_BANDS = ["새벽", "오전", "오후", "저녁"] as const;
export const WEEKDAYS_KO = ["일", "월", "화", "수", "목", "금", "토"] as const;

export interface CompareVideo {
  /** YouTube 영상 id */
  id: string;
  title: string;
  url: string;
  thumbnail: string;
  views: number;
  multiple: number;
  duration: number;
  publishedAt: string;
  /** 이 영상에 바이럴 형식 분석(HitDoc.analysis)이 있어 AI 에 그 글도 줬나 */
  analyzed: boolean;
}

export interface CompareGroupStats {
  n: number;
  medianViews: number | null;
  medianSec: number | null;
  medianTitleLen: number | null;
  /** 제목에 숫자 · 물음표 · 해시태그 · 이모지가 있는 편수 (비율은 화면이 n 으로 나눈다) */
  withNumber: number;
  withQuestion: number;
  withHashtag: number;
  withEmoji: number;
  /** 올린 요일 (KST) — 일 ~ 토 편수 */
  weekdays: number[];
  /** 올린 시간대 (KST) — TIME_BANDS 순 편수 */
  bands: number[];
}

export interface ChannelCompareCalc {
  threshold: number;
  minViews: number;
  /** 평소 조회수 — 모르면 null (쇼츠가 모자람) */
  baseline: number | null;
  baselineN: number;
  baselineBasis: BaselineBasis;
  /** 고른 표본 — 올린 지 7일 넘은 최근 쇼츠 편수 */
  pool: number;
  /** 올린 지 7일 안이라 뺀 쇼츠 */
  young: number;
  hits: CompareVideo[];
  usual: CompareVideo[];
  stats: { hits: CompareGroupStats; usual: CompareGroupStats; limits: string[] };
}

/** AI 가 쓴 차이 — 가설이다. 숫자를 다시 말하지 않고 근거 영상 id 로 든다 (우리가 준 id 만 남는다) */
export interface ChannelCompareAi {
  differences: { aspect: CompareAspect; hit: string; usual: string; strength: CompareStrength; hitIds: string[]; usualIds: string[] }[];
  tryNext: string[];
  caveat: string;
}

export interface ChannelCompare extends ChannelCompareCalc {
  at: number;
  by: string;
  model: string;
  costUsd: number;
  ai: ChannelCompareAi;
}

const DIGIT = /[0-9０-９]/;
const QUESTION = /[?？]/;
const HASHTAG = /(?:^|\s)#[\p{L}\p{N}_]+/u;
// ©®™ 는 Extended_Pictographic 이지만 이모지로 쓰인 게 아니다
const EMOJI = /(?![©®™])\p{Extended_Pictographic}/u;
const KST_MS = 9 * 3600_000;

export const titleFeatures = (title: string) => ({
  len: [...title.trim()].length,
  number: DIGIT.test(title),
  question: QUESTION.test(title),
  hashtag: HASHTAG.test(title),
  emoji: EMOJI.test(title),
});

/** 올린 때 (KST) — 요일 0(일)~6 · 시간대 0~3. 게시일을 모르면 null */
export function kstSlot(publishedAt: string | null | undefined): { weekday: number; hour: number; band: number } | null {
  const t = publishedAt ? Date.parse(publishedAt) : NaN;
  if (!Number.isFinite(t)) return null;
  const k = new Date(t + KST_MS);
  const hour = k.getUTCHours();
  return { weekday: k.getUTCDay(), hour, band: Math.floor(hour / 6) };
}

/** 묶음 하나의 계산 — 편수 · 조회수 · 길이 · 제목 글자 수 중앙값 · 제목 특징 편수 · 요일 · 시간대 분포 */
export function compareGroupStats(videos: { title: string; duration: number | null; publishedAt: string | null; views: number | null }[]): CompareGroupStats {
  const weekdays = [0, 0, 0, 0, 0, 0, 0];
  const bands = [0, 0, 0, 0];
  let withNumber = 0;
  let withQuestion = 0;
  let withHashtag = 0;
  let withEmoji = 0;
  const lens: number[] = [];
  for (const v of videos) {
    const f = titleFeatures(v.title);
    lens.push(f.len);
    if (f.number) withNumber++;
    if (f.question) withQuestion++;
    if (f.hashtag) withHashtag++;
    if (f.emoji) withEmoji++;
    const slot = kstSlot(v.publishedAt);
    if (slot) {
      weekdays[slot.weekday]++;
      bands[slot.band]++;
    }
  }
  return {
    n: videos.length,
    medianViews: median(videos.flatMap((v) => (typeof v.views === "number" ? [v.views] : []))),
    medianSec: median(videos.flatMap((v) => (typeof v.duration === "number" && v.duration > 0 ? [v.duration] : []))),
    medianTitleLen: median(lens),
    withNumber,
    withQuestion,
    withHashtag,
    withEmoji,
    weekdays,
    bands,
  };
}

/**
 * 같은 채널 쇼츠에서 터진 쪽 · 평소 쪽을 고른다.
 *   표본  올린 지 7일 넘은 최근 쇼츠 30편 (평소 조회수를 낸 그 표본)
 *   터진  평소의 threshold 배 이상 · minViews 이상 — 배수 큰 순 최대 6편
 *   평소  배수 0.6~1.5 — 1배에 가까운 순(같으면 최근) 최대 8편
 */
export interface CompareSets<T> {
  baseline: ReturnType<typeof computeBaseline>;
  pool: number;
  young: number;
  hits: (T & { multiple: number })[];
  usual: (T & { multiple: number })[];
}

export function pickCompareSets<T extends { id: string; views: number | null; publishedAt: string | null }>(
  shorts: T[],
  s: Pick<ScoutSettings, "threshold" | "minViews">,
  now: number,
): CompareSets<T> {
  const baseline = computeBaseline(shorts, now);
  const aged = shorts
    .filter((v) => typeof v.views === "number")
    .map((v) => ({ v, age: ageDays(v.publishedAt, now) }))
    .filter((x): x is { v: T; age: number } => x.age !== null);
  const young = aged.filter((x) => x.age < COMPARE_MIN_AGE_DAYS).length;
  const pool = aged
    .filter((x) => x.age >= COMPARE_MIN_AGE_DAYS)
    .sort((a, b) => a.age - b.age)
    .slice(0, 30);
  if (baseline.value === null) return { baseline, pool: pool.length, young, hits: [], usual: [] };
  const withM = pool.map((x) => ({ ...x, m: multipleOf(x.v.views, baseline.value) as number }));
  const hits = withM
    .filter((x) => x.m >= s.threshold && (x.v.views ?? 0) >= s.minViews)
    .sort((a, b) => b.m - a.m || a.age - b.age)
    .slice(0, COMPARE_MAX_HITS)
    .map((x) => ({ ...x.v, multiple: x.m }));
  const usual = withM
    .filter((x) => x.m >= COMPARE_USUAL_MIN && x.m <= COMPARE_USUAL_MAX)
    .sort((a, b) => Math.abs(Math.log(a.m)) - Math.abs(Math.log(b.m)) || a.age - b.age)
    .slice(0, COMPARE_MAX_USUAL)
    .map((x) => ({ ...x.v, multiple: x.m }));
  return { baseline, pool: pool.length, young, hits, usual };
}

/** 계산 결과에 함께 다는 한계 — 편수가 적거나 평소가 어림일 때 */
export function compareLimits(hits: number, usual: number, basis: BaselineBasis): string[] {
  const out: string[] = [];
  if (hits === 1) out.push("터진 영상이 1편뿐 — 일반화하기 어려움");
  else if (hits === 2) out.push("터진 영상이 2편뿐 — 차이가 우연일 수 있음");
  if (usual > 0 && usual < 3) out.push(`평소 수준 영상이 ${usual}편뿐 — 견줄 쪽이 얇음`);
  if (basis === "young") out.push("올린 지 7일 넘은 쇼츠가 5편이 안 돼 평소 조회수가 어림");
  return out;
}

/** 비교를 못 하는 이유 — 할 수 있으면 null (AI 를 부르기 전에 서버 · 화면이 같이 본다) */
export function compareBlockReason(c: Pick<ChannelCompareCalc, "baseline" | "pool" | "young" | "threshold" | "minViews" | "hits" | "usual">): string | null {
  if (c.baseline === null) return "이 채널 최근 쇼츠가 5편이 안 돼 평소 조회수를 낼 수 없습니다.";
  if (c.pool < 5) return `올린 지 7일 넘은 최근 쇼츠가 ${c.pool}편뿐이라 아직 견줄 수 없습니다${c.young ? ` — 7일 안 ${c.young}편은 조회수가 차는 중입니다` : ""}.`;
  if (!c.hits.length) return `올린 지 7일 넘은 최근 쇼츠 ${c.pool}편 중 평소의 ${c.threshold}배 · 조회 ${c.minViews.toLocaleString("ko-KR")}회를 넘은 영상이 없습니다.`;
  if (!c.usual.length) return `평소 수준(평소의 ${COMPARE_USUAL_MIN}~${COMPARE_USUAL_MAX}배) 영상이 없어 견줄 쪽이 없습니다.`;
  return null;
}

/** 고른 영상 → 저장 · 화면용 계산 (analyzed = 형식 분석이 있는 영상 id) */
export function compareCalcOf(
  sets: CompareSets<{ id: string; url: string; title: string; thumbnail: string; views: number | null; publishedAt: string | null; duration: number | null }>,
  s: Pick<ScoutSettings, "threshold" | "minViews">,
  analyzed: ReadonlySet<string> = new Set(),
): ChannelCompareCalc {
  const video = (v: (typeof sets.hits)[number]): CompareVideo => ({
    id: v.id,
    title: v.title.slice(0, 300),
    url: v.url,
    thumbnail: v.thumbnail,
    views: v.views ?? 0,
    multiple: v.multiple,
    duration: v.duration ?? 0,
    publishedAt: v.publishedAt ?? "",
    analyzed: analyzed.has(v.id),
  });
  const hits = sets.hits.map(video);
  const usual = sets.usual.map(video);
  return {
    threshold: s.threshold,
    minViews: s.minViews,
    baseline: sets.baseline.value,
    baselineN: sets.baseline.n,
    baselineBasis: sets.baseline.basis,
    pool: sets.pool,
    young: sets.young,
    hits,
    usual,
    stats: { hits: compareGroupStats(hits), usual: compareGroupStats(usual), limits: compareLimits(hits.length, usual.length, sets.baseline.basis) },
  };
}
