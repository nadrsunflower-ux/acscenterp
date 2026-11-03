import { adminDb } from "@/lib/neander/server/admin";
import { requestDb } from "@/lib/neander/shorts/server/space-db";
import { AccessError } from "@/lib/neander/server/auth";
import { isShortsAdmin, requireShortsUser } from "@/lib/neander/shorts/server/access";
import { fail, json } from "@/lib/neander/shorts/server/http";
import { getScoutAuto, getScoutAutoLast, runScoutAuto, saveScoutAuto } from "@/lib/neander/shorts/server/scout-auto-run";

// 바이럴 형식 자동화 — 설정 · 마지막 실행 · 「지금 돌리기」 (회사 공용 · 설정은 AI STUDIO 관리자만)
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  try {
    const { email } = await requireShortsUser(req);
    const db = await requestDb(req, adminDb(), email);
    const [settings, last] = await Promise.all([getScoutAuto(db), getScoutAutoLast(db)]);
    return json({ admin: isShortsAdmin(email), settings, last });
  } catch (e) {
    return fail(e);
  }
}

export async function POST(req: Request) {
  try {
    const { email } = await requireShortsUser(req);
    const db = await requestDb(req, adminDb(), email);
    const b = (await req.json()) as Record<string, unknown>;
    switch (b.action) {
      case "run":
        return json({ summary: await runScoutAuto(db, { by: email, deadline: Date.now() + 280_000, force: true }) });
      case "settings.save":
        if (!isShortsAdmin(email)) throw new AccessError(403, "정찰 자동화 설정은 AI STUDIO 관리자만 바꿉니다.");
        return json({ settings: await saveScoutAuto(db, email, b.settings) });
      default:
        throw new Error("알 수 없는 동작입니다.");
    }
  } catch (e) {
    return fail(e);
  }
}
