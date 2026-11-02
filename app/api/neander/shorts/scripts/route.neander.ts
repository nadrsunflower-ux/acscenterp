import { adminDb } from "@/lib/neander/server/admin";
import { requestDb } from "@/lib/neander/shorts/server/space-db";
import { requireShortsUser } from "@/lib/neander/shorts/server/access";
import { openrouterConfigured } from "@/lib/neander/shorts/server/ai";
import { fail, json } from "@/lib/neander/shorts/server/http";
import {
  createScriptSession,
  deleteScriptSession,
  getScriptSession,
  listScriptSessions,
  patchScriptSession,
  revertScriptSession,
  scriptSessionPhoto,
  scriptSessionToProject,
  scriptSessionTurn,
  writerReferences,
} from "@/lib/neander/shorts/server/script-writer";

// 대본 작성기 — 사람마다 비공개 세션 · AI 는 「보내기」 를 눌렀을 때만 (shorts/script-writer.ts)
//   GET  목록 · ?id= 세션 · ?id=&photo= 사진 원본 · ?refs=1 참고 분석 목록
//   POST create · turn · patch · revert · delete · toProject
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(req: Request) {
  try {
    const { email } = await requireShortsUser(req);
    const db = await requestDb(req, adminDb());
    const u = new URL(req.url);
    const id = u.searchParams.get("id");
    if (id && u.searchParams.has("photo")) return json({ dataUrl: await scriptSessionPhoto(db, email, id, u.searchParams.get("photo")) });
    if (id) return json({ session: await getScriptSession(db, email, id) });
    if (u.searchParams.has("refs")) return json({ refs: await writerReferences(db, email) });
    return json({ me: email, ai: openrouterConfigured(), sessions: await listScriptSessions(db, email) });
  } catch (e) {
    return fail(e);
  }
}

export async function POST(req: Request) {
  try {
    const { email } = await requireShortsUser(req);
    const db = await requestDb(req, adminDb());
    const b = (await req.json()) as Record<string, unknown>;
    switch (b.action) {
      case "create":
        return json(await createScriptSession(db, email, b));
      case "turn":
        return json(await scriptSessionTurn(db, email, b.id, { message: b.message, photos: b.photos, model: b.model }));
      case "patch":
        return json({ session: await patchScriptSession(db, email, b.id, (b.patch ?? {}) as Record<string, unknown>) });
      case "revert":
        return json({ session: await revertScriptSession(db, email, b.id, b.n) });
      case "delete":
        await deleteScriptSession(db, email, b.id);
        return json({ ok: true });
      case "toProject":
        return json(await scriptSessionToProject(db, email, b.id));
      default:
        throw new Error("알 수 없는 동작입니다.");
    }
  } catch (e) {
    return fail(e);
  }
}
