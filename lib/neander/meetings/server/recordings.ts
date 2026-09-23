import "server-only";

// ============================================================
//  회의 녹음 — 조각 음성 · 받아쓴 줄 · 회의록 초안을 Firestore 에 둔다
// ------------------------------------------------------------
//  Storage 버킷이 없어 첨부 파일(files.ts)과 같은 조각 방식이다.
//
//    neander_meeting_recordings/{id}          회의 id · 출처 · 조각/올림/받아씀 수 · 비용 · 초안 · 확정
//      └─ segments/{n}                        10분 조각 — 시작 초 · 길이 · 형식 · 받아쓴 줄
//           └─ parts/{k}                      data (768KB 음성 조각)
//
//  목록 화면이 조각을 다 읽지 않아도 되게 녹음 문서에 수를 센다 (segCount ·
//  uploaded · transcribed). 수는 조각 상태가 바뀌는 트랜잭션 안에서만 고친다.
//
//  컬렉션은 보안 규칙에 없다 (규칙 게시 권한이 없다 — server/admin.ts).
//  브라우저는 /api/neander/meetings/recordings 를 거친다.
//
//  목록을 읽을 때 치우는 것 (응답을 오래 붙잡지 않게 몇 개씩만):
//    · 회의가 사라진 녹음 — 통째로
//    · 확정하고 30일이 지난 녹음 — 음성 조각만 (받아쓴 줄·초안은 남긴다)
//    · 6시간 넘게 아무 조각도 안 온 녹음 — 끝난 것으로 (창을 닫아 끊긴 ERP 녹음)
// ============================================================

import { randomBytes } from "node:crypto";
import { FieldValue, type DocumentReference, type Firestore } from "firebase-admin/firestore";
import { NEANDER_COL } from "@/lib/neander/collections";
import {
  REC_AUDIO_KEEP_DAYS,
  REC_MAX_SEC,
  REC_PART_BYTES,
  REC_SEGMENT_MAX_BYTES,
  REC_SEGMENT_SEC,
  isFullyTranscribed,
  isRecAudioFormat,
  type MeetingMinutesDraft,
  type MinutesActionDraft,
  type MeetingRecording,
  type RecordingDetail,
  type RecordingSegment,
  type RecordingSource,
  type TranscriptLine,
} from "../recording";
import { draftMinutes, transcribeAudio } from "./ai";

type RecDoc = Omit<MeetingRecording, "id">;

