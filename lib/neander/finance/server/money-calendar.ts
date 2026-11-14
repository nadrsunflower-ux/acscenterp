// ============================================================
//  돈 나가는 날 → 노션 표 + 노션 알림 (서버 전용)
// ------------------------------------------------------------
//  재무 매일 아침 점검(api/neander/finance/cron, 06:00 KST)이 부른다.
//    ① 설정(neander_fin_settings/money-calendar)의 규칙으로 앞으로 45일 · 지난 40일
//       회차를 펼친다 (money-calendar.ts — 휴일 밀림 · 장부의 지난 금액 · 냈음)
//    ② 노션 「돈 나가는 날」 표를 맞춘다 — 없으면 설정의 페이지 아래에 처음 한 번 만든다.
//       줄마다 「열쇠」(규칙 ¦ 정해진 날)로 찾아, 바뀐 줄만 고친다
//    ③ 납부 N일 전 · 당일(leadDays)이면 그 줄에 받는 사람을 @멘션한 댓글을 단다.
//       노션 API 로는 날짜 알림(리마인더)을 걸 수 없어서, 멘션 댓글이 노션 받은편지함
//       알림이 된다. 연결에 「댓글 쓰기」 권한이 없으면(403) 줄 본문에 멘션 문단을 붙인다.
//       보낸 것은 money-calendar-sent 에 적어 같은 알림을 두 번 보내지 않는다
//
//    ④ 세금 고지서(neander_fin_tax_notices — 전자고지 알림 · 메일 · 사람이 넣은 것)도 납기 하루짜리
//       줄로 같이 넣는다 (tax-notice.ts noticeRule). 납기가 바뀌었거나 무시한 고지서의 옛 줄은 휴지통으로
//
//  노션 연결은 이 일 전용이다 (NOTION_MONEY_TOKEN). 회의 보관 연결과 토큰을 나눈다 — 재무
//  금액이 담긴 페이지에만 붙이고, 댓글 쓰기 권한도 여기에만 켠다. 표를 둘 페이지에 연결을
//  붙여야 보인다.
// ============================================================

/* eslint-disable @typescript-eslint/no-explicit-any */

import type { Firestore } from "firebase-admin/firestore";
import { NEANDER_COL } from "@/lib/neander/collections";
import { NotionArchiveError, parseNotionPageId } from "@/lib/neander/notion/archive-client";
import { NOTION_VERSION } from "@/lib/neander/notion/client";
import {
  addDays,
  alertText,
  buildMoneyRows,
  dueAlerts,
  holidayYears,
  MONEY_KINDS,
  sanitizeMoneySettings,
  type MoneyCalendarSettings,
  type MoneyRow,
} from "../money-calendar";
import type { FinTransaction } from "../types";
import { noticeRule, type TaxNotice } from "../tax-notice";

const SETTINGS_DOC = "money-calendar";
const SENT_DOC = "money-calendar-sent";
const AHEAD_DAYS = 45;
const BEHIND_DAYS = 40;
const DB_TITLE = "돈 나가는 날";

type RowState = "예정" | "냈음" | "지남";

export interface MoneySyncResult {
  skipped?: string;
  rows?: number;
  created?: number;
  updated?: number;
  alerts?: { key: string; mode: "comment" | "block" }[];
  warnings?: string[];
}

/** ERP 고지서 화면 (app/neander/tax/[id]) — 고지서 줄의 알림 끝 링크. 주소는 sms-notify 의 ERP_ORIGIN 과 같다 */
const ERP_BASE = (process.env.NEANDER_PUBLIC_ORIGIN ?? "").trim().replace(/\/+$/, "") || "https://neander-erp.vercel.app";
export const taxNoticeUrl = (id: string) => `${ERP_BASE}/neander/tax/${encodeURIComponent(id)}`;

export const moneyToken = () => process.env.NOTION_MONEY_TOKEN?.trim() ?? "";

