// ============================================================
//  AI 레이더 — 매일 아침 키워드로 YouTube 쇼츠를 훑어 「반응 큰 상품 후보」 를 모은다
// ------------------------------------------------------------
//  소재 발굴(trends) 의 자동판. 회사 공용이다 (바이럴 형식 정찰과 같은 성격).
//    ① 키워드 검색(search.list — 하루 100회 한도를 소재 발굴과 같이 센다) → 영상 통계
//    ② 채널 평소 조회수 대비 배수 · 하루 조회 속도 · 「어디서 사요」 댓글 비율
//    ③ AI 가 제목 · 설명 · 태그 · 댓글 글만 보고 상품을 추정한다 (영상을 보지 않는다 — 「추정」)
//    ④ 네이버 데이터랩 검색어 트렌드로 국내 검색 추세 (상대값 · 키가 있을 때만)
//  숫자는 출처가 있는 것만: 조회 · 좋아요 · 댓글은 YouTube API, 상품은 AI 추정, 추세는 네이버.
//  「네이버 검색 적음」 은 데이터랩 기준일 뿐 — 국내에 없다는 단정이 아니다.
//
//  순수 함수만 둔다 (브라우저 · 서버 공용). 실행은 server/radar-run.ts.
// ============================================================

export type RadarCategory = "살림" | "주방" | "수납" | "청소" | "다이소" | "기타";
export const RADAR_CATEGORIES: RadarCategory[] = ["살림", "주방", "수납", "청소", "다이소", "기타"];

export interface RadarSettings {
  enabled: boolean;
  /** 훑을 검색어 — 하나에 search.list 1회 */
  keywords: string[];
  /** 최근 며칠 안에 올라온 영상만 */
  days: number;
  /** 이보다 적게 본 영상은 후보로 안 쓴다 */
  minViews: number;
  /** 한 번 돌 때 검색 횟수 상한 (하루 100회 한도를 소재 발굴과 같이 쓴다) */
  maxSearchesPerRun: number;
  /** 하루 AI 비용 상한 (원) */
  aiBudgetKrw: number;
  updatedAt: number;
  updatedBy: string;
}

export const DEFAULT_RADAR_SETTINGS: RadarSettings = {
  enabled: true,
  keywords: ["살림템", "살림꿀템", "주방꿀템", "주방템 추천", "수납꿀템", "수납정리", "청소꿀템", "청소템", "다이소꿀템", "다이소 추천템"],
  days: 10,
  minViews: 10_000,
  maxSearchesPerRun: 10,
  aiBudgetKrw: 1000,
  updatedAt: 0,
  updatedBy: "",
};

/** 원 ↔ 달러 — OpenRouter 비용(달러)을 하루 상한(원)과 견주는 어림값 */
export const USD_KRW = 1450;
export const krwOf = (usd: number) => Math.round(usd * USD_KRW);

export interface RadarAi {
  /** 살림 · 주방 · 수납 · 청소 · 생활용품 상품을 보여 주는 영상인가 */
  relevant: boolean;
  /** 일반 명칭 (브랜드는 글에 분명할 때만) — 모르면 "" */
  product: string;
  /** 같은 상품 묶음 열쇠 (짧은 일반 명사구) */
  productKey: string;
  category: RadarCategory;
  confidence: "likely" | "unclear";
  /** 무엇을 보고 추정했나 (제목 · 태그 · 댓글) */
  evidence: string;
  /** 왜 반응이 좋았을지 — 글로 본 추정 */
  why: string;
  /** 첫 장면 훅 추정 — 모르면 "" */
  hook: string;
  /** 네이버 데이터랩에 넣을 검색어 (1~3개) */
  naverKeywords: string[];
  /** 쿠팡에서 찾아볼 검색어 */
  coupangQuery: string;
  /** 과장 · 효능 · 안전 주의 — 없으면 "" */
  caution: string;
  model: string;
  costUsd: number;
  at: number;
  /** 이 분석이 참고한 사람 메모 수 · 그중 가장 늦은 메모 시각 (메모 없이 분석했으면 0 · null) */
  notes?: number;
  noteAt?: number | null;
  /** 메모를 반영해 다시 분석한 사람 (자동 실행이면 없음) */
  by?: string;
  /** 이 분석이 참고한 「직접 촬영」 표시 (표시 없이 분석했으면 null) */
  filmed?: RadarFilmed | null;
}

