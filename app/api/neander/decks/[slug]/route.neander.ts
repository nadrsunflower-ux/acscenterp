import { NextResponse } from "next/server";
import { adminDb } from "@/lib/neander/server/admin";
import { requireErpUser, accessErrorResponse } from "@/lib/neander/server/auth";
import { isSlug, readDeckContent } from "@/lib/neander/decks/server/store";
import { loadDeckActuals } from "@/lib/neander/decks/server/load";
import type { DeckPayload } from "@/lib/neander/decks/types";

// ============================================================
//  회의 발표 장표 — 내용 + 실측값
// ------------------------------------------------------------
//  장표에는 학원 이름·매출·거래처가 들어 있어 재무와 같은 게이트를 쓴다
//  (NEANDER_FINANCE_EMAILS). 내용은 저장소가 아니라 Firestore 에 있고
//  (decks/server/store.ts), 실측은 재무·스모트 컬렉션을 직접 읽어 만든다.
//
//  실측 한쪽을 못 읽어도 장표는 열린다 — errors 에 이유를 싣고, 화면은
//  그 부분에 내용의 스냅샷을 쓰며 「스냅샷 값 사용 중」을 띄운다.
//
//  ⚠️ 파일명이 route.neander.ts 인 이유: 매장(ACSCENT) 빌드에서 빼기 위해서다.
// ============================================================

export const dynamic = "force-dynamic";
// 원장 1만여 건을 필드 몇 개만 골라 읽는다 — 보통 몇 초
export const maxDuration = 60;

const HEADERS = {
  // 브라우저 한 사람에게만 — 공유 캐시(CDN)에 내부 숫자가 남으면 안 된다
  "Cache-Control": "private, no-store",
  "X-Robots-Tag": "noindex, nofollow",
};

export async function GET(req: Request, { params }: { params: { slug: string } }) {
  try {
    await requireErpUser(req);
  } catch (e) {
    const denied = accessErrorResponse(e);
    if (denied) return denied;
    throw e;
  }
  const slug = String(params.slug ?? "");
  if (!isSlug(slug)) return NextResponse.json({ error: "장표 주소가 올바르지 않습니다." }, { status: 400, headers: HEADERS });

  try {
    const db = adminDb();
    const found = await readDeckContent(db, slug);
    if (!found) {
      return NextResponse.json(
        { error: "장표 내용이 올라가 있지 않습니다. npm run deck:upload -- --apply 로 올려 주세요." },
        { status: 404, headers: HEADERS },
      );
    }
    const { actuals, errors } = await loadDeckActuals(db, found.content.rules);
    const body: DeckPayload = {
      content: found.content,
      actuals,
      errors,
      source: found.source,
      serverTime: Date.now(),
    };
    return NextResponse.json(body, { headers: HEADERS });
  } catch (e) {
    console.error("[decks GET]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "장표를 불러오지 못했습니다." },
      { status: 500, headers: HEADERS },
    );
  }
}
