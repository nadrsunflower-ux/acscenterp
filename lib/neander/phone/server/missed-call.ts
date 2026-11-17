// ============================================================
//  회사폰 부재중 전화 → 노션 「부재중전화」 표 + 폰 알림 (서버 전용)
// ------------------------------------------------------------
//  api/neander/phone/missed-call 이 부른다 (회사폰 매크로드로이드 「부재중 전화」 트리거).
//    ① neander_phone_calls 에 한 건 — 같은 번호 · 같은 분이면 한 건(매크로가 두 번 보내도)
//    ② 노션 「재무알림」 페이지 아래 「부재중전화」 표 — 처음 한 번 만든다. 한 통 = 한 줄
//       (번호 칸은 전화번호 칸이라 노션 앱에서 누르면 바로 걸린다 · 「회신함」 체크)
//    ③ 그 줄에 받는 사람 @멘션 댓글 — 노션 앱이 폰으로 알림을 띄운다
//
//  노션 연결 · 표를 둘 페이지 · 받는 사람은 재무 알림의 것을 그대로 쓴다
//  (NOTION_MONEY_TOKEN · sms-feed.notionPage · 돈 나가는 날의 recipients).
//  받는 사람만 따로 하려면 neander_fin_settings/missed-call 의 recipients (노션 계정 메일).
//  끄려면 같은 문서 enabled=false. 메일은 코드에 적지 않는다 (공개 저장소).
//
//  노션이 실패해도 저장은 끝났다 — notify.state=failed 로 두고, 다음 부재중 때 하루 안의
//  실패분을 다시 보낸다 (줄을 만든 뒤 댓글에서 실패하면 pageId 가 남아 줄을 두 번 만들지 않는다).
// ============================================================

/* eslint-disable @typescript-eslint/no-explicit-any */

import { createHash } from "crypto";
import type { DocumentReference, Firestore } from "firebase-admin/firestore";
import { NEANDER_COL } from "@/lib/neander/collections";
import { NotionArchiveError, parseNotionPageId } from "@/lib/neander/notion/archive-client";
import { moneyCall, moneyToken, notifyMention, recipientIds } from "@/lib/neander/finance/server/money-calendar";
import {
  cleanContactName,
  displayNumber,
  MISSED_CALL_HEADLINE,
  missedCallMessage,
  missedCallTitle,
  normalizeNumber,
  type MissedCallNotice,
} from "../missed-call";

const DOC = "missed-call";
const RECENT_MS = 30 * 24 * 3600_000;
const RETRY_WINDOW_MS = 24 * 3600_000;
const RETRY_MAX = 5;
const RETRY_QUIET_MS = 2 * 60_000;

interface TableRef {
  databaseId: string;
  dataSourceId: string;
  url?: string | null;
}
interface SettingsDoc {
  enabled?: boolean;
  recipients?: string[];
  table?: TableRef;
  userIds?: string[];
  userKey?: string;
}
export interface PhoneCallDoc {
  number: string;
  name: string;
  /** 매크로드로이드가 보낸 그대로 (번호 · 이름) + 요청 원문(본문 종류 · 본문 · 주소 뒤 값) — 빈칸으로 왔을 때 원인 찾기 */
  raw: { number: string; name: string; type?: string; body?: string; query?: string };
  at: number;
  createdAt: number;
  hits: number;
  notify?: { state: "row" | "sent" | "logged" | "failed"; pageId?: string; mode?: string | null; at: number; tries: number; error?: string | null };
}

const text = (s: string) => [{ type: "text", text: { content: s.slice(0, 1900) } }];
const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const settingsRef = (db: Firestore) => db.collection(NEANDER_COL.finSettings).doc(DOC);

const TABLE = {
  title: "부재중전화",
  emoji: "📞",
  properties: {
    이름: { title: {} },
    시각: { date: {} },
    번호: { phone_number: {} },
    "저장된 이름": { rich_text: {} },
    "30일 횟수": { number: {} },
    회신함: { checkbox: {} },
  },
};

