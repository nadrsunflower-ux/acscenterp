// ============================================================
//  시장 트렌드 (/neander/shorts/market) — 매일 아침 브리핑 · 검색어 추이 · 채널 모니터링 · 트렌드 노트
// ------------------------------------------------------------
//  · 검색어 추이 = 네이버 데이터랩 검색어 트렌드(NAVER API HUB). 값은 한 요청 안의 가장 높은 구간을 100 으로 둔
//    상대값이다 — 같은 요청에 넣은 묶음끼리만 크기를 견준다. 나이 · 성별을 바꾸면 요청이 따로라 모양만 견준다.
//  · 채널 모니터링 = 감시 채널(바이럴 형식) + 내 채널(연결한 유튜브 · 인스타)의 하루 한 번 숫자 기록.
//    기록이 쌓여야 7일 · 30일 변화가 나온다 (기록 시작 전 값은 지어내지 않는다).
//  · 브리핑 = 레이더 · 바이럴 형식 · 검색어 추이 · 채널 변화를 모아 AI 가 「특기할 만한 것」 을 뽑는다(매일 아침).
//    숫자는 자료에 있는 것만 — AI 가 고른 근거 id 가 자료에 없으면 버린다.
//  · 트렌드 노트 = 사람이 보관한 카드 (사람마다 비공개). 출처 · 그때 숫자 · 메모 · 태그 · 상태.
//  순수 함수 · 모양만 둔다 (브라우저 · 서버 공용). 실행은 server/market.ts.
// ============================================================

import { classifyNaverTrend, type NaverTrendLabel } from "./radar";

// ---- 검색어 묶음 -------------------------------------------------------------

export interface KeywordGroup {
  id: string;
  name: string;
  /** 1~20개 — 네이버는 묶음 안 검색어를 합쳐 센다 */
  keywords: string[];
}

export const DEFAULT_KEYWORD_GROUPS: KeywordGroup[] = [
  { id: "salim", name: "살림", keywords: ["살림템", "살림꿀템", "살림 아이템", "살림 추천"] },
  { id: "kitchen", name: "주방", keywords: ["주방템", "주방용품", "주방꿀템", "주방 정리"] },
  { id: "storage", name: "수납", keywords: ["수납정리", "수납템", "정리함", "수납박스"] },
  { id: "cleaning", name: "청소", keywords: ["청소템", "청소용품", "청소꿀템", "청소 방법"] },
  { id: "daiso", name: "다이소", keywords: ["다이소", "다이소 추천", "다이소템", "다이소 꿀템"] },
];

export const MAX_KEYWORD_GROUPS = 12;

export interface MarketSettings {
  groups: KeywordGroup[];
  /** 매일 아침 자동 (채널 기록 · 검색어 추이 · 브리핑) */
  enabled: boolean;
  /** 브리핑 AI 하루 상한 (원) */
  briefBudgetKrw: number;
  updatedAt: number;
  updatedBy: string;
}

export const DEFAULT_MARKET_SETTINGS: MarketSettings = { groups: DEFAULT_KEYWORD_GROUPS, enabled: true, briefBudgetKrw: 200, updatedAt: 0, updatedBy: "" };

const str = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");

export function sanitizeKeywordGroups(raw: unknown): KeywordGroup[] {
  const seen = new Set<string>();
  const out: KeywordGroup[] = [];
  for (const x of Array.isArray(raw) ? raw : []) {
    const g = (x ?? {}) as Record<string, unknown>;
    const name = str(g.name, 30);
    const keywords = [...new Set((Array.isArray(g.keywords) ? g.keywords : typeof g.keywords === "string" ? g.keywords.split(/[,\n]/) : []).map((k) => str(k, 40)).filter(Boolean))].slice(0, 20);
    if (!name || !keywords.length) continue;
    let id = str(g.id, 40).replace(/[^\w-]/g, "") || `g${out.length + 1}`;
    while (seen.has(id)) id = `${id}_`;
    seen.add(id);
    out.push({ id, name, keywords });
    if (out.length >= MAX_KEYWORD_GROUPS) break;
  }
  return out;
}

