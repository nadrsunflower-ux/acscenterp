// ============================================================
//  트렌드 노트의 영상 · 사진 — 레퍼런스로 남기기 (시장 트렌드 › 트렌드 노트)
// ------------------------------------------------------------
//  · 영상 = 남의 유튜브 · 인스타 · 틱톡 주소. 파일을 받아 두지 않고 ERP 안에서 바로 본다.
//    넣을 때 읽은 숫자(조회 · 좋아요 · 길이)를 그때 값으로 한 줄 남긴다.
//    유튜브 · 틱톡은 공식 삽입 재생기(iframe). 인스타는 공식 재생기가 릴스를 4:5 칸으로 틀어서, 4:3 · 16:9
//    영상이면 영상이 틀 밖으로 넘치고 「Instagram 에서 더 보기」 띠가 영상 위에 얹힌다(2026-11-04 · 노트 영상
//    15개 중 12개). 그래서 인스타는 공개 삽입 화면이 알려 주는 영상 파일 주소를 볼 때마다 서버가 새로 읽어
//    (주소가 하루 반쯤이면 만료된다) 우리 <video> 로 실제 비율대로 튼다 — instagramMediaOf · server/market.ts.
//    파일 주소가 없으면(음악 저작권이 걸린 게시물) 표지 + 「인스타에서 보기」, 읽기 · 재생이 안 되면 공식 재생기로.
//  · 사진 = 장면 모음 · 캡처. Firebase Storage 버킷이 없어 Firestore 문서 한 장에 원본 + 작은 그림을 같이 둔다
//    (server/market.ts · neander_shorts_note_images). 브라우저가 줄여서 보낸다.
//  순수 함수 · 모양만 둔다 (브라우저 · 서버 공용).
// ============================================================

import { normalizeYoutubeVideoUrl } from "./cuts";

// ---- 영상 ----------------------------------------------------------------------

export type NoteVideoPlatform = "youtube" | "instagram" | "tiktok";
export const NOTE_VIDEO_PLATFORM_LABEL: Record<NoteVideoPlatform, string> = { youtube: "유튜브", instagram: "인스타", tiktok: "틱톡" };

/** 재생기 가로세로 — 유튜브 · 틱톡은 이 비율로 틀을 잡고, 인스타는 재생기가 알려 주는 높이를 쓴다 */
export type NoteVideoAspect = "16:9" | "9:16" | "1:1" | "4:5";
export const NOTE_VIDEO_ASPECTS: NoteVideoAspect[] = ["16:9", "9:16", "1:1", "4:5"];

export interface NoteVideo {
  platform: NoteVideoPlatform;
  /** 유튜브 영상 id · 인스타 게시물 코드 · 틱톡 영상 id */
  id: string;
  /** 정식 원본 주소 */
  url: string;
  /** 짧은 설명 (사람이 고친다) — 처음엔 제목 · 캡션 첫 줄 */
  label: string;
  aspect: NoteVideoAspect;
  /** 넣을 때 읽은 숫자 한 줄 — 나중에 바뀌어도 그때 값이 남게. 못 읽으면 "" */
  stats: string;
  addedAt: number;
}

export const NOTE_VIDEOS_MAX = 12;

export const noteVideoKey = (v: Pick<NoteVideo, "platform" | "id">) => `${v.platform}:${v.id}`;

const IG_CODE = /^[\w-]{5,40}$/;
/** 인스타 게시물 코드 모양 (/p/<코드>/) */
export const isInstagramCode = (v: unknown): v is string => typeof v === "string" && IG_CODE.test(v);
const TT_ID = /^\d{8,25}$/;

function parseUrl(input: unknown): URL | null {
  if (typeof input !== "string") return null;
  const s = input.trim();
  if (!s || /\s/.test(s) || s.length > 600) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    if ((u.protocol !== "https:" && u.protocol !== "http:") || u.username || u.password) return null;
    return u;
  } catch {
    return null;
  }
}

/** 틱톡 짧은 주소(vt.tiktok.com · vm.tiktok.com) — 서버가 한 번 따라가 전체 주소를 얻는다 */
export function isTiktokShortUrl(input: unknown): boolean {
  const u = parseUrl(input);
  return !!u && /^(vt|vm)\.tiktok\.com$/i.test(u.hostname);
}

