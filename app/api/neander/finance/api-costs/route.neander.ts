import { NextResponse } from "next/server";
import { adminDb } from "@/lib/neander/server/admin";
import { requireErpUser, accessErrorResponse } from "@/lib/neander/server/auth";
import { managementKey } from "@/lib/neander/shorts/server/ai-usage";
import {
  apiCostView,
  deleteKeyRange,
  pushProjectCost,
  saveApiSettings,
  setKeyDefault,
  setKeyRange,
  syncApiDays,
  ApiCostInputError,
  MAX_SYNC_DAYS,
} from "@/lib/neander/finance/server/api-cost";

// ============================================================
//  API 비용 — 오픈라우터 키마다 붙일 곳 (lib/neander/finance/server/api-cost.ts)
// ------------------------------------------------------------
//  GET  — 화면 하나 분량. 빠진 날이 있으면 오픈라우터에서 먼저 받아 쌓는다.
//  POST { action, … }
//    key.default    { hash, name, target|null }
//    key.range      { hash, name, from, to?, target|null, note? }   — 시간 구간 하나
//    key.spans      { hash, name, spans[], target|null }           — 고른 날 · 시간들
//    key.rangeDelete{ hash, id }
//    settings       { krwPerUsd }
//    project.push   { projectId, removeLineIds? }                  — 재무 프로젝트 원가로 보내기
//    sync           { back?, force? }                              — 오픈라우터에서 다시 받기
//  권한은 재무와 같다. 새 컬렉션은 보안 규칙에 없어 서버로만 읽고 쓴다.
// ============================================================

export const dynamic = "force-dynamic";

/** 요청 몸 — 값은 서버 함수가 하나씩 확인한다 */
type Body = {
  action?: string;
  hash?: unknown;
  name?: unknown;
  target?: unknown;
  from?: unknown;
  to?: unknown;
  spans?: unknown;
  note?: unknown;
  id?: unknown;
  krwPerUsd?: unknown;
  projectId?: unknown;
  removeLineIds?: unknown;
  back?: unknown;
  force?: unknown;
};
export const maxDuration = 300;

function fail(e: unknown) {
  const denied = accessErrorResponse(e);
  if (denied) return denied;
  console.error("[finance/api-costs]", e);
  return NextResponse.json({ error: e instanceof Error ? e.message : "알 수 없는 오류" }, { status: 500 });
}

export async function GET(req: Request) {
  try {
    await requireErpUser(req);
    if (!managementKey()) return NextResponse.json({ configured: false });
    return NextResponse.json({ configured: true, view: await apiCostView(adminDb()) });
  } catch (e) {
    return fail(e);
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireErpUser(req);
    const body = (await req.json().catch(() => ({}))) as Body;
    const db = adminDb();
    const bad = (msg: string) => NextResponse.json({ error: msg }, { status: 400 });
    try {
      switch (body.action) {
        case "key.default":
          return NextResponse.json({ ok: true, alloc: await setKeyDefault(db, user.email, body) });
        case "key.range":
          return NextResponse.json({ ok: true, alloc: await setKeyRange(db, user.email, { ...body, spans: undefined }) });
        case "key.spans":
          if (!Array.isArray(body.spans)) return bad("고른 시간이 없습니다.");
          return NextResponse.json({ ok: true, alloc: await setKeyRange(db, user.email, body) });
        case "key.rangeDelete":
          return NextResponse.json({ ok: true, alloc: await deleteKeyRange(db, user.email, body) });
        case "settings":
          return NextResponse.json({ ok: true, settings: await saveApiSettings(db, user.email, body) });
        case "project.push":
          return NextResponse.json({ ok: true, ...(await pushProjectCost(db, user.email, body)) });
        case "sync": {
          if (!managementKey()) return bad("OPENROUTER_MANAGEMENT_KEY 가 설정되지 않았습니다.");
          const back = typeof body.back === "number" ? Math.min(MAX_SYNC_DAYS, body.back) : 3;
          return NextResponse.json({ ok: true, ...(await syncApiDays(db, { back, force: body.force === true })) });
        }
        default:
          return bad("알 수 없는 요청입니다.");
      }
    } catch (e) {
      // 입력이 잘못된 것 (붙일 곳 · 날짜 · 키) 은 400 으로
      if (e instanceof ApiCostInputError) return bad(e.message);
      throw e;
    }
  } catch (e) {
    return fail(e);
  }
}
