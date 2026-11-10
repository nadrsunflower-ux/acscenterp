import "server-only";

// ============================================================
//  AI STUDIO 비서의 도구
// ------------------------------------------------------------
//  ⚠️ 이 파일의 유일한 원칙: **모델은 아무것도 쓰지 못한다.**
//
//  읽기 도구는 바로 실행한다 (조회는 되돌릴 게 없다).
//  쓰기는 도구가 아니라 **제안**이다 — `propose_note` · `propose_script` 는 Firestore 를
//  건드리지 않고 「이렇게 하자」 카드만 만든다. 노트는 사람이 카드의 「노트에 보관」 을
//  눌러야 시장 트렌드 화면과 같은 저장 경로(market · note.save)로 나가고, 대본은 대본
//  작성기로 가는 링크일 뿐이다 (대본은 거기서 사람이 만든다).
//
//  읽는 범위는 데이터 API(api/neander/shorts/data)와 같다 — 그 사람이 평소 보는 것만:
//    · 영상 · 성공 공식은 canRead(관리자 몰아보기 없이 · all=false) — 남의 비공개는 관리자도 못 본다
//    · 프로젝트는 listSpacesFor — 대행 프로젝트는 관리자 · 그 업체 담당자만
//    · 노트 · 대본은 사람마다 비공개 — 이 사람 것만
//  분석 자료(레이더 · 바이럴 형식 · 시장 · 노트 · 대본)는 프로젝트마다 따로라, 도구마다 space 를
//  받아 spaceDb 로 감싼다 (대시보드처럼 여러 프로젝트를 견주는 질문용 · 없으면 지금 프로젝트).
//
//  결과는 짧게 — 개수 상한 · 글자 자르기. 질문 한 번이 몇 원대에 머물러야 한다
//  (재무 · 매출 비서와 같은 감각 · Gemini Flash 기준).
//
//  재무 · 매출 비서(finance|sales/server/ai-tools.ts)와 같은 구조다. 다른 것은 도메인뿐이다.
// ============================================================

import type { Firestore } from "firebase-admin/firestore";
import { NEANDER_COL } from "@/lib/neander/collections";
import { argBits } from "@/lib/neander/ai/agent";
import {
  BEAT_LABEL,
  KIND_LABEL,
  PLATFORM_LABEL,
  PUBLICATION_LABEL,
  REVIEW_LABEL,
  STAGE_LABEL,
  projectCost,
  projectTotals,
  timelineSec,
} from "../model";
import { NOTE_SOURCE_LABEL, NOTE_STATUSES, NOTE_STATUS_LABEL, BRIEF_KIND_LABEL, groupTrend, sanitizeNote, type NoteSourceKind, type NoteStatus } from "../market";
import { NAVER_LABEL, RADAR_FILMED_LABEL, type RadarDoc } from "../radar";
import { AI_LEVEL_LABEL, KOREA_LABEL, LANG_DEP_LABEL, LIFECYCLE_LABEL, RISK_LABEL, countryLabel, formatStats, seenAt, type HitDoc } from "../scout";
import { WRITER_KIND_LABEL, WRITER_STYLE_LABEL } from "../script-writer";
import { extraRevisionKrw, planText, revisionText } from "../plans";
import { CLIENT_DELIVERY_LABEL, type ClientView, type MetricSnapshotView, type PerfMetricKey, type ProjectDoc, type ProjectKind, type ProjectStage, type PublicationView } from "../types";
import { DEFAULT_SPACE_ID, PRODUCTION_LABEL, SPACE_KIND_LABEL, spaceKind, spaceOf, type SpaceView } from "../spaces";
import { isShortsAdmin } from "./access";
import { listClients } from "./clients";
import { getBrief, getGroupSeries, getMarketSettings, listBriefDays, listChannelStats, listNotes } from "./market";
import { listPublications } from "./publishing";
import { listRadar } from "./radar-run";
import { getFormat, getHit, listFormats, listHits } from "./scout-store";
import { listScriptSessions } from "./script-writer";
import { getCuts, listCuts } from "./cuts";
import { titleTrends } from "./title-trends";
import { cutRange } from "../cuts";
import { TITLE_SOURCE_LABEL } from "../title-trends";
import { currentSpace, listSpacesFor, rootDb, spaceDb } from "./space-db";
import { listMetrics, listProjects, listTemplates } from "./store";

type Args = Record<string, unknown>;
type Video = ProjectDoc & { id: string };

// ---- 맥락 -------------------------------------------------------------------

export interface ShortsToolContext {
  /** 감싸지 않은 Firestore — 프로젝트마다 spaceDb 로 다시 감싼다 */
  db: Firestore;
  email: string;
  /** 대행 프로젝트를 볼 수 있나(listSpacesFor)에만 쓴다 — 자료 읽기(canRead)는 늘 관리자 몰아보기 없이 */
  admin: boolean;
  /** 지금 고른 프로젝트 (요청 머리글) */
  current: string;
  /** 볼 수 있는 프로젝트 (보관 포함) */
  spaces: SpaceView[];
  /** 대행 프로젝트의 업체 이름용 */
  clients: ClientView[];
  now: number;
  /** 한 요청 안에서 같은 자료를 두 번 읽지 않는다 */
  memo: Map<string, Promise<unknown>>;
  /** 이번 답의 제안 번호 */
  seq: { n: number };
}

/** 요청의 프로젝트로 감싼 db(requestDb) 에서 비서의 맥락을 만든다 — 읽기만 */
export async function loadShortsAssistantContext(db: Firestore, email: string, now = Date.now()): Promise<ShortsToolContext> {
  const root = rootDb(db);
  const admin = isShortsAdmin(email);
  const [spaces, clients] = await Promise.all([listSpacesFor(root, email, admin, true), listClients(root, email, admin)]);
  const cur = currentSpace(db) ?? DEFAULT_SPACE_ID;
  return { db: root, email, admin, current: spaces.some((s) => s.id === cur) ? cur : DEFAULT_SPACE_ID, spaces, clients, now, memo: new Map(), seq: { n: 0 } };
}

function once<T>(ctx: ShortsToolContext, key: string, fn: () => Promise<T>): Promise<T> {
  if (!ctx.memo.has(key)) ctx.memo.set(key, fn());
  return ctx.memo.get(key) as Promise<T>;
}

/** 볼 수 있는 모든 영상 — 데이터 API 와 같은 규칙 (canRead · all=false · 볼 수 있는 프로젝트만) */
export const visibleVideos = (ctx: ShortsToolContext) =>
  once(ctx, "videos", async () => {
    const visible = new Set(ctx.spaces.map((s) => s.id));
    return (await listProjects(ctx.db, ctx.email, false)).filter((p) => visible.has(spaceOf(p)));
  });

const pubsAll = (ctx: ShortsToolContext) =>
  once(ctx, "pubs", async () => listPublications(ctx.db, ctx.email, (await visibleVideos(ctx)).map((v) => v.id)));
const metricsAll = (ctx: ShortsToolContext) =>
  once(ctx, "metrics", async () => listMetrics(ctx.db, ctx.email, (await visibleVideos(ctx)).map((v) => v.id)));

/** 이메일 → ERP 팀원 이름 (화면의 nameOf 와 같은 규칙) */
const names = (ctx: ShortsToolContext) =>
  once(ctx, "names", async () => {
    const snap = await ctx.db.collection(NEANDER_COL.members).select("email", "name").get();
    const m = new Map<string, string>();
    for (const d of snap.docs) {
      const x = d.data() as { email?: string; name?: string };
      if (x.email && x.name) m.set(x.email.toLowerCase(), x.name);
    }
    return m;
  });

const whoOf = (ctx: ShortsToolContext, m: Map<string, string>, email: string) => {
  const name = m.get(email.toLowerCase()) ?? (email === "company" ? "회사 공용" : email.split("@")[0]);
  return email === ctx.email ? `${name}(나)` : name;
};

// ---- 작은 도움 ---------------------------------------------------------------

const cut = (v: unknown, n: number) => {
  const t = typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "";
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};
const s = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() && Number.isFinite(Number(v)) ? Number(v) : undefined);
const bool = (v: unknown) => (v === true || v === "true" ? true : v === false || v === "false" ? false : undefined);
const limitOf = (v: unknown, def: number, max: number) => Math.max(1, Math.min(max, Math.round(num(v) ?? def)));
/** 한국 시간 날짜 */
export const ymd = (ms: number | null | undefined) => (typeof ms === "number" && ms > 0 ? new Date(ms + 9 * 3600_000).toISOString().slice(0, 10) : null);
const isYmd = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const isYm = (v: unknown): v is string => typeof v === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
const round1 = (v: number | null | undefined) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v * 10) / 10 : null);
const isDocId = (v: unknown): v is string => typeof v === "string" && /^[\w-]{3,120}$/.test(v);

const VIS_LABEL = { private: "나만 보기", team: "팀 공개" } as const;
const MODE_LABEL: Record<ProjectDoc["mode"], string> = { remix: "기존 영상 재편집", hybrid: "소스 + AI 장면", ai: "전체 AI 생성" };
const NARRATION_LABEL: Record<ProjectDoc["narration"]["kind"], string> = { none: "없음", ai: "AI 음성", recording: "녹음", file: "음성 파일" };
const DECISION_LABEL = { pending: "검토 중", approved: "승인", revision: "수정 요청", withdrawn: "거둬들임(새 파일로 다시 보냄)" } as const;
const SOURCE_LABEL: Record<string, string> = { youtube_api: "YouTube API", instagram_api: "Instagram API", coupang_api: "쿠팡 API", manual: "직접 입력" };
const PERF_KEYS: PerfMetricKey[] = ["views", "likes", "comments", "saves", "shares", "infoRequests", "clicks", "orders", "revenue"];
const POST_KEYS: PerfMetricKey[] = ["views", "likes", "comments", "saves", "shares", "infoRequests"];
const STAGES = Object.keys(STAGE_LABEL) as ProjectStage[];
const KINDS = Object.keys(KIND_LABEL) as ProjectKind[];
const platformName = (p: string) => (p === "coupang" ? "쿠팡 제휴" : p === "other" ? "기타" : (PLATFORM_LABEL as Record<string, string>)[p] ?? p);

