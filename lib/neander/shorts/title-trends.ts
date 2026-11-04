// ============================================================
//  제목 키워드 (/neander/shorts/market › 제목 키워드) — 순수 함수 (브라우저 · 서버 공용)
// ------------------------------------------------------------
//  AI 레이더(한국 상품 쇼츠)와 바이럴 형식(감시 채널의 터진 영상)이 이미 모은 **영상 제목**을 낱말로 나눠
//  「평소보다 이번 주에 얼마나 두드러지게 늘었나」 를 본다. AI 를 부르지 않는다 (추가 비용 0원).
//
//  · 세는 단위는 영상이 아니라 **채널** — 한 채널이 같은 낱말로 열 편을 올려도 1 이다
//    (한 채널의 연속 기획이 「유행」 으로 보이지 않게).
//  · 주는 KST ISO 주(월~일), 올린 때(publishedAt) 기준 — 모르면 모은 때.
//  · 점수(-100~100) = 이번 주 채널 수(cur)가 2 이상일 때만
//      round(100 × (cur − 평소) ÷ (cur + 평소))
//    평소 = 고른 주 앞 최대 4주 중 **모은 영상이 있는 주**의 채널 수 평균 (그 주에 안 썼으면 0 으로 센다).
//    평소가 0 이면 100, 자료 있는 지난 주가 하나도 없으면 점수 없음(null — 「비교할 지난 기록 없음」).
//    모은 양이 적은 주는 점수가 크게 흔들린다 — 화면이 주마다 모은 영상 수를 함께 보인다.
//  · 낱말 나누기는 사전 없이 규칙으로 — 공백 · 문장부호로 자르고, 한국어 조사 꼬리를 떼고(받침이 맞을 때만 ·
//    낱말 끝 글자와 헷갈리는 조사는 그 앞부분이 자료에 따로 나올 때만), 해시태그는 # 없이 한 낱말로,
//    일본어는 가타카나 · 한자 덩어리만, 숫자 · 한 글자 · 흔한 말은 버린다.
// ============================================================

import { isoWeekKey } from "./scout";

const DAY = 86_400_000;
const KST_MS = 9 * 3600_000;

// ---- 낱말 나누기 ----------------------------------------------------------------

/**
 * 흔한 말 — 주제와 상관없이 제목마다 붙는 말. 실제 자료(살림설계사무소 레이더 217편 · 터진 영상 171편,
 * 2026-11-04)에서 상위에 뜬 것 중 플랫폼 · 홍보 · 강조 · 가리키는 말만 골랐다 (상품 · 장소 · 상황 말은 남긴다).
 */
export const TITLE_STOPWORDS: ReadonlySet<string> = new Set([
  // 플랫폼 · 형식
  "쇼츠", "숏츠", "shorts", "short", "youtube", "유튜브", "영상", "릴스", "reels", "fyp", "viral",
  "ショート", "动画",
  // 홍보
  "추천", "추천템", "꿀템", "리뷰", "후기", "필수템", "강추", "best", "おすすめ", "推荐",
  // 강조 · 가리키는 말
  "이거", "이것", "이걸", "그거", "진짜", "정말", "너무", "완전", "무조건", "그냥", "이렇게", "요즘", "제일", "가장",
  // 아무 주제에나 붙는 꾸밈말 (실제 자료 상위 — 있는 · 좋은 · 하나 · 아직 · 대신)
  "있는", "없는", "좋은", "하나", "아직", "대신",
  // 영어 기능어
  "the", "and", "for", "with", "you", "your", "this", "that", "how", "what", "are", "from", "in", "on", "of", "to", "my", "is", "it", "me", "an",
]);

