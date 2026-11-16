// ============================================================
//  생일 이벤트 발주 알림 → 노션 「이벤트발주알림」 표 + 폰 알림 (서버 전용)
// ------------------------------------------------------------
//  매일 아침 api/neander/sales/order-alert (Vercel Cron 06:10 KST) 가 부른다.
//    ① 매장 앱 캘린더(`events`)와 ERP 이벤트(`neander_sales_events`)를 짝 맞춘다 (../order-alert.ts)
//    ② 노션 「재무알림」 페이지 아래 「이벤트발주알림」 표 — 처음 한 번 만든다. 앞으로 45일 안의
//       이벤트를 한 줄씩 두고 상태(여유 · 발주할 때 · 발주 늦음 · 발주함 · 진행 중)를 맞춘다.
//       범위를 벗어난 줄은 「지남」 으로 돌려 빨간 줄이 남지 않게 한다
//    ③ D-15 · D-10 · D-8 부터 매일 — 발주 기록이 없으면 그 줄에 받는 사람 @멘션 댓글
//       (재무 알림과 같은 방식 — 노션 앱이 폰으로 알림을 띄운다)
//
//  노션 연결 · 표를 둘 페이지 · 받는 사람은 재무 알림의 것을 그대로 쓴다
//  (NOTION_MONEY_TOKEN · sms-feed.notionPage · 돈 나가는 날의 recipients). 이 표에는 금액을 싣지 않는다.
//  받는 사람만 따로 하려면 neander_fin_settings/event-order-alert 의 recipients (노션 계정 메일).
//  메일은 코드에 적지 않는다 (공개 저장소).
//
//  상태: neander_fin_settings/event-order-alert
//    table{databaseId · dataSourceId · url} · userIds · userKey · sent{열쇠 → at · mode} · last
// ============================================================

/* eslint-disable @typescript-eslint/no-explicit-any */

import type { Firestore } from "firebase-admin/firestore";
import { NEANDER_COL } from "@/lib/neander/collections";
import { NotionArchiveError, parseNotionPageId } from "@/lib/neander/notion/archive-client";
import { moneyCall, moneyToken, notifyMention, plain, recipientIds } from "@/lib/neander/finance/server/money-calendar";
import { ERP_ORIGIN } from "@/lib/neander/finance/server/sms-notify";
import {
  alertKey,
  inWindow,
  ORDER_STAGE_LABEL,
  orderAlertText,
  orderStage,
  orderStoreLabel,
  pairEvents,
  type CalendarBirthday,
  type OrderEvent,
} from "../order-alert";
import type { SalesEvent } from "../types";

const DOC = "event-order-alert";
/** 매장 앱 캘린더 컬렉션 (lib/db.ts COL.events) */
const CALENDAR_COL = "events";
export const ORDER_ALERT_HEADLINE = "🎂 이벤트 발주 알림";

interface TableRef {
  databaseId: string;
  dataSourceId: string;
  url?: string | null;
}
interface AlertDoc {
  table?: TableRef;
  userIds?: string[];
  userKey?: string;
  recipients?: string[];
  sent?: Record<string, { at: number; mode: string }>;
}

export interface OrderAlertResult {
  skipped?: string;
  events: number;
  rows?: { created: number; updated: number; retired: number };
  alerts: { key: string; text: string; mode?: string }[];
  warnings: string[];
}

const text = (s: string) => [{ type: "text", text: { content: s.slice(0, 1900) } }];
const ref = (db: Firestore) => db.collection(NEANDER_COL.finSettings).doc(DOC);

const STATE_OPTIONS = [
  { name: "여유", color: "gray" },
  { name: "발주할 때", color: "yellow" },
  { name: "발주 늦음", color: "red" },
  { name: "발주함", color: "green" },
  { name: "진행 중", color: "blue" },
  { name: "지남", color: "default" },
];
const TABLE = {
  title: "이벤트발주알림",
  emoji: "🎂",
  properties: {
    이벤트: { title: {} },
    매장: { select: { options: [{ name: "아이디", color: "purple" }, { name: "와우", color: "orange" }, { name: "공통", color: "green" }] } },
    기간: { date: {} },
    상태: { select: { options: STATE_OPTIONS } },
    발주일: { date: {} },
    "ERP 코드": { rich_text: {} },
    열쇠: { rich_text: {} },
    ERP: { url: {} },
  },
};

