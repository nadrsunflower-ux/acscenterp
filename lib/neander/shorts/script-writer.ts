// ============================================================
//  대본 작성기 (/neander/shorts/scripts) — 제품 사진 · 정보 + 분석(바이럴 형식 · 성공 공식 · AI 레이더)으로
//  소개 영상 대본을 쓰고, 채팅으로 고쳐 간다. 순수 함수 · 모양만 둔다 (브라우저 · 서버 공용).
// ------------------------------------------------------------
//  · 대본 세션은 사람마다 따로(비공개). 고칠 때마다 버전을 남기고 되돌릴 수 있다.
//  · 사진은 처음 쓸 때 · 새로 붙일 때만 AI 에 보여 주고, AI 가 읽어 낸 「확인된 사실」 을 글로 이어 간다.
//  · 장면은 이 회사 방식 그대로 — 제품 사진(image) · AI 생성(ai) · 직접 찍어야 하는 장면(clip, 되도록 적게).
//  · 「이 대본으로 영상 만들기」 는 기존 영상(프로젝트)으로 옮긴다 (server/script-writer.ts).
// ============================================================

import type { BeatKey, CtaPlan } from "./types";

export type WriterKind = "coupang" | "general" | "brand";
export const WRITER_KIND_LABEL: Record<WriterKind, string> = { coupang: "쿠팡 제휴", general: "일반 정보 (제휴 없음)", brand: "고객사 브랜드" };

export type WriterRefKind = "auto" | "format" | "template" | "radar";
export const WRITER_REF_LABEL: Record<WriterRefKind, string> = { auto: "AI 가 고르기", format: "바이럴 형식 카드", template: "성공 공식", radar: "AI 레이더 후보" };

export const WRITER_LENGTHS = [15, 30, 45, 60] as const;
export const WRITER_MAX_PHOTOS = 4;
/** 사진 한 장 상한 (브라우저가 1024px JPEG 로 줄여 보낸다 — data URL 글자 수) */
export const WRITER_PHOTO_MAX_CHARS = 700_000;
export const WRITER_THUMB_MAX_CHARS = 40_000;
export const WRITER_MAX_MESSAGES = 60;
export const WRITER_MAX_VERSIONS = 15;
export const WRITER_MESSAGE_MAX = 2000;

/** 채팅 칸 아래 빠른 요청 */
export const WRITER_SUGGESTIONS = ["첫 3초 훅을 더 세게", "15초로 줄여 줘", "말투를 더 친근하게", "제품 등장을 더 빨리", "CTA 를 다르게", "AI 로 만들기 쉬운 장면으로"];

export interface WriterScene {
  label: string;
  /** image = 제품 사진(photo 번호) · ai = AI 영상 생성(aiPrompt) · clip = 직접 찍어야 하는 장면 */
  kind: "image" | "ai" | "clip";
  durationSec: number;
  /** 화면에 무엇이 보이는지 (한국어) */
  visual: string;
  /** AI 영상 생성 프롬프트 (영어) — ai 장면만 */
  aiPrompt: string;
  /** 쓸 제품 사진 번호 (0부터) — image 장면만, 없으면 null */
  photo: number | null;
}

export interface WriterLine {
  beat: BeatKey;
  /** 내레이션 */
  text: string;
  /** 화면 자막 — 내레이션과 같으면 "" */
  caption: string;
  /** scenes 번호 (0부터) */
  scene: number;
}

export interface WriterScript {
  title: string;
  /** 첫 3초 훅 한 줄 */
  hook: string;
  targetSec: number;
  description: string;
  hashtags: string[];
  cta: CtaPlan;
  scenes: WriterScene[];
  lines: WriterLine[];
}

export interface WriterBasis {
  kind: "format" | "template" | "radar" | "none";
  id: string;
  name: string;
  /** 왜 이 분석을 골랐고 무엇을 옮겼는지 */
  why: string;
}

/** AI 한 번의 답 */
export interface WriterTurnOut {
  reply: string;
  script: WriterScript;
  /** 확인된 사실 — 사진 · 사용자 글에 있는 것만 */
  facts: string[];
  basis: WriterBasis;
  /** 사람이 확인해야 할 것 (가격 · 사용법 · 사진에 안 보이는 것) */
  checks: string[];
}