export function sanitizeMarketSettings(raw: unknown, prev: MarketSettings, by: string, now = Date.now()): MarketSettings {
  const r = (raw ?? {}) as Record<string, unknown>;
  const groups = "groups" in r ? sanitizeKeywordGroups(r.groups) : prev.groups;
  const budget = Number(r.briefBudgetKrw);
  return {
    groups: groups.length ? groups : prev.groups,
    enabled: typeof r.enabled === "boolean" ? r.enabled : prev.enabled,
    briefBudgetKrw: Number.isFinite(budget) ? Math.round(Math.min(2000, Math.max(0, budget))) : prev.briefBudgetKrw,
    updatedAt: now,
    updatedBy: by,
  };
}

// ---- 검색어 추이 ---------------------------------------------------------------

export interface TrendPoint {
  period: string;
  ratio: number;
}

/** 묶음 하나를 혼자 부른 1년 주간 추이 — 모양 · 최근 변화만 본다 (묶음끼리 크기는 비교 차트에서) */
export interface GroupSeries {
  groupId: string;
  name: string;
  keywords: string[];
  points: TrendPoint[];
  at: number;
}

/** 최근 2주 ÷ 그 전 6주 — 레이더 상품 추세와 같은 기준 */
export function groupTrend(points: TrendPoint[]): { label: NaverTrendLabel; change: number | null; recent: number | null; before: number | null } {
  const r = classifyNaverTrend(points.map((p) => p.ratio).slice(-8));
  return { label: r.label, change: r.change, recent: r.recent, before: r.before };
}

/** 데이터랩 나이 구간 */
export const NAVER_AGES: { code: string; label: string }[] = [
  { code: "1", label: "0~12세" },
  { code: "2", label: "13~18세" },
  { code: "3", label: "19~24세" },
  { code: "4", label: "25~29세" },
  { code: "5", label: "30~34세" },
  { code: "6", label: "35~39세" },
  { code: "7", label: "40~44세" },
  { code: "8", label: "45~49세" },
  { code: "9", label: "50~54세" },
  { code: "10", label: "55~59세" },
  { code: "11", label: "60세 이상" },
];

/** 나이 · 성별 나눠 보기의 집단 — 집단마다 요청이 따로라 각자 안의 상대값이다 */
export const SEGMENTS: { id: string; label: string; gender?: "m" | "f"; ages?: string[] }[] = [
  { id: "f20", label: "20대 여성", gender: "f", ages: ["3", "4"] },
  { id: "f30", label: "30대 여성", gender: "f", ages: ["5", "6"] },
  { id: "f40", label: "40대 여성", gender: "f", ages: ["7", "8"] },
  { id: "f50", label: "50대 이상 여성", gender: "f", ages: ["9", "10", "11"] },
  { id: "m", label: "남성 (20~40대)", gender: "m", ages: ["3", "4", "5", "6", "7", "8"] },
];

export type TrendRange = "3m" | "6m" | "1y";
export const TREND_RANGE_LABEL: Record<TrendRange, string> = { "3m": "3개월", "6m": "6개월", "1y": "1년" };

/** 기간 → 시작 · 끝 날짜 (KST · 끝은 어제 — 오늘은 아직 덜 찼다) */
export function trendDates(range: TrendRange, now = Date.now()): { startDate: string; endDate: string } {
  const ymd = (t: number) => new Date(t + 9 * 3600_000).toISOString().slice(0, 10);
  const end = now - 86_400_000;
  const days = range === "3m" ? 91 : range === "6m" ? 182 : 364;
  return { startDate: ymd(end - days * 86_400_000), endDate: ymd(end) };
}

