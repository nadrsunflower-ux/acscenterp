import "server-only";

// ============================================================
//  API 비용 — 오픈라우터 날짜별 기록을 쌓고, 키마다 붙일 곳을 저장한다 (서버)
// ------------------------------------------------------------
//  날짜별 기록: POST /api/v1/analytics/query (관리 키) 로 키 · 모델 · 시간별 사용액을 받아
//  한국 날짜 하루(0~24시)로 모아 neander_fin_api_days/{날짜} 에 쌓는다. 재무 아침 cron 이
//  최근 며칠을 다시 받고, 화면을 열 때 빠진 날을 메운다. 오늘은 저장하지 않고 열 때마다 받는다.
//  시간별 기록은 약 35일 뒤 사라지므로 HOURLY_SAFE_DAYS 보다 오래된 날은 절대 다시 받지 않는다 —
//  다시 받으면 쌓아 둔 하루가 빈 값으로 덮인다.
//
//  오픈라우터는 키를 해시가 아니라 이름으로 준다. 이름 → 해시는 키 목록에서 보이는 대로
//  neander_fin_settings/api-cost-keys 에 모아 둔다 — 키가 나중에 만료돼 목록에서 사라져도
//  정해 둔 붙일 곳(해시로 저장)이 끊기지 않게. 처음부터 목록에 없던 키는 이름에서 지은 해시를 쓴다.
//
//  키 목록 · 충전 잔액은 AI STUDIO 「AI 사용료」 와 같은 함수(fetchUsageSnapshot)로 읽고,
//  키 주인도 그쪽에서 정한 것(neander_shorts_settings/ai-usage-keys)을 그대로 보여 준다.
//
//  붙일 곳(neander_fin_api_alloc/{키 해시}) 은 키 하나 = 문서 하나 — 구간을 자르고 넣는 일이
//  늘 한 문서 안에서 끝나게 (트랜잭션 하나).
//  원가로 보내기는 서버가 지금 기록 · 지금 정한 것으로 다시 세서 프로젝트 문서의
//  지출 줄 하나(id api-cost)만 바꾼다 — 화면이 보낸 숫자를 믿지 않는다.
// ============================================================

import { createHash } from "crypto";
import type { Firestore } from "firebase-admin/firestore";
import { NEANDER_COL } from "@/lib/neander/collections";
import { fetchUsageSnapshot, managementKey } from "@/lib/neander/shorts/server/ai-usage";
import { watchNewKeys } from "./key-watch";
import type { UsageSnapshot } from "@/lib/neander/shorts/ai-usage";
import { DEFAULT_SPACE, DEFAULT_SPACE_ID } from "@/lib/neander/shorts/spaces";
import { sanitizeLine, shortId, type FinProjectDoc } from "@/lib/neander/finance/project";
import { BIZ_MAJORS } from "@/lib/neander/finance/sheet";
import {
  addDays,
  apiCostLine,
  bizTargetId,
  cleanNote,
  cleanRate,
  costRows,
  dayFromAnalytics,
  daysBetween,
  EXACT_FROM,
  HOURLY_SAFE_DAYS,
  isDate,
  isSlot,
  kstDate,
  kstDayRange,
  krwOf,
  lastCompletedDay,
  projectApiCost,
  replaceApiCostLine,
  sanitizeSettings,
  setRange,
  slotFrom,
  slotTo,
  splitBizId,
  type AnalyticsRow,
  type ApiCostSettings,
  type ApiDayDoc,
  type ApiKeyAlloc,
  type ApiTarget,
} from "@/lib/neander/finance/api-cost";

/** 사람이 잘못 고른 것 (붙일 곳 · 날짜 · 키) — 라우트가 400 으로 돌려준다 */
export class ApiCostInputError extends Error {}

const BASE = "https://openrouter.ai/api/v1";
/** 한 번에 받는 날 수 상한 */
export const MAX_SYNC_DAYS = 800;
/** 끝난 지 이만큼 안 된 날은 다시 받는다 — 늦게 잡히는 사용액이 있다 */
const REFRESH_RECENT_DAYS = 2;

