import "server-only";

// ============================================================
//  AI 레이더 실행 — 매일 아침 cron(⑥) · 화면의 「지금 돌리기」
// ------------------------------------------------------------
//  ① 키워드 검색 (search.list — 소재 발굴과 같은 계수기 ytsearch_<날짜>, 하루 90회)
//  ② 쇼츠 길이 · 최소 조회로 거르기 → 채널 평소 조회수(최근 쇼츠 중앙값, 채널마다 2단위)
//  ③ 새 후보의 댓글 표본(1단위씩) → 정보 요청 비율
//  ④ AI 가 글만 보고 상품 추정 (10편씩 · 하루 비용 상한 · 넘으면 내일로)
//  ⑤ 네이버 데이터랩 검색어 트렌드 (상품 묶음마다 1회 · 3일 안에 본 것은 다시 안 봄)
//  돈 드는 것은 ④ 뿐이고, 상한(원)은 설정에 있다. 동시에 두 번 돌지 않게 잠근다.
// ============================================================

import type { Firestore } from "firebase-admin/firestore";
import { AccessError } from "@/lib/neander/server/auth";
import { NEANDER_COL } from "@/lib/neander/collections";
import { INFO_REQUEST_KEYWORDS, countInfoRequests, emptyDomestic, emptyMetrics, measured } from "../model";
import {
  DEFAULT_RADAR_SETTINGS,
  NAVER_LABEL,
  USD_KRW,
  classifyNaverTrend,
  krwOf,
  normalizeProductKey,
  radarScore,
  radarVelocity,
  sanitizeRadarSettings,
  type RadarAi,
  type RadarDoc,
  type RadarRunSummary,
  type RadarSettings,
} from "../radar";
import { computeBaseline, isShortLike, multipleOf } from "../scout";
import type { TrendDoc } from "../types";
import { openrouterConfigured, radarIdentify } from "./ai";
import { naverConfig, naverWeeklySeries } from "./naver";
import { getTrend, takeQuota, writeTrendFromApi } from "./store";
import { YT_SEARCH_DAILY_LIMIT, youtubeApiKey, youtubeCommentSample, youtubeRecentUploads, youtubeSearch, youtubeVideos, type YoutubeSearchItem } from "./youtube-data";

type WithId<T> = T & { id: string };

const col = (db: Firestore) => db.collection(NEANDER_COL.shortsRadar);
const settingsCol = (db: Firestore) => db.collection(NEANDER_COL.shortsSettings);
export const kstDay = (t = Date.now()) => new Date(t + 9 * 3600_000).toISOString().slice(0, 10);
const docIdOf = (videoId: string) => `yt_${videoId}`;
const isRadarId = (v: unknown): v is string => typeof v === "string" && /^yt_[\w-]{11}$/.test(v);

/** AI 한 묶음(8편) 어림 비용 — 상한 직전에 멈추는 데만 쓴다 (실제는 응답의 usage.cost · 2026-11-02 실측 10편 약 $0.011) */
const EST_BATCH_USD = 0.012;
const AI_BATCH = 8;
/** 한 번 돌 때 AI 로 볼 후보 상한 — 점수 큰 것부터. 나머지는 다음 실행에 */
const MAX_AI_PER_RUN = 64;
const MAX_CHANNELS = 25;
const MAX_COMMENT_SAMPLES = 20;
const MAX_NAVER_CALLS = 20;
const NAVER_FRESH_MS = 3 * 86_400_000;
const KEEP_DAYS = 45;

// ---- 설정 · 요약 · 비용 · 잠금 ------------------------------------------------

export async function getRadarSettings(db: Firestore): Promise<RadarSettings> {
  const d = (await settingsCol(db).doc("radar").get()).data() as Partial<RadarSettings> | undefined;
  return { ...DEFAULT_RADAR_SETTINGS, ...(d ?? {}) };
}

export async function saveRadarSettings(db: Firestore, by: string, input: unknown): Promise<RadarSettings> {
  const next = sanitizeRadarSettings(input, await getRadarSettings(db), by);
  await settingsCol(db).doc("radar").set(next);
  return next;
}

export async function getRadarLast(db: Firestore): Promise<RadarRunSummary | null> {
  return ((await settingsCol(db).doc("radar_last").get()).data() as RadarRunSummary | undefined) ?? null;
}

