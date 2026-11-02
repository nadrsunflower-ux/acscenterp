import "server-only";

// ============================================================
//  바이럴 형식 정찰 자동화 실행 — cron-scout(매일 07:00 KST) · 화면 「지금 돌리기」
// ------------------------------------------------------------
//  순서: ① 감시 채널 채우기 → 훑기 → 새로 터진 영상 자동 분석(정찰 설정의 하루 상한) →
//        ② 자동 묶기 → ③ 한국 확인 → 주간 보고 → ④ AI 요약.  남은 시간 안에서만 돈다.
//  YouTube 검색(search.list)은 소재 발굴 · AI 레이더와 같은 계수기(ytsearch_<날짜>, 하루 90회)로 센다:
//  해외 나라마다 1회 + 한국 확인 카드마다 1회.
//  자동으로 만든 것은 owner "company" · 감시 채널 주제 「자동 추가」 — 사람이 끄거나 지울 수 있다.
//  검증은 opts.only(채널 · 영상 · 카드 id)로 범위를 좁혀 실제 회사 자료를 건드리지 않는다.
// ============================================================

import type { Firestore } from "firebase-admin/firestore";
import { NEANDER_COL } from "@/lib/neander/collections";
import type { RadarDoc } from "../radar";
import { computeBaseline, isShortLike, multipleOf, type WatchChannelDoc } from "../scout";
import {
  AUTO_COUNTRY_SEARCH,
  AUTO_TOPIC,
  DEFAULT_SCOUT_AUTO,
  koreaStatusFromMatches,
  needsKoreaCheck,
  pickAutoQuery,
  sanitizeScoutAuto,
  type AutoCountry,
  type ScoutAutoSettings,
  type ScoutAutoSummary,
} from "../scout-auto";
import { openrouterConfigured } from "./ai";
import { listRadar } from "./radar-run";
import { clusterFormats, judgeKoreaSample } from "./scout-ai";
import { autoAnalyze, buildWeeklyReport, narrateWeeklyReport, scanDue } from "./scout-run";
import { addWatch, assignHit, getScoutSettings, listFormats, listHits, listWatch, patchFormatKorea, saveFormat, watchIdOf } from "./scout-store";
import { DEFAULT_SPACE_ID } from "../spaces";
import { spaceNiche, stampSpace } from "./space-db";
import { takeQuota } from "./store";
import { YT_SEARCH_DAILY_LIMIT, youtubeApiKey, youtubeChannels, youtubeDiscoverChannels, youtubeRecentUploads, youtubeSearch, youtubeVideos } from "./youtube-data";

type WithId<T> = T & { id: string };
const settingsCol = (db: Firestore) => db.collection(NEANDER_COL.shortsSettings);
const kstDay = (t = Date.now()) => new Date(t + 9 * 3600_000).toISOString().slice(0, 10);
const AUTO = "company";

export async function getScoutAuto(db: Firestore): Promise<ScoutAutoSettings> {
  const d = (await settingsCol(db).doc("scout_auto").get()).data() as Partial<ScoutAutoSettings> | undefined;
  // 새 AI STUDIO 프로젝트는 해외 검색어가 없으니 해외 찾기 없이 시작 (설정에서 나라 · 검색어를 넣는다)
  const fresh = !d && stampSpace(db) !== DEFAULT_SPACE_ID ? { countries: [] } : {};
  return { ...DEFAULT_SCOUT_AUTO, ...fresh, ...(d ?? {}) };
}

export async function saveScoutAuto(db: Firestore, by: string, input: unknown): Promise<ScoutAutoSettings> {
  const next = sanitizeScoutAuto(input, await getScoutAuto(db), by);
  await settingsCol(db).doc("scout_auto").set(next);
  return next;
}

export async function getScoutAutoLast(db: Firestore): Promise<ScoutAutoSummary | null> {
  return ((await settingsCol(db).doc("scout_auto_last").get()).data() as ScoutAutoSummary | undefined) ?? null;
}