/** 이 연결로 보내는 노션 요청 — 요청 한도(429) · 과부하(529)는 쉬었다 다시 (입출금 · 카드 알림도 쓴다) */
export async function moneyCall<T = any>(method: "GET" | "POST" | "PATCH", path: string, body?: unknown): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`https://api.notion.com/v1${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${moneyToken()}`,
        "Notion-Version": NOTION_VERSION,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30_000),
    });
    if ((res.status === 429 || res.status === 529) && attempt < 3) {
      const wait = Math.min(30, Number(res.headers.get("retry-after")) || 2);
      await new Promise((r) => setTimeout(r, wait * 1000));
      continue;
    }
    const raw = (await res.json().catch(() => null)) as any;
    if (!res.ok) throw new NotionArchiveError(res.status, raw?.message ?? `노션 요청이 실패했습니다 (HTTP ${res.status})`);
    return raw as T;
  }
}

export const text = (s: string) => [{ type: "text", text: { content: s.slice(0, 1900) } }];
export const plain = (rt: any[] | undefined) => (rt ?? []).map((t: any) => t?.plain_text ?? "").join("");

/** 지났는데 장부에 출금이 없으면 「지남」 — 아직 그 달 내역을 안 올렸을 수도 있다 */
const stateOf = (row: MoneyRow, today: string): RowState => (row.state === "냈음" ? "냈음" : row.date < today ? "지남" : "예정");

export function propsOf(row: MoneyRow, today: string) {
  return {
    이름: { title: text(row.rule.label) },
    날짜: { date: { start: row.date } },
    종류: { select: { name: row.rule.kind } },
    상태: { select: { name: stateOf(row, today) } },
    금액: { number: row.amount },
    통장: { rich_text: text(row.rule.account ?? "") },
    근거: { rich_text: text(row.basis) },
    열쇠: { rich_text: text(row.key) },
  };
}

/** 노션에 있는 줄과 견줄 값 — 같으면 고치지 않는다 (노션 요청 아끼기) */
export const fingerprint = (p: Record<string, any>) =>
  JSON.stringify([
    plain(p.이름?.title),
    p.날짜?.date?.start ?? null,
    p.종류?.select?.name ?? null,
    p.상태?.select?.name ?? null,
    p.금액?.number ?? null,
    plain(p.통장?.rich_text),
    plain(p.근거?.rich_text),
  ]);
export const wantPrint = (row: MoneyRow, today: string) =>
  JSON.stringify([row.rule.label, row.date, row.rule.kind, stateOf(row, today), row.amount, row.rule.account ?? "", row.basis]);

/** 표가 없으면 만든다 — 설정의 페이지 아래, 처음 한 번 */
export async function ensureDataSource(db: Firestore, s: MoneyCalendarSettings): Promise<string> {
  if (s.dataSourceId) return s.dataSourceId;
  const parent = parseNotionPageId(s.notionPage ?? "");
  if (!parent) throw new NotionArchiveError(0, "설정의 노션 페이지가 주소나 id 가 아닙니다.");
  const created = await moneyCall<any>("POST", "/databases", {
    parent: { type: "page_id", page_id: parent },
    title: text(DB_TITLE),
    icon: { type: "emoji", emoji: "💸" },
    initial_data_source: {
      properties: {
        이름: { title: {} },
        날짜: { date: {} },
        종류: { select: { options: MONEY_KINDS.map((name) => ({ name })) } },
        상태: {
          select: {
            options: [
              { name: "예정", color: "yellow" },
              { name: "냈음", color: "green" },
              { name: "지남", color: "gray" },
            ],
          },
        },
        금액: { number: { format: "won" } },
        통장: { rich_text: {} },
        근거: { rich_text: {} },
        열쇠: { rich_text: {} },
      },
    },
  });
  const dataSourceId: string | undefined = created?.data_sources?.[0]?.id;
  if (!dataSourceId) throw new NotionArchiveError(0, "노션이 표를 만들었지만 데이터 소스 id 를 돌려주지 않았습니다.");
  await db
    .collection(NEANDER_COL.finSettings)
    .doc(SETTINGS_DOC)
    .set({ databaseId: created.id, dataSourceId, databaseUrl: created.url ?? null, createdAt: Date.now() }, { merge: true });
  return dataSourceId;
}