/**
 * 주소 → 영상 하나. 유튜브(watch · shorts · youtu.be · embed) · 인스타(/p · /reel · /reels · /tv, 계정/p/코드 포함) ·
 * 틱톡(/@계정/video/숫자 · embed · player). 채널 · 계정 · 재생목록 주소는 null.
 */
export function parseNoteVideoUrl(input: unknown): Pick<NoteVideo, "platform" | "id" | "url" | "aspect"> | null {
  const u = parseUrl(input);
  if (!u) return null;
  const host = u.hostname.toLowerCase().replace(/^(www|m)\./, "");
  const parts = u.pathname.split("/").filter(Boolean);
  if (host === "youtube.com" || host === "youtu.be" || host === "youtube-nocookie.com") {
    const yt = normalizeYoutubeVideoUrl(u.toString());
    if (!yt) return null;
    return { platform: "youtube", id: yt.videoId, url: yt.url, aspect: parts[0] === "shorts" ? "9:16" : "16:9" };
  }
  if (host === "instagram.com") {
    const at = parts.findIndex((p) => p === "p" || p === "reel" || p === "reels" || p === "tv");
    // 맨 앞(/p/코드) 이나 계정 다음(/계정/p/코드) 만
    if (at < 0 || at > 1) return null;
    const code = parts[at + 1];
    if (!code || !IG_CODE.test(code)) return null;
    const reel = parts[at] === "reel" || parts[at] === "reels";
    return { platform: "instagram", id: code, url: `https://www.instagram.com/${reel ? "reel" : "p"}/${code}/`, aspect: reel ? "9:16" : "4:5" };
  }
  if (host === "tiktok.com") {
    let id: string | undefined;
    const v = parts.indexOf("video");
    if (v === 1 && parts[0].startsWith("@")) id = parts[2];
    else if (parts[0] === "embed" && parts[1] === "v2") id = parts[2];
    else if (parts[0] === "embed") id = parts[1];
    else if (parts[0] === "player" && parts[1] === "v1") id = parts[2];
    if (!id || !TT_ID.test(id)) return null;
    // 계정을 모르면(삽입 주소) 틱톡의 공개 삽입 화면을 원본 주소로 둔다
    const url = parts[0].startsWith("@") && /^@[\w.]{1,40}$/.test(parts[0]) ? `https://www.tiktok.com/${parts[0]}/video/${id}` : `https://www.tiktok.com/embed/v2/${id}`;
    return { platform: "tiktok", id, url, aspect: "9:16" };
  }
  return null;
}

/** ERP 안 재생기 주소 — 각 플랫폼의 공식 삽입 주소 */
export function noteVideoEmbedUrl(v: Pick<NoteVideo, "platform" | "id">): string {
  if (v.platform === "youtube") return `https://www.youtube-nocookie.com/embed/${v.id}?rel=0&playsinline=1&modestbranding=1`;
  if (v.platform === "instagram") return `https://www.instagram.com/p/${v.id}/embed/`;
  return `https://www.tiktok.com/player/v1/${v.id}?rel=0&description=1&music_info=1`;
}

/** 이 재생기가 보내는 높이 알림을 믿을 출처 */
export const INSTAGRAM_ORIGIN = "https://www.instagram.com";

/**
 * 인스타 재생기의 높이 알림 — {"type":"MEASURE","details":{"height":708}} (문자열로 온다).
 * 다른 모양이면 null. 높이는 200~3000px 만 받는다.
 */
export function instagramMeasure(data: unknown): number | null {
  let o: unknown = data;
  if (typeof data === "string") {
    if (data.length > 2000) return null;
    try {
      o = JSON.parse(data);
    } catch {
      return null;
    }
  }
  const r = o as { type?: unknown; details?: { height?: unknown } } | null;
  if (!r || r.type !== "MEASURE") return null;
  const h = Number(r.details?.height);
  return Number.isFinite(h) && h >= 200 && h <= 3000 ? Math.round(h) : null;
}

