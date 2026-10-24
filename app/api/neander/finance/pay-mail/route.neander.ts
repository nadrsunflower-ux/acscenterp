import { NextResponse } from "next/server";
import { adminDb } from "@/lib/neander/server/admin";
import { requireErpUser, accessErrorResponse } from "@/lib/neander/server/auth";
import { attachPayMails } from "@/lib/neander/finance/server/pay-mail";

// 결제 알림 메일 → 카드 거래 메모 (finance/pay-mail.ts) — 자동 처리 화면의 「지금 찾기」.
// 매일 밤 점검(finance/cron)도 같은 일을 한다. dryRun 이면 붙이지 않고 무엇이 붙을지만.
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: Request) {
  try {
    const user = await requireErpUser(req);
    const { dryRun } = (await req.json().catch(() => ({}))) as { dryRun?: boolean };
    const res = await attachPayMails(adminDb(), user.email, { dryRun: dryRun === true });
    return NextResponse.json({
      reads: res.reads,
      attached: res.attached,
      matches: res.matches.map((m) => ({
        txId: m.txId,
        memo: m.memo,
        pg: m.read.pg,
        amount: m.read.amount,
        currency: m.read.currency,
        date: m.read.date,
      })),
    });
  } catch (e) {
    const denied = accessErrorResponse(e);
    if (denied) return denied;
    console.error("[finance/pay-mail]", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "알 수 없는 오류" }, { status: 500 });
  }
}