/** 저장된 키 문서 → 모양 맞추기 (구간이 없던 문서도 빈 목록으로) */
const readAlloc = (hash: string, raw: unknown): ApiKeyAlloc => {
  const a = (raw ?? {}) as Partial<ApiKeyAlloc>;
  return { ...a, hash, name: a.name ?? hash.slice(0, 8), ranges: Array.isArray(a.ranges) ? a.ranges : [] };
};

const daysCol = (db: Firestore) => db.collection(NEANDER_COL.finApiDays);
const allocCol = (db: Firestore) => db.collection(NEANDER_COL.finApiAlloc);
const settingsRef = (db: Firestore) => db.collection(NEANDER_COL.finSettings).doc("api-cost");

/** Firestore 는 undefined 를 거부한다 */
function clean<T extends object>(obj: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v;
  return out;
}

async function orPost<T>(path: string, body: unknown): Promise<T> {
  const key = managementKey();
  if (!key) throw new Error("OPENROUTER_MANAGEMENT_KEY 가 설정되지 않았습니다.");
  for (let i = 0; ; i++) {
    const res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    if (res.status === 429 && i < 4) {
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
      continue;
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`오픈라우터 ${path} 응답 ${res.status}${text ? ` — ${text.slice(0, 160)}` : ""}`);
    }
    return (await res.json()) as T;
  }
}

const r6 = (n: number) => Math.round(n * 1e6) / 1e6;

type AnalyticsResp = { data?: { data?: AnalyticsRow[]; metadata?: { truncated?: boolean } } };

