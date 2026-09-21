import { NextResponse } from "next/server";
import { adminDb } from "@/lib/neander/server/admin";
import { accessErrorResponse, requireMember } from "@/lib/neander/server/auth";
import { deleteEventsOfMeeting, listMeetingEvents, logMeetingEvent } from "@/lib/neander/meetings/server/log";
import { NEANDER_COL } from "@/lib/neander/collections";
import type { MeetingEventKind } from "@/lib/neander/meetings/log";

// 회의 기록 — 누가 무엇을 했는가. 남기는 사람은 서버가 찍는다 (meetings/server/log.ts)
export const dynamic = "force-dynamic";

/**
 * 브라우저가 남길 수 있는 일 — 회의 문서를 브라우저가 직접 고치기 때문이다.
 * 첨부·녹음·AI 는 서버가 그 일을 하는 자리에서 남긴다 (여기로 안 받는다).
 */
const FROM_BROWSER: MeetingEventKind[] = ["created", "edited", "agenda-linked", "agenda-unlinked"];

function failure(e: unknown) {
  const denied = accessErrorResponse(e);
  if (denied) return denied;
  return NextResponse.json({ error: e instanceof Error ? e.message : "알 수 없는 오류" }, { status: 400 });
}

export async function GET(req: Request) {
  try {
    await requireMember(req);
    const db = adminDb();
    const meetingId = new URL(req.url).searchParams.get("meetingId") ?? "";
    // 회의가 사라졌으면(화면 밖에서 지운 경우) 기록도 치운다 — 첨부와 같은 방식
    if (meetingId && !(await db.collection(NEANDER_COL.meetings).doc(meetingId).get()).exists) {
      await deleteEventsOfMeeting(db, meetingId);
      return NextResponse.json({ events: [] });
    }
    return NextResponse.json({ events: await listMeetingEvents(db, meetingId) });
  } catch (e) {
    return failure(e);
  }
}

export async function POST(req: Request) {
  try {
    const { email: me } = await requireMember(req);
    const body = (await req.json()) as {
      action?: string;
      meetingId?: string;
      kind?: MeetingEventKind;
      detail?: string;
    };
    // 회의를 지울 때 — 그 회의의 기록도 함께 지운다 (첨부·녹음과 같다)
    if (body.action === "delete-meeting") {
      await deleteEventsOfMeeting(adminDb(), body.meetingId);
      return NextResponse.json({ ok: true });
    }
    if (!body.kind || !FROM_BROWSER.includes(body.kind)) throw new Error("남길 수 없는 기록입니다.");
    await logMeetingEvent(adminDb(), me, body.meetingId, body.kind, body.detail);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}
