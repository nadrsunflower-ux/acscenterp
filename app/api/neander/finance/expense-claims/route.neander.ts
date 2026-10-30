import { NextResponse } from "next/server";
import { adminDb } from "@/lib/neander/server/admin";
import { accessErrorResponse, requireErpUser } from "@/lib/neander/server/auth";
import {
  ExpenseClaimError,
  cancelExpenseClaim,
  importExpenseClaim,
  linkExpenseClaimSettlement,
  listExpenseClaims,
  unlinkExpenseClaimSettlement,
} from "@/lib/neander/finance/server/expense-claims";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const json = (value: unknown) => NextResponse.json(value, { headers: { "Cache-Control": "private, no-store" } });
function failure(error: unknown) {
  const denied = accessErrorResponse(error);
  if (denied) return denied;
  if (error instanceof ExpenseClaimError) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error("[finance/expense-claims]", error);
  return NextResponse.json({ error: "대납 내역을 처리하지 못했습니다. 다시 시도해 주세요." }, { status: 500 });
}

export async function GET(req: Request) {
  try {
    await requireErpUser(req);
    return json({ claims: await listExpenseClaims(adminDb()) });
  } catch (error) { return failure(error); }
}

export async function POST(req: Request) {
  try {
    const user = await requireErpUser(req);
    const body = await req.json();
    if (!body || typeof body !== "object") throw new ExpenseClaimError("요청 내용이 올바르지 않습니다.");
    const db = adminDb();
    switch (body.action) {
      case "import": return json(await importExpenseClaim(db, user.email, body.input));
      case "linkSettlement": return json(await linkExpenseClaimSettlement(db, user.email, body.claimId, body.txId));
      case "unlinkSettlement": return json(await unlinkExpenseClaimSettlement(db, user.email, body.claimId, body.txId));
      default: throw new ExpenseClaimError("알 수 없는 대납 요청입니다.");
    }
  } catch (error) { return failure(error); }
}

export async function DELETE(req: Request) {
  try {
    const user = await requireErpUser(req);
    return json(await cancelExpenseClaim(adminDb(), user.email, new URL(req.url).searchParams.get("id") ?? ""));
  } catch (error) { return failure(error); }
}
