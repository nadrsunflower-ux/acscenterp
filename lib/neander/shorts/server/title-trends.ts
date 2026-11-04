import "server-only";

// ============================================================
//  제목 키워드 — 지금 프로젝트의 레이더 · 터진 영상 제목을 읽어 계산한다 (shorts/title-trends.ts)
// ------------------------------------------------------------
//  읽기만 한다 (저장 · AI 호출 없음). 화면에 보낼 양을 줄인다 — 순위는 상위만, 영상은 고른 낱말을 쓴 것만.
//  레이더는 45일 지난 후보를 치우므로(radar-run KEEP_DAYS) 오래된 주는 자료가 줄어든다 — 화면이 주마다 모은 수를 밝힌다.
// ============================================================

import type { Firestore } from "firebase-admin/firestore";
import { NEANDER_COL } from "@/lib/neander/collections";
import { currentSpace } from "./space-db";
import type { RadarDoc } from "../radar";
import type { HitDoc } from "../scout";
import { isoWeekKey } from "../scout";
import {
  MAX_TITLE_WORDS,
  buildTitleIndex,
  baseWeeksOf,
  defaultTitleWeek,
  normalizeQuery,
  titleTrendRows,
  titleWordSeries,
  videosWithWords,
  type TitleSort,
  type TitleSource,
  type TitleSourcePick,
  type TitleTrendsResult,
  type TitleVideo,
} from "../title-trends";

type WithId<T> = T & { id: string };

const ms = (iso: string | null | undefined) => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : null;
};

/** 레이더 후보 → 제목 영상 (사람이 뺀 것 · AI 가 주제 밖으로 본 것은 뺀다 — 브리핑과 같은 기준) */
export function radarToTitleVideo(r: WithId<RadarDoc>): TitleVideo | null {
  if (r.dismissed || r.ai?.relevant === false || !r.title) return null;
  const pub = ms(r.publishedAt);
  return {
    key: `yt_${r.videoId || r.id}`,
    sources: ["radar"],
    title: r.title,
    channelKey: r.channelId ? `yt_${r.channelId}` : `ch:${r.channel}`,
    channel: r.channel,
    country: "KR",
    at: pub ?? r.firstSeenAt,
    atBasis: pub !== null ? "published" : "collected",
    url: r.url,
    thumbnail: r.thumbnail,
    multiple: r.multiple,
    views: r.views,
  };
}

/** 터진 영상 → 제목 영상 (제외한 것은 뺀다). 감시 채널 id 는 yt_<채널 id> 라 레이더 채널과 맞는다 */
export function hitToTitleVideo(h: WithId<HitDoc>): TitleVideo | null {
  if (h.status === "dismissed" || !h.title) return null;
  const pub = ms(h.publishedAt);
  return {
    key: h.externalId ? `yt_${h.externalId}` : h.id,
    sources: ["hits"],
    title: h.title,
    channelKey: h.watchId ?? `ch:${h.channel}`,
    channel: h.channel,
    country: h.country || "",
    at: pub ?? h.createdAt,
    atBasis: pub !== null ? "published" : "collected",
    url: h.url,
    thumbnail: h.thumbnail,
    multiple: h.multiple,
    views: h.views?.v ?? null,
  };
}

/** 두 자료를 합친다 — 같은 영상은 하나로(출처를 모두 적는다) */
export function mergeTitleVideos(list: (TitleVideo | null)[]): TitleVideo[] {
  const m = new Map<string, TitleVideo>();
  for (const v of list) {
    if (!v) continue;
    const prev = m.get(v.key);
    if (!prev) m.set(v.key, v);
    else m.set(v.key, { ...prev, sources: [...new Set([...prev.sources, ...v.sources])] as TitleSource[], multiple: prev.multiple ?? v.multiple, thumbnail: prev.thumbnail || v.thumbnail, country: prev.country || v.country });
  }
  return [...m.values()];
}