interface SegDoc extends RecordingSegment {
  parts: number;
  /** 올린 사람 — 조각은 올리기 시작한 사람만 채운다 */
  createdBy: string;
  /** 받아쓰는 중 표시 — 두 창이 같은 조각을 동시에 받아써 돈을 두 번 쓰지 않게 */
  transcribingAt?: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const IDLE_END_MS = 6 * 60 * 60 * 1000;
/** 받아쓰기 한 번은 실측 30초 안팎. 이보다 오래된 표시는 끊긴 것으로 본다 */
const TRANSCRIBE_LOCK_MS = 3 * 60 * 1000;
const MAX_SEGMENTS = Math.ceil(REC_MAX_SEC / REC_SEGMENT_SEC) + 6;

const recs = (db: Firestore) => db.collection(NEANDER_COL.meetingRecordings);
const recRef = (db: Firestore, id: string) => recs(db).doc(id);
const segsOf = (db: Firestore, id: string) => recRef(db, id).collection("segments");
const segRef = (db: Firestore, id: string, n: number) => segsOf(db, id).doc(String(n));
const partRef = (db: Firestore, id: string, n: number, k: number) => segRef(db, id, n).collection("parts").doc(String(k));

const newId = () => randomBytes(12).toString("base64url");
const isId = (id: unknown): id is string => typeof id === "string" && /^[\w-]{10,40}$/.test(id);

function checkN(n: unknown): number {
  const v = Number(n);
  if (!Number.isInteger(v) || v < 0 || v >= MAX_SEGMENTS) throw new Error("조각 번호가 올바르지 않습니다.");
  return v;
}

function checkSec(v: unknown, what: string): number {
  const s = Number(v);
  if (!Number.isFinite(s) || s < 0 || s > REC_MAX_SEC + REC_SEGMENT_SEC) throw new Error(`${what} 이(가) 올바르지 않습니다.`);
  return Math.round(s * 10) / 10;
}

const view = (id: string, r: RecDoc): MeetingRecording => ({ id, ...r });

const segView = (s: SegDoc): RecordingSegment => {
  const { parts: _p, createdBy: _c, transcribingAt: _t, ...rest } = s;
  void _p;
  void _c;
  void _t;
  return rest;
};

async function getRec(db: Firestore, id: unknown): Promise<RecDoc> {
  if (!isId(id)) throw new Error("녹음 id 가 올바르지 않습니다.");
  const d = (await recRef(db, id).get()).data() as RecDoc | undefined;
  if (!d) throw new Error("녹음을 찾지 못했습니다. 다른 사람이 지웠을 수 있습니다.");
  return d;
}

async function getSeg(db: Firestore, id: string, n: number): Promise<SegDoc> {
  const d = (await segRef(db, id, n).get()).data() as SegDoc | undefined;
  if (!d) throw new Error(`${n + 1}번째 조각을 찾지 못했습니다.`);
  return d;
}

// ---- 목록 · 읽기 --------------------------------------------

/** 모든 녹음 (조각 없이) — 회의 목록이 녹음 표시를 단다 */
export async function listRecordings(db: Firestore): Promise<MeetingRecording[]> {
  const [snap, meetingSnap] = await Promise.all([recs(db).get(), db.collection(NEANDER_COL.meetings).select().get()]);
  const alive = new Set(meetingSnap.docs.map((d) => d.id));
  const now = Date.now();
  const out: MeetingRecording[] = [];
  const orphans: DocumentReference[] = [];
  const audioDue: string[] = [];
  const idle: string[] = [];
  for (const d of snap.docs) {
    const r = d.data() as RecDoc;
    if (!alive.has(r.meetingId)) {
      orphans.push(d.ref);
      continue;
    }
    if (r.audioDeleteAt && !r.audioDeletedAt && r.audioDeleteAt < now) audioDue.push(d.id);
    if (!r.ended && r.updatedAt < now - IDLE_END_MS) {
      idle.push(d.id);
      r.ended = true;
    }
    out.push(view(d.id, r));
  }
  for (const ref of orphans.slice(0, 2)) await db.recursiveDelete(ref).catch(() => undefined);
  for (const id of audioDue.slice(0, 1)) await deleteRecordingAudio(db, id).catch(() => undefined);
  for (const id of idle) await recRef(db, id).update({ ended: true }).catch(() => undefined);
  return out.sort((a, b) => a.createdAt - b.createdAt);
}

/** 회의 하나의 녹음 — 조각과 받아쓴 줄까지 */
export async function getMeetingRecordings(db: Firestore, meetingId: unknown): Promise<RecordingDetail[]> {
  if (!isId(meetingId)) throw new Error("회의 id 가 올바르지 않습니다.");
  const snap = await recs(db).where("meetingId", "==", meetingId).get();
  const out = await Promise.all(
    snap.docs.map(async (d) => {
      const segs = await segsOf(db, d.id).orderBy("n").get();
      return { ...view(d.id, d.data() as RecDoc), segments: segs.docs.map((s) => segView(s.data() as SegDoc)) };
    }),
  );
  return out.sort((a, b) => a.createdAt - b.createdAt);
}

/** 조각 음성의 k ∈ [from, from+count) 조각을 이어 붙인 바이트 */
export async function readSegmentAudio(
  db: Firestore,
  id: unknown,
  n: unknown,
  from: number,
  count: number,
): Promise<{ bytes: Buffer; format: string }> {
  const rec = await getRec(db, id);
  if (rec.audioDeletedAt) throw new Error("음성은 이미 지웠습니다. 받아쓴 글은 남아 있습니다.");
  const seg = await getSeg(db, id as string, checkN(n));
  if (!seg.uploaded) throw new Error("아직 올라가는 중인 조각입니다.");
  const refs = [];
  for (let k = from; k < Math.min(seg.parts, from + count); k++) refs.push(partRef(db, id as string, seg.n, k));
  const snaps = refs.length ? await db.getAll(...refs) : [];
  const bytes = Buffer.concat(
    snaps.map((s) => {
      const data = s.data()?.data as Buffer | undefined;
      if (!data) throw new Error("음성 조각이 빠져 있습니다.");
      return Buffer.from(data);
    }),
  );
  return { bytes, format: seg.format };
}

// ---- 만들기 · 올리기 ----------------------------------------

export async function createRecording(
  db: Firestore,
  by: string,
  meta: { meetingId?: unknown; source?: unknown; name?: unknown; durationSec?: unknown },
): Promise<MeetingRecording> {
  const meetingId = meta.meetingId;
  if (!isId(meetingId) || !(await db.collection(NEANDER_COL.meetings).doc(meetingId).get()).exists) {
    throw new Error("회의를 찾지 못했습니다. 다른 사람이 지웠을 수 있습니다.");
  }
  const source: RecordingSource = meta.source === "upload" ? "upload" : "live";
  const now = Date.now();
  const doc: RecDoc = {
    meetingId,
    source,
    name: String(meta.name ?? "").slice(0, 200) || (source === "live" ? "ERP 녹음" : "녹음 파일"),
    createdBy: by,
    createdAt: now,
    updatedAt: now,
    ended: false,
    segCount: 0,
    uploaded: 0,
    transcribed: 0,
    durationSec: meta.durationSec === undefined ? 0 : checkSec(meta.durationSec, "녹음 길이"),
    costUsd: 0,
  };
  const id = newId();
  await recRef(db, id).set(doc);
  return view(id, doc);
}

/**
 * 조각 자리를 만든다. 이미 다 올라온 조각이면 already — 브라우저가 올리고 나서
 * 제 쪽 대기열을 못 지운 채 닫혔다가 다시 올리는 경우다.
 */
export async function createSegment(
  db: Firestore,
  by: string,
  meta: { id?: unknown; n?: unknown; startSec?: unknown; durationSec?: unknown; format?: unknown; size?: unknown },
): Promise<{ parts: number; partBytes: number; already: boolean }> {
  const rec = await getRec(db, meta.id);
  const id = meta.id as string;
  if (rec.createdBy !== by) throw new Error("녹음을 시작한 사람만 조각을 올릴 수 있습니다.");
  const n = checkN(meta.n);
  if (!isRecAudioFormat(meta.format)) throw new Error("음성 형식이 올바르지 않습니다.");
  const size = Number(meta.size) || 0;
  if (size <= 0) throw new Error("빈 조각은 올릴 수 없습니다.");
  if (size > REC_SEGMENT_MAX_BYTES) throw new Error(`조각 하나는 ${REC_SEGMENT_MAX_BYTES / 1024 / 1024}MB 까지입니다.`);
  const parts = Math.ceil(size / REC_PART_BYTES);

  const existing = (await segRef(db, id, n).get()).data() as SegDoc | undefined;
  if (existing?.uploaded) return { parts: existing.parts, partBytes: REC_PART_BYTES, already: true };
  if (existing) await db.recursiveDelete(segRef(db, id, n));

  const seg: SegDoc = {
    n,
    startSec: checkSec(meta.startSec, "조각 시작"),
    durationSec: checkSec(meta.durationSec, "조각 길이"),
    format: meta.format,
    size,
    uploaded: false,
    parts,
    createdBy: by,
  };
  await segRef(db, id, n).set(seg);
  await db.runTransaction(async (tx) => {
    const r = (await tx.get(recRef(db, id))).data() as RecDoc | undefined;
    if (!r) return;
    tx.update(recRef(db, id), { segCount: Math.max(r.segCount, n + 1), updatedAt: Date.now() });
  });
  return { parts, partBytes: REC_PART_BYTES, already: false };
}

export async function putSegmentPart(
  db: Firestore,
  by: string,
  id: unknown,
  n: unknown,
  k: unknown,
  data: Buffer,
): Promise<void> {
  if (!isId(id)) throw new Error("녹음 id 가 올바르지 않습니다.");
  const seg = await getSeg(db, id, checkN(n));
  if (seg.createdBy !== by || seg.uploaded) throw new Error("이 조각에는 음성을 더 넣을 수 없습니다.");
  const kk = Number(k);
  if (!Number.isInteger(kk) || kk < 0 || kk >= seg.parts) throw new Error("음성 조각 번호가 올바르지 않습니다.");
  if (data.length === 0 || data.length > REC_PART_BYTES) throw new Error("음성 조각 크기가 올바르지 않습니다.");
  await partRef(db, id, seg.n, kk).set({ data });
}

/** 음성 조각이 다 왔는지 세어 보고 올라온 것으로 친다 */
export async function completeSegment(db: Firestore, by: string, id: unknown, n: unknown): Promise<void> {
  if (!isId(id)) throw new Error("녹음 id 가 올바르지 않습니다.");
  const nn = checkN(n);
  const seg = await getSeg(db, id, nn);
  if (seg.createdBy !== by) throw new Error("올리기 시작한 사람만 마칠 수 있습니다.");
  const agg = await segRef(db, id, nn).collection("parts").count().get();
  if (agg.data().count !== seg.parts) throw new Error(`${nn + 1}번째 조각이 다 올라가지 않았습니다.`);
  await db.runTransaction(async (tx) => {
    const [rs, ss] = await Promise.all([tx.get(recRef(db, id)), tx.get(segRef(db, id, nn))]);
    const r = rs.data() as RecDoc | undefined;
    const s = ss.data() as SegDoc | undefined;
    if (!r || !s || s.uploaded) return;
    tx.update(segRef(db, id, nn), { uploaded: true });
    tx.update(recRef(db, id), {
      uploaded: FieldValue.increment(1),
      durationSec: Math.max(r.durationSec, s.startSec + s.durationSec),
      updatedAt: Date.now(),
    });
  });
}

/** 더 올라올 조각이 없다 — ERP 녹음을 끝냈거나 파일을 다 나눴다 */
export async function endRecording(
  db: Firestore,
  by: string,
  meta: { id?: unknown; segCount?: unknown; durationSec?: unknown },
): Promise<void> {
  const rec = await getRec(db, meta.id);
  if (rec.createdBy !== by) throw new Error("녹음을 시작한 사람만 끝낼 수 있습니다.");
  const segCount = Math.min(MAX_SEGMENTS, Math.max(0, Math.floor(Number(meta.segCount) || 0)));
  const dur = meta.durationSec === undefined ? 0 : checkSec(meta.durationSec, "녹음 길이");
  await recRef(db, meta.id as string).update({
    ended: true,
    segCount: Math.max(rec.segCount, segCount),
    durationSec: Math.max(rec.durationSec, dur),
    updatedAt: Date.now(),
  });
}

/**
 * 올라간 데까지로 마친다 — 창을 닫아 끊겼거나 조각 하나가 끝내 안 올라간 녹음.
 * 덜 올라간 조각 자리는 지우고, 조각 수를 실제로 올라온 수에 맞춘다.
 * 녹음을 시작한 사람이 아니면 10분 넘게 아무것도 안 온 녹음만 (진행 중인 녹음을 남이 끊지 않게).
 */
export async function finalizeRecording(db: Firestore, by: string, id: unknown): Promise<void> {
  const rec = await getRec(db, id);
  const rid = id as string;
  if (rec.createdBy !== by && rec.updatedAt > Date.now() - 10 * 60 * 1000) {
    throw new Error("지금 올라오고 있는 녹음입니다. 녹음한 사람이 마치거나 10분 뒤에 다시 시도해 주세요.");
  }
  const segs = await segsOf(db, rid).get();
  let uploaded = 0;
  let transcribed = 0;
  let durationSec = 0;
  for (const d of segs.docs) {
    const s = d.data() as SegDoc;
    if (!s.uploaded) {
      await db.recursiveDelete(d.ref);
      continue;
    }
    uploaded++;
    if (s.transcribedAt) transcribed++;
    durationSec = Math.max(durationSec, s.startSec + s.durationSec);
  }
  await recRef(db, rid).update({
    ended: true,
    segCount: uploaded,
    uploaded,
    transcribed,
    durationSec,
    updatedAt: Date.now(),
  });
}

// ---- 받아쓰기 · 초안 ----------------------------------------

/** 조각 하나를 받아쓴다 — 팀원 누구나 (실패한 조각을 다른 사람이 다시 돌릴 수 있게) */
export async function transcribeSegment(db: Firestore, id: unknown, n: unknown): Promise<RecordingSegment> {
  const rec = await getRec(db, id);
  const rid = id as string;
  const nn = checkN(n);
  if (rec.audioDeletedAt) throw new Error("음성을 이미 지워 다시 받아쓸 수 없습니다.");

  // 받아쓰는 중 표시 — 두 창이 같은 조각에 돈을 두 번 쓰지 않게
  const seg = await db.runTransaction(async (tx) => {
    const s = (await tx.get(segRef(db, rid, nn))).data() as SegDoc | undefined;
    if (!s) throw new Error(`${nn + 1}번째 조각을 찾지 못했습니다.`);
    if (!s.uploaded) throw new Error(`${nn + 1}번째 조각이 아직 다 올라가지 않았습니다.`);
    if (s.transcribingAt && s.transcribingAt > Date.now() - TRANSCRIBE_LOCK_MS) {
      throw new Error(`${nn + 1}번째 조각은 지금 다른 곳에서 받아쓰는 중입니다.`);
    }
    tx.update(segRef(db, rid, nn), { transcribingAt: Date.now() });
    return s;
  });

  try {
    const { bytes } = await readSegmentAudio(db, rid, nn, 0, seg.parts);
    const prev = nn > 0 ? ((await segRef(db, rid, nn - 1).get()).data() as SegDoc | undefined)?.lines ?? [] : [];
    const { lines, costUsd } = await transcribeAudio({
      audio: bytes,
      format: seg.format,
      startSec: seg.startSec,
      durationSec: seg.durationSec,
      prev,
    });
    const at = Date.now();
    await db.runTransaction(async (tx) => {
      const s = (await tx.get(segRef(db, rid, nn))).data() as SegDoc | undefined;
      if (!s) return;
      tx.update(segRef(db, rid, nn), {
        lines,
        transcribedAt: at,
        error: FieldValue.delete(),
        transcribingAt: FieldValue.delete(),
      });
      tx.update(recRef(db, rid), {
        ...(s.transcribedAt ? {} : { transcribed: FieldValue.increment(1) }),
        costUsd: FieldValue.increment(costUsd),
        updatedAt: at,
      });
    });
    return segView({ ...seg, lines, transcribedAt: at, error: undefined });
  } catch (e) {
    const message = e instanceof Error ? e.message : "알 수 없는 오류";
    await segRef(db, rid, nn)
      .update({ error: message.slice(0, 300), transcribingAt: FieldValue.delete() })
      .catch(() => undefined);
    throw e;
  }
}

export async function setSpeakers(db: Firestore, id: unknown, speakers: unknown): Promise<void> {
  await getRec(db, id);
  const clean: Record<string, string> = {};
  if (speakers && typeof speakers === "object") {
    for (const [k, v] of Object.entries(speakers as Record<string, unknown>)) {
      const key = String(k).slice(0, 12);
      const val = typeof v === "string" ? v.trim().slice(0, 30) : "";
      if (key && val) clean[key] = val;
    }
  }
  await recRef(db, id as string).update({ speakers: clean });
}

/**
 * 나눠 녹음한 회의를 **하나로** 합친다 (2026-09-23).
 *
 * 회의 중에 녹음이 끊기면 한 회의에 녹음이 둘·셋으로 남는다(9/22 임원진회의: 3개).
 * 고른 녹음들을 **가장 먼저 시작한 녹음 안으로** 옮겨 하나로 만든다:
 *   · 음성 조각과 받아쓴 글을 차례로 이어 붙인다 (뒤 녹음의 시각은 앞 녹음 길이만큼 민다)
 *   · 초안이 하나라도 있으면 이어 붙인 받아쓴 글로 **초안을 다시 만든다**
 *   · 옮기고 난 녹음 문서는 지운다
 *
 * 베껴 쓰고 나서 지우는 차례라 중간에 끊겨도 다시 누르면 된다 — 옮긴 녹음은
 * `mergedFrom` 에 적어 두고 두 번 옮기지 않는다.
 */
export async function mergeRecordings(
  db: Firestore,
  ids: unknown,
): Promise<{ keepId: string; segments: number; durationSec: number; summary?: MeetingMinutesDraft; costUsd: number }> {
  const list = Array.isArray(ids) ? [...new Set(ids.filter((v): v is string => isId(v)))] : [];
  if (list.length < 2) throw new Error("합칠 녹음을 둘 이상 고르세요.");
  if (list.length > 6) throw new Error("한 번에 여섯 개까지 합칩니다.");

  const docs = await Promise.all(list.map(async (id) => ({ id, rec: await getRec(db, id) })));
  const meetingId = docs[0].rec.meetingId;
  if (docs.some((d) => d.rec.meetingId !== meetingId)) throw new Error("같은 회의의 녹음만 합칠 수 있습니다.");
  if (docs.some((d) => !d.rec.ended)) throw new Error("끝난 녹음만 합칠 수 있습니다. 녹음 중인 것은 먼저 끝내 주세요.");
  if (docs.some((d) => d.rec.archiveUrl)) throw new Error("노션으로 보관한 녹음은 합칠 수 없습니다.");

  // 녹음이 시작한 차례대로 — 앞엣것 안으로 모은다
  docs.sort((a, b) => (a.rec.createdAt ?? 0) - (b.rec.createdAt ?? 0));
  const keep = docs[0];
  const sources = docs.slice(1);
  const done: string[] = [...(keep.rec.mergedFrom ?? [])];

  let nextN = keep.rec.segCount;
  let offset = keep.rec.durationSec;
  let addUploaded = 0;
  let addTranscribed = 0;
  let addCost = 0;
  const speakers: Record<string, string> = { ...(keep.rec.speakers ?? {}) };

  for (const src of sources) {
    if (done.includes(src.id)) continue; // 지난번에 이미 옮겼다 — 지우기만 하면 된다
    const segs = await segsOf(db, src.id).orderBy("n").get();
    for (const seg of segs.docs) {
      const sd = seg.data() as SegDoc;
      const n = nextN++;
      await segRef(db, keep.id, n).set({
        ...sd,
        n,
        startSec: offset + sd.startSec,
        ...(sd.lines ? { lines: sd.lines.map((l) => ({ ...l, t: l.t + offset })) } : {}),
      });
      // 음성 조각도 함께 (음성을 지운 녹음이면 없다)
      const parts = await seg.ref.collection("parts").get();
      for (const part of parts.docs) await partRef(db, keep.id, n, Number(part.id)).set(part.data());
      if (sd.uploaded) addUploaded++;
      if (sd.transcribedAt) addTranscribed++;
    }
    offset += src.rec.durationSec ?? 0;
    addCost += src.rec.costUsd ?? 0;
    for (const [k, v] of Object.entries(src.rec.speakers ?? {})) if (!speakers[k]) speakers[k] = v;
    done.push(src.id);
  }

  await recRef(db, keep.id).update({
    segCount: nextN,
    uploaded: keep.rec.uploaded + addUploaded,
    transcribed: keep.rec.transcribed + addTranscribed,
    durationSec: offset,
    costUsd: FieldValue.increment(addCost),
    mergedFrom: done,
    ...(Object.keys(speakers).length > 0 ? { speakers } : {}),
    updatedAt: Date.now(),
  });

  // 초안 — 하나라도 있으면 이어 붙인 받아쓴 글로 다시 만들고, 원래 액션플랜을 지킨다
  const olds = docs.map((d) => d.rec.summary);
  let summary: MeetingMinutesDraft | undefined;
  let costUsd = 0;
  if (olds.some(Boolean)) {
    const fresh = await summarizeMerged(db, keep.id, meetingId, speakers);
    summary = { ...fresh.draft, actionItems: mergeActions(olds, fresh.draft) };
    costUsd = fresh.costUsd;
    await recRef(db, keep.id).update({ summary, summaryAt: Date.now(), costUsd: FieldValue.increment(costUsd) });
  }

  // 옮기고 난 녹음은 지운다 (조각·음성까지)
  for (const src of sources) await db.recursiveDelete(recRef(db, src.id));

  return { keepId: keep.id, segments: nextN, durationSec: offset, summary, costUsd };
}

/** 합친 녹음의 받아쓴 글 전체로 초안을 다시 만든다 */
async function summarizeMerged(
  db: Firestore,
  id: string,
  meetingId: string,
  speakers: Record<string, string>,
): Promise<{ draft: MeetingMinutesDraft; costUsd: number }> {
  const [segs, meeting, members] = await Promise.all([
    segsOf(db, id).orderBy("n").get(),
    db.collection(NEANDER_COL.meetings).doc(meetingId).get(),
    db.collection(NEANDER_COL.members).get(),
  ]);
  const lines: TranscriptLine[] = segs.docs.flatMap((d) => (d.data() as SegDoc).lines ?? []);
  if (lines.length === 0) throw new Error("받아쓴 말이 없습니다.");
  const m = meeting.data() as { date?: string; title?: string } | undefined;
  return draftMinutes({
    lines,
    meetingDate: m?.date ?? new Date().toISOString().slice(0, 10),
    meetingTitle: m?.title,
    teamNames: members.docs.map((d) => String(d.data().name ?? "").trim()).filter(Boolean),
    speakers: Object.keys(speakers).length > 0 ? speakers : undefined,
  });
}

/**
 * 액션플랜 합치기 — 원래 초안들의 것을 앞에 두고, 새 초안에만 있는 것을 뒤에 더한다.
 *
 * 같은 일을 말만 바꿔 적는 일이 잦다(실측: 「굿즈 모먼트 IP 캐릭터 향수 샘플 제작 및
 * ID 매장 비치」 ↔ 「굿즈모먼트 IP 향수 샘플 제작 및 매장 비치」). 글자 두 짝(bigram)이
 * 얼마나 겹치는지로 같은 일인지 본다 — 한쪽이 다른 쪽을 품지 않아도 잡힌다.
 */
const SAME_ACTION = 0.55;

function bigrams(text: string): Set<string> {
  const t = text.replace(/[\s·,.()\[\]"'“”‘’\-—]/g, "").toLowerCase();
  const out = new Set<string>();
  for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2));
  if (t.length === 1) out.add(t);
  return out;
}

/** 두 글의 겹침 (0~1) — 작은 쪽 기준이라 짧은 문장이 긴 문장에 담겨도 잡는다 */
function overlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let hit = 0;
  for (const g of a) if (b.has(g)) hit++;
  return hit / Math.min(a.size, b.size);
}

