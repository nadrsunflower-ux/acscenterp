// ============================================================
//  밖에서 올린 게시물 자동 연결 — 순수 함수 (server/external.ts 가 쓴다)
// ------------------------------------------------------------
//  YouTube Studio · 인스타 앱에서 직접 올린 게시물을 찾아 ERP 의 「영상」 에 붙인다.
//  붙인 게시 기록(origin: "external")은 ERP 가 올린 것과 똑같이 게시 현황 · 성과 수집 ·
//  성과 비교에 들어간다.
//
//  같은 영상을 두 플랫폼에 올리는 일이 많다 — 다른 플랫폼에 이미 게시된 영상 중
//  올린 때가 가깝고(72시간 안) 글(제목 · 설명 · 캡션)이 비슷하면 그 영상에 붙인다.
//  틀리게 붙으면 게시 현황에서 「다른 영상에 붙이기」 로 옮긴다.
// ============================================================

import type { PublishPlatform } from "./types";

export const PAIR_WINDOW_MS = 72 * 3600_000;
/**
 * 후보가 하나뿐이고 이만큼 가까우면 글로 못 가려도 같은 영상으로 본다 — 같은 영상은 보통 몇 시간 안에
 * 두 플랫폼에 올린다. 넓히면 따로 올린 다른 영상(하루 전 유튜브만 올린 2화 등)에 잘못 붙는다.
 */
export const PAIR_NEAR_MS = 6 * 3600_000;
/** 그때도 글이 이만큼은 겹쳐야 한다 (글이 짧아 잴 수 없으면 시간만 본다) — 다른 영상은 0.2 안팎 */
export const PAIR_NEAR_MIN_SIMILARITY = 0.3;
/**
 * 글 겹침(짧은 쪽이 긴 쪽에 얼마나 들어 있나) 기준.
 * 실측(1화 문구): 같은 영상의 유튜브 제목 vs 인스타 캡션 0.75 · 같은 시리즈 다른 회차 0.42~0.65
 * (「다이소 · 정리템 · 합쳐 · 천 원」 같은 채널 말버릇이 겹친다)
 */
export const PAIR_MIN_SIMILARITY = 0.7;
/** 짧은 쪽 글자 묶음이 이보다 적으면 겹침을 믿지 않는다 (「다이소 꿀템」 한 줄이면 어디에나 들어 있다) */
const MIN_BIGRAMS = 8;

export interface ExternalPost {
  externalId: string;
  url: string;
  title: string;
  caption: string;
  publishedAt: number;
  thumbnail: string;
  durationSec: number | null;
  privacy: string;
  mediaType: string;
}

/** 연결할 게시물인가 — YouTube 는 공개된 것만(비공개 · 예약 · 일부 공개는 공개되면 그때), Instagram 은 영상(릴스)만 */
export function isImportablePost(platform: PublishPlatform, p: ExternalPost): boolean {
  if (!p.externalId || !p.publishedAt) return false;
  if (platform === "youtube") return p.privacy === "public";
  return p.mediaType === "REELS" || p.mediaType === "VIDEO";
}

/** 게시 기록 문서 id — 같은 계정의 같은 게시물은 한 번만 */
export const externalPublicationId = (accountId: string, externalId: string) => `ext_${accountId}_${externalId}`.replace(/[^\w-]/g, "_").slice(0, 150);

/** 해시태그 · 주소 · 기호를 걷어 낸 글 (비교용) */
export function normalizePostText(s: string): string {
  return s
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/#/g, " ")
    .replace(/[^0-9a-z가-힣]+/g, " ")
    .trim();
}

function bigrams(s: string): Set<string> {
  const out = new Set<string>();
  for (const w of normalizePostText(s).split(" ")) {
    if (w.length === 1) out.add(w);
    for (let i = 0; i + 1 < w.length; i++) out.add(w.slice(i, i + 2));
  }
  return out;
}

