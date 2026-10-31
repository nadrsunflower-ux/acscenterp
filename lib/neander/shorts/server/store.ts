import "server-only";

// ============================================================
//  쇼핑쇼츠 저장 — 소재 · 프로젝트 · 템플릿 · 버전 · 설정 · 성과
// ------------------------------------------------------------
//  화면은 문서를 통째로 보내고, 서버가 다듬어 저장한다. 다듬을 때 지키는 것:
//
//  · 출처 위조 금지 — 숫자의 src 를 브라우저가 "api" 로 보내도, 서버가 API 로
//    받아 둔 값과 같지 않으면 "manual" 로 내린다. 공식 API 값은 서버가 직접
//    받아 적을 때만 생긴다 (research 라우트).
//  · 확인한 사람은 서버가 찍는다 — 쿠팡 동일 상품 확인 · 정책 확인 · 제휴 링크의
//    by/at 은 요청한 사람과 지금 시각이다. 브라우저가 보낸 이름은 버린다.
//  · 동시 편집 — baseUpdatedAt 이 서버 값과 다르면 409. 팀 프로젝트를 둘이
//    고칠 때 나중 저장이 앞 저장을 몰래 덮지 않는다.
//  · 버전 — 참고 자료 · 구성 분석 · 대본이 바뀌면 10분에 한 벌씩 자동으로,
//    AI 결과 · 사람이 「버전 저장」 을 누를 때는 그때마다 남긴다.
// ============================================================

import { randomBytes } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import { AccessError } from "@/lib/neander/server/auth";
import { NEANDER_COL } from "@/lib/neander/collections";
import {
  BEAT_LABEL,
  DEFAULT_WEIGHTS,
  emptyDomestic,
  emptyMetrics,
  emptyProject,
  httpUrl,
  isCoupangAffiliateUrl,
  coupangProductId,
  platformFromUrl,
} from "../model";
import type {
  AffiliateLink,
  Beat,
  BeatKey,
  ChineseTerm,
  ComplianceCheck,
  ComplianceKey,
  CostEntry,
  CoupangCandidate,
  CtaPlan,
  FormulaAnalysis,
  Measured,
  MetricSnapshotDoc,
  MetricSnapshotView,
  ProjectDoc,
  Scene,
  ScoreWeights,
  ScriptLine,
  SourceClip,
  SubtitleCue,
  TemplateDoc,
  TrendDoc,
  TrendMetricKey,
  VersionDoc,
  Visibility,
} from "../types";
import { assertOwner, assertRead, canRead } from "./access";

// ---- 다듬기 도구 ------------------------------------------------------

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec => (v && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : {});
const arr = (v: unknown, max: number): unknown[] => (Array.isArray(v) ? v.slice(0, max) : []);
const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
const num = (v: unknown, min: number, max: number, fallback: number) => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
const numOrNull = (v: unknown, min = 0, max = Number.MAX_SAFE_INTEGER) => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : null;
};
const oneOf = <T extends string>(v: unknown, list: readonly T[], fallback: T): T => (list.includes(v as T) ? (v as T) : fallback);
const idOf = (v: unknown, prefix = "") => (typeof v === "string" && /^[\w-]{1,48}$/.test(v) ? v : prefix + randomBytes(6).toString("base64url"));
const fileIdOf = (v: unknown) => (typeof v === "string" && /^[\w-]{10,40}$/.test(v) ? v : null);
const vis = (v: unknown): Visibility => (v === "team" ? "team" : "private");
const newDocId = () => randomBytes(12).toString("base64url");
const isDocId = (v: unknown): v is string => typeof v === "string" && /^[\w-]{6,60}$/.test(v);

const PLATFORMS = ["youtube", "instagram", "tiktok", "xiaohongshu", "douyin", "coupang", "other"] as const;
const BEATS = Object.keys(BEAT_LABEL) as BeatKey[];
const SRC = ["api", "manual", "estimate", "ai"] as const;
const PURPOSES = ["hook", "problem", "product", "demo", "compare", "twist", "proof", "cta", "broll"] as const;
const CTA_TYPES = ["comment_keyword", "dm_keyword", "link_in_bio", "pinned_comment", "description_link", "other"] as const;

/**
 * 숫자 하나. 브라우저가 보낸 src 가 api 인데 서버에 같은 값의 api 기록이 없으면
 * manual 로 내린다. 값이 바뀐 직접 입력은 지금 시각을 찍는다.
 */
function measuredOf(v: unknown, prev: Measured | undefined, now: number): Measured {
  const r = rec(v);
  const value = numOrNull(r.v);
  let src = oneOf(r.src, SRC, "manual");
  if (src === "api" && !(prev?.src === "api" && prev.v === value)) src = "manual";
  if (src === "estimate" && value !== null && prev?.v !== value) src = "manual";
  const same = prev && prev.v === value && prev.src === src;
  return {
    v: value,
    src,
    ...(same && prev.at ? { at: prev.at } : value !== null ? { at: now } : {}),
    ...(str(r.ref, 200) ? { ref: str(r.ref, 200) } : same && prev.ref ? { ref: prev.ref } : {}),
  };
}

// ---- 소재 (트렌드) -----------------------------------------------------

const trends = (db: Firestore) => db.collection(NEANDER_COL.shortsTrends);

