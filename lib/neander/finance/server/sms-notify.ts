// ============================================================
//  받은 은행 · 카드 문자 → 노션 「입출금알림」 · 「카드사용알림」 + 폰 알림 (서버 전용)
// ------------------------------------------------------------
//  api/neander/finance/sms 가 문자를 저장한 직후 부른다.
//    ① 노션 「재무알림」 페이지 아래 두 표 — 없으면 처음 한 번 만든다
//       (neander_fin_settings/sms-feed 의 notionPage, 없으면 돈 나가는 날의 notionPage)
//    ② 거래 한 건 = 표 한 줄 (통장 입출금 → 입출금알림, 카드 승인 · 취소 → 카드사용알림)
//    ③ 그 줄에 받는 사람을 @멘션한 댓글 — 노션 앱이 폰으로 알림을 띄운다.
//       금액이 notify.minAmount 아래면 줄만 남기고 댓글은 안 단다(기본 0 = 전부)
//
//  받는 사람은 돈 나가는 날과 같다(money-calendar.recipients). sms-feed.notifyRecipients 가
//  있으면 그것을 쓴다. 노션 연결도 같다(NOTION_MONEY_TOKEN — 재무알림 페이지에 붙어 있다).
//
//  노션이 실패해도 문자 저장은 이미 끝났다 — 받은 문자함 문서의 notify.state 를 failed 로
//  적어 두고, 다음 문자가 올 때 지난 하루 안의 실패분을 다시 보낸다. 줄을 만든 뒤 댓글에서
//  실패하면 notify.pageId 가 남아 있어 줄을 두 번 만들지 않는다.
// ============================================================

/* eslint-disable @typescript-eslint/no-explicit-any */

import type { DocumentReference, Firestore } from "firebase-admin/firestore";
import { NEANDER_COL } from "@/lib/neander/collections";
import { NotionArchiveError, parseNotionPageId } from "@/lib/neander/notion/archive-client";
import { BANK_SMS_PARSER, matchCardLast4, parseBankSms, type BankSmsParsed } from "../bank-sms";
import { shouldPing, smsNotice, type SmsNotice, type SmsNoticeChannel } from "../sms-notify";
import { moneyCall, moneyToken, notifyMention, recipientIds } from "./money-calendar";

const FEED_DOC = "sms-feed";
const MONEY_DOC = "money-calendar";
/** 실패분을 다시 보내는 범위 — 받은 지 하루 안, 다섯 번까지 */
const RETRY_WINDOW_MS = 24 * 3600_000;
const RETRY_MAX = 5;
/** 다른 요청이 지금 보내는 중일 수 있는 문서는 건드리지 않는다 */
const RETRY_QUIET_MS = 2 * 60_000;

interface TableRef {
  databaseId: string;
  dataSourceId: string;
  url?: string | null;
}

const text = (s: string) => [{ type: "text", text: { content: s.slice(0, 1900) } }];

const TABLES: Record<SmsNoticeChannel, { title: string; emoji: string; properties: Record<string, unknown> }> = {
  inout: {
    title: "입출금알림",
    emoji: "🏦",
    properties: {
      이름: { title: {} },
      시각: { date: {} },
      구분: { select: { options: [{ name: "입금", color: "green" }, { name: "출금", color: "red" }] } },
      금액: { number: { format: "won" } },
      통장: { select: { options: [] } },
      잔액: { number: { format: "won" } },
      상대: { rich_text: {} },
      열쇠: { rich_text: {} },
    },
  },
  card: {
    title: "카드사용알림",
    emoji: "💳",
    properties: {
      이름: { title: {} },
      시각: { date: {} },
      구분: { select: { options: [{ name: "승인", color: "red" }, { name: "취소", color: "gray" }] } },
      금액: { number: { format: "won" } },
      카드: { select: { options: [] } },
      가맹점: { rich_text: {} },
      할부: { rich_text: {} },
      "문자 속 잔액": { number: { format: "won" } },
      열쇠: { rich_text: {} },
    },
  },
};

/** 노션 select 이름에는 쉼표를 못 쓴다 */
const selectName = (s: string) => s.replace(/,/g, " ").slice(0, 100);

function propsOf(n: SmsNotice) {
  const common = {
    이름: { title: text(n.title) },
    시각: { date: { start: n.at } },
    구분: { select: { name: n.kind } },
    금액: { number: n.amount },
    열쇠: { rich_text: text(n.key) },
  };
  if (n.channel === "inout") {
    return { ...common, 통장: { select: { name: selectName(n.where) } }, 잔액: { number: n.balance ?? null }, 상대: { rich_text: text(n.party ?? "") } };
  }
  return {
    ...common,
    카드: { select: { name: selectName(n.where) } },
    가맹점: { rich_text: text(n.party ?? "") },
    할부: { rich_text: text(n.installment ?? "") },
    "문자 속 잔액": { number: n.balance ?? null },
  };
}