// 조사 — 받침: C = 받침 있는 말 뒤 · V = 받침 없는 말(로 는 ㄹ 받침도) 뒤 · * = 상관없음.
// amb = 낱말 끝 글자와 헷갈리는 조사(고양이 · 옷걸이 · 전문가 …) → 앞부분이 자료에 따로 나올 때만 뗀다.
type Josa = { s: string; need: "C" | "V" | "VL" | "*"; amb?: true };
const JOSA: Josa[] = [
  { s: "에서부터", need: "*" },
  { s: "에서도", need: "*" },
  { s: "에서는", need: "*" },
  { s: "으로도", need: "C" },
  { s: "으로는", need: "C" },
  { s: "까지도", need: "*" },
  { s: "부터는", need: "*" },
  { s: "에서", need: "*" },
  { s: "에게", need: "*" },
  { s: "한테", need: "*" },
  { s: "까지", need: "*" },
  { s: "부터", need: "*" },
  { s: "처럼", need: "*" },
  { s: "보다", need: "*" },
  { s: "마다", need: "*" },
  { s: "만큼", need: "*" },
  { s: "에는", need: "*" },
  { s: "에도", need: "*" },
  { s: "으로", need: "C" },
  { s: "로도", need: "VL" },
  { s: "로는", need: "VL" },
  { s: "이랑", need: "C", amb: true },
  { s: "이나", need: "C", amb: true },
  { s: "은", need: "C" },
  { s: "는", need: "V" },
  { s: "을", need: "C" },
  { s: "를", need: "V" },
  { s: "의", need: "*" },
  { s: "에", need: "*" },
  { s: "와", need: "V" },
  { s: "랑", need: "V" },
  { s: "이", need: "C", amb: true },
  { s: "가", need: "V", amb: true },
  { s: "과", need: "C", amb: true },
  { s: "로", need: "VL", amb: true },
  { s: "도", need: "*", amb: true },
  { s: "만", need: "*", amb: true },
];

/**
 * 풀이말 꼬리 — 「했는데 · 마세요 · 붙였더니 · 확인해야 · 편하게」 처럼 서술로 끝나는 말은 주제 낱말이 아니라 버린다.
 * (조사와 달리 떼지 않는다 — 떼고 남는 「했 · 붙였」 은 낱말이 아니다)
 */
const PREDICATE_TAIL = /(?:는데|은데|던데|더니|으면|세요|해야|하게|하는|하면|해서|했다|해요|니다|어요|아요|지만|면서|려고|려면|었다|았다|였다|을까|할까)$/u;

/** 한글 음절의 받침 — 0 없음 · 8 ㄹ · 그 밖 · 한글 음절이 아니면 null */
function finalOf(ch: string): number | null {
  const c = ch.codePointAt(0) ?? 0;
  if (c < 0xac00 || c > 0xd7a3) return null;
  return (c - 0xac00) % 28;
}

function josaFits(stem: string, j: Josa): boolean {
  const f = finalOf(stem.slice(-1));
  if (f === null) return j.need === "*"; // 영문 · 숫자 뒤 (iPhone은) — 받침을 모르니 상관없는 조사만
  if (j.need === "C") return f !== 0;
  if (j.need === "V") return f === 0;
  if (j.need === "VL") return f === 0 || f === 8;
  return true;
}

/**
 * 한국어 낱말의 조사 꼬리를 뗀다 (하나만 · 남는 앞부분이 두 글자 이상일 때만).
 * attested(앞부분) — 헷갈리는 조사(amb)는 그 앞부분이 자료에 따로 나올 때만 뗀다. 없으면 떼지 않는다.
 */
export function stripJosa(word: string, attested: (stem: string) => boolean = () => false): string {
  if (!/\p{Script=Hangul}$/u.test(word)) return word;
  for (const j of JOSA) {
    if (!word.endsWith(j.s)) continue;
    const stem = word.slice(0, -j.s.length);
    if ([...stem].length < 2 || !josaFits(stem, j)) continue;
    // 「사야하는 · 정리하는」 의 는 은 조사가 아니라 풀이말 꼬리 — 떼면 「사야하」 가 남는다
    if (j.s === "는" && stem.endsWith("하")) continue;
    if (j.amb && !attested(stem)) continue;
    return stem;
  }
  return word;
}

// ©®™ 는 Extended_Pictographic 이지만 이모지로 쓴 게 아니다 · 이모지 조각(변형 선택자 · 잇개 · 피부색 · 키캡)도 같이
const EMOJI_RE = /(?![©®™])\p{Extended_Pictographic}|[\u{1F3FB}-\u{1F3FF}\u{FE0E}\u{FE0F}\u{200D}\u{20E3}\u{E0020}-\u{E007F}]/gu;
const HASHTAG_RE = /(^|[^\p{L}\p{N}_])#([\p{L}\p{M}\p{N}_]+)/gu;
/** 글자 · 숫자가 아닌 것은 모두 경계 */
const SPLIT_RE = /[^\p{L}\p{M}\p{N}]+/u;

