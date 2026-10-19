import { NextResponse } from "next/server";
import { adminDb } from "@/lib/neander/server/admin";
import { requireErpUser, accessErrorResponse } from "@/lib/neander/server/auth";
import { NEANDER_COL } from "@/lib/neander/collections";
import { runwayFromDoc, sanitizeRunway } from "@/lib/neander/finance/runway";

// 런웨이 가정 — 문서 하나를 읽고 통째로 쓴다.
//
// /data 에 싣지 않은 이유: 런웨이 화면 하나만 읽는 문서라, 재무에 들어올
// 때마다 받는 묶음(과 브라우저 캐시 모양)을 늘릴 까닭이 없다.
// 팀이 같은 가정을 본다 — 사람마다 따로 두면 회의에서 숫자가 갈린다.
export const dynamic = "force-dynamic";

const DOC_ID = "main";

function failure(e: unknown) {
  const denied = accessErrorResponse(e);
  if (denied) return denied;
  console.error("[finance/runway]", e);
  return NextResponse.json({ error: e instanceof Error ? e.message : "알 수 없는 오류" }, { status: 500 });
}

export async function GET(req: Request) {
  try {
    await requireErpUser(req);
    const snap = await adminDb().collection(NEANDER_COL.finRunway).doc(DOC_ID).get();
    return NextResponse.json({ settings: snap.exists ? runwayFromDoc(snap.data()) : null });
  } catch (e) {
    return failure(e);
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireErpUser(req);
    const body = (await req.json()) as { settings?: unknown };
    const settings = sanitizeRunway(body.settings);
    const doc = { ...settings, updatedAt: Date.now(), updatedBy: user.email ?? undefined };
    // Firestore 는 undefined 를 거부한다 — 항목 안의 빈 칸(note · to)까지 걷어 낸다
    const clean = JSON.parse(JSON.stringify(doc)) as Record<string, unknown>;
    // 배열·맵은 통째로 갈아치운다 — merge 하면 지운 가정이 되살아난다
    await adminDb().collection(NEANDER_COL.finRunway).doc(DOC_ID).set(clean, { merge: false });
    return NextResponse.json({ settings: runwayFromDoc(clean) });
  } catch (e) {
    return failure(e);
  }
}
