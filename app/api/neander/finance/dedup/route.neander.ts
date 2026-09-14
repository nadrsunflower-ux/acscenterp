import { NextResponse } from "next/server";
import { adminDb } from "@/lib/neander/server/admin";
import { requireErpUser, accessErrorResponse } from "@/lib/neander/server/auth";
import { NEANDER_COL } from "@/lib/neander/collections";

// 적재 중복 검사용 — 이미 있는 거래를 중복 키(dedupHash)별로 센다.
//
// 거래 목록(/finance/data)에는 dedupHash 를 싣지 않는다 (7.1MB 의 1할).
// 그걸 쓰는 곳은 적재 화면 하나라, 그 화면이 이 개수만 받는다.
// 같은 날 같은 금액이 실제로 두 번 있을 수 있어서 있다/없다가 아니라 개수다.
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    await requireErpUser(req);
    const snap = await adminDb().collection(NEANDER_COL.finTransactions).select("dedupHash").get();
    const counts: Record<string, number> = {};
    snap.docs.forEach((d) => {
      const h = d.get("dedupHash");
      if (typeof h === "string" && h) counts[h] = (counts[h] ?? 0) + 1;
    });
    return NextResponse.json({ counts });
  } catch (e) {
    const denied = accessErrorResponse(e);
    if (denied) return denied;
    console.error("[finance/dedup]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "알 수 없는 오류" },
      { status: 500 },
    );
  }
}
