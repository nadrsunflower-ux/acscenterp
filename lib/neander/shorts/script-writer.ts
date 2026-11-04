// ============================================================
//  대본 작성기 (/neander/shorts/scripts) — 제품 사진 · 정보 + 분석(바이럴 형식 · 성공 공식 · AI 레이더)으로
//  소개 영상 대본을 쓰고, 채팅으로 고쳐 간다. 순수 함수 · 모양만 둔다 (브라우저 · 서버 공용).
// ------------------------------------------------------------
//  · 대본 세션은 사람마다 따로(비공개). 고칠 때마다 버전을 남기고 되돌릴 수 있다.
//  · 사진은 처음 쓸 때 · 새로 붙일 때만 AI 에 보여 주고, AI 가 읽어 낸 「확인된 사실」 을 글로 이어 간다.
//  · 장면은 이 회사 방식 그대로 — 제품 사진(image) · AI 생성(ai) · 직접 찍어야 하는 장면(clip, 되도록 적게).
//  · 「이 대본으로 영상 만들기」 는 기존 영상(프로젝트)으로 옮긴다 (server/script-writer.ts).
//  · 영상 방식 두 가지 — 제품 소개(리뷰형) · 스토리 광고(캐릭터 · 갈등 → 제품이 해결 → 역전 → 엔드카드).
//    스토리 광고는 로그라인 · 캐릭터 시트(영문 고정 묘사) · 막 구조 · 컷별 카메라 · 소리 · 이어 붙이기 · 엔드카드까지 쓴다.
// ============================================================

import type { BeatKey, CtaPlan } from "./types";

export type WriterKind = "coupang" | "general" | "brand";
export const WRITER_KIND_LABEL: Record<WriterKind, string> = { coupang: "쿠팡 제휴", general: "일반 정보 (제휴 없음)", brand: "고객사 브랜드" };

// cut = 레퍼런스 영상 컷 표 (shorts/cuts.ts) — 남의 잘된 쇼츠를 컷 단위로 뜯은 것. 구조만 옮기고 내용은 새로 쓴다
export type WriterRefKind = "auto" | "format" | "template" | "radar" | "cut";
export const WRITER_REF_LABEL: Record<WriterRefKind, string> = { auto: "AI 가 고르기", format: "바이럴 형식 카드", template: "성공 공식", radar: "AI 레이더 후보", cut: "레퍼런스 영상 컷 표" };
/** 고르는 칸의 묶음 순서 */
export const WRITER_REF_KINDS: Exclude<WriterRefKind, "auto">[] = ["cut", "format", "template", "radar"];

/**
 * 다른 화면이 주소로 넘기는 참고 분석 — `?ref=<kind>:<id>` (예: 컷 표의 「이 구조로 대본 쓰기」 · 형식 카드의 「이 형식으로 대본 쓰기」).
 * 모양이 틀리면 null (그때는 「AI 가 고르기」).
 */
export function parseWriterRefParam(v: string | null | undefined): { kind: Exclude<WriterRefKind, "auto">; id: string } | null {
  const m = /^(cut|format|template|radar):([\w-]{6,80})$/.exec((v ?? "").trim());
  return m ? { kind: m[1] as Exclude<WriterRefKind, "auto">, id: m[2] } : null;
}

export type WriterStyle = "intro" | "story";
export const WRITER_STYLE_LABEL: Record<WriterStyle, string> = { intro: "제품 소개 (리뷰형)", story: "스토리 광고" };

export const STORY_TONES = ["코믹", "반전", "감동", "긴장감", "밈 · 패러디"] as const;
export const STORY_LOOKS = ["3D 애니메이션 (픽사풍)", "실사", "2D 만화", "클레이 · 스톱모션"] as const;

