import { adminDb } from "@/lib/neander/server/admin";
import { AccessError } from "@/lib/neander/server/auth";
import { isShortsAdmin, requireShortsUser } from "@/lib/neander/shorts/server/access";
import { fail, json } from "@/lib/neander/shorts/server/http";
import { managementKey, saveAssignment, usageView } from "@/lib/neander/shorts/server/ai-usage";

// AI 사용료 — 오픈라우터 키마다 쓴 돈을 사람 · 달로 (shorts/ai-usage.ts).
// 계정 전체의 돈이라 AI STUDIO 관리자만 본다. 열 때마다 지금 상태를 읽어 그날 기록을 덮어쓴다.
// POST 는 키 주인 · 용도 정하기 — 관리자만.
export const dynamic = "force-dynamic";

async function requireAdmin(req: Request) {
  const user = await requireShortsUser(req);
  if (!isShortsAdmin(user.email)) throw new AccessError(403, "AI 사용료는 AI STUDIO 관리자만 봅니다.");
  return user;
}

export async function GET(req: Request) {
  try {
    await requireAdmin(req);
    if (!managementKey()) return json({ configured: false });
    return json({ configured: true, view: await usageView(adminDb()) });
  } catch (e) {
    return fail(e);
  }
}

export async function POST(req: Request) {
  try {
    const { email } = await requireAdmin(req);
    const b = (await req.json()) as { hash?: unknown; owner?: unknown; purpose?: unknown };
    return json({ assignment: await saveAssignment(adminDb(), email, b) });
  } catch (e) {
    return fail(e);
  }
}
