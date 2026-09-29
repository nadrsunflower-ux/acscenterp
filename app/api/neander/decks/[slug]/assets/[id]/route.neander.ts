import { NextResponse } from "next/server";
import { adminDb } from "@/lib/neander/server/admin";
import { requireErpUser, accessErrorResponse } from "@/lib/neander/server/auth";
import { isAssetId, isSlug, readDeckAsset } from "@/lib/neander/decks/server/store";

// ============================================================
//  장표 사진·지도 타일 — 로그인한 재무 권한자에게만
// ------------------------------------------------------------
//  매물 사진은 외부 링크가 만료될 수 있어 받아 둔 것이고, 어느 매물을 보고
//  있는지도 내부 정보다. public/ 에 두면 로그인과 무관하게 열리므로
//  Firestore(neander_decks/{slug}/assets)에 두고 여기서만 내준다.
//  <img src> 는 토큰을 못 실어서 화면은 fetch → blob URL 로 쓴다.
// ============================================================

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: { slug: string; id: string } }) {
  try {
    await requireErpUser(req);
  } catch (e) {
    const denied = accessErrorResponse(e);
    if (denied) return denied;
    throw e;
  }
  const slug = String(params.slug ?? "");
  const id = String(params.id ?? "");
  if (!isSlug(slug) || !isAssetId(id)) {
    return NextResponse.json({ error: "주소가 올바르지 않습니다." }, { status: 400 });
  }
  try {
    const asset = await readDeckAsset(adminDb(), slug, id);
    if (!asset) return NextResponse.json({ error: "자료가 없습니다." }, { status: 404 });
    return new Response(asset.bytes, {
      headers: {
        "Content-Type": asset.mime,
        "Cache-Control": "private, max-age=3600",
        "X-Robots-Tag": "noindex, nofollow",
      },
    });
  } catch (e) {
    console.error("[decks asset GET]", e);
    return NextResponse.json({ error: "자료를 불러오지 못했습니다." }, { status: 500 });
  }
}
