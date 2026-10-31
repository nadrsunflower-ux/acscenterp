import "server-only";

// ============================================================
//  바이럴 형식 정찰 실행 — 훑기 · 자동 분석 · 주간 보고
// ------------------------------------------------------------
//  훑기 (채널 하나에 약 2단위 — search 한도 100회와 무관):
//    ① 업로드 목록 최근 50편 (playlistItems.list)  ② 통계 · 길이 (videos.list)
//    ③ 3분 이하만 쇼츠로 보고 평소 조회수(중앙값)  ④ 평소의 N배 넘은 것을 터진 영상으로 적는다
//    이미 적어 둔 영상은 평소 밑으로 내려가도 숫자를 계속 고쳐 적는다 (조회수 기록).
//
//  매일 아침 cron (회사 키 NEANDER_SHORTS_YOUTUBE_API_KEY):
//    20시간 안에 훑지 않은 채널 → 새로 찾은 영상 자동 분석(하루 상한, 끄기 가능) →
//    이번 주 보고 새로 고치기. 남은 시간 안에서만 돈다.
// ============================================================

import type { Firestore } from "firebase-admin/firestore";
import {
  computeBaseline,
  countryLabel,
  isShortLike,
  koreanCommentCount,
  buildReport,
  pickHits,
  type HitAnalysis,
  type ScoutSettings,
  type WatchChannelDoc,
} from "../scout";
import { analyzeVideo, narrateReport } from "./scout-ai";
import {
  getHit,
  getReport,
  hitIdOf,
  hitIdsOfWatch,
  getScoutSettings,
  listFormats,
  listHits,
  listWatch,
  saveReport,
  setHitAnalysis,
  setKoreanComments,
  setReportNarrative,
  upsertHitFromApi,
  writeScan,
} from "./scout-store";
import { takeQuota, readQuota } from "./store";
import { youtubeApiKey, youtubeChannels, youtubeCommentSample, youtubeRecentUploads, youtubeVideos } from "./youtube-data";

type WithId<T> = T & { id: string };

const kstDay = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);

export interface ScanResult {
  watchId: string;
  title: string;
  shorts: number;
  baseline: number | null;
  created: number;
  updated: number;
  error: string | null;
}

/** 채널 하나 훑기 */
export async function scanChannel(db: Firestore, w: WithId<WatchChannelDoc>, key: string, s: ScoutSettings, by: string): Promise<ScanResult> {
  const now = Date.now();
  try {
    const uploads = await youtubeRecentUploads(w.channelId, key);
    const vids = await youtubeVideos(uploads.map((u) => u.id), key);
    const shorts = vids.filter((v) => isShortLike(v.duration));
    const base = computeBaseline(shorts, now);
    const hits = new Set(pickHits(shorts, base.value, s, now).map((h) => h.id));
    const baselineRef = base.basis === "mature" ? `최근 쇼츠 ${base.n}편(올린 지 7일 넘은 것) 조회수 중앙값` : `최근 쇼츠 ${base.n}편 조회수 중앙값 (7일 넘은 영상이 모자라 어린 영상 포함)`;
    const known = await hitIdsOfWatch(db, w.id);
    let created = 0;
    let updated = 0;
    for (const v of shorts) {
      if (!hits.has(v.id) && !known.has(hitIdOf(v.id))) continue;
      const r = await upsertHitFromApi(
        db,
        by,
        {
          videoId: v.id,
          url: v.url,
          title: v.title,
          channel: v.channel || w.title,
          thumbnail: v.thumbnail,
          publishedAt: v.publishedAt || null,
          duration: v.duration,
          views: v.views,
          likes: v.likes,
          comments: v.comments,
          baseline: base.value,
          baselineRef,
          watchId: w.id,
          country: w.country,
          language: w.language,
        },
        { create: hits.has(v.id), found: "scan" },
      );
      if (r === "created") created++;
      if (r === "updated") updated++;
    }
    const subs = (await youtubeChannels([w.channelId], key).catch(() => []))[0]?.subscribers;
    await writeScan(db, w.id, { at: now, baseline: base.value, baselineN: base.n, baselineBasis: base.basis, shortsSeen: shorts.length, error: null }, subs ?? w.subscribers);
    return { watchId: w.id, title: w.title, shorts: shorts.length, baseline: base.value, created, updated, error: null };
  } catch (e) {
    const msg = e instanceof Error ? e.message.slice(0, 300) : "훑기 실패";
    await writeScan(db, w.id, { ...w.scan, at: now, error: msg }).catch(() => undefined);
    // 한도 초과는 다음 채널도 똑같이 실패한다 — 부른 쪽이 멈추게 다시 던진다
    if (/한도/.test(msg)) throw e;
    return { watchId: w.id, title: w.title, shorts: 0, baseline: null, created: 0, updated: 0, error: msg };
  }
}

/** 때가 된 채널들 — 오래 안 훑은 것부터, 시간 안에서 */
export async function scanDue(
  db: Firestore,
  opts: { key: string; by: string; deadline: number; staleMs: number; only?: string },
): Promise<{ scanned: ScanResult[]; skipped: number; stoppedBy: string | null }> {
  const s = await getScoutSettings(db);
  const all = (await listWatch(db)).filter((w) => w.active && (!opts.only || w.id === opts.only));
  const due = all.filter((w) => opts.only || Date.now() - (w.scan.at ?? 0) >= opts.staleMs).sort((a, b) => (a.scan.at ?? 0) - (b.scan.at ?? 0));
  const scanned: ScanResult[] = [];
  let stoppedBy: string | null = null;
  for (const w of due) {
    if (Date.now() > opts.deadline) {
      stoppedBy = "시간";
      break;
    }
    try {
      scanned.push(await scanChannel(db, w, opts.key, s, opts.by));
    } catch (e) {
      stoppedBy = e instanceof Error ? e.message : "한도";
      break;
    }
  }
  return { scanned, skipped: due.length - scanned.length, stoppedBy };
}

