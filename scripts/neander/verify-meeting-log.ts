// ============================================================
//  회의 기록 확인 — 실제 Firestore 에 남기고 읽고 지운다
// ------------------------------------------------------------
//  npm run meetings:verify-log
//
//  1999-12-31 검증용 회의를 잠깐 만들어(팀 목록 맨 아래에 몇 초 보인다)
//  기록을 남기고, 최근 것이 위인지 · 회의와 함께 지워지는지 본다.
//  첨부·녹음을 지울 때 「무엇이었는지」 를 돌려주는지도 같이 본다 —
//  그 값이 없으면 「누가 무엇을 지웠다」 를 기록할 수 없다.
// ============================================================
import { config } from "dotenv";
config({ path: ".env.local" });

import { randomBytes } from "node:crypto";
import { adminDb } from "../../lib/neander/server/admin";
import { NEANDER_COL } from "../../lib/neander/collections";
import { deleteEventsOfMeeting, listMeetingEvents, logMeetingEvent } from "../../lib/neander/meetings/server/log";
import {
  completeMeetingFile,
  createMeetingFile,
  deleteMeetingFile,
  putMeetingFilePart,
} from "../../lib/neander/meetings/server/files";
import { meetingEventText, describeMeetingEdit } from "../../lib/neander/meetings/log";

const ME = "verify@neander.local";
const OTHER = "other@neander.local";
let failed = 0;
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? "✓" : "✗"} ${what}`);
  if (!ok) failed++;
};

async function main() {
  const db = adminDb();
  const now = Date.now();
  const meeting = await db.collection(NEANDER_COL.meetings).add({
    date: "1999-12-31",
    title: "[검증용 — 곧 지워짐]",
    content: "",
    actionItems: [],
    createdAt: now,
    updatedAt: now,
  });

  try {
    await logMeetingEvent(db, ME, meeting.id, "created");
    await new Promise((r) => setTimeout(r, 10));
    await logMeetingEvent(db, OTHER, meeting.id, "edited", "제목 · 회의 내용");

    const events = await listMeetingEvents(db, meeting.id);
    check(events.length === 2, `기록 2건 (받은 값 ${events.length})`);
    check(events[0]?.kind === "edited" && events[0]?.by === OTHER, "최근 기록이 맨 위 · 남긴 사람 그대로");
    check(meetingEventText(events[0]) === "회의록을 고쳤습니다 — 제목 · 회의 내용", "보여 줄 문장");
    check(events[1]?.kind === "created" && events[1]?.by === ME, "만든 기록도 남아 있다");

    await logMeetingEvent(db, ME, meeting.id, "file-added", "x".repeat(500));
    const long = (await listMeetingEvents(db, meeting.id))[0];
    check((long.detail ?? "").length === 200, `긴 설명은 200자로 자른다 (${(long.detail ?? "").length}자)`);

    // 다른 회의의 기록은 섞이지 않는다
    await logMeetingEvent(db, ME, "other-meeting-id", "created");
    check((await listMeetingEvents(db, meeting.id)).length === 3, "다른 회의의 기록은 안 섞인다");
    await deleteEventsOfMeeting(db, "other-meeting-id");

    // 첨부를 지울 때 무엇이었는지 — 기록에 쓸 값
    const bytes = randomBytes(1000);
    const { id: fileId } = await createMeetingFile(db, ME, { meetingId: meeting.id, name: "기록용.txt", size: bytes.length });
    await putMeetingFilePart(db, ME, fileId, 0, bytes);
    await completeMeetingFile(db, ME, fileId);
    const gone = await deleteMeetingFile(db, fileId);
    check(gone?.meetingId === meeting.id && gone?.name === "기록용.txt", "지운 첨부의 회의·이름을 돌려준다");
    check((await deleteMeetingFile(db, "aaaaaaaaaaaa1234")) === null, "이미 없는 파일을 지우면 null (기록 안 남김)");

    // 바뀐 것 요약 — 저장만 눌렀을 때는 기록하지 않는다
    const before = { date: "2026-09-21", title: "A", content: "본문", actionItems: [], links: [] };
    check(describeMeetingEdit(before, { ...before }) === null, "바뀐 게 없으면 기록하지 않는다");
    check(
      describeMeetingEdit(before, { ...before, title: "B", actionItems: [{ id: "1" }] }) === "제목 · 액션플랜",
      "바뀐 것만 적는다",
    );

    await deleteEventsOfMeeting(db, meeting.id);
    check((await listMeetingEvents(db, meeting.id)).length === 0, "회의를 지우면 기록도 사라진다");
  } finally {
    await meeting.delete().catch(() => undefined);
    await deleteEventsOfMeeting(db, meeting.id).catch(() => undefined);
  }

  console.log(failed ? `\n${failed}건 실패` : "\n모두 통과");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
