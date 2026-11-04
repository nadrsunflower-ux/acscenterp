import { NextResponse } from "next/server";
import { adminDb } from "@/lib/neander/server/admin";
import { requireShortsUser } from "@/lib/neander/shorts/server/access";
import { fail, json } from "@/lib/neander/shorts/server/http";
import { deleteShortsChat, getShortsChat, listShortsChats } from "@/lib/neander/shorts/server/assistant";
import { summaryOf } from "@/lib/neander/ai/chat-log";

// ============================================================
//  AI STUDIO 비서 대화 목록 / 불러오기 / 삭제
// ------------------------------------------------------------
//  GET            내 대화 요약 목록 (본문 없이)
//  GET ?id=       내 대화 하나
//  DELETE ?id=    내 대화 지우기
//  대화는 사람마다 비공개 · 프로젝트로 감싸지 않는 전역 컬렉션이다 (어느 프로젝트에서 물었는지는
//  문서의 spaceId · spaceIds). 목록에도 불러오기에도 **소유자를 서버에서 확인**한다 — id 만 알면
//  남의 대화가 열리면 안 된다 (매출 비서와 같다).
// ============================================================

export const dynamic = "force-dynamic";

const notFound = () => NextResponse.json({ error: "대화를 찾을 수 없습니다." }, { status: 404 });

export async function GET(req: Request) {
  try {
    const { email } = await requireShortsUser(req);
    const db = adminDb();
    const id = new URL(req.url).searchParams.get("id");
    if (id) {
      const chat = await getShortsChat(db, email, id);
      return chat ? json({ chat }) : notFound();
    }
    const chats = (await listShortsChats(db, email)).map((d) => summaryOf(d)).sort((a, b) => b.updatedAt - a.updatedAt);
    return json({ chats });
  } catch (e) {
    return fail(e);
  }
}

export async function DELETE(req: Request) {
  try {
    const { email } = await requireShortsUser(req);
    const id = new URL(req.url).searchParams.get("id");
    if (!id) throw new Error("id 가 필요합니다.");
    return (await deleteShortsChat(adminDb(), email, id)) ? json({ ok: true }) : notFound();
  } catch (e) {
    return fail(e);
  }
}