/** 숫자만 · 숫자 + 짧은 단위(3가지 · 2개 · 5천원 · 8選)는 주제를 말하지 않는다 */
const isNumberish = (w: string) => /^\p{N}+$/u.test(w) || /^\p{N}+[\p{Script=Hangul}\p{Script=Han}]{1,2}$/u.test(w);

/** 글자 덩어리 — 한글(앞 숫자 붙임) · 라틴+숫자 · 가타카나 · 한자 · 히라가나 · 그 밖 */
type Run = { kind: "hangul" | "latin" | "kata" | "han" | "hira" | "other"; text: string };
function scriptOf(ch: string): Run["kind"] | "digit" {
  if (/\p{N}/u.test(ch)) return "digit";
  if (/\p{Script=Hangul}/u.test(ch)) return "hangul";
  if (/\p{Script=Latin}/u.test(ch)) return "latin";
  if (/[\p{Script=Katakana}ー]/u.test(ch)) return "kata";
  if (/\p{Script=Han}/u.test(ch)) return "han";
  if (/\p{Script=Hiragana}/u.test(ch)) return "hira";
  return "other";
}

function runsOf(piece: string): Run[] {
  const out: Run[] = [];
  let digits = "";
  for (const ch of piece) {
    const k = scriptOf(ch);
    if (k === "digit") {
      // 숫자는 라틴 덩어리 안이면 그대로 잇고(top10 · 4k), 아니면 뒤에 오는 덩어리에 붙인다(3가지)
      const last = out.at(-1);
      if (last?.kind === "latin" && !digits) last.text += ch;
      else digits += ch;
      continue;
    }
    const last = out.at(-1);
    // 덩어리 안의 결합 문자(\p{M})는 앞 글자 종류를 따른다
    if (/\p{M}/u.test(ch) && last) {
      last.text += ch;
      continue;
    }
    if (last && last.kind === k && !digits) last.text += ch;
    else {
      out.push({ kind: k, text: digits + ch });
      digits = "";
    }
  }
  if (digits) out.push({ kind: "other", text: digits });
  return out;
}

/** 덩어리 → 후보 낱말 (조사는 아직 안 뗌). 히라가나는 거의 조사 · 어미라 버리고, 긴 한자 줄은 문장이라 버린다 */
function candidates(piece: string): string[] {
  const out: string[] = [];
  for (const r of runsOf(piece)) {
    if (r.kind === "hira") continue;
    if (r.kind === "han" && [...r.text].length > 4) continue;
    out.push(r.text);
  }
  return out;
}

const keepWord = (w: string) => [...w].length >= 2 && !isNumberish(w) && !TITLE_STOPWORDS.has(w) && !(PREDICATE_TAIL.test(w) && /\p{Script=Hangul}$/u.test(w));
/** 해시태그는 사람이 고른 한 낱말이라 숫자 + 단위도 남긴다 (#100均) — 숫자만인 것은 버린다 */
const keepTag = (w: string) => [...w].length >= 2 && !/^\p{N}+$/u.test(w) && !TITLE_STOPWORDS.has(w);

/** 홀로 쓴 자모(ㅋㅋ · ㄷㄷ · ㅠㅠ)는 낱말이 아니다 — NFKC 가 호환 자모를 첫가끝 자모로 바꾸므로 둘 다 */
const JAMO_RE = /[\u1100-\u11ff\u3131-\u318e\ua960-\ua97f\ud7b0-\ud7ff]+/g;

/** 제목 다듬기 — 호환 글자 펴기 · 소문자 · 이모지 · 홀로 쓴 자모 지우기 */
export const normalizeTitle = (title: string) => title.normalize("NFKC").toLowerCase().replace(EMOJI_RE, " ").replace(JAMO_RE, " ");

/** 제목의 해시태그 (# 없이 · 소문자) 와 나머지 글 */
function splitHashtags(t: string): { tags: string[]; rest: string } {
  const tags: string[] = [];
  const rest = t.replace(HASHTAG_RE, (_m, pre: string, tag: string) => {
    tags.push(tag.replace(/_/g, ""));
    return `${pre} `;
  });
  return { tags, rest };
}

/** 조사를 떼기 전의 한글 낱말들 — 「앞부분이 자료에 따로 나오나」 를 보려고 */
export function rawTitleWords(title: string): string[] {
  const { tags, rest } = splitHashtags(normalizeTitle(title));
  return [...tags, ...rest.split(SPLIT_RE).flatMap(candidates)].filter(Boolean);
}