/** 한 통을 남긴다. 같은 번호 · 같은 분이면 받은 횟수만 올린다 */
export async function saveMissedCall(
  db: Firestore,
  input: { number?: string; name?: string; at?: number; request?: { type: string; body: string; query: string } },
): Promise<{ id: string; duplicate: boolean; doc: PhoneCallDoc }> {
  const now = Date.now();
  const at = Number.isFinite(input.at) && input.at! > 0 && Math.abs(input.at! - now) < 7 * 24 * 3600_000 ? input.at! : now;
  const number = normalizeNumber(input.number);
  const name = cleanContactName(input.name, number);
  const id = sha(`${number || "hidden"}¦${Math.floor(at / 60_000)}`).slice(0, 32);
  const ref = db.collection(NEANDER_COL.phoneCalls).doc(id);
  return db.runTransaction(async (tx) => {
    const cur = await tx.get(ref);
    if (cur.exists) {
      const hits = (Number(cur.get("hits")) || 1) + 1;
      tx.update(ref, { hits, lastHitAt: now });
      return { id, duplicate: true, doc: { ...(cur.data() as PhoneCallDoc), hits } };
    }
    const doc: PhoneCallDoc = {
      number,
      name,
      raw: {
        number: String(input.number ?? "").slice(0, 40),
        name: String(input.name ?? "").slice(0, 80),
        ...(input.request ? { type: input.request.type, body: input.request.body.slice(0, 500), query: input.request.query } : {}),
      },
      at,
      createdAt: now,
      hits: 1,
    };
    tx.set(ref, doc);
    return { id, duplicate: false, doc };
  });
}

interface Ctx {
  db: Firestore;
  parentPage?: string;
  table?: TableRef;
  userIds: string[];
  off?: string;
}

async function loadCtx(db: Firestore): Promise<Ctx> {
  const [s, feed, money] = await Promise.all([
    settingsRef(db).get(),
    db.collection(NEANDER_COL.finSettings).doc("sms-feed").get(),
    db.collection(NEANDER_COL.finSettings).doc("money-calendar").get(),
  ]);
  const d = (s.data() ?? {}) as SettingsDoc;
  const f = feed.data() ?? {};
  const m = money.data() ?? {};
  const off = !moneyToken()
    ? "노션 연결 토큰(NOTION_MONEY_TOKEN)이 없습니다."
    : d.enabled === false
      ? "부재중 전화 알림이 꺼져 있습니다(missed-call.enabled)."
      : undefined;
  const parentPage = String(f.notionPage ?? m.notionPage ?? "") || undefined;
  if (off) return { db, parentPage, table: d.table, userIds: [], off };
  const emails = (Array.isArray(d.recipients) && d.recipients.length ? d.recipients : Array.isArray(m.recipients) ? m.recipients : [])
    .map((e: unknown) => String(e).trim().toLowerCase())
    .filter((e: string) => e.includes("@"));
  const userKey = [...emails].sort().join(",");
  let userIds = Array.isArray(d.userIds) ? d.userIds.map(String) : [];
  if (d.userKey !== userKey || !Array.isArray(d.userIds)) {
    userIds = emails.length ? (await recipientIds(emails)).ids : [];
    await settingsRef(db).set({ userIds, userKey }, { merge: true });
  }
  return { db, parentPage, table: d.table, userIds };
}

/** 재무알림 페이지 아래 「부재중전화」 표 — 처음 한 번 만든다 */
async function ensureTable(ctx: Ctx): Promise<TableRef> {
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
  await settingsRef(ctx.db).set({ table }, { merge: true });
  ctx.table = table;
  return table;
}