/** 두 글의 겹침 (짧은 쪽 글자 묶음 중 긴 쪽에도 있는 비율) — 짧은 쪽이 너무 짧아 잴 수 없으면 null */
function textOverlap(a: string, b: string): number | null {
  const x = bigrams(a);
  const y = bigrams(b);
  const [small, big] = x.size <= y.size ? [x, y] : [y, x];
  if (small.size < MIN_BIGRAMS) return null;
  let both = 0;
  for (const g of small) if (big.has(g)) both++;
  return both / small.size;
}

/**
 * 두 글이 얼마나 겹치나 (0~1) — 짧은 쪽 글자 묶음(두 글자씩) 중 긴 쪽에도 있는 비율.
 * 유튜브는 제목만, 인스타는 긴 캡션처럼 길이가 달라도 같은 영상이면 높게 나온다. 짧은 쪽이 너무 짧으면 0.
 */
export const postTextSimilarity = (a: string, b: string): number => textOverlap(a, b) ?? 0;

export interface PairCandidate {
  publicationId: string;
  projectId: string;
  platform: PublishPlatform;
  /** 그 게시물이 올라간 시각 */
  at: number;
  /** 제목 + 설명/캡션 */
  text: string;
  /** 같은 확인에서 함께 찾아 아직 붙이지 않은 게시물 — 이게 짝이면 지금은 새 영상을 만들고 그쪽이 나중에 붙는다 */
  pending?: boolean;
}

/**
 * 같은 영상의 다른 플랫폼 게시물 고르기 — 없으면 null.
 * 후보는 부르는 쪽이 「이 플랫폼 게시가 아직 없는 영상」 으로 걸러 넘긴다.
 */
export function pickPartner(
  platform: PublishPlatform,
  post: Pick<ExternalPost, "publishedAt" | "title" | "caption">,
  candidates: PairCandidate[],
): { candidate: PairCandidate; similarity: number } | null {
  const text = `${post.title}\n${post.caption}`;
  const near = candidates
    .filter((c) => c.platform !== platform && Math.abs(c.at - post.publishedAt) <= PAIR_WINDOW_MS)
    .map((c) => {
      const overlap = textOverlap(text, c.text);
      return { candidate: c, overlap, similarity: overlap ?? 0, gap: Math.abs(c.at - post.publishedAt) };
    })
    .sort((a, b) => b.similarity - a.similarity || a.gap - b.gap);
  if (!near.length) return null;
  const best = near[0];
  if (best.similarity >= PAIR_MIN_SIMILARITY) return { candidate: best.candidate, similarity: best.similarity };
  // 글로 못 가려도 — 72시간 안의 후보가 딱 하나이고 몇 시간 안이며 글이 확실히 다르지는 않으면 같은 영상
  if (near.length === 1 && best.gap <= PAIR_NEAR_MS && (best.overlap === null || best.overlap >= PAIR_NEAR_MIN_SIMILARITY)) return { candidate: best.candidate, similarity: best.similarity };
  return null;
}

/** 새로 만들 영상의 이름 — YouTube 는 제목, Instagram 은 캡션 첫 줄(해시태그 뺌) */
export function externalProjectTitle(platform: PublishPlatform, post: Pick<ExternalPost, "title" | "caption" | "publishedAt">): string {
  const first = (platform === "youtube" ? post.title : post.caption.split("\n").find((l) => l.replace(/#\S+/g, "").trim()) ?? "")
    .replace(/#\S+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (first) return first.slice(0, 80);
  const d = new Date(post.publishedAt + 9 * 3600_000);
  return `${platform === "youtube" ? "YouTube 영상" : "인스타 릴스"} ${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}

/** 계정마다 「이미 본 게시물」 장부 — 사람이 지운 연결이 다음 확인 때 되살아나지 않게 */
export interface ExternalSeenDoc {
  accountId: string;
  /** externalId → 처음 본 때 */
  ids: Record<string, number>;
  checkedAt: number | null;
  /** 마지막 확인에서 찾은 게시물 수 · 새로 붙인 수 */
  found: number;
  imported: number;
  error: string | null;
}

/** 화면에 보낼 계정별 상태 */
export interface ExternalAccountStatus {
  accountId: string;
  platform: PublishPlatform;
  name: string;
  owner: string;
  checkedAt: number | null;
  found: number;
  imported: number;
  linked: number;
  error: string | null;
}
