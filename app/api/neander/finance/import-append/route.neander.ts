import { NextResponse } from "next/server";
import { adminDb } from "@/lib/neander/server/admin";
import { accessErrorResponse, requireErpUser } from "@/lib/neander/server/auth";
import { appendFinanceImport, ImportAppendError } from "@/lib/neander/finance/server/import-append";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  try {
    const user = await requireErpUser(req);
    const input = await req.json();
    const result = await appendFinanceImport(adminDb(), user.email, input);
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const denied = accessErrorResponse(error);
    if (denied) return denied;
    if (error instanceof ImportAppendError) return NextResponse.json({ error: error.message, ...(error.partial ? { partial: error.partial } : {}) }, { status: error.status });
    console.error("[finance/import-append]", error);
    return NextResponse.json({ error: "파일을 추가하지 못했습니다. 기존 거래는 유지했습니다. 다시 시도해 주세요." }, { status: 500 });
  }
}
