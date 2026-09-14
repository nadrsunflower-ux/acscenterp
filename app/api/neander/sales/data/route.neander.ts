import { NextResponse } from "next/server";
import { adminDb } from "@/lib/neander/server/admin";
import { requireErpUser, accessErrorResponse } from "@/lib/neander/server/auth";
import { NEANDER_COL } from "@/lib/neander/collections";
import { loadLaborActuals } from "@/lib/neander/sales/server/labor";
import { trimLine } from "@/lib/neander/sales/payload";

// 매출 단위경제 데이터 조회.
//
// 재무와 같은 인증 게이트를 쓴다 — 매장 상품별 원가·공헌이익은 재무와
// 같은 등급의 경영 정보다. 별도 허용목록을 만들면 한쪽만 잠기는 일이
// 생긴다 (NEANDER_FINANCE_EMAILS 하나로 둔다).
//
// ⚠️ 파일명이 route.neander.ts 인 이유: next.config.mjs 의 pageExtensions
//    분기로 매장(ACSCENT) 빌드에서 제외하기 위해서다.
//
// 두 가지로 받는다 (SalesProvider 가 고른다 — 재무 data 라우트와 같은 규칙):
//   GET            전부 (full)
//   GET ?since=ms  그 뒤로 바뀐 판매 줄 + 지금 있는 줄 id 전부 (delta).
//                  상품·이벤트·기본가정·인건비 집계는 작아서 늘 전부 보낸다.
//   POST {ids}     id 로 판매 줄 몇 건 — 캐시에 없는 줄을 채울 때
export const dynamic = "force-dynamic";

const readAll = async (col: string) => {
  const snap = await adminDb().collection(col).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
};

async function readLinePart(since: number | null) {
  const col = adminDb().collection(NEANDER_COL.salesLines);
  if (since === null) {
    const snap = await col.get();
    return {
      lines: snap.docs.map((d) => trimLine({ id: d.id, ...d.data() })),
      lineIds: undefined as string[] | undefined,
    };
  }
  const [updated, created, ids] = await Promise.all([
    col.where("updatedAt", ">", since).get(),
    col.where("createdAt", ">", since).get(),
    col.select().get(),
  ]);
  const byId = new Map<string, Record<string, unknown>>();
  [...updated.docs, ...created.docs].forEach((d) => byId.set(d.id, trimLine({ id: d.id, ...d.data() })));
  return { lines: [...byId.values()], lineIds: ids.docs.map((d) => d.id) };
}

function failure(e: unknown) {
  const denied = accessErrorResponse(e);
  if (denied) return denied;
  console.error("[sales/data]", e);
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

    const [linePart, products, events, imports, assumptionsSnap, labor] = await Promise.all([
      readLinePart(since),
      readAll(NEANDER_COL.salesProducts),
      readAll(NEANDER_COL.salesEvents),
      readAll(NEANDER_COL.salesImports),
      adminDb().collection(NEANDER_COL.salesAssumptions).doc("current").get(),
      // 근무 일지 실측 인건비 — 원본 근무 기록이 아니라 월 × 매장 집계만 보낸다.
      // 못 읽어도 매출 화면은 떠야 하므로 null(= 인건비 전부 가정값)로 물러선다.
      loadLaborActuals(adminDb()).catch((e) => {
        console.error("[sales/data] 근무 일지 집계 실패", e);
        return null;
      }),
    ]);

    // 정렬은 서버에서 끝내둔다 — 클라이언트가 매번 다시 정렬할 이유가 없다
    linePart.lines.sort((a, b) => String(b.date ?? "").localeCompare(String(a.date ?? "")));
    events.sort((a, b) =>
      String((b as { from?: string }).from ?? "").localeCompare(
        String((a as { from?: string }).from ?? ""),
      ),
    );
    imports.sort(
      (a, b) =>
        Number((b as { createdAt?: number }).createdAt ?? 0) -
        Number((a as { createdAt?: number }).createdAt ?? 0),
    );
    products.sort((a, b) =>
      String((a as { id?: string }).id ?? "").localeCompare(String((b as { id?: string }).id ?? "")),
    );

    return NextResponse.json({
      mode: since === null ? "full" : "delta",
      serverTime,
      lines: linePart.lines,
      lineIds: linePart.lineIds,
      products,
      events,
      imports,
      assumptions: assumptionsSnap.exists
        ? { id: assumptionsSnap.id, ...assumptionsSnap.data() }
        : null,
      labor,
    });
  } catch (e) {
    return failure(e);
  }
}

export async function POST(req: Request) {
  try {
    await requireErpUser(req);
    const { ids } = (await req.json()) as { ids?: string[] };
    if (!Array.isArray(ids) || ids.length === 0) return NextResponse.json({ lines: [] });
    if (ids.length > 5000) {
      return NextResponse.json({ error: "한 번에 5,000건까지 받을 수 있습니다." }, { status: 400 });
    }
    const db = adminDb();
    const col = db.collection(NEANDER_COL.salesLines);
    const out: Record<string, unknown>[] = [];
    for (let i = 0; i < ids.length; i += 300) {
      const snaps = await db.getAll(...ids.slice(i, i + 300).map((id) => col.doc(String(id))));
      snaps.forEach((snap) => {
        if (snap.exists) out.push(trimLine({ id: snap.id, ...snap.data() }));
      });
    }
    return NextResponse.json({ lines: out });
  } catch (e) {
    return failure(e);
  }
}
