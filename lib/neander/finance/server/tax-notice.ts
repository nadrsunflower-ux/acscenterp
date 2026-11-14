// ============================================================
//  세금 고지서 — 받기 · 저장 · 노션 「돈 나가는 날」 줄 + 도착 알림 (서버 전용)
// ------------------------------------------------------------
//  들어오는 길 (읽기는 finance/tax-notice.ts):
//    · api/neander/finance/sms — 전용폰이 보낸 문자 · 앱 알림 가운데 은행 문자가 아닌 것 → ingestTaxText
//    · api/neander/finance/cron — 회사 메일함의 고지서 메일(scanTaxMails) · 도착 알림 못 보낸 것 다시
//    · api/neander/finance/tax-notices — 사람이 넣고 고친다
//
//  새 고지서가 들어오면 그 자리에서 「돈 나가는 날」 표에 납기 줄을 만들고 받는 사람을 멘션한다
//  (「고지서 도착 · 790,130원 · 납기 11/27(금)」). 3일 전 · 당일 알림은 매일 아침 점검이 보낸다.
//  같은 알림이 두 번 와도(문자 + 카톡, 매크로 재전송) 한 장이다 — 문서 id 를 출처 열쇠 해시로 둔다.
//  출처가 달라도 세목 · 금액 · 납기 · 사업자가 같으면 같은 고지서로 본다(findSame).
// ============================================================

/* eslint-disable @typescript-eslint/no-explicit-any */

import { createHash, randomBytes } from "crypto";
import { gunzipSync } from "zlib";
import type { Firestore } from "firebase-admin/firestore";
import { NEANDER_COL } from "@/lib/neander/collections";
import { addDays, buildMoneyRows, sanitizeMoneySettings } from "../money-calendar";
import { arrivalText, noticeRule, readTaxNotice, type TaxNotice, type TaxNoticeInput, type TaxNoticeSource } from "../tax-notice";
import { htmlToText } from "../pay-mail";
import type { FinTransaction } from "../types";
import { ensureDataSource, fingerprint, moneyCall, moneyToken, notifyMention, plain, propsOf, recipientIds, taxNoticeUrl, wantPrint } from "./money-calendar";

const col = (db: Firestore) => db.collection(NEANDER_COL.finTaxNotices);
const kstToday = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
const kstDate = (ms: number) => new Date(ms + 9 * 3600_000).toISOString().slice(0, 10);
const clean = <T extends Record<string, unknown>>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;

export { taxNoticeUrl };

/** 출처 열쇠 → 문서 id (같은 알림 = 같은 문서) */
const idOf = (sourceId?: string) =>
  sourceId ? createHash("sha256").update(sourceId, "utf8").digest("hex").slice(0, 20) : randomBytes(10).toString("hex");

/** 출처는 달라도 같은 고지서 — 세목 · 금액 · 납기 · 사업자가 다 같다 (문자와 카톡이 같이 올 때) */
async function findSame(db: Firestore, n: TaxNoticeInput): Promise<string | null> {
  if (!n.amount || !n.dueDate) return null;
  const snap = await col(db).where("amount", "==", n.amount).get();
  const hit = snap.docs.find((d) => {
    const x = d.data() as TaxNotice;
    return x.dueDate === n.dueDate && (x.item ?? "") === (n.item ?? "") && (!x.site || !n.site || x.site === n.site);
  });
  return hit?.id ?? null;
}

/** 고지서 한 장 저장. 이미 있으면 빈 칸만 채운다 (created: false) */
export async function saveTaxNotice(db: Firestore, n: TaxNoticeInput): Promise<{ id: string; created: boolean }> {
  const now = Date.now();
  let id = idOf(n.sourceId);
  if (!(await col(db).doc(id).get()).exists) id = (await findSame(db, n)) ?? id;
  const ref = col(db).doc(id);
  return db.runTransaction(async (tx) => {
    const cur = await tx.get(ref);
    if (cur.exists) {
      const x = cur.data() as TaxNotice;
      const fill = clean({
        level: x.level ? undefined : n.level,
        item: x.item ? undefined : n.item,
        site: x.site ? undefined : n.site,
        payer: x.payer ? undefined : n.payer,
        amount: x.amount ? undefined : n.amount,
        dueDate: x.dueDate ? undefined : n.dueDate,
        period: x.period ? undefined : n.period,
        payNo: x.payNo ? undefined : n.payNo,
        office: x.office ? undefined : n.office,
      });
      if (Object.keys(fill).length) tx.update(ref, { ...fill, updatedAt: now });
      return { id, created: false };
    }
    const doc: Omit<TaxNotice, "id"> = clean({ ...n, state: n.state ?? "open", createdAt: now, raw: n.raw?.slice(0, 1500) }) as Omit<TaxNotice, "id">;
    tx.set(ref, doc);
    return { id, created: true };
  });
}