/** ERP 에서 그 이벤트 열기 — 없으면 캘린더 내용으로 새 이벤트 칸을 채워 연다 */
export function orderEventUrl(e: OrderEvent): string {
  const base = `${ERP_ORIGIN}/neander/sales/event-entry`;
  if (e.erpId) return `${base}?event=${encodeURIComponent(e.erpId)}`;
  const q = new URLSearchParams({ new: "1", name: e.name, from: e.from, to: e.to });
  if (e.store === "id" || e.store === "wow") q.set("store", e.store);
  return `${base}?${q.toString()}`;
}

/** 두 곳을 읽어 짝 맞춘 이벤트 */
export async function loadOrderEvents(db: Firestore): Promise<OrderEvent[]> {
  const [cal, sales] = await Promise.all([db.collection(CALENDAR_COL).get(), db.collection(NEANDER_COL.salesEvents).get()]);
  const calendar = cal.docs.map((d) => {
    const x = d.data() as Partial<CalendarBirthday>;
    return { id: d.id, store: (x.store ?? "all") as CalendarBirthday["store"], title: String(x.title ?? ""), startDate: String(x.startDate ?? ""), endDate: String(x.endDate ?? "") };
  });
  const events = sales.docs.map((d) => ({ ...(d.data() as SalesEvent), id: d.id }));
  return pairEvents(calendar, events);
}

function propsOf(e: OrderEvent, today: string) {
  const st = orderStage(e, today);
  return {
    이벤트: { title: text(e.name) },
    ...(e.store !== "online" ? { 매장: { select: { name: orderStoreLabel(e.store) } } } : {}),
    기간: { date: { start: e.from, ...(e.to !== e.from ? { end: e.to } : {}) } },
    상태: { select: { name: ORDER_STAGE_LABEL[st] } },
    발주일: { date: e.ordered ? { start: e.ordered.date } : null },
    "ERP 코드": { rich_text: text(e.erpId ? `${e.erpId}${e.storeMismatch ? " (매장 다름)" : ""}` : "") },
    열쇠: { rich_text: text(e.key) },
    ERP: { url: orderEventUrl(e) },
  };
}
/** 바뀐 줄만 고치려고 — 노션이 돌려주는 값과 같은 모양으로 */
const printOf = (state: string, ordered: string, erp: string, from: string, to: string) => [state, ordered, erp, from, to].join("|");
const wantPrint = (e: OrderEvent, today: string) =>
  printOf(ORDER_STAGE_LABEL[orderStage(e, today)], e.ordered?.date ?? "", e.erpId ? `${e.erpId}${e.storeMismatch ? " (매장 다름)" : ""}` : "", e.from, e.to !== e.from ? e.to : "");

async function ensureTable(db: Firestore, d: AlertDoc): Promise<TableRef> {
  if (d.table?.dataSourceId) return d.table;
  const [feed, money] = await Promise.all([
    db.collection(NEANDER_COL.finSettings).doc("sms-feed").get(),
    db.collection(NEANDER_COL.finSettings).doc("money-calendar").get(),
  ]);
  const parent = parseNotionPageId(String(feed.data()?.notionPage ?? money.data()?.notionPage ?? ""));
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
  await ref(db).set({ table }, { merge: true });
  d.table = table;
  return table;
}