/** 몇 개씩만 동시에 */
async function pool<T, R>(items: T[], size: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

/** 한국 날짜 하루치 — 시간별로 받아 그날로 모은다. 잘린 응답은 돈이 빠지므로 쓰지 않는다 */
async function fetchDay(date: string, hashOf: (name: string) => string): Promise<ApiDayDoc> {
  const r = await orPost<AnalyticsResp>("/analytics/query", {
    metrics: ["total_usage", "request_count"],
    dimensions: ["api_key_id", "model"],
    granularity: "hour",
    time_range: kstDayRange(date),
    limit: 10_000,
  });
  if (r.data?.metadata?.truncated) throw new Error(`오픈라우터 ${date} 응답이 잘렸습니다 — 그날 줄이 1만 개를 넘습니다.`);
  return dayFromAnalytics(date, r.data?.data ?? [], hashOf, Date.now());
}

/**
 * 이름 → 키 해시. 지금 목록을 모아 둔 표에 더해 저장하고, 표에 없는 이름은 이름에서 해시를 짓는다.
 * 만료된 키가 같은 이름으로 둘이면(예: test) 한 줄로 합쳐진다 — 오픈라우터가 이름만 주기 때문이다.
 */
export async function keyNames(db: Firestore, live: UsageSnapshot): Promise<(name: string) => string> {
  const ref = db.collection(NEANDER_COL.finSettings).doc("api-cost-keys");
  const saved = ((await ref.get()).data() as { names?: Record<string, string> } | undefined)?.names ?? {};
  const names = { ...saved };
  let changed = false;
  for (const k of live.keys) {
    if (names[k.name] !== k.hash) {
      names[k.name] = k.hash;
      changed = true;
    }
  }
  if (changed) await ref.set({ names, updatedAt: Date.now() });
  return (name) => names[name] ?? createHash("sha256").update(`gone:${name}`).digest("hex");
}

/**
 * 다 끝난 날들을 받아 쌓는다 — from 부터 어제까지, 또는 어제부터 back 일.
 * 이미 있는 날은 끝난 지 얼마 안 된 것만 다시 받는다 (force 면 모두).
 */
export async function syncApiDays(
  db: Firestore,
  opts: { back?: number; from?: string; force?: boolean; live?: UsageSnapshot } = {},
): Promise<{ dates: string[]; through: string }> {
  const live = opts.live ?? (await fetchUsageSnapshot());
  const hashOf = await keyNames(db, live);
  const end = lastCompletedDay(Date.now());
  const back = opts.from ? daysBetween(opts.from, end) + 1 : Math.floor(opts.back ?? 3);
  const count = Math.max(1, Math.min(MAX_SYNC_DAYS, back));
  // 시간별 기록이 확실히 남아 있는 날만 — 그보다 오래된 날은 있는 문서를 지킨다
  const oldest = kstDate(Date.now() - HOURLY_SAFE_DAYS * 86_400_000);
  const dates = Array.from({ length: count }, (_, i) => addDays(end, -i)).filter((d) => d >= oldest && d >= EXACT_FROM);
  if (!dates.length) return { dates: [], through: end };
  const have = new Set((await db.getAll(...dates.map((d) => daysCol(db).doc(d)))).filter((s) => s.exists).map((s) => s.id));
  const recent = addDays(end, -(REFRESH_RECENT_DAYS - 1));
  const todo = dates.filter((d) => opts.force || !have.has(d) || d >= recent);
  await pool(todo, 5, async (d) => {
    await daysCol(db).doc(d).set(await fetchDay(d, hashOf));
  });
  return { dates: todo.sort(), through: end };
}

// ---- 화면 하나 분량 ----------------------------------------------------

export interface ApiKeyMeta {
  hash: string;
  name: string;
  /** AI 사용료에서 정한 주인 — 팀원 메일 · erp · service · "" */
  owner: string;
  disabled: boolean;
  /** 오픈라우터 목록에서 사라졌다 (만료 · 삭제) — 기록에만 남은 키 */
  gone: boolean;
  limit: number | null;
  limitRemaining: number | null;
  lastUsedAt: string | null;
  createdAt: string | null;
}

export interface ApiCostView {
  at: number;
  /** 끝난 날 기록 (오래된 순) + 맨 끝에 오늘(진행 중, partial) */
  days: ApiDayDoc[];
  keys: ApiKeyMeta[];
  allocs: Record<string, ApiKeyAlloc>;
  settings: ApiCostSettings;
  spaces: { id: string; name: string; archived: boolean }[];
  credits: { total: number; used: number; balance: number };
  /** 이번에 오픈라우터에서 새로 받은 날 · 받다가 난 오류 */
  synced: { dates: string[]; error?: string };
}

async function latestDay(db: Firestore): Promise<string | null> {
  // 문서 id 내림차순은 색인이 필요하다 — 하루에 문서 하나라 id 만 모두 읽어도 가볍다
  const snap = await daysCol(db).select().get();
  return snap.docs.map((d) => d.id).sort().pop() ?? null;
}

export async function apiCostView(db: Firestore): Promise<ApiCostView> {
  const live = await fetchUsageSnapshot();
  // 예고 없이 생긴 키 살피기 (server/key-watch.ts) — 받은 목록을 그대로 넘긴다. 실패해도 화면은 열린다
  await watchNewKeys(db, { keys: live.keys, source: "api-costs", minIntervalMs: 5 * 60_000 });

  // 아침 cron 이 빠졌으면 여기서 메운다 — 마지막으로 받은 날부터 어제까지
  const end = lastCompletedDay(live.at);
  const latest = await latestDay(db);
  let synced: ApiCostView["synced"] = { dates: [] };
  if (!latest || latest < end) {
    try {
      const range = latest ? { back: daysBetween(latest, end) + REFRESH_RECENT_DAYS } : { from: EXACT_FROM };
      synced = { dates: (await syncApiDays(db, { ...range, live })).dates };
    } catch (e) {
      synced = { dates: [], error: e instanceof Error ? e.message : String(e) };
    }
  }

  const [daySnap, allocSnap, settingsSnap, ownerSnap, spaceSnap] = await Promise.all([
    daysCol(db).get(),
    allocCol(db).get(),
    settingsRef(db).get(),
    db.collection(NEANDER_COL.shortsSettings).doc("ai-usage-keys").get(),
    db.collection(NEANDER_COL.shortsSpaces).get(),
  ]);
  const days = daySnap.docs.map((d) => d.data() as ApiDayDoc).sort((a, b) => a.date.localeCompare(b.date));

  // 오늘 — 저장하지 않고 열 때마다 받는다 (아직 끝나지 않은 날). 못 받아도 화면은 연다
  const today = kstDate(live.at);
  if (!days.some((d) => d.date === today)) {
    try {
      const doc = await fetchDay(today, await keyNames(db, live));
      if (doc.keys.length) days.push({ ...doc, partial: true });
    } catch (e) {
      synced = { ...synced, error: e instanceof Error ? e.message : String(e) };
    }
  }

  const owners = ((ownerSnap.data() as { keys?: Record<string, { owner?: string }> } | undefined)?.keys ?? {}) as Record<string, { owner?: string }>;
  const allocs: Record<string, ApiKeyAlloc> = {};
  for (const d of allocSnap.docs) allocs[d.id] = readAlloc(d.id, d.data());

  const liveHashes = new Set(live.keys.map((k) => k.hash));
  const keys: ApiKeyMeta[] = live.keys.map((k) => ({
    hash: k.hash,
    name: k.name,
    owner: owners[k.hash]?.owner ?? "",
    disabled: k.disabled,
    gone: false,
    limit: k.limit,
    limitRemaining: k.limitRemaining,
    lastUsedAt: k.lastUsedAt,
    createdAt: k.createdAt,
  }));
  // 기록에만 남은 키 (만료 · 삭제)
  const goneNames = new Map<string, string>();
  for (const d of days) for (const k of d.keys) if (!liveHashes.has(k.hash)) goneNames.set(k.hash, k.name);
  for (const [hash, name] of goneNames)
    keys.push({ hash, name, owner: owners[hash]?.owner ?? "", disabled: true, gone: true, limit: null, limitRemaining: null, lastUsedAt: null, createdAt: null });

  const spaces = [
    { id: DEFAULT_SPACE_ID, name: DEFAULT_SPACE.name, archived: false },
    ...spaceSnap.docs
      .filter((d) => d.id !== DEFAULT_SPACE_ID)
      .map((d) => {
        const s = d.data() as { name?: string; archived?: boolean; order?: number };
        return { id: d.id, name: String(s.name ?? d.id), archived: !!s.archived, order: s.order ?? 0 };
      })
      .sort((a, b) => a.order - b.order)
      .map(({ order: _o, ...s }) => s),
  ];

  return {
    at: live.at,
    days,
    keys,
    allocs,
    settings: sanitizeSettings(settingsSnap.data()),
    spaces,
    credits: { total: live.totalCredits, used: live.totalUsage, balance: r6(live.totalCredits - live.totalUsage) },
    synced,
  };
}

// ---- 정하기 ----------------------------------------------------------

/** 붙일 곳 확인 — 있는 재무 프로젝트 · AI STUDIO 프로젝트 · 사업구분 · 공통만. null(안 정함)은 그대로 */
async function checkTarget(db: Firestore, raw: unknown): Promise<ApiTarget | null> {
  if (raw === null || raw === undefined || raw === "") return null;
  const t = raw as Partial<ApiTarget>;
  if (t.kind === "common") return { kind: "common", id: "" };
  if (t.kind === "biz") {
    // 사업구분은 장부에 쓰인 대분류 · 소분류 한 쌍 — 대분류만 정해진 목록에서 확인한다
    const biz = typeof t.id === "string" ? splitBizId(t.id) : null;
    if (!biz || !(BIZ_MAJORS as readonly string[]).includes(biz.major)) throw new ApiCostInputError("그 사업구분을 알아볼 수 없습니다.");
    return { kind: "biz", id: bizTargetId(biz.major, biz.minor) };
  }
  const id = typeof t.id === "string" ? t.id.trim() : "";
  if (!id || !/^[\w-]{1,64}$/.test(id)) throw new ApiCostInputError("붙일 곳을 알아볼 수 없습니다.");
  if (t.kind === "fin") {
    if (!(await db.collection(NEANDER_COL.finProjects).doc(id).get()).exists) throw new ApiCostInputError("그 재무 프로젝트가 없습니다.");
    return { kind: "fin", id };
  }
  if (t.kind === "studio") {
    if (id !== DEFAULT_SPACE_ID && !(await db.collection(NEANDER_COL.shortsSpaces).doc(id).get()).exists) throw new ApiCostInputError("그 AI STUDIO 프로젝트가 없습니다.");
    return { kind: "studio", id };
  }
  throw new ApiCostInputError("붙일 곳을 알아볼 수 없습니다.");
}

const cleanHash = (v: unknown) => {
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  if (!/^[a-f0-9]{16,128}$/.test(s)) throw new ApiCostInputError("키를 알아볼 수 없습니다.");
  return s;
};
const cleanName = (v: unknown, hash: string) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 80) : hash.slice(0, 8));