export async function readRadarSpendUsd(db: Firestore, key: string): Promise<number> {
  return Number(((await settingsCol(db).doc(`usage_${key}`).get()).data() as { usd?: number } | undefined)?.usd) || 0;
}

async function addRadarSpend(db: Firestore, key: string, usd: number) {
  const ref = settingsCol(db).doc(`usage_${key}`);
  await db.runTransaction(async (tx) => {
    const cur = Number(((await tx.get(ref)).data() as { usd?: number } | undefined)?.usd) || 0;
    tx.set(ref, { usd: cur + usd, at: Date.now() });
  });
}

async function takeLock(db: Firestore, name: string, ms: number): Promise<boolean> {
  const ref = settingsCol(db).doc(name);
  return db.runTransaction(async (tx) => {
    const until = Number(((await tx.get(ref)).data() as { until?: number } | undefined)?.until) || 0;
    if (until > Date.now()) return false;
    tx.set(ref, { until: Date.now() + ms });
    return true;
  });
}

// ---- 읽기 · 사람의 손 ---------------------------------------------------------

/** 최근 며칠 안에 다시 본 후보 — 점수 순 (조건 하나짜리 범위 질의라 복합 색인이 필요 없다) */
export async function listRadar(db: Firestore, days = 21): Promise<WithId<RadarDoc>[]> {
  const snap = await col(db).where("lastSeenAt", ">=", Date.now() - days * 86_400_000).get();
  return snap.docs.map((d) => ({ ...(d.data() as RadarDoc), id: d.id })).sort((a, b) => b.score - a.score);
}

async function getRadar(db: Firestore, id: unknown): Promise<WithId<RadarDoc>> {
  if (!isRadarId(id)) throw new Error("레이더 후보 id 가 올바르지 않습니다.");
  const d = (await col(db).doc(id).get()).data() as RadarDoc | undefined;
  if (!d) throw new AccessError(404, "레이더 후보를 찾지 못했습니다.");
  return { ...d, id };
}

/** 제외 · 되살리기 — 회사 공용 목록이라 누가 뺐는지 남긴다 */
export async function setRadarDismissed(db: Firestore, email: string, id: unknown, dismissed: boolean): Promise<void> {
  const r = await getRadar(db, id);
  await col(db).doc(r.id).update({ dismissed: dismissed ? { by: email, at: Date.now() } : null });
}

/** 소재로 저장 — 그 사람의 소재(비공개 기본)로. 이미 저장했으면 그 소재를 돌려준다 */
export async function saveRadarAsTrend(db: Firestore, email: string, id: unknown, visibility: unknown): Promise<string> {
  const r = await getRadar(db, id);
  const mine = r.saved.find((s) => s.by === email);
  if (mine && (await getTrend(db, email, mine.trendId).then(() => true, () => false))) return mine.trendId;
  const now = Date.now();
  const ai = r.ai;
  const notes = [
    `AI 레이더 ${new Date(r.firstSeenAt + 9 * 3600_000).toISOString().slice(0, 10)} · 점수 ${r.score} · 검색어 ${r.keywords.join(", ")}`,
    r.multiple !== null ? `채널 평소(최근 쇼츠 중앙값 ${r.baseline?.toLocaleString("ko-KR")}회)의 ${r.multiple}배` : "채널 평소 조회수 모름",
    ai?.why && `왜 먹혔나(AI 추정 · 글 기준): ${ai.why}`,
    ai?.hook && `훅(추정): ${ai.hook}`,
    ai?.caution && `주의: ${ai.caution}`,
    r.naver && `네이버 데이터랩(${r.naver.keywords.join(", ")}): ${NAVER_LABEL[r.naver.label]}${r.naver.change !== null ? ` · 최근 2주 ÷ 그 전 6주 = ${r.naver.change}` : ""} — 상대값 · 국내 존재 여부를 단정하지 않음`,
    ai?.coupangQuery && `쿠팡 검색어(추정): ${ai.coupangQuery}`,
  ]
    .filter(Boolean)
    .join("\n");
  const data: Omit<TrendDoc, "owner" | "createdAt" | "updatedAt" | "updatedBy" | "visibility" | "viewHistory"> & { visibility?: TrendDoc["visibility"] } = {
    platform: "youtube",
    url: r.url,
    externalId: r.videoId,
    channel: r.channel,
    title: r.title,
    publishedAt: r.publishedAt,
    collectedAt: now,
    collectedBy: "youtube_api",
    searchContext: { query: r.keywords[0] ?? "", regionCode: "KR", language: "ko" },
    product: ai?.product ?? "",
    category: ai && ai.category !== "기타" ? ai.category : "",
    country: "KR",
    language: "ko",
    identification: {
      status: ai?.product && ai.confidence === "likely" ? "likely" : "unconfirmed",
      evidence: ai?.product ? `AI 레이더 추정 — 영상을 보지 않고 제목 · 설명 · 태그 · 댓글 글로 추정: ${ai.evidence}` : "",
    },
    metrics: {
      ...emptyMetrics(),
      views: measured(r.views, "api", "YouTube Data API videos.list (AI 레이더)", r.viewsAt),
      likes: measured(r.likes, "api", r.likes === null ? "좋아요 비공개" : "YouTube Data API videos.list (AI 레이더)", r.viewsAt),
      comments: measured(r.comments, "api", r.comments === null ? "댓글 꺼짐" : "YouTube Data API videos.list (AI 레이더)", r.viewsAt),
    },
    infoSample: r.info ? { sampled: r.info.sampled, matched: r.info.matched, keywords: INFO_REQUEST_KEYWORDS, src: "api", at: r.viewsAt } : { sampled: null, matched: null, keywords: [], src: "manual" },
    domestic: emptyDomestic(),
    tags: ["AI 레이더", ...(ai && ai.category !== "기타" ? [ai.category] : [])],
    notes,
    projectId: null,
    sample: false,
    visibility: visibility === "team" ? "team" : "private",
  };
  const trendId = await writeTrendFromApi(db, email, null, data);
  await col(db)
    .doc(r.id)
    .update({ saved: [...r.saved.filter((s) => s.by !== email), { by: email, trendId, at: now }] });
  return trendId;
}