/** 두 액션이 같은 일인가 — 검증 스크립트가 이 규칙을 지킨다 */
export const isSameAction = (a: string, b: string) => overlap(bigrams(a), bigrams(b)) >= SAME_ACTION;

function mergeActions(olds: (MeetingMinutesDraft | undefined)[], fresh: MeetingMinutesDraft): MinutesActionDraft[] {
  // 원래 초안들의 액션은 **하나도 빼지 않는다** — 사람이 이미 본 것이고, 말이 비슷해도
  // 다른 일일 수 있다. 겹침은 새로 만든 초안 쪽에서만 걸러낸다.
  const out: MinutesActionDraft[] = [];
  const seen: Set<string>[] = [];
  for (const d of olds) {
    for (const item of d?.actionItems ?? []) {
      const g = bigrams(item.text ?? "");
      if (g.size === 0) continue;
      seen.push(g);
      out.push(item);
    }
  }
  for (const item of fresh.actionItems ?? []) {
    const g = bigrams(item.text ?? "");
    if (g.size === 0 || seen.some((x) => overlap(g, x) >= SAME_ACTION)) continue;
    seen.push(g);
    out.push(item);
  }
  return out.slice(0, 20);
}

/** 받아쓴 줄 전체로 회의록 초안을 만든다 */
export async function summarizeRecording(
  db: Firestore,
  id: unknown,
): Promise<{ summary: MeetingMinutesDraft; summaryAt: number; costUsd: number }> {
  const rec = await getRec(db, id);
  const rid = id as string;
  if (!isFullyTranscribed(view(rid, rec))) throw new Error("모든 조각을 받아쓴 뒤에 회의록 초안을 만들 수 있습니다.");
  const [segs, meeting, members] = await Promise.all([
    segsOf(db, rid).orderBy("n").get(),
    db.collection(NEANDER_COL.meetings).doc(rec.meetingId).get(),
    db.collection(NEANDER_COL.members).get(),
  ]);
  const lines: TranscriptLine[] = segs.docs.flatMap((d) => (d.data() as SegDoc).lines ?? []);
  if (lines.length === 0) throw new Error("받아쓴 말이 없습니다. 녹음에 말소리가 들어갔는지 확인해 주세요.");
  const m = meeting.data() as { date?: string; title?: string } | undefined;
  const { draft, costUsd } = await draftMinutes({
    lines,
    meetingDate: m?.date ?? new Date().toISOString().slice(0, 10),
    meetingTitle: m?.title,
    teamNames: members.docs.map((d) => String(d.data().name ?? "").trim()).filter(Boolean),
    speakers: rec.speakers,
  });
  const at = Date.now();
  await recRef(db, rid).update({ summary: draft, summaryAt: at, costUsd: FieldValue.increment(costUsd) });
  return { summary: draft, summaryAt: at, costUsd };
}

