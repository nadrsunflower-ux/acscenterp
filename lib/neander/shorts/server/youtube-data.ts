import "server-only";

// ============================================================
//  YouTube Data API v3 — 공개 영상 검색 · 통계 · 댓글 (서버 키, 읽기 전용)
// ------------------------------------------------------------
//  키: NEANDER_SHORTS_YOUTUBE_API_KEY (Google Cloud 의 API 키, 서버에만).
//
//  한도 (2026-06-01 개편, developers.google.com/youtube/v3/determine_quota_cost):
//    search.list 는 따로 하루 100회 · videos.list 는 1단위.
//  그래서 검색은 계수기(store.takeQuota)로 하루 90회에서 멈춘다.
//
//  ⚠️ 검색 결과는 「표본」 이다. regionCode · relevanceLanguage 는 관련도를
//     기울일 뿐 그 나라의 전체 시장이 아니고, videoDuration=short 는 4분
//     미만일 뿐 Shorts 라는 보장이 아니다. 화면이 그렇게 말한다.
// ============================================================

import type { Fetcher } from "./platforms";

let fetcher: Fetcher = (...a) => fetch(...a);
export const setYoutubeDataFetch = (f: Fetcher | null) => {
  fetcher = f ?? ((...a) => fetch(...a));
};

/** 회사 키 (서버 환경변수). 사람마다 개인 키를 둘 수 있다 — 부르는 쪽이 key 를 넘긴다 (profiles.ts) */
export const youtubeApiKey = () => process.env.NEANDER_SHORTS_YOUTUBE_API_KEY?.trim() ?? "";

export const YT_SEARCH_DAILY_LIMIT = 90;

export interface YoutubeSearchItem {
  id: string;
  url: string;
  title: string;
  channel: string;
  publishedAt: string;
  duration: number;
  views: number | null;
  likes: number | null;
  comments: number | null;
  thumbnail: string;
}

function ytError(status: number, payload: unknown, label: string): Error {
  const reason = JSON.stringify((payload as { error?: unknown })?.error ?? "").toLowerCase();
  if (status === 403 && reason.includes("quota")) return new Error(`${label}: 오늘 YouTube API 한도를 다 썼습니다. 내일 다시 해 주세요.`);
  if (status === 403 && (reason.includes("accessnotconfigured") || reason.includes("service_disabled")))
    return new Error(`${label}: Google Cloud 에서 YouTube Data API v3 를 켜야 합니다.`);
  if (status === 400 || status === 403) return new Error(`${label}: API 키 또는 요청을 확인해 주세요 (HTTP ${status}).`);
  return new Error(`${label}이(가) 실패했습니다 (HTTP ${status}).`);
}

async function getJson<T>(url: string, label: string): Promise<T> {
  let res: Response;
  try {
    res = await fetcher(url, { cache: "no-store", signal: AbortSignal.timeout(20_000) });
  } catch {
    throw new Error(`${label}: YouTube 에 연결하지 못했습니다.`);
  }
  const payload = await res.json().catch(() => null);
  if (!res.ok) throw ytError(res.status, payload, label);
  return payload as T;
}

const isoDuration = (v: string) => {
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(v);
  return m ? Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0) : 0;
};
const countOf = (v: unknown) => (v === undefined || v === null ? null : Number.isFinite(Number(v)) ? Number(v) : null);

type VideoRes = {
  id?: string;
  snippet?: { title?: string; channelTitle?: string; publishedAt?: string; thumbnails?: Record<string, { url?: string }> };
  statistics?: Record<string, unknown>;
  contentDetails?: { duration?: string };
};

/** 영상 id 들의 공개 통계 (1단위) — 소재 저장 · 다시 모으기 */
export async function youtubeVideos(ids: string[], apiKey?: string): Promise<YoutubeSearchItem[]> {
  const key = apiKey || youtubeApiKey();
  if (!key) throw new Error("YouTube 검색 키가 없습니다 — 내 채널·연결에서 개인 키를 넣거나 회사 키(NEANDER_SHORTS_YOUTUBE_API_KEY)를 설정해 주세요.");
  const clean = [...new Set(ids.filter((id) => /^[\w-]{11}$/.test(id)))].slice(0, 50);
  if (!clean.length) return [];
  const q = new URLSearchParams({ key, part: "snippet,statistics,contentDetails", id: clean.join(",") });
  const data = await getJson<{ items?: VideoRes[] }>(`https://www.googleapis.com/youtube/v3/videos?${q}`, "YouTube 통계");
  return (data.items ?? []).flatMap((v) => {
    if (!v.id) return [];
    const s = v.snippet ?? {};
    return [
      {
        id: v.id,
        url: `https://www.youtube.com/watch?v=${v.id}`,
        title: s.title ?? "",
        channel: s.channelTitle ?? "",
        publishedAt: s.publishedAt ?? "",
        duration: isoDuration(v.contentDetails?.duration ?? ""),
        // 숨긴 좋아요 · 꺼진 댓글은 필드가 없다 — 0 이 아니라 null
        views: countOf(v.statistics?.viewCount),
        likes: countOf(v.statistics?.likeCount),
        comments: countOf(v.statistics?.commentCount),
        thumbnail: s.thumbnails?.medium?.url ?? s.thumbnails?.high?.url ?? `https://i.ytimg.com/vi/${v.id}/mqdefault.jpg`,
      },
    ];
  });
}

