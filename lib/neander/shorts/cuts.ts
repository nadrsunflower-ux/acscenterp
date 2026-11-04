// ============================================================
//  레퍼런스 영상 「컷 표」 — 남의 잘된 쇼츠를 컷 전환 단위로 뜯어(장면 · 말 · 화면 글자 · 소리 · 초)
//  그 구조로 우리 대본을 쓴다. 순수 함수 · 모양만 둔다 (브라우저 · 서버 공용).
// ------------------------------------------------------------
//  · 살림 영상 때 가편집본으로 손으로 만들던 컷 표(「컷 · 시작 · 길이 · 화면 · 대본」)를 남의 영상에도 —
//    AI(Gemini)가 공개 YouTube 영상을 직접 보고 받아 적는다 (server/cuts.ts).
//  · 프로젝트 안에서 회사 공용(바이럴 형식 자료와 같은 성격) — neander_shorts_cuts, 문서 id = yt_<영상 id>.
//    프로젝트마다 따로(server/space-db.ts 의 SCOPED). 지우기는 만든 사람 · 관리자.
//  · 초는 AI 가 영상을 보고 적은 대략의 값이다 — 화면에 늘 그렇게 밝힌다. 길이는 YouTube API 로 알면 그 값.
//  · 대본 작성기에는 「구조(컷 순서 · 길이 · 훅 · 역할)는 옮기고 내용(제품 · 말)은 새로 쓴다」 로 넘긴다.
// ============================================================

import type { BeatKey } from "./types";
import type { ScoutOwned } from "./scout";

/** 컷 하나 — 화면에 보이는 것 · 들린 말 · 화면 글자 · 소리 · 역할 */
export interface Cut {
  /** 시작 · 끝 (초, 소수 한 자리) — AI 가 본 대략의 값 */
  from: number;
  to: number;
  /** 화면에 보이는 것 (관찰) */
  shot: string;
  /** 들린 말 — 내레이션 · 대사. 번역하지 않는다(외국어면 원문 + 뜻). 없으면 "" */
  speech: string;
  /** 화면 글자 (자막 · 텍스트 효과) */
  caption: string;
  /** 효과음 · 음악 */
  sound: string;
  /** 이 컷의 역할 (성공 공식의 구간과 같은 이름) — 모르면 null */
  beat: BeatKey | null;
}

export interface CutSheetDoc extends ScoutOwned {
  videoId: string;
  /** 정식 주소 https://www.youtube.com/watch?v=ID */
  url: string;
  title: string;
  channel: string;
  /** 영상 길이 — YouTube API 로 알면 그 값(api), 아니면 AI 가 본 값(ai), 모르면 null */
  durationSec: number | null;
  durationSrc: "api" | "ai" | null;
  cuts: Cut[];
  /** 목록용 — 컷 수 (목록은 cuts 배열을 읽지 않는다) */
  cutCount: number;
  /** 첫 2초에 보이고 들리는 것 */
  hook: string;
  /** 흐름 한 줄 */
  summary: string;
  model: string;
  costUsd: number;
  /** 마지막으로 만든 때 · 사람 (다시 만들면 바뀐다 — owner 는 처음 만든 사람 그대로) */
  at: number;
  by: string;
  /** 사람 메모 — 분석 초점 (AI 가 참고한다) */
  note: string;
}

export type CutSheet = CutSheetDoc & { id: string };

/** 목록 한 줄 (컷 배열 없이) */
export type CutSheetSummary = Pick<CutSheetDoc, "videoId" | "url" | "title" | "channel" | "durationSec" | "cutCount" | "hook" | "at" | "by" | "owner" | "costUsd"> & { id: string };

/** 하루 상한 — 프로젝트마다 */
export const CUTS_DAILY_LIMIT = 30;
export const CUTS_MAX = 60;
/** 메모 글자 수 */
export const CUT_NOTE_MAX = 1000;

const BEATS: BeatKey[] = ["hook", "problem", "empathy", "reveal", "demo", "compare", "twist", "proof", "cta"];
export const isBeatKey = (v: unknown): v is BeatKey => BEATS.includes(v as BeatKey);

// ---- 주소 ---------------------------------------------------------------------

const VIDEO_ID = /^[\w-]{11}$/;

