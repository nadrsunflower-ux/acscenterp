import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { adminDb } from "@/lib/neander/server/admin";
import { runScoutAuto } from "@/lib/neander/shorts/server/scout-auto-run";

// ============================================================
//  바이럴 형식 정찰 주기 실행 — 매일 07:00 KST (vercel.json · Authorization: Bearer <CRON_SECRET>)
//  감시 채널 채우기(한국은 AI 레이더 · 해외는 나라별 검색) → 훑기 → 자동 분석 → 자동 묶기 →
//  한국 확인 → 주간 보고 · AI 요약. shorts/scout-auto.ts · server/scout-auto-run.ts
//  레이더(06:30 cron)가 먼저 돌아야 한국 채널을 채울 수 있다.
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
  const started = Date.now();
  const summary = await runScoutAuto(adminDb(), { by: "company", deadline: started + 285_000 }).catch((e) => ({ error: e instanceof Error ? e.message : "정찰 자동화 실패" }));
  return NextResponse.json(summary);
}
