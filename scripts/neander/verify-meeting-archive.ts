// ============================================================
//  노션 보관 확인 — 토큰 없이 도는 부분까지 (실제 Firestore)
// ------------------------------------------------------------
//  npm run meetings:verify-archive
//
//  노션에 실제로 올리는 것은 토큰(NOTION_ARCHIVE_TOKEN)과 보관함 페이지가
//  있어야 해서 여기서 하지 않는다. 대신 그 앞뒤를 본다:
//    · 무엇을 옮길지 고르는 규칙 (90일 지난 회의 · 아직 ERP 에 있는 자료만)
//    · 노션에 보낼 블록·파일 이름의 모양
//    · 토큰이 없을 때 얌전히 꺼지는지
//
//  1999-12-31 검증용 회의를 잠깐 만들어 쓰고 지운다.
// ============================================================
import { config } from "dotenv";
config({ path: ".env.local" });

import { randomBytes } from "node:crypto";
import { adminDb } from "../../lib/neander/server/admin";
import { NEANDER_COL } from "../../lib/neander/collections";
import {
  bullet,
  fileBlock,
  heading,
  notionArchiveEnabled,
  paragraph,
  parseNotionPageId,
  textBlocks,
  NOTION_SINGLE_MAX,
} from "../../lib/neander/notion/archive-client";
import { ARCHIVE_AFTER_DAYS, listArchiveCandidates } from "../../lib/neander/meetings/server/archive";
import { completeMeetingFile, createMeetingFile, deleteFilesOfMeeting, putMeetingFilePart } from "../../lib/neander/meetings/server/files";