// ---- 채널 모니터링 ---------------------------------------------------------------

export interface ChannelStatPoint {
  /** KST 날짜 */
  day: string;
  subs: number | null;
  views: number | null;
  /** 유튜브 영상 수 · 인스타 게시물 수 */
  posts: number | null;
}

export interface ChannelStatDoc {
  platform: "youtube" | "instagram";
  /** 유튜브 채널 id · 인스타 계정 id */
  externalId: string;
  name: string;
  handle: string;
  thumbnail: string;
  /** 내 채널(연결한 게시 계정)이면 true · 감시 채널이면 false */
  mine: boolean;
  /** 감시 채널 문서 id (바이럴 형식) */
  watchId: string | null;
  country: string;
  history: ChannelStatPoint[];
  updatedAt: number;
}

export const CHANNEL_HISTORY_MAX = 400;

/** 같은 날 기록은 바꿔 끼우고, 날짜 순 · 최대 길이 */
export function pushChannelPoint(history: ChannelStatPoint[], p: ChannelStatPoint): ChannelStatPoint[] {
  const rest = history.filter((h) => h.day !== p.day);
  const all = [...rest, p].sort((a, b) => a.day.localeCompare(b.day));
  return all.slice(-CHANNEL_HISTORY_MAX);
}

/**
 * days 일 전과 견준 변화 — 그날 기록이 없으면 그보다 앞선 가장 가까운 기록. 그런 기록이 없으면 null(아직 모름).
 * 값이 없는(null) 기록은 건너뛴다.
 */
export function channelDelta(history: ChannelStatPoint[], days: number, key: "subs" | "views" | "posts"): number | null {
  const h = history.filter((p) => p[key] !== null).sort((a, b) => a.day.localeCompare(b.day));
  if (h.length < 2) return null;
  const last = h[h.length - 1];
  const lastT = Date.parse(`${last.day}T00:00:00Z`);
  if (!Number.isFinite(lastT)) return null;
  const target = new Date(lastT - days * 86_400_000).toISOString().slice(0, 10);
  const base = [...h].reverse().find((p) => p.day <= target);
  if (!base) return null;
  return (last[key] as number) - (base[key] as number);
}

/** 기록이 며칠째인가 (첫 기록 ~ 마지막 기록) */
export const channelTrackedDays = (history: ChannelStatPoint[]) =>
  history.length ? Math.round((Date.parse(`${history[history.length - 1].day}T00:00:00Z`) - Date.parse(`${history[0].day}T00:00:00Z`)) / 86_400_000) + 1 : 0;

// ---- 브리핑 ---------------------------------------------------------------------

export type BriefKind = "product" | "format" | "hit" | "keyword" | "channel" | "mine";
export const BRIEF_KIND_LABEL: Record<BriefKind, string> = { product: "뜨는 상품", format: "형식", hit: "터진 영상", keyword: "검색어", channel: "감시 채널", mine: "내 채널" };

export interface BriefRef {
  kind: "radar" | "hit" | "format" | "group" | "channel";
  id: string;
  url: string | null;
  label: string;
}

export interface MarketBriefItem {
  kind: BriefKind;
  title: string;
  /** 왜 특기할 만한가 — 자료의 숫자로 */
  why: string;
  /** 근거 숫자 한 줄 */
  numbers: string;
  /** 해 볼 만한 것 */
  action: string;
  ref: BriefRef | null;
}

export interface MarketBriefDoc {
  day: string;
  at: number;
  by: string;
  headline: string;
  summary: string[];
  items: MarketBriefItem[];
  model: string;
  costUsd: number;
  /** 무엇을 넣었나 (개수) */
  inputs: Record<string, number>;
  notes: string[];
}

