import { NextResponse } from "next/server";
import { requireErpUser, accessErrorResponse } from "@/lib/neander/server/auth";
import { labelVendorKinds, VENDOR_KIND_MAX_NAMES } from "@/lib/neander/finance/server/ai-vendor-kind";

// 업종 붙이기 — 카드 명세서를 올릴 때 처음 보는 가맹점의 이름을 받아 업종을 돌려준다
// (finance/vendor-kind.ts). 저장하지 않는다 — 적재하는 화면이 거래에 실어 넣는다.
//
//   POST { names: string[] }  →  { kinds: { 가맹점 열쇠: 업종 }, costUsd, model }
export const dynamic = "force-dynamic";
/** 이름이 많으면 모델을 여러 번 부른다 */
export const maxDuration = 300;

export async function POST(req: Request) {
  try {
    await requireErpUser(req);
    const body = (await req.json().catch(() => ({}))) as { names?: unknown };
    const names = Array.isArray(body.names)
      ? body.names.filter((n): n is string => typeof n === "string" && !!n.trim()).slice(0, VENDOR_KIND_MAX_NAMES)
      : [];
    if (names.length === 0) return NextResponse.json({ kinds: {}, costUsd: 0, model: "" });
    return NextResponse.json(await labelVendorKinds(names));
  } catch (e) {
    const denied = accessErrorResponse(e);
    if (denied) return denied;
    console.error("[finance/ai/vendor-kinds]", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "알 수 없는 오류" }, { status: 500 });
  }
}
