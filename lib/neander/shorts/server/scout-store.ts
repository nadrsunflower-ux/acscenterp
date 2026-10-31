import "server-only";

// ============================================================
//  바이럴 형식 정찰 저장 — 감시 채널 · 터진 영상 · 형식 카드 · 주간 보고 · 설정
// ------------------------------------------------------------
//  회사 공용이다: 쇼츠 사용자 누구나 읽고 고친다. 지우기는 만든 사람 · 쇼츠 관리자.
//  자동 수집이 만든 문서의 owner 는 "company" — 관리자만 지우고, 나머지는 「제외」 로 숨긴다.
//
//  출처 위조 금지 (store.ts 와 같은 원칙): 조회수 · 평소 조회수의 src "api" 는 서버가
//  공식 API 로 받아 적을 때만 생긴다. 화면이 보내는 숫자는 언제나 "manual".
// ============================================================

import { randomBytes } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import { AccessError } from "@/lib/neander/server/auth";
import { NEANDER_COL } from "@/lib/neander/collections";
import { httpUrl, measured, platformFromUrl } from "../model";
import {
  COUNTRIES,
  DEFAULT_SCOUT_SETTINGS,
  multipleOf,
  type AiLevel,
  type FormatDoc,
  type HitAnalysis,
  type HitDoc,
  type KoreaCheck,
  type LanguageDependence,
  type ScoutReportDoc,
  type ScoutRisk,
  type ScoutSettings,
  type WatchChannelDoc,
} from "../scout";
import type { Measured } from "../types";
import { isShortsAdmin } from "./access";

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec => (v && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : {});
const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const strs = (v: unknown, maxItems: number, maxLen: number) =>
  (Array.isArray(v) ? v : []).map((x) => str(x, maxLen)).filter(Boolean).slice(0, maxItems);
const num = (v: unknown, min: number, max: number, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
const numOrNull = (v: unknown) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
};
const oneOf = <T extends string>(v: unknown, list: readonly T[], fallback: T): T => (list.includes(v as T) ? (v as T) : fallback);
const country = (v: unknown) => {
  const c = str(v, 2).toUpperCase();
  return /^[A-Z]{2}$/.test(c) ? c : "";
};
const lang = (v: unknown) => {
  const l = str(v, 5).toLowerCase();
  return /^[a-z]{2}(-[a-z]{2})?$/.test(l) ? l : "";
};
const isDocId = (v: unknown): v is string => typeof v === "string" && /^[\w-]{6,60}$/.test(v);
const newDocId = () => randomBytes(12).toString("base64url");

const LANG_DEP = ["visual", "mixed", "verbal"] as const;
const AI_LEVELS = ["easy", "possible", "hard"] as const;
const RISKS = ["music", "real_person", "danger", "claims", "other"] as const;

const watchCol = (db: Firestore) => db.collection(NEANDER_COL.shortsWatch);
const hitsCol = (db: Firestore) => db.collection(NEANDER_COL.shortsHits);
const formatsCol = (db: Firestore) => db.collection(NEANDER_COL.shortsFormats);
const reportsCol = (db: Firestore) => db.collection(NEANDER_COL.shortsReports);
const settingsDoc = (db: Firestore) => db.collection(NEANDER_COL.shortsSettings).doc("scout");

type WithId<T> = T & { id: string };

/** 지우기 — 만든 사람 또는 쇼츠 관리자. 자동 수집 문서는 관리자만 */
function assertCanDelete(doc: { owner: string } | undefined, email: string, what: string) {
  if (!doc) throw new AccessError(404, `${what}을(를) 찾지 못했습니다.`);
  if (doc.owner !== email && !isShortsAdmin(email)) {
    throw new AccessError(403, doc.owner === "company" ? `자동으로 모은 ${what}은(는) 관리자만 지웁니다 — 「제외」 로 숨겨 주세요.` : `${what}은(는) 만든 사람이나 관리자만 지웁니다.`);
  }
}

const need = <T>(doc: T | undefined, what: string): T => {
  if (!doc) throw new AccessError(404, `${what}을(를) 찾지 못했습니다. 지워졌을 수 있습니다.`);
  return doc;
};

// ---- 설정 -------------------------------------------------------------

export async function getScoutSettings(db: Firestore): Promise<ScoutSettings> {
  const d = (await settingsDoc(db).get()).data() as Partial<ScoutSettings> | undefined;
  return { ...DEFAULT_SCOUT_SETTINGS, ...(d ?? {}) };
}

