// 결제 알림 메일 → 카드 거래 메모 — 서버 쪽 (finance/pay-mail.ts)
//
//  메일 본문은 ERP 메일함(neander_mail_accounts/{계정}/inbox)에 압축돼 있다.
//  훑는 메일함은 **회사 메일**뿐이다 — 카페24(회사 도메인) 계정과 팀 공용 계정.
//  개인이 붙여 둔 네이버 · Gmail 은 보지 않는다.
//  거래에 남기는 것은 상점 · 품목 한 줄(cardMemo)과 메일 열쇠(cardChatId = `mail:…`)뿐이다.

import { gunzipSync } from "zlib";
import type { Firestore } from "firebase-admin/firestore";
import { NEANDER_COL } from "@/lib/neander/collections";
import { dedupeReads, htmlToText, matchPayMails, parsePayMail, type PayMailMatch, type PayMailRead } from "../pay-mail";
import { engineSigOf, isEngineOwned } from "../relearn";
import type { FinTransaction } from "../types";
import type { FinPaymentMethodDoc } from "../db-types";
import { readForLog, writeLog } from "./tx-log";

/** 결제 알림을 보내는 곳 — 이 주소에서 온 메일만 연다 */
const SENDERS = /(kcp\.co\.kr|tosspayments\.com|easypay\.co\.kr|hecto\.co\.kr|coupang\.com|stripe\.com|openrouter\.ai)$/i;

const bodyText = (body: unknown): string => {
  if (!body) return "";
  try {
    const buf = Buffer.isBuffer(body) ? body : Buffer.from((body as { toUint8Array?: () => Uint8Array }).toUint8Array?.() ?? (body as Uint8Array));
    const { html, text } = JSON.parse(gunzipSync(buf).toString("utf8")) as { html?: string; text?: string };
    return text && text.trim() ? text : html ? htmlToText(html) : "";
  } catch {
    return "";
  }
};

/** 최근 `days` 일 동안 회사 메일함에 온 결제 알림을 읽는다 */
export async function scanPayMails(db: Firestore, days = 60): Promise<PayMailRead[]> {
  const since = Date.now() - days * 86_400_000;
  const accounts = await db.collection(NEANDER_COL.mailAccounts).get();
  const reads: PayMailRead[] = [];
  for (const acc of accounts.docs) {
    const a = acc.data() as { team?: boolean; provider?: string };
    // 회사 메일만 — 카페24(회사 도메인) · 팀 공용. 개인 네이버 · Gmail 은 보지 않는다
    if (!a.team && a.provider && a.provider !== "cafe24") continue;
    const snap = await acc.ref.collection("inbox").where("date", ">=", since).get();
    snap.docs.forEach((d) => {
      const m = d.data() as { from?: { address?: string; name?: string }; subject?: string; snippet?: string; body?: unknown; date?: number };
      const address = (m.from?.address ?? "").toLowerCase();
      if (!SENDERS.test(address.split("@")[1] ?? "")) return;
      const read = parsePayMail({
        id: `${acc.id}/${d.id}`,
        fromAddress: address,
        fromName: m.from?.name,
        subject: m.subject ?? "",
        text: bodyText(m.body) || m.snippet || "",
        date: m.date ?? 0,
      });
      if (read) reads.push(read);
    });
  }
  return dedupeReads(reads);
}

export interface PayMailResult {
  reads: number;
  matches: PayMailMatch[];
  attached: number;
}

/**
 * 읽은 알림을 카드 거래에 붙인다. `dryRun` 이면 붙이지 않고 무엇이 붙을지만 돌려준다.
 * 자동분류가 붙인 채 아무도 안 고친 거래는 지문을 같이 남겨 계속 배울 수 있게 한다 (card-chat.ts 와 같다).
 */
export async function attachPayMails(db: Firestore, by: string, opts: { days?: number; dryRun?: boolean } = {}): Promise<PayMailResult> {
  const days = opts.days ?? 60;
  const reads = await scanPayMails(db, days);
  if (reads.length === 0) return { reads: 0, matches: [], attached: 0 };
  const from = new Date(Date.now() - (days + 3) * 86_400_000).toISOString().slice(0, 10);
  const [txSnap, pmSnap] = await Promise.all([
    db.collection(NEANDER_COL.finTransactions).where("date", ">=", from).get(),
    db.collection(NEANDER_COL.finPaymentMethods).get(),
  ]);
  const transactions = txSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as FinTransaction);
  const paymentMethods = pmSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as FinPaymentMethodDoc);
  const matches = matchPayMails(reads, transactions, paymentMethods);
  if (opts.dryRun || matches.length === 0) return { reads: reads.length, matches, attached: 0 };

  const byId = new Map(transactions.map((t) => [t.id, t]));
  const before = await readForLog(db, matches.map((m) => m.txId));
  const now = Date.now();
  const col = db.collection(NEANDER_COL.finTransactions);
  const patches = matches.map((m) => {
    const t = byId.get(m.txId)!;
    return {
      id: m.txId,
      data: {
        cardMemo: m.memo,
        cardChatId: `mail:${m.read.mailId}`,
        ...(isEngineOwned(t) ? { engineSig: engineSigOf(t) } : {}),
        updatedAt: now,
        updatedBy: by,
      },
    };
  });
  for (let i = 0; i < patches.length; i += 400) {
    const batch = db.batch();
    patches.slice(i, i + 400).forEach((p) => batch.set(col.doc(p.id), p.data, { merge: true }));
    await batch.commit();
  }
  await writeLog(db, by, "mail", patches.map((p) => ({ txId: p.id, kind: "edit" as const, before: before.get(p.id), after: p.data })));
  return { reads: reads.length, matches, attached: patches.length };
}