/**
 * 제목 하나의 낱말 (한 제목 안에서는 한 번씩). 해시태그는 한 낱말 그대로(조사를 떼지 않는다).
 * attested 를 주면 헷갈리는 조사도 뗀다 — buildTitleIndex 가 자료 전체를 보고 넘긴다.
 */
export function titleWords(title: string, attested?: (stem: string) => boolean): string[] {
  const { tags, rest } = splitHashtags(normalizeTitle(title));
  const words = rest
    .split(SPLIT_RE)
    .flatMap(candidates)
    .map((w) => stripJosa(w, attested));
  return [...new Set([...tags.filter(keepTag), ...words.filter(keepWord)])];
}

/** 화면에서 찾는 말 — 제목과 같은 규칙으로 (한 낱말) */
export function normalizeQuery(q: string): string {
  const t = normalizeTitle(q).replace(/^#+/, "").trim();
  const first = t.split(SPLIT_RE).filter(Boolean)[0] ?? "";
  return stripJosa(first.replace(/_/g, ""));
}

// ---- 주 ------------------------------------------------------------------------

/** KST 날짜(YYYY-MM-DD) */
const kstDate = (ms: number) => new Date(ms + KST_MS).toISOString().slice(0, 10);

/** 그 시각이 든 주의 월요일 0시(KST)를 UTC ms 로 */
export function weekStartMs(ms: number): number {
  const k = new Date(ms + KST_MS);
  const dow = k.getUTCDay() || 7;
  return Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate() - (dow - 1)) - KST_MS;
}

/** 주 → 그 주 월요일 (KST 날짜) */
export const weekStartDate = (ms: number) => kstDate(weekStartMs(ms));

/** 첫 주부터 끝 주까지 빠짐없이 (자료 없는 주도 넣는다) */
export function weekRange(fromMs: number, toMs: number): { key: string; start: string; startMs: number }[] {
  const out: { key: string; start: string; startMs: number }[] = [];
  for (let t = weekStartMs(fromMs); t <= weekStartMs(toMs) && out.length < 120; t += 7 * DAY) out.push({ key: isoWeekKey(t), start: kstDate(t), startMs: t });
  return out;
}

// ---- 자료 ------------------------------------------------------------------------

export type TitleSource = "radar" | "hits";
export type TitleSourcePick = TitleSource | "both";
export const TITLE_SOURCE_LABEL: Record<TitleSourcePick, string> = { radar: "AI 레이더", hits: "바이럴 형식", both: "둘 다" };

/** 제목 키워드가 보는 영상 하나 (서버가 레이더 · 터진 영상에서 만든다) */
export interface TitleVideo {
  /** 영상 (yt_<영상 id>) — 두 자료에 같은 영상이 있으면 하나로 */
  key: string;
  sources: TitleSource[];
  title: string;
  /** 채널 (yt_<채널 id> · 모르면 ch:<이름>) */
  channelKey: string;
  channel: string;
  country: string;
  /** 주를 가를 때 — 올린 때, 모르면 모은 때 */
  at: number;
  atBasis: "published" | "collected";
  url: string;
  thumbnail: string;
  multiple: number | null;
  views: number | null;
}

export interface TitleWeek {
  key: string;
  /** 월요일 (KST) */
  start: string;
  /** 그 주에 올린(또는 모은) 영상 수 · 채널 수 */
  videos: number;
  channels: number;
}

export interface TitleWordRow {
  word: string;
  /** 고른 주에 이 낱말을 쓴 채널 수 */
  cur: number;
  /** 평소 — 앞 최대 4주 중 자료 있는 주의 채널 수 평균 (없으면 null) */
  base: number | null;
  /** -100~100 · cur 가 2 아래거나 평소를 모르면 null */
  score: number | null;
  /** 고른 주에 이 낱말을 쓴 영상 수 */
  videos: number;
  /** 모은 자료 전체에서 쓴 영상 · 채널 수 */
  totalVideos: number;
  totalChannels: number;
  /** 모은 자료 중 가장 이른 올린 때 (ms) */
  firstSeen: number;
}

/**
 * 점수 — 이번 주 채널 수(cur)가 2 이상일 때만 round(100 × (cur − 평소) ÷ (cur + 평소)).
 * 평소가 0 이면 100, 평소를 모르면(자료 있는 지난 주가 없으면) null.
 */
export function wordScore(cur: number, base: number | null): number | null {
  if (cur < 2 || base === null) return null;
  if (base <= 0) return 100;
  return Math.round((100 * (cur - base)) / (cur + base));
}