export async function saveScoutSettings(db: Firestore, email: string, input: unknown): Promise<ScoutSettings> {
  const r = rec(input);
  const s: ScoutSettings = {
    threshold: num(r.threshold, 1.5, 100, DEFAULT_SCOUT_SETTINGS.threshold),
    minViews: Math.round(num(r.minViews, 0, 100_000_000, DEFAULT_SCOUT_SETTINGS.minViews)),
    maxAgeDays: Math.round(num(r.maxAgeDays, 3, 90, DEFAULT_SCOUT_SETTINGS.maxAgeDays)),
    autoAnalyzePerDay: Math.round(num(r.autoAnalyzePerDay, 0, 50, DEFAULT_SCOUT_SETTINGS.autoAnalyzePerDay)),
  };
  await settingsDoc(db).set({ ...s, updatedAt: Date.now(), updatedBy: email });
  return s;
}

// ---- 감시 채널 -----------------------------------------------------------

export async function listWatch(db: Firestore): Promise<WithId<WatchChannelDoc>[]> {
  const snap = await watchCol(db).get();
  return snap.docs.map((d) => ({ ...(d.data() as WatchChannelDoc), id: d.id })).sort((a, b) => a.country.localeCompare(b.country) || a.title.localeCompare(b.title));
}

export async function getWatch(db: Firestore, id: unknown): Promise<WithId<WatchChannelDoc>> {
  if (!isDocId(id)) throw new Error("감시 채널 id 가 올바르지 않습니다.");
  return { ...need((await watchCol(db).doc(id).get()).data() as WatchChannelDoc | undefined, "감시 채널"), id };
}

export const watchIdOf = (channelId: string) => `yt_${channelId}`;

export async function addWatch(
  db: Firestore,
  email: string,
  info: { channelId: string; handle: string; title: string; thumbnail: string; country: string; language: string; subscribers: number | null },
  input: unknown,
): Promise<string> {
  const r = rec(input);
  const id = watchIdOf(info.channelId);
  const now = Date.now();
  const c = country(r.country) || info.country;
  const doc: WatchChannelDoc = {
    owner: email,
    createdAt: now,
    updatedAt: now,
    updatedBy: email,
    platform: "youtube",
    channelId: info.channelId,
    handle: info.handle.slice(0, 120),
    title: info.title.slice(0, 200),
    thumbnail: httpUrl(info.thumbnail),
    country: c,
    language: lang(r.language) || info.language || COUNTRIES.find((x) => x.code === c)?.lang || "",
    topics: strs(r.topics, 8, 30),
    subscribers: info.subscribers,
    active: true,
    note: str(r.note, 1000),
    scan: { at: null, baseline: null, baselineN: 0, baselineBasis: "none", shortsSeen: 0, error: null },
  };
  try {
    await watchCol(db).doc(id).create(doc);
  } catch {
    throw new Error(`이미 감시 중인 채널입니다: ${info.title}`);
  }
  return id;
}

export async function updateWatch(db: Firestore, email: string, id: unknown, input: unknown): Promise<void> {
  const w = await getWatch(db, id);
  const r = rec(input);
  await watchCol(db).doc(w.id).update({
    country: "country" in r ? country(r.country) : w.country,
    language: "language" in r ? lang(r.language) : w.language,
    topics: "topics" in r ? strs(r.topics, 8, 30) : w.topics,
    active: "active" in r ? r.active === true : w.active,
    note: "note" in r ? str(r.note, 1000) : w.note,
    updatedAt: Date.now(),
    updatedBy: email,
  });
}

export async function writeScan(db: Firestore, id: string, scan: WatchChannelDoc["scan"], subscribers?: number | null): Promise<void> {
  await watchCol(db).doc(id).update({ scan, ...(subscribers !== undefined ? { subscribers } : {}) });
}

export async function deleteWatch(db: Firestore, email: string, id: unknown): Promise<void> {
  const w = await getWatch(db, id);
  assertCanDelete(w, email, "감시 채널");
  // 이 채널에서 찾은 터진 영상은 남긴다 (형식 카드의 근거) — 감시 연결만 끊긴다
  await watchCol(db).doc(w.id).delete();
}

// ---- 터진 영상 -----------------------------------------------------------

export async function listHits(db: Firestore): Promise<WithId<HitDoc>[]> {
  const snap = await hitsCol(db).get();
  return snap.docs.map((d) => ({ ...(d.data() as HitDoc), id: d.id })).sort((a, b) => b.createdAt - a.createdAt);
}

export async function getHit(db: Firestore, id: unknown): Promise<WithId<HitDoc>> {
  if (!isDocId(id)) throw new Error("영상 id 가 올바르지 않습니다.");
  return { ...need((await hitsCol(db).doc(id).get()).data() as HitDoc | undefined, "터진 영상"), id };
}