/** AI 에 넘기는 자료 — 짧게 (id 는 근거로 되짚을 수 있게) */
export interface BriefInput {
  day: string;
  radar: { id: string; product: string; title: string; multiple: number | null; perDay: number | null; infoRate: number | null; naver: string | null; naverChange: number | null; filmed: string | null }[];
  productTrends: { id: string; product: string; label: string; change: number | null; candidates: number }[];
  hits: { id: string; title: string; channel: string; country: string; multiple: number | null; format: string | null }[];
  formats: { id: string; name: string; examples: number; korea: string; summary: string }[];
  groups: { id: string; name: string; label: string; change: number | null; recent: number | null }[];
  channels: { id: string; name: string; mine: boolean; platform: string; subs: number | null; subs7: number | null; subs30: number | null; posts7: number | null; days: number }[];
}

// ---- 트렌드 노트 ------------------------------------------------------------------

export type NoteStatus = "inbox" | "watch" | "script" | "done";
export const NOTE_STATUS_LABEL: Record<NoteStatus, string> = { inbox: "검토 전", watch: "지켜보기", script: "대본으로", done: "끝" };
export const NOTE_STATUSES = Object.keys(NOTE_STATUS_LABEL) as NoteStatus[];

export type NoteSourceKind = "brief" | "radar" | "hit" | "format" | "keyword" | "channel" | "manual";
export const NOTE_SOURCE_LABEL: Record<NoteSourceKind, string> = { brief: "브리핑", radar: "레이더", hit: "터진 영상", format: "형식", keyword: "검색어", channel: "채널", manual: "직접" };

export interface TrendNoteDoc {
  owner: string;
  createdAt: number;
  updatedAt: number;
  title: string;
  memo: string;
  tags: string[];
  status: NoteStatus;
  pinned: boolean;
  source: { kind: NoteSourceKind; id: string | null; url: string | null; label: string };
  /** 보관할 때의 숫자 한 줄 (나중에 바뀌어도 그때 값이 남게) */
  snapshot: string;
  /** 대본 작성기에 넘길 제품 이름 (있으면) */
  product: string;
}

const isUrl = (v: unknown) => typeof v === "string" && /^https?:\/\/\S{3,500}$/.test(v);

/** 노트 다듬기 — prev 가 있으면 고치기 (주인 · 만든 날 · 출처는 그대로) */
export function sanitizeNote(raw: unknown, owner: string, now: number, prev?: TrendNoteDoc | null): TrendNoteDoc {
  const r = (raw ?? {}) as Record<string, unknown>;
  const src = (r.source ?? {}) as Record<string, unknown>;
  const kinds = Object.keys(NOTE_SOURCE_LABEL) as NoteSourceKind[];
  const tags = "tags" in r ? [...new Set((Array.isArray(r.tags) ? r.tags : typeof r.tags === "string" ? r.tags.split(/[,#\s]+/) : []).map((t) => str(t, 20).replace(/^#/, "")).filter(Boolean))].slice(0, 10) : (prev?.tags ?? []);
  return {
    owner: prev?.owner ?? owner,
    createdAt: prev?.createdAt ?? now,
    updatedAt: now,
    title: ("title" in r ? str(r.title, 120) : prev?.title) || prev?.title || "제목 없음",
    memo: "memo" in r ? str(r.memo, 3000) : (prev?.memo ?? ""),
    tags,
    status: NOTE_STATUSES.includes(r.status as NoteStatus) ? (r.status as NoteStatus) : (prev?.status ?? "inbox"),
    pinned: typeof r.pinned === "boolean" ? r.pinned : (prev?.pinned ?? false),
    source: prev?.source ?? {
      kind: kinds.includes(src.kind as NoteSourceKind) ? (src.kind as NoteSourceKind) : "manual",
      id: str(src.id, 80) || null,
      url: isUrl(src.url) ? (src.url as string) : null,
      label: str(src.label, 120),
    },
    snapshot: prev?.snapshot ?? str(r.snapshot, 300),
    product: "product" in r ? str(r.product, 120) : (prev?.product ?? ""),
  };
}