// 낱말 · 주 · 정렬을 바꿀 때마다 같은 목록을 다시 읽지 않게 1분 사본 (프로젝트 · 자료마다). 레이더 · 정찰은 하루 몇 번 바뀐다
const CACHE_MS = 60_000;
const cache = new Map<string, { at: number; list: (TitleVideo | null)[] }>();
async function cachedList(db: Firestore, kind: TitleSource): Promise<(TitleVideo | null)[]> {
  const key = `${currentSpace(db) ?? ""}:${kind}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.list;
  const snap = await db.collection(kind === "radar" ? NEANDER_COL.shortsRadar : NEANDER_COL.shortsHits).get();
  const list = kind === "radar" ? snap.docs.map((d) => radarToTitleVideo({ ...(d.data() as RadarDoc), id: d.id })) : snap.docs.map((d) => hitToTitleVideo({ ...(d.data() as HitDoc), id: d.id }));
  cache.set(key, { at: Date.now(), list });
  return list;
}

const SOURCES: TitleSourcePick[] = ["radar", "hits", "both"];
const isWeek = (v: unknown): v is string => typeof v === "string" && /^\d{4}-W\d{2}$/.test(v);

/**
 * 화면의 「제목 키워드」 한 번 — 자료 · 나라 · 주 · 정렬 · 고른 낱말(최대 5)을 받아 순위 · 추이 · 영상을 돌려준다.
 * 레이더 · 터진 영상 목록은 지금 프로젝트(requestDb)의 것.
 */
export async function titleTrends(db: Firestore, input: Record<string, unknown>, now = Date.now()): Promise<TitleTrendsResult> {
  const source = SOURCES.includes(input.source as TitleSourcePick) ? (input.source as TitleSourcePick) : "both";
  const sort: TitleSort = input.sort === "count" ? "count" : "score";
  const country = typeof input.country === "string" && /^[A-Z]{2}$/.test(input.country) ? input.country : "";
  const [radar, hits] = await Promise.all([source === "hits" ? [] : cachedList(db, "radar"), source === "radar" ? [] : cachedList(db, "hits")]);
  const all = mergeTitleVideos([...radar, ...hits]);
  // 나라 고르기 — 레이더는 한국 상품 쇼츠라 늘 KR
  const countryCount = new Map<string, number>();
  for (const v of all) if (v.country) countryCount.set(v.country, (countryCount.get(v.country) ?? 0) + 1);
  const videos = country ? all.filter((v) => v.country === country) : all;

  const ix = buildTitleIndex(videos, now);
  const thisWeek = isoWeekKey(now);
  const week = isWeek(input.week) && ix.weeks.some((w) => w.key === input.week) ? input.week : defaultTitleWeek(ix.weeks, thisWeek);
  const words = [...new Set((Array.isArray(input.words) ? input.words : []).map((w) => (typeof w === "string" ? normalizeQuery(w.slice(0, 40)) : "")).filter(Boolean))].slice(0, MAX_TITLE_WORDS);
  // 화면이 정렬을 바꿔도 다시 묻지 않게 점수 순 상위 300 (그 주에 채널 2곳 이상 쓴 낱말)
  const rows = titleTrendRows(ix, week, { sort, limit: 300, include: words });
  return {
    source,
    country,
    week,
    thisWeek,
    weeks: ix.weeks,
    baseWeeks: baseWeeksOf(ix.weeks, week).map((w) => w.key),
    countries: [...countryCount.entries()].map(([code, n]) => ({ code, videos: n })).sort((a, b) => b.videos - a.videos),
    sort,
    rows,
    words,
    series: titleWordSeries(ix, words),
    videos: videosWithWords(ix, videos, words, 80),
    totals: {
      videos: videos.length,
      channels: new Set(videos.map((v) => v.channelKey)).size,
      radar: videos.filter((v) => v.sources.includes("radar")).length,
      hits: videos.filter((v) => v.sources.includes("hits")).length,
    },
  };
}