/** 프로젝트 이름표 — 「살림설계사무소 (자체 운영)」 · 「예시브랜드 주방 (대행 · 주식회사 예시브랜드)」 */
function spaceLabel(ctx: ShortsToolContext, sp: SpaceView | undefined): string {
  if (!sp) return "알 수 없는 프로젝트";
  const kind = spaceKind(sp);
  const client = kind === "agency" ? ctx.clients.find((c) => c.id === sp.clientId)?.name : undefined;
  return `${sp.name} (${SPACE_KIND_LABEL[kind]}${client ? ` · ${client}` : ""}${sp.archived ? " · 보관" : ""})`;
}
const spaceById = (ctx: ShortsToolContext, id: string) => ctx.spaces.find((x) => x.id === id);

/** space 인자 → 볼 수 있는 프로젝트. 없으면 지금 프로젝트. id 가 아니면 이름으로도 찾아 준다 */
function resolveSpace(ctx: ShortsToolContext, raw: unknown): { ok: true; space: SpaceView } | { ok: false; error: string } {
  const v = s(raw);
  if (!v) return { ok: true, space: spaceById(ctx, ctx.current) ?? ctx.spaces[0] };
  const byId = spaceById(ctx, v);
  if (byId) return { ok: true, space: byId };
  const exact = ctx.spaces.filter((x) => x.name === v);
  const like = exact.length ? exact : ctx.spaces.filter((x) => x.name.includes(v) || v.includes(x.name));
  if (like.length === 1) return { ok: true, space: like[0] };
  return {
    ok: false,
    error: like.length > 1 ? `「${v}」 에 맞는 프로젝트가 여럿입니다 — list_projects 의 id 를 쓰세요.` : `「${v}」 는 볼 수 있는 프로젝트가 아닙니다 — list_projects 의 id 를 쓰세요.`,
  };
}

const sdbOf = (ctx: ShortsToolContext, sp: SpaceView) => spaceDb(ctx.db, sp.id);

/** 게시 시각 — 플랫폼이 준 결과 시각, 없으면 마지막으로 바뀐 때 */
const postedAt = (p: Pick<PublicationView, "result" | "updatedAt">) => p.result?.at ?? p.updatedAt;

/** 숫자 몇 개만 — null 은 뺀다 (모름 ≠ 0) */
function pickNumbers(t: Partial<Record<PerfMetricKey, number | null>>, keys: PerfMetricKey[] = PERF_KEYS) {
  const out: Partial<Record<PerfMetricKey, number>> = {};
  for (const k of keys) if (typeof t[k] === "number") out[k] = t[k] as number;
  return out;
}

// ---- 성과 묶기 (순수 · 테스트 lib/neander/shorts/server/assistant-tools.test.ts) ---------------

export type PerfGroupBy = "platform" | "kind" | "week" | "video" | "project";

export interface PerfRow {
  key: string;
  label: string;
  /** 서로 다른 영상 편수 */
  videos: number;
  /** 게시 건수 (영상 × 플랫폼 · 기간 안에 게시된 것) — 쿠팡 줄은 게시가 아니라 0 */
  posts: number;
  /** 숫자가 하나라도 있는 게시 · 하나도 없는 게시 (모름 — 0 으로 더하지 않았다) */
  postsWithNumbers: number;
  postsWithoutNumbers: number;
  /** 숫자가 있는 것만의 합 — 아무 게시에도 숫자가 없으면 null */
  totals: Partial<Record<PerfMetricKey, number>>;
  sources: string[];
}

export interface PerfResult {
  rows: PerfRow[];
  total: PerfRow;
  /** 게시 기록 없이 적힌 숫자 (영상 × 플랫폼) — 게시일을 몰라 기간 집계에서 뺐다 */
  unattributed: number;
  truncated: boolean;
}

/** 월요일 (한국 시간) — 「주」 묶음 열쇠 */
export function weekOf(day: string): string {
  const t = Date.parse(`${day}T00:00:00Z`);
  const dow = (new Date(t).getUTCDay() + 6) % 7;
  return new Date(t - dow * 86_400_000).toISOString().slice(0, 10);
}

/**
 * 기간(게시일 기준) 안에 게시된 것의 성과를 묶는다.
 *   · 게시물마다 출처별 마지막 기록(누적)을 쓴다 — projectTotals 와 같은 규칙.
 *   · 쿠팡(클릭 · 주문 · 수익)은 게시물이 아니라 영상 단위 — 기간 안에 게시된 영상의 것만.
 *   · 숫자가 없는 게시는 따로 센다. 합계에 0 으로 넣지 않는다.
 */
export function aggregatePerformance(input: {
  videos: Pick<Video, "id" | "title" | "kind" | "spaceId">[];
  pubs: Pick<PublicationView, "id" | "projectId" | "platform" | "status" | "result" | "updatedAt">[];
  metrics: MetricSnapshotView[];
  from?: string;
  to?: string;
  by: PerfGroupBy;
  limit?: number;
  kindLabel?: (k: ProjectKind) => string;
  projectLabel?: (spaceId: string) => string;
}): PerfResult {
  const vById = new Map(input.videos.map((v) => [v.id, v]));
  const inRange = (day: string | null) => !!day && (!input.from || day >= input.from) && (!input.to || day <= input.to);
  const posts = input.pubs
    .filter((p) => p.status === "published" && vById.has(p.projectId))
    .map((p) => ({ ...p, day: ymd(postedAt(p)) }))
    .filter((p) => inRange(p.day));

  type Acc = { label: string; videos: Set<string>; posts: number; withN: number; withoutN: number; totals: Partial<Record<PerfMetricKey, number>>; sources: Set<string>; order: number };
  const rows = new Map<string, Acc>();
  const total: Acc = { label: "합계", videos: new Set(), posts: 0, withN: 0, withoutN: 0, totals: {}, sources: new Set(), order: 0 };
  const accOf = (key: string, label: string, order = 0) => {
    let a = rows.get(key);
    if (!a) rows.set(key, (a = { label, videos: new Set(), posts: 0, withN: 0, withoutN: 0, totals: {}, sources: new Set(), order }));
    return a;
  };
  const add = (a: Acc, vals: Partial<Record<PerfMetricKey, number>>, sources: Iterable<string>) => {
    for (const [k, v] of Object.entries(vals) as [PerfMetricKey, number][]) a.totals[k] = (a.totals[k] ?? 0) + v;
    for (const x of sources) a.sources.add(x);
  };
  const PLATFORM_ORDER: Record<string, number> = { youtube: 1, instagram: 2, coupang: 3 };
  const keyOf = (v: Pick<Video, "id" | "title" | "kind" | "spaceId">, platform: string, day: string): [string, string, number] => {
    switch (input.by) {
      case "platform":
        return [platform, platformName(platform), PLATFORM_ORDER[platform] ?? 9];
      case "kind":
        return [v.kind, input.kindLabel?.(v.kind) ?? v.kind, 0];
      case "week": {
        const w = weekOf(day);
        return [w, `${w} 주`, 0];
      }
      case "project": {
        const sp = spaceOf(v);
        return [sp, input.projectLabel?.(sp) ?? sp, 0];
      }
      default:
        return [v.id, v.title || "(제목 없음)", 0];
    }
  };

  // 영상 × 플랫폼 — 그 안의 게시마다 숫자가 있나
  const groups = new Map<string, typeof posts>();
  for (const p of posts) groups.set(`${p.projectId}|${p.platform}`, [...(groups.get(`${p.projectId}|${p.platform}`) ?? []), p]);
  const firstDay = new Map<string, string>();
  for (const [g, list] of groups) {
    const [vid, platform] = g.split("|");
    const v = vById.get(vid)!;
    const sorted = [...list].sort((a, b) => (a.day ?? "").localeCompare(b.day ?? ""));
    const day = sorted[0].day!;
    if (!firstDay.has(vid) || day < firstDay.get(vid)!) firstDay.set(vid, day);
    const snaps = input.metrics.filter((m) => m.projectId === vid && m.platform === platform);
    const t = projectTotals(snaps);
    const vals = pickNumbers(t, POST_KEYS);
    const hasLoose = snaps.some((m) => !m.publicationId && POST_KEYS.some((k) => typeof m.values[k] === "number"));
    const [key, label, order] = keyOf(v, platform, day);
    const a = accOf(key, label, order);
    sorted.forEach((p, i) => {
      const has = snaps.some((m) => m.publicationId === p.id && POST_KEYS.some((k) => typeof m.values[k] === "number")) || (i === 0 && hasLoose);
      for (const x of [a, total]) {
        x.posts += 1;
        if (has) x.withN += 1;
        else x.withoutN += 1;
      }
    });
    for (const x of [a, total]) {
      x.videos.add(vid);
      add(x, vals, t.sources);
    }
  }

  // 쿠팡 — 영상 단위 (기간 안에 게시된 영상의 것)
  for (const [vid, day] of firstDay) {
    const snaps = input.metrics.filter((m) => m.projectId === vid && m.platform === "coupang");
    if (!snaps.length) continue;
    const t = projectTotals(snaps);
    const vals = pickNumbers(t, ["clicks", "orders", "revenue"]);
    if (!Object.keys(vals).length) continue;
    const v = vById.get(vid)!;
    const [key, label, order] = keyOf(v, "coupang", day);
    const a = accOf(key, label, order);
    a.videos.add(vid);
    add(a, vals, t.sources);
    add(total, vals, t.sources);
  }

  // 게시 기록 없이 적힌 숫자 (게시일을 모른다)
  const publishedPairs = new Set(input.pubs.filter((p) => p.status === "published").map((p) => `${p.projectId}|${p.platform}`));
  const loose = new Set(
    input.metrics
      .filter((m) => vById.has(m.projectId) && (m.platform === "youtube" || m.platform === "instagram") && !publishedPairs.has(`${m.projectId}|${m.platform}`))
      .map((m) => `${m.projectId}|${m.platform}`),
  );

  const toRow = (key: string, a: Acc): PerfRow => ({
    key,
    label: a.label,
    videos: a.videos.size,
    posts: a.posts,
    postsWithNumbers: a.withN,
    postsWithoutNumbers: a.withoutN,
    totals: a.totals,
    sources: [...a.sources].map((x) => SOURCE_LABEL[x] ?? x),
  });
  let list = [...rows.entries()].map(([k, a]) => ({ k, a }));
  if (input.by === "platform") list.sort((x, y) => x.a.order - y.a.order);
  else if (input.by === "week") list.sort((x, y) => x.k.localeCompare(y.k));
  else list.sort((x, y) => (y.a.totals.views ?? -1) - (x.a.totals.views ?? -1) || y.a.posts - x.a.posts);
  const limit = input.limit ?? 30;
  const truncated = list.length > limit;
  list = list.slice(0, limit);
  return { rows: list.map(({ k, a }) => toRow(k, a)), total: toRow("total", total), unattributed: loose.size, truncated };
}

