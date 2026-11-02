import "server-only";

// ============================================================
//  시장 트렌드 실행 · 저장 — 매일 아침 cron-market(07:30 KST) · 화면의 「지금 …」
// ------------------------------------------------------------
//  ① 채널 숫자 기록 — 감시 채널(channels.list 50곳에 1단위) + 내 채널(유튜브 공개 통계 · 인스타 Graph)
//  ② 검색어 묶음 추이 — 묶음마다 혼자 1년 주간(네이버 HUB · 월 5만 건 한도 안)
//  ③ 브리핑 — 레이더 · 바이럴 형식 · ② · ① 을 모아 AI(글 모델)가 특기할 것을 고른다 (하루 상한 원)
//  돈 드는 것은 ③ 뿐. 동시에 두 번 돌지 않게 잠근다. 검증은 prefix 로 문서 이름을 갈라 쓴다.
// ============================================================

import type { Firestore } from "firebase-admin/firestore";
import { AccessError } from "@/lib/neander/server/auth";
import { NEANDER_COL } from "@/lib/neander/collections";
import {
  DEFAULT_MARKET_SETTINGS,
  channelDelta,
  channelTrackedDays,
  groupTrend,
  pushChannelPoint,
  sanitizeMarketSettings,
  sanitizeNote,
  trendDates,
  SEGMENTS,
  type BriefInput,
  type BriefRef,
  type ChannelStatDoc,
  type GroupSeries,
  type MarketBriefDoc,
  type MarketBriefItem,
  type MarketSettings,
  type TrendNoteDoc,
  type TrendRange,
} from "../market";
import { NAVER_LABEL, USD_KRW, normalizeProductKey, type RadarDoc } from "../radar";
import type { AccountDoc } from "../types";
import { marketBriefAI, openrouterConfigured } from "./ai";
import { accountTokens } from "./accounts";
import { naverConfig, naverTrend } from "./naver";
import { GRAPH_VERSION } from "./platforms";
import { kstDay, listRadar } from "./radar-run";
import { listFormats, listHits, listWatch } from "./scout-store";
import { youtubeApiKey, youtubeChannelStats } from "./youtube-data";

type WithId<T> = T & { id: string };
const settingsCol = (db: Firestore) => db.collection(NEANDER_COL.shortsSettings);
const marketCol = (db: Firestore) => db.collection(NEANDER_COL.shortsMarket);
const statsCol = (db: Firestore) => db.collection(NEANDER_COL.shortsChannelStats);
const notesCol = (db: Firestore) => db.collection(NEANDER_COL.shortsNotes);
const isDocId = (v: unknown): v is string => typeof v === "string" && /^[\w-]{6,60}$/.test(v);

export interface MarketRunOptions {
  by: string;
  deadline: number;
  /** 검증 — 문서 이름 앞에 붙인다 (실제 설정 · 계수기 · 브리핑을 건드리지 않게) */
  prefix?: string;
  now?: number;
  settings?: MarketSettings;
  /** 검증 — 이 감시 채널 · 계정만 */
  onlyWatch?: string[];
  onlyAccounts?: string[];
}

// ---- 설정 ----------------------------------------------------------------------

export async function getMarketSettings(db: Firestore, prefix = ""): Promise<MarketSettings> {
  const d = (await settingsCol(db).doc(`${prefix}market`).get()).data() as Partial<MarketSettings> | undefined;
  return d ? { ...DEFAULT_MARKET_SETTINGS, ...d } : DEFAULT_MARKET_SETTINGS;
}

export async function saveMarketSettings(db: Firestore, by: string, input: unknown, prefix = ""): Promise<MarketSettings> {
  const next = sanitizeMarketSettings(input, await getMarketSettings(db, prefix), by);
  await settingsCol(db).doc(`${prefix}market`).set(next);
  return next;
}

// ---- ② 검색어 추이 --------------------------------------------------------------

