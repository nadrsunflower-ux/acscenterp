import "server-only";

// ============================================================
//  레퍼런스 영상 컷 표 — 만들기 · 읽기 · 지우기 (neander_shorts_cuts, 프로젝트마다 따로)
// ------------------------------------------------------------
//  AI(Gemini)가 공개 YouTube 영상을 직접 보고 컷 전환마다 화면 · 말 · 화면 글자 · 소리 · 초를 받아 적는다.
//  같은 영상은 한 번만 — 이미 있으면 다시 만들기(force)를 누르기 전에는 AI 를 부르지 않는다.
//  하루 상한은 프로젝트마다 30편. 상한 계수기(store.ts takeQuota)는 rootDb 의 설정 컬렉션에 쓰여
//  프로젝트로 감싸도 키가 갈리지 않는다 → 키에 프로젝트 id 를 넣는다.
//  제목 · 채널 · 길이는 YouTube API 로(검색 한도를 쓰지 않는 videos.list), 키가 없으면 레이더 · 터진 영상에
//  이미 받아 둔 값으로. 그것도 없으면 비워 두고 AI 가 본 길이를 「AI」 로 적는다.
// ============================================================

import type { Firestore } from "firebase-admin/firestore";
import { AccessError } from "@/lib/neander/server/auth";
import { NEANDER_COL } from "@/lib/neander/collections";
import {
  CUTS_DAILY_LIMIT,
  CUT_NOTE_MAX,
  cutIdOf,
  isCutId,
  normalizeYoutubeVideoUrl,
  sanitizeCutResult,
  type Cut,
  type CutSheet,
  type CutSheetDoc,
  type CutSheetSummary,
} from "../cuts";
import { BEAT_LABEL } from "../model";
import type { BeatKey } from "../types";
import { isShortsAdmin } from "./access";
import { complete, DEFAULT_SCOUT_VIDEO_MODEL, SCOUT_VIDEO_MODELS } from "./scout-ai";
import { stampSpace } from "./space-db";
import { readQuota, takeQuota } from "./store";
import { youtubeVideos } from "./youtube-data";

const col = (db: Firestore) => db.collection(NEANDER_COL.shortsCuts);
const kstDay = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
/** 하루 상한 키 — 프로젝트마다 (계수기가 전역 컬렉션이라 키로 가른다) */
const quotaKey = (db: Firestore) => `cuts_${stampSpace(db)}_${kstDay()}`;
const videoModel = (m: unknown) => (SCOUT_VIDEO_MODELS.some((x) => x.id === m) ? (m as string) : DEFAULT_SCOUT_VIDEO_MODEL);
const str = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");

// ---- AI 만 부르는 부분 (저장 없음 — 실호출 확인 스크립트도 이것만 부른다) -------------------

const S = { type: "string" };
const BEAT_ENUM = [...(Object.keys(BEAT_LABEL) as BeatKey[]), "none"];
const CUTS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["hook", "summary", "totalSec", "cuts"],
  properties: {
    hook: S,
    summary: S,
    totalSec: { type: ["number", "null"] },
    cuts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["from", "to", "shot", "speech", "caption", "sound", "beat"],
        properties: {
          from: { type: "number" },
          to: { type: "number" },
          shot: S,
          speech: S,
          caption: S,
          sound: S,
          beat: { type: "string", enum: BEAT_ENUM },
        },
      },
    },
  },
};

const CUTS_SYSTEM = `너는 한국의 숏폼 영상 기획사에서 남의 잘된 쇼츠를 「컷 표」 로 받아 적는 사람이다. 영상을 직접 보고(화면 · 소리 · 자막) 컷 전환마다 한 줄씩 적는다. 이 표로 다른 제품의 대본 구조를 짠다.

원칙:
- 컷 전환(화면이 끊기고 바뀌는 곳)마다 한 줄. 한 장면이 끊기지 않고 이어지면 한 줄이다. 같은 동작을 잇는 빠른 점프컷은 한 줄로 묶어도 된다. 60줄을 넘기지 않는다.
- from · to 는 그 컷의 시작 · 끝 초(소수 한 자리). 대략이라도 영상에서 본 값을 쓴다 — 고르게 나눈 값을 지어내지 않는다. 시간 순서로, 앞 컷의 끝 = 다음 컷의 시작.
- shot: 화면에 보이는 것만 한국어 한 줄 — 무엇이 · 무엇을 하는지 · 구도(클로즈업 · 손 · 얼굴 · 전신 · 위에서) · 카메라 움직임. 해석 · 평가 · 짐작을 쓰지 않는다.
- speech: 들린 말(내레이션 · 대사)을 들린 그대로. 번역하지 않는다. 한국어가 아니면 원문 그대로 적고 끝에 「(뜻: 짧은 한국어)」 를 붙인다. 잘 안 들리면 들린 만큼만 적고 「(잘 안 들림)」. 말이 없으면 "".
- caption: 화면에 나온 글자(자막 · 텍스트 효과 · 표지판이 아닌 편집으로 넣은 글자)를 보이는 그대로. 없으면 "".
- sound: 효과음 · 음악(분위기 · 박자 · 바뀌는 곳). 곡 이름은 화면에 나와 있을 때만 쓴다 — 지어내지 않는다. 없으면 "".
- beat: 이 컷이 하는 일 — hook(첫 시선 끌기) · problem(문제 제기) · empathy(공감) · reveal(제품 · 주인공 등장) · demo(사용 · 시연) · compare(전후 · 비교) · twist(반전) · proof(근거 · 결과) · cta(행동 유도) · none(어느 것도 아님).
- hook: 첫 2초에 보이고 들리는 것을 구체적으로 한두 줄.
- summary: 영상 전체 흐름을 한 줄로 (무엇을 어떤 순서로 보여 주나).
- totalSec: 영상 길이(초). 모르면 null.
- 보지 못한 장면 · 들리지 않은 말을 지어내지 않는다. 영상을 볼 수 없었다면 cuts 를 비우고 summary 를 「영상을 보지 못함」 으로 쓴다.
- 「사람 메모」 가 있으면 이 영상을 본 사람이 남긴 것이다. 메모가 짚은 장면 · 관심(예: 「훅만 자세히」 「손 클로즈업 위주」)을 받아 적는 초점으로 삼는다.
  영상에서 보이고 들리는 것과 메모가 어긋나면 영상을 따르고 summary 끝에 「(메모와 다름: 한 줄)」 을 붙인다. 메모에 없는 사실을 지어내지 않는다.`;