/** 사람이 영상을 보고 고른 표시 — 크리에이터가 직접 찍은 실사 영상인가 (AI 생성 · 퍼온 영상 · 사진 넘기기 등은 아님) */
export type RadarFilmed = "self" | "not_self";
export const RADAR_FILMED_LABEL: Record<RadarFilmed, string> = { self: "직접 촬영", not_self: "직접 촬영 아님" };
export const isRadarFilmed = (v: unknown): v is RadarFilmed => v === "self" || v === "not_self";

/** 후보 영상에 사람이 남긴 메모 — 회사 공용 · 한 사람에 하나 · AI 가 분석할 때 참고한다 */
export interface RadarNote {
  by: string;
  text: string;
  at: number;
}
export const RADAR_NOTE_MAX = 1000;

/** 내 메모를 고친다 — 빈 글이면 지운다. 다른 사람 메모는 그대로 */
export function upsertRadarNote(notes: RadarNote[] | undefined, by: string, text: string, at: number): RadarNote[] {
  const t = text.trim().slice(0, RADAR_NOTE_MAX);
  const others = (notes ?? []).filter((n) => n.by !== by);
  return t ? [...others, { by, text: t, at }] : others;
}

/**
 * 사람 표시(메모 · 직접 촬영)와 AI 분석의 관계 —
 *   none(표시 없음) · pending(분석 전) · applied(지금 표시를 모두 반영) · stale(분석 뒤에 메모 · 촬영 표시가 바뀜)
 */
export function radarNoteState(x: {
  notes?: RadarNote[];
  filmed?: { value: RadarFilmed } | null;
  ai: Pick<RadarAi, "notes" | "noteAt" | "filmed"> | null;
}): "none" | "pending" | "applied" | "stale" {
  const notes = x.notes ?? [];
  const filmed = x.filmed?.value ?? null;
  if (!notes.length && !filmed) return x.ai?.notes || x.ai?.filmed ? "stale" : "none"; // 반영했던 표시를 지웠다
  if (!x.ai) return "pending";
  const latest = notes.length ? Math.max(...notes.map((n) => n.at)) : 0;
  const notesOk = notes.length ? x.ai.notes === notes.length && (x.ai.noteAt ?? 0) >= latest : !x.ai.notes;
  const filmedOk = (x.ai.filmed ?? null) === filmed;
  return notesOk && filmedOk ? "applied" : "stale";
}

/** 지금 목록의 직접 촬영 표시 수 (분석용 한 줄) */
export function radarFilmedCounts(items: Pick<RadarDoc, "filmed">[]): Record<RadarFilmed | "none", number> {
  const c = { self: 0, not_self: 0, none: 0 };
  for (const d of items) c[d.filmed?.value ?? "none"]++;
  return c;
}

export type NaverTrendLabel = "rising" | "steady" | "falling" | "low";

export interface NaverTrend {
  keywords: string[];
  label: NaverTrendLabel;
  /** 최근 2주 평균 · 그 전 6주 평균 (네이버 상대값 0~100) */
  recent: number | null;
  before: number | null;
  /** recent ÷ before — 그 전이 0 이면 null */
  change: number | null;
  weeks: number;
  at: number;
}

