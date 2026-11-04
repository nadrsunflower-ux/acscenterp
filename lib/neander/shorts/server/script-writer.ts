import "server-only";

// ============================================================
//  대본 작성기 저장 · 실행 — neander_shorts_scripts (사람마다 비공개)
// ------------------------------------------------------------
//  세션 하나 = 제품 하나의 대본 대화. 사진 원본(1024px JPEG data URL)은 하위 photos 에,
//  세션 문서에는 작은 미리보기만 둔다(문서 1MB 한도). 버전은 15개, 대화는 60개까지.
//  AI 는 사람이 「보내기」 를 눌렀을 때만 부른다 (server/ai.ts writerTurn). 실패해도 사람 말은 남긴다.
// ============================================================

import { randomBytes } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import { AccessError } from "@/lib/neander/server/auth";
import { NEANDER_COL } from "@/lib/neander/collections";
import { BEAT_LABEL, newId } from "../model";
import {
  WRITER_LENGTHS,
  WRITER_MAX_MESSAGES,
  WRITER_MAX_PHOTOS,
  WRITER_MAX_VERSIONS,
  WRITER_MESSAGE_MAX,
  WRITER_PHOTO_MAX_CHARS,
  WRITER_THUMB_MAX_CHARS,
  checkWriterBasis,
  cleanFacts,
  cleanStoryInput,
  keepLast,
  type ScriptSessionDoc,
  type ScriptSessionSummary,
  type WriterKind,
  type WriterPhotoMeta,
  type WriterRef,
  type WriterRefKind,
  type WriterStyle,
} from "../script-writer";
import { cutReferenceText } from "../cuts";
import type { FormatDoc } from "../scout";
import type { RadarDoc } from "../radar";
import type { Scene, ScriptLine, TemplateDoc } from "../types";
import { shortsTextModel, writerTurn, type WriterTurnInput } from "./ai";
import { getClientDoc, createClientProject } from "./clients";
import { listRadar } from "./radar-run";
import { listFormats } from "./scout-store";
import { createProject, listTemplates, patchProject } from "./store";
import { getCuts, listCuts } from "./cuts";
import { isShortsAdmin } from "./access";

type WithId<T> = T & { id: string };
const col = (db: Firestore) => db.collection(NEANDER_COL.shortsScripts);
const newDocId = () => randomBytes(12).toString("base64url");
const isDocId = (v: unknown): v is string => typeof v === "string" && /^[\w-]{6,60}$/.test(v);
const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const KINDS: WriterKind[] = ["coupang", "general", "brand"];
const REF_KINDS: WriterRefKind[] = ["auto", "format", "template", "radar", "cut"];

export interface WriterPhotoInput {
  name: string;
  /** 1024px 안팎 JPEG · PNG · WEBP data URL */
  dataUrl: string;
  /** 160px 미리보기 data URL */
  thumb: string;
}

const PHOTO_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;

function cleanPhotos(input: unknown, room: number): WriterPhotoInput[] {
  const list = Array.isArray(input) ? input : [];
  if (list.length > room) throw new Error(`사진은 한 대본에 ${WRITER_MAX_PHOTOS}장까지입니다 (지금 더 붙일 수 있는 것 ${room}장).`);
  return list.map((x) => {
    const p = (x ?? {}) as Record<string, unknown>;
    const dataUrl = typeof p.dataUrl === "string" ? p.dataUrl : "";
    const thumb = typeof p.thumb === "string" ? p.thumb : "";
    if (!PHOTO_RE.test(dataUrl) || dataUrl.length > WRITER_PHOTO_MAX_CHARS) throw new Error("사진은 JPG · PNG · WEBP 로, 한 장 약 500KB 안이어야 합니다 (화면이 줄여서 보냅니다 — 다시 붙여 보세요).");
    if (!PHOTO_RE.test(thumb) || thumb.length > WRITER_THUMB_MAX_CHARS) throw new Error("사진 미리보기를 만들지 못했습니다. 다시 붙여 보세요.");
    return { name: str(p.name, 80) || "사진", dataUrl, thumb };
  });
}