export interface WriterPhotoMeta {
  id: string;
  name: string;
  /** 작은 미리보기 (data URL) */
  thumb: string;
}

export interface WriterMessage {
  role: "user" | "assistant";
  text: string;
  at: number;
  /** 이 말과 함께 붙인 사진 */
  photoIds?: string[];
  /** AI 답이 만든 버전 번호 (1부터) */
  version?: number;
  model?: string;
  costUsd?: number;
  /** AI 가 실패했을 때 그 사유 (사람 말은 남기고 답 자리에 적는다) */
  error?: string;
}

export interface WriterVersion {
  n: number;
  at: number;
  by: string;
  /** 무엇 때문에 바뀌었나 (사람 요청 · 되돌리기) */
  note: string;
  script: WriterScript;
}

export interface WriterRef {
  kind: Exclude<WriterRefKind, "auto">;
  id: string;
  name: string;
  /** 고르는 칸에 보일 한 줄 */
  summary: string;
}

export interface ScriptSessionDoc {
  owner: string;
  createdAt: number;
  updatedAt: number;
  title: string;
  kind: WriterKind;
  clientId: string | null;
  product: { name: string; info: string };
  /** AI 가 읽어 내고 사람이 고칠 수 있는 확인된 사실 */
  facts: string[];
  checks: string[];
  reference: { kind: WriterRefKind; id: string | null; name: string };
  basis: WriterBasis | null;
  targetSec: number;
  ctaKeyword: string;
  model: string;
  photos: WriterPhotoMeta[];
  script: WriterScript | null;
  versions: WriterVersion[];
  messages: WriterMessage[];
  costUsd: number;
  /** 「이 대본으로 영상 만들기」 로 만든 영상 */
  projectId: string | null;
  /** 목록용 — 버전 수 · 첫 사진 미리보기 (목록은 이것만 읽는다) */
  versionCount: number;
  cover: string | null;
}

export type ScriptSessionSummary = Pick<ScriptSessionDoc, "title" | "kind" | "updatedAt" | "createdAt" | "costUsd" | "projectId" | "versionCount" | "cover"> & {
  id: string;
  product: string;
};

// ---- 다듬기 -----------------------------------------------------------------

const BEATS: BeatKey[] = ["hook", "problem", "empathy", "reveal", "demo", "compare", "twist", "proof", "cta"];
const CTA_TYPES: CtaPlan["type"][] = ["comment_keyword", "dm_keyword", "link_in_bio", "pinned_comment", "description_link", "other"];
const s = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");
const num = (v: unknown, lo: number, hi: number, d: number) => {
  const x = Number(v);
  return Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : d;
};

/**
 * AI 가 준 대본을 저장할 모양으로 — 길이 · 개수를 자르고, 줄이 없는 장면 번호를 가리키지 않게,
 * 없는 사진 번호를 쓰지 않게(사진 장면이면 AI 장면으로 바꾼다) 고친다.
 */