// ---- 영상 한 줄 ----------------------------------------------------------------

function videoRow(ctx: ShortsToolContext, m: Map<string, string>, v: Video, pubs: PublicationView[], metrics: MetricSnapshotView[]) {
  const mine = pubs.filter((p) => p.projectId === v.id);
  // 플랫폼마다 가장 최근 게시 기록 하나
  const byPlatform = new Map<string, PublicationView>();
  for (const p of [...mine].sort((a, b) => a.updatedAt - b.updatedAt)) byPlatform.set(p.platform, p);
  const snaps = metrics.filter((x) => x.projectId === v.id);
  const t = projectTotals(snaps);
  const perf = pickNumbers(t);
  const lastAt = snaps.length ? Math.max(...snaps.map((x) => x.at)) : null;
  return {
    id: v.id,
    title: cut(v.title, 60) || "(제목 없음)",
    kind: KIND_LABEL[v.kind],
    stage: STAGE_LABEL[v.stage],
    visibility: VIS_LABEL[v.visibility],
    owner: whoOf(ctx, m, v.owner),
    ...(v.kind === "brand" ? { client: v.clientName || null, month: v.month, review: REVIEW_LABEL[v.review?.state ?? "none"] } : {}),
    /** 완성 파일 수 (출력 · 바로 올리기) */
    renders: v.renderIds?.length ?? 0,
    posts: [...byPlatform.values()].map((p) => ({ platform: platformName(p.platform), status: PUBLICATION_LABEL[p.status], at: ymd(p.status === "published" ? postedAt(p) : (p.scheduledAt ?? p.updatedAt)) })),
    perf: Object.keys(perf).length ? perf : null,
    perfSources: [...t.sources].map((x) => SOURCE_LABEL[x] ?? x),
    perfAt: ymd(lastAt),
    updated: ymd(v.updatedAt),
  };
}

// ---- 도구 정의 ------------------------------------------------------------------

const SPACE_ARG = { space: { type: "string", description: "프로젝트 id (list_projects). 비우면 지금 고른 프로젝트" } };

export const SHORTS_TOOL_DEFS = [
  {
    type: "function" as const,
    function: {
      name: "list_projects",
      description: "이 사람이 볼 수 있는 AI STUDIO 프로젝트(채널 단위) — 자체 운영 / 대행(업체 이름) · 영상 편수. 다른 프로젝트를 물을 때 id 를 찾는 데 먼저 쓴다.",
      parameters: { type: "object", additionalProperties: false, properties: {} },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "list_videos",
      description:
        "프로젝트의 영상 목록 — 제목 · 종류 · 단계 · 공개 범위 · 만든 사람 · 플랫폼별 게시 상태 · 최근 성과 숫자와 출처 · 고친 날. " +
        "total 과 byStage · byKind 는 limit 과 상관없이 조건에 맞는 전체를 센다 (편수 질문은 이걸로).",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          ...SPACE_ARG,
          stage: { type: "string", enum: STAGES, description: "research 소재 조사 · sourcing 소스 수집 · matching 쿠팡 확인 · scripting 대본·장면 · editing 편집·출력 · ready 게시 준비 · published 게시됨 · archived 보관" },
          kind: { type: "string", enum: KINDS, description: "coupang 쿠팡 제휴 · brand 고객사 · general 일반" },
          published: { type: "string", enum: ["yes", "no"], description: "yes = 게시된 기록이 있는 영상만 · no = 없는 영상만" },
          owner: { type: "string", enum: ["me", "all"], description: "me = 내가 만든 것만 · all(기본) = 볼 수 있는 전체 (팀 공개 포함)" },
          query: { type: "string", description: "제목 · 상품 이름에 든 글자" },
          limit: { type: "number", description: "기본 20 · 최대 50" },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_video",
      description: "영상 하나 — 사실 · 대본 줄 · 장면 수 · 게시 문구 · 완성 파일 · (고객사 영상이면) 검토 · 승인 기록 · 게시 기록 · 성과 기록 · 든 비용.",
      parameters: { type: "object", additionalProperties: false, required: ["id"], properties: { id: { type: "string", description: "영상 id (list_videos)" } } },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "performance",
      description:
        "기간(게시일 기준) 안에 게시된 것의 성과 합계를 묶는다 — 플랫폼 · 종류 · 주 · 영상 · 프로젝트별. 게시물마다 마지막 누적 기록을 쓰고, 숫자가 없는 게시는 따로 센다(모름 ≠ 0). " +
        "by=project 는 space 와 상관없이 볼 수 있는 모든 프로젝트를 견준다.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          ...SPACE_ARG,
          by: { type: "string", enum: ["platform", "kind", "week", "video", "project"], description: "기본 platform" },
          from: { type: "string", description: "게시일 시작 YYYY-MM-DD (한국 시간 · 포함)" },
          to: { type: "string", description: "게시일 끝 YYYY-MM-DD (포함)" },
          month: { type: "string", description: "YYYY-MM — from/to 대신" },
          kind: { type: "string", enum: KINDS },
          limit: { type: "number", description: "줄 수 기본 20 · 최대 40" },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "list_formats",
      description: "바이럴 형식 카드 — 이름 · 요약(AI 분석) · AI 로 만들기 난이도(AI 분석) · 언어 의존 · 위험 · 국내 상태 · 예시 수 · 수명(떠오름 · 유지 · 포화 조짐 …) · 배수 중앙값.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          ...SPACE_ARG,
          sort: { type: "string", enum: ["recent", "examples", "rising"], description: "recent 최근 고친 순(기본) · examples 예시 많은 순 · rising 떠오름 먼저" },
          include_archived: { type: "boolean" },
          limit: { type: "number", description: "기본 12 · 최대 30" },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_format",
      description: "형식 카드 하나 — 훅 · 구조 · 편집 · 소리 · 자막 · 먹히는 이유 · AI 로 쉬운/어려운 부분 · 브랜드 아이디어 (모두 AI 분석) · 국내 확인 · 예시 영상.",
      parameters: { type: "object", additionalProperties: false, required: ["id"], properties: { ...SPACE_ARG, id: { type: "string" } } },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "list_hits",
      description: "터진 영상 (감시 채널에서 평소 조회의 몇 배로 터진 쇼츠 · 직접 등록 포함) — 나라 · 배수 · 조회 · 묶인 형식.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          ...SPACE_ARG,
          country: { type: "string", description: "나라 코드 (KR · US · JP …)" },
          days: { type: "number", description: "최근 며칠 안에 게시된(모르면 찾은) 것 · 기본 30 · 최대 180" },
          min_multiple: { type: "number", description: "평소의 몇 배 이상" },
          include_dismissed: { type: "boolean" },
          limit: { type: "number", description: "기본 15 · 최대 40" },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "list_radar",
      description: "AI 레이더 후보 — 매일 키워드로 훑은 반응 큰 쇼츠. 조회 · 평소 대비 배수 · 하루 증가 · 정보 요청 댓글 · 국내 검색 추세(네이버) · 직접 촬영 표시. ai_ 로 시작하는 칸(상품 · 분류 · 이유)은 AI 추정.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          ...SPACE_ARG,
          days: { type: "number", description: "최근 며칠 안에 다시 본 후보 · 기본 21 · 최대 60" },
          category: { type: "string", description: "AI 분류 (살림 · 주방 · 수납 · 청소 · 다이소 · 기타)" },
          min_multiple: { type: "number" },
          sort: { type: "string", enum: ["score", "multiple", "per_day"], description: "기본 score(반응 점수)" },
          include_dismissed: { type: "boolean" },
          limit: { type: "number", description: "기본 15 · 최대 40" },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "market_brief",
      description: "시장 트렌드 — 그날(기본 가장 최근) 아침 브리핑(AI 가 고른 특기 사항) · 지난 브리핑 날짜 · 검색어 묶음의 최근 추세(네이버 상대값).",
      parameters: { type: "object", additionalProperties: false, properties: { ...SPACE_ARG, day: { type: "string", description: "YYYY-MM-DD" } } },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "list_notes",
      description: "내 트렌드 노트 (사람마다 비공개) — 제목 · 상태 · 태그 · 출처 · 그때 숫자 · 메모.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: { ...SPACE_ARG, status: { type: "string", enum: NOTE_STATUSES, description: "inbox 검토 전 · watch 지켜보기 · script 대본으로 · done 끝" }, limit: { type: "number", description: "기본 15 · 최대 40" } },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "list_scripts",
      description: "내 대본 작성기 세션 요약 (사람마다 비공개) — 제목 · 종류 · 방식 · 제품 · 버전 수 · 영상으로 만들었나.",
      parameters: { type: "object", additionalProperties: false, properties: { ...SPACE_ARG, limit: { type: "number", description: "기본 10 · 최대 30" } } },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_cut_table",
      description:
        "레퍼런스 영상 컷 표 (남의 잘된 쇼츠를 컷 전환마다 장면 · 말 · 화면 글자 · 소리 · 초로 뜯은 것 — AI 가 영상을 보고 적은 대략값). " +
        "id 없이 부르면 최근 컷 표 목록, id(yt_…)를 주면 그 컷 표.",
      parameters: { type: "object", additionalProperties: false, properties: { ...SPACE_ARG, id: { type: "string", description: "yt_<영상 id>" }, limit: { type: "number", description: "목록 기본 10 · 최대 30" } } },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "title_trends",
      description:
        "제목 키워드 — AI 레이더 · 터진 영상의 제목을 낱말로 나눠 한 주에 그 낱말을 쓴 **채널 수**와 평소(앞 4주) 대비 점수(-100~100)를 낸다. AI 없음. " +
        "words 를 주면 그 낱말의 주별 추이와 그 낱말을 쓴 영상.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          ...SPACE_ARG,
          source: { type: "string", enum: ["both", "radar", "hits"], description: "both(기본) · radar AI 레이더 · hits 터진 영상(바이럴 형식)" },
          country: { type: "string", description: "나라 코드 (터진 영상) — 비우면 전체" },
          week: { type: "string", description: "YYYY-Www (비우면 끝난 주 중 가장 최근)" },
          sort: { type: "string", enum: ["score", "count"], description: "score 점수 순(기본) · count 채널 수 순" },
          words: { type: "array", items: { type: "string" }, description: "추이를 볼 낱말 (최대 5)" },
          limit: { type: "number", description: "낱말 순위 줄 수 기본 15 · 최대 40" },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "propose_note",
      description:
        "「트렌드 노트로 보관」 카드를 제안한다 (저장하지 않는다 — 사람이 카드에서 누른다). 지금 고른 프로젝트 자료만. " +
        "근거 자료의 id 를 source_id 로 단다 — radar/hit/format 은 그 자료의 id, brief 는 「날짜:항목 번호」(market_brief 의 n · 브리핑 전체면 날짜만), keyword 는 검색어 묶음 id. 그때 숫자는 서버가 원본에서 만든다.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["title", "source_kind", "reason"],
        properties: {
          title: { type: "string", description: "노트 제목 (짧게)" },
          memo: { type: "string", description: "왜 보관하나 · 해 볼 것 (도구 결과의 숫자만)" },
          tags: { type: "array", items: { type: "string" }, description: "3개 안쪽" },
          status: { type: "string", enum: NOTE_STATUSES, description: "기본 inbox" },
          source_kind: { type: "string", enum: Object.keys(NOTE_SOURCE_LABEL) },
          source_id: { type: "string" },
          snapshot: { type: "string", description: "manual · channel 일 때만 — 도구 결과에 있는 숫자 한 줄" },
          product: { type: "string", description: "대본 작성기에 넘길 제품 이름 (있으면)" },
          reason: { type: "string", description: "카드에 보일 한 줄 — 왜 보관하자고 하나" },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "propose_script",
      description: "「대본 작성기에서 열기」 링크 카드를 제안한다 (저장 없음). 지금 고른 프로젝트의 바이럴 형식 카드(format) · 성공 공식(template) · 레이더 후보(radar) · 컷 표(cut) 를 참고로 미리 골라 연다.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["ref_kind", "ref_id", "reason"],
        properties: {
          ref_kind: { type: "string", enum: ["format", "template", "radar", "cut"] },
          ref_id: { type: "string" },
          reason: { type: "string", description: "카드에 보일 한 줄 — 왜 이걸로 쓰자고 하나" },
        },
      },
    },
  },
];