/** 자동으로 넣은 적 있는 채널 — 사람이 지운 뒤 다시 넣지 않으려고 */
async function readAdded(db: Firestore, key: string): Promise<Set<string>> {
  return new Set(((await settingsCol(db).doc(key).get()).data() as { ids?: string[] } | undefined)?.ids ?? []);
}

const isAuto = (w: WatchChannelDoc) => w.owner === AUTO && w.topics.includes(AUTO_TOPIC);

/** 채널 평소 조회수 (최근 쇼츠 중앙값) — 2단위 */
async function baselineOf(channelId: string, key: string, now: number): Promise<number | null> {
  const ups = await youtubeRecentUploads(channelId, key);
  const vids = await youtubeVideos(ups.map((u) => u.id), key);
  return computeBaseline(vids.filter((v) => isShortLike(v.duration)).map((v) => ({ views: v.views, publishedAt: v.publishedAt || null })), now).value;
}

export interface ScoutAutoOptions {
  by: string;
  deadline: number;
  key?: string;
  settings?: ScoutAutoSettings;
  /** 검증용 접두사 — 검색 계수기 · 「넣은 적 있음」 기록을 따로 둔다 */
  prefix?: string;
  /** 검증용: 이 레이더 문서만 (실제 레이더 자료를 쓰지 않게) */
  radar?: RadarDoc[];
  /** 검증용: 이 영상 · 카드만 묶기 · 확인 대상으로 */
  onlyHits?: string[];
  onlyFormats?: string[];
  /** 훑기 · 분석 · 보고를 건너뛴다 (검증용) */
  skipPipeline?: boolean;
  now?: number;
}

// ---- ① 감시 채널 채우기 ---------------------------------------------------

