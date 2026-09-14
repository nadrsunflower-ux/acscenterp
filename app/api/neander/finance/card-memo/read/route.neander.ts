import { NextResponse } from "next/server";
import { requireErpUser, accessErrorResponse } from "@/lib/neander/server/auth";
import { adminDb } from "@/lib/neander/server/admin";
import { NEANDER_COL } from "@/lib/neander/collections";
import { readReceipt, MAX_IMAGES } from "@/lib/neander/finance/server/ai-receipt";
import type { FinPaymentMethodDoc } from "@/lib/neander/finance/db-types";

// ============================================================
//  결제 캡처 읽기 — 화면을 채워 주기만 한다
// ------------------------------------------------------------
//  ⚠️ 이 라우트는 **아무것도 저장하지 않는다.** 읽은 값을 돌려줄 뿐이고,
//     사람이 화면에서 확인·수정한 뒤 기존 저장 경로로 나간다. 모델이
//     금액을 잘못 읽고 그게 그대로 장부에 들어가는 게 최악이다.
//
//  사진도 저장하지 않는다. 그래서 Firebase Storage 가 꺼져 있는 지금도
//  이 기능은 동작한다.
// ============================================================

export const dynamic = "force-dynamic";
/** 모델 왕복 2~4초 */
export const maxDuration = 60;

/** 브라우저에서 미리 줄여 보내지만, 안 줄여진 것도 막아 둔다 */
const MAX_BYTES = 8 * 1024 * 1024;

export async function POST(req: Request) {
  try {
    await requireErpUser(req);
  } catch (e) {
    const denied = accessErrorResponse(e);
    if (denied) return denied;
    throw e;
  }

  try {
    const form = await req.formData();
    const files = form
      .getAll("photos")
      .filter((f): f is File => f instanceof File && f.size > 0)
      .slice(0, MAX_IMAGES);

    if (files.length === 0) {
      return NextResponse.json({ error: "읽을 사진이 없습니다." }, { status: 400 });
    }
    const tooBig = files.find((f) => f.size > MAX_BYTES);
    if (tooBig) {
      return NextResponse.json(
        { error: `사진이 너무 큽니다 (${Math.round(tooBig.size / 1024 / 1024)}MB). 다시 시도해 주세요.` },
        { status: 400 },
      );
    }

    const images = await Promise.all(
      files.map(async (f) => {
        const b64 = Buffer.from(await f.arrayBuffer()).toString("base64");
        return `data:${f.type || "image/jpeg"};base64,${b64}`;
      }),
    );

    // 화면에서 읽은 카드번호를 등록된 카드와 맞춰 보게 한다
    const pmSnap = await adminDb().collection(NEANDER_COL.finPaymentMethods).get();
    const knownLast4 = (pmSnap.docs.map((d) => d.data()) as FinPaymentMethodDoc[])
      .filter((p) => p.kind === "card")
      .map((p) => p.last4);

    const read = await readReceipt({ images, knownLast4 });
    return NextResponse.json(read);
  } catch (e) {
    console.error("[finance/card-memo/read]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "사진을 읽지 못했습니다." },
      { status: 500 },
    );
  }
}
