import { adminDb } from "@/lib/neander/server/admin";
import { requestDb } from "@/lib/neander/shorts/server/space-db";
import { isShortsAdmin, requireShortsUser } from "@/lib/neander/shorts/server/access";
import { fail, json } from "@/lib/neander/shorts/server/http";
import { youtubeKeyFor } from "@/lib/neander/shorts/server/profiles";
import { SCOUT_VIDEO_MODELS } from "@/lib/neander/shorts/server/scout-ai";
import { cutsToday, deleteCuts, getCuts, listCuts, makeCuts } from "@/lib/neander/shorts/server/cuts";

// 레퍼런스 영상 컷 표 — 프로젝트 안 회사 공용 (lib/neander/shorts/cuts.ts)
//   GET  ?id=yt_… 컷 표 하나(없으면 cut: null) · 아니면 최근 목록 — 둘 다 오늘 쓴 수 / 하루 상한
//   POST cut.make {url, note?, model?, force?} · cut.delete {id}
// 영상 정보(제목 · 채널 · 길이)는 videos.list 로만 받는다 — search 한도를 쓰지 않는다.
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(req: Request) {
  try {
    const { email } = await requireShortsUser(req);
    const db = await requestDb(req, adminDb(), email);
    const id = new URL(req.url).searchParams.get("id");
    const base = { me: email, admin: isShortsAdmin(email), today: await cutsToday(db), models: SCOUT_VIDEO_MODELS };
    if (id) return json({ ...base, cut: await getCuts(db, id) });
    return json({ ...base, cuts: await listCuts(db) });
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
      case "cut.make": {
        // 키는 개인 → 회사. 없어도 만든다(받아 둔 영상 정보 · AI 가 본 길이로)
        const yk = await youtubeKeyFor(db, email).catch(() => ({ key: "" }));
        const r = await makeCuts(db, email, { url: b.url, note: b.note, model: b.model, force: b.force === true, key: yk.key || undefined });
        return json({ ...r, today: await cutsToday(db) });
      }
      case "cut.delete":
        await deleteCuts(db, email, b.id);
        return json({ ok: true });
      default:
        throw new Error("알 수 없는 동작입니다.");
    }
  } catch (e) {
    return fail(e);
  }
}