/** 아직 「지남」 이 아닌 줄 — 열쇠 → 줄 id · 지금 값 */
async function liveRows(dataSourceId: string): Promise<Map<string, { id: string; print: string }>> {
  const out = new Map<string, { id: string; print: string }>();
  let cursor: string | undefined;
  do {
    const res = await moneyCall<any>("POST", `/data_sources/${dataSourceId}/query`, {
      page_size: 100,
      filter: { property: "상태", select: { does_not_equal: "지남" } },
      ...(cursor ? { start_cursor: cursor } : {}),
    });
    for (const p of res.results ?? []) {
      const pr = p.properties ?? {};
      const key = plain(pr["열쇠"]?.rich_text);
      if (!key) continue;
      const date = pr["기간"]?.date ?? {};
      out.set(key, {
        id: p.id,
        print: printOf(pr["상태"]?.select?.name ?? "", pr["발주일"]?.date?.start ?? "", plain(pr["ERP 코드"]?.rich_text), date.start ?? "", date.end ?? ""),
      });
    }
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
  return out;
}

async function userIdsOf(db: Firestore, d: AlertDoc): Promise<string[]> {
  const money = await db.collection(NEANDER_COL.finSettings).doc("money-calendar").get();
  const m = money.data() ?? {};
  const emails = (Array.isArray(d.recipients) && d.recipients.length ? d.recipients : Array.isArray(m.recipients) ? m.recipients : [])
    .map(String)
    .filter((e: string) => e.includes("@"));
  const userKey = [...emails].sort().join(",");
  if (d.userKey === userKey && Array.isArray(d.userIds)) return d.userIds;
  const userIds = emails.length ? (await recipientIds(emails)).ids : [];
  await ref(db).set({ userIds, userKey }, { merge: true });
  return userIds;
}

/**
 * 하루 한 번 — 표 맞추기 + 오늘 보낼 알림.
 * dryRun 이면 노션을 건드리지 않고 무엇을 할지만 돌려준다.
 */
export async function runOrderAlert(db: Firestore, args: { today: string; dryRun?: boolean }): Promise<OrderAlertResult> {
  const { today } = args;
  const all = await loadOrderEvents(db);
  const events = all.filter((e) => inWindow(e, today));
  const warnings: string[] = [];
  for (const e of events) if (e.storeMismatch) warnings.push(`${e.name} — 캘린더와 ERP(${e.erpId})의 매장이 다릅니다.`);

  const snap = await ref(db).get();
  const d = (snap.data() ?? {}) as AlertDoc;
  const sent = { ...(d.sent ?? {}) };
  const due = events.map((e) => ({ e, key: alertKey(e, today) })).filter((x): x is { e: OrderEvent; key: string } => !!x.key && !sent[x.key]);
  const alerts: OrderAlertResult["alerts"] = due.map(({ e, key }) => ({ key, text: orderAlertText(e, today) }));

  if (args.dryRun) return { events: events.length, alerts, warnings };
  if (!moneyToken()) return { skipped: "노션 연결 토큰(NOTION_MONEY_TOKEN)이 없습니다.", events: events.length, alerts, warnings };

  // ② 표 맞추기
  const table = await ensureTable(db, d);
  const have = await liveRows(table.dataSourceId);
  const pageOf = new Map<string, string>();
  const rows = { created: 0, updated: 0, retired: 0 };
  for (const e of events) {
    const cur = have.get(e.key);
    if (!cur) {
      const page = await moneyCall<any>("POST", "/pages", { parent: { type: "data_source_id", data_source_id: table.dataSourceId }, properties: propsOf(e, today) });
      pageOf.set(e.key, page.id);
      rows.created += 1;
    } else {
      pageOf.set(e.key, cur.id);
      if (cur.print !== wantPrint(e, today)) {
        await moneyCall("PATCH", `/pages/${cur.id}`, { properties: propsOf(e, today) });
        rows.updated += 1;
      }
    }
  }
  // 범위를 벗어난 줄(끝났거나 캘린더에서 지워진 이벤트) — 「지남」
  const keep = new Set(events.map((e) => e.key));
  for (const [key, cur] of have) {
    if (keep.has(key)) continue;
    await moneyCall("PATCH", `/pages/${cur.id}`, { properties: { 상태: { select: { name: "지남" } } } });
    rows.retired += 1;
  }

  // ③ 알림
  if (due.length) {
    const ids = await userIdsOf(db, d);
    if (!ids.length) {
      warnings.push("알림 받을 노션 계정이 없어 알림을 보내지 못했습니다.");
    } else {
      for (const a of alerts) {
        const item = due.find((x) => x.key === a.key)!;
        const pageId = pageOf.get(item.e.key);
        if (!pageId) continue;
        try {
          a.mode = await notifyMention(pageId, ids, a.text, { label: item.e.erpId ? "ERP 에서 발주일 적기" : "ERP 에 이벤트 만들기", url: orderEventUrl(item.e) }, ORDER_ALERT_HEADLINE);
          sent[a.key] = { at: Date.now(), mode: a.mode };
        } catch (err) {
          warnings.push(`${item.e.name} 알림 실패: ${err instanceof Error ? err.message.slice(0, 200) : String(err)}`);
        }
      }
    }
  }
  // 오래된 기록은 지운다 — 120일 넘은 것
  const cutoff = Date.now() - 120 * 86_400_000;
  for (const k of Object.keys(sent)) if ((sent[k]?.at ?? 0) < cutoff) delete sent[k];
  await ref(db).set({ sent, last: { at: Date.now(), today, events: events.length, rows, alerts: alerts.length, warnings: warnings.slice(0, 10) } }, { merge: true });
  return { events: events.length, rows, alerts, warnings };
}
