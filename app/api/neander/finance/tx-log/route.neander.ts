import { NextResponse } from "next/server";
import { adminDb } from "@/lib/neander/server/admin";
import { requireErpUser, accessErrorResponse } from "@/lib/neander/server/auth";
import { listTxLog } from "@/lib/neander/finance/server/tx-log";

// 거래 한 건의 변경 이력 (finance/tx-log.ts) — 거래 편집 창의 「기록」 칸이 읽는다.
// 쓰기는 mutate 가 그 자리에서 남긴다. 여기서는 읽기만.
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    await requireErpUser(req);
    const id = new URL(req.url).searchParams.get("id") ?? "";
    if (!id) return NextResponse.json({ error: "id 가 필요합니다." }, { status: 400 });
    return NextResponse.json({ entries: await listTxLog(adminDb(), id) });
  } catch (e) {
    const denied = accessErrorResponse(e);
    if (denied) return denied;
    console.error("[finance/tx-log]", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "알 수 없는 오류" }, { status: 500 });
  }
}