/**
 * YouTube 영상 주소 → 정식 watch 주소. watch · shorts · youtu.be · m. · embed 를 받는다.
 * 채널 · 재생목록 · 다른 사이트 · 맨 id 만 적은 것은 null (컷 표는 영상 하나를 본다).
 */
export function normalizeYoutubeVideoUrl(input: unknown): { videoId: string; url: string } | null {
  if (typeof input !== "string") return null;
  const s = input.trim();
  if (!s || /\s/.test(s)) return null;
  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const host = u.hostname.toLowerCase().replace(/^(www|m)\./, "");
  const parts = u.pathname.split("/").filter(Boolean);
  let id: string | null = null;
  if (host === "youtu.be") id = parts[0] ?? null;
  else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    if (parts[0] === "watch" && parts.length === 1) id = u.searchParams.get("v");
    else if ((parts[0] === "shorts" || parts[0] === "embed" || parts[0] === "live") && parts.length >= 2) id = parts[1];
  }
  if (!id || !VIDEO_ID.test(id)) return null;
  return { videoId: id, url: `https://www.youtube.com/watch?v=${id}` };
}

export const cutIdOf = (videoId: string) => `yt_${videoId}`;
export const isCutId = (v: unknown): v is string => typeof v === "string" && /^yt_[\w-]{11}$/.test(v);
export const videoIdOfCut = (id: string) => id.slice(3);

/** 재생기 주소 — 그 초부터 (누른 뒤에만 자동 재생) */
export const cutEmbedUrl = (videoId: string, startSec: number, autoplay: boolean) =>
  `https://www.youtube-nocookie.com/embed/${videoId}?start=${Math.max(0, Math.floor(startSec))}&autoplay=${autoplay ? 1 : 0}&rel=0&playsinline=1`;

// ---- 다듬기 -------------------------------------------------------------------

const clip = (v: unknown, n: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, n) : "");
const sec = (v: unknown): number | null => {
  const x = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(x) ? Math.max(0, Math.round(x * 10) / 10) : null;
};
const r1 = (x: number) => Math.round(x * 10) / 10;
const joinText = (a: string, b: string, n: number) => (a && b && a !== b ? `${a} / ${b}` : a || b).slice(0, n);

export const CUT_TEXT_MAX = { shot: 300, speech: 400, caption: 200, sound: 200 } as const;

/**
 * AI 가 준 컷 목록을 저장할 모양으로 — 시간 순서로 늘어놓고, 거꾸로 된 초(끝 < 시작) · 음수 · 겹침 ·
 * 영상 길이를 넘는 초를 고친다. 같은 초에 시작하는 컷은 하나로 합친다. 컷은 60개까지, 글자는 칸마다 자른다.
 *  · 겹침은 「다음 컷의 시작이 경계」 — 앞 컷의 끝을 다음 컷 시작으로 당긴다 (AI 는 전환 시점을 더 잘 본다).
 *  · 시작과 끝이 같은 컷(한 점)은 다음 컷 시작(마지막이면 영상 끝)까지로 늘린다. 비어 있는 틈은 지어 메우지 않는다.
 *  · 길이(durationSec)를 알면 모든 초를 그 안으로 — 영상 끝 뒤에서 시작하는 컷은 버린다.
 */