/** 키 문서 하나를 읽어 고쳐 쓴다 */
async function editAlloc(db: Firestore, by: string, hash: string, name: string, fn: (a: ApiKeyAlloc) => ApiKeyAlloc): Promise<ApiKeyAlloc> {
  const ref = allocCol(db).doc(hash);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const prev: ApiKeyAlloc = snap.exists ? readAlloc(hash, snap.data()) : { hash, name, default: null, ranges: [] };
    const next = fn({ ...prev, name: name || prev.name });
    const doc: ApiKeyAlloc = { ...next, hash, updatedAt: Date.now(), updatedBy: by };
    tx.set(ref, clean({ ...doc, ranges: doc.ranges.map((r) => clean(r)) }));
    return doc;
  });
}

/** 키의 기본 붙일 곳 */
export async function setKeyDefault(db: Firestore, by: string, input: { hash?: unknown; name?: unknown; target?: unknown }): Promise<ApiKeyAlloc> {
  const hash = cleanHash(input.hash);
  const target = await checkTarget(db, input.target);
  return editAlloc(db, by, hash, cleanName(input.name, hash), (a) => ({ ...a, default: target }));
}

/**
 * 시간 구간을 넣는다 — from~to(비우면 계속) 하나, 또는 spans 여러 개(화면에서 날 · 시간을 골라 붙일 때).
 * from · to 는 시간 칸(`YYYY-MM-DDTHH`) 이나 날짜(하루 통째). target 이 null 이면 그 시간들을 기본으로 되돌린다.
 */
