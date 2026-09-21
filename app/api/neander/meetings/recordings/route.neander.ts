import { NextResponse } from "next/server";
import { adminDb } from "@/lib/neander/server/admin";
import { accessErrorResponse, requireMember } from "@/lib/neander/server/auth";
import {
  completeSegment,
  confirmRecording,
  createRecording,
  createSegment,
  deleteRecording,
  recordingBrief,
  deleteRecordingAudio,
  deleteRecordingsOfMeeting,
  endRecording,
  finalizeRecording,
  getMeetingRecordings,
  listRecordings,
  putSegmentPart,
  readSegmentAudio,
  setSpeakers,
  summarizeRecording,
  transcribeSegment,
} from "@/lib/neander/meetings/server/recordings";
import { logMeetingEvent } from "@/lib/neander/meetings/server/log";
import { REC_AUDIO_MIME, isRecAudioFormat } from "@/lib/neander/meetings/recording";

// 회의 녹음 — 팀원 누구나 (회의록과 같다). 저장 방식은 meetings/server/recordings.ts
export const dynamic = "force-dynamic";
// 받아쓰기 한 번은 실측 20~40초, 3시간 회의 초안은 1분 안팎
export const maxDuration = 300;

/** 한 번에 내려주는 음성 조각 수 — 5 × 768KB ≈ 3.8MB (응답 한도 4.5MB 아래) */
const MAX_READ_PARTS = 5;

function failure(e: unknown) {
  const denied = accessErrorResponse(e);
  if (denied) return denied;
  return NextResponse.json({ error: e instanceof Error ? e.message : "알 수 없는 오류" }, { status: 400 });
}

/**
 * 인자 없음      모든 녹음 (조각 없이)
 * ?meetingId=    그 회의의 녹음 — 조각과 받아쓴 줄까지
 * ?id=&n=&from=  조각 n 의 음성 바이트 [from, from+count)
 */
export async function GET(req: Request) {
  try {
    await requireMember(req);
    const db = adminDb();
    const url = new URL(req.url);
    const meetingId = url.searchParams.get("meetingId");
    const id = url.searchParams.get("id");
    if (meetingId) return NextResponse.json({ recordings: await getMeetingRecordings(db, meetingId) });
    if (id) {
      const from = Math.max(0, Number(url.searchParams.get("from")) || 0);
      const count = Math.min(MAX_READ_PARTS, Math.max(1, Number(url.searchParams.get("count")) || 1));
      const { bytes, format } = await readSegmentAudio(db, id, url.searchParams.get("n"), from, count);
      return new Response(new Uint8Array(bytes), {
        headers: {
          "Content-Type": isRecAudioFormat(format) ? REC_AUDIO_MIME[format] : "application/octet-stream",
          "Cache-Control": "private, no-store",
        },
      });
    }
    return NextResponse.json({ recordings: await listRecordings(db) });
  } catch (e) {
    return failure(e);
  }
}

export async function POST(req: Request) {
  try {
    const { email: me } = await requireMember(req);
    const db = adminDb();
    const body = (await req.json()) as {
      action?: string;
      id?: unknown;
      meetingId?: unknown;
      source?: unknown;
      name?: unknown;
      durationSec?: unknown;
      n?: unknown;
      k?: unknown;
      startSec?: unknown;
      format?: unknown;
      size?: unknown;
      segCount?: unknown;
      base64?: unknown;
      speakers?: unknown;
    };
    switch (body.action) {
      case "create":
        return NextResponse.json({ recording: await createRecording(db, me, body) });
      case "segment":
        return NextResponse.json(await createSegment(db, me, body));
      case "part":
        await putSegmentPart(db, me, body.id, body.n, body.k, Buffer.from(String(body.base64 ?? ""), "base64"));
        return NextResponse.json({ ok: true });
      case "segment-done":
        await completeSegment(db, me, body.id, body.n);
        return NextResponse.json({ ok: true });
      case "end": {
        await endRecording(db, me, body);
        const brief = await recordingBrief(db, body.id);
        if (brief) await logMeetingEvent(db, me, brief.meetingId, "recording-added", brief.name);
        return NextResponse.json({ ok: true });
      }
      case "finalize": {
        await finalizeRecording(db, me, body.id);
        // 끊긴 녹음을 수습한 것 — 마친 사람이 녹음한 사람과 다를 수 있어 따로 적는다
        const brief = await recordingBrief(db, body.id);
        if (brief) await logMeetingEvent(db, me, brief.meetingId, "recording-added", `${brief.name} (끊긴 녹음 수습)`);
        return NextResponse.json({ ok: true });
      }
      case "transcribe":
        return NextResponse.json({ segment: await transcribeSegment(db, body.id, body.n) });
      case "speakers":
        await setSpeakers(db, body.id, body.speakers);
        return NextResponse.json({ ok: true });
      case "summarize":
        return NextResponse.json(await summarizeRecording(db, body.id));
      case "confirm":
        return NextResponse.json({ recording: await confirmRecording(db, body.id) });
      case "delete-audio":
        await deleteRecordingAudio(db, body.id);
        return NextResponse.json({ ok: true });
      case "delete": {
        const gone = await deleteRecording(db, body.id);
        if (gone) await logMeetingEvent(db, me, gone.meetingId, "recording-removed", gone.name);
        return NextResponse.json({ ok: true });
      }
      case "delete-meeting":
        await deleteRecordingsOfMeeting(db, body.meetingId);
        return NextResponse.json({ ok: true });
      default:
        throw new Error("알 수 없는 동작입니다.");
    }
  } catch (e) {
    return failure(e);
  }
}