/** 고지서 → 규칙 (무시한 것 빼고). 표 범위 밖의 것도 돌려준다 — 옛 줄 치우기에 쓴다 */
export async function taxNoticeRules(db: Firestore) {
  const snap = await db.collection(NEANDER_COL.finTaxNotices).where("state", "in", ["open", "paid"]).get();
  return snap.docs
    .map((d) => {
      const r = noticeRule({ ...(d.data() as TaxNotice), id: d.id });
      return r ? { ...r, noticeId: d.id } : null;
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);
}

/** 표의 줄 전부 — 열쇠 → { 페이지 id, 지금 값 } */
async function existingRows(dataSourceId: string) {
  const out = new Map<string, { id: string; print: string }>();
  let cursor: string | undefined;
  do {
    const res = await moneyCall<any>("POST", `/data_sources/${dataSourceId}/query`, {
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    });
    for (const page of res.results ?? []) {
      const key = plain(page.properties?.열쇠?.rich_text);
      if (key && !page.in_trash) out.set(key, { id: page.id, print: fingerprint(page.properties ?? {}) });
    }
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
  return out;
}

/** 받는 사람 메일 → 노션 사용자 id (byEmail 열쇠는 소문자 메일) */
export async function recipientIds(
  emails: string[],
): Promise<{ ids: string[]; missing: string[]; byEmail: Record<string, string> }> {
  const want = new Set(emails.map((e) => e.toLowerCase()));
  const found = new Map<string, string>();
  let cursor: string | undefined;
  do {
    const res = await moneyCall<any>("GET", `/users?page_size=100${cursor ? `&start_cursor=${cursor}` : ""}`);
    for (const u of res.results ?? []) {
      const email = (u?.person?.email ?? "").toLowerCase();
      if (email && want.has(email)) found.set(email, u.id);
    }
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
  return { ids: [...found.values()], missing: [...want].filter((e) => !found.has(e)), byEmail: Object.fromEntries(found) };
}

/** 멘션 알림 — 댓글이 안 되면(권한 없음) 본문에 멘션 문단 */
export async function notifyMention(
  pageId: string,
  userIds: string[],
  message: string,
  link?: { label: string; url: string },
): Promise<"comment" | "block"> {
  // 멘션은 끝에 — 폰 알림 미리보기가 받는 사람 이름이 아니라 내용부터 보이게
  const rich = [
    ...text(message),
    ...(link ? [{ type: "text", text: { content: " " } }, { type: "text", text: { content: link.label, link: { url: link.url } } }] : []),
    ...userIds.flatMap((id) => [
      { type: "text", text: { content: " " } },
      { type: "mention", mention: { type: "user", user: { id } } },
    ]),
  ];
  try {
    await moneyCall("POST", "/comments", { parent: { page_id: pageId }, rich_text: rich });
    return "comment";
  } catch (e) {
    if (!(e instanceof NotionArchiveError) || e.status !== 403) throw e;
    await moneyCall("PATCH", `/blocks/${pageId}/children`, { children: [{ object: "block", type: "paragraph", paragraph: { rich_text: rich } }] });
    return "block";
  }
}

/** 하루 한 번 — 표 맞추기 + 오늘 보낼 알림 */
export async function syncMoneyCalendar(
  db: Firestore,
  args: { transactions: FinTransaction[]; today: string; dryRun?: boolean },
): Promise<MoneySyncResult> {
  const settingsRef = db.collection(NEANDER_COL.finSettings).doc(SETTINGS_DOC);
  const snap = await settingsRef.get();
  if (!snap.exists) return { skipped: "돈 나가는 날 설정이 아직 없습니다." };
  const s = sanitizeMoneySettings(snap.data());
  const notices = await taxNoticeRules(db);
  if (!s.rules.length && !notices.length) return { skipped: "규칙이 없습니다." };

  const { today } = args;
  const warnings: string[] = [];
  const horizon = addDays(today, AHEAD_DAYS);
  if (!holidayYears().includes(Number(horizon.slice(0, 4)))) {
    warnings.push(`${horizon.slice(0, 4)}년 공휴일이 표에 없습니다 — 주말만 거릅니다 (money-calendar.ts HOLIDAYS).`);
  }
  const rows = buildMoneyRows([...s.rules, ...notices], args.transactions, addDays(today, -BEHIND_DAYS), horizon);
  if (args.dryRun) return { rows: rows.length, warnings };
  if (!moneyToken()) return { skipped: "노션 연결 토큰(NOTION_MONEY_TOKEN)이 없습니다.", rows: rows.length };
  if (!s.notionPage && !s.dataSourceId) return { skipped: "노션 페이지가 아직 정해지지 않았습니다.", rows: rows.length };

  // ② 표 맞추기
  const dataSourceId = await ensureDataSource(db, s);
  const have = await existingRows(dataSourceId);
  const pageOf = new Map<string, string>();
  let created = 0;
  let updated = 0;
  for (const row of rows) {
    const cur = have.get(row.key);
    if (!cur) {
      const page = await moneyCall<any>("POST", "/pages", {
        parent: { type: "data_source_id", data_source_id: dataSourceId },
        properties: propsOf(row, today),
      });
      pageOf.set(row.key, page.id);
      created += 1;
    } else {
      pageOf.set(row.key, cur.id);
      if (cur.print !== wantPrint(row, today)) {
        await moneyCall("PATCH", `/pages/${cur.id}`, { properties: propsOf(row, today) });
        updated += 1;
      }
    }
  }

  // ②′ 고지서 옛 줄 — 납기가 바뀌었거나(열쇠가 달라짐) 무시 · 삭제한 고지서의 줄은 휴지통으로
  const noticeKey = new Map(notices.map((r) => [r.id, `${r.id}¦${r.once}`]));
  const noticeIdOf = new Map(notices.map((r) => [r.id, r.noticeId ?? ""]));
  let trashed = 0;
  for (const [key, cur] of have) {
    if (!key.startsWith("tax-")) continue;
    const ruleId = key.split("¦")[0];
    if (noticeKey.get(ruleId) === key) continue;
    await moneyCall("PATCH", `/pages/${cur.id}`, { in_trash: true });
    trashed += 1;
  }
  if (trashed) warnings.push(`고지서 옛 줄 ${trashed}개를 치웠습니다.`);

  // ③ 알림
  const alerts: MoneySyncResult["alerts"] = [];
  const due = dueAlerts(rows, today, s.leadDays);
  if (due.length) {
    const sentRef = db.collection(NEANDER_COL.finSettings).doc(SENT_DOC);
    const sent = ((await sentRef.get()).data()?.sent ?? {}) as Record<string, { at: number; mode: string }>;
    const todo = due.filter((d) => !sent[d.sentKey]);
    if (todo.length) {
      const { ids, missing } = await recipientIds(s.recipients);
      if (missing.length) warnings.push(`노션에서 찾지 못한 받는 사람: ${missing.length}명`);
      if (!ids.length) {
        warnings.push("알림 받을 노션 계정이 없어 알림을 보내지 못했습니다.");
      } else {
        for (const d of todo) {
          const pageId = pageOf.get(d.row.key);
          if (!pageId) continue;
          const taxId = d.row.rule.id.startsWith("tax-") ? noticeIdOf.get(d.row.rule.id) : undefined;
          const mode = await notifyMention(pageId, ids, alertText(d.row, d.lead), taxId ? { label: "ERP 에서 보기", url: taxNoticeUrl(taxId) } : undefined);
          sent[d.sentKey] = { at: Date.now(), mode };
          alerts.push({ key: d.sentKey, mode });
        }
        // 오래된 기록은 지운다 — 열쇠의 정해진 날이 120일 넘게 지난 것
        const cutoff = addDays(today, -120);
        for (const k of Object.keys(sent)) if ((k.split("¦")[1] ?? "") < cutoff) delete sent[k];
        await sentRef.set({ sent, at: Date.now() });
      }
    }
  }
  return { rows: rows.length, created, updated, alerts, warnings };
}