/**
 * 검색 표본 (search.list 1회 + videos.list 1회). 최근 days 일 · 4분 미만 · 조회수 순.
 */
export async function youtubeSearch(input: { query: string; regionCode: string; language: string; days: number; max: number }, apiKey?: string): Promise<YoutubeSearchItem[]> {
  const key = apiKey || youtubeApiKey();
  if (!key) throw new Error("YouTube 검색 키가 없습니다 — 내 채널·연결에서 개인 키를 넣거나 회사 키(NEANDER_SHORTS_YOUTUBE_API_KEY)를 설정해 주세요.");
  const q = input.query.trim().slice(0, 200);
  if (!q) throw new Error("검색어를 입력해 주세요.");
  const params = new URLSearchParams({
    key,
    part: "snippet",
    type: "video",
    q,
    videoDuration: "short",
    order: "viewCount",
    maxResults: String(Math.min(50, Math.max(5, input.max))),
    publishedAfter: new Date(Date.now() - Math.min(365, Math.max(1, input.days)) * 86_400_000).toISOString(),
    regionCode: /^[A-Z]{2}$/.test(input.regionCode) ? input.regionCode : "KR",
    relevanceLanguage: /^[a-z]{2}$/.test(input.language) ? input.language : "ko",
    safeSearch: "moderate",
  });
  const search = await getJson<{ items?: { id?: { videoId?: string } }[] }>(`https://www.googleapis.com/youtube/v3/search?${params}`, "YouTube 검색");
  const ids = (search.items ?? []).map((i) => i.id?.videoId).filter((id): id is string => !!id);
  const items = await youtubeVideos(ids, key);
  return items.sort((a, b) => (b.views ?? 0) - (a.views ?? 0));
}

/** 공개 영상의 최근 댓글 (최대 100개) — 정보 요청 표본용 */
export async function youtubeCommentSample(videoId: string, max = 100, apiKey?: string): Promise<string[]> {
  const key = apiKey || youtubeApiKey();
  if (!key) throw new Error("YouTube 검색 키가 없습니다 — 내 채널·연결에서 개인 키를 넣거나 회사 키(NEANDER_SHORTS_YOUTUBE_API_KEY)를 설정해 주세요.");
  if (!/^[\w-]{11}$/.test(videoId)) throw new Error("YouTube 영상 id 가 올바르지 않습니다.");
  const q = new URLSearchParams({ key, part: "snippet", videoId, maxResults: String(Math.min(100, max)), textFormat: "plainText", order: "relevance" });
  const data = await getJson<{ items?: { snippet?: { topLevelComment?: { snippet?: { textDisplay?: string } } } }[] }>(
    `https://www.googleapis.com/youtube/v3/commentThreads?${q}`,
    "YouTube 댓글",
  );
  return (data.items ?? []).map((i) => i.snippet?.topLevelComment?.snippet?.textDisplay ?? "").filter(Boolean);
}

// ---- 바이럴 형식 정찰 (감시 채널) -----------------------------------------
//  채널 정보 channels.list · 최근 업로드 playlistItems.list · 영상 통계 videos.list — 모두 1단위.
//  search.list(하루 100회) 는 「채널 찾기」 에서만 쓴다.

export interface YoutubeChannelInfo {
  channelId: string;
  handle: string;
  title: string;
  thumbnail: string;
  /** 채널이 밝힌 나라 — 비어 있는 일이 많다 */
  country: string;
  language: string;
  subscribers: number | null;
}

type ChannelRes = {
  id?: string;
  snippet?: { title?: string; customUrl?: string; country?: string; defaultLanguage?: string; thumbnails?: Record<string, { url?: string }> };
  statistics?: { subscriberCount?: string; hiddenSubscriberCount?: boolean };
};

const channelInfo = (c: ChannelRes): YoutubeChannelInfo | null =>
  c.id
    ? {
        channelId: c.id,
        handle: c.snippet?.customUrl ?? "",
        title: c.snippet?.title ?? "",
        thumbnail: c.snippet?.thumbnails?.default?.url ?? c.snippet?.thumbnails?.medium?.url ?? "",
        country: (c.snippet?.country ?? "").toUpperCase().slice(0, 2),
        language: (c.snippet?.defaultLanguage ?? "").slice(0, 5),
        // 구독자 수를 숨긴 채널은 0 이 아니라 모름
        subscribers: c.statistics?.hiddenSubscriberCount ? null : countOf(c.statistics?.subscriberCount),
      }
    : null;

const needKey = (apiKey?: string) => {
  const key = apiKey || youtubeApiKey();
  if (!key) throw new Error("YouTube 검색 키가 없습니다 — 내 채널·연결에서 개인 키를 넣거나 회사 키(NEANDER_SHORTS_YOUTUBE_API_KEY)를 설정해 주세요.");
  return key;
};