export interface CutsAiResult {
  hook: string;
  summary: string;
  cuts: Cut[];
  /** AI 가 본 영상 길이 (모르면 null) */
  aiTotalSec: number | null;
  costUsd: number;
  model: string;
}

/** AI 만 부른다 — 저장 · 상한 없음 (makeCuts 가 그 앞뒤를 맡는다) */
export async function analyzeCuts(input: { url: string; title: string; channel: string; durationSec: number | null; note?: string; model?: unknown }): Promise<CutsAiResult> {
  const ref = normalizeYoutubeVideoUrl(input.url);
  // YouTube 밖 주소는 보내지 않는다 (Gemini 가 공개 YouTube 주소만 직접 본다)
  if (!ref || ref.url !== input.url) throw new Error("AI 가 직접 볼 수 있는 것은 YouTube 영상뿐입니다.");
  const model = videoModel(input.model);
  const text = [
    `영상: ${input.title || "(제목 모름)"} · 채널 ${input.channel || "?"} · 길이 ${input.durationSec ? `${Math.round(input.durationSec)}초 (YouTube)` : "모름"}`,
    ...(input.note?.trim() ? ["", `사람 메모: ${input.note.trim().slice(0, CUT_NOTE_MAX)}`] : []),
    "",
    "이 영상을 컷 표로 받아 적어 주세요.",
  ].join("\n");
  const r = await complete(
    {
      model,
      provider: { require_parameters: true },
      max_tokens: 12000,
      messages: [
        { role: "system", content: CUTS_SYSTEM },
        { role: "user", content: [{ type: "text", text }, { type: "video_url", video_url: { url: input.url } }] },
      ],
      response_format: { type: "json_schema", json_schema: { name: "cut_sheet", strict: true, schema: CUTS_SCHEMA } },
      usage: { include: true },
    },
    110_000,
  );
  let raw: unknown;
  try {
    raw = JSON.parse(r.content);
  } catch {
    throw new Error(r.finish === "length" ? "AI 응답이 너무 길어 잘렸습니다 — 메모에 「앞 30초만」 처럼 범위를 적고 다시 해 보세요." : "AI 응답 형식을 읽지 못했습니다. 다시 시도해 주세요.");
  }
  const out = sanitizeCutResult(raw, input.durationSec);
  return { ...out, costUsd: r.costUsd, model };
}

// ---- 저장 · 읽기 ----------------------------------------------------------------

export async function getCuts(db: Firestore, id: unknown): Promise<CutSheet | null> {
  if (!isCutId(id)) throw new Error("컷 표 id 가 올바르지 않습니다 (yt_ + 영상 id).");
  const d = (await col(db).doc(id).get()).data() as CutSheetDoc | undefined;
  return d ? { ...d, id } : null;
}

/** 최근 컷 표 — 목록용 요약만 (컷 배열은 읽지 않는다) */
export async function listCuts(db: Firestore, limit = 30): Promise<CutSheetSummary[]> {
  const snap = await col(db).orderBy("at", "desc").limit(limit).select("videoId", "url", "title", "channel", "durationSec", "cutCount", "hook", "at", "by", "owner", "costUsd").get();
  return snap.docs.map((d) => {
    const x = d.data() as Partial<CutSheetDoc>;
    return {
      id: d.id,
      videoId: x.videoId ?? d.id.slice(3),
      url: x.url ?? "",
      title: x.title ?? "",
      channel: x.channel ?? "",
      durationSec: x.durationSec ?? null,
      cutCount: x.cutCount ?? 0,
      hook: x.hook ?? "",
      at: x.at ?? 0,
      by: x.by ?? "",
      owner: x.owner ?? "",
      costUsd: x.costUsd ?? 0,
    };
  });
}