/** 초안을 넣은 회의록을 저장했다 — 30일 뒤 음성을 지운다 */
export async function confirmRecording(db: Firestore, id: unknown): Promise<MeetingRecording> {
  const rec = await getRec(db, id);
  const now = Date.now();
  const patch: Partial<RecDoc> = {};
  if (!rec.confirmedAt) patch.confirmedAt = now;
  if (!rec.audioDeletedAt && !rec.audioDeleteAt) patch.audioDeleteAt = now + REC_AUDIO_KEEP_DAYS * DAY_MS;
  if (Object.keys(patch).length) await recRef(db, id as string).update(patch);
  return view(id as string, { ...rec, ...patch });
}

// ---- 지우기 -------------------------------------------------

/** 음성 조각만 지운다 — 받아쓴 줄과 초안은 남긴다 */
export async function deleteRecordingAudio(db: Firestore, id: unknown): Promise<void> {
  await getRec(db, id);
  const segs = await segsOf(db, id as string).get();
  for (const s of segs.docs) await db.recursiveDelete(s.ref.collection("parts"));
  await recRef(db, id as string).update({ audioDeletedAt: Date.now() });
}

/** 노션으로 옮긴 뒤 — 음성 조각은 지우고 어디로 갔는지만 남긴다 (받아쓴 줄·초안은 그대로) */
export async function markRecordingArchived(db: Firestore, id: string, pageUrl: string): Promise<void> {
  const segs = await segsOf(db, id).get();
  for (const s of segs.docs) await db.recursiveDelete(s.ref.collection("parts"));
  await recRef(db, id).update({ archiveUrl: pageUrl, archivedAt: Date.now(), audioDeletedAt: Date.now() });
}