/** 채널 id 들의 정보 (1단위 · 최대 50개) */
export async function youtubeChannels(ids: string[], apiKey?: string): Promise<YoutubeChannelInfo[]> {
  const key = needKey(apiKey);
  const clean = [...new Set(ids.filter((id) => /^UC[\w-]{22}$/.test(id)))].slice(0, 50);
  if (!clean.length) return [];
  const q = new URLSearchParams({ key, part: "snippet,statistics", id: clean.join(",") });
  const data = await getJson<{ items?: ChannelRes[] }>(`https://www.googleapis.com/youtube/v3/channels?${q}`, "YouTube 채널");
  return (data.items ?? []).flatMap((c) => channelInfo(c) ?? []);
}

/** @핸들 · 채널 id · 영상 id 로 채널 하나 (1~2단위) */
export async function youtubeChannelOf(ref: { kind: "handle" | "channel" | "video"; value: string }, apiKey?: string): Promise<YoutubeChannelInfo | null> {
  const key = needKey(apiKey);
  if (ref.kind === "channel") return (await youtubeChannels([ref.value], key))[0] ?? null;
  if (ref.kind === "handle") {
    const q = new URLSearchParams({ key, part: "snippet,statistics", forHandle: ref.value });
    const data = await getJson<{ items?: ChannelRes[] }>(`https://www.googleapis.com/youtube/v3/channels?${q}`, "YouTube 채널");
    return data.items?.[0] ? channelInfo(data.items[0]) : null;
  }
  const q = new URLSearchParams({ key, part: "snippet", id: ref.value });
  const data = await getJson<{ items?: { snippet?: { channelId?: string } }[] }>(`https://www.googleapis.com/youtube/v3/videos?${q}`, "YouTube 영상");
  const channelId = data.items?.[0]?.snippet?.channelId;
  return channelId ? (await youtubeChannels([channelId], key))[0] ?? null : null;
}

/** 채널의 최근 업로드 (1단위 · 최대 50개). 업로드 재생목록 id 는 채널 id 의 UC → UU */
export async function youtubeRecentUploads(channelId: string, apiKey?: string): Promise<{ id: string; publishedAt: string }[]> {
  const key = needKey(apiKey);
  if (!/^UC[\w-]{22}$/.test(channelId)) throw new Error("YouTube 채널 id 가 올바르지 않습니다.");
  const q = new URLSearchParams({ key, part: "contentDetails", playlistId: `UU${channelId.slice(2)}`, maxResults: "50" });
  const data = await getJson<{ items?: { contentDetails?: { videoId?: string; videoPublishedAt?: string } }[] }>(
    `https://www.googleapis.com/youtube/v3/playlistItems?${q}`,
    "YouTube 업로드 목록",
  );
  return (data.items ?? []).flatMap((i) => (i.contentDetails?.videoId ? [{ id: i.contentDetails.videoId, publishedAt: i.contentDetails.videoPublishedAt ?? "" }] : []));
}

/** 채널 찾기 — 검색 표본(search 1회 + videos 1회 + channels 1회)을 채널별로 묶는다 */
export async function youtubeDiscoverChannels(
  input: { query: string; regionCode: string; language: string; days: number },
  apiKey?: string,
): Promise<{ channel: YoutubeChannelInfo; videos: YoutubeSearchItem[] }[]> {
  const key = needKey(apiKey);
  const q = input.query.trim().slice(0, 200);
  if (!q) throw new Error("검색어를 입력해 주세요.");
  const params = new URLSearchParams({
    key,
    part: "snippet",
    type: "video",
    q,
    videoDuration: "short",
    order: "viewCount",
    maxResults: "50",
    publishedAfter: new Date(Date.now() - Math.min(90, Math.max(1, input.days)) * 86_400_000).toISOString(),
    regionCode: /^[A-Z]{2}$/.test(input.regionCode) ? input.regionCode : "US",
    relevanceLanguage: /^[a-z]{2}$/.test(input.language) ? input.language : "en",
    safeSearch: "moderate",
  });
  const search = await getJson<{ items?: { id?: { videoId?: string }; snippet?: { channelId?: string } }[] }>(`https://www.googleapis.com/youtube/v3/search?${params}`, "YouTube 검색");
  const owner = new Map<string, string>();
  for (const i of search.items ?? []) if (i.id?.videoId && i.snippet?.channelId) owner.set(i.id.videoId, i.snippet.channelId);
  const videos = await youtubeVideos([...owner.keys()], key);
  const channels = await youtubeChannels([...new Set(owner.values())], key);
  return channels
    .map((channel) => ({ channel, videos: videos.filter((v) => owner.get(v.id) === channel.channelId).sort((a, b) => (b.views ?? 0) - (a.views ?? 0)) }))
    .filter((g) => g.videos.length > 0)
    .sort((a, b) => (b.videos[0].views ?? 0) - (a.videos[0].views ?? 0));
}