export interface RadarDoc {
  platform: "youtube";
  videoId: string;
  url: string;
  title: string;
  channel: string;
  channelId: string;
  thumbnail: string;
  publishedAt: string | null;
  duration: number;
  views: number | null;
  likes: number | null;
  comments: number | null;
  viewsAt: number;
  viewHistory: { at: number; views: number }[];
  /** 채널 평소 조회수 (최근 쇼츠 중앙값) — 모르면 null */
  baseline: number | null;
  multiple: number | null;
  velocityPerDay: number | null;
  velocityBasis: "history" | "since_publish" | null;
  /** 댓글 표본 — 정보 요청(어디서 사요 · 링크 …) 댓글 수 */
  info: { sampled: number; matched: number } | null;
  /** 이 영상을 찾은 검색어 */
  keywords: string[];
  score: number;
  ai: RadarAi | null;
  naver: NaverTrend | null;
  dismissed: { by: string; at: number } | null;
  /** 사람 메모 (회사 공용 · 한 사람에 하나) — 예전 후보에는 없다 */
  notes?: RadarNote[];
  /** 직접 촬영 표시 (회사 공용 · 마지막에 고른 사람) — 아직 안 봤으면 없음 */
  filmed?: { value: RadarFilmed; by: string; at: number } | null;
  /** 소재로 저장한 사람들 (소재는 사람마다 따로) */
  saved: { by: string; trendId: string; at: number }[];
  firstSeenAt: number;
  lastSeenAt: number;
}

export interface RadarRunSummary {
  at: number;
  by: string;
  searched: number;
  found: number;
  created: number;
  updated: number;
  aiCalls: number;
  aiUsd: number;
  naverCalls: number;
  notes: string[];
  ms: number;
}

const DAY = 86_400_000;

/**
 * 하루 조회 속도. 같은 영상을 두 번 이상 봤으면 실제 증가로(최근 두 기록), 처음이면 올린 뒤 평균.
 */