export function sanitizeCuts(raw: unknown, durationSec: number | null = null): Cut[] {
  const dur = typeof durationSec === "number" && Number.isFinite(durationSec) && durationSec > 0 ? r1(durationSec) : null;
  const list: Cut[] = [];
  let prevTo = 0;
  for (const x of Array.isArray(raw) ? raw.slice(0, CUTS_MAX * 2) : []) {
    const c = (x ?? {}) as Record<string, unknown>;
    let from = sec(c.from);
    let to = sec(c.to);
    if (from === null && to === null) continue;
    if (from === null) from = Math.min(prevTo, to ?? prevTo);
    if (to === null) to = from;
    if (to < from) [from, to] = [to, from];
    if (dur !== null) {
      if (from >= dur) continue;
      to = Math.min(to, dur);
    }
    const cut: Cut = {
      from,
      to,
      shot: clip(c.shot, CUT_TEXT_MAX.shot),
      speech: clip(c.speech, CUT_TEXT_MAX.speech),
      caption: clip(c.caption, CUT_TEXT_MAX.caption),
      sound: clip(c.sound, CUT_TEXT_MAX.sound),
      beat: isBeatKey(c.beat) ? c.beat : null,
    };
    if (!cut.shot && !cut.speech && !cut.caption && !cut.sound) continue;
    list.push(cut);
    prevTo = to;
  }
  list.sort((a, b) => a.from - b.from || a.to - b.to);
  // 같은 초에 시작하는 컷 → 하나로
  const merged: Cut[] = [];
  for (const c of list) {
    const p = merged.at(-1);
    if (p && Math.abs(p.from - c.from) < 0.05) {
      p.to = Math.max(p.to, c.to);
      p.shot = joinText(p.shot, c.shot, CUT_TEXT_MAX.shot);
      p.speech = joinText(p.speech, c.speech, CUT_TEXT_MAX.speech);
      p.caption = joinText(p.caption, c.caption, CUT_TEXT_MAX.caption);
      p.sound = joinText(p.sound, c.sound, CUT_TEXT_MAX.sound);
      p.beat = p.beat ?? c.beat;
    } else merged.push({ ...c });
  }
  const out = merged.slice(0, CUTS_MAX);
  for (let i = 0; i < out.length; i++) {
    const c = out[i];
    const next = out[i + 1];
    if (next && c.to > next.from) c.to = next.from; // 겹침 — 다음 컷 시작이 경계
    if (c.to <= c.from) c.to = next ? next.from : (dur ?? c.from); // 한 점 — 다음 전환(또는 영상 끝)까지
    c.from = r1(c.from);
    c.to = r1(Math.max(c.from, c.to));
  }
  return out;
}

/** AI 의 한 번 답 전체 — 훅 · 한 줄 · 컷 · AI 가 본 길이 */
export function sanitizeCutResult(raw: unknown, durationSec: number | null): { hook: string; summary: string; cuts: Cut[]; aiTotalSec: number | null } {
  const r = (raw ?? {}) as Record<string, unknown>;
  const aiTotal = sec(r.totalSec);
  const known = typeof durationSec === "number" && durationSec > 0 ? durationSec : null;
  return {
    hook: clip(r.hook, 400),
    summary: clip(r.summary, 600),
    cuts: sanitizeCuts(r.cuts, known ?? (aiTotal && aiTotal > 0 ? aiTotal : null)),
    aiTotalSec: aiTotal && aiTotal > 0 && aiTotal <= 3600 ? aiTotal : null,
  };
}

// ---- 보기 · 복사 ---------------------------------------------------------------

/** 영상 길이 — 알면 그 값, 모르면 마지막 컷의 끝 (null 이면 모름) */
export const cutSheetLength = (d: Pick<CutSheetDoc, "durationSec" | "cuts">): number | null => d.durationSec ?? (d.cuts.length ? d.cuts[d.cuts.length - 1].to : null);

export const fmtCutSec = (n: number) => `${r1(n).toFixed(1)}`;
/** 「0.0~2.1초」 */
export const cutRange = (c: Pick<Cut, "from" | "to">) => `${fmtCutSec(c.from)}~${fmtCutSec(c.to)}초`;
export const cutLen = (c: Pick<Cut, "from" | "to">) => r1(c.to - c.from);

/** 평균 컷 길이 (초) — 컷이 없으면 null */
export function avgCutSec(cuts: Cut[]): number | null {
  if (!cuts.length) return null;
  const total = cuts.reduce((n, c) => n + cutLen(c), 0);
  return total > 0 ? r1(total / cuts.length) : null;
}

const lengthText = (d: Pick<CutSheetDoc, "durationSec" | "durationSrc" | "cuts">) => {
  const n = cutSheetLength(d);
  if (n === null) return "길이 모름";
  return `길이 약 ${Math.round(n)}초${d.durationSrc === "api" ? " (YouTube)" : d.durationSrc === "ai" ? " (AI 가 본 값)" : " (마지막 컷 기준)"}`;
};

/**
 * 복사용 글 — 노션 · 카톡에 붙여 넣기 좋게 컷마다 한 덩어리 (표 칸 대신 「화면 · 말 · 자막 · 소리」 줄).
 * 노션은 줄 그대로, 카톡은 줄바꿈만으로 읽힌다.
 */