/** 묶음마다 혼자 1년 주간 — 모양 · 최근 변화용 (묶음끼리 크기는 compareTrend 로) */
export async function refreshGroupSeries(db: Firestore, s: MarketSettings, o: Pick<MarketRunOptions, "prefix" | "now" | "deadline">, notes: string[]): Promise<number> {
  if (!naverConfig().configured) {
    notes.push("네이버 데이터랩 키가 없어 검색어 추이를 건너뜀");
    return 0;
  }
  const { startDate, endDate } = trendDates("1y", o.now);
  const series: Record<string, GroupSeries> = {};
  let calls = 0;
  for (const g of s.groups) {
    if (Date.now() > o.deadline - 20_000) {
      notes.push("시간이 모자라 검색어 추이 일부를 다음에");
      break;
    }
    try {
      const [r] = await naverTrend({ groups: [{ name: g.name, keywords: g.keywords }], startDate, endDate, timeUnit: "week" });
      calls++;
      series[g.id] = { groupId: g.id, name: g.name, keywords: g.keywords, points: r?.points ?? [], at: o.now ?? Date.now() };
    } catch (e) {
      notes.push(`검색어 「${g.name}」: ${(e instanceof Error ? e.message : "").slice(0, 80)}`);
    }
  }
  if (calls) await marketCol(db).doc(`${o.prefix ?? ""}series`).set({ groups: series, at: o.now ?? Date.now() }, { merge: true });
  return calls;
}

export async function getGroupSeries(db: Firestore, prefix = ""): Promise<Record<string, GroupSeries>> {
  return (((await marketCol(db).doc(`${prefix}series`).get()).data() as { groups?: Record<string, GroupSeries> } | undefined)?.groups ?? {});
}

/**
 * 화면의 비교 — 묶음 1~5개를 한 요청에 (서로 크기를 견줄 수 있다) 또는 묶음 하나를 나이 · 성별 집단마다 따로
 * (집단마다 그 안의 상대값 — 모양만 견준다). 같은 조건은 그날 안에 다시 부르지 않는다(캐시).
 */
export async function compareTrend(
  db: Firestore,
  q: { groupIds: string[]; range: TrendRange; unit: "week" | "month"; mode: "groups" | "segments" },
  o: { prefix?: string; now?: number } = {},
): Promise<{ series: { name: string; points: { period: string; ratio: number }[] }[]; mode: "groups" | "segments"; cached: boolean }> {
  const s = await getMarketSettings(db, o.prefix);
  const groups = q.groupIds.map((id) => s.groups.find((g) => g.id === id)).filter((g): g is NonNullable<typeof g> => !!g);
  if (!groups.length) throw new Error("비교할 검색어 묶음을 골라 주세요.");
  const range: TrendRange = q.range === "3m" || q.range === "6m" ? q.range : "1y";
  const unit = q.unit === "month" ? "month" : "week";
  const mode = q.mode === "segments" ? "segments" : "groups";
  const day = kstDay(o.now);
  const key = `${o.prefix ?? ""}cache_${day}_${mode}_${range}_${unit}_${(mode === "segments" ? groups.slice(0, 1) : groups.slice(0, 5)).map((g) => `${g.id}-${g.keywords.length}`).join("_")}`.slice(0, 400);
  const ref = marketCol(db).doc(key.replace(/[^\w-]/g, "_"));
  const hit = (await ref.get()).data() as { series?: { name: string; points: { period: string; ratio: number }[] }[] } | undefined;
  if (hit?.series) return { series: hit.series, mode, cached: true };
  const { startDate, endDate } = trendDates(range, o.now);
  let series: { name: string; points: { period: string; ratio: number }[] }[];
  if (mode === "groups") {
    series = await naverTrend({ groups: groups.slice(0, 5).map((g) => ({ name: g.name, keywords: g.keywords })), startDate, endDate, timeUnit: unit });
  } else {
    const g = groups[0];
    series = [];
    for (const seg of SEGMENTS) {
      const [r] = await naverTrend({ groups: [{ name: g.name, keywords: g.keywords }], startDate, endDate, timeUnit: unit, gender: seg.gender, ages: seg.ages });
      series.push({ name: seg.label, points: r?.points ?? [] });
    }
  }
  await ref.set({ series, at: Date.now(), day });
  return { series, mode, cached: false };
}