export function sanitizeTrend(input: unknown, prev: TrendDoc | undefined, email: string, now = Date.now()): TrendDoc {
  const r = rec(input);
  const base = prev ?? {
    owner: email,
    createdAt: now,
    collectedAt: now,
    collectedBy: "manual" as const,
    searchContext: null,
    externalId: null,
    viewHistory: [],
    domestic: emptyDomestic(),
    projectId: null,
    sample: false,
  };
  const url = httpUrl(str(r.url, 2000)) || (prev?.url ?? "");
  const m = rec(r.metrics);
  const metrics = {} as TrendDoc["metrics"];
  for (const k of Object.keys(emptyMetrics()) as TrendMetricKey[]) metrics[k] = measuredOf(m[k], prev?.metrics[k], now);
  // 조회수 기록 — 직접 입력한 조회수가 바뀌면 한 줄 더한다 (API 기록은 서버가 더한다)
  const viewHistory = [...(prev?.viewHistory ?? [])];
  const pv = prev?.metrics.views;
  if (metrics.views.v !== null && metrics.views.src === "manual" && (pv?.v !== metrics.views.v || pv?.src !== "manual")) {
    viewHistory.push({ at: now, views: metrics.views.v, src: "manual" });
  }
  const info = rec(r.infoSample);
  const sampled = numOrNull(info.sampled);
  const matched = numOrNull(info.matched);
  const infoChanged = sampled !== prev?.infoSample.sampled || matched !== prev?.infoSample.matched;
  const id = rec(r.identification);
  const dom = rec(r.domestic);
  const domStatus = oneOf(dom.status, ["unchecked", "found", "none_in_sample"] as const, "unchecked");
  // 국내 확인: 직접 검색한 결과만 화면에서 고친다. API 표본은 서버가 적는다
  const domestic =
    prev?.domestic.method === "api" && domStatus === prev.domestic.status
      ? { ...prev.domestic, note: str(dom.note, 1000) }
      : {
          ...emptyDomestic(),
          status: domStatus,
          query: str(dom.query, 200),
          method: domStatus === "unchecked" ? null : ("manual" as const),
          checkedAt: domStatus === "unchecked" ? null : prev?.domestic.status === domStatus && prev.domestic.checkedAt ? prev.domestic.checkedAt : now,
          sampleSize: numOrNull(dom.sampleSize),
          matches: arr(dom.matches, 20).map((x) => {
            const mm = rec(x);
            return { url: httpUrl(str(mm.url, 2000)), title: str(mm.title, 300), views: numOrNull(mm.views), src: "manual" as const };
          }),
          note: str(dom.note, 1000),
        };
  return {
    ...base,
    owner: base.owner,
    visibility: prev && prev.owner !== email ? prev.visibility : vis(r.visibility),
    createdAt: base.createdAt,
    updatedAt: now,
    updatedBy: email,
    platform: oneOf(r.platform, PLATFORMS, url ? platformFromUrl(url) : "other"),
    url,
    externalId: prev?.externalId ?? null,
    channel: str(r.channel, 200),
    title: str(r.title, 300),
    publishedAt: typeof r.publishedAt === "string" && !Number.isNaN(Date.parse(r.publishedAt)) ? new Date(r.publishedAt).toISOString() : null,
    collectedAt: base.collectedAt,
    collectedBy: base.collectedBy,
    searchContext: base.searchContext,
    product: str(r.product, 200),
    category: str(r.category, 60),
    country: str(r.country, 8).toUpperCase(),
    language: str(r.language, 8).toLowerCase(),
    identification: { status: oneOf(id.status, ["unconfirmed", "likely", "confirmed"] as const, "unconfirmed"), evidence: str(id.evidence, 2000) },
    metrics,
    viewHistory: viewHistory.slice(-50),
    infoSample: {
      sampled,
      matched: matched !== null && sampled !== null ? Math.min(matched, sampled) : matched,
      keywords: arr(info.keywords, 40).map((k) => str(k, 40)).filter(Boolean),
      src: infoChanged ? "manual" : (prev?.infoSample.src ?? "manual"),
      ...(infoChanged ? { at: now } : prev?.infoSample.at ? { at: prev.infoSample.at } : {}),
    },
    domestic,
    tags: arr(r.tags, 20).map((t) => str(t, 40)).filter(Boolean),
    notes: str(r.notes, 4000),
    projectId: base.projectId,
    sample: base.sample,
  };
}