/** 원본 크기 → 재생기 비율 (가장 가까운 것) */
export function aspectOf(width: number, height: number): NoteVideoAspect | null {
  if (!(width > 0) || !(height > 0)) return null;
  const r = width / height;
  const cands: [NoteVideoAspect, number][] = [
    ["16:9", 16 / 9],
    ["1:1", 1],
    ["4:5", 4 / 5],
    ["9:16", 9 / 16],
  ];
  return cands.sort((a, b) => Math.abs(Math.log(r / a[1])) - Math.abs(Math.log(r / b[1])))[0][0];
}

/** 비율 → 높이/너비 */
export const aspectRatio = (a: NoteVideoAspect) => ({ "16:9": 9 / 16, "9:16": 16 / 9, "1:1": 1, "4:5": 5 / 4 })[a];

const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

/**
 * 사람이 고친 목록 다듬기 — 순서 · 설명 · 비율만 바꾼다. 빠진 것은 지운 것(영상은 원본이 남의 것이라 지울 파일이 없다).
 * 새 영상은 여기서 만들지 않는다 (넣기는 서버의 note.video.add — 숫자를 읽어 둔다).
 */
export function editNoteVideos(raw: unknown, prev: NoteVideo[]): NoteVideo[] {
  if (!Array.isArray(raw)) return prev;
  const byKey = new Map(prev.map((v) => [noteVideoKey(v), v]));
  const out: NoteVideo[] = [];
  const seen = new Set<string>();
  for (const x of raw.slice(0, NOTE_VIDEOS_MAX * 2)) {
    const r = (x ?? {}) as Record<string, unknown>;
    const key = `${String(r.platform)}:${String(r.id)}`;
    const old = byKey.get(key);
    if (!old || seen.has(key)) continue;
    seen.add(key);
    out.push({
      ...old,
      label: "label" in r ? str(r.label, 120) : old.label,
      aspect: NOTE_VIDEO_ASPECTS.includes(r.aspect as NoteVideoAspect) ? (r.aspect as NoteVideoAspect) : old.aspect,
    });
  }
  return out;
}

// ---- 숫자 한 줄 -------------------------------------------------------------------

const n = (v: number) => Math.round(v).toLocaleString("ko-KR");
const dur = (sec: number) => {
  const s = Math.round(sec);
  return s >= 60 ? `${Math.floor(s / 60)}분 ${String(s % 60).padStart(2, "0")}초` : `${s}초`;
};
const ymd = (ms: number) => new Date(ms + 9 * 3600_000).toISOString().slice(0, 10);

export interface VideoNumbers {
  views?: number | null;
  likes?: number | null;
  comments?: number | null;
  durationSec?: number | null;
  publishedAt?: number | null;
  by?: string | null;
}

/** 「조회 2,382,125 · 좋아요 90,788 · 댓글 310 · 1분 32초 · 2026-10-08 올림 · @swayroom_studio」 — 모르는 칸은 뺀다 */
export function videoStatsLine(x: VideoNumbers): string {
  const parts = [
    x.views != null && x.views >= 0 ? `조회 ${n(x.views)}` : "",
    x.likes != null && x.likes >= 0 ? `좋아요 ${n(x.likes)}` : "",
    x.comments != null && x.comments >= 0 ? `댓글 ${n(x.comments)}` : "",
    x.durationSec != null && x.durationSec > 0 ? dur(x.durationSec) : "",
    x.publishedAt != null && x.publishedAt > 0 ? `${ymd(x.publishedAt)} 올림` : "",
    x.by ? x.by : "",
  ].filter(Boolean);
  return parts.join(" · ").slice(0, 300);
}

// ---- 인스타 삽입 화면에서 숫자 읽기 -----------------------------------------------------

export interface InstagramEmbedMeta extends VideoNumbers {
  caption: string;
  width: number | null;
  height: number | null;
  username: string | null;
  /** 영상 파일 주소 (인스타 CDN · 서명이 붙어 만료된다). 음악 저작권이 걸린 게시물 · 사진은 null */
  videoUrl: string | null;
  /** 표지 그림 주소 (인스타 CDN) */
  poster: string | null;
}

/** 볼 때 받는 인스타 영상 — 서버가 공개 삽입 화면에서 새로 읽은 것 (저장하지 않는다) */
export interface InstagramMedia {
  /** 영상 파일 — 없으면 인스타에서만 재생된다 */
  src: string | null;
  poster: string | null;
  /** 이 주소들을 믿어도 되는 때 (ms) — 지나면 다시 받는다 */
  expiresAt: number;
}