export interface TitleIndex {
  weeks: TitleWeek[];
  /** 낱말 → 주 → 채널들 */
  byWord: Map<string, Map<string, Set<string>>>;
  /** 낱말 → 영상 key 들 */
  videosOf: Map<string, Set<string>>;
  /** 영상 key → 낱말들 */
  wordsOf: Map<string, string[]>;
  /** 영상 key → 주 */
  weekOf: Map<string, string>;
  /** 낱말 → 가장 이른 때 */
  firstSeen: Map<string, number>;
}

/** 영상들을 낱말 · 주로 묶는다. now 는 마지막 주(이번 주)를 정할 때 */
export function buildTitleIndex(videos: TitleVideo[], now = Date.now()): TitleIndex {
  // 1) 헷갈리는 조사를 뗄지 — 앞부분이 자료 어딘가에 따로(조사 없이) 나오는가
  const raw = new Set<string>();
  for (const v of videos) for (const w of rawTitleWords(v.title)) raw.add(w);
  const attested = (stem: string) => raw.has(stem);

  const byWord = new Map<string, Map<string, Set<string>>>();
  const videosOf = new Map<string, Set<string>>();
  const wordsOf = new Map<string, string[]>();
  const weekOf = new Map<string, string>();
  const firstSeen = new Map<string, number>();
  const weekVideos = new Map<string, number>();
  const weekChannels = new Map<string, Set<string>>();
  for (const v of videos) {
    const wk = isoWeekKey(v.at);
    weekOf.set(v.key, wk);
    weekVideos.set(wk, (weekVideos.get(wk) ?? 0) + 1);
    weekChannels.set(wk, (weekChannels.get(wk) ?? new Set()).add(v.channelKey));
    const words = titleWords(v.title, attested);
    wordsOf.set(v.key, words);
    for (const w of words) {
      let m = byWord.get(w);
      if (!m) byWord.set(w, (m = new Map()));
      m.set(wk, (m.get(wk) ?? new Set()).add(v.channelKey));
      videosOf.set(w, (videosOf.get(w) ?? new Set()).add(v.key));
      firstSeen.set(w, Math.min(firstSeen.get(w) ?? Infinity, v.at));
    }
  }
  const times = videos.map((v) => v.at).filter(Number.isFinite);
  const weeks: TitleWeek[] = times.length
    ? weekRange(Math.min(...times), Math.max(now, ...times)).map((w) => ({ key: w.key, start: w.start, videos: weekVideos.get(w.key) ?? 0, channels: weekChannels.get(w.key)?.size ?? 0 }))
    : [{ key: isoWeekKey(now), start: weekStartDate(now), videos: 0, channels: 0 }];
  return { weeks, byWord, videosOf, wordsOf, weekOf, firstSeen };
}

/**
 * 처음 볼 주 — 이번 주는 아직 진행 중이라(월요일엔 거의 비어 있다) 끝난 주 중 가장 최근의 자료 있는 주.
 * 그런 주가 없으면 이번 주.
 */
export function defaultTitleWeek(weeks: TitleWeek[], thisWeek: string): string {
  const done = weeks.filter((w) => w.key < thisWeek && w.videos > 0);
  return done.at(-1)?.key ?? weeks.find((w) => w.key === thisWeek)?.key ?? weeks.at(-1)?.key ?? thisWeek;
}

/** 고른 주의 평소를 잴 지난 주 — 앞 최대 4주 중 자료 있는 주 */
export function baseWeeksOf(weeks: TitleWeek[], week: string, span = 4): TitleWeek[] {
  const i = weeks.findIndex((w) => w.key === week);
  if (i < 0) return [];
  return weeks.slice(Math.max(0, i - span), i).filter((w) => w.videos > 0);
}

function rowOf(ix: TitleIndex, word: string, week: string, base: TitleWeek[]): TitleWordRow {
  const m = ix.byWord.get(word);
  const cur = m?.get(week)?.size ?? 0;
  const baseV = base.length ? base.reduce((s, w) => s + (m?.get(w.key)?.size ?? 0), 0) / base.length : null;
  const vids = [...(ix.videosOf.get(word) ?? [])];
  const channels = new Set<string>();
  for (const s of m?.values() ?? []) for (const c of s) channels.add(c);
  return {
    word,
    cur,
    base: baseV === null ? null : Math.round(baseV * 100) / 100,
    score: wordScore(cur, baseV),
    videos: vids.filter((k) => ix.weekOf.get(k) === week).length,
    totalVideos: vids.length,
    totalChannels: channels.size,
    firstSeen: ix.firstSeen.get(word) ?? 0,
  };
}

