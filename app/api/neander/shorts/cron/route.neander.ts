import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { adminDb } from "@/lib/neander/server/admin";
import { NEANDER_COL } from "@/lib/neander/collections";
import { sweepStaleMedia } from "@/lib/neander/shorts/server/media";
import { syncCoupangReports, syncPublicationMetrics } from "@/lib/neander/shorts/server/metrics";
import { tick } from "@/lib/neander/shorts/server/runner";
import { runScoutCron } from "@/lib/neander/shorts/server/scout-run";
import type { ProfileDoc, PublicationDoc } from "@/lib/neander/shorts/types";

// ============================================================
//  쇼핑쇼츠 주기 실행 — 사람이 화면을 열지 않아도 도는 것
// ------------------------------------------------------------
//  Vercel Cron 이 부른다 (vercel.json). Authorization: Bearer <CRON_SECRET>.
//    ① 실행기 — 때가 된 예약 게시 · AI 생성 확인 (예산 4분)
//    ② 끊긴 업로드 조각 치우기
//    ③ 최근 30일 게시물의 성과를 공식 API 로 다시 읽기 (최대 20건)
//    ④ 사람마다 자기 쿠팡 키로 자기 리포트 (키를 확인한 사람만 · 막힌 키는 건너뜀)
//    ⑤ 바이럴 형식 정찰 — 감시 채널 훑기 · 새로 터진 영상 자동 분석 · 이번 주 보고 (남은 시간 안에서)
//
//  ⚠️ 지금 cron 은 하루 한 번이다 (기존 cron 들과 같은 주기 — Hobby 요금제는 하루 한 번만
//     허용해 더 잦게 적으면 배포가 실패한다). 예약 게시가 정시에 나가려면 ERP 화면이
//     열려 있거나(화면 실행기), 요금제를 올려 이 cron 을 5분마다로 바꿔야 한다.
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
  const started = Date.now();
  const out: Record<string, unknown> = {};
  try {
    out.runner = await tick(db, { budgetMs: 200_000, max: 10 });
  } catch (e) {
    out.runnerError = e instanceof Error ? e.message : String(e);
  }
  out.sweptUploads = await sweepStaleMedia(db).catch(() => 0);
  const since = Date.now() - 30 * 86_400_000;
  const pubs = await db.collection(NEANDER_COL.shortsPublications).where("status", "==", "published").get();
  const recent = pubs.docs.map((d) => ({ id: d.id, p: d.data() as PublicationDoc })).filter((x) => (x.p.result?.at ?? 0) >= since).slice(0, 20);
  let synced = 0;
  for (const r of recent) {
    // 성과는 게시한 사람 이름으로 남긴다 (그 사람이 볼 수 있는 프로젝트다)
    if (await syncPublicationMetrics(db, r.p.owner, r.id).then(() => true, () => false)) synced++;
  }
  out.metricsSynced = synced;
  const profiles = (await db.collection(NEANDER_COL.shortsProfiles).get()).docs.map((d) => d.data() as ProfileDoc);
  const ready = profiles.filter((p) => p.coupang.sealed && p.coupang.status === "ok" && !(p.coupang.blockedUntil && p.coupang.blockedUntil > Date.now())).slice(0, 10);
  const coupang: Record<string, string> = {};
  for (const p of ready) {
    coupang[p.owner] = await syncCoupangReports(db, p.owner).then((r) => `${r.projects}개 영상`, (e) => (e instanceof Error ? e.message.slice(0, 80) : "실패"));
  }
  out.coupangReports = coupang;
  out.scout = await runScoutCron(db, started + 285_000).catch((e) => (e instanceof Error ? e.message : "정찰 실패"));
  return NextResponse.json(out);
}