/** 스토리 광고를 처음 쓸 때 사람이 주는 재료 (모두 선택) */
export interface StoryInput {
  /** 이 제품이 해결하는 문제 · 핵심 장점 — 스토리의 갈등이 된다 */
  problem: string;
  /** 스토리 아이디어 · 무대 · 하고 싶은 장면 */
  idea: string;
  /** 주인공 · 등장인물 */
  characters: string;
  tone: string;
  /** 그림체 */
  look: string;
  /** 엔드카드에 넣을 것 (가격 · 할인 · 문구) */
  endCard: string;
}

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
  /** 스토리 광고 — 카메라(구도 · 움직임) · 소리(효과음 · 음악 분위기) · 앞 컷과 잇는 법(기준 이미지 · 첫 화면) */
  camera?: string;
  sound?: string;
  continuity?: string;
}

export interface StoryCharacter {
  name: string;
  /** 주인공 · 라이벌 · 조연 · 보호자 … */
  role: string;
  /** 한국어 외형 · 성격 */
  look: string;
  /** 모든 AI 장면 프롬프트에 그대로 붙이는 영문 고정 묘사 (생김새가 컷마다 바뀌지 않게) */
  lookPrompt: string;
}

export interface WriterStory {
  logline: string;
  /** 캐치프레이즈 (엔드카드 · 자막) */
  catchphrase: string;
  /** 그림체 · 화면 질감 (모든 AI 프롬프트 공통) */
  look: string;
  characters: StoryCharacter[];
  /** 막 구조 — 설정 · 문제 · 굴욕 · 제품 개입 · 역전 · 엔드카드 … */
  acts: { name: string; fromSec: number; toSec: number; summary: string }[];
  /** 엔드카드 — 실제 제품 사진 위에 */
  endCard: { visual: string; text: string; cta: string };
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
  /** 스토리 광고일 때만 */
  story?: WriterStory | null;
}