// ---- 실행 --------------------------------------------------------------

export interface RadarRunOptions {
  by: string;
  deadline: number;
  /** YouTube 키 — 없으면 회사 키 */
  key?: string;
  /** 검증용: 설정 · 날짜 · 계수기를 따로 둔다 (실제 오늘 한도 · 비용을 건드리지 않게) */
  settings?: RadarSettings;
  day?: string;
  quotaPrefix?: string;
  /** 「지금 돌리기」 — 꺼져 있어도 돈다 */
  force?: boolean;
  now?: number;
}

export async function runRadar(db: Firestore, o: RadarRunOptions): Promise<RadarRunSummary> {
  const t0 = Date.now();
  const now = o.now ?? t0;
  const day = o.day ?? kstDay(now);
  const prefix = o.quotaPrefix ?? "";
  const s = o.settings ?? (await getRadarSettings(db));
  const sum: RadarRunSummary = { at: now, by: o.by, searched: 0, found: 0, created: 0, updated: 0, aiCalls: 0, aiUsd: 0, naverCalls: 0, notes: [], ms: 0 };
  const finish = async () => {
    sum.ms = Date.now() - t0;
    sum.aiUsd = Math.round(sum.aiUsd * 10000) / 10000;
    if (!o.quotaPrefix) await settingsCol(db).doc("radar_last").set(sum);
    return sum;
  };
  if (!s.enabled && !o.force) {
    sum.notes.push("설정에서 꺼져 있어 건너뜀");
    return finish();
  }
  const key = o.key || youtubeApiKey();
  if (!key) throw new Error("회사 YouTube 키(NEANDER_SHORTS_YOUTUBE_API_KEY)가 없어 레이더를 돌릴 수 없습니다.");
  const lock = `${prefix}radar_lock`;
  if (!(await takeLock(db, lock, 5 * 60_000))) {
    sum.notes.push("다른 실행이 아직 돌고 있어 건너뜀");
    return sum;
  }
  try {
    // ① 검색
    const found = new Map<string, { item: YoutubeSearchItem; keywords: Set<string> }>();
    for (const kw of s.keywords.slice(0, s.maxSearchesPerRun)) {
      if (Date.now() > o.deadline - 40_000) {
        sum.notes.push("시간이 모자라 검색 일부를 건너뜀");
        break;
      }
      const q = await takeQuota(db, `${prefix}ytsearch_${day}`, YT_SEARCH_DAILY_LIMIT);
      if (!q.ok) {
        sum.notes.push(`오늘 YouTube 검색 한도(${YT_SEARCH_DAILY_LIMIT}회 · 소재 발굴과 함께 셈)를 다 써서 멈춤`);
        break;
      }
      let items: YoutubeSearchItem[] = [];
      try {
        items = await youtubeSearch({ query: kw, regionCode: "KR", language: "ko", days: s.days, max: 50 }, key);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "검색 실패";
        sum.notes.push(`「${kw}」: ${msg.slice(0, 80)}`);
        if (/한도/.test(msg)) break;
        continue;
      }
      sum.searched++;
      for (const it of items) {
        const f = found.get(it.id) ?? { item: it, keywords: new Set<string>() };
        f.keywords.add(kw);
        found.set(it.id, f);
      }
    }

    // ② 거르기 · 기존 후보
    const pool = [...found.values()].filter((f) => isShortLike(f.item.duration) && (f.item.views ?? 0) >= s.minViews);
    sum.found = pool.length;
    const existing = new Map<string, RadarDoc>();
    for (let i = 0; i < pool.length; i += 100) {
      const refs = pool.slice(i, i + 100).map((f) => col(db).doc(docIdOf(f.item.id)));
      for (const snap of refs.length ? await db.getAll(...refs) : []) if (snap.exists) existing.set(snap.id, snap.data() as RadarDoc);
    }

    // ③ 채널 평소 조회수 — 조회수 큰 영상의 채널부터, 기존 후보가 이미 아는 채널은 다시 안 본다
    const baselines = new Map<string, { value: number | null }>();
    for (const r of existing.values()) if (r.channelId && r.baseline !== null) baselines.set(r.channelId, { value: r.baseline });
    const channels = [...new Set(pool.sort((a, b) => (b.item.views ?? 0) - (a.item.views ?? 0)).map((f) => f.item.channelId ?? ""))].filter((c) => c && !baselines.has(c));
    for (const ch of channels.slice(0, MAX_CHANNELS)) {
      if (Date.now() > o.deadline - 35_000) {
        sum.notes.push("시간이 모자라 일부 채널은 평소 조회수를 못 봄");
        break;
      }
      try {
        const ups = await youtubeRecentUploads(ch, key);
        const vids = await youtubeVideos(ups.map((u) => u.id), key);
        const base = computeBaseline(
          vids.filter((v) => isShortLike(v.duration)).map((v) => ({ views: v.views, publishedAt: v.publishedAt || null })),
          now,
        );
        baselines.set(ch, { value: base.value });
      } catch (e) {
        if (/한도/.test(e instanceof Error ? e.message : "")) break;
        baselines.set(ch, { value: null });
      }
    }

    // ④ 문서 — 조회 기록 · 속도 · 배수 · 점수
    const docs = new Map<string, RadarDoc>();
    for (const f of pool) {
      const it = f.item;
      const id = docIdOf(it.id);
      const prev = existing.get(id);
      const history = [...(prev?.viewHistory ?? []), ...(it.views !== null ? [{ at: now, views: it.views }] : [])].slice(-30);
      const vel = radarVelocity(history, it.views, it.publishedAt || null, now);
      const baseline = baselines.get(it.channelId ?? "")?.value ?? prev?.baseline ?? null;
      const doc: RadarDoc = {
        platform: "youtube",
        videoId: it.id,
        url: it.url,
        title: it.title,
        channel: it.channel,
        channelId: it.channelId ?? "",
        thumbnail: it.thumbnail,
        publishedAt: it.publishedAt || null,
        duration: it.duration,
        views: it.views,
        likes: it.likes,
        comments: it.comments,
        viewsAt: now,
        viewHistory: history,
        baseline,
        multiple: multipleOf(it.views, baseline),
        velocityPerDay: vel.perDay,
        velocityBasis: vel.basis,
        info: prev?.info ?? null,
        keywords: [...new Set([...(prev?.keywords ?? []), ...f.keywords])].slice(0, 10),
        score: 0,
        ai: prev?.ai ?? null,
        naver: prev?.naver ?? null,
        dismissed: prev?.dismissed ?? null,
        saved: prev?.saved ?? [],
        firstSeenAt: prev?.firstSeenAt ?? now,
        lastSeenAt: now,
      };
      doc.score = radarScore(doc);
      docs.set(id, doc);
      if (prev) sum.updated++;
      else sum.created++;
    }

    // ⑤ 댓글 표본 — 아직 표본이 없는 후보 중 점수 큰 것부터 (AI 에게도 넘긴다 · 글은 저장하지 않는다)
    const commentText = new Map<string, string[]>();
    const needComments = [...docs.values()].filter((d) => !d.info && !d.dismissed && (d.comments ?? 0) > 0).sort((a, b) => b.score - a.score);
    for (const d of needComments.slice(0, MAX_COMMENT_SAMPLES)) {
      if (Date.now() > o.deadline - 30_000) break;
      const comments = await youtubeCommentSample(d.videoId, 50, key).catch(() => null);
      if (!comments) continue;
      const c = countInfoRequests(comments);
      d.info = { sampled: c.sampled, matched: c.matched };
      d.score = radarScore(d);
      commentText.set(d.videoId, comments);
    }

    // ⑥ AI 상품 추정 — 하루 비용 상한 안에서, 점수 큰 것부터. 이번에 못 본 최근 후보(3일 안)도 이어서 본다
    const spendKey = `${prefix}radarusd_${day}`;
    const budgetUsd = s.aiBudgetKrw / USD_KRW;
    const vids = new Map(pool.map((f) => [f.item.id, f.item]));
    if (!o.quotaPrefix) {
      const recent = await col(db).where("lastSeenAt", ">=", now - 3 * 86_400_000).get();
      for (const snap of recent.docs) {
        const d = snap.data() as RadarDoc;
        if (!docs.has(snap.id) && !d.ai && !d.dismissed) docs.set(snap.id, d);
      }
    }
    const queue = [...docs.values()].filter((d) => !d.ai && !d.dismissed).sort((a, b) => b.score - a.score).slice(0, MAX_AI_PER_RUN);
    // 이번 검색에 안 걸린 후보는 설명 · 태그를 다시 받는다 (50편에 1단위)
    const missing = queue.filter((d) => !vids.has(d.videoId)).map((d) => d.videoId);
    for (let i = 0; i < missing.length; i += 50) {
      for (const v of await youtubeVideos(missing.slice(i, i + 50), key).catch(() => [])) vids.set(v.id, v);
    }
    const identify = async (batch: RadarDoc[]): Promise<{ items: Awaited<ReturnType<typeof radarIdentify>>["items"]; costUsd: number; model: string; calls: number }> => {
      try {
        const r = await radarIdentify(
          batch.map((d) => ({
            videoId: d.videoId,
            title: d.title,
            channel: d.channel,
            description: vids.get(d.videoId)?.description ?? "",
            tags: vids.get(d.videoId)?.tags ?? [],
            comments: commentText.get(d.videoId) ?? [],
          })),
        );
        return { ...r, calls: 1 };
      } catch (e) {
        // 응답이 잘리면 반씩 나눠 한 번 더 (돈은 잘린 쪽도 나갔을 수 있다 — 상한 계산은 어림값으로 남긴다)
        if (batch.length > 1 && /잘렸/.test(e instanceof Error ? e.message : "")) {
          const half = Math.ceil(batch.length / 2);
          const a = await identify(batch.slice(0, half));
          const b = await identify(batch.slice(half));
          return { items: [...a.items, ...b.items], costUsd: a.costUsd + b.costUsd + EST_BATCH_USD, model: a.model, calls: a.calls + b.calls + 1 };
        }
        throw e;
      }
    };
    if (queue.length && !openrouterConfigured()) sum.notes.push("OPENROUTER_API_KEY 가 없어 AI 상품 추정을 건너뜀");
    else if (queue.length) {
      let spent = await readRadarSpendUsd(db, spendKey);
      const batches: RadarDoc[][] = [];
      for (let i = 0; i < queue.length; i += AI_BATCH) batches.push(queue.slice(i, i + AI_BATCH));
      // 셋씩 함께 — 한 묶음 10~20초
      for (let i = 0; i < batches.length; i += 3) {
        const round = batches.slice(i, i + 3);
        const left = batches.slice(i).reduce((n, b) => n + b.length, 0);
        if (Date.now() > o.deadline - 30_000) {
          sum.notes.push(`시간이 모자라 ${left}편은 다음 실행에 AI 추정`);
          break;
        }
        if (spent + EST_BATCH_USD * round.length > budgetUsd) {
          sum.notes.push(`오늘 AI 비용 상한(${s.aiBudgetKrw.toLocaleString("ko-KR")}원)에 닿아 ${left}편은 내일 AI 추정`);
          break;
        }
        const results = await Promise.allSettled(round.map((b) => identify(b)));
        const at = Date.now();
        for (const res of results) {
          if (res.status === "rejected") {
            sum.notes.push(`AI 추정 실패: ${(res.reason instanceof Error ? res.reason.message : "").slice(0, 100)}`);
            continue;
          }
          const r = res.value;
          spent += r.costUsd;
          sum.aiUsd += r.costUsd;
          sum.aiCalls += r.calls;
          await addRadarSpend(db, spendKey, r.costUsd);
          for (const it of r.items) {
            const d = docs.get(docIdOf(it.videoId));
            if (!d) continue;
            const ai: RadarAi = {
              relevant: it.relevant,
              product: it.product.trim().slice(0, 80),
              productKey: it.productKey.trim().slice(0, 40),
              category: it.category,
              confidence: it.confidence,
              evidence: it.evidence.slice(0, 200),
              why: it.why.slice(0, 300),
              hook: it.hook.slice(0, 200),
              naverKeywords: it.naverKeywords.map((k) => k.trim().slice(0, 30)).filter(Boolean).slice(0, 3),
              coupangQuery: it.coupangQuery.trim().slice(0, 60),
              caution: it.caution.slice(0, 200),
              model: r.model,
              costUsd: Math.round((r.costUsd / Math.max(1, r.items.length)) * 1e6) / 1e6,
              at,
            };
            d.ai = ai;
          }
        }
      }
    }

    // ⑦ 네이버 국내 검색 추세 — 상품 묶음마다 한 번, 3일 안에 본 것은 그대로
    const nv = naverConfig();
    if (nv.configured) {
      const groups = new Map<string, RadarDoc[]>();
      for (const d of docs.values()) {
        if (!d.ai?.relevant || !d.ai.product || !d.ai.naverKeywords.length || d.dismissed) continue;
        const k = normalizeProductKey(d.ai.productKey || d.ai.product);
        groups.set(k, [...(groups.get(k) ?? []), d]);
      }
      const ordered = [...groups.values()].sort((a, b) => Math.max(...b.map((d) => d.score)) - Math.max(...a.map((d) => d.score)));
      for (const g of ordered) {
        const fresh = g.find((d) => d.naver && now - d.naver.at < NAVER_FRESH_MS)?.naver;
        if (fresh) {
          for (const d of g) d.naver = fresh;
          continue;
        }
        if (sum.naverCalls >= MAX_NAVER_CALLS || Date.now() > o.deadline - 15_000) break;
        const lead = g.sort((a, b) => b.score - a.score)[0];
        try {
          const series = await naverWeeklySeries(lead.ai!.naverKeywords, 8, now);
          sum.naverCalls++;
          const t = { keywords: lead.ai!.naverKeywords, ...classifyNaverTrend(series), at: now };
          for (const d of g) d.naver = t;
        } catch (e) {
          sum.notes.push(`네이버: ${(e instanceof Error ? e.message : "").slice(0, 80)}`);
          break;
        }
      }
    } else if (docs.size) {
      sum.notes.push("네이버 데이터랩 키가 없어 국내 검색 추세를 건너뜀");
    }

    // ⑧ 저장 · 오래된 후보 치우기 (소재로 저장한 것은 남긴다)
    const all = [...docs.entries()];
    for (let i = 0; i < all.length; i += 400) {
      const batch = db.batch();
      for (const [id, d] of all.slice(i, i + 400)) batch.set(col(db).doc(id), d);
      await batch.commit();
    }
    if (!o.quotaPrefix) {
      const old = await col(db).where("lastSeenAt", "<", now - KEEP_DAYS * 86_400_000).limit(200).get();
      for (const d of old.docs) if (!((d.data() as RadarDoc).saved ?? []).length) await d.ref.delete();
    }
    return await finish();
  } finally {
    await settingsCol(db).doc(lock).set({ until: 0 });
  }
}

/** 화면 · cron 이 함께 쓰는 오늘 사용량 */
export async function radarToday(db: Firestore, s: RadarSettings) {
  const day = kstDay();
  const usd = await readRadarSpendUsd(db, `radarusd_${day}`);
  return { day, spentKrw: krwOf(usd), budgetKrw: s.aiBudgetKrw };
}
