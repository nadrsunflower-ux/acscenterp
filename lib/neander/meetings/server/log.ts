import "server-only";

// ============================================================
//  회의 기록 저장소 — neander_meeting_log
// ------------------------------------------------------------
//  한 일 하나가 문서 하나다 (회의 문서 안 배열로 두면 같은 순간에 두 사람이
//  손댈 때 서로의 줄을 덮어쓴다).
//
//    neander_meeting_log/{id}   회의 id · 언제 · 누가 · 무엇을 · 자세히
//
//  첨부와 같은 자리에 있다 — 보안 규칙에 없어 브라우저는 못 읽고 서버 API
//  (app/api/neander/meetings/log)를 거친다. 그래서 남기는 사람 이름을
//  브라우저가 고를 수 없다 (requireMember 의 이메일을 서버가 찍는다).
//
//  회의를 지우면 그 회의의 기록도 지운다. 회의가 사라진 기록은 목록을 읽을
//  때 치운다 (첨부와 같은 방식 — files.ts).
// ============================================================

import type { Firestore } from "firebase-admin/firestore";
import { NEANDER_COL } from "@/lib/neander/collections";
import type { MeetingEvent, MeetingEventKind } from "../log";

/** 한 회의에서 보여 주는 최대 줄 수 — 더 오래된 것은 읽지 않는다 */
const MAX_SHOWN = 200;

const col = (db: Firestore) => db.collection(NEANDER_COL.meetingLog);

export async function logMeetingEvent(
  db: Firestore,
  by: string,
  meetingId: unknown,
  kind: MeetingEventKind,
  detail?: string,
): Promise<void> {
  if (typeof meetingId !== "string" || !meetingId) return;
  const doc: Omit<MeetingEvent, "id"> = { meetingId, at: Date.now(), by, kind };
  if (detail) doc.detail = detail.slice(0, 200);
  await col(db).add(doc);
}

/** 한 회의의 기록 — 최근 것이 위 */
export async function listMeetingEvents(db: Firestore, meetingId: unknown): Promise<MeetingEvent[]> {
  if (typeof meetingId !== "string" || !meetingId) return [];
  // meetingId 하나로만 거른다 — 정렬까지 서버에 맡기면 복합 색인이 필요하다
  const snap = await col(db).where("meetingId", "==", meetingId).get();
  return snap.docs
    .map((d) => ({ id: d.id, ...(d.data() as Omit<MeetingEvent, "id">) }))
    .sort((a, b) => b.at - a.at)
    .slice(0, MAX_SHOWN);
}

/** 회의를 지울 때 — 그 회의의 기록도 지운다 */
export async function deleteEventsOfMeeting(db: Firestore, meetingId: unknown): Promise<void> {
  if (typeof meetingId !== "string" || !meetingId) return;
  const snap = await col(db).where("meetingId", "==", meetingId).get();
  for (let i = 0; i < snap.docs.length; i += 400) {
    const batch = db.batch();
    snap.docs.slice(i, i + 400).forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }
}