export async function listTrends(db: Firestore, email: string, admin = false): Promise<(TrendDoc & { id: string })[]> {
  const snap = await trends(db).get();
  return snap.docs
    .map((d) => ({ ...(d.data() as TrendDoc), id: d.id }))
    .filter((t) => canRead(t, email, admin))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function saveTrend(db: Firestore, email: string, id: unknown, input: unknown): Promise<string> {
  if (id !== undefined && id !== null && id !== "") {
    if (!isDocId(id)) throw new Error("소재 id 가 올바르지 않습니다.");
    const ref = trends(db).doc(id);
    await db.runTransaction(async (tx) => {
      const prev = assertRead((await tx.get(ref)).data() as TrendDoc | undefined, email, "소재");
      tx.set(ref, sanitizeTrend(input, prev, email));
    });
    return id;
  }
  const newId = newDocId();
  await trends(db).doc(newId).set(sanitizeTrend(input, undefined, email));
  return newId;
}

/** 서버가 공식 API 로 받은 값을 적는다 (research 라우트) — src "api" 는 여기서만 생긴다 */
export async function writeTrendFromApi(
  db: Firestore,
  email: string,
  id: string | null,
  data: Omit<TrendDoc, "owner" | "createdAt" | "updatedAt" | "updatedBy" | "visibility" | "viewHistory"> & { visibility?: Visibility },
): Promise<string> {
  const now = Date.now();
  const ref = id ? trends(db).doc(id) : trends(db).doc(newDocId());
  // 읽어 온 문서를 그대로 넘기는 경우가 있다 — 문서 밖 필드(id)와 소유 정보는 여기서 다시 정한다
  const { id: _id, owner: _o, createdAt: _c, updatedAt: _u, updatedBy: _b, viewHistory: _h, ...clean } = data as typeof data & Partial<TrendDoc> & { id?: string };
  data = clean as typeof data;
  await db.runTransaction(async (tx) => {
    const prev = id ? assertRead((await tx.get(ref)).data() as TrendDoc | undefined, email, "소재") : undefined;
    const history = [...(prev?.viewHistory ?? [])];
    if (data.metrics.views.v !== null) history.push({ at: now, views: data.metrics.views.v, src: "api" });
    // 사람이 적어 둔 저장·공유·정보 요청은 API 가 모르는 값이라 지키고, API 가 주는 값만 바꾼다
    const metrics = prev
      ? {
          ...prev.metrics,
          views: data.metrics.views,
          likes: data.metrics.likes.v !== null ? data.metrics.likes : prev.metrics.likes,
          comments: data.metrics.comments.v !== null ? data.metrics.comments : prev.metrics.comments,
        }
      : data.metrics;
    tx.set(ref, {
      ...(prev ?? {}),
      ...data,
      ...(prev
        ? {
            product: prev.product || data.product,
            category: prev.category || data.category,
            identification: prev.identification,
            infoSample: data.infoSample.sampled !== null ? data.infoSample : prev.infoSample,
            domestic: prev.domestic,
            tags: prev.tags,
            notes: prev.notes,
            projectId: prev.projectId,
          }
        : {}),
      metrics,
      owner: prev?.owner ?? email,
      visibility: prev?.visibility ?? data.visibility ?? "private",
      createdAt: prev?.createdAt ?? now,
      updatedAt: now,
      updatedBy: email,
      viewHistory: history.slice(-50),
    } satisfies TrendDoc);
  });
  return ref.id;
}

export async function patchTrendDomestic(db: Firestore, email: string, id: string, domestic: TrendDoc["domestic"]): Promise<void> {
  const ref = trends(db).doc(id);
  await db.runTransaction(async (tx) => {
    assertRead((await tx.get(ref)).data() as TrendDoc | undefined, email, "소재");
    tx.update(ref, { domestic, updatedAt: Date.now(), updatedBy: email });
  });
}

export async function getTrend(db: Firestore, email: string, id: unknown): Promise<TrendDoc & { id: string }> {
  if (!isDocId(id)) throw new Error("소재 id 가 올바르지 않습니다.");
  return { ...assertRead((await trends(db).doc(id).get()).data() as TrendDoc | undefined, email, "소재"), id };
}

export async function deleteTrend(db: Firestore, email: string, id: unknown): Promise<void> {
  if (!isDocId(id)) throw new Error("소재 id 가 올바르지 않습니다.");
  assertOwner((await trends(db).doc(id).get()).data() as TrendDoc | undefined, email, "소재");
  await trends(db).doc(id).delete();
}

// ---- 프로젝트 ----------------------------------------------------------

const projects = (db: Firestore) => db.collection(NEANDER_COL.shortsProjects);
type StoredProject = ProjectDoc & { versionAt?: Partial<Record<VersionDoc["kind"], number>> };

function sanitizeCandidate(v: unknown, prev: CoupangCandidate | undefined, email: string, now: number): CoupangCandidate {
  const r = rec(v);
  const url = httpUrl(str(r.url, 2000));
  const match = oneOf(r.match, ["candidate", "identical", "rejected"] as const, "candidate");
  const checks = rec(r.checks);
  const tri = (x: unknown) => (x === true ? true : x === false ? false : null);
  const wasConfirmed = prev?.match === "identical" && prev.confirmedBy;
  return {
    id: idOf(r.id, "cp_"),
    url,
    productId: coupangProductId(url) ?? (str(r.productId, 30) || null),
    name: str(r.name, 300),
    brand: str(r.brand, 100),
    model: str(r.model, 100),
    size: str(r.size, 200),
    material: str(r.material, 200),
    spec: str(r.spec, 500),
    options: str(r.options, 500),
    price: numOrNull(r.price, 0, 1e10),
    saleStatus: oneOf(r.saleStatus, ["on_sale", "sold_out", "unknown"] as const, "unknown"),
    checkedAt: prev && prev.price === numOrNull(r.price) && prev.saleStatus === r.saleStatus ? prev.checkedAt : now,
    // api 출처는 서버가 검색 API 로 넣은 후보(research 라우트)에만 남는다 — 화면이 보낸 주장은 받지 않는다
    source: prev?.source === "api" ? "api" : "manual",
    comparison: str(r.comparison, 3000),
    match,
    checks: {
      brand: tri(checks.brand),
      model: tri(checks.model),
      size: tri(checks.size),
      material: tri(checks.material),
      options: tri(checks.options),
      appearance: tri(checks.appearance),
    },
    confirmedBy: match === "identical" ? (wasConfirmed ? prev!.confirmedBy : email) : null,
    confirmedAt: match === "identical" ? (wasConfirmed ? prev!.confirmedAt : now) : null,
  };
}

function sanitizeAffiliate(v: unknown, prev: AffiliateLink | null, email: string, now: number): AffiliateLink | null {
  if (v === null || v === undefined) return null;
  const r = rec(v);
  const url = httpUrl(str(r.url, 2000));
  if (!url) return null;
  if (!isCoupangAffiliateUrl(url)) throw new Error("제휴 링크는 쿠팡 파트너스에서 발급한 link.coupang.com 주소여야 합니다.");
  const same = prev && prev.url === url;
  const subId = str(r.subId, 20);
  if (subId && !/^[A-Za-z0-9]{8,20}$/.test(subId)) throw new Error("채널 아이디(subId)는 파트너스에 등록한 8~20자 영문·숫자입니다.");
  return {
    url,
    candidateId: typeof r.candidateId === "string" ? str(r.candidateId, 48) : null,
    subId: same ? prev!.subId : subId,
    method: same ? prev!.method : "manual",
    issuedAt: same ? prev!.issuedAt : now,
    by: same ? prev!.by : email,
    // 붙여 넣은 링크는 붙여 넣은 사람의 파트너스 링크로 본다 — 브라우저가 보낸 주인은 받지 않는다
    coupangOwner: same ? (prev!.coupangOwner ?? prev!.by) : email,
    accountId: same ? (prev!.accountId ?? null) : typeof r.accountId === "string" ? str(r.accountId, 120) || null : null,
  };
}

function sanitizeSource(v: unknown, prev: SourceClip | undefined, email: string, now: number): SourceClip {
  const r = rec(v);
  const url = httpUrl(str(r.url, 2000));
  return {
    id: idOf(r.id, "src_"),
    platform: oneOf(r.platform, PLATFORMS, url ? platformFromUrl(url) : "other"),
    url,
    creator: str(r.creator, 200),
    title: str(r.title, 300),
    memo: str(r.memo, 3000),
    terms: str(r.terms, 2000),
    collectedAt: prev?.collectedAt ?? now,
    collectedBy: prev?.collectedBy ?? email,
    fileIds: arr(r.fileIds, 20).map(fileIdOf).filter((x): x is string => !!x),
    segments: arr(r.segments, 50).map((s) => {
      const sr = rec(s);
      const start = num(sr.start, 0, 36_000, 0);
      return {
        id: idOf(sr.id, "seg_"),
        fileId: fileIdOf(sr.fileId),
        start,
        end: Math.max(start + 0.05, num(sr.end, 0, 36_000, start + 1)),
        purpose: oneOf(sr.purpose, PURPOSES, "broll"),
        note: str(sr.note, 500),
      };
    }),
  };
}

function sanitizeScene(v: unknown, prev: Scene | undefined): Scene {
  const r = rec(v);
  const kind = oneOf(r.kind, ["clip", "ai", "image", "blank"] as const, "blank");
  const clip = rec(r.clip);
  const ai = rec(r.ai);
  const image = rec(r.image);
  let duration = num(r.duration, 0.1, 180, 3);
  const clipOut =
    kind === "clip" && fileIdOf(clip.fileId)
      ? (() => {
          const start = num(clip.start, 0, 36_000, 0);
          const end = Math.max(start + 0.1, num(clip.end, 0, 36_000, start + duration));
          duration = Math.round((end - start) * 1000) / 1000;
          return {
            fileId: fileIdOf(clip.fileId)!,
            start,
            end,
            sourceId: typeof clip.sourceId === "string" ? str(clip.sourceId, 48) : null,
            segmentId: typeof clip.segmentId === "string" ? str(clip.segmentId, 48) : null,
          };
        })()
      : null;
  const prevAi = prev?.ai;
  return {
    id: idOf(r.id, "sc_"),
    kind,
    label: str(r.label, 100),
    duration,
    clip: clipOut,
    ai:
      kind === "ai"
        ? {
            prompt: str(ai.prompt, 4000),
            // 생성 중 · 결과 파일은 작업 실행기가 적는다. 사람은 검토 결과(승인·반려)와 교체(파일 비우기)만
            status: (() => {
              const s = oneOf(ai.status, ["draft", "generating", "review", "approved", "rejected", "failed"] as const, "draft");
              if (prevAi?.status === "generating" && s !== "generating") return prevAi.status;
              if ((s === "approved" || s === "review") && !fileIdOf(ai.fileId)) return "draft";
              return s === "generating" ? (prevAi?.status ?? "draft") : s;
            })(),
            jobId: prevAi?.jobId ?? null,
            fileId: fileIdOf(ai.fileId),
            model: prevAi?.model ?? null,
            reviewNote: str(ai.reviewNote, 1000),
          }
        : null,
    image: kind === "image" && fileIdOf(image.fileId) ? { fileId: fileIdOf(image.fileId)! } : null,
    keepAudio: r.keepAudio === true,
  };
}

function sanitizeAnalysis(v: unknown, prev: FormulaAnalysis | null): FormulaAnalysis | null {
  if (v === null || v === undefined) return null;
  const r = rec(v);
  const core = {
    basis: arr(r.basis, 2).filter((b): b is "transcript" | "timing" => b === "transcript" || b === "timing"),
    urlRead: false as const,
    refs: arr(r.refs, 10).map((x) => ({ url: httpUrl(str(rec(x).url, 2000)), title: str(rec(x).title, 300) })),
    totalSec: numOrNull(r.totalSec, 0, 600),
    productRevealSec: numOrNull(r.productRevealSec, 0, 600),
    avgShotSec: numOrNull(r.avgShotSec, 0, 600),
    cutCount: numOrNull(r.cutCount, 0, 1000),
    hookPattern: str(r.hookPattern, 1000),
    beats: arr(r.beats, 20).map((b) => {
      const br = rec(b);
      const key = oneOf(br.key, BEATS, "demo");
      return {
        key,
        label: str(br.label, 60) || BEAT_LABEL[key],
        startSec: numOrNull(br.startSec, 0, 600),
        endSec: numOrNull(br.endSec, 0, 600),
        summary: str(br.summary, 1000),
        pattern: str(br.pattern, 500),
      } satisfies Beat;
    }),
    narrationSubtitle: oneOf(r.narrationSubtitle, ["same", "summary", "keywords", "none", "unknown"] as const, "unknown"),
    cta: ctaOf(rec(r.cta)),
    notes: str(r.notes, 4000),
  };
  // AI 결과는 AI 라우트만 "ai" 로 적는다. 사람이 한 글자라도 고치면 "manual" — 모델 이름은 처음 초안의 기록으로 남는다
  const unchanged = !!prev && JSON.stringify(stripMeta(prev)) === JSON.stringify(stripMeta(core));
  return {
    ...core,
    by: unchanged ? prev!.by : "manual",
    ...(prev?.model ? { model: prev.model } : {}),
    ...(prev?.costUsd ? { costUsd: prev.costUsd } : {}),
  };
}

const stripMeta = (a: object) => {
  const { by: _b, model: _m, costUsd: _c, urlRead: _u, ...rest } = a as Rec;
  return rest;
};

const ctaOf = (cta: Rec): CtaPlan => ({
  type: oneOf(cta.type, CTA_TYPES, "comment_keyword"),
  keyword: str(cta.keyword, 30),
  wording: str(cta.wording, 300),
  atSec: numOrNull(cta.atSec, 0, 600),
});

const COMPLIANCE_KEYS: ComplianceKey[] = [
  "disclosure",
  "videoDisclosure",
  "channelRegistered",
  "productMatch",
  "claims",
  "invalidClick",
  "dmConsent",
  "noPaidRelation",
  "sourceRights",
];

export function sanitizeProject(input: unknown, prev: StoredProject, email: string, now = Date.now()): StoredProject {
  const r = rec(input);
  const prevCand = new Map(prev.coupang.candidates.map((c) => [c.id, c]));
  const prevSrc = new Map(prev.sources.map((s) => [s.id, s]));
  const prevScene = new Map(prev.scenes.map((s) => [s.id, s]));
  const coupang = rec(r.coupang);
  const narr = rec(r.narration);
  const pub = rec(r.publish);
  const out = rec(r.output);
  const comp = rec(r.compliance);
  const ref = rec(r.reference);
  const subs = rec(r.subtitles);

  const compliance: Partial<Record<ComplianceKey, ComplianceCheck>> = {};
  for (const k of COMPLIANCE_KEYS) {
    const c = rec(comp[k]);
    const u = rec(c.user);
    const p = prev.compliance[k];
    const user =
      c.user === null || c.user === undefined || typeof u.ok !== "boolean"
        ? null
        : p?.user && p.user.ok === u.ok && p.user.note === str(u.note, 500)
          ? p.user
          : { ok: u.ok, by: email, at: now, note: str(u.note, 500) };
    // 프로그램 확인(system)은 서버가 게시 준비 때 다시 계산해 적는다 — 브라우저 값은 쓰지 않는다
    compliance[k] = { system: p?.system ?? null, user };
  }

  // 내레이션: AI 음성 조각은 실행기만 만든다. 사람은 녹음·파일로 바꾸거나 지울 수 있다
  const kind = oneOf(narr.kind, ["none", "ai", "recording", "file"] as const, "none");
  const narration: ProjectDoc["narration"] =
    kind === "ai"
      ? { ...prev.narration, gapSec: num(narr.gapSec, 0, 2, prev.narration.gapSec ?? 0.15) }
      : {
          kind,
          fileId: kind === "none" ? null : fileIdOf(narr.fileId),
          duration: kind === "none" ? null : numOrNull(narr.duration, 0, 600),
          voice: null,
          model: null,
          segments: [],
          gapSec: num(narr.gapSec, 0, 2, 0.15),
          scriptHash: kind === "none" ? null : str(narr.scriptHash, 40) || null,
        };
  if (narration.kind !== "none" && narration.kind !== "ai" && !narration.fileId) narration.kind = "none";

  const manualCosts = arr(r.costs, 200)
    .map((c) => rec(c))
    .filter((c) => c.auto !== true)
    .map((c): CostEntry => {
      const id = idOf(c.id, "cost_");
      const old = prev.costs.find((x) => x.id === id && !x.auto);
      return {
        id,
        kind: oneOf(c.kind, ["ai_text", "ai_voice", "ai_video", "material", "labor", "other"] as const, "other"),
        krw: numOrNull(c.krw, 0, 1e10),
        usd: numOrNull(c.usd, 0, 1e7),
        minutes: numOrNull(c.minutes, 0, 1e6),
        note: str(c.note, 300),
        at: old?.at ?? now,
        by: old?.by ?? email,
        auto: false,
      };
    });

  // 영상 종류: 쿠팡 ↔ 일반만 화면에서 바꾼다. 고객사 영상은 clients.createClientProject 로만 생기고 바뀌지 않는다
  if (r.kind !== undefined && r.kind !== prev.kind) {
    if (prev.kind === "brand") throw new Error("고객사 영상은 종류를 바꿀 수 없습니다.");
    if (r.kind === "brand") throw new Error("고객사 영상은 고객사 화면의 「영상 추가」 로만 만듭니다.");
  }
  const next: StoredProject = {
    ...prev,
    kind: prev.kind === "brand" ? "brand" : r.kind === "general" || r.kind === "coupang" ? r.kind : prev.kind,
    visibility: prev.owner === email ? vis(r.visibility) : prev.visibility,
    updatedAt: now,
    updatedBy: email,
    title: str(r.title, 200) || prev.title,
    product: str(r.product, 200),
    category: str(r.category, 60),
    stage: oneOf(r.stage, ["research", "sourcing", "matching", "scripting", "editing", "ready", "published", "archived"] as const, prev.stage),
    // 브랜드 영상: 달 · 올릴 곳 · 제품만 화면에서 바꾼다. 고객사 · 담당자 사본 · 승인 기록은 서버만 (clients.ts · reviews.ts)
    month: prev.kind === "brand" && typeof r.month === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(r.month) ? r.month : prev.month,
    brandTarget: prev.kind === "brand" ? oneOf(r.brandTarget, ["client", "own"] as const, prev.brandTarget) : prev.brandTarget,
    clientProductId: prev.kind === "brand" ? (typeof r.clientProductId === "string" ? str(r.clientProductId, 48) || null : null) : null,
    mode: oneOf(r.mode, ["remix", "hybrid", "ai"] as const, prev.mode),
    facts: arr(r.facts, 30).map((f) => str(f, 300).trim()).filter(Boolean),
    notes: str(r.notes, 6000),
    chinese: {
      terms: arr(rec(r.chinese).terms, 40).map((t): ChineseTerm => {
        const tr = rec(t);
        return {
          id: idOf(tr.id, "zh_"),
          text: str(tr.text, 60).trim(),
          kind: oneOf(tr.kind, ["name", "synonym", "use", "problem"] as const, "name"),
          meaning: str(tr.meaning, 120),
          by: tr.by === "ai" ? "ai" : "manual",
        };
      }).filter((t) => t.text),
      generatedAt: prev.chinese.generatedAt,
    },
    sources: arr(r.sources, 30).map((s) => sanitizeSource(s, prevSrc.get(str(rec(s).id, 48)), email, now)),
    coupang: {
      candidates: arr(coupang.candidates, 20).map((c) => sanitizeCandidate(c, prevCand.get(str(rec(c).id, 48)), email, now)),
      affiliate: sanitizeAffiliate(coupang.affiliate, prev.coupang.affiliate, email, now),
    },
    reference: {
      url: httpUrl(str(ref.url, 2000)),
      title: str(ref.title, 300),
      transcript: str(ref.transcript, 20_000),
      timing: str(ref.timing, 6000),
    },
    analysis: sanitizeAnalysis(r.analysis, prev.analysis),
    templateId: typeof r.templateId === "string" && isDocId(r.templateId) ? r.templateId : null,
    script: {
      lines: arr(rec(r.script).lines, 80).map((l): ScriptLine => {
        const lr = rec(l);
        return {
          id: idOf(lr.id, "ln_"),
          beat: oneOf(lr.beat, BEATS, "demo"),
          text: str(lr.text, 400),
          caption: str(lr.caption, 200),
          sceneId: typeof lr.sceneId === "string" ? str(lr.sceneId, 48) : null,
        };
      }),
    },
    scenes: arr(r.scenes, 60).map((s) => sanitizeScene(s, prevScene.get(str(rec(s).id, 48)))),
    narration,
    subtitles: {
      cues: arr(subs.cues, 200)
        .map((c): SubtitleCue => {
          const cr = rec(c);
          const start = num(cr.start, 0, 600, 0);
          return { start, end: Math.max(start, num(cr.end, 0, 600, start)), text: str(cr.text, 200), lineId: typeof cr.lineId === "string" ? str(cr.lineId, 48) : null };
        })
        .filter((c) => c.end > c.start),
      edited: subs.edited === true,
    },
    output: {
      width: 720,
      height: 1280,
      fps: oneOf(out.fps, [24, 25, 30] as never[], 30 as never),
      sourceVolume: num(out.sourceVolume, 0, 1, 0.25),
      disclosureOverlay: out.disclosureOverlay !== false,
    },
    virtualHuman: r.virtualHuman === true,
    publish: {
      title: str(pub.title, 100),
      description: str(pub.description, 4500),
      hashtags: arr(pub.hashtags, 15).map((h) => str(h, 40).replace(/^#+/, "").trim()).filter(Boolean),
      privacy: oneOf(pub.privacy, ["private", "unlisted", "public"] as const, "private"),
      madeForKids: pub.madeForKids === true,
      synthetic: pub.synthetic === true ? true : pub.synthetic === false ? false : null,
    },
    cta: ctaOf(rec(r.cta)),
    compliance,
    costs: [...prev.costs.filter((c) => c.auto), ...manualCosts].slice(-300),
    renderIds: prev.renderIds,
    sample: prev.sample,
  };
  return next;
}

export async function listProjects(db: Firestore, email: string, admin = false): Promise<(ProjectDoc & { id: string })[]> {
  const snap = await projects(db).get();
  return snap.docs
    .map((d) => {
      const { versionAt: _v, ...rest } = d.data() as StoredProject;
      return { ...rest, id: d.id };
    })
    .filter((p) => canRead(p, email, admin))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * 프로젝트 하나. admin=true 는 관리자 **읽기** 경로(몰아보기)에서만 넘긴다 —
 * 이 함수 결과로 고치는 경로(AI · 조사 · 게시)는 admin 을 넘기지 않는다.
 */
export async function getProject(db: Firestore, email: string, id: unknown, admin = false): Promise<ProjectDoc & { id: string }> {
  if (!isDocId(id)) throw new Error("영상 id 가 올바르지 않습니다.");
  const { versionAt: _v, ...rest } = assertRead((await projects(db).doc(id).get()).data() as StoredProject | undefined, email, "영상", admin);
  return { ...rest, id };
}

export async function createProject(
  db: Firestore,
  email: string,
  input: { title?: unknown; product?: unknown; category?: unknown; trendId?: unknown; visibility?: unknown; notes?: unknown; kind?: unknown },
): Promise<string> {
  const id = newDocId();
  const trendId = isDocId(input.trendId) ? input.trendId : null;
  let seed: Partial<ProjectDoc> = {};
  if (trendId) {
    const t = await getTrend(db, email, trendId);
    seed = { product: t.product, category: t.category, title: t.product || t.title, notes: t.notes };
  }
  const p = emptyProject(email, {
    title: str(input.title, 200) || seed.title,
    product: str(input.product, 200) || seed.product,
    category: str(input.category, 60) || seed.category,
    trendId,
    notes: str(input.notes, 6000) || seed.notes,
    visibility: vis(input.visibility),
    kind: input.kind === "general" ? "general" : "coupang",
  });
  if (trendId) {
    const t = await getTrend(db, email, trendId);
    // 소재의 원본 영상을 첫 소스로 · 참고 자료로 옮긴다
    if (t.url) {
      p.sources.push({
        id: "src_trend",
        platform: t.platform,
        url: t.url,
        creator: t.channel,
        title: t.title,
        memo: "소재에서 가져온 원본",
        terms: "",
        collectedAt: Date.now(),
        collectedBy: email,
        fileIds: [],
        segments: [],
      });
      p.reference = { url: t.url, title: t.title, transcript: "", timing: "" };
    }
  }
  await db.runTransaction(async (tx) => {
    if (trendId) {
      const tref = trends(db).doc(trendId);
      const t = (await tx.get(tref)).data() as TrendDoc | undefined;
      if (t && canRead(t, email) && !t.projectId) tx.update(tref, { projectId: id, updatedAt: Date.now(), updatedBy: email });
    }
    tx.set(projects(db).doc(id), p);
  });
  return id;
}

export async function saveProject(
  db: Firestore,
  email: string,
  id: unknown,
  input: unknown,
  baseUpdatedAt: unknown,
): Promise<ProjectDoc & { id: string }> {
  if (!isDocId(id)) throw new Error("영상 id 가 올바르지 않습니다.");
  const ref = projects(db).doc(id);
  let saved!: StoredProject;
  const versions: { kind: VersionDoc["kind"]; data: unknown }[] = [];
  await db.runTransaction(async (tx) => {
    const prev = assertRead((await tx.get(ref)).data() as StoredProject | undefined, email, "영상");
    if (typeof baseUpdatedAt === "number" && baseUpdatedAt !== prev.updatedAt) {
      throw new AccessError(
        409,
        `${prev.updatedBy === email ? "다른 창에서" : prev.updatedBy + " 님이"} 먼저 고쳤습니다. 최신 내용을 불러온 뒤 다시 고쳐 주세요.`,
      );
    }
    const next = sanitizeProject(input, prev, email);
    const now = next.updatedAt;
    const versionAt = { ...(prev.versionAt ?? {}) };
    const pick = { reference: (p: ProjectDoc) => p.reference, analysis: (p: ProjectDoc) => p.analysis, script: (p: ProjectDoc) => p.script } as const;
    for (const kind of ["reference", "analysis", "script"] as const) {
      const before = JSON.stringify(pick[kind](prev));
      const after = JSON.stringify(pick[kind](next));
      if (before !== after && (!versionAt[kind] || now - versionAt[kind]! > 10 * 60_000)) {
        // 바뀌기 전 모습을 남긴다 — 되돌릴 자리가 생긴다
        if (before !== "null" && before !== JSON.stringify(pick[kind](emptyProject(prev.owner)))) versions.push({ kind, data: pick[kind](prev) });
        versionAt[kind] = now;
      }
    }
    saved = { ...next, versionAt };
    tx.set(ref, saved);
  });
  for (const v of versions) await addVersion(db, id, v.kind, v.data, email, "자동 저장 (바뀌기 전)");
  const { versionAt: _v, ...rest } = saved;
  return { ...rest, id };
}

/** 실행기·AI 가 프로젝트 일부를 고친다 — 사람의 저장과 같은 트랜잭션 규칙 (updatedAt 갱신) */
export async function patchProject(
  db: Firestore,
  id: string,
  by: string,
  mutate: (p: StoredProject) => StoredProject | void,
): Promise<ProjectDoc> {
  const ref = projects(db).doc(id);
  let out!: StoredProject;
  await db.runTransaction(async (tx) => {
    const prev = (await tx.get(ref)).data() as StoredProject | undefined;
    if (!prev) throw new Error("영상이 지워졌습니다.");
    const copy = structuredClone(prev);
    out = { ...(mutate(copy) ?? copy), updatedAt: Date.now(), updatedBy: by };
    tx.set(ref, out);
  });
  const { versionAt: _v, ...rest } = out;
  return rest;
}

export async function deleteProject(db: Firestore, email: string, id: unknown): Promise<void> {
  if (!isDocId(id)) throw new Error("영상 id 가 올바르지 않습니다.");
  const p = assertOwner((await projects(db).doc(id).get()).data() as ProjectDoc | undefined, email, "영상");
  const pubs = await db.collection(NEANDER_COL.shortsPublications).where("projectId", "==", id).get();
  if (pubs.docs.some((d) => ["queued", "uploading", "processing", "uncertain", "scheduled"].includes(String(d.data().status)))) {
    throw new Error("진행 중이거나 결과 확인이 필요한 게시가 있어 지울 수 없습니다. 게시 화면에서 먼저 정리해 주세요.");
  }
  const jobs = await db.collection(NEANDER_COL.shortsJobs).where("projectId", "==", id).get();
  if (jobs.docs.some((d) => ["queued", "running", "waiting"].includes(String(d.data().status)))) {
    throw new Error("진행 중인 생성 · 출력 작업이 있어 지울 수 없습니다. 작업이 끝나거나 취소된 뒤에 지워 주세요.");
  }
  const { deleteProjectMedia } = await import("./media");
  await deleteProjectMedia(db, id);
  const { deleteReviewLinks } = await import("./reviews");
  await deleteReviewLinks(db, id);
  // 버전 · 성과 · 끝난 작업 · 끝난 게시 기록도 함께 (게시된 영상은 플랫폼에 그대로 남는다)
  for (const col of [NEANDER_COL.shortsVersions, NEANDER_COL.shortsMetrics, NEANDER_COL.shortsJobs]) {
    const snap = await db.collection(col).where("projectId", "==", id).get();
    for (const d of snap.docs) await d.ref.delete();
  }
  for (const d of pubs.docs) await d.ref.delete();
  if (p.trendId) await trends(db).doc(p.trendId).update({ projectId: null }).catch(() => undefined);
  await projects(db).doc(id).delete();
}

// ---- 버전 --------------------------------------------------------------

const versionsCol = (db: Firestore) => db.collection(NEANDER_COL.shortsVersions);

export async function addVersion(db: Firestore, projectId: string, kind: VersionDoc["kind"], data: unknown, by: string, note: string): Promise<string> {
  const doc: VersionDoc = { projectId, kind, at: Date.now(), by, note: note.slice(0, 200), data: JSON.parse(JSON.stringify(data ?? null)) };
  const ref = await versionsCol(db).add(doc);
  return ref.id;
}

export async function listVersions(db: Firestore, email: string, projectId: unknown, admin = false): Promise<(VersionDoc & { id: string })[]> {
  await getProject(db, email, projectId, admin);
  const snap = await versionsCol(db).where("projectId", "==", projectId).get();
  return snap.docs
    .map((d) => ({ ...(d.data() as VersionDoc), id: d.id }))
    .sort((a, b) => b.at - a.at)
    .slice(0, 60);
}

export async function getVersion(db: Firestore, email: string, id: unknown, admin = false): Promise<VersionDoc & { id: string }> {
  if (!isDocId(id)) throw new Error("버전 id 가 올바르지 않습니다.");
  const v = (await versionsCol(db).doc(id).get()).data() as VersionDoc | undefined;
  if (!v) throw new Error("버전을 찾지 못했습니다.");
  await getProject(db, email, v.projectId, admin);
  return { ...v, id };
}

// ---- 템플릿 ------------------------------------------------------------

const templates = (db: Firestore) => db.collection(NEANDER_COL.shortsTemplates);

export function sanitizeTemplate(input: unknown, prev: TemplateDoc | undefined, email: string, now = Date.now()): TemplateDoc {
  const r = rec(input);
  const origin = rec(r.origin);
  return {
    owner: prev?.owner ?? email,
    visibility: prev && prev.owner !== email ? prev.visibility : vis(r.visibility),
    createdAt: prev?.createdAt ?? now,
    updatedAt: now,
    updatedBy: email,
    name: str(r.name, 100) || "이름 없는 공식",
    beats: arr(r.beats, 20).map((b) => {
      const br = rec(b);
      const key = oneOf(br.key, BEATS, "demo");
      const from = num(br.from, 0, 1, 0);
      return {
        key,
        label: str(br.label, 60) || BEAT_LABEL[key],
        summary: str(br.summary, 1000),
        pattern: str(br.pattern, 500),
        from,
        to: Math.max(from, num(br.to, 0, 1, from)),
      };
    }),
    totalSec: num(r.totalSec, 3, 180, 30),
    avgShotSec: numOrNull(r.avgShotSec, 0, 60),
    productRevealRatio: numOrNull(r.productRevealRatio, 0, 1),
    narrationSubtitle: oneOf(r.narrationSubtitle, ["same", "summary", "keywords", "none", "unknown"] as const, "unknown"),
    hookPattern: str(r.hookPattern, 1000),
    cta: ctaOf(rec(r.cta)),
    notes: str(r.notes, 4000),
    origin: prev?.origin ?? {
      projectId: isDocId(origin.projectId) ? origin.projectId : null,
      versionId: isDocId(origin.versionId) ? origin.versionId : null,
      basis: arr(origin.basis, 2).filter((b): b is "transcript" | "timing" => b === "transcript" || b === "timing"),
    },
    sample: prev?.sample ?? false,
  };
}

export async function listTemplates(db: Firestore, email: string, admin = false): Promise<(TemplateDoc & { id: string })[]> {
  const snap = await templates(db).get();
  return snap.docs
    .map((d) => ({ ...(d.data() as TemplateDoc), id: d.id }))
    .filter((t) => canRead(t, email, admin))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function saveTemplate(db: Firestore, email: string, id: unknown, input: unknown): Promise<string> {
  if (id) {
    if (!isDocId(id)) throw new Error("템플릿 id 가 올바르지 않습니다.");
    const ref = templates(db).doc(id);
    await db.runTransaction(async (tx) => {
      const prev = assertRead((await tx.get(ref)).data() as TemplateDoc | undefined, email, "공식");
      tx.set(ref, sanitizeTemplate(input, prev, email));
    });
    return id;
  }
  const newId = newDocId();
  await templates(db).doc(newId).set(sanitizeTemplate(input, undefined, email));
  return newId;
}

export async function deleteTemplate(db: Firestore, email: string, id: unknown): Promise<void> {
  if (!isDocId(id)) throw new Error("템플릿 id 가 올바르지 않습니다.");
  assertOwner((await templates(db).doc(id).get()).data() as TemplateDoc | undefined, email, "공식");
  await templates(db).doc(id).delete();
}

// ---- 설정 (점수 가중치) ------------------------------------------------

const settings = (db: Firestore) => db.collection(NEANDER_COL.shortsSettings);

export async function getWeights(db: Firestore, email: string): Promise<ScoreWeights> {
  const d = (await settings(db).doc(`user_${email}`).get()).data() as { weights?: ScoreWeights } | undefined;
  return { ...DEFAULT_WEIGHTS, ...(d?.weights ?? {}) };
}

export async function saveWeights(db: Firestore, email: string, input: unknown): Promise<ScoreWeights> {
  const r = rec(input);
  const w = {} as ScoreWeights;
  for (const k of Object.keys(DEFAULT_WEIGHTS) as (keyof ScoreWeights)[]) w[k] = num(r[k], 0, 20, DEFAULT_WEIGHTS[k]);
  await settings(db).doc(`user_${email}`).set({ weights: w, updatedAt: Date.now() }, { merge: true });
  return w;
}

/**
 * 하루 사용량 계수기 — 외부 API 한도를 넘기지 않으려고 (YouTube 검색 하루 100회 ·
 * 쿠팡 검색 분당 50회, 넘기면 24시간 차단). 한도를 넘으면 false.
 */
export async function takeQuota(db: Firestore, key: string, limit: number): Promise<{ ok: boolean; used: number }> {
  const ref = settings(db).doc(`usage_${key}`);
  return db.runTransaction(async (tx) => {
    const used = Number(((await tx.get(ref)).data() as { n?: number } | undefined)?.n) || 0;
    if (used >= limit) return { ok: false, used };
    tx.set(ref, { n: used + 1, at: Date.now() });
    return { ok: true, used: used + 1 };
  });
}

export async function readQuota(db: Firestore, key: string): Promise<number> {
  return Number(((await settings(db).doc(`usage_${key}`).get()).data() as { n?: number } | undefined)?.n) || 0;
}

// ---- 성과 기록 ---------------------------------------------------------

const metricsCol = (db: Firestore) => db.collection(NEANDER_COL.shortsMetrics);
const PERF_KEYS = ["views", "likes", "comments", "saves", "shares", "infoRequests", "clicks", "orders", "revenue"] as const;

export async function addMetricSnapshot(
  db: Firestore,
  email: string,
  input: Omit<MetricSnapshotDoc, "owner" | "by" | "at"> & { at?: number },
  trusted = false,
): Promise<string> {
  const p = await getProject(db, email, input.projectId);
  const values: MetricSnapshotDoc["values"] = {};
  for (const k of PERF_KEYS) {
    const v = numOrNull((input.values as Rec)[k], 0, 1e12);
    if (v !== null) values[k] = v;
  }
  if (!Object.keys(values).length) throw new Error("적을 숫자가 없습니다.");
  const doc: MetricSnapshotDoc = {
    owner: p.owner,
    projectId: input.projectId,
    publicationId: typeof input.publicationId === "string" ? input.publicationId.slice(0, 80) : null,
    platform: oneOf(input.platform, ["youtube", "instagram", "coupang", "other"] as const, "other"),
    at: trusted && input.at ? input.at : Date.now(),
    // 직접 입력 경로(trusted=false)는 언제나 manual — API 출처는 서버 동기화만 쓴다
    source: trusted ? input.source : "manual",
    values,
    note: str(input.note, 300),
    by: email,
  };
  const ref = await metricsCol(db).add(doc);
  return ref.id;
}

export async function listMetrics(db: Firestore, email: string, projectIds: string[]): Promise<MetricSnapshotView[]> {
  if (!projectIds.length) return [];
  const out: MetricSnapshotView[] = [];
  for (let i = 0; i < projectIds.length; i += 30) {
    const snap = await metricsCol(db).where("projectId", "in", projectIds.slice(i, i + 30)).get();
    out.push(...snap.docs.map((d) => ({ ...(d.data() as MetricSnapshotDoc), id: d.id })));
  }
  return out.sort((a, b) => a.at - b.at);
}

export async function deleteMetric(db: Firestore, email: string, id: unknown): Promise<void> {
  if (!isDocId(id)) throw new Error("기록 id 가 올바르지 않습니다.");
  const d = (await metricsCol(db).doc(id).get()).data() as MetricSnapshotDoc | undefined;
  if (!d) return;
  if (d.by !== email || d.source !== "manual") throw new AccessError(403, "직접 입력한 본인 기록만 지울 수 있습니다.");
  await metricsCol(db).doc(id).delete();
}