export async function setKeyRange(
  db: Firestore,
  by: string,
  input: { hash?: unknown; name?: unknown; from?: unknown; to?: unknown; spans?: unknown; target?: unknown; note?: unknown },
): Promise<ApiKeyAlloc> {
  const hash = cleanHash(input.hash);
  const target = await checkTarget(db, input.target);
  const note = cleanNote(input.note);
  const point = (v: unknown): v is string => isDate(v) || isSlot(v);
  const span = (raw: { from?: unknown; to?: unknown }): { from: string; to?: string } => {
    if (!point(raw.from)) throw new ApiCostInputError("시작 시각을 알아볼 수 없습니다.");
    const to = raw.to === undefined || raw.to === null || raw.to === "" ? undefined : raw.to;
    if (to === undefined) return { from: slotFrom(raw.from) };
    if (!point(to)) throw new ApiCostInputError("끝 시각을 알아볼 수 없습니다. 비워 두면 계속입니다.");
    if (slotTo(to) < slotFrom(raw.from)) throw new ApiCostInputError("끝이 시작보다 앞입니다.");
    return { from: slotFrom(raw.from), to: slotTo(to) };
  };
  let spans: { from: string; to?: string }[];
  if (Array.isArray(input.spans)) {
    if (!input.spans.length) throw new ApiCostInputError("고른 시간이 없습니다.");
    if (input.spans.length > 400) throw new ApiCostInputError("한 번에 넣을 수 있는 구간은 400개까지입니다.");
    spans = input.spans.map((x) => span((x ?? {}) as { from?: unknown; to?: unknown }));
  } else {
    spans = [span(input)];
  }
  const at = Date.now();
  return editAlloc(db, by, hash, cleanName(input.name, hash), (a) => {
    let ranges = a.ranges;
    for (const sp of spans) ranges = setRange(ranges, sp, target, { at, by, note }, shortId);
    return { ...a, ranges };
  });
}

