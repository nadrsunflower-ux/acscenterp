import { NextResponse } from "next/server";
import { adminDb } from "@/lib/neander/server/admin";
import { requireErpUser, accessErrorResponse } from "@/lib/neander/server/auth";
import { NEANDER_COL } from "@/lib/neander/collections";
import { buildPnl } from "@/lib/neander/sales/aggregate";
import { loadLaborActuals } from "@/lib/neander/sales/server/labor";
import { SEED_ASSUMPTIONS } from "@/lib/neander/sales/master-data";
import type {
  SalesAssumptions,
  SalesEvent,
  SalesLine,
  SalesProduct,
} from "@/lib/neander/sales/types";

// 한 달 요약만 — ERP 대시보드의 매출 타일이 쓴다.
//
// 대시보드에서 /data 를 부르면 판매 줄 전체(한 해 만 건 이상)를 끌어오게
// 된다. 타일 하나에 필요한 것은 숫자 몇 개뿐이라, 그 달만 질의해 서버에서
// 집계하고 작은 값만 내려보낸다.
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    await requireErpUser(req);

    const url = new URL(req.url);
    const month = (url.searchParams.get("month") ?? "").slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return NextResponse.json({ error: "month=YYYY-MM 이 필요합니다." }, { status: 400 });
    }

    const db = adminDb();
    // 날짜는 YYYY-MM-DD 문자열이라 사전순 범위 질의가 그대로 통한다
    const [lineSnap, productSnap, eventSnap, aSnap, labor] = await Promise.all([
      db
        .collection(NEANDER_COL.salesLines)
        .where("date", ">=", `${month}-01`)
        .where("date", "<=", `${month}-31`)
        .get(),
      db.collection(NEANDER_COL.salesProducts).get(),
      db.collection(NEANDER_COL.salesEvents).get(),
      db.collection(NEANDER_COL.salesAssumptions).doc("current").get(),
      // 매출 화면과 같은 인건비여야 타일과 화면 숫자가 갈라지지 않는다
      loadLaborActuals(db).catch(() => null),
    ]);

    const lines = lineSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as SalesLine[];
    const products = productSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as SalesProduct[];
    const events = eventSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as SalesEvent[];
    const assumptions = (aSnap.exists
      ? { id: aSnap.id, ...aSnap.data() }
      : SEED_ASSUMPTIONS) as SalesAssumptions;

    const pnl = buildPnl(month, lines, products, events, assumptions, { actuals: labor });

    return NextResponse.json({
      month,
      revenue: pnl.total.revenue,
      contribution: pnl.total.contribution,
      contributionRate: pnl.total.contributionRate,
      operating: pnl.total.operating,
      reviewCount: pnl.total.reviewCount,
      reviewAmount: pnl.total.reviewAmount,
      stores: pnl.stores.map((s) => ({
        store: s.store,
        revenue: s.revenue,
        contribution: s.contribution,
        contributionRate: s.contributionRate,
      })),
    });
  } catch (e) {
    const denied = accessErrorResponse(e);
    if (denied) return denied;
    console.error("[sales/summary]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "알 수 없는 오류" },
      { status: 500 },
    );
  }
}