/** 녹음이 어느 회의의 무엇인지 — 기록을 남길 때 쓴다 (없으면 null) */
export async function recordingBrief(db: Firestore, id: unknown): Promise<{ meetingId: string; name: string } | null> {
  if (!isId(id)) return null;
  const d = (await recRef(db, id).get()).data() as RecDoc | undefined;
  return d ? { meetingId: d.meetingId, name: d.name } : null;
}

/** 지운 녹음이 무엇이었는지 돌려준다 — 부르는 쪽이 기록에 남긴다 */
export async function deleteRecording(db: Firestore, id: unknown): Promise<{ meetingId: string; name: string } | null> {
  if (!isId(id)) throw new Error("녹음 id 가 올바르지 않습니다.");
  const brief = await recordingBrief(db, id);
  await db.recursiveDelete(recRef(db, id));
  return brief;
}

/** 회의를 지우기 직전에 — 그 회의의 녹음을 모두 지운다 */
export async function deleteRecordingsOfMeeting(db: Firestore, meetingId: unknown): Promise<void> {
  if (!isId(meetingId)) throw new Error("회의 id 가 올바르지 않습니다.");
  const snap = await recs(db).where("meetingId", "==", meetingId).get();
  for (const d of snap.docs) await db.recursiveDelete(d.ref);
}
