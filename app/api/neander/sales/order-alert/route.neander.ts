import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { adminDb } from "@/lib/neander/server/admin";
import { runOrderAlert } from "@/lib/neander/sales/server/order-alert";

// ============================================================
//  생일 이벤트 발주 알림 — 매일 06:10 KST (vercel.json)
// ------------------------------------------------------------
//  매장 앱 캘린더와 ERP 이벤트를 짝 맞춰, 발주 기록 없이 다가오는 이벤트를 노션
//  「이벤트발주알림」 표와 @멘션 댓글로 알린다 (lib/neander/sales/server/order-alert.ts).
//  Authorization: Bearer <CRON_SECRET>. `?dry=1` 이면 노션을 건드리지 않고 할 일만 돌려준다.
// ============================================================

export const dynamic = "force-dynamic";
export const maxDuration = 120;

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

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
    const dryRun = new URL(req.url).searchParams.get("dry") === "1";
    const result = await runOrderAlert(adminDb(), { today: kstToday(), dryRun });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    console.error("[sales/order-alert]", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
