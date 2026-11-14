import { NextResponse } from "next/server";
import { adminDb } from "@/lib/neander/server/admin";
import { requireErpUser, accessErrorResponse } from "@/lib/neander/server/auth";
import { NEANDER_COL } from "@/lib/neander/collections";
import { sanitizeCashCheck, smsToCardTx, smsToTx, type CardTx, type CashCheck, type SmsTx } from "@/lib/neander/finance/daily-cash";
import { BANK_SMS_PARSER, matchCardLast4, parseBankSms } from "@/lib/neander/finance/bank-sms";

// ============================================================
//  자금 일보 — 받은 은행 문자를 거래 줄로 (화면: /neander/finance/daily)
// ------------------------------------------------------------
//  GET ?from=&to= — 그날까지의 통장 거래 줄(기간 앞은 통장마다 마지막 한 줄 — 기초 잔액용)과
//  카드 승인 · 취소 줄(기간 첫날이 든 달의 1일부터 — 법인카드 요약의 「전일까지 사용」용),
//  처음 받은 카드 문자의 날, ERP 의 통장 · 카드 목록, 문자 통지를 신청한 통장 · 카드 목록
//  (neander_fin_settings/sms-feed 의 linkedAccounts · linkedCards)을 준다.
//  계산은 화면이 daily-cash.ts 로 한다 — 문자가 안 오는 것은 화면이 장부(월 엑셀)로 센다.
//  받은 문자함은 보안 규칙에 없어 이 문으로만 읽는다 (로그인 + 재무 권한).
//  예전 판으로 읽어 둔 문자(parsedWith 가 낮은 것)는 여기서 지금 판으로 다시 읽는다 — 원문은 늘 남아 있다.
//  사람이 직접 확인한 통장 잔액(neander_fin_cash_checks)도 같이 준다 — 화면이 applyCashCheck 로 쓴다.
// ============================================================

export const dynamic = "force-dynamic";

const isDate = (s: string | null): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

export async function GET(req: Request) {
  try {
    await requireErpUser(req);
    const url = new URL(req.url);
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    if (!isDate(from) || !isDate(to) || from > to) {
      return NextResponse.json({ error: "기간(from · to)이 올바르지 않습니다." }, { status: 400 });
    }
    const db = adminDb();
    const [snap, pmSnap, feedSnap, checkSnap] = await Promise.all([
      db.collection(NEANDER_COL.finSmsInbox).get(),
      db.collection(NEANDER_COL.finPaymentMethods).get(),
      db.collection(NEANDER_COL.finSettings).doc("sms-feed").get(),
      db.collection(NEANDER_COL.finCashChecks).where("date", "<=", to).get(),
    ]);
    const checks: CashCheck[] = checkSnap.docs.flatMap((d) => {
      const x = d.data();
      const c = sanitizeCashCheck(x);
      return c ? [{ ...c, ...(x.createdBy ? { createdBy: String(x.createdBy) } : {}), ...(x.createdAt ? { createdAt: Number(x.createdAt) } : {}) }] : [];
    });
    // 통장 · 카드 이름 — 화면이 장부 전체를 기다리지 않게 여기서 같이 준다
    const methods = pmSnap.docs.map((d) => d.data() as { last4?: string; alias?: string; site?: string; kind?: string });
    const listOf = (kind: string) =>
      methods
        .filter((p) => p.kind === kind && p.last4)
        .map((p) => ({ last4: String(p.last4), label: p.alias || String(p.last4), site: p.site }));
    const accounts = listOf("account");
    const cards = listOf("card");
    const strs = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);
    const linked = { accounts: strs(feedSnap.get("linkedAccounts")), cards: strs(feedSnap.get("linkedCards")) };
    const docs = snap.docs.map((d) => {
      const x = d.data() as Record<string, unknown>;
      const fresh = Number(x.parsedWith) >= BANK_SMS_PARSER;
      return { id: d.id, ...x, parsed: fresh ? (x.parsed as ReturnType<typeof parseBankSms>) : parseBankSms(String(x.text ?? "")) };
    });
    // 가린 끝자리(「3*0*」)는 문자를 신청한 카드 → ERP 카드 순으로 하나만 맞으면 그 카드
    const resolveCard = (l4: string) => matchCardLast4(l4, linked.cards) ?? matchCardLast4(l4, cards.map((c) => c.last4)) ?? l4;
    const cardTxs = docs
      .map((d) => smsToCardTx(d))
      .filter((t): t is CardTx => t !== null && t.date <= to)
      .map((t) => ({ ...t, last4: resolveCard(t.last4) }))
      .sort((a, b) => a.order.localeCompare(b.order));
    const cardLastSeen: Record<string, string> = {};
    for (const t of cardTxs) cardLastSeen[t.last4] = `${t.date} ${t.time}`;
    const all = docs
      .map((d) => smsToTx(d))
      .filter((t): t is SmsTx => t !== null && t.date <= to)
      .sort((a, b) => a.order.localeCompare(b.order));
    // 기간 앞은 통장마다 마지막 한 줄만
    const lastBefore = new Map<string, SmsTx>();
    for (const t of all) if (t.date < from) lastBefore.set(t.last4, t);
    const txs = [...lastBefore.values(), ...all.filter((t) => t.date >= from)];
    // 통장마다 마지막으로 문자를 받은 때 (기간과 상관없이) — 「며칠째 안 옴」 표시용
    const lastSeen: Record<string, string> = {};
    for (const t of all) lastSeen[t.last4] = `${t.date} ${t.time}`;
    return NextResponse.json({
      txs,
      lastSeen,
      accounts,
      cards,
      cardTxs: cardTxs.filter((t) => t.date >= `${from.slice(0, 7)}-01`),
      ...(cardTxs[0] ? { cardSmsSince: cardTxs[0].date } : {}),
      cardLastSeen,
      linked,
      checks,
      total: snap.size,
    });
  } catch (e) {
    const denied = accessErrorResponse(e);
    if (denied) return denied;
    console.error("[finance/daily-cash]", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "알 수 없는 오류" }, { status: 500 });
  }
}