export interface TaxIngestResult {
  kind: "notice" | "paid" | null;
  id?: string;
  created?: boolean;
  /** 낸 뒤 알림으로 「냈음」 이 된 고지서 */
  settled?: string;
  announce?: AnnounceResult;
}

/**
 * 알림 글 한 통 → 고지서. 세금 알림이 아니면 { kind: null }.
 * 낸 뒤 알림(「정상납부」)이면 금액이 같은 열린 고지서를 냈음으로 바꾼다.
 */
export async function ingestTaxText(
  db: Firestore,
  input: { text: string; from?: string; subject?: string; receivedAt?: number; source: TaxNoticeSource; sourceId: string; announce?: boolean },
): Promise<TaxIngestResult> {
  const receivedAt = input.receivedAt && input.receivedAt > 0 ? input.receivedAt : Date.now();
  const read = readTaxNotice({ text: input.text, from: input.from, subject: input.subject, receivedAt });
  if (!read) return { kind: null };
  if (read.kind === "paid") {
    if (!read.amount) return { kind: "paid" };
    const snap = await col(db).where("amount", "==", read.amount).where("state", "==", "open").get();
    const hit = snap.docs.find((d) => !read.site || !(d.data() as TaxNotice).site || (d.data() as TaxNotice).site === read.site);
    if (!hit) return { kind: "paid" };
    await hit.ref.update({ state: "paid", paidDate: kstDate(receivedAt), updatedAt: Date.now(), updatedBy: `${input.source}:납부 알림` });
    const announce = await announceTaxNotice(db, hit.id, { mention: false });
    return { kind: "paid", settled: hit.id, announce };
  }
  const { kind: _k, tags, ...fields } = read;
  const saved = await saveTaxNotice(db, {
    ...fields,
    ...(tags.length ? { tags } : {}),
    source: input.source,
    sourceId: input.sourceId,
    ...(input.from ? { from: input.from.slice(0, 80) } : {}),
    raw: [input.subject, input.text].filter(Boolean).join("\n"),
    receivedAt,
  });
  const announce = saved.created && input.announce !== false ? await announceTaxNotice(db, saved.id, { mention: true }) : undefined;
  return { kind: "notice", ...saved, ...(announce ? { announce } : {}) };
}

// ---- 노션 줄 · 도착 알림 -----------------------------------------------------

export interface AnnounceResult {
  skipped?: string;
  row?: "created" | "updated" | "same";
  trashed?: number;
  mention?: "comment" | "block";
  error?: string;
}

/**
 * 고지서 한 장의 「돈 나가는 날」 줄을 맞춘다 (없으면 만들고, 납기가 바뀌었으면 옛 줄을 치운다).
 * mention 이면 처음 한 번 도착 알림 — 실패하면 announced 가 비어 아침 점검이 다시 보낸다.
 */
export async function announceTaxNotice(db: Firestore, id: string, opts: { mention: boolean }): Promise<AnnounceResult> {
  try {
    const snap = await col(db).doc(id).get();
    if (!snap.exists) return { skipped: "고지서가 없습니다." };
    const n = { ...(snap.data() as TaxNotice), id: snap.id };
    if (!moneyToken()) return { skipped: "노션 연결 토큰(NOTION_MONEY_TOKEN)이 없습니다." };
    const sSnap = await db.collection(NEANDER_COL.finSettings).doc("money-calendar").get();
    if (!sSnap.exists) return { skipped: "돈 나가는 날 설정이 없습니다." };
    const s = sanitizeMoneySettings(sSnap.data());
    if (!s.notionPage && !s.dataSourceId) return { skipped: "노션 페이지가 정해지지 않았습니다." };
    const dataSourceId = await ensureDataSource(db, s);

    const rule = noticeRule(n);
    const ruleId = `tax-${n.id.toLowerCase().replace(/[^a-z0-9-]/g, "")}`;
    const res = await moneyCall<any>("POST", `/data_sources/${dataSourceId}/query`, {
      page_size: 20,
      filter: { property: "열쇠", rich_text: { starts_with: `${ruleId}¦` } },
    });
    const pages: { id: string; key: string; props: any }[] = (res.results ?? [])
      .filter((p: any) => !p.in_trash)
      .map((p: any) => ({ id: p.id, key: plain(p.properties?.열쇠?.rich_text), props: p.properties ?? {} }));

    const out: AnnounceResult = {};
    let pageId: string | undefined;
    if (rule) {
      // 낸 기록 — 받은 날부터 납기 뒤 7일까지의 출금만 읽는다
      const from = addDays(kstDate(n.receivedAt), -3);
      const to = addDays(rule.once!, 10);
      const txSnap = await db.collection(NEANDER_COL.finTransactions).where("date", ">=", from).where("date", "<=", to).get();
      const txs = txSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as FinTransaction);
      const today = kstToday();
      const row = buildMoneyRows([rule], txs, rule.once!, addDays(rule.once!, 15))[0];
      if (row) {
        const cur = pages.find((p) => p.key === row.key);
        if (!cur) {
          const page = await moneyCall<any>("POST", "/pages", {
            parent: { type: "data_source_id", data_source_id: dataSourceId },
            properties: propsOf(row, today),
          });
          pageId = page.id;
          out.row = "created";
        } else {
          pageId = cur.id;
          const same = fingerprint(cur.props) === wantPrint(row, today);
          if (!same) await moneyCall("PATCH", `/pages/${cur.id}`, { properties: propsOf(row, today) });
          out.row = same ? "same" : "updated";
        }
      }
    }
    // 옛 줄 (납기가 바뀜 · 무시함)
    const keep = rule ? `${rule.id}¦${rule.once}` : null;
    const old = pages.filter((p) => p.key !== keep);
    for (const p of old) await moneyCall("PATCH", `/pages/${p.id}`, { in_trash: true });
    if (old.length) out.trashed = old.length;

    if (opts.mention && pageId && !n.announced && n.state === "open") {
      const { ids } = await recipientIds(s.recipients);
      if (ids.length) {
        const mode = await notifyMention(pageId, ids, arrivalText(n), { label: "ERP 에서 보기", url: taxNoticeUrl(n.id) });
        await snap.ref.update({ announced: { at: Date.now(), mode } });
        out.mention = mode;
      } else {
        out.skipped = "알림 받을 노션 계정이 없습니다.";
      }
    }
    return out;
  } catch (e) {
    console.error("[finance/tax-notice] 노션", e);
    return { error: e instanceof Error ? e.message : "알 수 없는 오류" };
  }
}