export interface WriterBasis {
  kind: "format" | "template" | "radar" | "cut" | "none";
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
  /** 영상 방식 — 예전 세션엔 없다(= 제품 소개) */
  style?: WriterStyle;
  /** 스토리 광고 재료 */
  storyInput?: StoryInput | null;
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

export type ScriptSessionSummary = Pick<ScriptSessionDoc, "title" | "kind" | "style" | "updatedAt" | "createdAt" | "costUsd" | "projectId" | "versionCount" | "cover"> & {
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
export function sanitizeWriterScript(raw: unknown, photoCount: number, style: WriterStyle = "intro"): WriterScript {
  const r = (raw ?? {}) as Record<string, unknown>;
  const story = style === "story";
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
      aiPrompt: kind === "ai" ? s(sc.aiPrompt, 2500) : "",
      photo: kind === "image" ? (p ?? 0) : null,
      ...(story ? { camera: s(sc.camera, 200), sound: s(sc.sound, 200), continuity: s(sc.continuity, 200) } : {}),
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
    ...(story ? { story: sanitizeStory(r.story) } : {}),
  };
}

function sanitizeStory(raw: unknown): WriterStory {
  const r = (raw ?? {}) as Record<string, unknown>;
  const end = (r.endCard ?? {}) as Record<string, unknown>;
  return {
    logline: s(r.logline, 300),
    catchphrase: s(r.catchphrase, 80),
    look: s(r.look, 300),
    characters: (Array.isArray(r.characters) ? r.characters : []).slice(0, 6).map((x) => {
      const c = (x ?? {}) as Record<string, unknown>;
      return { name: s(c.name, 40) || "이름 없음", role: s(c.role, 40), look: s(c.look, 300), lookPrompt: s(c.lookPrompt, 600) };
    }),
    acts: (Array.isArray(r.acts) ? r.acts : []).slice(0, 8).map((x) => {
      const a = (x ?? {}) as Record<string, unknown>;
      const from = num(a.fromSec, 0, 180, 0);
      return { name: s(a.name, 30) || "구간", fromSec: from, toSec: Math.max(from, num(a.toSec, 0, 180, from)), summary: s(a.summary, 300) };
    }),
    endCard: { visual: s(end.visual, 300), text: s(end.text, 200), cta: s(end.cta, 120) },
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
  const st = sc.story;
  if (st) {
    if (st.logline) out.push(`로그라인: ${st.logline}`);
    if (st.catchphrase) out.push(`캐치프레이즈: ${st.catchphrase}`);
    if (st.look) out.push(`그림체: ${st.look}`);
    if (st.characters.length) {
      out.push("", "등장인물:");
      for (const c of st.characters) out.push(`- ${c.name}${c.role ? ` (${c.role})` : ""}: ${c.look}${c.lookPrompt ? `\n  영문 고정 묘사: ${c.lookPrompt}` : ""}`);
    }
    if (st.acts.length) {
      out.push("", "구성:");
      for (const a of st.acts) out.push(`- ${a.name} ${a.fromSec}~${a.toSec}초: ${a.summary}`);
    }
    out.push("");
  }
  sc.scenes.forEach((x, i) => {
    out.push(`[장면 ${i + 1} · ${tl[i].from}~${tl[i].to}초 · ${x.kind === "image" ? `제품 사진 ${(x.photo ?? 0) + 1}` : x.kind === "ai" ? "AI 생성" : "직접 촬영"}] ${x.label}`);
    if (x.visual) out.push(`  화면: ${x.visual}`);
    if (x.camera) out.push(`  카메라: ${x.camera}`);
    if (x.sound) out.push(`  소리: ${x.sound}`);
    if (x.continuity) out.push(`  이어 붙이기: ${x.continuity}`);
    for (const l of sc.lines.filter((y) => y.scene === i)) {
      out.push(`  (${beatLabel[l.beat]}) ${l.text}`);
      if (l.caption && l.caption !== l.text) out.push(`    자막: ${l.caption}`);
    }
    if (x.aiPrompt) out.push(`  AI 프롬프트: ${x.aiPrompt}`);
  });
  if (st && (st.endCard.visual || st.endCard.text)) out.push("", `엔드카드: ${st.endCard.visual}${st.endCard.text ? ` · 문구 「${st.endCard.text}」` : ""}${st.endCard.cta ? ` · ${st.endCard.cta}` : ""}`);
  out.push("", `CTA: ${sc.cta.wording}${sc.cta.keyword ? ` (키워드 ${sc.cta.keyword})` : ""}`, "", sc.description, sc.hashtags.length ? sc.hashtags.map((h) => `#${h}`).join(" ") : "");
  return out.filter((l, i, a) => !(l === "" && a[i - 1] === "")).join("\n").trim();
}

/**
 * AI 가 적은 근거(basis)를 우리가 넘긴 분석 안에서만 — 고른 분석이 하나(fixed)면 그것으로 고정(종류 · id · 이름은 우리 값),
 * 「AI 가 고르기」 면 넘긴 목록(ids = `kind:id`)에 있는 것만 남기고 지어낸 id 는 「근거 없음」 으로 (server/script-writer.ts).
 */
export function checkWriterBasis(
  basis: WriterBasis,
  ref: { kind: WriterRefKind; id: string | null; name: string },
  given: { mode: "fixed" | "auto"; ids: string[] },
): WriterBasis {
  if (given.mode === "fixed" && ref.kind !== "auto" && ref.id) return { kind: ref.kind, id: ref.id, name: ref.name || basis.name, why: basis.why };
  if (basis.kind === "none" || !given.ids.includes(`${basis.kind}:${basis.id}`)) return { kind: "none", id: "", name: "", why: basis.kind === "none" ? basis.why : "" };
  return basis;
}

/** 끝에서 n 개만 남긴다 (대화 · 버전) */
export const keepLast = <T,>(xs: T[], n: number) => (xs.length > n ? xs.slice(xs.length - n) : xs);

/** 확인된 사실 다듬기 — 빈 줄 · 겹침 · 길이 */
export const cleanFacts = (xs: unknown, max = 20) =>
  [...new Set((Array.isArray(xs) ? xs : []).map((x) => s(x, 200)).filter(Boolean))].slice(0, max);

/** 스토리 광고 재료 다듬기 */
export function cleanStoryInput(raw: unknown): StoryInput {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    problem: s(r.problem, 600),
    idea: s(r.idea, 1500),
    characters: s(r.characters, 800),
    tone: s(r.tone, 30),
    look: s(r.look, 60),
    endCard: s(r.endCard, 300),
  };
}
