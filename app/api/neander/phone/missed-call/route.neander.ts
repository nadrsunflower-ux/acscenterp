import { NextResponse } from "next/server";
import { adminDb } from "@/lib/neander/server/admin";
import { smsTokenOk } from "@/lib/neander/finance/server/bank-sms";
import { ignoredMissedCall, notifyMissedCall, saveMissedCall } from "@/lib/neander/phone/server/missed-call";
import { normalizeNumber, parseMissedCallRequest } from "@/lib/neander/phone/missed-call";

// ============================================================
//  회사폰 부재중 전화 받기 — 회사폰(매크로드로이드 「부재중 전화」 트리거)이 부른다
// ------------------------------------------------------------
//  POST /api/neander/phone/missed-call?number=<번호>&name=<폰 연락처 이름>&at=<유닉스 초>
//    Authorization: Bearer <열쇠>   ← 은행 문자 매크로와 같은 열쇠 (sms-feed.tokenHash)
//    본문은 없어도 된다. JSON { number, name, at } · 폼 number=…&name=… 도 받는다.
//
//  매크로드로이드: 번호 = [call_number] · 이름 = [call_name] · 시각 = [system_time] (없어도 된다)
//  남기고(neander_phone_calls) 노션 「부재중전화」 표에 한 줄 + @멘션 댓글 (phone/server/missed-call.ts).
//  노션이 실패해도 응답은 200 — 저장은 끝났고, 다음 부재중 때 다시 보낸다.
//  설정 missed-call.ignore 에 든 번호는 남기지도 알리지도 않는다 (ignored: true).
// ============================================================

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const bearer = (req: Request) => {
  const h = req.headers.get("authorization") ?? "";
  return h.startsWith("Bearer ") ? h.slice(7).trim() : "";
};

export async function POST(req: Request) {
  const db = adminDb();
  if (!(await smsTokenOk(db, bearer(req)))) {
    return NextResponse.json({ error: "열쇠가 올바르지 않습니다." }, { status: 401 });
  }
  const url = new URL(req.url);
  const type = (req.headers.get("content-type") ?? "").slice(0, 80);
  // 본문 종류 머리는 믿지 않는다 — 매크로드로이드에서 고른 종류와 실제 모양이 다를 수 있다
  // (2026-11-17 첫 실제 부재중은 번호 · 이름이 비어서 왔다). 모양을 보고 읽고, 요청 원문을 남긴다
  let body = "";
  try {
    body = (await req.text()).slice(0, 2000);
  } catch {
    return NextResponse.json({ error: "본문을 읽지 못했습니다." }, { status: 400 });
  }
  const { number, name, at: atRaw } = parseMissedCallRequest(body, url.searchParams);
  const atNum = Number(atRaw);
  const at = atNum > 0 ? (atNum < 1e12 ? atNum * 1000 : atNum) : undefined;

  // 무시할 번호(설정 missed-call.ignore)면 남기지도 알리지도 않는다
  if (await ignoredMissedCall(db, number)) {
    return NextResponse.json({ ok: true, ignored: true, number: normalizeNumber(number) || null });
  }

  const r = await saveMissedCall(db, { number, name, at, request: { type, body, query: url.search.slice(0, 500) } });
  const notion = r.duplicate ? null : await notifyMissedCall(db, r.id);
  if (notion?.error) console.error("[phone/missed-call] 노션 알림", notion.error);
  return NextResponse.json({
    ok: true,
    id: r.id,
    duplicate: r.duplicate,
    number: r.doc.number || null,
    name: r.doc.name || null,
    notion: notion?.state ?? notion?.skipped ?? null,
  });
}