/** 이 번호의 최근 30일 부재중 수 (이번 것 포함) — 발신번호 없음은 1 */
async function recentCount(db: Firestore, number: string, at: number): Promise<number> {
  if (!number) return 1;
  const snap = await db.collection(NEANDER_COL.phoneCalls).where("number", "==", number).get();
  return Math.max(1, snap.docs.filter((d) => {
    const t = Number(d.get("at")) || 0;
    return t <= at && at - t < RECENT_MS;
  }).length);
}

type NotifyState = "sent" | "logged";

async function sendOne(ctx: Ctx, ref: DocumentReference, x: PhoneCallDoc): Promise<NotifyState> {
  const tries = (Number(x.notify?.tries) || 0) + 1;
  try {
    const n: MissedCallNotice = { number: x.number, name: x.name, at: x.at, recent: await recentCount(ctx.db, x.number, x.at) };
    let pageId = x.notify?.pageId;
    if (!pageId) {
      const table = await ensureTable(ctx);
      const page = await moneyCall<any>("POST", "/pages", {
        parent: { type: "data_source_id", data_source_id: table.dataSourceId },
        properties: {
          이름: { title: text(missedCallTitle(n)) },
          시각: { date: { start: new Date(n.at).toISOString() } },
          번호: { phone_number: n.number ? displayNumber(n.number) : null },
          "저장된 이름": { rich_text: text(n.name) },
          "30일 횟수": { number: n.recent },
        },
      });
      pageId = String(page.id);
      await ref.set({ notify: { state: "row", pageId, at: Date.now(), tries } }, { merge: true });
    }
    const mode = ctx.userIds.length ? await notifyMention(pageId, ctx.userIds, missedCallMessage(n), undefined, MISSED_CALL_HEADLINE) : null;
    const state: NotifyState = mode ? "sent" : "logged";
    await ref.set({ notify: { state, pageId, mode, at: Date.now(), tries, error: null } }, { merge: true });
    return state;
  } catch (e) {
    const error = e instanceof Error ? e.message.slice(0, 300) : String(e);
    await ref.set({ notify: { state: "failed", error, at: Date.now(), tries } }, { merge: true });
    throw e;
  }
}

export interface MissedCallNotifyResult {
  skipped?: string;
  state?: NotifyState | "failed";
  retried?: number;
  error?: string;
}

/** 방금 남긴 부재중을 노션으로 보내고, 지난 하루 안에 실패한 것도 다시 보낸다. 던지지 않는다 */
export async function notifyMissedCall(db: Firestore, id: string): Promise<MissedCallNotifyResult> {
  let ctx: Ctx;
  try {
    ctx = await loadCtx(db);
  } catch (e) {
    return { state: "failed", error: e instanceof Error ? e.message : String(e) };
  }
  if (ctx.off) return { skipped: ctx.off };
  const col = db.collection(NEANDER_COL.phoneCalls);
  const out: MissedCallNotifyResult = {};
  try {
    const snap = await col.doc(id).get();
    if (snap.exists) out.state = await sendOne(ctx, snap.ref, snap.data() as PhoneCallDoc);
  } catch (e) {
    out.state = "failed";
    out.error = e instanceof Error ? e.message : String(e);
  }
  try {
    const now = Date.now();
    const stuck = await col.where("notify.state", "in", ["failed", "row"]).limit(20).get();
    let retried = 0;
    for (const d of stuck.docs) {
      if (d.id === id) continue;
      const x = d.data() as PhoneCallDoc;
      if (now - (x.at || 0) > RETRY_WINDOW_MS || (x.notify?.tries ?? 0) >= RETRY_MAX || now - (x.notify?.at ?? 0) < RETRY_QUIET_MS) continue;
      try {
        await sendOne(ctx, d.ref, x);
        retried += 1;
      } catch {
        /* 다음 부재중 때 또 */
      }
    }
    if (retried) out.retried = retried;
  } catch (e) {
    console.error("[phone/missed-call] 다시 보내기", e);
  }
  return out;
}