export async function autoFillWatch(db: Firestore, s: ScoutAutoSettings, o: ScoutAutoOptions & { key: string }, sum: ScoutAutoSummary): Promise<void> {
  const now = o.now ?? Date.now();
  const day = kstDay(now);
  const prefix = o.prefix ?? "";
  const addedKey = `${prefix}scout_auto_added`;
  const everAdded = await readAdded(db, addedKey);
  const watch = await listWatch(db);
  const watched = new Set(watch.map((w) => w.channelId));
  const autoCount = (c: string) => watch.filter((w) => w.country === c && isAuto(w) && w.active).length;
  const scout = await getScoutSettings(db);
  const newly: string[] = [];
  // 자동 추가 채널의 주제 꼬리표 — 살림설계사무소는 「살림」, 다른 프로젝트는 그 이름
  const topicName = (await spaceNiche(db))?.name ?? "살림";

  const add = async (country: string, channelId: string, why: string, language: string, topic: string) => {
    const [info] = await youtubeChannels([channelId], o.key);
    if (!info) return false;
    await addWatch(db, AUTO, info, { country, language, topics: [AUTO_TOPIC, topic], note: `자동 추가 ${day} — ${why}` });
    watched.add(channelId);
    newly.push(channelId);
    sum.added.push({ country, title: info.title, why });
    return true;
  };

  // 한국 — AI 레이더가 찾은 영상 중 평소의 N배 넘게 터진 것의 채널
  if (s.fillKorea) {
    const docs = o.radar ?? (await listRadar(db, 7));
    const best = new Map<string, RadarDoc>();
    for (const d of docs) {
      if (!d.channelId || d.ai?.relevant === false || d.dismissed) continue;
      if ((d.multiple ?? 0) < s.minMultiple || (d.views ?? 0) < scout.minViews) continue;
      const prev = best.get(d.channelId);
      if (!prev || (d.multiple ?? 0) > (prev.multiple ?? 0)) best.set(d.channelId, d);
    }
    let room = Math.min(s.addsPerDay, Math.max(0, s.perCountryCap - autoCount("KR")));
    for (const d of [...best.values()].sort((a, b) => (b.multiple ?? 0) - (a.multiple ?? 0))) {
      if (room <= 0 || Date.now() > o.deadline - 60_000) break;
      if (watched.has(d.channelId) || everAdded.has(d.channelId)) continue;
      if (await add("KR", d.channelId, `AI 레이더 「${d.title.slice(0, 40)}」 채널 평소의 ${d.multiple}배`, "ko", d.ai?.category && d.ai.category !== "기타" ? d.ai.category : topicName)) room--;
    }
  }

  // 해외 — 나라마다 하루 검색 1회, 평소 대비 N배 넘은 영상이 있는 채널만
  for (const c of s.countries as AutoCountry[]) {
    const room0 = Math.min(s.addsPerDay, Math.max(0, s.perCountryCap - autoCount(c)));
    if (room0 <= 0) continue;
    if (Date.now() > o.deadline - 60_000) {
      sum.notes.push("시간이 모자라 해외 채널 찾기 일부를 건너뜀");
      break;
    }
    const q = await takeQuota(db, `${prefix}ytsearch_${day}`, YT_SEARCH_DAILY_LIMIT);
    if (!q.ok) {
      sum.notes.push("오늘 YouTube 검색 한도를 다 써서 해외 채널 찾기를 멈춤");
      break;
    }
    const cfg = AUTO_COUNTRY_SEARCH[c];
    const custom = s.queries?.[c] ?? [];
    // 기본 검색어는 살림 주제 — 다른 프로젝트는 그 프로젝트의 검색어가 있을 때만
    if (!custom.length && stampSpace(db) !== DEFAULT_SPACE_ID) {
      sum.notes.push(`${cfg.label}: 이 프로젝트의 검색어가 없어 건너뜀 (자동화 설정에서 넣기)`);
      continue;
    }
    const query = pickAutoQuery(c, day, custom);
    sum.searches++;
    let groups: Awaited<ReturnType<typeof youtubeDiscoverChannels>> = [];
    try {
      groups = await youtubeDiscoverChannels({ query, regionCode: cfg.region, language: cfg.lang, days: 21 }, o.key);
    } catch (e) {
      sum.notes.push(`${cfg.label} 「${query}」: ${(e instanceof Error ? e.message : "").slice(0, 80)}`);
      continue;
    }
    let room = room0;
    for (const g of groups) {
      if (room <= 0 || Date.now() > o.deadline - 50_000) break;
      const ch = g.channel.channelId;
      if (watched.has(ch) || everAdded.has(ch)) continue;
      const top = g.videos.filter((v) => isShortLike(v.duration)).sort((a, b) => (b.views ?? 0) - (a.views ?? 0))[0];
      if (!top || (top.views ?? 0) < s.minViewsAbroad) continue;
      const base = await baselineOf(ch, o.key, now).catch(() => null);
      const m = multipleOf(top.views, base);
      if (m === null || m < s.minMultiple) continue;
      await addWatch(db, AUTO, g.channel, { country: c, language: cfg.lang, topics: [AUTO_TOPIC, topicName], note: `자동 추가 ${day} — ${cfg.label} 검색 「${query}」 · 「${top.title.slice(0, 40)}」 평소의 ${m}배` });
      watched.add(ch);
      newly.push(ch);
      sum.added.push({ country: c, title: g.channel.title, why: `「${query}」 · 평소의 ${m}배` });
      room--;
    }
  }
  if (newly.length) await settingsCol(db).doc(addedKey).set({ ids: [...everAdded, ...newly].slice(-2000) });
}

// ---- ② 자동 묶기 ----------------------------------------------------------