// ---- 제안 ---------------------------------------------------------------------

/** 노트 초안 — 시장 route 의 note.save 가 받는 모양 (server/market.ts saveNote → sanitizeNote) */
export interface ShortsNoteDraft {
  title: string;
  memo: string;
  tags: string[];
  status: NoteStatus;
  source: { kind: NoteSourceKind; id: string | null; url: string | null; label: string };
  snapshot: string;
  product: string;
}

/** 사람이 승인해야 반영되는 제안 */
export type ShortsProposal =
  | {
      kind: "note";
      id: string;
      space: string;
      spaceName: string;
      reason: string;
      note: ShortsNoteDraft;
      /** 제품 이름이 레이더의 AI 추정 그대로인가 — 카드가 「AI 추정」 으로 표시한다 */
      productAi?: boolean;
    }
  | { kind: "script"; id: string; space: string; spaceName: string; reason: string; ref: { kind: "format" | "template" | "radar" | "cut"; id: string; label: string }; href: string };

const fmtN = (v: number | null | undefined) => (typeof v === "number" ? v.toLocaleString("ko-KR") : "—");

/**
 * 근거 자료를 원본에서 다시 읽는다 — 지어낸 id 는 여기서 걸린다. 그때 숫자도 원본에서.
 * 이름표 · 그때 숫자는 시장 트렌드 화면의 「노트에 보관」 과 같은 모양 (「레이더 · 상품」 · 끝에 그날 날짜).
 * aiProduct = 레이더의 AI 추정 상품 이름 (카드가 「AI 추정」 으로 표시한다)
 */
async function noteSource(
  ctx: ShortsToolContext,
  sp: SpaceView,
  kind: NoteSourceKind,
  id: string | undefined,
): Promise<{ ok: true; source: ShortsNoteDraft["source"]; snapshot: string | null; aiProduct?: string } | { ok: false; error: string }> {
  const sdb = sdbOf(ctx, sp);
  const today = ymd(ctx.now)!;
  const line = (xs: (string | false | null | undefined)[]) => [...xs.filter(Boolean), today].join(" · ");
  if (kind === "manual") return { ok: true, source: { kind, id: null, url: null, label: "비서 대화" }, snapshot: null };
  if (!id) return { ok: false, error: "source_id 가 필요합니다 (도구 결과의 id)." };
  try {
    switch (kind) {
      case "radar": {
        const d = (await sdb.collection(NEANDER_COL.shortsRadar).doc(id).get()).data() as RadarDoc | undefined;
        if (!d) return { ok: false, error: `레이더 후보 ${id} 가 이 프로젝트에 없습니다 — list_radar 의 id 만 쓰세요.` };
        return {
          ok: true,
          source: { kind, id, url: d.url, label: `레이더 · ${cut(d.ai?.product || d.title, 70)}` },
          snapshot: line([
            `조회 ${fmtN(d.views)}`,
            d.multiple !== null && `평소의 ×${round1(d.multiple)}`,
            d.velocityPerDay !== null && `하루 +${fmtN(Math.round(d.velocityPerDay))}`,
            d.naver && `${NAVER_LABEL[d.naver.label]}${d.naver.change !== null ? ` ×${d.naver.change}` : ""}`,
          ]),
          aiProduct: d.ai?.product || undefined,
        };
      }
      case "hit": {
        const h = await getHit(sdb, id);
        return {
          ok: true,
          source: { kind, id, url: h.url, label: `터진 영상 · ${cut(h.title, 70)}` },
          snapshot: line([`조회 ${fmtN(h.views.v)}`, h.multiple !== null && `평소의 ×${round1(h.multiple)}`, countryLabel(h.country)]),
        };
      }
      case "format": {
        const f = await getFormat(sdb, id);
        const hits = (await listHits(sdb)).filter((h) => h.formatId === f.id);
        const st = formatStats(f, hits, ctx.now);
        return { ok: true, source: { kind, id, url: null, label: `형식 · ${cut(f.name, 70)}` }, snapshot: line([`예시 ${st.examples}편`, LIFECYCLE_LABEL[st.life.stage], KOREA_LABEL[st.korea]]) };
      }
      case "brief": {
        // 날짜 하나(브리핑 전체) 또는 「날짜:항목 번호」 (시장 화면이 항목마다 보관하는 열쇠와 같다)
        const m = /^(\d{4}-\d{2}-\d{2})(?::(\d{1,2}))?$/.exec(id);
        if (!m) return { ok: false, error: "브리핑의 source_id 는 날짜(YYYY-MM-DD) 또는 날짜:항목 번호(market_brief 의 n)입니다." };
        const b = await getBrief(sdb, m[1]);
        if (!b) return { ok: false, error: `${m[1]} 브리핑이 없습니다.` };
        if (m[2] === undefined) return { ok: true, source: { kind, id: m[1], url: null, label: `${b.day} 브리핑` }, snapshot: null };
        const it = b.items[Number(m[2])];
        if (!it) return { ok: false, error: `${m[1]} 브리핑에 ${m[2]}번 항목이 없습니다.` };
        return { ok: true, source: { kind, id, url: it.ref?.url ?? null, label: `${b.day} 브리핑 · ${BRIEF_KIND_LABEL[it.kind]}` }, snapshot: cut(it.numbers, 280) || null };
      }
      case "keyword": {
        const g = (await getMarketSettings(sdb)).groups.find((x) => x.id === id);
        if (!g) return { ok: false, error: `검색어 묶음 ${id} 가 없습니다 — market_brief 의 묶음 id 만 쓰세요.` };
        const series = (await getGroupSeries(sdb))[g.id];
        const t = series ? groupTrend(series.points) : null;
        return { ok: true, source: { kind, id, url: null, label: `검색어 묶음 · ${g.name}` }, snapshot: t ? line([NAVER_LABEL[t.label], `최근 2주 ÷ 그 전 6주 ${t.change ?? "—"}`]) : null };
      }
      case "channel": {
        const c = (await listChannelStats(sdb)).find((x) => x.id === id);
        if (!c) return { ok: false, error: `채널 기록 ${id} 가 없습니다.` };
        return { ok: true, source: { kind, id, url: null, label: `${c.mine ? "내 채널" : "감시 채널"} · ${cut(c.name, 60)}` }, snapshot: null };
      }
      default:
        return { ok: false, error: "알 수 없는 출처입니다." };
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "근거 자료를 읽지 못했습니다." };
  }
}