/** 인스타 CDN 주소만 받는다 — 화면의 <video> · <img> 에 그대로 넣는 값이라 다른 곳 주소는 버린다 */
export function instagramCdnUrl(v: unknown): string | null {
  if (typeof v !== "string" || v.length > 4000) return null;
  try {
    const u = new URL(v);
    if (u.protocol !== "https:" || u.username || u.password) return null;
    return /(^|\.)(cdninstagram\.com|fbcdn\.net)$/i.test(u.hostname) ? u.toString() : null;
  } catch {
    return null;
  }
}

/** 서명 주소의 만료 시각 — oe=<16진 초>. 모르면 null */
export function instagramUrlExpiry(url: string | null): number | null {
  if (!url) return null;
  try {
    const oe = new URL(url).searchParams.get("oe");
    if (!oe || !/^[0-9a-f]{6,10}$/i.test(oe)) return null;
    return parseInt(oe, 16) * 1000;
  } catch {
    return null;
  }
}

/** 서버가 들고 있을 때까지 — 파일 주소 만료 30분 전, 길어도 6시간. 파일이 없으면 30분 뒤 다시 본다 */
export function instagramMediaUntil(m: Pick<InstagramMedia, "src" | "poster">, now: number): number {
  const max = now + 6 * 3600_000;
  if (!m.src) return now + 30 * 60_000;
  const exp = instagramUrlExpiry(m.src);
  return exp ? Math.max(now + 60_000, Math.min(max, exp - 30 * 60_000)) : now + 3600_000;
}

/** 우리 재생기의 칸 — 높이/너비. 인스타처럼 세로는 4:5 까지만 (9:16 은 양옆이 검게) */
export const playerBoxRatio = (videoWidth: number, videoHeight: number) => (videoWidth > 0 && videoHeight > 0 ? Math.min(videoHeight / videoWidth, 5 / 4) : 5 / 4);

/** from 에서 앞(-1) · 뒤(1) 로 가며 역슬래시로 감싸지 않은 따옴표 자리 */
function bareQuote(s: string, from: number, dir: -1 | 1): number {
  let p = from;
  for (;;) {
    p = dir < 0 ? s.lastIndexOf('"', p - 1) : s.indexOf('"', p + 1);
    if (p < 0) return -1;
    let k = p - 1;
    let bs = 0;
    while (k >= 0 && s[k] === "\\") {
      bs++;
      k--;
    }
    if (bs % 2 === 0) return p;
  }
}

type IgMedia = {
  shortcode?: string;
  video_view_count?: number;
  video_play_count?: number;
  video_duration?: number;
  taken_at_timestamp?: number;
  dimensions?: { width?: number; height?: number };
  is_video?: boolean;
  video_url?: string;
  display_url?: string;
  thumbnail_src?: string;
  owner?: { username?: string };
  edge_liked_by?: { count?: number };
  edge_media_preview_like?: { count?: number };
  edge_media_to_comment?: { count?: number };
  edge_media_to_caption?: { edges?: { node?: { text?: string } }[] };
};

function findMedia(o: unknown, depth = 0): IgMedia | null {
  if (!o || typeof o !== "object" || depth > 40) return null;
  const r = o as Record<string, unknown>;
  if (r.shortcode_media && typeof r.shortcode_media === "object") return r.shortcode_media as IgMedia;
  if ("shortcode" in r && ("video_view_count" in r || "edge_liked_by" in r)) return r as IgMedia;
  for (const v of Object.values(r)) {
    const m = findMedia(v, depth + 1);
    if (m) return m;
  }
  return null;
}

const count = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);

/**
 * 인스타 공개 삽입 화면(/p/<코드>/embed/captioned/) 글에서 숫자를 읽는다 — 자료는 스크립트 안의 「JSON 을 담은 글」
 * 이다. 그 글을 찾아 두 번 풀어 shortcode_media 를 읽는다. 로그인 화면이 오거나 모양이 바뀌면 null(지어내지 않는다).
 */
