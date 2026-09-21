import "server-only";

// ============================================================
//  회의 첨부 파일 — Firestore 조각으로 둔다
// ------------------------------------------------------------
//  Firebase Storage 버킷이 없다 (2026-09-18 · 09-19 두 번 확인, exists=false).
//  그래서 메일 첨부(mail/server/blobs.ts)와 같은 길을 간다 — 브라우저가
//  768KB 씩 나눠 보내고(Vercel 요청 한도 4.5MB), 서버는 조각을 Firestore
//  문서(1MB 한도)에 하나씩 둔다. 받을 때는 몇 조각씩 이어 붙여 내려준다.
//
//  메일 조각과 저장소를 나눈 이유 — 메일 조각은 올린 사람만 읽는 임시
//  자리라 하루 뒤 지워지지만, 회의 파일은 회의록처럼 팀 누구나 읽고 지우고
//  회의가 있는 동안 남는다.
//
//    neander_meeting_files/{id}     회의 id · 이름 · 크기 · 조각 수 · 올린 사람 · complete
//      └─ parts/{n}                 data (bytes)
//
//  이 컬렉션은 보안 규칙에 없다 (규칙 게시 권한이 없다 — server/admin.ts).
//  브라우저는 직접 못 읽고 이 서버를 거친다. complete 가 아닌 파일은 목록에
//  안 나오고 하루 지나면 치운다 (창을 닫아 끊긴 업로드). 회의가 사라진 파일
//  (MCP 도구 등 화면 밖에서 회의를 지운 경우)도 목록을 읽을 때 치운다.
// ============================================================

import { randomBytes } from "node:crypto";
import type { DocumentReference, Firestore } from "firebase-admin/firestore";
import { NEANDER_COL } from "@/lib/neander/collections";
import { MEETING_FILE_MAX_BYTES, MEETING_FILE_PART_BYTES, type MeetingFile } from "../types";

interface FileDoc extends Omit<MeetingFile, "id"> {
  parts: number;
  /** 조각이 다 올라왔는가 */
  complete: boolean;
}

const STALE_MS = 24 * 60 * 60 * 1000;

const files = (db: Firestore) => db.collection(NEANDER_COL.meetingFiles);
const fileRef = (db: Firestore, id: string) => files(db).doc(id);
const partRef = (db: Firestore, id: string, n: number) => fileRef(db, id).collection("parts").doc(String(n));

const newId = () => randomBytes(12).toString("base64url");
const isId = (id: unknown): id is string => typeof id === "string" && /^[\w-]{10,40}$/.test(id);

const view = (id: string, f: FileDoc): MeetingFile => ({
  id,
  meetingId: f.meetingId,
  name: f.name,
  type: f.type,
  size: f.size,
  uploadedBy: f.uploadedBy,
  createdAt: f.createdAt,
  ...(f.archive ? { archive: f.archive } : {}),
});

async function getFile(db: Firestore, id: unknown): Promise<FileDoc> {
  if (!isId(id)) throw new Error("파일 id 가 올바르지 않습니다.");
  const d = (await fileRef(db, id).get()).data() as FileDoc | undefined;
  if (!d) throw new Error("파일을 찾지 못했습니다. 다른 사람이 지웠을 수 있습니다.");
  return d;
}

/** 모든 회의의 첨부 — 화면 목록이 회의마다 첨부 수를 보여 준다 */
export async function listMeetingFiles(db: Firestore): Promise<MeetingFile[]> {
  const [fileSnap, meetingSnap] = await Promise.all([
    files(db).get(),
    db.collection(NEANDER_COL.meetings).select().get(),
  ]);
  const alive = new Set(meetingSnap.docs.map((d) => d.id));
  const out: MeetingFile[] = [];
  const junk: DocumentReference[] = [];
  for (const d of fileSnap.docs) {
    const f = d.data() as FileDoc;
    if (!alive.has(f.meetingId)) junk.push(d.ref);
    else if (f.complete) out.push(view(d.id, f));
    else if (f.createdAt < Date.now() - STALE_MS) junk.push(d.ref);
  }
  // 목록 응답을 오래 붙잡지 않게 몇 개씩만
  for (const ref of junk.slice(0, 3)) await db.recursiveDelete(ref).catch(() => undefined);
  return out.sort((a, b) => a.createdAt - b.createdAt);
}

export async function createMeetingFile(
  db: Firestore,
  by: string,
  meta: { meetingId?: unknown; name?: unknown; type?: unknown; size?: unknown },
): Promise<{ id: string; partBytes: number; parts: number }> {
  const meetingId = meta.meetingId;
  if (!isId(meetingId) || !(await db.collection(NEANDER_COL.meetings).doc(meetingId).get()).exists) {
    throw new Error("회의를 찾지 못했습니다. 다른 사람이 지웠을 수 있습니다.");
  }
  const size = Number(meta.size) || 0;
  if (size <= 0) throw new Error("빈 파일은 올릴 수 없습니다.");
  if (size > MEETING_FILE_MAX_BYTES) {
    throw new Error(`한 파일은 ${MEETING_FILE_MAX_BYTES / 1024 / 1024}MB 까지 올릴 수 있습니다.`);
  }
  const parts = Math.ceil(size / MEETING_FILE_PART_BYTES);
  const id = newId();
  const doc: FileDoc = {
    meetingId,
    name: String(meta.name ?? "").slice(0, 200) || "파일",
    type: String(meta.type || "application/octet-stream").slice(0, 120),
    size,
    uploadedBy: by,
    createdAt: Date.now(),
    parts,
    complete: false,
  };
  await fileRef(db, id).set(doc);
  return { id, partBytes: MEETING_FILE_PART_BYTES, parts };
}