export const hitIdOf = (videoId: string) => `yt_${videoId}`;

/** 이 감시 채널에서 이미 적어 둔 영상 문서 id 들 (훑을 때 영상마다 읽지 않으려고) */
export async function hitIdsOfWatch(db: Firestore, watchId: string): Promise<Set<string>> {
  const snap = await hitsCol(db).where("watchId", "==", watchId).select().get();
  return new Set(snap.docs.map((d) => d.id));
}

/**
 * 공식 API 로 받은 YouTube 영상 하나를 적는다 (훑기 · 주소로 등록).
 * 처음이면 만들고, 있으면 숫자 · 기록만 바꾼다 — 사람이 정한 나라 · 형식 · 상태 · 메모 · 분석은 지킨다.
 * create = false 면 이미 있는 문서만 고친다 (평소 밑으로 내려간 영상의 숫자 갱신).
 */
export async function upsertHitFromApi(
  db: Firestore,
  by: string,
  v: {
    videoId: string;
    url: string;
    title: string;
    channel: string;
    thumbnail: string;
    publishedAt: string | null;
    duration: number | null;
    views: number | null;
    likes: number | null;
    comments: number | null;
    baseline: number | null;
    baselineRef: string;
    watchId: string | null;
    country: string;
    language: string;
  },
  opts: { create: boolean; found: HitDoc["found"] },
): Promise<"created" | "updated" | "skipped"> {
  const ref = hitsCol(db).doc(hitIdOf(v.videoId));
  const now = Date.now();
  const api = (n: number | null, what: string): Measured => measured(n, "api", n === null ? `${what} 비공개` : "YouTube Data API videos.list", now);
  return db.runTransaction(async (tx) => {
    const prev = (await tx.get(ref)).data() as HitDoc | undefined;
    if (!prev && !opts.create) return "skipped";
    const history = [...(prev?.viewHistory ?? [])];
    if (v.views !== null && history[history.length - 1]?.views !== v.views) history.push({ at: now, views: v.views });
    const baseline = v.baseline !== null ? measured(v.baseline, "api", v.baselineRef, now) : prev?.baseline ?? measured(null, "api", "평소 조회수를 계산할 쇼츠가 모자람", now);
    const views = api(v.views, "조회수");
    const next: HitDoc = {
      owner: prev?.owner ?? by,
      createdAt: prev?.createdAt ?? now,
      updatedAt: now,
      updatedBy: by,
      platform: "youtube",
      url: v.url,
      externalId: v.videoId,
      watchId: v.watchId ?? prev?.watchId ?? null,
      channel: v.channel || prev?.channel || "",
      country: prev?.country || v.country,
      language: prev?.language || v.language,
      title: v.title || prev?.title || "",
      thumbnail: v.thumbnail || prev?.thumbnail || "",
      publishedAt: v.publishedAt ?? prev?.publishedAt ?? null,
      duration: v.duration ?? prev?.duration ?? null,
      views,
      likes: api(v.likes, "좋아요"),
      comments: api(v.comments, "댓글"),
      baseline,
      multiple: multipleOf(views.v, baseline.v),
      viewHistory: history.slice(-40),
      found: prev?.found ?? opts.found,
      analysis: prev?.analysis ?? null,
      formatId: prev?.formatId ?? null,
      status: prev?.status ?? "new",
      koreanComments: prev?.koreanComments ?? null,
      note: prev?.note ?? "",
    };
    tx.set(ref, next);
    return prev ? "updated" : "created";
  });
}

/** YouTube 밖(틱톡 · 더우인 · 샤오홍슈 · 인스타) — 링크와 사람이 본 숫자 */
export async function addManualHit(db: Firestore, email: string, input: unknown): Promise<string> {
  const r = rec(input);
  const url = httpUrl(str(r.url, 600));
  if (!url) throw new Error("영상 주소(https://…)를 넣어 주세요.");
  const dup = await hitsCol(db).where("url", "==", url).limit(1).get();
  if (!dup.empty) throw new Error("이미 등록한 영상입니다.");
  const now = Date.now();
  const views = measured(numOrNull(r.views), "manual", "사람이 보고 적음", now);
  const baseline = measured(numOrNull(r.baseline), "manual", "사람이 그 계정 평소 조회수를 보고 적음", now);
  const id = newDocId();
  const doc: HitDoc = {
    owner: email,
    createdAt: now,
    updatedAt: now,
    updatedBy: email,
    platform: platformFromUrl(url),
    url,
    externalId: null,
    watchId: null,
    channel: str(r.channel, 200),
    country: country(r.country),
    language: lang(r.language),
    title: str(r.title, 300),
    thumbnail: "",
    publishedAt: /^\d{4}-\d{2}-\d{2}/.test(str(r.publishedAt, 30)) ? new Date(str(r.publishedAt, 30)).toISOString() : null,
    duration: numOrNull(r.duration),
    views,
    likes: measured(null, "manual"),
    comments: measured(null, "manual"),
    baseline,
    multiple: multipleOf(views.v, baseline.v),
    viewHistory: views.v !== null ? [{ at: now, views: views.v }] : [],
    found: "manual",
    analysis: null,
    formatId: null,
    status: "new",
    koreanComments: null,
    note: str(r.note, 2000),
  };
  await hitsCol(db).doc(id).set(doc);
  return id;
}