export function parseInstagramEmbed(html: string): InstagramEmbedMeta | null {
  if (typeof html !== "string") return null;
  const at = html.indexOf("shortcode_media");
  if (at < 0) return null;
  const a = bareQuote(html, at, -1);
  const b = bareQuote(html, at, 1);
  if (a < 0 || b < 0) return null;
  let m: IgMedia | null = null;
  try {
    const inner = JSON.parse(html.slice(a, b + 1)) as unknown;
    m = findMedia(typeof inner === "string" ? JSON.parse(inner) : inner);
  } catch {
    return null;
  }
  if (!m) return null;
  const caption = m.edge_media_to_caption?.edges?.[0]?.node?.text ?? "";
  const user = m.owner?.username && /^[\w.]{1,40}$/.test(m.owner.username) ? m.owner.username : null;
  const out: InstagramEmbedMeta = {
    views: count(m.video_view_count) ?? count(m.video_play_count),
    likes: count(m.edge_liked_by?.count) ?? count(m.edge_media_preview_like?.count),
    comments: count(m.edge_media_to_comment?.count),
    durationSec: count(m.video_duration),
    publishedAt: count(m.taken_at_timestamp) ? m.taken_at_timestamp! * 1000 : null,
    caption: typeof caption === "string" ? caption.slice(0, 2000) : "",
    width: count(m.dimensions?.width),
    height: count(m.dimensions?.height),
    username: user,
    videoUrl: instagramCdnUrl(m.video_url),
    poster: instagramCdnUrl(m.display_url) ?? instagramCdnUrl(m.thumbnail_src),
  };
  if (out.views === null && out.likes === null && out.comments === null && !out.caption && !out.username) return null;
  return out;
}

/** 캡션 첫 줄 — 해시태그만 있는 줄은 건너뛴다 */
export function captionTitle(caption: string, max = 60): string {
  const line = caption
    .split("\n")
    .map((l) => l.replace(/#[^\s#]+/g, "").trim())
    .find((l) => l.length > 0);
  return (line ?? "").slice(0, max);
}

// ---- 사진 ------------------------------------------------------------------------

export interface NoteImage {
  id: string;
  name: string;
  type: NoteImageType;
  w: number;
  h: number;
  /** 원본 바이트 */
  size: number;
  caption: string;
  at: number;
  by: string;
}

export type NoteImageType = "image/jpeg" | "image/png" | "image/webp";
export const NOTE_IMAGE_TYPES: NoteImageType[] = ["image/jpeg", "image/png", "image/webp"];
export const NOTE_IMAGES_MAX = 20;
/** 원본 한 장 상한 — 작은 그림 · 필드 이름까지 Firestore 문서 1MB 안에 들게 */
export const NOTE_IMAGE_MAX_BYTES = 850 * 1024;
export const NOTE_THUMB_MAX_BYTES = 60 * 1024;
/** 브라우저가 줄일 긴 변 */
export const NOTE_IMAGE_LONG_SIDE = 2400;
export const NOTE_THUMB_LONG_SIDE = 480;

/** 바이트 첫머리로 형식 확인 — 브라우저가 적은 형식을 그대로 믿지 않는다 */
export function sniffImageType(b: Uint8Array): NoteImageType | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "image/png";
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  return null;
}

/**
 * 사람이 고친 사진 목록 — 순서 · 설명만. 빠진 사진은 그대로 뒤에 남긴다
 * (원본 지우기는 note.image.delete 로만 — 목록만 빠지고 원본이 남는 일이 없게).
 */
export function editNoteImages(raw: unknown, prev: NoteImage[]): NoteImage[] {
  if (!Array.isArray(raw)) return prev;
  const byId = new Map(prev.map((x) => [x.id, x]));
  const out: NoteImage[] = [];
  for (const x of raw.slice(0, NOTE_IMAGES_MAX * 2)) {
    const r = (x ?? {}) as Record<string, unknown>;
    const old = typeof r.id === "string" ? byId.get(r.id) : undefined;
    if (!old || out.some((y) => y.id === old.id)) continue;
    out.push({ ...old, caption: "caption" in r ? str(r.caption, 200) : old.caption });
  }
  for (const x of prev) if (!out.some((y) => y.id === x.id)) out.push(x);
  return out;
}