export async function autoGroup(db: Firestore, o: ScoutAutoOptions, sum: ScoutAutoSummary): Promise<void> {
  const formats = (await listFormats(db)).filter((f) => !f.archived && (!o.onlyFormats || o.onlyFormats.includes(f.id)));
  const fids = new Set(formats.map((f) => f.id));
  const hits = (await listHits(db)).filter((h) => (!o.onlyHits || o.onlyHits.includes(h.id)) && h.status === "new" && !h.formatId && h.analysis && !/보지 못함/.test(h.analysis.summary));
  // AI 분석이 이미 기존 카드와 같다고 본 것
  const rest: typeof hits = [];
  for (const h of hits) {
    const fid = h.analysis!.match.formatId;
    if (fid && fids.has(fid)) {
      await assignHit(db, AUTO, h.id, fid);
      sum.assigned++;
    } else rest.push(h);
  }
  if (rest.length < 2 || !openrouterConfigured() || Date.now() > o.deadline - 40_000) return;
  const r = await clusterFormats({
    hits: rest.map((h) => ({ id: h.id, formatName: h.analysis!.formatName, summary: h.analysis!.summary, hook: h.analysis!.hook, structure: h.analysis!.structure })),
    formats: formats.map((f) => ({ id: f.id, name: f.name, summary: f.summary })),
  });
  sum.aiUsd += r.costUsd;
  const byId = new Map(rest.map((h) => [h.id, h]));
  for (const g of r.groups) {
    let fid = g.formatId;
    if (!fid) {
      // 묶음의 첫 영상 분석으로 카드를 만들고 이름은 묶음 이름으로
      const a = byId.get(g.hitIds[0])!.analysis!;
      fid = await saveFormat(db, AUTO, null, {
        name: g.name,
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
        koreanQueries: [...new Set(g.hitIds.flatMap((id) => byId.get(id)?.analysis?.koreanQueries ?? []))].slice(0, 5),
        note: `AI 자동 묶음 — ${g.reason}`,
      });
      sum.cardsCreated.push(g.name);
    }
    for (const id of g.hitIds) {
      await assignHit(db, AUTO, id, fid);
      sum.assigned++;
    }
  }
}

// ---- ③ 한국 확인 -----------------------------------------------------------

export async function autoKoreaCheck(db: Firestore, s: ScoutAutoSettings, o: ScoutAutoOptions & { key: string }, sum: ScoutAutoSummary): Promise<void> {
  if (!openrouterConfigured()) return;
  const now = o.now ?? Date.now();
  const day = kstDay(now);
  const formats = (await listFormats(db))
    .filter((f) => !f.archived && f.koreanQueries.length && (!o.onlyFormats || o.onlyFormats.includes(f.id)) && needsKoreaCheck(f.korea, now))
    .sort((a, b) => (a.korea.checkedAt ?? 0) - (b.korea.checkedAt ?? 0));
  for (const f of formats.slice(0, s.koreaPerDay)) {
    if (Date.now() > o.deadline - 40_000) break;
    const q = await takeQuota(db, `${o.prefix ?? ""}ytsearch_${day}`, YT_SEARCH_DAILY_LIMIT);
    if (!q.ok) {
      sum.notes.push("오늘 YouTube 검색 한도를 다 써서 한국 확인을 멈춤");
      break;
    }
    sum.searches++;
    // 검색어를 돌려 가며 — 지난번과 다른 말로
    const i = Math.max(0, f.koreanQueries.indexOf(f.korea.query));
    const query = f.koreanQueries[(f.korea.query ? i + 1 : 0) % f.koreanQueries.length];
    const items = await youtubeSearch({ query, regionCode: "KR", language: "ko", days: 120, max: 25 }, o.key).catch(() => null);
    if (!items) continue;
    const j = await judgeKoreaSample({
      format: { name: f.name, summary: f.summary, hook: f.hook, structure: f.structure },
      results: items.map((it) => ({ id: it.id, title: it.title, channel: it.channel, description: it.description ?? "" })),
    });
    sum.aiUsd += j.costUsd;
    const picked = new Set(j.matchIds);
    const matches = items.filter((it) => picked.has(it.id)).map((it) => ({ url: it.url, title: it.title, views: it.views, publishedAt: it.publishedAt || null }));
    const status = koreaStatusFromMatches(matches.length);
    await patchFormatKorea(db, AUTO, f.id, {
      status,
      query,
      checkedAt: now,
      by: AUTO,
      sampleSize: items.length,
      matches,
      lastSearch: { query, at: now, results: items.map((it) => ({ id: it.id, url: it.url, title: it.title, channel: it.channel, views: it.views, publishedAt: it.publishedAt || null, thumbnail: it.thumbnail })) },
      note: `AI 자동 확인 — 국내 검색 「${query}」 표본 ${items.length}편을 제목 · 설명으로 판단(영상은 안 봄): ${j.reason}`,
    });
    sum.korea.push({ name: f.name, status });
  }
}

