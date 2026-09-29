import { NextResponse } from "next/server";
import { adminDb } from "@/lib/neander/server/admin";
import { requireErpUser, accessErrorResponse } from "@/lib/neander/server/auth";
import {
  deleteScenario,
  isSlug,
  listScenarios,
  sanitizeScenarioValues,
  saveScenario,
} from "@/lib/neander/decks/server/store";

// ============================================================
//  회의용 저장본 — 장표 가정값 한 벌에 이름을 붙여 팀이 같이 불러 쓴다
// ------------------------------------------------------------
//  GET              이 장표의 저장본 목록 (최신순)
//  POST {name, values}   새 저장본 (만든 사람은 서버가 로그인에서 찍는다)
//  DELETE ?id=      만든 사람만 지운다
//  브라우저 저장(localStorage)·공유 링크와 달리 기기가 바뀌어도 남는다.
// ============================================================

export const dynamic = "force-dynamic";

const HEADERS = { "Cache-Control": "private, no-store" };

function failure(e: unknown, fallback = 500) {
  const denied = accessErrorResponse(e);
  if (denied) return denied;
  const msg = e instanceof Error ? e.message : "알 수 없는 오류";
  return NextResponse.json({ error: msg }, { status: fallback, headers: HEADERS });
}

export async function GET(req: Request, { params }: { params: { slug: string } }) {
  try {
    await requireErpUser(req);
    if (!isSlug(params.slug)) return NextResponse.json({ error: "주소가 올바르지 않습니다." }, { status: 400 });
    return NextResponse.json({ scenarios: await listScenarios(adminDb(), params.slug) }, { headers: HEADERS });
  } catch (e) {
    return failure(e);
  }
}

export async function POST(req: Request, { params }: { params: { slug: string } }) {
  let email: string;
  try {
    email = (await requireErpUser(req)).email;
  } catch (e) {
    return failure(e);
  }
  try {
    if (!isSlug(params.slug)) return NextResponse.json({ error: "주소가 올바르지 않습니다." }, { status: 400 });
    const body = (await req.json()) as { name?: unknown; values?: unknown };
    const scenario = await saveScenario(
      adminDb(),
      params.slug,
      String(body.name ?? ""),
      sanitizeScenarioValues(body.values),
      email,
    );
    return NextResponse.json({ scenario }, { headers: HEADERS });
  } catch (e) {
    return failure(e, 400);
  }
}

export async function DELETE(req: Request, { params }: { params: { slug: string } }) {
  let email: string;
  try {
    email = (await requireErpUser(req)).email;
  } catch (e) {
    return failure(e);
  }
  try {
    if (!isSlug(params.slug)) return NextResponse.json({ error: "주소가 올바르지 않습니다." }, { status: 400 });
    const id = new URL(req.url).searchParams.get("id") ?? "";
    await deleteScenario(adminDb(), params.slug, id, email);
    return NextResponse.json({ ok: true }, { headers: HEADERS });
  } catch (e) {
    return failure(e, 400);
  }
}