/** 노트 · 대본 제안은 지금 고른 프로젝트에서만 — 적용(저장 · 링크)이 지금 프로젝트 머리글로 나가기 때문 */
function currentOnly(ctx: ShortsToolContext): { ok: true; space: SpaceView } | { ok: false; error: string } {
  const sp = spaceById(ctx, ctx.current);
  return sp ? { ok: true, space: sp } : { ok: false, error: "지금 고른 프로젝트를 찾지 못했습니다." };
}

// ---- 실행 ---------------------------------------------------------------------

export interface ShortsToolOutcome {
  result: unknown;
  proposal?: ShortsProposal;
}

export async function runShortsTool(name: string, a: Args, ctx: ShortsToolContext): Promise<ShortsToolOutcome> {
  try {
    return await run(name, a, ctx);
  } catch (e) {
    // 도구 하나가 실패해도 대화는 이어 간다 — 모델이 이유를 사람에게 말할 수 있게
    return { result: { ok: false, error: e instanceof Error ? cut(e.message, 200) : "조회에 실패했습니다." } };
  }
}

async function run(name: string, a: Args, ctx: ShortsToolContext): Promise<ShortsToolOutcome> {
  switch (name) {
    case "list_projects": {
      const videos = await visibleVideos(ctx);
      return {
        result: {
          current: ctx.current,
          projects: ctx.spaces.map((sp) => {
            const mine = videos.filter((v) => spaceOf(v) === sp.id);
            const client = spaceKind(sp) === "agency" ? ctx.clients.find((c) => c.id === sp.clientId) : undefined;
            return {
              id: sp.id,
              name: sp.name,
              kind: SPACE_KIND_LABEL[spaceKind(sp)],
              client: client?.name ?? null,
              ...(client ? { delivery: CLIENT_DELIVERY_LABEL[client.delivery ?? "upload"], plan: planText(client.contract) || null, videosPerMonth: client.contract.videosPerMonth, revisions: revisionText(client.contract) } : {}),
              production: PRODUCTION_LABEL[sp.production],
              description: cut(sp.description, 80),
              archived: sp.archived || undefined,
              current: sp.id === ctx.current || undefined,
              videos: mine.length,
              publishedStage: mine.filter((v) => v.stage === "published").length,
            };
          }),
        },
      };
    }

    case "list_videos": {
      const r = resolveSpace(ctx, a.space);
      if (!r.ok) return { result: r };
      const [all, m] = await Promise.all([visibleVideos(ctx), names(ctx)]);
      const stage = STAGES.includes(a.stage as ProjectStage) ? (a.stage as ProjectStage) : undefined;
      const kind = KINDS.includes(a.kind as ProjectKind) ? (a.kind as ProjectKind) : undefined;
      const q = s(a.query)?.toLowerCase();
      let list = all.filter((v) => spaceOf(v) === r.space.id);
      if (a.owner === "me") list = list.filter((v) => v.owner === ctx.email || v.members?.includes(ctx.email));
      if (kind) list = list.filter((v) => v.kind === kind);
      if (q) list = list.filter((v) => `${v.title} ${v.product}`.toLowerCase().includes(q));
      // 줄마다 게시 상태 · 성과를 붙이므로 늘 읽는다 (한 요청에 한 번 — memo)
      const [pubs, metrics] = await Promise.all([pubsAll(ctx), metricsAll(ctx)]);
      if (a.published === "yes" || a.published === "no") {
        const done = new Set(pubs.filter((p) => p.status === "published").map((p) => p.projectId));
        list = list.filter((v) => (a.published === "yes" ? done.has(v.id) : !done.has(v.id)));
      }
      // 단계 · 종류 수는 단계 필터 전에 센다 — 「단계별로 몇 편」 을 한 번에 답하게
      const byStage: Record<string, number> = {};
      const byKind: Record<string, number> = {};
      for (const v of list) {
        byStage[STAGE_LABEL[v.stage]] = (byStage[STAGE_LABEL[v.stage]] ?? 0) + 1;
        byKind[KIND_LABEL[v.kind]] = (byKind[KIND_LABEL[v.kind]] ?? 0) + 1;
      }
      const totalBeforeStage = list.length;
      if (stage) list = list.filter((v) => v.stage === stage);
      const limit = limitOf(a.limit, 20, 50);
      return {
        result: {
          project: spaceLabel(ctx, r.space),
          scope: a.owner === "me" ? "내 것 (내가 만들었거나 담당)" : "볼 수 있는 전체 (내 것 + 팀 공개 + 담당 업체)",
          total: list.length,
          ...(stage ? { totalAllStages: totalBeforeStage } : {}),
          byStage,
          byKind,
          videos: list.slice(0, limit).map((v) => videoRow(ctx, m, v, pubs, metrics)),
          truncated: list.length > limit,
        },
      };
    }

    case "get_video": {
      const id = s(a.id);
      const v = (await visibleVideos(ctx)).find((x) => x.id === id);
      if (!v) return { result: { ok: false, error: "볼 수 있는 영상 중에 없습니다 (지워졌거나 · 다른 사람의 비공개 · 볼 수 없는 프로젝트의 영상)." } };
      const [pubs, metrics, m] = await Promise.all([pubsAll(ctx), metricsAll(ctx), names(ctx)]);
      const vp = pubs.filter((p) => p.projectId === v.id);
      const snaps = metrics.filter((x) => x.projectId === v.id).sort((x, y) => y.at - x.at);
      const platforms = [...new Set(snaps.map((x) => x.platform))];
      const cost = projectCost(v);
      const client = v.clientId ? ctx.clients.find((c) => c.id === v.clientId) : undefined;
      return {
        result: {
          id: v.id,
          title: v.title,
          project: spaceLabel(ctx, spaceById(ctx, spaceOf(v))),
          kind: KIND_LABEL[v.kind],
          stage: STAGE_LABEL[v.stage],
          mode: MODE_LABEL[v.mode],
          visibility: VIS_LABEL[v.visibility],
          owner: whoOf(ctx, m, v.owner),
          product: cut(v.product, 80) || null,
          category: v.category || null,
          facts: (v.facts ?? []).slice(0, 8).map((f) => cut(f, 100)),
          script: {
            lines: v.script?.lines?.length ?? 0,
            text: (v.script?.lines ?? []).slice(0, 20).map((l) => `${BEAT_LABEL[l.beat] ?? l.beat}: ${cut(l.text || l.caption, 100)}`),
            truncated: (v.script?.lines?.length ?? 0) > 20,
          },
          scenes: { count: v.scenes?.length ?? 0, totalSec: round1(timelineSec(v.scenes ?? [])), ai: (v.scenes ?? []).filter((x) => x.kind === "ai").length, clip: (v.scenes ?? []).filter((x) => x.kind === "clip").length },
          narration: NARRATION_LABEL[v.narration?.kind ?? "none"],
          subtitles: v.subtitles?.cues?.length ?? 0,
          publishText: { title: cut(v.publish?.title, 100) || null, description: cut(v.publish?.description, 300) || null, hashtags: (v.publish?.hashtags ?? []).slice(0, 10), privacy: v.publish?.privacy },
          /** 완성 파일 수 — 0 이면 아직 제작 완료 전 */
          renders: v.renderIds?.length ?? 0,
          ...(v.kind === "brand"
            ? {
                client: v.clientName || client?.name || null,
                delivery: client ? CLIENT_DELIVERY_LABEL[client.delivery ?? "upload"] : null,
                month: v.month,
                review: {
                  state: REVIEW_LABEL[v.review?.state ?? "none"],
                  revisionsUsed: v.review?.revisionsUsed ?? 0,
                  /** 완성본 수정 상한 — 검토 링크가 센다 (대본 수정은 세지 않는다) */
                  revisionLimit: client?.contract.revisionLimit ?? null,
                  extraRevisionKrw: client ? extraRevisionKrw(client.contract) : null,
                  rounds: (v.review?.rounds ?? []).slice(-6).map((r) => ({
                    n: r.n,
                    sent: ymd(r.sentAt),
                    decision: DECISION_LABEL[r.decision],
                    decided: ymd(r.decidedAt),
                    via: r.decidedVia === "link" ? "고객이 검토 링크에서" : r.decidedVia === "staff" ? "담당자가 대신 기록" : null,
                    feedback: cut(r.feedback, 120) || null,
                    overLimit: r.extra || undefined,
                  })),
                },
              }
            : {}),
          posts: vp.slice(0, 8).map((p) => ({
            platform: platformName(p.platform),
            status: PUBLICATION_LABEL[p.status],
            scheduled: ymd(p.scheduledAt),
            published: p.status === "published" ? ymd(postedAt(p)) : null,
            url: p.result?.url ?? null,
            from: p.origin === "external" ? "플랫폼에서 직접 올림 (자동 연결)" : "ERP 에서 게시",
          })),
          perf: {
            /** 플랫폼마다 마지막 누적 기록 (공식 API 가 있으면 API 를 쓴다) */
            byPlatform: platforms.map((pf) => {
              const t = projectTotals(snaps.filter((x) => x.platform === pf));
              return { platform: platformName(pf), ...pickNumbers(t), sources: [...t.sources].map((x) => SOURCE_LABEL[x] ?? x) };
            }),
            records: snaps.length,
            recent: snaps.slice(0, 6).map((x) => ({ at: ymd(x.at), platform: platformName(x.platform), source: SOURCE_LABEL[x.source] ?? x.source, ...pickNumbers(x.values) })),
          },
          cost: { krw: cost.krw || null, usd: cost.usd ? Math.round(cost.usd * 1000) / 1000 : null, minutes: cost.minutes || null },
          updated: ymd(v.updatedAt),
        },
      };
    }

    case "performance": {
      const by: PerfGroupBy = (["platform", "kind", "week", "video", "project"] as const).includes(a.by as PerfGroupBy) ? (a.by as PerfGroupBy) : "platform";
      let from = isYmd(a.from) ? a.from : undefined;
      let to = isYmd(a.to) ? a.to : undefined;
      if (isYm(a.month)) {
        const [y, mo] = a.month.split("-").map(Number);
        from = `${a.month}-01`;
        // 그 달의 마지막 날 (다음 달 0일)
        to = new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10);
      }
      const r = by === "project" ? null : resolveSpace(ctx, a.space);
      if (r && !r.ok) return { result: r };
      const kind = KINDS.includes(a.kind as ProjectKind) ? (a.kind as ProjectKind) : undefined;
      const [all, pubs, metrics] = await Promise.all([visibleVideos(ctx), pubsAll(ctx), metricsAll(ctx)]);
      const videos = all.filter((v) => (!r || spaceOf(v) === r.space.id) && (!kind || v.kind === kind));
      const out = aggregatePerformance({
        videos,
        pubs,
        metrics,
        from,
        to,
        by,
        limit: limitOf(a.limit, 20, 40),
        kindLabel: (k) => KIND_LABEL[k],
        projectLabel: (id) => spaceLabel(ctx, spaceById(ctx, id)),
      });
      return {
        result: {
          project: r ? spaceLabel(ctx, r.space) : `볼 수 있는 모든 프로젝트 ${ctx.spaces.length}개`,
          period: from || to ? `${from ?? "처음"} ~ ${to ?? "오늘"} (게시일 기준)` : "전체 기간 (게시일 기준)",
          by,
          rows: out.rows,
          total: out.total,
          truncated: out.truncated,
          notes: [
            "숫자는 게시물마다 마지막 누적 기록 — 그 기간에 늘어난 양이 아니라 지금까지의 합이다.",
            "숫자가 없는 게시(postsWithoutNumbers)는 합계에 0 으로 넣지 않았다 — 모르는 값이다.",
            "쿠팡 클릭 · 주문 · 수익은 영상 단위 (게시 건수 0).",
            ...(out.unattributed ? [`게시 기록 없이 적힌 숫자 ${out.unattributed}건(영상 × 플랫폼)은 게시일을 몰라 뺐다.`] : []),
          ],
        },
      };
    }

    case "list_formats": {
      const r = resolveSpace(ctx, a.space);
      if (!r.ok) return { result: r };
      const sdb = sdbOf(ctx, r.space);
      const [formats, hits] = await Promise.all([listFormats(sdb), listHits(sdb)]);
      const rows = formats
        .filter((f) => a.include_archived === true || !f.archived)
        .map((f) => ({ f, st: formatStats(f, hits.filter((h) => h.formatId === f.id), ctx.now) }));
      if (a.sort === "examples") rows.sort((x, y) => y.st.examples - x.st.examples);
      else if (a.sort === "rising") {
        const rank: Record<string, number> = { rising: 0, seed: 1, steady: 2, saturating: 3, unknown: 4, faded: 5 };
        rows.sort((x, y) => rank[x.st.life.stage] - rank[y.st.life.stage] || y.st.life.recent - x.st.life.recent);
      }
      const limit = limitOf(a.limit, 12, 30);
      return {
        result: {
          project: spaceLabel(ctx, r.space),
          total: rows.length,
          formats: rows.slice(0, limit).map(({ f, st }) => ({
            id: f.id,
            name: f.name,
            ai_summary: cut(f.summary, 140),
            ai_feasibility: AI_LEVEL_LABEL[f.aiFeasibility?.level] ?? null,
            ai_language: LANG_DEP_LABEL[f.languageDependence] ?? null,
            ai_risks: (f.risks ?? []).map((x) => RISK_LABEL[x]),
            korea: KOREA_LABEL[st.korea],
            examples: st.examples,
            life: LIFECYCLE_LABEL[st.life.stage],
            lifeBasis: st.life.basis,
            medianMultiple: round1(st.medianMultiple),
            foreignFirst: st.foreignFirst ? `${countryLabel(st.foreignFirst.code)} ${st.foreignFirst.at.slice(0, 10)}` : null,
            lagDays: st.lagDays,
            archived: f.archived || undefined,
          })),
          truncated: rows.length > limit,
        },
      };
    }

    case "get_format": {
      const r = resolveSpace(ctx, a.space);
      if (!r.ok) return { result: r };
      const sdb = sdbOf(ctx, r.space);
      const f = await getFormat(sdb, s(a.id));
      const hits = (await listHits(sdb)).filter((h) => h.formatId === f.id);
      const st = formatStats(f, hits, ctx.now);
      return {
        result: {
          project: spaceLabel(ctx, r.space),
          id: f.id,
          name: f.name,
          note: "아래 ai_ 칸은 AI 가 예시 영상을 보고 쓴 분석이다 (사람이 고쳤을 수 있다).",
          ai_summary: cut(f.summary, 300),
          ai_hook: cut(f.hook, 200),
          ai_structure: (f.structure ?? []).slice(0, 8).map((x) => cut(x, 100)),
          ai_editing: cut(f.editing, 160),
          ai_sound: cut(f.sound, 120),
          ai_textOverlay: cut(f.textOverlay, 120),
          ai_whyItWorks: cut(f.whyItWorks, 200),
          ai_feasibility: { level: AI_LEVEL_LABEL[f.aiFeasibility?.level] ?? null, easy: cut(f.aiFeasibility?.easyParts, 140), hard: cut(f.aiFeasibility?.hardParts, 140) },
          ai_language: LANG_DEP_LABEL[f.languageDependence] ?? null,
          ai_risks: (f.risks ?? []).map((x) => RISK_LABEL[x]),
          ai_riskNote: cut(f.riskNote, 140),
          ai_brandIdeas: (f.brandIdeas ?? []).slice(0, 5).map((x) => cut(x, 100)),
          koreanQueries: (f.koreanQueries ?? []).slice(0, 5),
          korea: { status: KOREA_LABEL[st.korea], checked: ymd(f.korea?.checkedAt), note: cut(f.korea?.note, 140) || null },
          examples: st.examples,
          life: `${LIFECYCLE_LABEL[st.life.stage]} — ${st.life.basis}`,
          medianMultiple: round1(st.medianMultiple),
          lagDays: st.lagDays,
          exampleVideos: [...hits]
            .filter((h) => h.status !== "dismissed")
            .sort((x, y) => (y.multiple ?? -1) - (x.multiple ?? -1))
            .slice(0, 6)
            .map((h) => ({ id: h.id, title: cut(h.title, 60), channel: cut(h.channel, 30), country: countryLabel(h.country), multiple: round1(h.multiple), views: h.views.v, url: h.url })),
          memo: cut(f.note, 200) || null,
        },
      };
    }

    case "list_hits": {
      const r = resolveSpace(ctx, a.space);
      if (!r.ok) return { result: r };
      const sdb = sdbOf(ctx, r.space);
      const [hits, formats] = await Promise.all([listHits(sdb), listFormats(sdb)]);
      const fName = new Map(formats.map((f) => [f.id, f.name]));
      const days = limitOf(a.days, 30, 180);
      const since = ymd(ctx.now - days * 86_400_000)!;
      const country = s(a.country)?.toUpperCase();
      const minX = num(a.min_multiple);
      const list = hits
        .filter((h) => a.include_dismissed === true || h.status !== "dismissed")
        .filter((h) => (seenAt(h) ?? "").slice(0, 10) >= since)
        .filter((h) => !country || h.country === country)
        .filter((h) => minX === undefined || (h.multiple ?? -1) >= minX)
        .sort((x, y) => (y.multiple ?? -1) - (x.multiple ?? -1));
      const limit = limitOf(a.limit, 15, 40);
      return {
        result: {
          project: spaceLabel(ctx, r.space),
          period: `최근 ${days}일 (게시일 · 모르면 찾은 날)`,
          total: list.length,
          byCountry: list.reduce<Record<string, number>>((o, h) => ((o[countryLabel(h.country)] = (o[countryLabel(h.country)] ?? 0) + 1), o), {}),
          hits: list.slice(0, limit).map((h: HitDoc & { id: string }) => ({
            id: h.id,
            title: cut(h.title, 60),
            channel: cut(h.channel, 30),
            country: countryLabel(h.country),
            multiple: round1(h.multiple),
            views: h.views.v,
            published: h.publishedAt?.slice(0, 10) ?? null,
            found: h.found === "scan" ? "감시 채널 자동 수집" : "직접 등록",
            format: h.formatId ? (fName.get(h.formatId) ?? null) : null,
            ai_format: h.analysis?.formatName ?? null,
            status: h.status === "dismissed" ? "제외" : undefined,
            url: h.url,
          })),
          truncated: list.length > limit,
        },
      };
    }

    case "list_radar": {
      const r = resolveSpace(ctx, a.space);
      if (!r.ok) return { result: r };
      const days = limitOf(a.days, 21, 60);
      const cat = s(a.category);
      const minX = num(a.min_multiple);
      const list = (await listRadar(sdbOf(ctx, r.space), days))
        .filter((d) => a.include_dismissed === true || !d.dismissed)
        .filter((d) => !cat || d.ai?.category === cat)
        .filter((d) => minX === undefined || (d.multiple ?? -1) >= minX);
      if (a.sort === "multiple") list.sort((x, y) => (y.multiple ?? -1) - (x.multiple ?? -1));
      else if (a.sort === "per_day") list.sort((x, y) => (y.velocityPerDay ?? -1) - (x.velocityPerDay ?? -1));
      const limit = limitOf(a.limit, 15, 40);
      return {
        result: {
          project: spaceLabel(ctx, r.space),
          period: `최근 ${days}일 안에 다시 본 후보`,
          total: list.length,
          candidates: list.slice(0, limit).map((d) => ({
            id: d.id,
            title: cut(d.title, 60),
            channel: cut(d.channel, 30),
            views: d.views,
            multiple: round1(d.multiple),
            perDay: d.velocityPerDay !== null ? Math.round(d.velocityPerDay) : null,
            infoComments: d.info ? `${d.info.matched}/${d.info.sampled}` : null,
            ai_product: d.ai?.product || null,
            ai_category: d.ai?.category ?? null,
            ai_confidence: d.ai ? (d.ai.confidence === "likely" ? "그럴듯" : "불분명") : null,
            ai_why: cut(d.ai?.why, 100) || null,
            naver: d.naver ? `${NAVER_LABEL[d.naver.label]}${d.naver.change !== null ? ` ×${d.naver.change}` : ""}` : null,
            filmed: d.filmed ? RADAR_FILMED_LABEL[d.filmed.value] : null,
            savedAsSource: d.saved?.length ?? 0,
            published: d.publishedAt?.slice(0, 10) ?? null,
            url: d.url,
          })),
          truncated: list.length > limit,
        },
      };
    }

    case "market_brief": {
      const r = resolveSpace(ctx, a.space);
      if (!r.ok) return { result: r };
      const sdb = sdbOf(ctx, r.space);
      const [days, settings, series] = await Promise.all([listBriefDays(sdb, "", 7), getMarketSettings(sdb), getGroupSeries(sdb)]);
      const day = isYmd(a.day) ? a.day : days[0]?.day;
      const brief = day ? await getBrief(sdb, day) : null;
      return {
        result: {
          project: spaceLabel(ctx, r.space),
          brief: brief
            ? {
                day: brief.day,
                note: "브리핑 문장은 AI 가 자료에서 고른 것이다 (숫자는 그날 자료의 것).",
                headline: brief.headline,
                summary: brief.summary.slice(0, 5),
                items: brief.items.slice(0, 8).map((x, n) => ({ n, kind: BRIEF_KIND_LABEL[x.kind], title: cut(x.title, 80), why: cut(x.why, 160), numbers: cut(x.numbers, 120), action: cut(x.action, 120), ref: x.ref ? { kind: x.ref.kind, id: x.ref.id, label: cut(x.ref.label, 60) } : null })),
              }
            : null,
          ...(brief ? {} : { missing: day ? `${day} 브리핑이 없습니다.` : "이 프로젝트에는 아직 브리핑이 없습니다." }),
          recentBriefs: days.map((d) => ({ day: d.day, headline: cut(d.headline, 60) })),
          keywordGroups: settings.groups.map((g) => {
            const sr = series[g.id];
            const t = sr ? groupTrend(sr.points) : null;
            return {
              id: g.id,
              name: g.name,
              keywords: g.keywords.slice(0, 6),
              trend: t ? NAVER_LABEL[t.label] : "추이 기록 없음",
              change: t?.change ?? null,
              recent: t?.recent ?? null,
              before: t?.before ?? null,
              lastWeek: sr?.points.at(-1)?.period ?? null,
            };
          }),
          keywordNote: "검색어 값은 네이버 데이터랩 상대값(그 묶음 1년 중 가장 높은 주 = 100). change = 최근 2주 평균 ÷ 그 전 6주 평균. 묶음끼리 크기는 견줄 수 없다.",
        },
      };
    }

    case "list_notes": {
      const r = resolveSpace(ctx, a.space);
      if (!r.ok) return { result: r };
      const status = NOTE_STATUSES.includes(a.status as NoteStatus) ? (a.status as NoteStatus) : undefined;
      const list = (await listNotes(sdbOf(ctx, r.space), ctx.email)).filter((x) => !status || x.status === status);
      const limit = limitOf(a.limit, 15, 40);
      return {
        result: {
          project: spaceLabel(ctx, r.space),
          total: list.length,
          notes: list.slice(0, limit).map((x) => ({
            id: x.id,
            title: cut(x.title, 80),
            status: NOTE_STATUS_LABEL[x.status],
            pinned: x.pinned || undefined,
            tags: x.tags,
            source: cut(x.source.label, 60) || NOTE_SOURCE_LABEL[x.source.kind],
            sourceId: x.source.id,
            snapshot: x.snapshot || null,
            product: x.product || null,
            memo: cut(x.memo, 160) || null,
            updated: ymd(x.updatedAt),
          })),
          truncated: list.length > limit,
        },
      };
    }

    case "list_scripts": {
      const r = resolveSpace(ctx, a.space);
      if (!r.ok) return { result: r };
      const list = await listScriptSessions(sdbOf(ctx, r.space), ctx.email);
      const limit = limitOf(a.limit, 10, 30);
      return {
        result: {
          project: spaceLabel(ctx, r.space),
          total: list.length,
          sessions: list.slice(0, limit).map((x) => ({
            id: x.id,
            title: cut(x.title, 60),
            kind: WRITER_KIND_LABEL[x.kind] ?? x.kind,
            style: WRITER_STYLE_LABEL[x.style ?? "intro"],
            product: cut(x.product, 40) || null,
            versions: x.versionCount,
            madeVideo: !!x.projectId,
            updated: ymd(x.updatedAt),
          })),
          truncated: list.length > limit,
        },
      };
    }

    case "get_cut_table": {
      const r = resolveSpace(ctx, a.space);
      if (!r.ok) return { result: r };
      const sdb = sdbOf(ctx, r.space);
      const id = s(a.id);
      if (!id) {
        const limit = limitOf(a.limit, 10, 30);
        const list = await listCuts(sdb, limit);
        return {
          result: {
            project: spaceLabel(ctx, r.space),
            total: list.length,
            note: "컷 표는 AI 가 영상을 보고 적은 것이다 — 초는 대략값.",
            sheets: list.map((x) => ({ id: x.id, title: cut(x.title, 60), channel: cut(x.channel, 30), cuts: x.cutCount, sec: round1(x.durationSec), ai_hook: cut(x.hook, 100) || null, made: ymd(x.at), url: x.url })),
          },
        };
      }
      const sheet = await getCuts(sdb, id);
      if (!sheet) return { result: { ok: false, error: `컷 표 ${id} 가 이 프로젝트에 없습니다 — 목록(id 없이)에서 고르세요.` } };
      return {
        result: {
          project: spaceLabel(ctx, r.space),
          id: sheet.id,
          title: sheet.title,
          channel: sheet.channel,
          url: sheet.url,
          sec: round1(sheet.durationSec),
          secFrom: sheet.durationSrc === "api" ? "YouTube API" : sheet.durationSrc === "ai" ? "AI 가 본 값" : null,
          note: "아래는 AI 가 영상을 보고 적은 컷 표다 — 초 · 장면 · 말은 대략값이고 사실 확인이 아니다.",
          ai_hook: cut(sheet.hook, 160),
          ai_summary: cut(sheet.summary, 200),
          cuts: sheet.cuts.slice(0, 30).map((c, i) => ({
            n: i + 1,
            at: cutRange(c),
            beat: c.beat ? BEAT_LABEL[c.beat] : null,
            shot: cut(c.shot, 80),
            speech: cut(c.speech, 80) || null,
            caption: cut(c.caption, 50) || null,
            sound: cut(c.sound, 40) || null,
          })),
          truncated: sheet.cuts.length > 30,
          memo: cut(sheet.note, 160) || null,
        },
      };
    }

    case "title_trends": {
      const r = resolveSpace(ctx, a.space);
      if (!r.ok) return { result: r };
      const words = Array.isArray(a.words) ? a.words.filter((w): w is string => typeof w === "string").slice(0, 5) : [];
      const t = await titleTrends(sdbOf(ctx, r.space), { source: a.source, country: typeof a.country === "string" ? a.country.toUpperCase() : undefined, week: a.week, sort: a.sort, words }, ctx.now);
      const limit = limitOf(a.limit, 15, 40);
      const wk = new Map(t.weeks.map((w) => [w.key, w]));
      return {
        result: {
          project: spaceLabel(ctx, r.space),
          source: TITLE_SOURCE_LABEL[t.source],
          country: t.country || "전체",
          week: `${t.week} (${wk.get(t.week)?.start ?? "?"} 주 · 영상 ${wk.get(t.week)?.videos ?? 0}편 · 채널 ${wk.get(t.week)?.channels ?? 0}곳)`,
          thisWeek: t.thisWeek,
          baseWeeks: t.baseWeeks,
          note: "세는 단위는 채널(한 채널이 여러 편 써도 1). 점수 = 100×(이번 주 − 평소)÷(이번 주 + 평소), 이번 주 채널 2곳 이상일 때만. 모은 영상이 적은 주는 점수가 크게 흔들린다. AI 없음.",
          recentWeeks: t.weeks.slice(-8).map((w) => ({ week: w.key, start: w.start, videos: w.videos, channels: w.channels })),
          rows: t.rows.slice(0, limit).map((x) => ({ word: x.word, channels: x.cur, usual: x.base, score: x.score, videos: x.videos, totalChannels: x.totalChannels })),
          ...(t.words.length
            ? {
                words: t.words,
                series: t.series.map((x) => ({ word: x.word, points: x.points.slice(-8).map((p) => `${p.start} ${p.channels ?? "—"}`) })),
                videos: t.videos.slice(0, 8).map((v) => ({ title: cut(v.title, 60), channel: cut(v.channel, 30), week: v.week, matched: v.matched, multiple: round1(v.multiple), views: v.views, url: v.url })),
              }
            : {}),
          totals: t.totals,
          truncated: t.rows.length > limit,
        },
      };
    }

    case "propose_note": {
      const c = currentOnly(ctx);
      if (!c.ok) return { result: c };
      const kind = (Object.keys(NOTE_SOURCE_LABEL) as NoteSourceKind[]).includes(a.source_kind as NoteSourceKind) ? (a.source_kind as NoteSourceKind) : "manual";
      const src = await noteSource(ctx, c.space, kind, s(a.source_id));
      if (!src.ok) return { result: src };
      // 같은 근거로 이미 보관한 노트가 있으면 카드를 만들지 않는다 (시장 화면의 「보관됨」 과 같은 열쇠)
      if (src.source.id) {
        const kept = (await listNotes(sdbOf(ctx, c.space), ctx.email)).find((x) => x.source.kind === kind && x.source.id === src.source.id);
        if (kept) return { result: { ok: false, error: `이미 보관한 노트가 있습니다 — 「${cut(kept.title, 40)}」 (${NOTE_STATUS_LABEL[kept.status]}).` } };
      }
      const raw = {
        title: s(a.title),
        memo: s(a.memo) ?? "",
        tags: Array.isArray(a.tags) ? a.tags.slice(0, 5) : [],
        status: a.status,
        source: src.source,
        // 근거 자료가 있으면 그때 숫자는 원본에서 — 모델이 적은 숫자는 manual · channel 에만
        snapshot: src.snapshot ?? (kind === "manual" || kind === "channel" ? (s(a.snapshot) ?? "") : ""),
        product: s(a.product) ?? "",
      };
      const n = sanitizeNote(raw, ctx.email, ctx.now);
      const note: ShortsNoteDraft = { title: n.title, memo: n.memo, tags: n.tags, status: n.status, source: n.source, snapshot: n.snapshot, product: n.product };
      ctx.seq.n += 1;
      const proposal: ShortsProposal = {
        kind: "note",
        id: `note_${ctx.now.toString(36)}_${ctx.seq.n}`,
        space: c.space.id,
        spaceName: c.space.name,
        reason: cut(a.reason, 200),
        note,
        ...(src.aiProduct && note.product && note.product === src.aiProduct ? { productAi: true } : {}),
      };
      return { result: { ok: true, proposed: "note", title: note.title, source: note.source.label, snapshot: note.snapshot || null }, proposal };
    }

    case "propose_script": {
      const c = currentOnly(ctx);
      if (!c.ok) return { result: c };
      const kind = (["format", "template", "radar", "cut"] as const).find((k) => k === a.ref_kind);
      const id = s(a.ref_id);
      if (!kind || !id || !isDocId(id)) return { result: { ok: false, error: "ref_kind · ref_id 가 필요합니다 (도구 결과의 id)." } };
      const sdb = sdbOf(ctx, c.space);
      let label: string | null | undefined = null;
      if (kind === "format") {
        const f = await getFormat(sdb, id).catch(() => null);
        if (f && !f.archived) label = f.name;
      } else if (kind === "template") {
        const t = (await listTemplates(sdb, ctx.email, false)).find((x) => x.id === id);
        if (t) label = t.name;
      } else if (kind === "radar") {
        const d = (await sdb.collection(NEANDER_COL.shortsRadar).doc(id).get()).data() as RadarDoc | undefined;
        if (d) label = cut(d.ai?.product || d.title, 60);
      } else {
        label = await cutLabel(sdb, id);
        if (label === undefined) return { result: { ok: false, error: "컷 표 연결 전입니다 — 형식 카드 · 레이더 후보로 제안하세요." } };
      }
      if (!label) return { result: { ok: false, error: `지금 프로젝트(${c.space.name})에 그 ${kind === "format" ? "형식 카드" : kind === "template" ? "성공 공식" : kind === "radar" ? "레이더 후보" : "컷 표"}가 없습니다 — 도구 결과의 id 만 쓰세요.` } };
      ctx.seq.n += 1;
      const ref = `${kind}:${id}`;
      const proposal: ShortsProposal = {
        kind: "script",
        id: `script_${ctx.now.toString(36)}_${ctx.seq.n}`,
        space: c.space.id,
        spaceName: c.space.name,
        reason: cut(a.reason, 200),
        ref: { kind, id, label },
        href: `/neander/shorts/scripts?ref=${encodeURIComponent(ref)}`,
      };
      return { result: { ok: true, proposed: "script", ref: label }, proposal };
    }

    default:
      return { result: { ok: false, error: `알 수 없는 도구: ${name}` } };
  }
}