export function radarVelocity(
  history: { at: number; views: number }[],
  views: number | null,
  publishedAt: string | null,
  now: number,
): { perDay: number | null; basis: RadarDoc["velocityBasis"] } {
  const h = [...history].sort((a, b) => a.at - b.at);
  if (h.length >= 2) {
    const a = h[h.length - 2];
    const b = h[h.length - 1];
    const days = (b.at - a.at) / DAY;
    if (days >= 0.25) return { perDay: Math.max(0, Math.round((b.views - a.views) / days)), basis: "history" };
  }
  const t = publishedAt ? Date.parse(publishedAt) : NaN;
  if (views === null || !Number.isFinite(t)) return { perDay: null, basis: null };
  const age = Math.max((now - t) / DAY, 1 / 24);
  return { perDay: Math.round(views / age), basis: "since_publish" };
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * 레이더 점수 0~100 — 화면에 그대로 적는 산식:
 *   평소 대비 배수 40점 (1배 0 → 20배 이상 40) + 하루 조회 속도 40점 (1천 0 → 100만 이상 40)
 *   + 정보 요청 댓글 비율 20점 (0% → 20% 이상 20). 모르는 항목은 0 점.
 */
export function radarScore(x: { multiple: number | null; velocityPerDay: number | null; info: RadarDoc["info"] }): number {
  const m = x.multiple !== null && x.multiple > 1 ? 40 * clamp01(Math.log10(x.multiple) / Math.log10(20)) : 0;
  const v = x.velocityPerDay !== null && x.velocityPerDay > 1000 ? 40 * clamp01(Math.log10(x.velocityPerDay / 1000) / 3) : 0;
  const rate = x.info && x.info.sampled > 0 ? x.info.matched / x.info.sampled : 0;
  const i = 20 * clamp01(rate / 0.2);
  return Math.round((m + v + i) * 10) / 10;
}

/**
 * 네이버 데이터랩 주간 상대값(검색어 묶음 하나만 넣은 요청 — 그 묶음의 최고 주가 100)으로 추세를 고른다.
 * 최근 2주 평균 ÷ 그 전 6주 평균: 1.3 이상 상승 · 0.75 이하 하락 · 그 사이 유지.
 * 값이 하나도 없거나 전부 0 이면 「검색 적음」 (데이터랩 기준 — 국내에 없다는 뜻이 아니다).
 */
export function classifyNaverTrend(series: number[]): Pick<NaverTrend, "label" | "recent" | "before" | "change" | "weeks"> {
  const s = series.map((v) => (Number.isFinite(v) && v > 0 ? v : 0));
  if (!s.length || s.every((v) => v === 0)) return { label: "low", recent: null, before: null, change: null, weeks: s.length };
  const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  const recent = avg(s.slice(-2));
  const before = avg(s.slice(-8, -2));
  const round = (v: number) => Math.round(v * 10) / 10;
  if (before === 0) return { label: recent > 0 ? "rising" : "low", recent: round(recent), before: 0, change: null, weeks: s.length };
  const change = recent / before;
  return { label: change >= 1.3 ? "rising" : change <= 0.75 ? "falling" : "steady", recent: round(recent), before: round(before), change: Math.round(change * 100) / 100, weeks: s.length };
}

export const NAVER_LABEL: Record<NaverTrendLabel, string> = {
  rising: "국내 검색 상승",
  steady: "국내 검색 유지",
  falling: "국내 검색 하락",
  low: "네이버 검색 적음",
};

/** 같은 상품 묶음 열쇠 — 띄어쓰기 · 기호 · 대소문자를 지운다 */
export const normalizeProductKey = (v: string) =>
  v
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .slice(0, 40);

/** 화면 묶음 — 같은 상품을 보여 준 영상끼리 (AI 가 상품을 모르면 영상 하나가 한 묶음) */
export function groupRadar<T extends Pick<RadarDoc, "ai" | "score"> & { id: string }>(docs: T[]): { key: string; items: T[]; best: number }[] {
  const groups = new Map<string, T[]>();
  for (const d of docs) {
    const k = d.ai?.productKey ? normalizeProductKey(d.ai.productKey) : "";
    const key = k || `video:${d.id}`;
    groups.set(key, [...(groups.get(key) ?? []), d]);
  }
  return [...groups.entries()]
    .map(([key, items]) => {
      const sorted = [...items].sort((a, b) => b.score - a.score);
      return { key, items: sorted, best: sorted[0]?.score ?? 0 };
    })
    .sort((a, b) => b.best - a.best);
}

/** 설정 정리 — 화면이 보낸 값을 믿지 않는다 */
export function sanitizeRadarSettings(input: unknown, prev: RadarSettings, by: string, now = Date.now()): RadarSettings {
  const r = (input ?? {}) as Record<string, unknown>;
  const num = (v: unknown, min: number, max: number, d: number) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : d;
  };
  const keywords = Array.isArray(r.keywords)
    ? [...new Set(r.keywords.map((k) => String(k).trim().slice(0, 40)).filter(Boolean))].slice(0, 20)
    : prev.keywords;
  return {
    enabled: typeof r.enabled === "boolean" ? r.enabled : prev.enabled,
    keywords: keywords.length ? keywords : prev.keywords,
    days: num(r.days, 1, 30, prev.days),
    minViews: num(r.minViews, 0, 10_000_000, prev.minViews),
    maxSearchesPerRun: num(r.maxSearchesPerRun, 1, 20, prev.maxSearchesPerRun),
    aiBudgetKrw: num(r.aiBudgetKrw, 0, 10_000, prev.aiBudgetKrw),
    updatedAt: now,
    updatedBy: by,
  };
}

// ---- 화면 필터 · 정렬 ---------------------------------------------------