/** 레이더가 본 상품들의 국내 검색 추세 — 상품 묶음마다 하나, 변화 큰 순 */
export function radarProductTrends(items: WithId<RadarDoc>[]) {
  const groups = new Map<string, WithId<RadarDoc>[]>();
  for (const r of items) {
    if (!r.ai?.relevant || !r.ai.product || !r.naver || r.dismissed) continue;
    const k = normalizeProductKey(r.ai.productKey || r.ai.product);
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  return [...groups.values()]
    .map((g) => {
      const lead = [...g].sort((a, b) => b.score - a.score)[0];
      const n = lead.naver!;
      return {
        id: lead.id,
        product: lead.ai!.product,
        keywords: n.keywords,
        label: n.label,
        change: n.change,
        recent: n.recent,
        candidates: g.length,
        title: lead.title,
        url: lead.url,
        thumbnail: lead.thumbnail,
        multiple: lead.multiple,
        at: n.at,
      };
    })
    .sort((a, b) => (b.change ?? (b.label === "rising" ? 99 : -1)) - (a.change ?? (a.label === "rising" ? 99 : -1)));
}

// ---- ① 채널 숫자 기록 -----------------------------------------------------------

const statKey = (platform: "youtube" | "instagram", externalId: string) => `${platform === "youtube" ? "yt" : "ig"}_${externalId}`;

async function writeStat(db: Firestore, prefix: string, base: Omit<ChannelStatDoc, "history" | "updatedAt">, point: ChannelStatDoc["history"][number], now: number) {
  const ref = statsCol(db).doc(`${prefix}${statKey(base.platform, base.externalId)}`);
  await db.runTransaction(async (tx) => {
    const prev = (await tx.get(ref)).data() as ChannelStatDoc | undefined;
    tx.set(ref, { ...base, history: pushChannelPoint(prev?.history ?? [], point), updatedAt: now } satisfies ChannelStatDoc);
  });
}

/** 감시 채널 + 연결한 유튜브 · 인스타 계정의 오늘 숫자 */
export async function snapshotChannels(db: Firestore, o: MarketRunOptions, notes: string[]): Promise<{ youtube: number; instagram: number }> {
  const now = o.now ?? Date.now();
  const day = kstDay(now);
  const prefix = o.prefix ?? "";
  const out = { youtube: 0, instagram: 0 };
  const watch = (await listWatch(db)).filter((w) => w.active && (!o.onlyWatch || o.onlyWatch.includes(w.id)));
  const accSnap = await db.collection(NEANDER_COL.shortsAccounts).get();
  const accounts = accSnap.docs
    .map((d) => ({ ...(d.data() as AccountDoc), id: d.id }))
    .filter((a) => a.status === "connected" && (!o.onlyAccounts || o.onlyAccounts.includes(a.id)));
  const myYt = accounts.filter((a) => a.platform === "youtube");
  const key = youtubeApiKey();
  const ytIds = [...new Set([...watch.map((w) => w.channelId), ...myYt.map((a) => a.externalId)])];
  if (ytIds.length && !key) notes.push("회사 YouTube 키가 없어 유튜브 채널 숫자를 건너뜀");
  else if (ytIds.length) {
    try {
      const stats = new Map((await youtubeChannelStats(ytIds, key)).map((s) => [s.channelId, s]));
      for (const id of ytIds) {
        const st = stats.get(id);
        if (!st) continue;
        const w = watch.find((x) => x.channelId === id);
        const mine = myYt.some((a) => a.externalId === id);
        await writeStat(
          db,
          prefix,
          { platform: "youtube", externalId: id, name: st.title || w?.title || "", handle: st.handle || w?.handle || "", thumbnail: st.thumbnail || w?.thumbnail || "", mine, watchId: w?.id ?? null, country: w?.country ?? "" },
          { day, subs: st.subscribers, views: st.views, posts: st.videos },
          now,
        );
        out.youtube++;
      }
    } catch (e) {
      notes.push(`유튜브 채널 숫자: ${(e instanceof Error ? e.message : "").slice(0, 100)}`);
    }
  }
  for (const a of accounts.filter((x) => x.platform === "instagram")) {
    try {
      const { accessToken } = await accountTokens(db, a.id);
      const q = new URLSearchParams({ fields: "username,followers_count,media_count,profile_picture_url", access_token: accessToken });
      const res = await igFetch(`https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(a.externalId)}?${q}`);
      const d = (await res.json().catch(() => null)) as { username?: string; followers_count?: number; media_count?: number; profile_picture_url?: string; error?: { message?: string } } | null;
      if (!res.ok || d?.error) throw new Error(d?.error?.message ?? `HTTP ${res.status}`);
      await writeStat(
        db,
        prefix,
        { platform: "instagram", externalId: a.externalId, name: d?.username ? `@${d.username}` : a.externalName, handle: d?.username ?? "", thumbnail: d?.profile_picture_url ?? "", mine: true, watchId: null, country: "" },
        { day, subs: typeof d?.followers_count === "number" ? d.followers_count : null, views: null, posts: typeof d?.media_count === "number" ? d.media_count : null },
        now,
      );
      out.instagram++;
    } catch (e) {
      notes.push(`인스타 「${a.externalName}」: ${(e instanceof Error ? e.message : "").slice(0, 100)}`);
    }
  }
  return out;
}

let igFetch: (url: string) => Promise<Response> = (url) => fetch(url, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
/** 검증용 — 인스타 Graph 호출을 갈아 끼운다 */
export const setMarketIgFetch = (f: ((url: string) => Promise<Response>) | null) => {
  igFetch = f ?? ((url) => fetch(url, { cache: "no-store", signal: AbortSignal.timeout(15_000) }));
};

export async function listChannelStats(db: Firestore, prefix = ""): Promise<WithId<ChannelStatDoc>[]> {
  const snap = await statsCol(db).get();
  return snap.docs
    .filter((d) => (prefix ? d.id.startsWith(prefix) : !d.id.startsWith("verify_")))
    .map((d) => ({ ...(d.data() as ChannelStatDoc), id: d.id }));
}

// ---- ③ 브리핑 --------------------------------------------------------------------

const DAY = 86_400_000;

/** 브리핑에 넘길 자료 — 최근 3일 레이더 · 터진 영상, 7일 안에 손댄 형식 카드, 검색어 묶음, 채널 변화 */
export function buildBriefInput(x: {
  day: string;
  now: number;
  radar: WithId<RadarDoc>[];
  hits: { id: string; title: string; channel: string; country: string; multiple: number | null; formatId: string | null; createdAt: number; status: string }[];
  formats: { id: string; name: string; summary: string; archived: boolean; updatedAt: number; korea: { status: string } }[];
  groupSeries: Record<string, GroupSeries>;
  channels: WithId<ChannelStatDoc>[];
}): BriefInput {
  const fmtName = new Map(x.formats.map((f) => [f.id, f.name]));
  const examples = new Map<string, number>();
  for (const h of x.hits) if (h.formatId && h.status !== "dismissed") examples.set(h.formatId, (examples.get(h.formatId) ?? 0) + 1);
  return {
    day: x.day,
    radar: x.radar
      .filter((r) => !r.dismissed && r.ai?.relevant !== false && r.firstSeenAt >= x.now - 3 * DAY)
      .sort((a, b) => b.score - a.score)
      .slice(0, 12)
      .map((r) => ({
        id: r.id,
        product: r.ai?.product ?? "",
        title: r.title.slice(0, 80),
        multiple: r.multiple,
        perDay: r.velocityPerDay,
        infoRate: r.info && r.info.sampled ? Math.round((r.info.matched / r.info.sampled) * 100) / 100 : null,
        naver: r.naver ? NAVER_LABEL[r.naver.label] : null,
        naverChange: r.naver?.change ?? null,
        filmed: r.filmed ? (r.filmed.value === "self" ? "직접 촬영" : "직접 촬영 아님") : null,
      })),
    productTrends: radarProductTrends(x.radar)
      .filter((p) => p.label === "rising")
      .slice(0, 8)
      .map((p) => ({ id: p.id, product: p.product, label: NAVER_LABEL[p.label], change: p.change, candidates: p.candidates })),
    hits: x.hits
      .filter((h) => h.status !== "dismissed" && h.createdAt >= x.now - 3 * DAY)
      .sort((a, b) => (b.multiple ?? 0) - (a.multiple ?? 0))
      .slice(0, 10)
      .map((h) => ({ id: h.id, title: h.title.slice(0, 80), channel: h.channel.slice(0, 40), country: h.country, multiple: h.multiple, format: h.formatId ? (fmtName.get(h.formatId) ?? null) : null })),
    formats: x.formats
      .filter((f) => !f.archived && f.updatedAt >= x.now - 7 * DAY)
      .slice(0, 8)
      .map((f) => ({ id: f.id, name: f.name, examples: examples.get(f.id) ?? 0, korea: f.korea.status, summary: f.summary.slice(0, 120) })),
    // Firestore 맵은 순서가 없다 — 변화가 큰 묶음부터
    groups: Object.values(x.groupSeries)
      .map((g) => {
        const t = groupTrend(g.points);
        return { id: g.groupId, name: g.name, label: NAVER_LABEL[t.label], change: t.change, recent: t.recent };
      })
      .sort((a, b) => (b.change ?? -1) - (a.change ?? -1)),
    channels: x.channels
      .map((c) => ({
        id: c.id,
        name: c.name,
        mine: c.mine,
        platform: c.platform,
        subs: c.history.at(-1)?.subs ?? null,
        subs7: channelDelta(c.history, 7, "subs"),
        subs30: channelDelta(c.history, 30, "subs"),
        posts7: channelDelta(c.history, 7, "posts"),
        days: channelTrackedDays(c.history),
      }))
      .sort((a, b) => Number(b.mine) - Number(a.mine) || (b.subs7 ?? -1) - (a.subs7 ?? -1))
      .slice(0, 15),
  };
}

/** AI 가 고른 근거 id 를 자료에서 되짚는다 — 없으면 근거 없음(null) */
export function resolveBriefRef(kind: string, id: string, input: BriefInput, channels: WithId<ChannelStatDoc>[], radar: WithId<RadarDoc>[], hitUrl: Map<string, string>): BriefRef | null {
  if (!id) return null;
  if (kind === "radar") {
    const r = radar.find((x) => x.id === id);
    return r ? { kind: "radar", id, url: r.url, label: r.ai?.product || r.title } : null;
  }
  if (kind === "hit") {
    const h = input.hits.find((x) => x.id === id);
    return h ? { kind: "hit", id, url: hitUrl.get(id) ?? null, label: h.title } : null;
  }
  if (kind === "format") {
    const f = input.formats.find((x) => x.id === id);
    return f ? { kind: "format", id, url: null, label: f.name } : null;
  }
  if (kind === "group") {
    const g = input.groups.find((x) => x.id === id);
    return g ? { kind: "group", id, url: null, label: g.name } : null;
  }
  if (kind === "channel") {
    const c = channels.find((x) => x.id === id);
    if (!c) return null;
    return { kind: "channel", id, url: c.platform === "youtube" ? `https://www.youtube.com/channel/${c.externalId}` : c.handle ? `https://www.instagram.com/${c.handle}` : null, label: c.name };
  }
  return null;
}

export async function getBrief(db: Firestore, day: string, prefix = ""): Promise<MarketBriefDoc | null> {
  return ((await marketCol(db).doc(`${prefix}brief_${day}`).get()).data() as MarketBriefDoc | undefined) ?? null;
}

/** 지난 브리핑 (최근 n일) — 날짜 · 제목만 */
export async function listBriefDays(db: Firestore, prefix = "", n = 14): Promise<{ day: string; headline: string; at: number }[]> {
  const snap = await marketCol(db).where("kind", "==", `${prefix}brief`).get();
  return snap.docs
    .map((d) => d.data() as MarketBriefDoc & { kind: string })
    .sort((a, b) => b.day.localeCompare(a.day))
    .slice(0, n)
    .map((b) => ({ day: b.day, headline: b.headline, at: b.at }));
}

async function readSpendUsd(db: Firestore, key: string): Promise<number> {
  return Number(((await settingsCol(db).doc(`usage_${key}`).get()).data() as { usd?: number } | undefined)?.usd) || 0;
}
async function addSpend(db: Firestore, key: string, usd: number) {
  const ref = settingsCol(db).doc(`usage_${key}`);
  await db.runTransaction(async (tx) => {
    const cur = Number(((await tx.get(ref)).data() as { usd?: number } | undefined)?.usd) || 0;
    tx.set(ref, { usd: cur + usd, at: Date.now() });
  });
}

/** 브리핑 한 번 — 하루 상한(원) 안에서. 같은 날 다시 하면 그날 브리핑을 바꿔 쓴다 */
export async function runMarketBrief(db: Firestore, o: MarketRunOptions, notes: string[] = []): Promise<MarketBriefDoc> {
  const now = o.now ?? Date.now();
  const day = kstDay(now);
  const prefix = o.prefix ?? "";
  const s = o.settings ?? (await getMarketSettings(db, prefix));
  if (!openrouterConfigured()) throw new Error("OPENROUTER_API_KEY 가 없어 브리핑을 쓸 수 없습니다.");
  const spendKey = `${prefix}marketusd_${day}`;
  if ((await readSpendUsd(db, spendKey)) * USD_KRW >= s.briefBudgetKrw) throw new Error(`오늘 브리핑 AI 상한(${s.briefBudgetKrw.toLocaleString("ko-KR")}원)에 닿았습니다 — 내일 다시 하거나 설정에서 올려 주세요.`);
  const [radar, hits, formats, groupSeries, channels] = await Promise.all([listRadar(db, 7), listHits(db), listFormats(db), getGroupSeries(db, prefix), listChannelStats(db, prefix)]);
  const input = buildBriefInput({ day, now, radar, hits, formats, groupSeries, channels });
  const ai = await marketBriefAI(input);
  await addSpend(db, spendKey, ai.costUsd);
  const hitUrl = new Map(hits.map((h) => [h.id, h.url]));
  const items: MarketBriefItem[] = ai.items
    .map((x) => ({ kind: x.kind, title: x.title, why: x.why, numbers: x.numbers, action: x.action, ref: x.refKind === "none" ? null : resolveBriefRef(x.refKind, x.refId, input, channels, radar, hitUrl) }))
    // 근거를 댔는데 자료에 없는 id 면 지어낸 것 — 버린다
    .filter((x, i) => ai.items[i].refKind === "none" || x.ref !== null)
    .filter((x) => x.title);
  const dropped = ai.items.length - items.length;
  if (dropped) notes.push(`근거를 자료에서 찾지 못한 항목 ${dropped}개를 뺌`);
  const doc: MarketBriefDoc & { kind: string } = {
    kind: `${prefix}brief`,
    day,
    at: Date.now(),
    by: o.by,
    headline: ai.headline || "오늘의 시장 브리핑",
    summary: ai.summary,
    items,
    model: ai.model,
    costUsd: ai.costUsd,
    inputs: { radar: input.radar.length, productTrends: input.productTrends.length, hits: input.hits.length, formats: input.formats.length, groups: input.groups.length, channels: input.channels.length },
    notes,
  };
  await marketCol(db).doc(`${prefix}brief_${day}`).set(doc);
  return doc;
}

/** 매일 아침 한 번에 — ① → ② → ③. 잠가서 두 번 돌지 않게 */
export async function runMarketDaily(db: Firestore, o: MarketRunOptions): Promise<{ brief: MarketBriefDoc | null; notes: string[]; channels: { youtube: number; instagram: number }; naverCalls: number }> {
  const prefix = o.prefix ?? "";
  const lockRef = settingsCol(db).doc(`${prefix}market_lock`);
  const got = await db.runTransaction(async (tx) => {
    const l = (await tx.get(lockRef)).data() as { until?: number } | undefined;
    if ((l?.until ?? 0) > Date.now()) return false;
    tx.set(lockRef, { until: Date.now() + 5 * 60_000 });
    return true;
  });
  if (!got) return { brief: null, notes: ["다른 실행이 아직 돌고 있어 건너뜀"], channels: { youtube: 0, instagram: 0 }, naverCalls: 0 };
  const notes: string[] = [];
  try {
    const s = o.settings ?? (await getMarketSettings(db, prefix));
    const channels = await snapshotChannels(db, o, notes);
    const naverCalls = await refreshGroupSeries(db, s, o, notes);
    let brief: MarketBriefDoc | null = null;
    try {
      brief = await runMarketBrief(db, { ...o, settings: s }, notes);
    } catch (e) {
      notes.push(`브리핑: ${(e instanceof Error ? e.message : "").slice(0, 120)}`);
    }
    return { brief, notes, channels, naverCalls };
  } finally {
    await lockRef.set({ until: 0 });
  }
}

// ---- 트렌드 노트 (사람마다 비공개) ----------------------------------------------------

export async function listNotes(db: Firestore, email: string): Promise<WithId<TrendNoteDoc>[]> {
  const snap = await notesCol(db).where("owner", "==", email).get();
  return snap.docs.map((d) => ({ ...(d.data() as TrendNoteDoc), id: d.id })).sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt);
}

export async function saveNote(db: Firestore, email: string, id: unknown, input: unknown): Promise<WithId<TrendNoteDoc>> {
  const now = Date.now();
  if (id === null || id === undefined || id === "") {
    const doc = sanitizeNote(input, email, now);
    const ref = await notesCol(db).add(doc);
    return { ...doc, id: ref.id };
  }
  if (!isDocId(id)) throw new Error("노트 id 가 올바르지 않습니다.");
  const ref = notesCol(db).doc(id);
  const prev = (await ref.get()).data() as TrendNoteDoc | undefined;
  if (!prev) throw new AccessError(404, "노트를 찾지 못했습니다.");
  if (prev.owner !== email) throw new AccessError(403, "다른 사람의 노트입니다.");
  const doc = sanitizeNote(input, email, now, prev);
  await ref.set(doc);
  return { ...doc, id };
}

export async function deleteNote(db: Firestore, email: string, id: unknown): Promise<void> {
  if (!isDocId(id)) throw new Error("노트 id 가 올바르지 않습니다.");
  const ref = notesCol(db).doc(id);
  const prev = (await ref.get()).data() as TrendNoteDoc | undefined;
  if (!prev) return;
  if (prev.owner !== email) throw new AccessError(403, "다른 사람의 노트입니다.");
  await ref.delete();
}
