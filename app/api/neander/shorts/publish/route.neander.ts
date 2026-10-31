import { adminDb } from "@/lib/neander/server/admin";
import { requireShortsUser } from "@/lib/neander/shorts/server/access";
import { fail, json } from "@/lib/neander/shorts/server/http";
import { createPublication, preparePublish } from "@/lib/neander/shorts/server/publishing";

// 게시 — 점검(prepare)은 저장하지 않고 결과만, 게시(create)는 원장을 잡고 실행기에 넘긴다.
// 실제 전송은 이 요청 안에서 하지 않는다 (작업 큐 · runner.ts).
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const { email } = await requireShortsUser(req);
    const db = adminDb();
    const b = (await req.json()) as Record<string, unknown>;
    if (b.action === "prepare") return json(await preparePublish(db, email, b));
    if (b.action === "create") return json(await createPublication(db, email, b));
    throw new Error("알 수 없는 동작입니다.");
  } catch (e) {
    return fail(e);
  }
}