export function cutSheetText(d: Pick<CutSheetDoc, "title" | "channel" | "url" | "durationSec" | "durationSrc" | "cuts" | "hook" | "summary">, beatLabel: Record<BeatKey, string>): string {
  const out: string[] = [
    `[컷 표] ${d.title || "(제목 모름)"}${d.channel ? ` — ${d.channel}` : ""}`,
    d.url,
    `${lengthText(d)} · 컷 ${d.cuts.length}개 · 초는 AI 가 영상을 보고 적은 대략의 값`,
  ];
  if (d.hook) out.push(`훅(첫 2초): ${d.hook}`);
  if (d.summary) out.push(`흐름: ${d.summary}`);
  d.cuts.forEach((c, i) => {
    out.push("", `${i + 1}. ${cutRange(c)} (${fmtCutSec(cutLen(c))}초)${c.beat ? ` · ${beatLabel[c.beat]}` : ""}`);
    if (c.shot) out.push(`   화면: ${c.shot}`);
    if (c.speech) out.push(`   말: ${c.speech}`);
    if (c.caption) out.push(`   자막: ${c.caption}`);
    if (c.sound) out.push(`   소리: ${c.sound}`);
  });
  return out.join("\n").trim();
}

/**
 * 대본 작성기에 넘길 참고 글 — 구조는 옮기고 내용은 새로 쓰라고 분명히 적는다.
 * 원본 말은 구조를 알아보는 데만 쓰라고(짧게 잘라) 넘긴다 — 베끼지 않게.
 */
export function cutReferenceText(d: CutSheet, beatLabel: Record<BeatKey, string>): string {
  const avg = avgCutSec(d.cuts);
  const head = [
    `[레퍼런스 영상 컷 표] id=${d.id} · ${d.title || "(제목 모름)"}${d.channel ? ` (${d.channel})` : ""}`,
    `${lengthText(d)} · 컷 ${d.cuts.length}개${avg !== null ? ` · 평균 컷 ${avg}초` : ""} · 초는 AI 가 본 대략의 값`,
    "쓰는 법: 이 영상의 구조(컷 순서 · 컷마다의 길이 · 첫 2초 훅의 방식 · 컷마다의 역할)는 옮기고, 내용(제품 · 말 · 자막 · 장면의 소재)은 우리 제품으로 새로 쓴다. 원본 대사 · 자막 · 제목을 그대로 베끼지 않는다 — 아래 원본 말은 그 컷이 어떤 종류의 말인지 알아보는 데만 쓴다.",
    d.hook && `훅(첫 2초): ${d.hook}`,
    d.summary && `흐름: ${d.summary}`,
    "컷:",
  ].filter(Boolean) as string[];
  const rows = d.cuts.map((c, i) =>
    [
      `${i + 1}. ${cutRange(c)}(${fmtCutSec(cutLen(c))}초)${c.beat ? ` [${beatLabel[c.beat]}]` : ""}`,
      c.shot && `화면 ${c.shot.slice(0, 140)}`,
      c.speech && `원본 말(베끼지 말 것) ${c.speech.slice(0, 80)}`,
      c.caption && `화면 글자 ${c.caption.slice(0, 60)}`,
      c.sound && `소리 ${c.sound.slice(0, 60)}`,
    ]
      .filter(Boolean)
      .join(" / "),
  );
  return [...head, ...rows].join("\n");
}

// ---- 비용 어림 -----------------------------------------------------------------

/**
 * 실측 근거: 컷 표 실호출 2편 (2026-11-04 · Gemini 3.7 Flash) — 24초 한국 쇼츠 컷 13개 $0.0095 · 21초 일본 쇼츠 컷 12개 $0.0084.
 * 둘 다 1초에 약 $0.0004 — 영상 비용이 길이에 비례하니 24초 값을 이 영상 길이로 늘린다. 길이를 모르면 30초로 어림.
 * (같은 모델의 바이럴 형식 분석은 19초 $0.0069 — 컷 표는 답이 길어 조금 더 든다.) 만든 뒤에는 실제 비용을 보인다.
 */
export const CUT_COST_BASIS = { usd: 0.0095, sec: 24 } as const;
export function cutEstimateUsd(durationSec: number | null): number {
  // 아주 짧은 영상도 지시문 · 답 몫이 있어 10초 아래로는 내리지 않는다 · 10분에서 멈춘다
  const s = typeof durationSec === "number" && durationSec > 0 ? Math.min(Math.max(durationSec, 10), 600) : 30;
  return (CUT_COST_BASIS.usd * s) / CUT_COST_BASIS.sec;
}
