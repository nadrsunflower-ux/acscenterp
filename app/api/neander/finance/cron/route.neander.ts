import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { adminDb } from "@/lib/neander/server/admin";
import { NEANDER_COL } from "@/lib/neander/collections";
import { remeasureTrust } from "@/lib/neander/finance/server/trust";
import { attachPayMails } from "@/lib/neander/finance/server/pay-mail";
import { matchReceipts, openInstallments } from "@/lib/neander/finance/receivables";
import { detectRecurring } from "@/lib/neander/finance/recurring";
import { buildRunway, defaultAsOf, runwayDanger, sanitizeRunway } from "@/lib/neander/finance/runway";
import { buildBriefing, type FinAlert } from "@/lib/neander/finance/briefing";
import { isEngineConfirmed } from "@/lib/neander/finance/trust";
import type { FinImportBatch, FinTransaction } from "@/lib/neander/finance/types";
import type { FinPaymentMethodDoc } from "@/lib/neander/finance/db-types";
import type { FinProjectDoc } from "@/lib/neander/finance/project";

// ============================================================
//  재무 매일 밤 점검 — 사람이 화면을 열지 않아도 도는 것
// ------------------------------------------------------------
//  Vercel Cron 이 매일 06:00 KST 에 부른다 (vercel.json). 하는 일:
//    ① 믿을 범위를 다시 잰다 — 어제 사람이 확정한 것이 오늘의 실측이 된다 (trust.ts)
//    ①′ 결제 알림 메일을 카드 거래에 메모로 붙인다 (pay-mail.ts)
//    ② 알림 상태를 남긴다 — 통장이 곧 바닥남 · 7일 넘은 받을 돈 (briefing.ts).
//       처음 본 날을 기억해 「새 알림」 과 「이어지는 알림」 을 가른다
//    ③ 월요일이면 브리핑을 만들어 둔다
//
//  ⚠️ 현금 예측(통장이 언제 모자라나)은 런웨이(runway.ts)가 정본이다 — 화면의 런웨이와
//     같은 설정 · 같은 함수로 「바닥나는 날」 을 받아 옮겨 적기만 한다. 여기서 따로 세지 않는다.
//
//  Authorization: Bearer <CRON_SECRET> (Vercel 이 붙여 준다). 금액을 받지 않는다 —
//  이 문으로 들어온 값이 장부에 쓰이는 일은 없고, 장부를 읽어 계산만 한다.
// ============================================================

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

const readAll = async <T>(col: string) =>
  (await adminDb().collection(col).get()).docs.map((d) => ({ id: d.id, ...d.data() }) as T);

const kstToday = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);

export async function GET(req: Request) {
  const expected = (process.env.CRON_SECRET ?? "").trim();
  if (!expected) return NextResponse.json({ error: "CRON_SECRET 이 설정되지 않았습니다." }, { status: 503 });
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token || !safeEqual(token, expected)) {
    return NextResponse.json({ error: "주기 실행 토큰이 올바르지 않습니다." }, { status: 401 });
  }

  try {
    const db = adminDb();
    const today = kstToday();
    const [transactions, paymentMethods, projects, imports, runwaySnap, alertSnap] = await Promise.all([
      readAll<FinTransaction>(NEANDER_COL.finTransactions),
      readAll<FinPaymentMethodDoc>(NEANDER_COL.finPaymentMethods),
      readAll<FinProjectDoc>(NEANDER_COL.finProjects),
      readAll<FinImportBatch>(NEANDER_COL.finImports),
      db.collection(NEANDER_COL.finRunway).doc("main").get(),
      db.collection(NEANDER_COL.finSettings).doc("alerts").get(),
    ]);

    // ① 믿을 범위
    const measure = await remeasureTrust(db, { transactions });

    // ①′ 결제 알림 메일 → 카드 거래 메모 (맞는 거래가 하나뿐일 때만 — pay-mail.ts)
    const payMail = await attachPayMails(db, "cron:pay-mail").catch((e) => {
      console.error("[finance/cron] pay-mail", e);
      return null;
    });

    // ② 런웨이의 바닥나는 날 · 받을 돈 · 알림
    const runway = buildRunway({
      transactions,
      paymentMethods,
      projects,
      settings: sanitizeRunway(runwaySnap.exists ? runwaySnap.data() : null),
      asOf: defaultAsOf(transactions, today.slice(0, 7)),
      today,
      imports,
    });
    const danger = runwayDanger(runway);
    const open = openInstallments(projects, transactions);
    const matches = matchReceipts({ projects, transactions, paymentMethods, today });
    const weekAgo = Date.now() - 7 * 86_400_000;
    const briefing = buildBriefing({
      today,
      cash: { asOf: danger.start, opening: danger.opening, firstBelow: danger.zero ?? undefined, lowest: danger.lowest },
      open,
      matches,
      recurring: detectRecurring(transactions, paymentMethods, today),
      pending: transactions.filter((t) => t.status !== "confirmed").length,
      autoConfirmed: transactions.filter((t) => isEngineConfirmed(t) && (t.updatedAt ?? 0) >= weekAgo).length,
    });
    const seen = (alertSnap.exists ? (alertSnap.data() as { firstSeen?: Record<string, number> }).firstSeen : undefined) ?? {};
    const now = Date.now();
    const firstSeen: Record<string, number> = {};
    briefing.alerts.forEach((a: FinAlert) => (firstSeen[a.key] = seen[a.key] ?? now));
    const fresh = briefing.alerts.filter((a) => !seen[a.key]);
    await db.collection(NEANDER_COL.finSettings).doc("alerts").set({ active: briefing.alerts, firstSeen, at: now });

    // ③ 월요일 — 브리핑
    const monday = new Date(`${today}T00:00:00Z`).getUTCDay() === 1;
    if (monday) await db.collection(NEANDER_COL.finSettings).doc("briefing").set(briefing);

    return NextResponse.json({
      ok: true,
      today,
      trust: { months: measure.months, total: measure.total },
      payMail: payMail ? { reads: payMail.reads, attached: payMail.attached } : null,
      cash: { start: danger.start, zero: danger.zero?.date ?? null },
      alerts: { active: briefing.alerts.length, new: fresh.length },
      briefing: monday ? briefing.headline : undefined,
    });
  } catch (e) {
    console.error("[finance/cron]", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "알 수 없는 오류" }, { status: 500 });
  }
}
