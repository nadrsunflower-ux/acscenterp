import { adminDb } from "@/lib/neander/server/admin";
import { isShortsAdmin, requireShortsUser } from "@/lib/neander/shorts/server/access";
import { fail, json } from "@/lib/neander/shorts/server/http";
import { completeMedia, createMedia, deleteMedia, getMedia, listClientMedia, listProjectMedia, putPart, readParts } from "@/lib/neander/shorts/server/media";

// 쇼츠 파일 — 조각 올리기 · 받기 (저장 방식은 shorts/server/media.ts)
export const dynamic = "force-dynamic";

/** 한 번에 내려주는 조각 수 — 5 × 768KB ≈ 3.8MB (응답 한도 4.5MB 아래) */
const MAX_READ_PARTS = 5;

export async function GET(req: Request) {
  try {
    const { email } = await requireShortsUser(req);
    const db = adminDb();
    const url = new URL(req.url);
    // 받기는 읽기 — 관리자는 남의 비공개 프로젝트 파일도 본다 (올리기 · 지우기는 POST 가 막는다)
    const admin = isShortsAdmin(email);
    const projectId = url.searchParams.get("projectId");
    if (projectId) return json({ media: await listProjectMedia(db, projectId, email, admin) });
    const clientId = url.searchParams.get("clientId");
    if (clientId) return json({ media: await listClientMedia(db, clientId, email, admin) });
    const id = url.searchParams.get("id");
    if (url.searchParams.get("meta") === "1") {
      const { parts: _p, ...m } = await getMedia(db, id, email, admin);
      return json({ media: m });
    }
    const from = Math.max(0, Number(url.searchParams.get("from")) || 0);
    const count = Math.min(MAX_READ_PARTS, Math.max(1, Number(url.searchParams.get("count")) || 1));
    const bytes = await readParts(db, email, id, from, count, admin);
    return new Response(new Uint8Array(bytes), { headers: { "Content-Type": "application/octet-stream", "Cache-Control": "private, no-store" } });
  } catch (e) {
    return fail(e);
  }
}

export async function POST(req: Request) {
  try {
    const { email } = await requireShortsUser(req);
    const db = adminDb();
    const b = (await req.json()) as Record<string, unknown>;
    switch (b.action) {
      case "create":
        return json(await createMedia(db, email, b));
      case "part":
        await putPart(db, email, b.id, Number(b.n), Buffer.from(String(b.base64 ?? ""), "base64"));
        return json({ ok: true });
      case "done":
        return json({ media: await completeMedia(db, email, b.id) });
      case "delete":
        await deleteMedia(db, email, b.id);
        return json({ ok: true });
      default:
        throw new Error("알 수 없는 동작입니다.");
    }
  } catch (e) {
    return fail(e);
  }
}