const ME = "verify@neander.local";
let failed = 0;
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? "✓" : "✗"} ${what}`);
  if (!ok) failed++;
};

function pureChecks() {
  check(parseNotionPageId("https://www.notion.so/team/보관함-24f1a2b3c4d55e6f7a8b9c0d1e2f3a4b") === "24f1a2b3c4d55e6f7a8b9c0d1e2f3a4b", "노션 페이지 주소에서 id 를 꺼낸다");
  check(parseNotionPageId("24f1a2b3-c4d5-5e6f-7a8b-9c0d1e2f3a4b") === "24f1a2b3c4d55e6f7a8b9c0d1e2f3a4b", "붙임표가 있는 id 도 읽는다");
  check(parseNotionPageId("보관함") === null, "주소가 아니면 null");
  check(
    parseNotionPageId("https://app.notion.com/p/neander/2026-1529d0690a1c80e5b4f5d1cfd8afbfda?source=copy_link") ===
      "1529d0690a1c80e5b4f5d1cfd8afbfda",
    "제목이 숫자여도 id 를 제목과 섞지 않는다 (app.notion.com/p/… 링크)",
  );
  check(
    parseNotionPageId("https://www.notion.so/team/abc123?v=0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f&p=24f1a2b3c4d55e6f7a8b9c0d1e2f3a4b&pm=s") ===
      "24f1a2b3c4d55e6f7a8b9c0d1e2f3a4b",
    "미리보기로 연 페이지는 ?p= 가 그 페이지",
  );

  const p = paragraph("열기", "https://example.com") as any;
  check(p.paragraph.rich_text[0].text.link.url === "https://example.com", "문단 블록에 링크가 붙는다");
  check((heading("첨부 파일") as any).heading_2.rich_text[0].text.content === "첨부 파일", "소제목 블록");
  check((bullet("할 일") as any).bulleted_list_item.rich_text[0].text.content === "할 일", "글머리 블록");

  const f = fileBlock("up-1", "메모.txt") as any;
  check(f.type === "file" && f.file.type === "file_upload" && f.file.file_upload.id === "up-1", "파일 블록이 올린 파일을 가리킨다");
  const a = fileBlock("up-2", "01.ogg") as any;
  check(a.type === "audio" && a.audio.file_upload.id === "up-2", "음성은 audio 블록으로");
  // 크롬 녹음(webm)은 노션이 동영상으로 본다 — audio 블록에 넣으면 거절당한다
  const w = fileBlock("up-3", "01.webm") as any;
  check(w.type === "file", "노션이 소리로 안 보는 형식은 file 블록으로");
  // 노션이 안 받는 확장자(.hwp)는 압축해 올리고, 설명에는 원래 이름을 적는다
  const h = fileBlock("up-4", "기획안.hwp", "기획안.hwp.gz") as any;
  check(h.type === "file" && h.file.caption[0].text.content === "기획안.hwp", "압축해 올려도 이름은 원래 이름으로 보인다");

  // 4,001자 한 줄 → 1,900자씩 세 덩이, 빈 줄은 건너뛰고, 마지막 줄이 하나 더
  const long = textBlocks(`가${"나".repeat(4000)}\n\n다`);
  check(
    long.length === 4 && long.every((b: any) => b.paragraph.rich_text[0].text.content.length <= 1900),
    `긴 글은 1,900자씩 여러 블록으로 · 빈 줄은 건너뛴다 (블록 ${long.length}개)`,
  );
  check(NOTION_SINGLE_MAX === 20 * 1024 * 1024, "20MiB 를 넘으면 조각내 올린다");
  // .env.local 에 실제 값이 들어 있어도 이 검사는 「없을 때」 를 본다
  const saved = [process.env.NOTION_ARCHIVE_TOKEN, process.env.NOTION_ARCHIVE_PAGE];
  delete process.env.NOTION_ARCHIVE_TOKEN;
  delete process.env.NOTION_ARCHIVE_PAGE;
  check(!notionArchiveEnabled(), "토큰·보관함이 없으면 보관 기능은 꺼져 있다");
  if (saved[0] !== undefined) process.env.NOTION_ARCHIVE_TOKEN = saved[0];
  if (saved[1] !== undefined) process.env.NOTION_ARCHIVE_PAGE = saved[1];
}

async function main() {
  pureChecks();

  const db = adminDb();
  const now = Date.now();
  const oldDate = new Date(now - (ARCHIVE_AFTER_DAYS + 10) * 86_400_000).toISOString().slice(0, 10);

  // 오래된 회의(자료 있음) · 어제 회의(자료 있음) — 앞엣것만 대상이어야 한다
  const oldMeeting = await db.collection(NEANDER_COL.meetings).add({
    date: oldDate, title: "[검증용 — 곧 지워짐] 오래된 회의", content: "", actionItems: [], createdAt: now, updatedAt: now,
  });
  const newMeeting = await db.collection(NEANDER_COL.meetings).add({
    date: new Date(now - 86_400_000).toISOString().slice(0, 10), title: "[검증용 — 곧 지워짐] 어제 회의", content: "", actionItems: [], createdAt: now, updatedAt: now,
  });

  const put = async (meetingId: string, name: string, size: number) => {
    const bytes = randomBytes(size);
    const { id, partBytes, parts } = await createMeetingFile(db, ME, { meetingId, name, type: "application/pdf", size });
    for (let n = 0; n < parts; n++) await putMeetingFilePart(db, ME, id, n, bytes.subarray(n * partBytes, (n + 1) * partBytes));
    await completeMeetingFile(db, ME, id);
    return id;
  };

  try {
    await put(oldMeeting.id, "오래된 자료.pdf", 300_000);
    await put(newMeeting.id, "최근 자료.pdf", 100_000);

    const list = await listArchiveCandidates(db);
    const mine = list.find((c) => c.meetingId === oldMeeting.id);
    check(!!mine, `${ARCHIVE_AFTER_DAYS}일이 지난 회의가 목록에 있다`);
    check(mine?.files === 1 && mine?.bytes === 300_000, `옮길 첨부 1개 · 300,000바이트 (받은 값 ${mine?.files}개 · ${mine?.bytes})`);
    check(!list.some((c) => c.meetingId === newMeeting.id), "최근 회의는 목록에 없다");

    // 이미 보관한 파일은 다시 세지 않는다
    const fileSnap = await db.collection(NEANDER_COL.meetingFiles).where("meetingId", "==", oldMeeting.id).get();
    await fileSnap.docs[0].ref.update({ archive: { pageUrl: "https://notion.so/x", blockId: "b1", at: now } });
    const after = await listArchiveCandidates(db);
    check(!after.some((c) => c.meetingId === oldMeeting.id), "이미 노션에 있는 자료뿐이면 목록에서 빠진다");
  } finally {
    await deleteFilesOfMeeting(db, oldMeeting.id).catch(() => undefined);
    await deleteFilesOfMeeting(db, newMeeting.id).catch(() => undefined);
    await oldMeeting.delete().catch(() => undefined);
    await newMeeting.delete().catch(() => undefined);
  }

  console.log(failed ? `\n실패 ${failed}건` : "\n모두 통과 (노션 실제 업로드는 토큰이 있어야 확인할 수 있습니다)");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