async function getOwn(db: Firestore, email: string, id: unknown, read = false): Promise<WithId<ScriptSessionDoc>> {
  if (!isDocId(id)) throw new Error("대본 id 가 올바르지 않습니다.");
  const d = (await col(db).doc(id).get()).data() as ScriptSessionDoc | undefined;
  if (!d) throw new AccessError(404, "대본을 찾지 못했습니다 — 지워졌을 수 있습니다.");
  // 대본은 쓴 사람만 고친다 (관리자는 읽기만)
  if (d.owner !== email && !(read && isShortsAdmin(email))) throw new AccessError(403, "다른 사람의 대본입니다.");
  return { ...d, id };
}

export async function listScriptSessions(db: Firestore, email: string): Promise<ScriptSessionSummary[]> {
  const snap = await col(db).where("owner", "==", email).select("title", "kind", "style", "updatedAt", "createdAt", "costUsd", "projectId", "product", "versionCount", "cover").get();
  return snap.docs
    .map((d) => {
      const x = d.data() as Partial<ScriptSessionDoc>;
      return {
        id: d.id,
        title: x.title ?? "",
        kind: x.kind ?? "coupang",
        style: x.style ?? "intro",
        updatedAt: x.updatedAt ?? 0,
        createdAt: x.createdAt ?? 0,
        costUsd: x.costUsd ?? 0,
        projectId: x.projectId ?? null,
        product: x.product?.name ?? "",
        versionCount: x.versionCount ?? 0,
        cover: x.cover ?? null,
      };
    })
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export const getScriptSession = (db: Firestore, email: string, id: unknown) => getOwn(db, email, id, true);

// ---- 참고 분석 ---------------------------------------------------------------

const line = (...xs: (string | undefined | null | false)[]) => xs.filter(Boolean).join(" · ");

/** 고르는 칸의 목록 — 레퍼런스 영상 컷 표(최근 30) · 바이럴 형식 카드(회사 공용) · 내 성공 공식 · AI 레이더 후보(상품을 짚은 것) */
export async function writerReferences(db: Firestore, email: string): Promise<WriterRef[]> {
  const [cuts, formats, templates, radar] = await Promise.all([listCuts(db).catch(() => []), listFormats(db).catch(() => []), listTemplates(db, email).catch(() => []), listRadar(db).catch(() => [])]);
  return [
    ...cuts.map((c): WriterRef => ({ kind: "cut", id: c.id, name: c.title || c.url, summary: line(`컷 ${c.cutCount}개`, c.durationSec ? `약 ${Math.round(c.durationSec)}초` : null, c.channel, c.hook && `훅 ${c.hook.slice(0, 40)}`) })),
    ...formats
      .filter((f) => !f.archived)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 40)
      .map((f): WriterRef => ({ kind: "format", id: f.id, name: f.name, summary: line(f.summary.slice(0, 80), f.hook && `훅 ${f.hook.slice(0, 40)}`) })),
    ...templates.slice(0, 30).map((t): WriterRef => ({ kind: "template", id: t.id, name: t.name, summary: line(t.hookPattern.slice(0, 60), `${Math.round(t.totalSec)}초`) })),
    ...radar
      .filter((r) => r.ai?.relevant && r.ai.product && !r.dismissed)
      .slice(0, 30)
      .map((r): WriterRef => ({ kind: "radar", id: r.id, name: r.ai!.product, summary: line(r.title.slice(0, 50), r.ai!.why.slice(0, 60), r.multiple ? `평소의 ${r.multiple}배` : null) })),
  ];
}

