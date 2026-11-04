import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { adminDb } from "@/lib/neander/server/admin";
import { getMarketSettings, runMarketDaily } from "@/lib/neander/shorts/server/market";
import { forEachSpace } from "@/lib/neander/shorts/server/space-db";
import { sendBriefMails } from "@/lib/neander/shorts/server/brief-mail";

// ============================================================
//  시장 트렌드 주기 실행 — 매일 07:30 KST (vercel.json · Authorization: Bearer <CRON_SECRET>)
//  채널 숫자 기록 → 검색어 묶음 추이 → AI 브리핑. shorts/market.ts · server/market.ts
//  레이더(06:30) · 바이럴 형식 자동화(07:00) 뒤에 돌아야 그날 것을 브리핑에 넣는다.
//  모든 프로젝트 브리핑을 만든 뒤 「메일로 받기」 를 켠 사람마다 한 통 (내게쓰기 · server/brief-mail.ts).
//  메일에 몫을 남기려고 프로젝트 실행은 240초 안에서 나눈다.
// ============================================================

/**
 * 메일 속 「ERP 에서 보기」 주소 — 주기 실행 요청의 호스트를 쓰지 않는다. Vercel 크론은 배포마다 붙는 주소로
 * 올 수 있고, 그 주소는 Vercel 로그인 뒤에 있어 받은 사람이 눌러도 ERP 가 안 열린다.
 * 회의록 노션 보관(meetings/server/archive.ts)과 같은 운영 주소. 바꿔야 하면 NEANDER_PUBLIC_ORIGIN.
 */
const ERP_ORIGIN = (process.env.NEANDER_PUBLIC_ORIGIN ?? "").trim().replace(/\/+$/, "") || "https://neander-erp.vercel.app";

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
  // AI STUDIO 프로젝트마다 그 프로젝트의 검색어 묶음 · 채널 · 브리핑 상한으로 (남은 시간을 나눠)
  const out = await forEachSpace(adminDb(), started + 240_000, async (sdb, _s, deadline) => {
    const s = await getMarketSettings(sdb);
    if (!s.enabled) return { skipped: "설정에서 꺼져 있음" };
    return runMarketDaily(sdb, { by: "company", deadline, settings: s });
  });
  // 한 사람의 실패가 브리핑 결과를 깨지 않게 — 메일 전체가 실패해도 응답은 낸다
  const briefMail = await sendBriefMails(adminDb(), { deadline: started + 292_000, origin: ERP_ORIGIN }).catch((e) => (e instanceof Error ? e.message : String(e)));
  return NextResponse.json({ ...out, "메일로 받기": briefMail });
}
