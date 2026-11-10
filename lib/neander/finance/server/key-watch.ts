// ============================================================
//  예고 없이 생긴 오픈라우터 키 → 노션 「API키알림」 + 폰 알림 (서버 전용)
// ------------------------------------------------------------
//  무엇이 새 키인가는 ../key-watch.ts (순수). 여기서는 키 목록을 받고, 상태를 적고, 노션으로 보낸다.
//
//  부르는 곳 — 오픈라우터가 웹훅을 주지 않아서 키 목록을 볼 기회마다 살핀다:
//    · 재무 cron (매일 06:00 KST)
//    · 은행 · 카드 문자를 받을 때 (api/neander/finance/sms — 30분에 한 번까지)
//    · API 비용 화면을 열 때 (이미 받은 키 목록을 넘겨받아 오픈라우터를 다시 부르지 않는다)
//
//  상태: neander_fin_settings/key-watch
//    seen{해시 → 이름 · 만든 때 · 처음 본 때 · 상태} · initializedAt · checkedAt · lockUntil ·
//    recipients(없으면 돈 나가는 날의 받는 사람) · notion{table, userIds, userKey}
//  노션: 재무알림 페이지(sms-feed.notionPage, 없으면 돈 나가는 날의 notionPage) 아래 「API키알림」 표 —
//  처음 알릴 때 만든다. 한 키 = 한 줄 + 받는 사람 @멘션 댓글 (입출금 · 카드 알림과 같은 방식).
//  받는 사람 메일은 코드에 적지 않는다 (공개 저장소) — 설정 문서에만.
// ============================================================

/* eslint-disable @typescript-eslint/no-explicit-any */

import type { Firestore } from "firebase-admin/firestore";
import { NEANDER_COL } from "@/lib/neander/collections";
import { NotionArchiveError, parseNotionPageId } from "@/lib/neander/notion/archive-client";
import { fetchKeySnaps, managementKey } from "@/lib/neander/shorts/server/ai-usage";
import { keyAlertMessage, kstStamp, limitText, sortNewKeys, type SeenKey, type WatchKey } from "../key-watch";
import { moneyCall, moneyToken, notifyMention, recipientIds } from "./money-calendar";
import { ERP_ORIGIN } from "./sms-notify";

const DOC = "key-watch";
/** 다른 요청이 지금 살피는 중이면 건너뛴다 */
const LOCK_MS = 2 * 60_000;

interface TableRef {
  databaseId: string;
  dataSourceId: string;
  url?: string | null;
}
interface WatchDoc {
  seen?: Record<string, SeenKey>;
  initializedAt?: number;
  checkedAt?: number;
  lockUntil?: number;
  recipients?: string[];
  notion?: { table?: TableRef; userIds?: string[]; userKey?: string };
}

export interface KeyWatchResult {
  skipped?: string;
  /** 처음 — 기준선으로 적은 키 수 */
  initialized?: number;
  checked?: number;
  registered?: string[];
  alerted?: string[];
  waiting?: string[];
  failed?: { name: string; error: string }[];
}

const text = (s: string) => [{ type: "text", text: { content: s.slice(0, 1900) } }];
export const apiCostsUrl = () => `${ERP_ORIGIN}/neander/finance/api-costs`;

const TABLE = {
  title: "API키알림",
  emoji: "🔑",
  properties: {
    이름: { title: {} },
    "만든 때": { date: {} },
    한도: { rich_text: {} },
    상태: { select: { options: [{ name: "예고 없음", color: "red" }, { name: "테스트", color: "gray" }] } },
    열쇠: { rich_text: {} },
    ERP: { url: {} },
  },
};

const ref = (db: Firestore) => db.collection(NEANDER_COL.finSettings).doc(DOC);

/** ERP 에 등록된 키 — API 비용 붙일 곳 · AI 사용료 키 주인 */
async function registeredHashes(db: Firestore): Promise<Set<string>> {
  const [alloc, owners] = await Promise.all([
    db.collection(NEANDER_COL.finApiAlloc).select().get(),
    db.collection(NEANDER_COL.shortsSettings).doc("ai-usage-keys").get(),
  ]);
  const out = new Set(alloc.docs.map((d) => d.id));
  const keys = ((owners.data() as { keys?: Record<string, { owner?: string }> } | undefined)?.keys ?? {}) as Record<string, { owner?: string }>;
  for (const [hash, a] of Object.entries(keys)) if (a?.owner) out.add(hash);
  return out;
}