export async function deleteKeyRange(db: Firestore, by: string, input: { hash?: unknown; id?: unknown }): Promise<ApiKeyAlloc> {
  const hash = cleanHash(input.hash);
  const id = typeof input.id === "string" ? input.id : "";
  return editAlloc(db, by, hash, "", (a) => ({ ...a, ranges: a.ranges.filter((r) => r.id !== id) }));
}

export async function saveApiSettings(db: Firestore, by: string, input: { krwPerUsd?: unknown }): Promise<ApiCostSettings> {
  const rate = cleanRate(input.krwPerUsd);
  if (rate === null) throw new ApiCostInputError("환율은 1달러에 500~5,000원 사이로 적어 주세요.");
  await settingsRef(db).set({ krwPerUsd: rate, updatedAt: Date.now(), updatedBy: by }, { merge: true });
  return sanitizeSettings((await settingsRef(db).get()).data());
}

// ---- 원가로 보내기 -----------------------------------------------------

/**
 * 재무 프로젝트에 붙은 API 비용(끝난 날)을 그 프로젝트의 지출 줄 하나(id api-cost)로 쓴다.
 * 0 달러면 그 줄을 지운다. removeLineIds — 사람이 손으로 적어 둔 AI API 줄 중 겹쳐서 지울 것
 * (손으로 적은 AI API 줄로 보이는 것만 지운다).
 */
export async function pushProjectCost(
  db: Firestore,
  by: string,
  input: { projectId?: unknown; removeLineIds?: unknown },
): Promise<{ usd: number; krw: number; rate: number; removed: number; through: string }> {
  const projectId = typeof input.projectId === "string" ? input.projectId.trim() : "";
  if (!projectId) throw new ApiCostInputError("프로젝트가 필요합니다.");
  const remove = new Set(Array.isArray(input.removeLineIds) ? input.removeLineIds.filter((x): x is string => typeof x === "string") : []);

  const [daySnap, allocSnap, settingsSnap] = await Promise.all([daysCol(db).get(), allocCol(db).get(), settingsRef(db).get()]);
  const days = daySnap.docs.map((d) => d.data() as ApiDayDoc);
  const allocs: Record<string, ApiKeyAlloc> = {};
  for (const d of allocSnap.docs) allocs[d.id] = readAlloc(d.id, d.data());
  const settings = sanitizeSettings(settingsSnap.data());
  const cost = projectApiCost(costRows(days, allocs), projectId);
  const rate = settings.krwPerUsd;
  const krw = krwOf(cost.usd, rate);
  const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);

  const ref = db.collection(NEANDER_COL.finProjects).doc(projectId);
  const removed = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new ApiCostInputError("그 재무 프로젝트가 없습니다.");
    const doc = snap.data() as FinProjectDoc;
    const next = replaceApiCostLine(doc.lines ?? [], cost.usd > 0 ? apiCostLine(cost, rate, today) : null, remove);
    tx.update(ref, {
      lines: next.lines.map((l) => clean(sanitizeLine(l))),
      updatedAt: Date.now(),
      updatedBy: by,
    });
    return next.removed;
  });

  await settingsRef(db).set(
    { pushed: { [projectId]: { at: Date.now(), by, usd: cost.usd, krw, rate, through: cost.through } } },
    { merge: true },
  );
  return { usd: cost.usd, krw, rate, removed, through: cost.through };
}
