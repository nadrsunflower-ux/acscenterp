import { NextResponse } from "next/server";
import { adminDb } from "@/lib/neander/server/admin";
import { accessErrorResponse, requireMember } from "@/lib/neander/server/auth";
import { freshFileUrl } from "@/lib/neander/notion/archive-client";
import {
  archivedMeetingFile,
  completeMeetingFile,
  createMeetingFile,
  deleteFilesOfMeeting,
  deleteMeetingFile,
  listMeetingFiles,
  putMeetingFilePart,
  readMeetingFileParts,
} from "@/lib/neander/meetings/server/files";
import { logMeetingEvent } from "@/lib/neander/meetings/server/log";

// 회의 첨부 파일 — 팀원 누구나 (회의록과 같다). 저장 방식은 meetings/server/files.ts
export const dynamic = "force-dynamic";

/** 한 번에 내려주는 조각 수 — 5 × 768KB ≈ 3.8MB (응답 한도 4.5MB 아래) */
const MAX_READ_PARTS = 5;

function failure(e: unknown) {
  const denied = accessErrorResponse(e);
  if (denied) return denied;
  return NextResponse.json({ error: e instanceof Error ? e.message : "알 수 없는 오류" }, { status: 400 });
}

/** id 가 없으면 첨부 목록, 있으면 그 파일의 조각 [from, from+count) */
export async function GET(req: Request) {
  try {
    await requireMember(req);
    const url = new URL(req.url);
    const id = url.searchParams.get("id");
    if (!id) return NextResponse.json({ files: await listMeetingFiles(adminDb()) });
    // 노션으로 옮긴 파일 — 내용은 노션에 있다. 주소는 1시간이면 만료되므로 받을 때마다 새로 받는다.
    // 바이트를 우리가 대신 받아다 주지 않는다 — 브라우저가 그 주소로 바로 가는 게 빠르고 싸다
    const archive = await archivedMeetingFile(adminDb(), id);
    if (archive) return NextResponse.json({ archived: true, url: await freshFileUrl(archive.blockId) });
    const from = Math.max(0, Number(url.searchParams.get("from")) || 0);
    const count = Math.min(MAX_READ_PARTS, Math.max(1, Number(url.searchParams.get("count")) || 1));
    const bytes = await readMeetingFileParts(adminDb(), id, from, count);
    return new Response(new Uint8Array(bytes), {
      headers: { "Content-Type": "application/octet-stream", "Cache-Control": "private, no-store" },
    });
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
      meetingId?: string;
      id?: string;
      n?: number;
      base64?: string;
      name?: string;
      type?: string;
      size?: number;
    };
    switch (body.action) {
      case "create":
        return NextResponse.json(await createMeetingFile(db, me, body));
      case "part":
        await putMeetingFilePart(db, me, body.id, Number(body.n), Buffer.from(String(body.base64 ?? ""), "base64"));
        return NextResponse.json({ ok: true });
      case "done": {
        const file = await completeMeetingFile(db, me, body.id);
        await logMeetingEvent(db, me, file.meetingId, "file-added", file.name);
        return NextResponse.json({ file });
      }
      case "delete": {
        const gone = await deleteMeetingFile(db, body.id);
        if (gone) await logMeetingEvent(db, me, gone.meetingId, "file-removed", gone.name);
        return NextResponse.json({ ok: true });
      }
      case "delete-meeting":
        await deleteFilesOfMeeting(db, body.meetingId);
        return NextResponse.json({ ok: true });
      default:
        throw new Error("알 수 없는 동작입니다.");
    }
  } catch (e) {
    return failure(e);
  }
}
