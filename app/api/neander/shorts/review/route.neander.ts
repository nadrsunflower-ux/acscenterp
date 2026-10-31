import { adminDb } from "@/lib/neander/server/admin";
import { fail, json } from "@/lib/neander/shorts/server/http";
import { decideByLink, reviewInfo, reviewMediaParts } from "@/lib/neander/shorts/server/reviews";

// ============================================================
//  고객 검토 링크 (로그인 없음) — /neander/review/<토큰> 화면이 부른다
// ------------------------------------------------------------
//  토큰 하나로 그 회차의 영상 한 편만 보고, 그 회차에 한 번만 답한다 (reviews.ts).
//  ERP 의 다른 자료는 이 문으로 나가지 않는다.
// ============================================================

export const dynamic = "force-dynamic";

/** 한 번에 내려주는 조각 수 — 5 × 768KB ≈ 3.8MB (응답 한도 아래) */
const MAX_READ_PARTS = 5;

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const token = url.searchParams.get("token");
    if (url.searchParams.has("from")) {
      const from = Math.max(0, Number(url.searchParams.get("from")) || 0);
      const count = Math.min(MAX_READ_PARTS, Math.max(1, Number(url.searchParams.get("count")) || 1));
      const bytes = await reviewMediaParts(adminDb(), token, from, count);
      return new Response(new Uint8Array(bytes), { headers: { "Content-Type": "application/octet-stream", "Cache-Control": "private, no-store" } });
    }
    return json({ review: await reviewInfo(adminDb(), token) });
  } catch (e) {
    return fail(e);
  }
}

export async function POST(req: Request) {
  try {
    const b = (await req.json()) as { token?: string; decision?: string; feedback?: string; name?: string };
    return json({ review: await decideByLink(adminDb(), b.token, b) });
  } catch (e) {
    return fail(e);
  }
}