// ---- 전체 -----------------------------------------------------------------

export async function runScoutAuto(db: Firestore, o: ScoutAutoOptions & { force?: boolean }): Promise<ScoutAutoSummary> {
  const t0 = Date.now();
  const s = o.settings ?? (await getScoutAuto(db));
  const sum: ScoutAutoSummary = { at: o.now ?? t0, by: o.by, added: [], searches: 0, scanned: 0, newHits: 0, analyzed: 0, assigned: 0, cardsCreated: [], korea: [], narrated: false, aiUsd: 0, notes: [], ms: 0 };
  const finish = async () => {
    sum.ms = Date.now() - t0;
    sum.aiUsd = Math.round(sum.aiUsd * 10000) / 10000;
    if (!o.prefix) await settingsCol(db).doc("scout_auto_last").set(sum);
    return sum;
  };
  const key = o.key || youtubeApiKey();
  if (!s.enabled && !o.force) {
    sum.notes.push("설정에서 꺼져 있어 건너뜀");
    return finish();
  }
  const lockRef = settingsCol(db).doc(`${o.prefix ?? ""}scout_auto_lock`);
  const got = await db.runTransaction(async (tx) => {
    const until = Number(((await tx.get(lockRef)).data() as { until?: number } | undefined)?.until) || 0;
    if (until > Date.now()) return false;
    tx.set(lockRef, { until: Date.now() + 6 * 60_000 });
    return true;
  });
  if (!got) {
    sum.notes.push("다른 실행이 아직 돌고 있어 건너뜀");
    return sum;
  }
  try {
    const step = async (name: string, fn: () => Promise<void>) => {
      try {
        await fn();
      } catch (e) {
        sum.notes.push(`${name}: ${(e instanceof Error ? e.message : "실패").slice(0, 120)}`);
      }
    };
    if (key) await step("감시 채널 채우기", () => autoFillWatch(db, s, { ...o, key }, sum));
    else sum.notes.push("회사 YouTube 키가 없어 채널 찾기 · 훑기 · 한국 확인을 건너뜀");
    if (key && !o.skipPipeline) {
      await step("훑기", async () => {
        const scan = await scanDue(db, { key, by: AUTO, deadline: o.deadline - 120_000, staleMs: 20 * 3600_000 });
        sum.scanned = scan.scanned.length;
        sum.newHits = scan.scanned.reduce((n, r) => n + r.created, 0);
        if (scan.stoppedBy) sum.notes.push(`훑기 멈춤: ${scan.stoppedBy}`);
      });
      await step("자동 분석", async () => {
        const a = await autoAnalyze(db, { deadline: o.deadline - 70_000, key });
        sum.analyzed = a.analyzed;
        sum.aiUsd += a.costUsd;
      });
    }
    if (s.group) await step("자동 묶기", () => autoGroup(db, o, sum));
    if (s.koreaCheck && key) await step("한국 확인", () => autoKoreaCheck(db, s, { ...o, key }, sum));
    if (!o.skipPipeline) {
      await step("주간 보고", async () => {
        const week = await buildWeeklyReport(db, AUTO);
        if (s.narrate && openrouterConfigured() && Date.now() < o.deadline - 15_000) {
          const n = await narrateWeeklyReport(db, AUTO, week);
          sum.aiUsd += n.costUsd;
          sum.narrated = true;
        }
      });
    }
    return await finish();
  } finally {
    await lockRef.set({ until: 0 });
  }
}

export type { WithId };
export const autoWatchIdOf = watchIdOf;