/** 다른 요청이 살피는 중이 아니면 잠근다 — 잠갔으면 문서 내용을, 못 잠갔으면 null */
async function lock(db: Firestore, now: number): Promise<WatchDoc | null> {
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref(db));
    const d = (snap.data() ?? {}) as WatchDoc;
    if ((d.lockUntil ?? 0) > now) return null;
    tx.set(ref(db), { lockUntil: now + LOCK_MS }, { merge: true });
    return d;
  });
}

interface NotionCtx {
  parentPage?: string;
  table?: TableRef;
  userIds: string[];
}

async function notionCtx(db: Firestore, d: WatchDoc): Promise<NotionCtx> {
  const [feed, money] = await Promise.all([
    db.collection(NEANDER_COL.finSettings).doc("sms-feed").get(),
    db.collection(NEANDER_COL.finSettings).doc("money-calendar").get(),
  ]);
  const f = feed.data() ?? {};
  const m = money.data() ?? {};
  const emails = (Array.isArray(d.recipients) && d.recipients.length ? d.recipients : Array.isArray(m.recipients) ? m.recipients : [])
    .map(String)
    .filter((e: string) => e.includes("@"));
  const userKey = [...emails].sort().join(",");
  let userIds = Array.isArray(d.notion?.userIds) ? d.notion!.userIds!.map(String) : [];
  if (d.notion?.userKey !== userKey) {
    userIds = emails.length ? (await recipientIds(emails)).ids : [];
    await ref(db).set({ notion: { userIds, userKey } }, { merge: true });
  }
  return { parentPage: String(f.notionPage ?? m.notionPage ?? "") || undefined, table: d.notion?.table, userIds };
}

/** 재무알림 페이지 아래 「API키알림」 표 — 처음 한 번 만든다 */
async function ensureTable(db: Firestore, ctx: NotionCtx): Promise<TableRef> {
  if (ctx.table?.dataSourceId) return ctx.table;
  const parent = parseNotionPageId(ctx.parentPage ?? "");
  if (!parent) throw new NotionArchiveError(0, "알림 표를 둘 노션 페이지(sms-feed.notionPage)가 없습니다.");
  const created = await moneyCall<any>("POST", "/databases", {
    parent: { type: "page_id", page_id: parent },
    title: text(TABLE.title),
    icon: { type: "emoji", emoji: TABLE.emoji },
    initial_data_source: { properties: TABLE.properties },
  });
  const dataSourceId: string | undefined = created?.data_sources?.[0]?.id;
  if (!dataSourceId) throw new NotionArchiveError(0, "노션이 표를 만들었지만 데이터 소스 id 를 돌려주지 않았습니다.");
  const table: TableRef = { databaseId: created.id, dataSourceId, url: created.url ?? null };
  await ref(db).set({ notion: { table } }, { merge: true });
  ctx.table = table;
  return table;
}

/** 키 하나 → 노션 한 줄 + 멘션 댓글. 만든 줄 id (이미 있으면 그 줄에 댓글만) */
async function sendAlert(db: Firestore, ctx: NotionCtx, k: WatchKey, prevPageId: string | undefined, test = false): Promise<string> {
  let pageId = prevPageId;
  if (!pageId) {
    const table = await ensureTable(db, ctx);
    const page = await moneyCall<any>("POST", "/pages", {
      parent: { type: "data_source_id", data_source_id: table.dataSourceId },
      properties: {
        이름: { title: text(k.name) },
        ...(k.createdAt ? { "만든 때": { date: { start: k.createdAt } } } : {}),
        한도: { rich_text: text(limitText(k)) },
        상태: { select: { name: test ? "테스트" : "예고 없음" } },
        열쇠: { rich_text: text(k.hash.slice(0, 12)) },
        ERP: { url: apiCostsUrl() },
      },
    });
    pageId = String(page.id);
  }
  if (ctx.userIds.length) await notifyMention(pageId, ctx.userIds, keyAlertMessage(k, test), { label: "API 비용 화면", url: apiCostsUrl() });
  return pageId;
}

/**
 * 새 키를 살핀다. 던지지 않는다 — 부르는 쪽(문자 받기 · 화면)을 막지 않게.
 *   keys — 이미 받은 키 목록 (없으면 오픈라우터에서 받는다)
 *   minIntervalMs — 지난번 살핀 뒤 이만큼 안 지났으면 건너뛴다 (문자처럼 자주 오는 신호)
 */
