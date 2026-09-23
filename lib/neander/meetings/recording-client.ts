"use client";

// ============================================================
//  회의 녹음 클라이언트 — 서버 API 경유 (app/api/neander/meetings/recordings)
// ------------------------------------------------------------
//  녹음 컬렉션은 보안 규칙에 없어 브라우저가 직접 못 읽는다. 조각 음성은
//  첨부 파일(client.ts)과 같은 768KB 나눠 올리기다.
// ============================================================

import { getNeanderAuth } from "@/lib/neander/firebase";
import {
  REC_AUDIO_MIME,
  REC_PART_BYTES,
  type MeetingMinutesDraft,
  type MeetingRecording,
  type RecAudioFormat,
  type RecordingDetail,
  type RecordingSegment,
  type RecordingSource,
} from "./recording";

const BASE = "/api/neander/meetings/recordings";

async function token(): Promise<string> {
  const user = getNeanderAuth().currentUser;
  if (!user) throw new Error("로그인이 필요합니다.");
  return user.getIdToken();
}

async function readError(res: Response): Promise<string> {
  try {
    return ((await res.json()) as { error?: string }).error || `요청이 실패했습니다 (HTTP ${res.status})`;
  } catch {
    return `요청이 실패했습니다 (HTTP ${res.status})`;
  }
}

async function post<T>(body: object): Promise<T> {
  const res = await fetch(BASE, {
    method: "POST",
    headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as T;
}

async function get<T>(query: string): Promise<T> {
  const res = await fetch(`${BASE}${query}`, { headers: { Authorization: `Bearer ${await token()}` }, cache: "no-store" });
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as T;
}

/** 모든 녹음 (조각 없이) */
export const fetchRecordings = () => get<{ recordings: MeetingRecording[] }>("").then((r) => r.recordings);

/** 회의 하나의 녹음 — 조각과 받아쓴 줄까지 */
export const fetchMeetingRecordings = (meetingId: string) =>
  get<{ recordings: RecordingDetail[] }>(`?meetingId=${encodeURIComponent(meetingId)}`).then((r) => r.recordings);

export const createRecording = (meta: { meetingId: string; source: RecordingSource; name?: string; durationSec?: number }) =>
  post<{ recording: MeetingRecording }>({ action: "create", ...meta }).then((r) => r.recording);

export const endRecording = (id: string, segCount: number, durationSec: number) =>
  post({ action: "end", id, segCount, durationSec });

/** 올라간 데까지로 마친다 — 끊긴 녹음 */
export const finalizeRecording = (id: string) => post({ action: "finalize", id });

export const transcribeSegment = (id: string, n: number) =>
  post<{ segment: RecordingSegment }>({ action: "transcribe", id, n }).then((r) => r.segment);

export const saveSpeakers = (id: string, speakers: Record<string, string>) => post({ action: "speakers", id, speakers });

export const summarizeRecording = (id: string) =>
  post<{ summary: MeetingMinutesDraft; summaryAt: number; costUsd: number }>({ action: "summarize", id });

/** 나눠 녹음한 회의를 하나로 — 음성·받아쓴 글·초안을 앞 녹음 안으로 모은다 */
export const mergeRecordings = (ids: string[]) =>
  post<{ keepId: string; segments: number; durationSec: number; summary?: MeetingMinutesDraft; costUsd: number }>({
    action: "merge",
    ids,
  });

export const confirmRecording = (id: string) => post({ action: "confirm", id });

export const deleteRecordingAudio = (id: string) => post({ action: "delete-audio", id });

export const deleteRecording = (id: string) => post({ action: "delete", id });

export const deleteRecordingsOfMeeting = (meetingId: string) => post({ action: "delete-meeting", meetingId });

// ---- 조각 올리기 ---------------------------------------------

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** 10분 조각 하나를 올린다. 이미 올라가 있으면 건너뛴다 */
export async function uploadSegment(
  id: string,
  seg: { n: number; startSec: number; durationSec: number; format: RecAudioFormat; blob: Blob },
  onProgress?: (p: number) => void,
): Promise<void> {
  const { parts, partBytes, already } = await post<{ parts: number; partBytes: number; already: boolean }>({
    action: "segment",
    id,
    n: seg.n,
    startSec: seg.startSec,
    durationSec: seg.durationSec,
    format: seg.format,
    size: seg.blob.size,
  });
  if (already) return onProgress?.(1);
  let done = 0;
  const one = async (k: number) => {
    const buf = await seg.blob.slice(k * partBytes, (k + 1) * partBytes).arrayBuffer();
    await post({ action: "part", id, n: seg.n, k, base64: toBase64(buf) });
    onProgress?.(++done / parts);
  };
  for (let k = 0; k < parts; k += 3) await Promise.all([k, k + 1, k + 2].filter((i) => i < parts).map(one));
  await post({ action: "segment-done", id, n: seg.n });
}

// ---- 듣기 ---------------------------------------------------

/** 조각 음성을 받아 재생할 수 있는 Blob 으로 */
export async function fetchSegmentAudio(id: string, seg: RecordingSegment): Promise<Blob> {
  const auth = { Authorization: `Bearer ${await token()}` };
  const parts = Math.ceil(seg.size / REC_PART_BYTES);
  const chunks: ArrayBuffer[] = [];
  for (let from = 0; from < parts; from += 5) {
    const r = await fetch(`${BASE}?id=${encodeURIComponent(id)}&n=${seg.n}&from=${from}&count=5`, {
      headers: auth,
      cache: "no-store",
    });
    if (!r.ok) throw new Error(await readError(r));
    chunks.push(await r.arrayBuffer());
  }
  return new Blob(chunks, { type: REC_AUDIO_MIME[seg.format] });
}
