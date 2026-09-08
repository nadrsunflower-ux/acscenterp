import { NextResponse } from "next/server";
import { adminDb } from "@/lib/neander/finance/server/admin";
import { requireFinanceUser, accessErrorResponse } from "@/lib/neander/finance/server/auth";
import { NEANDER_COL } from "@/lib/neander/collections";

// 재무 데이터 전체 조회.
//
// ⚠️ 파일명이 route.neander.ts 인 이유: next.config.mjs 의 pageExtensions
//    분기로 매장(ACSCENT) 빌드에서 제외하기 위해서다. route.ts 로 만들면
//    매장 도메인에도 이 엔드포인트가 생긴다. 인증으로 막히긴 하지만
//    회사 재무 API 를 알바용 도메인에 열어둘 이유가 없다.
export const dynamic = "force-dynamic";

const readAll = async (col: string) => {
  const snap = await adminDb().collection(col).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
};

export async function GET(req: Request) {
  try {
    await requireFinanceUser(req);

    const [transactions, accounts, paymentMethods, vendorRules, subscriptions, allocations, budgets, imports, closes, projects, docs] =
      await Promise.all([
        readAll(NEANDER_COL.finTransactions),
        readAll(NEANDER_COL.finAccounts),
        readAll(NEANDER_COL.finPaymentMethods),
        readAll(NEANDER_COL.finVendorRules),
        readAll(NEANDER_COL.finSubscriptions),
        readAll(NEANDER_COL.finAllocations),
        readAll(NEANDER_COL.finBudgets),
        readAll(NEANDER_COL.finImports),
        readAll(NEANDER_COL.finCloses),
        readAll(NEANDER_COL.finProjects),
        readAll(NEANDER_COL.finDocs),
      ]);

    // 정렬은 서버에서 끝내둔다 — 클라이언트가 매번 다시 정렬할 이유가 없다
    transactions.sort((a, b) =>
      String((b as { date?: string }).date ?? "").localeCompare(
        String((a as { date?: string }).date ?? ""),
      ),
    );
    imports.sort(
      (a, b) =>
        Number((b as { createdAt?: number }).createdAt ?? 0) -
        Number((a as { createdAt?: number }).createdAt ?? 0),
    );

    return NextResponse.json({
      transactions,
      accounts,
      paymentMethods,
      vendorRules,
      subscriptions,
      allocations,
      budgets,
      imports,
      closes,
      projects,
      docs,
    });
  } catch (e) {
    const denied = accessErrorResponse(e);
    if (denied) return denied;
    console.error("[finance/data]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "알 수 없는 오류" },
      { status: 500 },
    );
  }
}