/** 사람이 고치는 것 — 나라 · 상태(제외) · 메모 · (직접 등록 영상의) 제목 · 숫자 */
export async function updateHit(db: Firestore, email: string, id: unknown, input: unknown): Promise<void> {
  const h = await getHit(db, id);
  const r = rec(input);
  const patch: Partial<HitDoc> = { updatedAt: Date.now(), updatedBy: email };
  if ("country" in r) patch.country = country(r.country);
  if ("language" in r) patch.language = lang(r.language);
  if ("note" in r) patch.note = str(r.note, 2000);
  if ("status" in r) patch.status = r.status === "dismissed" ? "dismissed" : h.formatId ? "assigned" : "new";
  if (h.found === "manual") {
    if ("title" in r) patch.title = str(r.title, 300);
    if ("channel" in r) patch.channel = str(r.channel, 200);
    const now = Date.now();
    const views = "views" in r ? measured(numOrNull(r.views), "manual", "사람이 보고 적음", now) : h.views;
    const baseline = "baseline" in r ? measured(numOrNull(r.baseline), "manual", "사람이 그 계정 평소 조회수를 보고 적음", now) : h.baseline;
    Object.assign(patch, { views, baseline, multiple: multipleOf(views.v, baseline.v) });
  }
  await hitsCol(db).doc(h.id).update(patch);
}

export async function setHitAnalysis(db: Firestore, id: string, analysis: HitAnalysis): Promise<void> {
  await hitsCol(db).doc(id).update({ analysis, updatedAt: Date.now(), updatedBy: analysis.by });
}

export async function setKoreanComments(db: Firestore, id: string, kc: NonNullable<HitDoc["koreanComments"]>, by: string): Promise<void> {
  await hitsCol(db).doc(id).update({ koreanComments: kc, updatedAt: Date.now(), updatedBy: by });
}

export async function assignHit(db: Firestore, email: string, id: string, formatId: string | null): Promise<void> {
  if (formatId) need((await formatsCol(db).doc(formatId).get()).data(), "형식 카드");
  await hitsCol(db).doc(id).update({ formatId, status: formatId ? "assigned" : "new", updatedAt: Date.now(), updatedBy: email });
}

export async function deleteHit(db: Firestore, email: string, id: unknown): Promise<void> {
  const h = await getHit(db, id);
  assertCanDelete(h, email, "터진 영상");
  await hitsCol(db).doc(h.id).delete();
}

// ---- 형식 카드 -----------------------------------------------------------

export const emptyKorea = (): KoreaCheck => ({ status: "unchecked", query: "", checkedAt: null, by: null, sampleSize: null, matches: [], lastSearch: null, note: "" });