interface Ctx {
  feedRef: DocumentReference;
  parentPage?: string;
  tables: Partial<Record<SmsNoticeChannel, TableRef>>;
  userIds: string[];
  minAmount: number;
  nameOf: (kind: "account" | "card", last4: string) => string | undefined;
  resolveCard: (last4: string) => string;
}

/** 설정 · 받는 사람 · 통장/카드 이름을 한 번에 읽는다. 알림을 끄거나 연결이 없으면 이유 */
async function loadCtx(db: Firestore): Promise<Ctx | { skipped: string }> {
  if (!moneyToken()) return { skipped: "노션 연결 토큰(NOTION_MONEY_TOKEN)이 없습니다." };
  const feedRef = db.collection(NEANDER_COL.finSettings).doc(FEED_DOC);
  const [feedSnap, moneySnap, pmSnap] = await Promise.all([
    feedRef.get(),
    db.collection(NEANDER_COL.finSettings).doc(MONEY_DOC).get(),
    db.collection(NEANDER_COL.finPaymentMethods).get(),
  ]);
  const feed = feedSnap.data() ?? {};
  const notify = (feed.notify ?? {}) as { enabled?: boolean; minAmount?: number };
  if (notify.enabled === false) return { skipped: "입출금 · 카드 알림이 꺼져 있습니다(sms-feed.notify.enabled)." };
  const money = moneySnap.data() ?? {};
  const parentPage = String(feed.notionPage ?? money.notionPage ?? "") || undefined;
  const emails = (Array.isArray(feed.notifyRecipients) ? feed.notifyRecipients : Array.isArray(money.recipients) ? money.recipients : [])
    .map(String)
    .filter((e: string) => e.includes("@"));

  // 받는 사람 노션 id — 메일 목록이 같으면 저장해 둔 값을 쓴다 (문자마다 사용자 목록을 부르지 않게)
  const notion = (feed.notion ?? {}) as { inout?: TableRef; card?: TableRef; userIds?: string[]; userKey?: string };
  const userKey = [...emails].sort().join(",");
  let userIds = Array.isArray(notion.userIds) ? notion.userIds.map(String) : [];
  if (notion.userKey !== userKey) {
    userIds = emails.length ? (await recipientIds(emails)).ids : [];
    await feedRef.set({ notion: { userIds, userKey } }, { merge: true });
  }

  const methods = pmSnap.docs.map((d) => d.data() as { last4?: string; alias?: string; kind?: string });
  const names = new Map(methods.filter((m) => m.last4 && m.alias).map((m) => [`${m.kind}:${m.last4}`, String(m.alias)]));
  const linkedCards = Array.isArray(feed.linkedCards) ? feed.linkedCards.map(String) : [];
  const allCards = methods.filter((m) => m.kind === "card" && m.last4).map((m) => String(m.last4));
  return {
    feedRef,
    parentPage,
    tables: { inout: notion.inout, card: notion.card },
    userIds,
    minAmount: Number(notify.minAmount) || 0,
    nameOf: (kind, last4) => names.get(`${kind}:${last4}`),
    resolveCard: (l4) => matchCardLast4(l4, linkedCards) ?? matchCardLast4(l4, allCards) ?? l4,
  };
}

/** 표가 없으면 재무알림 페이지 아래에 만든다 — 처음 한 번 */
async function ensureTable(ctx: Ctx, channel: SmsNoticeChannel): Promise<TableRef> {
  const have = ctx.tables[channel];
  if (have?.dataSourceId) return have;
  const parent = parseNotionPageId(ctx.parentPage ?? "");
  if (!parent) throw new NotionArchiveError(0, "알림 표를 둘 노션 페이지(sms-feed.notionPage)가 없습니다.");
  const spec = TABLES[channel];
  const created = await moneyCall<any>("POST", "/databases", {
    parent: { type: "page_id", page_id: parent },
    title: text(spec.title),
    icon: { type: "emoji", emoji: spec.emoji },
    initial_data_source: { properties: spec.properties },
  });
  const dataSourceId: string | undefined = created?.data_sources?.[0]?.id;
  if (!dataSourceId) throw new NotionArchiveError(0, "노션이 표를 만들었지만 데이터 소스 id 를 돌려주지 않았습니다.");
  const ref: TableRef = { databaseId: created.id, dataSourceId, url: created.url ?? null };
  await ctx.feedRef.set({ notion: { [channel]: ref } }, { merge: true });
  ctx.tables[channel] = ref;
  return ref;
}