export type TitleSort = "score" | "count";

/**
 * 고른 주의 낱말 순위 — 그 주에 채널 minChannels 곳 이상이 쓴 낱말만 (기본 2 — 점수를 매길 수 있는 것).
 * 점수 순은 점수 → 채널 수, 많이 쓴 순은 채널 수 → 점수. include 는 순위 밖이어도 넣는다(고른 낱말).
 */
export function titleTrendRows(ix: TitleIndex, week: string, o: { sort?: TitleSort; limit?: number; minChannels?: number; include?: string[] } = {}): TitleWordRow[] {
  const base = baseWeeksOf(ix.weeks, week);
  const min = o.minChannels ?? 2;
  const rows: TitleWordRow[] = [];
  for (const [word, m] of ix.byWord) if ((m.get(week)?.size ?? 0) >= min) rows.push(rowOf(ix, word, week, base));
  const sc = (r: TitleWordRow) => r.score ?? -1000;
  rows.sort(o.sort === "count" ? (a, b) => b.cur - a.cur || sc(b) - sc(a) || a.word.localeCompare(b.word) : (a, b) => sc(b) - sc(a) || b.cur - a.cur || a.word.localeCompare(b.word));
  const top = rows.slice(0, o.limit ?? 150);
  for (const w of o.include ?? []) if (!top.some((r) => r.word === w)) top.push(rowOf(ix, w, week, base));
  return top;
}

/** 고른 낱말의 주별 채널 수 — 자료 없는 주는 null (0 과 다르다) */
export function titleWordSeries(ix: TitleIndex, words: string[]): { word: string; points: { week: string; start: string; channels: number | null }[] }[] {
  return words.map((word) => ({
    word,
    points: ix.weeks.map((w) => ({ week: w.key, start: w.start, channels: w.videos > 0 ? (ix.byWord.get(word)?.get(w.key)?.size ?? 0) : null })),
  }));
}

/** 고른 낱말을 쓴 영상 — 최근에 올린 순 (어느 낱말이 들었나 함께) */
export function videosWithWords(ix: TitleIndex, videos: TitleVideo[], words: string[], limit = 80): (TitleVideo & { week: string; matched: string[] })[] {
  const want = new Set(words);
  return videos
    .map((v) => ({ v, matched: (ix.wordsOf.get(v.key) ?? []).filter((w) => want.has(w)) }))
    .filter((x) => x.matched.length > 0)
    .sort((a, b) => b.v.at - a.v.at)
    .slice(0, limit)
    .map(({ v, matched }) => ({ ...v, week: ix.weekOf.get(v.key) ?? "", matched }));
}

/** 같은 채널은 하나만 — 채널마다 배수가 가장 큰 영상 (배수를 모르면 최근 것) */
export function onePerChannel<T extends { channelKey: string; multiple: number | null; at: number }>(list: T[]): T[] {
  const best = new Map<string, T>();
  for (const v of list) {
    const b = best.get(v.channelKey);
    if (!b || (v.multiple ?? -1) > (b.multiple ?? -1) || ((v.multiple ?? -1) === (b.multiple ?? -1) && v.at > b.at)) best.set(v.channelKey, v);
  }
  return list.filter((v) => best.get(v.channelKey) === v);
}

// ---- 화면 ↔ 서버 ------------------------------------------------------------------

export interface TitleTrendsResult {
  source: TitleSourcePick;
  country: string;
  week: string;
  /** 이번 주 (KST) — 아직 끝나지 않은 주 */
  thisWeek: string;
  weeks: TitleWeek[];
  /** 평소를 잰 지난 주 */
  baseWeeks: string[];
  /** 고를 수 있는 나라 (바이럴 형식) — 영상 수 */
  countries: { code: string; videos: number }[];
  sort: TitleSort;
  rows: TitleWordRow[];
  /** 고른 낱말 (자료에 맞춰 다듬은 것) */
  words: string[];
  series: ReturnType<typeof titleWordSeries>;
  videos: (TitleVideo & { week: string; matched: string[] })[];
  totals: { videos: number; channels: number; radar: number; hits: number };
}

export const MAX_TITLE_WORDS = 5;