export async function listFormats(db: Firestore): Promise<WithId<FormatDoc>[]> {
  const snap = await formatsCol(db).get();
  return snap.docs.map((d) => ({ ...(d.data() as FormatDoc), id: d.id })).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getFormat(db: Firestore, id: unknown): Promise<WithId<FormatDoc>> {
  if (!isDocId(id)) throw new Error("형식 카드 id 가 올바르지 않습니다.");
  return { ...need((await formatsCol(db).doc(id).get()).data() as FormatDoc | undefined, "형식 카드"), id };
}

/** 화면이 보낸 카드 내용 — 한국 확인(korea)은 여기서 바꾸지 않는다 (검색 · 표시 동작으로만) */
function sanitizeFormatBody(input: unknown, prev: FormatDoc | undefined) {
  const r = rec(input);
  const ai = rec(r.aiFeasibility);
  const name = str(r.name, 80);
  if (!name) throw new Error("형식 이름을 적어 주세요.");
  return {
    name,
    summary: str(r.summary, 500),
    hook: str(r.hook, 500),
    structure: strs(r.structure, 10, 200),
    editing: str(r.editing, 500),
    sound: str(r.sound, 300),
    textOverlay: str(r.textOverlay, 300),
    whyItWorks: str(r.whyItWorks, 600),
    languageDependence: oneOf<LanguageDependence>(r.languageDependence, LANG_DEP, prev?.languageDependence ?? "mixed"),
    aiFeasibility: {
      level: oneOf<AiLevel>(ai.level, AI_LEVELS, prev?.aiFeasibility.level ?? "possible"),
      easyParts: str(ai.easyParts, 400),
      hardParts: str(ai.hardParts, 400),
    },
    risks: strs(r.risks, 5, 20).filter((x): x is ScoutRisk => (RISKS as readonly string[]).includes(x)),
    riskNote: str(r.riskNote, 400),
    brandIdeas: strs(r.brandIdeas, 6, 300),
    koreanQueries: strs(r.koreanQueries, 5, 60),
    archived: r.archived === true,
    note: str(r.note, 2000),
  };
}

export async function saveFormat(db: Firestore, email: string, id: unknown, input: unknown): Promise<string> {
  const now = Date.now();
  if (id !== undefined && id !== null && id !== "") {
    const prev = await getFormat(db, id);
    await formatsCol(db).doc(prev.id).update({ ...sanitizeFormatBody(input, prev), updatedAt: now, updatedBy: email });
    return prev.id;
  }
  const newId = newDocId();
  const doc: FormatDoc = { owner: email, createdAt: now, updatedAt: now, updatedBy: email, ...sanitizeFormatBody(input, undefined), korea: emptyKorea() };
  await formatsCol(db).doc(newId).set(doc);
  return newId;
}

/** 분석 결과로 새 카드 */
export async function formatFromAnalysis(db: Firestore, email: string, a: HitAnalysis): Promise<string> {
  return saveFormat(db, email, null, {
    name: a.formatName,
    summary: a.summary,
    hook: a.hook,
    structure: a.structure,
    editing: a.editing,
    sound: a.sound,
    textOverlay: a.textOverlay,
    whyItWorks: a.whyItWorks,
    languageDependence: a.languageDependence,
    aiFeasibility: a.aiFeasibility,
    risks: a.risks,
    riskNote: a.riskNote,
    brandIdeas: a.brandIdeas,
    koreanQueries: a.koreanQueries,
  });
}

export async function patchFormatKorea(db: Firestore, email: string, id: string, korea: KoreaCheck): Promise<void> {
  await formatsCol(db).doc(id).update({ korea, updatedAt: Date.now(), updatedBy: email });
}

export async function deleteFormat(db: Firestore, email: string, id: unknown): Promise<void> {
  const f = await getFormat(db, id);
  assertCanDelete(f, email, "형식 카드");
  const linked = await hitsCol(db).where("formatId", "==", f.id).get();
  const batch = db.batch();
  for (const d of linked.docs) batch.update(d.ref, { formatId: null, status: "new" });
  batch.delete(formatsCol(db).doc(f.id));
  await batch.commit();
}

// ---- 주간 보고 -----------------------------------------------------------

export async function listReports(db: Firestore, limit = 12): Promise<ScoutReportDoc[]> {
  const snap = await reportsCol(db).orderBy("week", "desc").limit(limit).get();
  return snap.docs.map((d) => d.data() as ScoutReportDoc);
}

export async function getReport(db: Firestore, week: unknown): Promise<ScoutReportDoc> {
  if (typeof week !== "string" || !/^\d{4}-W\d{2}$/.test(week)) throw new Error("주 표기가 올바르지 않습니다 (예: 2026-W44).");
  return need((await reportsCol(db).doc(week).get()).data() as ScoutReportDoc | undefined, "주간 보고");
}

/** 같은 주를 다시 만들면 본문만 바꾸고, 붙여 둔 AI 요약은 남긴다 (화면이 요약 시각을 함께 보여 준다) */
export async function saveReport(db: Firestore, report: Omit<ScoutReportDoc, "narrative">): Promise<void> {
  const ref = reportsCol(db).doc(report.week);
  await db.runTransaction(async (tx) => {
    const prev = (await tx.get(ref)).data() as ScoutReportDoc | undefined;
    tx.set(ref, { ...report, narrative: prev?.narrative ?? null });
  });
}

export async function setReportNarrative(db: Firestore, week: string, narrative: NonNullable<ScoutReportDoc["narrative"]>): Promise<void> {
  await reportsCol(db).doc(week).update({ narrative });
}