export function sanitizeWriterScript(raw: unknown, photoCount: number): WriterScript {
  const r = (raw ?? {}) as Record<string, unknown>;
  const cta = (r.cta ?? {}) as Record<string, unknown>;
  const scenes: WriterScene[] = (Array.isArray(r.scenes) ? r.scenes : []).slice(0, 20).map((x) => {
    const sc = (x ?? {}) as Record<string, unknown>;
    let kind: WriterScene["kind"] = sc.kind === "image" || sc.kind === "clip" ? sc.kind : "ai";
    const p = Number.isInteger(sc.photo) && (sc.photo as number) >= 0 && (sc.photo as number) < photoCount ? (sc.photo as number) : null;
    if (kind === "image" && p === null) kind = photoCount ? "image" : "ai";
    return {
      label: s(sc.label, 80) || "장면",
      kind,
      durationSec: Math.round(num(sc.durationSec, 0.5, 30, 3) * 10) / 10,
      visual: s(sc.visual, 400),
      aiPrompt: kind === "ai" ? s(sc.aiPrompt, 1500) : "",
      photo: kind === "image" ? (p ?? 0) : null,
    };
  });
  if (!scenes.length) scenes.push({ label: "장면 1", kind: "ai", durationSec: 3, visual: "", aiPrompt: "", photo: null });
  const lines: WriterLine[] = (Array.isArray(r.lines) ? r.lines : [])
    .slice(0, 40)
    .map((x) => {
      const l = (x ?? {}) as Record<string, unknown>;
      return {
        beat: BEATS.includes(l.beat as BeatKey) ? (l.beat as BeatKey) : "demo",
        text: s(l.text, 300),
        caption: s(l.caption, 120),
        scene: Math.min(scenes.length - 1, Math.max(0, Math.round(Number(l.scene) || 0))),
      };
    })
    .filter((l) => l.text || l.caption);
  return {
    title: s(r.title, 100) || "제목 없음",
    hook: s(r.hook, 200),
    targetSec: Math.round(num(r.targetSec, 5, 180, 30)),
    description: s(r.description, 2000),
    hashtags: [...new Set((Array.isArray(r.hashtags) ? r.hashtags : []).map((h) => s(h, 40).replace(/^#+/, "")).filter(Boolean))].slice(0, 12),
    cta: {
      type: CTA_TYPES.includes(cta.type as CtaPlan["type"]) ? (cta.type as CtaPlan["type"]) : "other",
      keyword: s(cta.keyword, 30),
      wording: s(cta.wording, 200),
      atSec: cta.atSec === null || cta.atSec === undefined || !Number.isFinite(Number(cta.atSec)) ? null : Math.max(0, Number(cta.atSec)),
    },
    scenes,
    lines,
  };
}

/** 장면 길이 합 (초) */
export const writerTotalSec = (sc: Pick<WriterScript, "scenes">) => Math.round(sc.scenes.reduce((n, x) => n + x.durationSec, 0) * 10) / 10;

/** 장면마다 시작 · 끝 초 */
export function writerTimeline(sc: Pick<WriterScript, "scenes">): { from: number; to: number }[] {
  let t = 0;
  return sc.scenes.map((x) => {
    const from = t;
    t = Math.round((t + x.durationSec) * 10) / 10;
    return { from, to: t };
  });
}

/** 복사용 글 — 메모장 · 노션 · 카톡에 붙여 넣기 좋게 */
export function writerScriptText(sc: WriterScript, beatLabel: Record<BeatKey, string>): string {
  const tl = writerTimeline(sc);
  const out: string[] = [`제목: ${sc.title}`, sc.hook ? `훅: ${sc.hook}` : "", `길이: 약 ${writerTotalSec(sc)}초`, ""];
  sc.scenes.forEach((x, i) => {
    out.push(`[장면 ${i + 1} · ${tl[i].from}~${tl[i].to}초 · ${x.kind === "image" ? `제품 사진 ${(x.photo ?? 0) + 1}` : x.kind === "ai" ? "AI 생성" : "직접 촬영"}] ${x.label}`);
    if (x.visual) out.push(`  화면: ${x.visual}`);
    for (const l of sc.lines.filter((y) => y.scene === i)) {
      out.push(`  (${beatLabel[l.beat]}) ${l.text}`);
      if (l.caption && l.caption !== l.text) out.push(`    자막: ${l.caption}`);
    }
    if (x.aiPrompt) out.push(`  AI 프롬프트: ${x.aiPrompt}`);
  });
  out.push("", `CTA: ${sc.cta.wording}${sc.cta.keyword ? ` (키워드 ${sc.cta.keyword})` : ""}`, "", sc.description, sc.hashtags.length ? sc.hashtags.map((h) => `#${h}`).join(" ") : "");
  return out.filter((l, i, a) => !(l === "" && a[i - 1] === "")).join("\n").trim();
}

/** 끝에서 n 개만 남긴다 (대화 · 버전) */
export const keepLast = <T,>(xs: T[], n: number) => (xs.length > n ? xs.slice(xs.length - n) : xs);

/** 확인된 사실 다듬기 — 빈 줄 · 겹침 · 길이 */
export const cleanFacts = (xs: unknown, max = 20) =>
  [...new Set((Array.isArray(xs) ? xs : []).map((x) => s(x, 200)).filter(Boolean))].slice(0, max);