/** 도착 알림을 못 보낸 고지서(노션 실패) — 받은 지 열흘 안, 열린 것만 다시 */
export async function retryAnnouncements(db: Firestore): Promise<number> {
  const since = Date.now() - 10 * 86_400_000;
  const snap = await col(db).where("receivedAt", ">=", since).get();
  let sent = 0;
  for (const d of snap.docs) {
    const n = d.data() as TaxNotice;
    if (n.announced || n.state !== "open" || n.source === "manual") continue;
    const r = await announceTaxNotice(db, d.id, { mention: true });
    if (r.mention) sent += 1;
  }
  return sent;
}

// ---- 메일 -----------------------------------------------------

/** 고지서 메일을 보내는 곳 — 정부 · 지자체(go.kr) · 금융결제원 */
const TAX_SENDERS = /(\.go\.kr|kftc\.or\.kr|giro\.or\.kr)$/i;

const bodyText = (body: unknown): string => {
  if (!body) return "";
  try {
    const buf = Buffer.isBuffer(body) ? body : Buffer.from((body as { toUint8Array?: () => Uint8Array }).toUint8Array?.() ?? (body as Uint8Array));
    const { html, text: t } = JSON.parse(gunzipSync(buf).toString("utf8")) as { html?: string; text?: string };
    return t && t.trim() ? t : html ? htmlToText(html) : "";
  } catch {
    return "";
  }
};

/**
 * 회사 메일함(카페24 · 팀 공용 — pay-mail 과 같은 범위)에서 최근 `days` 일의 고지서 메일을 읽어 넣는다.
 * 메일함은 누군가 ERP 메일 화면을 열 때 채워진다 — 그래서 매일 아침 점검이 훑는다.
 */
export async function scanTaxMails(db: Firestore, days = 14): Promise<{ read: number; created: number; settled: number }> {
  const since = Date.now() - days * 86_400_000;
  const accounts = await db.collection(NEANDER_COL.mailAccounts).get();
  let read = 0;
  let created = 0;
  let settled = 0;
  for (const acc of accounts.docs) {
    const a = acc.data() as { team?: boolean; provider?: string };
    if (!a.team && a.provider && a.provider !== "cafe24") continue;
    const snap = await acc.ref.collection("inbox").where("date", ">=", since).get();
    for (const d of snap.docs) {
      const m = d.data() as { from?: { address?: string; name?: string }; subject?: string; snippet?: string; body?: unknown; date?: number };
      const address = (m.from?.address ?? "").toLowerCase();
      if (!TAX_SENDERS.test(address.split("@")[1] ?? "")) continue;
      read += 1;
      const r = await ingestTaxText(db, {
        text: bodyText(m.body) || m.snippet || "",
        subject: m.subject,
        from: `${m.from?.name ?? ""} <${address}>`,
        receivedAt: m.date,
        source: "mail",
        sourceId: `mail:${acc.id}/${d.id}`,
      });
      if (r.created) created += 1;
      if (r.settled) settled += 1;
    }
  }
  return { read, created, settled };
}