/** 두 표를 미리 만든다 (처음 설정할 때) */
export async function ensureSmsNotionTables(db: Firestore): Promise<Record<SmsNoticeChannel, TableRef> | { skipped: string }> {
  const ctx = await loadCtx(db);
  if ("skipped" in ctx) return ctx;
  return { inout: await ensureTable(ctx, "inout"), card: await ensureTable(ctx, "card") };
}

type NotifyState = "sent" | "logged" | "skip";

/** 문자 한 통 → 노션 한 줄 (+ 멘션 댓글) */
async function sendOne(ctx: Ctx, ref: DocumentReference, data: Record<string, any>): Promise<NotifyState> {
  const parsed: BankSmsParsed =
    Number(data.parsedWith) >= BANK_SMS_PARSER ? (data.parsed as BankSmsParsed) : parseBankSms(String(data.text ?? ""));
  const n = smsNotice({ id: ref.id, receivedAt: data.receivedAt, createdAt: data.createdAt, parsed }, ctx.nameOf, ctx.resolveCard);
  if (!n) return "skip";
  const prev = (data.notify ?? {}) as { pageId?: string; tries?: number };
  const tries = (Number(prev.tries) || 0) + 1;
  try {
    let pageId = prev.pageId;
    if (!pageId) {
      const table = await ensureTable(ctx, n.channel);
      const page = await moneyCall<any>("POST", "/pages", {
        parent: { type: "data_source_id", data_source_id: table.dataSourceId },
        properties: propsOf(n),
      });
      pageId = String(page.id);
      await ref.set({ notify: { state: "row", pageId, channel: n.channel, at: Date.now(), tries } }, { merge: true });
    }
    const ping = shouldPing(n, ctx.minAmount) && ctx.userIds.length > 0;
    const mode = ping ? await notifyMention(pageId, ctx.userIds, n.message) : null;
    const state: NotifyState = ping ? "sent" : "logged";
    await ref.set({ notify: { state, pageId, channel: n.channel, mode, at: Date.now(), tries, error: null } }, { merge: true });
    return state;
  } catch (e) {
    const error = e instanceof Error ? e.message.slice(0, 300) : String(e);
    await ref.set({ notify: { state: "failed", error, at: Date.now(), tries } }, { merge: true });
    throw e;
  }
}

export interface SmsNotifyResult {
  skipped?: string;
  state?: NotifyState | "failed";
  retried?: number;
  error?: string;
}

/**
 * 방금 저장한 문자를 노션으로 보내고, 지난 하루 안에 실패한 것도 다시 보낸다.
 * 던지지 않는다 — 문자 저장 응답을 막지 않게.
 */
export async function notifyNewSms(db: Firestore, id: string): Promise<SmsNotifyResult> {
  let ctx: Ctx | { skipped: string };
  try {
    ctx = await loadCtx(db);
  } catch (e) {
    return { state: "failed", error: e instanceof Error ? e.message : String(e) };
  }
  if ("skipped" in ctx) return { skipped: ctx.skipped };
  const col = db.collection(NEANDER_COL.finSmsInbox);
  const out: SmsNotifyResult = {};
  try {
    const snap = await col.doc(id).get();
    if (snap.exists) out.state = await sendOne(ctx, snap.ref, snap.data() ?? {});
  } catch (e) {
    out.state = "failed";
    out.error = e instanceof Error ? e.message : String(e);
  }
  // 지난 실패분 — 지금 다른 요청이 보내는 중일 수 있는 것(2분 안)은 빼고
  try {
    const now = Date.now();
    const stuck = await col.where("notify.state", "in", ["failed", "row"]).limit(20).get();
    let retried = 0;
    for (const d of stuck.docs) {
      if (d.id === id) continue;
      const x = d.data();
      const at = Number(x.receivedAt) || Number(x.createdAt) || 0;
      if (now - at > RETRY_WINDOW_MS || (Number(x.notify?.tries) || 0) >= RETRY_MAX || now - (Number(x.notify?.at) || 0) < RETRY_QUIET_MS) continue;
      try {
        await sendOne(ctx, d.ref, x);
        retried += 1;
      } catch {
        /* 다음 문자 때 또 */
      }
    }
    if (retried) out.retried = retried;
  } catch (e) {
    console.error("[finance/sms-notify] 다시 보내기", e);
  }
  return out;
}
