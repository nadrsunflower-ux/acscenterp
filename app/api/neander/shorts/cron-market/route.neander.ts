import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { adminDb } from "@/lib/neander/server/admin";
import { getMarketSettings, runMarketDaily } from "@/lib/neander/shorts/server/market";

// ============================================================
//  시장 트렌드 주기 실행 — 매일 07:30 KST (vercel.json · Authorization: Bearer <CRON_SECRET>)
//  채널 숫자 기록 → 검색어 묶음 추이 → AI 브리핑. shorts/market.ts · server/market.ts
//  레이더(06:30) · 바이럴 형식 자동화(07:00) 뒤에 돌아야 그날 것을 브리핑에 넣는다.
// ============================================================

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export async function GET(req: Request) {
  const expected = (process.env.CRON_SECRET ?? "").trim();
  if (!expected) return NextResponse.json({ error: "CRON_SECRET 이 설정되지 않았습니다." }, { status: 503 });
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token || !safeEqual(token, expected)) return NextResponse.json({ error: "주기 실행 토큰이 올바르지 않습니다." }, { status: 401 });
  const db = adminDb();
  const s = await getMarketSettings(db);
  if (!s.enabled) return NextResponse.json({ skipped: "설정에서 꺼져 있음" });
  const started = Date.now();
  const out = await runMarketDaily(db, { by: "company", deadline: started + 285_000, settings: s }).catch((e) => ({ error: e instanceof Error ? e.message : "시장 트렌드 실행 실패" }));
  return NextResponse.json(out);
}
