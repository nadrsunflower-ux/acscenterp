import { NextResponse } from "next/server";
import { adminDb } from "@/lib/neander/server/admin";
import { requireErpUser, accessErrorResponse } from "@/lib/neander/server/auth";
import { NEANDER_COL } from "@/lib/neander/collections";
import { summaryOf, type AssistantChatDoc } from "@/lib/neander/ai/chat-log";

// ============================================================
//  매출 비서 대화 목록 / 불러오기 / 삭제
// ------------------------------------------------------------
//  대화는 사람마다 따로 쌓인다. 목록에도 불러오기에도 **소유자를 서버에서
//  확인**한다 — id 만 알면 남의 대화가 열리면 안 된다.
//  목록은 본문 없이 요약만 준다.
// ============================================================

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  let user;
  try {
    user = await requireErpUser(req);
  } catch (e) {
    const denied = accessErrorResponse(e);
    if (denied) return denied;
    throw e;
  }

  try {
    const db = adminDb();
    const id = new URL(req.url).searchParams.get("id");

    if (id) {
      const snap = await db.collection(NEANDER_COL.salesChats).doc(id).get();
      const doc = snap.exists ? ({ id: snap.id, ...snap.data() } as AssistantChatDoc) : null;
      if (!doc || doc.owner !== user.email) {
        return NextResponse.json({ error: "대화를 찾을 수 없습니다." }, { status: 404 });
      }
      return NextResponse.json({ chat: doc });
    }

    const snap = await db
      .collection(NEANDER_COL.salesChats)
      .where("owner", "==", user.email)
      .get();
    const chats = snap.docs
      .map((d) => summaryOf({ id: d.id, ...d.data() } as AssistantChatDoc))
      .sort((a, b) => b.updatedAt - a.updatedAt);
    return NextResponse.json({ chats });
  } catch (e) {
    console.error("[sales/ai/chats GET]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "대화를 불러오지 못했습니다." },
      { status: 500 },
    );
  }
}

export async function DELETE(req: Request) {
  let user;
  try {
    user = await requireErpUser(req);
  } catch (e) {
    const denied = accessErrorResponse(e);
    if (denied) return denied;
    throw e;
  }

  try {
    const id = new URL(req.url).searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id 가 필요합니다." }, { status: 400 });
    const ref = adminDb().collection(NEANDER_COL.salesChats).doc(id);
    const snap = await ref.get();
    const doc = snap.data() as AssistantChatDoc | undefined;
    if (!snap.exists || doc?.owner !== user.email) {
      return NextResponse.json({ error: "대화를 찾을 수 없습니다." }, { status: 404 });
    }
    await ref.delete();
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[sales/ai/chats DELETE]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "삭제에 실패했습니다." },
      { status: 500 },
    );
  }
}
