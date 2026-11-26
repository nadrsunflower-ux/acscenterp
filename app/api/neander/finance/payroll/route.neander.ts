import { NextResponse } from "next/server";
import { adminDb } from "@/lib/neander/server/admin";
import { requireErpUser, accessErrorResponse } from "@/lib/neander/server/auth";
import { NEANDER_COL } from "@/lib/neander/collections";
import { sanitizePayroll, type PayrollDoc } from "@/lib/neander/finance/payroll";

// 급여 지급 — 지급하는 달마다 보낼 사람 · 금액 · 계좌 (lib/neander/finance/payroll.ts).
//
// 계좌번호가 들어가므로 보안 규칙에 넣지 않고 서버(Admin SDK)로만 읽고 쓴다.
// 권한은 재무와 같다 (NEANDER_FINANCE_EMAILS).
export const dynamic = "force-dynamic";

function fail(e: unknown) {
  const denied = accessErrorResponse(e);
  if (denied) return denied;
  console.error("[finance/payroll]", e);
  return NextResponse.json({ error: e instanceof Error ? e.message : "알 수 없는 오류" }, { status: 500 });
}

export async function GET(req: Request) {
  try {
    await requireErpUser(req);
    const snap = await adminDb().collection(NEANDER_COL.finPayroll).get();
    const plans = snap.docs.map((d) => ({ ...d.data(), id: d.id }) as PayrollDoc);
    return NextResponse.json({ plans });
  } catch (e) {
    return fail(e);
  }
}

/** { plan } — 그 달 문서를 통째로 갈아치운다 */
export async function POST(req: Request) {
  try {
    const user = await requireErpUser(req);
    const body = (await req.json()) as { plan?: unknown };
    const parsed = sanitizePayroll(body.plan);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const ref = adminDb().collection(NEANDER_COL.finPayroll).doc(parsed.value.id);
    const doc: PayrollDoc = { ...parsed.value, updatedAt: Date.now(), updatedBy: user.email };
    await ref.set(doc, { merge: false });
    return NextResponse.json({ ok: true, plan: doc });
  } catch (e) {
    return fail(e);
  }
}

/** ?id=YYYY-MM */
export async function DELETE(req: Request) {
  try {
    await requireErpUser(req);
    const id = new URL(req.url).searchParams.get("id");
    if (!id || !/^\d{4}-\d{2}$/.test(id)) return NextResponse.json({ error: "지급하는 달이 필요합니다." }, { status: 400 });
    await adminDb().collection(NEANDER_COL.finPayroll).doc(id).delete();
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