export async function cutsToday(db: Firestore): Promise<{ used: number; limit: number }> {
  return { used: await readQuota(db, quotaKey(db)), limit: CUTS_DAILY_LIMIT };
}

/** 제목 · 채널 · 길이 — YouTube API (키가 있으면) → 이 프로젝트의 레이더 · 터진 영상에 받아 둔 값 */
async function videoMeta(db: Firestore, videoId: string, key: string | undefined): Promise<{ title: string; channel: string; durationSec: number | null }> {
  if (key) {
    try {
      const [v] = await youtubeVideos([videoId], key);
      if (!v) throw new AccessError(404, "영상을 찾지 못했습니다 (지워졌거나 비공개). 공개된 YouTube 영상만 컷 표로 만들 수 있습니다.");
      return { title: v.title, channel: v.channel, durationSec: v.duration > 0 ? v.duration : null };
    } catch (e) {
      if (e instanceof AccessError) throw e;
      // 키 한도 · 일시 오류 — 받아 둔 값으로 넘어간다 (길이는 AI 가 본 값)
    }
  }
  const id = cutIdOf(videoId);
  const [radar, hit] = await Promise.all([db.collection(NEANDER_COL.shortsRadar).doc(id).get(), db.collection(NEANDER_COL.shortsHits).doc(id).get()]);
  const r = radar.data() as { title?: string; channel?: string; duration?: number } | undefined;
  const h = hit.data() as { title?: string; channel?: string; duration?: number | null } | undefined;
  const dur = (r?.duration ?? 0) > 0 ? r!.duration! : (h?.duration ?? 0) > 0 ? h!.duration! : null;
  return { title: r?.title || h?.title || "", channel: r?.channel || h?.channel || "", durationSec: dur };
}

/**
 * 컷 표 만들기 — 같은 영상이 이미 있으면 force 없이는 그대로 돌려준다(AI 안 부름).
 * 순서: 주소 확인 → 영상 정보(상한 쓰기 전 — 잘못된 주소가 상한을 먹지 않게) → 하루 상한 → AI → 저장.
 */
export async function makeCuts(
  db: Firestore,
  email: string,
  input: { url?: unknown; note?: unknown; model?: unknown; force?: unknown; key?: string },
): Promise<{ cut: CutSheet; reused: boolean; costUsd: number }> {
  const ref = normalizeYoutubeVideoUrl(input.url);
  if (!ref) throw new Error("YouTube 영상 주소를 넣어 주세요 (watch · shorts · youtu.be 주소).");
  const id = cutIdOf(ref.videoId);
  const prev = await getCuts(db, id);
  if (prev && input.force !== true) return { cut: prev, reused: true, costUsd: 0 };
  const note = typeof input.note === "string" ? str(input.note, CUT_NOTE_MAX) : (prev?.note ?? "");
  const meta = await videoMeta(db, ref.videoId, input.key);
  const q = await takeQuota(db, quotaKey(db), CUTS_DAILY_LIMIT);
  if (!q.ok) throw new Error(`오늘 이 프로젝트에서 컷 표를 ${CUTS_DAILY_LIMIT}편 만들었습니다 (하루 상한). 내일 다시 해 주세요.`);
  const ai = await analyzeCuts({ url: ref.url, title: meta.title, channel: meta.channel, durationSec: meta.durationSec, note, model: input.model });
  if (!ai.cuts.length) throw new Error(`AI 가 컷을 받아 적지 못했습니다${ai.summary ? ` — ${ai.summary.slice(0, 120)}` : ""}. 비용 약 $${ai.costUsd.toFixed(4)} 가 들었습니다.`);
  const now = Date.now();
  const durationSec = meta.durationSec ?? ai.aiTotalSec;
  const doc: CutSheetDoc = {
    owner: prev?.owner ?? email,
    createdAt: prev?.createdAt ?? now,
    updatedAt: now,
    updatedBy: email,
    videoId: ref.videoId,
    url: ref.url,
    title: str(meta.title, 200),
    channel: str(meta.channel, 120),
    durationSec: durationSec ? Math.round(durationSec * 10) / 10 : null,
    durationSrc: meta.durationSec ? "api" : ai.aiTotalSec ? "ai" : null,
    cuts: ai.cuts,
    cutCount: ai.cuts.length,
    hook: ai.hook,
    summary: ai.summary,
    model: ai.model,
    costUsd: Math.round(ai.costUsd * 1e6) / 1e6,
    at: now,
    by: email,
    note,
  };
  await col(db).doc(id).set(doc);
  return { cut: { ...doc, id }, reused: false, costUsd: ai.costUsd };
}

/** 지우기 — 만든 사람 · 관리자 */
export async function deleteCuts(db: Firestore, email: string, id: unknown): Promise<void> {
  const d = await getCuts(db, id);
  if (!d) throw new AccessError(404, "컷 표를 찾지 못했습니다 — 이미 지워졌을 수 있습니다.");
  if (d.owner !== email && !isShortsAdmin(email)) throw new AccessError(403, "컷 표는 만든 사람이나 관리자만 지웁니다.");
  await col(db).doc(d.id).delete();
}