/** 컷 표 이름 (server/cuts.ts) — 없는 컷 표면 null. id 모양이 틀리면 getCuts 가 던진다 → 없음으로 */
async function cutLabel(sdb: Firestore, id: string): Promise<string | null | undefined> {
  const sheet = await getCuts(sdb, id).catch(() => null);
  return sheet ? cut(sheet.title || sheet.channel || id, 60) : null;
}

// ---- 화면에 보일 「무엇을 조회했나」 한 줄 ----------------------------------------------

export function summarizeShortsTool(name: string, a: Args, result: unknown): string {
  const r = (result ?? {}) as Record<string, unknown>;
  const bits = argBits(a);
  const tail = bits ? ` ${bits}` : "";
  if (r.ok === false) return `${name}${tail} — ${String(r.error ?? "실패")}`;
  switch (name) {
    case "list_projects":
      return `프로젝트 목록 → ${(r.projects as unknown[] | undefined)?.length ?? 0}개`;
    case "list_videos":
      return `영상 목록${tail} → ${r.total ?? 0}편`;
    case "get_video":
      return `영상 「${cut(r.title, 30)}」`;
    case "performance": {
      const t = r.total as PerfRow | undefined;
      return `성과${tail} → 게시 ${t?.posts ?? 0}건 (숫자 없음 ${t?.postsWithoutNumbers ?? 0}) · 영상 ${t?.videos ?? 0}편`;
    }
    case "list_formats":
      return `바이럴 형식${tail} → ${r.total ?? 0}개`;
    case "get_format":
      return `형식 카드 「${cut(r.name, 30)}」`;
    case "list_hits":
      return `터진 영상${tail} → ${r.total ?? 0}편`;
    case "list_radar":
      return `AI 레이더${tail} → ${r.total ?? 0}건`;
    case "market_brief":
      return `시장 브리핑${tail} → ${(r.brief as { day?: string } | null)?.day ?? "없음"}`;
    case "list_notes":
      return `내 트렌드 노트${tail} → ${r.total ?? 0}개`;
    case "list_scripts":
      return `내 대본${tail} → ${r.total ?? 0}개`;
    case "get_cut_table":
      return r.cuts ? `컷 표 「${cut(r.title, 30)}」 → 컷 ${(r.cuts as unknown[]).length}개` : `컷 표 목록${tail} → ${r.total ?? 0}개`;
    case "title_trends":
      return `제목 키워드${tail} → ${String(r.week ?? "").split(" (")[0]} · 낱말 ${(r.rows as unknown[] | undefined)?.length ?? 0}개`;
    case "propose_note":
      return `노트 보관 제안 — 「${cut(r.title, 30)}」`;
    case "propose_script":
      return `대본 작성기 링크 제안 — ${cut(r.ref, 30)}`;
    default:
      return `${name}${tail}`;
  }
}
