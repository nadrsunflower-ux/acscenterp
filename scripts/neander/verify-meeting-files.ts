// ============================================================
//  회의 첨부 저장소 확인 — 실제 Firestore 에 올리고 읽고 지운다
// ------------------------------------------------------------
//  npm run meetings:verify-files
//  (server-only 를 통과하려면 react-server 조건이 필요하다 — package.json)
//
//  1999-12-31 날짜의 검증용 회의를 잠깐 만들어(팀 목록 맨 아래에 몇 초
//  보인다) 파일을 붙이고, 바이트가 그대로 돌아오는지 · 회의와 함께 지워지는지 ·
//  화면 밖에서 회의만 지워진 파일을 서버가 치우는지 본다. 끝나면 모두 지운다.
// ============================================================
import { config } from "dotenv";
config({ path: ".env.local" });

import { randomBytes } from "node:crypto";
import { adminDb } from "../../lib/neander/server/admin";
import { NEANDER_COL } from "../../lib/neander/collections";
import { MEETING_FILE_MAX_BYTES, MEETING_FILE_PART_BYTES } from "../../lib/neander/meetings/types";
import {
  completeMeetingFile,
  createMeetingFile,
  deleteFilesOfMeeting,
  listMeetingFiles,
  putMeetingFilePart,
  readMeetingFileParts,
} from "../../lib/neander/meetings/server/files";

const ME = "verify@neander.local";
let failed = 0;
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? "✓" : "✗"} ${what}`);
  if (!ok) failed++;
};
const rejects = async (p: Promise<unknown>) => p.then(() => false, () => true);

async function main() {
  const db = adminDb();
  const meetings = db.collection(NEANDER_COL.meetings);
  const fileDoc = (id: string) => db.collection(NEANDER_COL.meetingFiles).doc(id);
  const partsLeft = async (id: string) => (await fileDoc(id).collection("parts").count().get()).data().count;

  const now = Date.now();
  const meeting = await meetings.add({
    date: "1999-12-31",
    title: "[검증용 — 곧 지워짐]",
    content: "",
    actionItems: [],
    createdAt: now,
    updatedAt: now,
  });
  const made: string[] = [];
  /** 파일 하나를 끝까지 올린다 */
  const put = async (bytes: Buffer, name: string) => {
    const { id, partBytes, parts } = await createMeetingFile(db, ME, { meetingId: meeting.id, name, type: "", size: bytes.length });
    made.push(id);
    for (let n = 0; n < parts; n++) await putMeetingFilePart(db, ME, id, n, bytes.subarray(n * partBytes, (n + 1) * partBytes));
    await completeMeetingFile(db, ME, id);
    return id;
  };

  try {
    check(await rejects(createMeetingFile(db, ME, { meetingId: meeting.id, name: "big", size: MEETING_FILE_MAX_BYTES + 1 })), "한도 넘는 파일은 거절");
    check(await rejects(createMeetingFile(db, ME, { meetingId: "없는회의아이디입니다", name: "x", size: 10 })), "없는 회의에는 못 붙인다");

    // 3조각, 마지막은 짧다
    const bytes = randomBytes(MEETING_FILE_PART_BYTES * 2 + 12345);
    const { id: a, parts, partBytes } = await createMeetingFile(db, ME, { meetingId: meeting.id, name: "검증 파일.pdf", type: "application/pdf", size: bytes.length });
    made.push(a);
    check(parts === 3, `조각 수 3 (받은 값 ${parts})`);
    await putMeetingFilePart(db, ME, a, 0, bytes.subarray(0, partBytes));
    check(await rejects(completeMeetingFile(db, ME, a)), "조각이 덜 왔으면 마치지 못한다");
    check(await rejects(putMeetingFilePart(db, "other@neander.local", a, 1, bytes.subarray(0, 10))), "다른 사람은 조각을 못 넣는다");
    check((await listMeetingFiles(db)).every((f) => f.id !== a), "올리는 중인 파일은 목록에 안 나온다");
    await putMeetingFilePart(db, ME, a, 1, bytes.subarray(partBytes, partBytes * 2));
    await putMeetingFilePart(db, ME, a, 2, bytes.subarray(partBytes * 2));
    const saved = await completeMeetingFile(db, ME, a);
    check(saved.meetingId === meeting.id && saved.size === bytes.length && saved.uploadedBy === ME, "마친 파일의 회의·크기·올린 사람");
    check((await listMeetingFiles(db)).some((f) => f.id === a), "마친 파일은 목록에 나온다");
    const got = Buffer.concat([await readMeetingFileParts(db, a, 0, 2), await readMeetingFileParts(db, a, 2, 5)]);
    check(got.equals(bytes), "나눠 받은 바이트가 원본과 같다");

    // 회의를 지울 때 — 첨부를 모두 지운다
    const b = await put(randomBytes(1000), "두 번째.txt");
    await deleteFilesOfMeeting(db, meeting.id);
    check(!(await fileDoc(a).get()).exists && !(await fileDoc(b).get()).exists, "회의의 첨부를 한꺼번에 지운다");
    check((await partsLeft(a)) === 0, "지운 파일의 조각도 사라진다");

    // 화면 밖(MCP 도구 등)에서 회의만 지워졌을 때 — 목록을 읽으며 치운다
    const c = await put(randomBytes(1000), "남은 파일.txt");
    await meeting.delete();
    check((await listMeetingFiles(db)).every((f) => f.id !== c), "회의가 없는 파일은 목록에 안 나온다");
    check(!(await fileDoc(c).get()).exists && (await partsLeft(c)) === 0, "회의가 없는 파일은 서버가 치운다");
  } finally {
    await meeting.delete().catch(() => undefined);
    for (const id of made) await db.recursiveDelete(fileDoc(id)).catch(() => undefined);
  }
  check(!(await meeting.get()).exists, "검증용 회의가 남지 않았다");

  console.log(failed ? `\n${failed}건 실패` : "\n모두 통과");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
