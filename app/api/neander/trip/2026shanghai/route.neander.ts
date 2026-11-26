import { NextResponse } from "next/server";
import { adminDb } from "@/lib/neander/server/admin";
import { TripOpError } from "@/lib/neander/trip/shanghai2026Ops";
import { changePlan, listHistory, loadPlan } from "@/lib/neander/trip/server/shanghai2026";

// ============================================================
//  상하이 출장 일정 — 읽기 · 고치기 (로그인 없음, 링크 아는 누구나)
// ------------------------------------------------------------
//  GET  /api/neander/trip/2026shanghai            → { v, plan, updatedAt, by }
//  GET  /api/neander/trip/2026shanghai?history=1  → { rows: [{ id, at, by, op, title, day }] }
//  POST /api/neander/trip/2026shanghai  { op:"add"|"update"|"delete", day?, id?, item?, place?, by? }
//                                       { op:"revert", historyId, by? }
//  사용자 결정(2026-11-26): 링크 타고 들어온 누구나 일정을 더하고 고치고 지울 수 있다.
//  지켜 주는 것은 ① 모양 검사(shanghai2026Ops) ② 바뀐 기록 + 되돌리기 ③ 서버 한 대당 분당 횟수 제한.
//  일정만 고칠 수 있다 — 다른 ERP 데이터에는 닿지 않는다.
// ============================================================

export const dynamic = "force-dynamic";
export const maxDuration = 20;

const HEADERS = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" };

// 서버 한 대(람다 인스턴스) 기준 아주 거친 제한 — 장난으로 몇백 번 누르는 것만 막는다
const hits = new Map<string, number[]>();
function limited(ip: string): boolean {
  const now = Date.now();
  const arr = (hits.get(ip) ?? []).filter((t) => now - t < 60_000);
  arr.push(now);
  hits.set(ip, arr);
  if (hits.size > 5000) hits.clear();
  return arr.length > 30;
}

export async function GET(req: Request) {
  try {
    const db = adminDb();
    if (new URL(req.url).searchParams.get("history")) {
      return NextResponse.json({ rows: await listHistory(db) }, { headers: HEADERS });
    }
    return NextResponse.json(await loadPlan(db), { headers: HEADERS });
  } catch (e) {
    console.error("[trip/2026shanghai] GET", e);
    return NextResponse.json({ error: "일정을 읽지 못했어요." }, { status: 500, headers: HEADERS });
  }
}

export async function POST(req: Request) {
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "?";
  if (limited(ip)) return NextResponse.json({ error: "너무 자주 바꾸고 있어요. 잠시 뒤에 해 주세요." }, { status: 429, headers: HEADERS });
  let body: Record<string, unknown>;
  try {
    const text = await req.text();
    if (text.length > 30_000) throw new Error("big");
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "요청을 읽지 못했어요." }, { status: 400, headers: HEADERS });
  }
  const by = typeof body.by === "string" ? body.by.replace(/[\u0000-\u001f]/g, "").trim().slice(0, 20) : "";
  try {
    const state = await changePlan(adminDb(), { op: body as never, by });
    return NextResponse.json(state, { headers: HEADERS });
  } catch (e) {
    if (e instanceof TripOpError) return NextResponse.json({ error: e.message }, { status: 400, headers: HEADERS });
    console.error("[trip/2026shanghai] POST", e);
    return NextResponse.json({ error: "저장하지 못했어요. 잠시 뒤에 다시 해 주세요." }, { status: 500, headers: HEADERS });
  }
}
