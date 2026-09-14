import { NextResponse } from "next/server";
import { adminDb } from "@/lib/neander/server/admin";
import { requireErpUser, accessErrorResponse } from "@/lib/neander/server/auth";
import { NEANDER_COL } from "@/lib/neander/collections";
import { AI_BATCH_LIMIT, suggestClassifications } from "@/lib/neander/finance/server/ai-classify";
import type { FinAccountDoc } from "@/lib/neander/finance/db-types";
import type { FinTransaction } from "@/lib/neander/finance/types";

// ============================================================
//  AI 분류 추천
// ------------------------------------------------------------
//  클라이언트는 거래 **id 만** 보낸다. 거래 내용·계정 마스터·과거 이력은
//  서버가 Firestore 에서 직접 읽는다 — 프롬프트에 들어가는 재료를
//  클라이언트가 주면 무엇이 모델에 갔는지 서버가 알 수 없다.
//
//  결과는 저장하지 않고 돌려준다. 적용은 사람이 화면에서 확인한 뒤
//  기존 저장 경로(transaction.applyEdits)로 나간다.
// ============================================================

export const dynamic = "force-dynamic";
/** 모델 호출이 길어질 수 있다 (adaptive thinking + effort high) */
export const maxDuration = 300;

export async function POST(req: Request) {
  try {
    await requireErpUser(req);
  } catch (e) {
    const denied = accessErrorResponse(e);
    if (denied) return denied;
    throw e;
  }

  try {
    const { ids } = (await req.json()) as { ids?: string[] };
    if (!Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: "ids 배열이 필요합니다." }, { status: 400 });
    }
    if (ids.length > AI_BATCH_LIMIT) {
      return NextResponse.json(
        { error: `한 번에 최대 ${AI_BATCH_LIMIT}건까지 물어볼 수 있습니다.` },
        { status: 400 },
      );
    }

    const db = adminDb();
    const [txSnap, acctSnap] = await Promise.all([
      db.collection(NEANDER_COL.finTransactions).get(),
      db.collection(NEANDER_COL.finAccounts).get(),
    ]);

    const all = txSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as FinTransaction[];
    const accounts = acctSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as FinAccountDoc[];
    if (accounts.length === 0) {
      return NextResponse.json(
        { error: "계정 마스터가 비어 있습니다. 마스터 탭에서 먼저 적재해주세요." },
        { status: 400 },
      );
    }

    const wanted = new Set(ids);
    const items = all.filter((t) => wanted.has(t.id));
    if (items.length === 0) {
      return NextResponse.json({ error: "해당 거래를 찾지 못했습니다." }, { status: 404 });
    }

    const result = await suggestClassifications({ items, history: all, accounts });
    return NextResponse.json(result);
  } catch (e) {
    console.error("[finance/ai/suggest]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "AI 추천에 실패했습니다." },
      { status: 500 },
    );
  }
}