export async function watchNewKeys(db: Firestore, opts: { keys?: WatchKey[]; minIntervalMs?: number; source: string }): Promise<KeyWatchResult> {
  const now = Date.now();
  let locked = false;
  try {
    if (!opts.keys && !managementKey()) return { skipped: "오픈라우터 관리 키(OPENROUTER_MANAGEMENT_KEY)가 없습니다." };
    const peek = ((await ref(db).get()).data() ?? {}) as WatchDoc;
    if (opts.minIntervalMs && now - (peek.checkedAt ?? 0) < opts.minIntervalMs) return { skipped: "방금 살폈습니다." };
    const d = await lock(db, now);
    if (!d) return { skipped: "다른 요청이 살피는 중입니다." };
    locked = true;
    const keys = opts.keys ?? (await fetchKeySnaps());
    const seen: Record<string, SeenKey> = { ...(d.seen ?? {}) };

    // 처음 — 지금 있는 키는 모두 본 키 (알리지 않는다)
    if (!d.initializedAt) {
      for (const k of keys) seen[k.hash] = { name: k.name, createdAt: k.createdAt, firstSeen: now, state: "baseline" };
      await ref(db).set({ seen, initializedAt: now, checkedAt: now, lockUntil: 0 }, { merge: true });
      locked = false;
      return { initialized: keys.length };
    }

    const sorted = sortNewKeys(keys, seen, await registeredHashes(db), now);
    const out: KeyWatchResult = { checked: keys.length };
    for (const k of sorted.registered) seen[k.hash] = { name: k.name, createdAt: k.createdAt, firstSeen: seen[k.hash]?.firstSeen ?? now, state: "registered" };
    if (sorted.registered.length) out.registered = sorted.registered.map((k) => k.name);
    if (sorted.wait.length) out.waiting = sorted.wait.map((k) => k.name);

    if (sorted.alert.length) {
      const alerted: string[] = [];
      const failed: { name: string; error: string }[] = [];
      const off = moneyToken() ? undefined : "노션 연결 토큰(NOTION_MONEY_TOKEN)이 없습니다.";
      const ctx = off ? null : await notionCtx(db, d).catch((e) => (failed.push({ name: "(노션 준비)", error: String(e?.message ?? e) }), null));
      for (const k of sorted.alert) {
        const prev = seen[k.hash];
        const base = { name: k.name, createdAt: k.createdAt, firstSeen: prev?.firstSeen ?? now };
        if (!ctx) {
          seen[k.hash] = { ...base, state: "pending", tries: (prev?.tries ?? 0) + 1, error: off ?? "노션 준비 실패" };
          failed.push({ name: k.name, error: off ?? "노션 준비 실패" });
          continue;
        }
        try {
          const pageId = await sendAlert(db, ctx, k, prev?.pageId);
          seen[k.hash] = { ...base, state: "alerted", pageId };
          alerted.push(k.name);
        } catch (e) {
          const error = e instanceof Error ? e.message.slice(0, 300) : String(e);
          seen[k.hash] = { ...base, state: "pending", tries: (prev?.tries ?? 0) + 1, error, ...(prev?.pageId ? { pageId: prev.pageId } : {}) };
          failed.push({ name: k.name, error });
        }
      }
      if (alerted.length) out.alerted = alerted;
      if (failed.length) out.failed = failed;
    }
    await ref(db).set({ seen, checkedAt: now, lastSource: opts.source, lockUntil: 0 }, { merge: true });
    locked = false;
    return out;
  } catch (e) {
    console.error(`[finance/key-watch] ${opts.source}`, e);
    return { skipped: e instanceof Error ? e.message : String(e) };
  } finally {
    if (locked) await ref(db).set({ lockUntil: 0 }, { merge: true }).catch(() => undefined);
  }
}

/** 알림이 폰까지 가는지 — 가짜 키 한 줄로 보낸다 (본 키 목록은 건드리지 않는다) */
export async function sendTestKeyAlert(db: Firestore): Promise<{ pageId: string; mode: string; recipients: number }> {
  if (!moneyToken()) throw new Error("노션 연결 토큰(NOTION_MONEY_TOKEN)이 없습니다.");
  const d = ((await ref(db).get()).data() ?? {}) as WatchDoc;
  const ctx = await notionCtx(db, d);
  const fake: WatchKey = { hash: "test-key-watch", name: "TEST_키알림_확인용", limit: null, limitReset: null, disabled: false, createdAt: new Date().toISOString() };
  const pageId = await sendAlert(db, ctx, fake, undefined, true);
  return { pageId, mode: kstStamp(fake.createdAt), recipients: ctx.userIds.length };
}