/** 올리는 중인 파일의 조각 — 올리기 시작한 사람만 채운다 */
export async function putMeetingFilePart(db: Firestore, by: string, id: unknown, n: number, data: Buffer): Promise<void> {
  const f = await getFile(db, id);
  if (f.uploadedBy !== by || f.complete) throw new Error("이 파일에는 조각을 더 넣을 수 없습니다.");
  if (!Number.isInteger(n) || n < 0 || n >= f.parts) throw new Error("조각 번호가 올바르지 않습니다.");
  if (data.length > MEETING_FILE_PART_BYTES) throw new Error("조각이 너무 큽니다.");
  await partRef(db, id as string, n).set({ data });
}

/** 조각이 다 왔는지 세어 보고 목록에 올린다 */
export async function completeMeetingFile(db: Firestore, by: string, id: unknown): Promise<MeetingFile> {
  const f = await getFile(db, id);
  if (f.uploadedBy !== by) throw new Error("올리기 시작한 사람만 마칠 수 있습니다.");
  const agg = await fileRef(db, id as string).collection("parts").count().get();
  if (agg.data().count !== f.parts) throw new Error(`「${f.name}」 이(가) 다 올라가지 않았습니다. 다시 올려 주세요.`);
  await fileRef(db, id as string).update({ complete: true });
  return view(id as string, { ...f, complete: true });
}

/** 조각 [from, from+count) 을 이어 붙인 바이트 */
export async function readMeetingFileParts(db: Firestore, id: unknown, from: number, count: number): Promise<Buffer> {
  const f = await getFile(db, id);
  if (!f.complete) throw new Error("아직 올라가는 중인 파일입니다.");
  const refs = [];
  for (let n = from; n < Math.min(f.parts, from + count); n++) refs.push(partRef(db, id as string, n));
  const snaps = refs.length ? await db.getAll(...refs) : [];
  return Buffer.concat(
    snaps.map((s) => {
      const data = s.data()?.data as Buffer | undefined;
      if (!data) throw new Error(`「${f.name}」 의 조각이 빠져 있습니다. 다시 올려 주세요.`);
      return Buffer.from(data);
    }),
  );
}

/** 노션으로 옮긴 파일인가 — 맞으면 붙어 있는 블록 id */
export async function archivedMeetingFile(db: Firestore, id: unknown): Promise<{ pageUrl: string; blockId: string } | null> {
  if (!isId(id)) return null;
  const d = (await fileRef(db, id).get()).data() as FileDoc | undefined;
  return d?.archive ? { pageUrl: d.archive.pageUrl, blockId: d.archive.blockId } : null;
}

/** 파일 내용을 통째로 — 노션 보관이 쓴다 (한 파일 30MB 한도 안이라 메모리에 올려도 된다) */
export async function readWholeMeetingFile(db: Firestore, id: string): Promise<Buffer> {
  const f = await getFile(db, id);
  return readMeetingFileParts(db, id, 0, f.parts);
}

/** 노션으로 옮긴 뒤 — 조각은 지우고 어디로 갔는지만 남긴다 */
export async function markMeetingFileArchived(
  db: Firestore,
  id: string,
  archive: { pageUrl: string; blockId: string; at: number },
): Promise<void> {
  await db.recursiveDelete(fileRef(db, id).collection("parts"));
  await fileRef(db, id).update({ archive });
}

/** 회의 하나의 첨부 (보관된 것도 포함) — 보관 대상을 고를 때 쓴다 */
export async function meetingFiles(db: Firestore, meetingId: string): Promise<(MeetingFile & { parts: number })[]> {
  const snap = await files(db).where("meetingId", "==", meetingId).get();
  return snap.docs
    .map((d) => ({ ...view(d.id, d.data() as FileDoc), parts: (d.data() as FileDoc).parts }))
    .filter((f) => f.name)
    .sort((a, b) => a.createdAt - b.createdAt);
}

/**
 * 팀 누구나 지운다 (회의록과 같다). 올리다 만 파일을 치울 때도 쓴다.
 * 지운 파일이 무엇이었는지 돌려준다 — 부르는 쪽이 기록에 남긴다 (없던 파일이면 null).
 */
export async function deleteMeetingFile(db: Firestore, id: unknown): Promise<{ meetingId: string; name: string } | null> {
  if (!isId(id)) throw new Error("파일 id 가 올바르지 않습니다.");
  const d = (await fileRef(db, id).get()).data() as FileDoc | undefined;
  await db.recursiveDelete(fileRef(db, id));
  return d ? { meetingId: d.meetingId, name: d.name } : null;
}

/** 회의를 지우기 직전에 — 그 회의의 첨부를 모두 지운다 */
export async function deleteFilesOfMeeting(db: Firestore, meetingId: unknown): Promise<void> {
  if (!isId(meetingId)) throw new Error("회의 id 가 올바르지 않습니다.");
  const snap = await files(db).where("meetingId", "==", meetingId).get();
  for (const d of snap.docs) await db.recursiveDelete(d.ref);
}
