import { NextResponse } from "next/server";
import { adminDb } from "@/lib/neander/server/admin";
import { requireErpUser, accessErrorResponse } from "@/lib/neander/server/auth";
import { NEANDER_COL } from "@/lib/neander/collections";
import { trimTransaction } from "@/lib/neander/finance/payload";

// 재무 데이터 조회.
//
// ⚠️ 파일명이 route.neander.ts 인 이유: next.config.mjs 의 pageExtensions
//    분기로 매장(ACSCENT) 빌드에서 제외하기 위해서다. route.ts 로 만들면
//    매장 도메인에도 이 엔드포인트가 생긴다. 인증으로 막히긴 하지만
//    회사 재무 API 를 알바용 도메인에 열어둘 이유가 없다.
//
// 두 가지로 받는다 (FinanceProvider 가 고른다):
//   GET            전부 (full)
//   GET ?since=ms  그 뒤로 바뀐 거래 + 지금 있는 거래 id 전부 (delta)
//                  — 지운 거래는 id 목록에서 빠진 것으로 안다.
//   POST {ids}     id 로 거래 몇 건 — 캐시에 없는 거래를 채울 때
// 거래는 화면이 읽는 필드만 보낸다 (lib/neander/finance/payload.ts).
export const dynamic = "force-dynamic";

const readAll = async (col: string) => {
  const snap = await adminDb().collection(col).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
};

async function readTransactionPart(since: number | null) {
  const col = adminDb().collection(NEANDER_COL.finTransactions);
  if (since === null) {
    const snap = await col.get();
    return {
      transactions: snap.docs.map((d) => trimTransaction({ id: d.id, ...d.data() })),
      transactionIds: undefined as string[] | undefined,
    };
  }
  // 새로 생긴 문서는 createdAt, 고친 문서는 updatedAt 으로 잡는다
  const [updated, created, ids] = await Promise.all([
    col.where("updatedAt", ">", since).get(),
    col.where("createdAt", ">", since).get(),
    col.select().get(),
  ]);
  const byId = new Map<string, Record<string, unknown>>();
  [...updated.docs, ...created.docs].forEach((d) =>
    byId.set(d.id, trimTransaction({ id: d.id, ...d.data() })),
  );
  return { transactions: [...byId.values()], transactionIds: ids.docs.map((d) => d.id) };
}

function failure(e: unknown) {
  const denied = accessErrorResponse(e);
  if (denied) return denied;
  console.error("[finance/data]", e);
  return NextResponse.json(
    { error: e instanceof Error ? e.message : "알 수 없는 오류" },
    { status: 500 },
  );
}

export async function GET(req: Request) {
  try {
    await requireErpUser(req);
    // 읽기 **시작 전** 시각 — 읽는 동안 들어온 수정을 다음 동기화가 놓치지 않게
    const serverTime = Date.now();
    const raw = Number(new URL(req.url).searchParams.get("since"));
    const since = Number.isFinite(raw) && raw > 0 ? raw : null;

    const [tx, accounts, paymentMethods, vendorRules, subscriptions, allocations, budgets, imports, closes, projects, docs, ledgerColumns] =
      await Promise.all([
        readTransactionPart(since),
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
        readAll(NEANDER_COL.finLedgerColumns),
      ]);

    // 정렬은 서버에서 끝내둔다 — 클라이언트가 매번 다시 정렬할 이유가 없다
    tx.transactions.sort((a, b) => String(b.date ?? "").localeCompare(String(a.date ?? "")));
    imports.sort(
      (a, b) =>
        Number((b as { createdAt?: number }).createdAt ?? 0) -
        Number((a as { createdAt?: number }).createdAt ?? 0),
    );

    return NextResponse.json({
      mode: since === null ? "full" : "delta",
      serverTime,
      transactions: tx.transactions,
      transactionIds: tx.transactionIds,
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
      ledgerColumns,
    });
  } catch (e) {
    return failure(e);
  }
}

export async function POST(req: Request) {
  try {
    await requireErpUser(req);
    const { ids } = (await req.json()) as { ids?: string[] };
    if (!Array.isArray(ids) || ids.length === 0) return NextResponse.json({ transactions: [] });
    if (ids.length > 5000) {
      return NextResponse.json({ error: "한 번에 5,000건까지 받을 수 있습니다." }, { status: 400 });
    }
    const db = adminDb();
    const col = db.collection(NEANDER_COL.finTransactions);
    const out: Record<string, unknown>[] = [];
    for (let i = 0; i < ids.length; i += 300) {
      const snaps = await db.getAll(...ids.slice(i, i + 300).map((id) => col.doc(String(id))));
      snaps.forEach((snap) => {
        if (snap.exists) out.push(trimTransaction({ id: snap.id, ...snap.data() }));
      });
    }
    return NextResponse.json({ transactions: out });
  } catch (e) {
    return failure(e);
  }
}