export interface RadarFilter {
  category: RadarCategory | "all";
  /** known = AI 가 상품을 짚음 · unknown = 글로는 모름(모음 영상 포함) · pending = AI 추정 전 */
  product: "all" | "known" | "unknown" | "pending";
  /** none = 네이버 추세를 아직 안 봄 */
  naver: NaverTrendLabel | "all" | "none";
  /** 평소 대비 최소 배수 (0 = 상관없음 · 배수를 모르면 빠진다) */
  minMultiple: number;
  /** 올린 지 최대 며칠 (0 = 상관없음) */
  maxAgeDays: number;
  /** 이 검색어로 찾은 것만 ("" = 전부) */
  keyword: string;
  /** 제목 · 상품 · 채널 낱말 */
  q: string;
  /** 직접 촬영 표시 — none = 아직 표시 안 함 */
  filmed: "all" | RadarFilmed | "none";
  sort: "score" | "multiple" | "velocity" | "info" | "recent";
}

export const DEFAULT_RADAR_FILTER: RadarFilter = { category: "all", product: "all", naver: "all", minMultiple: 0, maxAgeDays: 0, keyword: "", q: "", filmed: "all", sort: "score" };

export const RADAR_SORT_LABEL: Record<RadarFilter["sort"], string> = {
  score: "점수 순",
  multiple: "평소 대비 배수 순",
  velocity: "하루 조회 속도 순",
  info: "정보 요청 비율 순",
  recent: "최근 올린 순",
};

export const isDefaultRadarFilter = (f: RadarFilter) =>
  f.category === "all" && f.product === "all" && f.naver === "all" && !f.minMultiple && !f.maxAgeDays && !f.keyword && !f.q.trim() && (f.filmed ?? "all") === "all";

const infoRateOf = (d: Pick<RadarDoc, "info">) => (d.info && d.info.sampled > 0 ? d.info.matched / d.info.sampled : null);

export function matchRadar(d: RadarDoc, f: RadarFilter, now: number): boolean {
  if (f.category !== "all" && d.ai?.category !== f.category) return false;
  if (f.product === "known" && !d.ai?.product) return false;
  if (f.product === "unknown" && (!d.ai || d.ai.product)) return false;
  if (f.product === "pending" && d.ai) return false;
  if (f.naver === "none" && d.naver) return false;
  if (f.naver !== "all" && f.naver !== "none" && d.naver?.label !== f.naver) return false;
  if (f.minMultiple > 0 && (d.multiple === null || d.multiple < f.minMultiple)) return false;
  if (f.maxAgeDays > 0) {
    const t = d.publishedAt ? Date.parse(d.publishedAt) : NaN;
    if (!Number.isFinite(t) || now - t > f.maxAgeDays * 86_400_000) return false;
  }
  if (f.keyword && !d.keywords.includes(f.keyword)) return false;
  if (f.filmed === "none" && d.filmed) return false;
  if ((f.filmed === "self" || f.filmed === "not_self") && d.filmed?.value !== f.filmed) return false;
  const q = f.q.trim().toLowerCase();
  if (q && ![d.title, d.channel, d.ai?.product ?? "", ...(d.ai?.naverKeywords ?? [])].some((s) => s.toLowerCase().includes(q))) return false;
  return true;
}

/** 정렬 값 — 모르는 값은 맨 뒤 */
export function radarSortValue(d: RadarDoc, sort: RadarFilter["sort"]): number {
  switch (sort) {
    case "multiple":
      return d.multiple ?? -1;
    case "velocity":
      return d.velocityPerDay ?? -1;
    case "info":
      return infoRateOf(d) ?? -1;
    case "recent": {
      const t = d.publishedAt ? Date.parse(d.publishedAt) : NaN;
      return Number.isFinite(t) ? t : -1;
    }
    default:
      return d.score;
  }
}

/** 필터 → 같은 상품 묶음 → 정렬 (묶음은 대표 영상 값으로) */
export function filterRadarGroups<T extends RadarDoc & { id: string }>(docs: T[], f: RadarFilter, now: number) {
  const groups = groupRadar(docs.filter((d) => matchRadar(d, f, now)));
  for (const g of groups) g.items.sort((a, b) => radarSortValue(b, f.sort) - radarSortValue(a, f.sort));
  return groups.sort((a, b) => radarSortValue(b.items[0], f.sort) - radarSortValue(a.items[0], f.sort));
}