function formatText(f: WithId<FormatDoc>): string {
  return [
    `[바이럴 형식 카드] id=${f.id} · ${f.name}`,
    f.summary && `한 줄: ${f.summary}`,
    f.hook && `훅(첫 2초): ${f.hook}`,
    f.structure.length && `흐름: ${f.structure.join(" → ")}`,
    f.editing && `편집: ${f.editing}`,
    f.sound && `소리: ${f.sound}`,
    f.textOverlay && `화면 글자: ${f.textOverlay}`,
    f.whyItWorks && `먹힌 이유(가설): ${f.whyItWorks}`,
    (f.aiFeasibility.easyParts || f.aiFeasibility.hardParts) && `AI 재현: 쉬움 ${f.aiFeasibility.easyParts || "-"} / 어려움 ${f.aiFeasibility.hardParts || "-"}`,
    f.riskNote && `주의: ${f.riskNote}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function templateText(t: WithId<TemplateDoc>): string {
  return [
    `[성공 공식] id=${t.id} · ${t.name} · 약 ${Math.round(t.totalSec)}초`,
    t.hookPattern && `훅 방식: ${t.hookPattern}`,
    t.beats.length && `구간: ${t.beats.map((b) => `${BEAT_LABEL[b.key] ?? b.key} ${Math.round(b.from * 100)}~${Math.round(b.to * 100)}%${b.summary ? `(${b.summary.slice(0, 40)})` : ""}`).join(" · ")}`,
    t.productRevealRatio !== null && `제품 등장: 전체의 ${Math.round(t.productRevealRatio * 100)}% 지점`,
    t.avgShotSec !== null && `평균 컷 ${t.avgShotSec}초`,
    t.cta.wording && `CTA 방식: ${t.cta.wording}`,
    t.notes && `메모: ${t.notes.slice(0, 300)}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function radarText(r: WithId<RadarDoc>): string {
  const ai = r.ai;
  return [
    `[AI 레이더 후보] id=${r.id} · ${ai?.product || r.title}`,
    `원본 제목: ${r.title} (${r.channel}) · 조회 ${r.views ?? "?"} · 채널 평소의 ${r.multiple ?? "?"}배`,
    ai?.why && `반응 이유(AI 추정): ${ai.why}`,
    ai?.hook && `훅(AI 추정): ${ai.hook}`,
    r.filmed && `사람 표시: ${r.filmed.value === "self" ? "직접 촬영" : "직접 촬영 아님"}`,
    r.notes?.length && `사람 메모: ${r.notes.map((n) => n.text).join(" / ").slice(0, 500)}`,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * AI 에 넘길 참고 분석 글 — 고른 것 하나는 자세히, 「AI 가 고르기」 면 목록.
 * ids = 넘긴 분석의 `kind:id` — AI 가 적은 근거(basis)가 이 안에 있을 때만 남긴다 (지어낸 id 는 버린다).
 */
export async function writerReferenceText(db: Firestore, email: string, ref: ScriptSessionDoc["reference"]): Promise<{ text: string; mode: "fixed" | "auto"; ids: string[] }> {
  const fixed = (text: string) => ({ text, mode: "fixed" as const, ids: [`${ref.kind}:${ref.id}`] });
  if (ref.kind === "cut" && ref.id) {
    const c = await getCuts(db, ref.id).catch(() => null);
    if (c) return fixed(cutReferenceText(c, BEAT_LABEL));
  }
  if (ref.kind === "format" && ref.id) {
    const f = (await listFormats(db)).find((x) => x.id === ref.id);
    if (f) return fixed(formatText(f));
  }
  if (ref.kind === "template" && ref.id) {
    const t = (await listTemplates(db, email)).find((x) => x.id === ref.id);
    if (t) return fixed(templateText(t));
  }
  if (ref.kind === "radar" && ref.id) {
    const r = (await listRadar(db, 60)).find((x) => x.id === ref.id);
    if (r) return fixed(radarText(r));
  }
  // AI 가 고르기 — 컷 표 6 · 형식 카드 12 · 성공 공식 8 · 레이더 후보 8 (짧게)
  const [cuts, formats, templates, radar] = await Promise.all([listCuts(db, 6).catch(() => []), listFormats(db).catch(() => []), listTemplates(db, email).catch(() => []), listRadar(db).catch(() => [])]);
  const fs = formats.filter((f) => !f.archived).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 12);
  const ts = templates.slice(0, 8);
  const rs = radar.filter((r) => r.ai?.relevant && r.ai.product && !r.dismissed).slice(0, 8);
  const parts = [
    ...cuts.map((c) => `- cut id=${c.id} · 레퍼런스 영상 컷 표 「${(c.title || c.url).slice(0, 60)}」 · 컷 ${c.cutCount}개${c.durationSec ? ` · 약 ${Math.round(c.durationSec)}초` : ""} · 훅: ${c.hook.slice(0, 80)} (구조만 옮긴다)`),
    ...fs.map((f) => `- format id=${f.id} · ${f.name} · 훅: ${f.hook.slice(0, 80)} · 흐름: ${f.structure.slice(0, 5).join(" → ").slice(0, 160)} · 이유: ${f.whyItWorks.slice(0, 100)}`),
    ...ts.map((t) => `- template id=${t.id} · ${t.name} · 훅 방식: ${t.hookPattern.slice(0, 80)} · ${Math.round(t.totalSec)}초`),
    ...rs.map((r) => `- radar id=${r.id} · ${r.ai!.product} · 평소의 ${r.multiple ?? "?"}배 · 이유: ${r.ai!.why.slice(0, 80)} · 훅: ${r.ai!.hook.slice(0, 60)}`),
  ];
  const ids = [...cuts.map((c) => `cut:${c.id}`), ...fs.map((f) => `format:${f.id}`), ...ts.map((t) => `template:${t.id}`), ...rs.map((r) => `radar:${r.id}`)];
  return { text: parts.join("\n"), mode: "auto", ids };
}


// ---- 만들기 · 한 번 주고받기 ---------------------------------------------------

export interface WriterCreateInput {
  productName?: unknown;
  productInfo?: unknown;
  kind?: unknown;
  clientId?: unknown;
  refKind?: unknown;
  refId?: unknown;
  refName?: unknown;
  targetSec?: unknown;
  ctaKeyword?: unknown;
  model?: unknown;
  photos?: unknown;
  /** 처음 요청 (비우면 「대본을 처음 써 주세요」) */
  message?: unknown;
  /** 제품 소개 · 스토리 광고 */
  style?: unknown;
  /** 스토리 광고 재료 (problem · idea · characters · tone · look · endCard) */
  story?: unknown;
}

/** 새 대본 — 세션을 먼저 저장하고(사진 포함) 첫 대본을 부른다. AI 가 실패해도 세션은 남는다 */
export async function createScriptSession(db: Firestore, email: string, input: WriterCreateInput): Promise<{ session: WithId<ScriptSessionDoc>; error: string | null; costUsd: number }> {
  const name = str(input.productName, 120);
  if (!name) throw new Error("제품 이름을 적어 주세요.");
  const kind = KINDS.includes(input.kind as WriterKind) ? (input.kind as WriterKind) : "coupang";
  let clientId: string | null = null;
  if (kind === "brand") {
    const c = await getClientDoc(db, input.clientId);
    if (!c.members?.includes(email) && !isShortsAdmin(email)) throw new AccessError(403, "이 고객사의 담당자가 아닙니다.");
    clientId = c.id;
  }
  const refKind = REF_KINDS.includes(input.refKind as WriterRefKind) ? (input.refKind as WriterRefKind) : "auto";
  const style: WriterStyle = input.style === "story" ? "story" : "intro";
  const photos = cleanPhotos(input.photos, WRITER_MAX_PHOTOS);
  const id = newDocId();
  const now = Date.now();
  const metas: WriterPhotoMeta[] = photos.map((p) => ({ id: newId("ph_"), name: p.name, thumb: p.thumb }));
  const targetSec = Number(input.targetSec);
  const doc: ScriptSessionDoc = {
    owner: email,
    createdAt: now,
    updatedAt: now,
    title: name,
    kind,
    style,
    storyInput: style === "story" ? cleanStoryInput(input.story) : null,
    clientId,
    product: { name, info: str(input.productInfo, 3000) },
    facts: [],
    checks: [],
    reference: { kind: refKind, id: refKind === "auto" ? null : isDocId(input.refId) || /^yt_[\w-]{11}$/.test(String(input.refId)) ? String(input.refId) : null, name: str(input.refName, 120) },
    basis: null,
    targetSec: (WRITER_LENGTHS as readonly number[]).includes(targetSec) ? targetSec : style === "story" ? 45 : 30,
    ctaKeyword: str(input.ctaKeyword, 30),
    model: shortsTextModel(input.model),
    photos: metas,
    script: null,
    versions: [],
    messages: [],
    costUsd: 0,
    projectId: null,
    versionCount: 0,
    cover: metas[0]?.thumb ?? null,
  };
  const batch = db.batch();
  batch.set(col(db).doc(id), doc);
  photos.forEach((p, i) => batch.set(col(db).doc(id).collection("photos").doc(metas[i].id), { dataUrl: p.dataUrl, name: p.name, at: now }));
  await batch.commit();
  const message = str(input.message, WRITER_MESSAGE_MAX) || (style === "story" ? "이 제품을 홍보하는 스토리 광고 쇼츠의 대본과 콘티를 처음 써 주세요." : "제품을 소개하는 쇼츠 대본을 처음 써 주세요.");
  return runTurn(db, email, id, { message, newPhotoIds: metas.map((m) => m.id), model: doc.model });
}

/** 채팅 한 번 — 사람 말(+새 사진) → AI → 새 버전 */
export async function scriptSessionTurn(
  db: Firestore,
  email: string,
  id: unknown,
  input: { message?: unknown; photos?: unknown; model?: unknown },
): Promise<{ session: WithId<ScriptSessionDoc>; error: string | null; costUsd: number }> {
  const s = await getOwn(db, email, id);
  const message = str(input.message, WRITER_MESSAGE_MAX);
  const photos = cleanPhotos(input.photos, WRITER_MAX_PHOTOS - s.photos.length);
  if (!message && !photos.length) throw new Error("요청을 적어 주세요.");
  const metas: WriterPhotoMeta[] = photos.map((p) => ({ id: newId("ph_"), name: p.name, thumb: p.thumb }));
  if (metas.length) {
    const batch = db.batch();
    photos.forEach((p, i) => batch.set(col(db).doc(s.id).collection("photos").doc(metas[i].id), { dataUrl: p.dataUrl, name: p.name, at: Date.now() }));
    batch.update(col(db).doc(s.id), { photos: [...s.photos, ...metas], cover: s.cover ?? metas[0].thumb, updatedAt: Date.now() });
    await batch.commit();
  }
  const model = input.model === undefined ? s.model : shortsTextModel(input.model);
  return runTurn(db, email, s.id, { message: message || "새로 붙인 사진을 보고 대본에 반영해 주세요.", newPhotoIds: metas.map((m) => m.id), model });
}

async function runTurn(
  db: Firestore,
  email: string,
  id: string,
  o: { message: string; newPhotoIds: string[]; model: string },
): Promise<{ session: WithId<ScriptSessionDoc>; error: string | null; costUsd: number }> {
  const s = await getOwn(db, email, id);
  // 사진은 아직 대본이 없을 때(처음 · 앞서 실패) 모두, 그 뒤로는 새로 붙인 것만 보여 준다
  const showIds = s.script ? o.newPhotoIds : s.photos.map((p) => p.id);
  const shown = await Promise.all(
    showIds.map(async (pid) => {
      const d = (await col(db).doc(s.id).collection("photos").doc(pid).get()).data() as { dataUrl?: string } | undefined;
      return d?.dataUrl ? { index: s.photos.findIndex((p) => p.id === pid), dataUrl: d.dataUrl } : null;
    }),
  );
  const client = s.kind === "brand" && s.clientId ? await getClientDoc(db, s.clientId).catch(() => null) : null;
  const ref = await writerReferenceText(db, email, s.reference);
  const input: WriterTurnInput = {
    model: o.model,
    kind: s.kind,
    style: s.style ?? "intro",
    storyInput: s.storyInput ?? null,
    product: s.product,
    facts: s.facts,
    targetSec: s.targetSec,
    ctaKeyword: s.ctaKeyword,
    brand: client
      ? { name: client.name, summary: client.brief.summary, target: client.brief.target, tone: client.brief.tone, keyMessages: client.brief.keyMessages, mustInclude: client.brief.mustInclude, banned: client.brief.banned }
      : null,
    reference: ref.text,
    referenceMode: ref.mode,
    current: s.script,
    history: s.messages.filter((m) => !m.error).map((m) => ({ role: m.role, text: m.text })),
    message: o.message,
    photos: shown.filter((x): x is { index: number; dataUrl: string } => !!x && x.index >= 0),
    photoCount: s.photos.length,
  };
  const now = Date.now();
  const userMsg = { role: "user" as const, text: o.message, at: now, ...(o.newPhotoIds.length ? { photoIds: o.newPhotoIds } : {}) };
  try {
    const r = await writerTurn(input);
    r.out.basis = checkWriterBasis(r.out.basis, s.reference, ref);
    const n = (s.versions.at(-1)?.n ?? 0) + 1;
    const patch: Partial<ScriptSessionDoc> = {
      script: r.out.script,
      facts: r.out.facts.length ? r.out.facts : s.facts,
      checks: r.out.checks,
      basis: r.out.basis,
      targetSec: r.out.script.targetSec,
      versions: keepLast([...s.versions, { n, at: now, by: email, note: o.message.slice(0, 120), script: r.out.script }], WRITER_MAX_VERSIONS),
      versionCount: n,
      messages: keepLast([...s.messages, userMsg, { role: "assistant", text: r.out.reply || `대본을 고쳤습니다 (v${n}).`, at: Date.now(), version: n, model: r.model, costUsd: r.costUsd }], WRITER_MAX_MESSAGES),
      costUsd: Math.round((s.costUsd + r.costUsd) * 1e6) / 1e6,
      model: o.model,
      updatedAt: Date.now(),
    };
    // 「AI 가 고르기」 였으면 AI 가 고른 분석을 기억한다 (다음 번에도 같은 것을 따르게)
    if (s.reference.kind === "auto" && r.out.basis.kind !== "none" && r.out.basis.id) patch.reference = { kind: r.out.basis.kind, id: r.out.basis.id, name: r.out.basis.name };
    await col(db).doc(s.id).update(patch);
    return { session: { ...s, ...patch }, error: null, costUsd: r.costUsd };
  } catch (e) {
    const error = e instanceof Error ? e.message : "AI 가 대본을 쓰지 못했습니다.";
    const patch: Partial<ScriptSessionDoc> = {
      messages: keepLast([...s.messages, userMsg, { role: "assistant", text: "대본을 쓰지 못했습니다.", at: Date.now(), error, model: o.model }], WRITER_MAX_MESSAGES),
      updatedAt: Date.now(),
    };
    await col(db).doc(s.id).update(patch);
    return { session: { ...s, ...patch }, error, costUsd: 0 };
  }
}

// ---- 고치기 · 되돌리기 · 지우기 -------------------------------------------------

/** 사람이 직접 고치는 칸 — 제목 · 확인된 사실 · 길이 · CTA 키워드 · 참고 분석 · 모델 */
export async function patchScriptSession(db: Firestore, email: string, id: unknown, p: Record<string, unknown>): Promise<WithId<ScriptSessionDoc>> {
  const s = await getOwn(db, email, id);
  const patch: Partial<ScriptSessionDoc> = { updatedAt: Date.now() };
  if ("title" in p) patch.title = str(p.title, 100) || s.title;
  if ("facts" in p) patch.facts = cleanFacts(p.facts);
  if ("targetSec" in p && (WRITER_LENGTHS as readonly number[]).includes(Number(p.targetSec))) patch.targetSec = Number(p.targetSec);
  if ("ctaKeyword" in p) patch.ctaKeyword = str(p.ctaKeyword, 30);
  if ("model" in p) patch.model = shortsTextModel(p.model);
  if ("refKind" in p && REF_KINDS.includes(p.refKind as WriterRefKind)) {
    const k = p.refKind as WriterRefKind;
    patch.reference = { kind: k, id: k === "auto" ? null : typeof p.refId === "string" ? p.refId.slice(0, 80) : null, name: str(p.refName, 120) };
  }
  await col(db).doc(s.id).update(patch);
  return { ...s, ...patch };
}

/** 예전 버전으로 — 새 버전으로 쌓는다 (되돌린 것도 되돌릴 수 있게) */
export async function revertScriptSession(db: Firestore, email: string, id: unknown, n: unknown): Promise<WithId<ScriptSessionDoc>> {
  const s = await getOwn(db, email, id);
  const v = s.versions.find((x) => x.n === Number(n));
  if (!v) throw new Error("그 버전을 찾지 못했습니다 — 오래된 버전은 15개까지만 남깁니다.");
  const next = (s.versions.at(-1)?.n ?? 0) + 1;
  const now = Date.now();
  const patch: Partial<ScriptSessionDoc> = {
    script: v.script,
    targetSec: v.script.targetSec,
    versions: keepLast([...s.versions, { n: next, at: now, by: email, note: `v${v.n} 으로 되돌림`, script: v.script }], WRITER_MAX_VERSIONS),
    versionCount: next,
    messages: keepLast([...s.messages, { role: "assistant", text: `v${v.n} 대본으로 되돌렸습니다 (v${next}).`, at: now, version: next }], WRITER_MAX_MESSAGES),
    updatedAt: now,
  };
  await col(db).doc(s.id).update(patch);
  return { ...s, ...patch };
}

export async function deleteScriptSession(db: Firestore, email: string, id: unknown): Promise<void> {
  const s = await getOwn(db, email, id);
  const photos = await col(db).doc(s.id).collection("photos").get();
  const batch = db.batch();
  for (const d of photos.docs) batch.delete(d.ref);
  batch.delete(col(db).doc(s.id));
  await batch.commit();
}

/** 사진 원본 하나 (화면에서 크게 볼 때) */
export async function scriptSessionPhoto(db: Firestore, email: string, id: unknown, photoId: unknown): Promise<string> {
  const s = await getOwn(db, email, id, true);
  if (typeof photoId !== "string" || !s.photos.some((p) => p.id === photoId)) throw new AccessError(404, "사진을 찾지 못했습니다.");
  const d = (await col(db).doc(s.id).collection("photos").doc(photoId).get()).data() as { dataUrl?: string } | undefined;
  if (!d?.dataUrl) throw new AccessError(404, "사진을 찾지 못했습니다.");
  return d.dataUrl;
}

// ---- 영상으로 옮기기 -------------------------------------------------------------

/**
 * 지금 대본으로 영상(프로젝트)을 만든다 — 장면 · 대본 줄 · 게시 문구 · CTA · 확인된 사실.
 * 제품 사진 장면은 영상 쪽에 파일이 아직 없어 빈 장면으로 두고 이름에 사진 번호를 적는다(출력 막기가 알려 준다).
 * 이미 만들었으면 그 영상을 돌려준다.
 */
export async function scriptSessionToProject(db: Firestore, email: string, id: unknown): Promise<{ projectId: string; created: boolean }> {
  const s = await getOwn(db, email, id);
  if (!s.script) throw new Error("아직 대본이 없습니다 — 먼저 대본을 만들어 주세요.");
  if (s.projectId) {
    const ex = await db.collection(NEANDER_COL.shortsProjects).doc(s.projectId).get();
    if (ex.exists) return { projectId: s.projectId, created: false };
  }
  const sc = s.script;
  const projectId =
    s.kind === "brand" && s.clientId
      ? await createClientProject(db, email, { clientId: s.clientId, title: sc.title })
      : await createProject(db, email, { title: sc.title, product: s.product.name, kind: s.kind === "general" ? "general" : "coupang", visibility: "private", notes: projectNotes(s).slice(0, 6000) });
  const scenes: Scene[] = sc.scenes.map((x, i) => ({
    id: newId("sc_"),
    kind: x.kind === "ai" ? "ai" : "blank",
    label: (x.kind === "image" ? `제품 사진 ${(x.photo ?? 0) + 1} · ${x.label}` : x.kind === "clip" ? `직접 촬영 · ${x.label}` : x.label || `장면 ${i + 1}`).slice(0, 100),
    duration: Math.min(30, Math.max(0.5, x.durationSec)),
    clip: null,
    ai: x.kind === "ai" ? { prompt: x.aiPrompt.slice(0, 4000), status: "draft", jobId: null, fileId: null, model: null, reviewNote: "" } : null,
    image: null,
    keepAudio: false,
  }));
  const lines: ScriptLine[] = sc.lines.map((l) => ({ id: newId("ln_"), beat: l.beat, text: l.text, caption: l.caption, sceneId: scenes[l.scene]?.id ?? null }));
  await patchProject(db, projectId, email, (pp) => {
    if (sc.story && s.kind === "brand") pp.notes = [pp.notes, projectNotes(s)].filter(Boolean).join("\n\n").slice(0, 6000);
    pp.product = pp.product || s.product.name;
    pp.facts = [...new Set([...pp.facts, ...s.facts])].slice(0, 30);
    pp.script = { lines };
    pp.scenes = scenes;
    pp.subtitles = { cues: [], edited: false };
    pp.publish = { ...pp.publish, title: sc.title.slice(0, 100), description: sc.description.slice(0, 4500), hashtags: sc.hashtags.slice(0, 15) };
    pp.cta = { ...sc.cta, keyword: sc.cta.keyword || s.ctaKeyword };
    if (pp.stage === "research" || pp.stage === "sourcing" || pp.stage === "matching") pp.stage = "scripting";
  });
  await col(db).doc(s.id).update({ projectId, updatedAt: Date.now() });
  return { projectId, created: true };
}

/** 영상 메모 — 스토리 광고면 로그라인 · 캐치프레이즈 · 그림체 · 등장인물(영문 고정 묘사) · 컷별 카메라 · 이어 붙이기 · 엔드카드 */
function projectNotes(s: ScriptSessionDoc): string {
  const sc = s.script;
  const st = sc?.story;
  if (!sc || !st) return `대본 작성기에서 옮김 · ${s.product.info}`;
  return [
    "대본 작성기(스토리 광고)에서 옮김",
    st.logline && `로그라인: ${st.logline}`,
    st.catchphrase && `캐치프레이즈: ${st.catchphrase}`,
    st.look && `그림체: ${st.look}`,
    st.characters.length && `등장인물:\n${st.characters.map((c) => `- ${c.name}(${c.role}): ${c.look} / ${c.lookPrompt}`).join("\n")}`,
    `컷 메모:\n${sc.scenes.map((x, i) => `${i + 1}. ${x.label} — 카메라 ${x.camera || "-"} · 소리 ${x.sound || "-"} · 잇기 ${x.continuity || "-"}`).join("\n")}`,
    (st.endCard.visual || st.endCard.text) && `엔드카드: ${st.endCard.visual} · 「${st.endCard.text}」 · ${st.endCard.cta}`,
    s.product.info && `제품 정보: ${s.product.info}`,
  ]
    .filter(Boolean)
    .join("\n");
}
