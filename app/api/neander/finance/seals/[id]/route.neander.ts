import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { adminDb } from "@/lib/neander/server/admin";
import { requireErpUser, accessErrorResponse } from "@/lib/neander/server/auth";
import { NEANDER_COL } from "@/lib/neander/collections";
import { SEALS } from "@/lib/neander/finance/supplier";

// ============================================================
//  견적서 인감 이미지 — 로그인한 재무 사용자에게만
// ------------------------------------------------------------
//  도장 파일은 깃에 없다(public 저장소). public/ 에 두면 로그인과 무관하게
//  누구나 주소로 열 수 있으니 거기도 안 된다. 그래서 Firestore
//  neander_fin_seals 에 넣어 두고(scripts/neander/upload-seals.ts), 이
//  라우트가 신원을 확인한 뒤에만 바이트를 내준다. 그 컬렉션은 보안 규칙에
//  없어 클라이언트가 직접 읽지 못한다.
//
//  <img src> 는 Authorization 헤더를 못 싣는다 — 클라이언트가 fetch 로 받아
//  data: URL 로 바꿔 쓴다(finance/seal-image.ts). 인쇄창에도 그대로 실린다.
//
//  Firestore 에 없으면 로컬의 public/images/seals/{id}.png 를 본다 — 도장
//  파일을 내려받아 둔 개발 PC 에서 올리기 전에도 찍히게. 배포본에는 그
//  파일이 없으니 404 가 된다.
// ============================================================

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: { id: string } }) {
  try {
    await requireErpUser(req);
  } catch (e) {
    const denied = accessErrorResponse(e);
    if (denied) return denied;
    throw e;
  }

  // 등록된 도장만 — 아무 문서 id 나 받으면 컬렉션을 뒤지는 통로가 된다
  const id = String(params.id ?? "");
  if (!SEALS.some((s) => s.id === id)) {
    return NextResponse.json({ error: "등록되지 않은 인감입니다." }, { status: 404 });
  }

  try {
    const snap = await adminDb().collection(NEANDER_COL.finSeals).doc(id).get();
    const doc = snap.data() as { data?: Buffer | Uint8Array; mime?: string } | undefined;
    let bytes: Uint8Array | null = doc?.data ? new Uint8Array(doc.data) : null;
    let mime = doc?.mime || "image/png";
    if (!bytes) {
      bytes = await readFile(path.join(process.cwd(), "public/images/seals", `${id}.png`)).catch(() => null);
      mime = "image/png";
    }
    if (!bytes) {
      return NextResponse.json(
        { error: "인감 이미지가 올라가 있지 않습니다. npm run finance:upload-seals 로 올려 주세요." },
        { status: 404 },
      );
    }
    return new Response(bytes, {
      headers: {
        "Content-Type": mime,
        // 브라우저 한 사람에게만 — 공유 캐시(CDN)에 인감이 남으면 안 된다
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    console.error("[finance/seals GET]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "인감을 불러오지 못했습니다." },
      { status: 500 },
    );
  }
}
