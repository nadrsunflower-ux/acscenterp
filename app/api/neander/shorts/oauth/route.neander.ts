import { adminDb } from "@/lib/neander/server/admin";
import { requireShortsUser } from "@/lib/neander/shorts/server/access";
import { startOAuth } from "@/lib/neander/shorts/server/accounts";
import { fail, json } from "@/lib/neander/shorts/server/http";

// 게시 계정 연결 시작 — 로그인한 사람으로 state 를 만들고 제공사 동의 화면 주소를 돌려준다
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const { email } = await requireShortsUser(req);
    const b = (await req.json()) as { platform?: string; clientId?: string };
    const platform = b.platform === "instagram" ? "instagram" : b.platform === "youtube" ? "youtube" : null;
    if (!platform) throw new Error("연결할 플랫폼을 골라 주세요.");
    const origin = new URL(req.url).origin;
    // clientId 가 있으면 그 고객사 소유 계정으로 연결한다 (담당자만)
    return json({ url: await startOAuth(adminDb(), email, platform, origin, b.clientId) });
  } catch (e) {
    return fail(e);
  }
}