/** 영상 하나 분석 — 영상을 보고 형식을 뽑고, 해외 영상이면 한글 댓글 비율도 잰다 */
export async function analyzeHit(db: Firestore, by: string, hitId: unknown, opts: { model?: unknown; key?: string }): Promise<{ analysis: HitAnalysis; costUsd: number }> {
  const h = await getHit(db, hitId);
  if (h.platform !== "youtube" || !h.externalId) throw new Error("AI 가 직접 볼 수 있는 것은 YouTube 영상뿐입니다. 다른 플랫폼 영상은 YouTube 에 다시 올라온 주소로 등록하거나, 형식 카드를 직접 적어 주세요.");
  const formats = (await listFormats(db)).filter((f) => !f.archived);
  const r = await analyzeVideo({
    model: opts.model,
    url: `https://www.youtube.com/watch?v=${h.externalId}`,
    title: h.title,
    channel: h.channel,
    country: countryLabel(h.country),
    views: h.views.v,
    multiple: h.multiple,
    formats: formats.map((f) => ({ id: f.id, name: f.name, summary: f.summary })),
  });
  const analysis: HitAnalysis = { ...r.analysis, model: r.model, costUsd: r.costUsd, at: Date.now(), by };
  await setHitAnalysis(db, h.id, analysis);
  if (h.country !== "KR" && !h.koreanComments && opts.key) {
    const comments = await youtubeCommentSample(h.externalId, 100, opts.key).catch(() => null);
    if (comments) await setKoreanComments(db, h.id, { ...koreanCommentCount(comments), at: Date.now() }, by);
  }
  return { analysis, costUsd: r.costUsd };
}

/** 새로 찾은 영상 자동 분석 — 하루 상한 안에서, 배수 큰 것부터. 셋씩 함께 돌린다 */
export async function autoAnalyze(db: Firestore, opts: { deadline: number; key: string }): Promise<{ analyzed: number; failed: number; costUsd: number }> {
  const s = await getScoutSettings(db);
  if (s.autoAnalyzePerDay <= 0) return { analyzed: 0, failed: 0, costUsd: 0 };
  const quotaKey = `scoutai_${kstDay()}`;
  const left = s.autoAnalyzePerDay - (await readQuota(db, quotaKey));
  if (left <= 0) return { analyzed: 0, failed: 0, costUsd: 0 };
  const queue = (await listHits(db))
    .filter((h) => !h.analysis && h.status === "new" && h.platform === "youtube" && h.externalId)
    .sort((a, b) => (b.multiple ?? 0) - (a.multiple ?? 0))
    .slice(0, left);
  let analyzed = 0;
  let failed = 0;
  let costUsd = 0;
  for (let i = 0; i < queue.length; i += 3) {
    // 영상 분석은 한 편 수십 초 — 끝까지 못 돌 것 같으면 시작하지 않는다
    if (Date.now() + 60_000 > opts.deadline) break;
    const batch = queue.slice(i, i + 3);
    const results = await Promise.allSettled(
      batch.map(async (h) => {
        const q = await takeQuota(db, quotaKey, s.autoAnalyzePerDay);
        if (!q.ok) throw new Error("오늘 자동 분석 상한");
        return analyzeHit(db, "company", h.id, { key: opts.key });
      }),
    );
    for (const r of results) {
      if (r.status === "fulfilled") {
        analyzed++;
        costUsd += r.value.costUsd;
      } else failed++;
    }
  }
  return { analyzed, failed, costUsd };
}

/** 이번 주 보고를 새로 만든다 (같은 주면 덮어쓰고 AI 요약은 남긴다) */
export async function buildWeeklyReport(db: Firestore, by: string): Promise<string> {
  const [formats, hits, channels] = await Promise.all([listFormats(db), listHits(db), listWatch(db)]);
  const body = buildReport({ formats, hits, channels, now: Date.now() });
  await saveReport(db, { ...body, createdAt: Date.now(), createdBy: by });
  return body.week;
}

export async function narrateWeeklyReport(db: Firestore, by: string, week: unknown, model?: unknown): Promise<{ text: string; costUsd: number }> {
  const report = await getReport(db, week);
  const r = await narrateReport({ model, report, countryLabel });
  await setReportNarrative(db, report.week, { text: r.text, model: r.model, costUsd: r.costUsd, at: Date.now(), by });
  return { text: r.text, costUsd: r.costUsd };
}

/** 매일 아침 cron — 회사 키가 없으면 훑기는 건너뛰고 보고만 새로 고친다 */
export async function runScoutCron(db: Firestore, deadline: number): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  const key = youtubeApiKey();
  if (key) {
    const scan = await scanDue(db, { key, by: "company", deadline: deadline - 60_000, staleMs: 20 * 3600_000 });
    out.scanned = scan.scanned.length;
    out.newHits = scan.scanned.reduce((n, r) => n + r.created, 0);
    out.scanErrors = scan.scanned.filter((r) => r.error).length;
    if (scan.stoppedBy) out.scanStopped = scan.stoppedBy;
    out.analysis = await autoAnalyze(db, { deadline: deadline - 15_000, key }).catch((e) => (e instanceof Error ? e.message : "실패"));
  } else {
    out.scan = "회사 YouTube 키(NEANDER_SHORTS_YOUTUBE_API_KEY)가 없어 자동 훑기를 건너뜀";
  }
  out.report = await buildWeeklyReport(db, "company").catch((e) => (e instanceof Error ? e.message : "실패"));
  return out;
}
