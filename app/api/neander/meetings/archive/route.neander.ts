import { NextResponse } from "next/server";
import { adminDb } from "@/lib/neander/server/admin";
import { accessErrorResponse, requireMember } from "@/lib/neander/server/auth";
import { NEANDER_COL } from "@/lib/neander/collections";
import { logMeetingEvent } from "@/lib/neander/meetings/server/log";
import { ARCHIVE_AFTER_DAYS, archiveMeeting, listArchiveCandidates } from "@/lib/neander/meetings/server/archive";
import { checkArchiveAccess, notionArchiveEnabled } from "@/lib/neander/notion/archive-client";

// 오래된 회의 자료를 노션으로 옮긴다 — 팀원 누구나 (회의록과 같다)
export const dynamic = "force-dynamic";
// 30MB 파일 하나를 올리는 데 시간이 걸린다. 한 번에 회의 하나씩만 처리한다
export const maxDuration = 300;

function failure(e: unknown) {
  const denied = accessErrorResponse(e);
  if (denied) return denied;
  return NextResponse.json({ error: e instanceof Error ? e.message : "알 수 없는 오류" }, { status: 400 });
}

/** 옮길 회의 목록 + 노션 연결 상태 */
export async function GET(req: Request) {
  try {
    await requireMember(req);
    const enabled = notionArchiveEnabled();
    const [candidates, access] = await Promise.all([
      listArchiveCandidates(adminDb()),
      enabled ? checkArchiveAccess() : Promise.resolve(null),
    ]);
    return NextResponse.json({ enabled, access, days: ARCHIVE_AFTER_DAYS, candidates });
  } catch (e) {
    return failure(e);
  }
}

/** 회의 하나를 보관한다 — 화면이 목록을 돌며 하나씩 부른다 */
export async function POST(req: Request) {
  try {
    const { email: me } = await requireMember(req);
    const db = adminDb();
    const { meetingId } = (await req.json()) as { meetingId?: string };
    if (!meetingId) throw new Error("회의 id 가 없습니다.");
    if (!notionArchiveEnabled()) {
      throw new Error("노션 보관이 설정되지 않았습니다 (NOTION_ARCHIVE_TOKEN · NOTION_ARCHIVE_PAGE).");
    }
    // 파일을 올린 사람 이름을 노션 페이지에 적는다
    const members = await db.collection(NEANDER_COL.members).get();
    const byEmail = new Map<string, string>();
    members.docs.forEach((d) => {
      const m = d.data() as { name?: string; email?: string };
      if (m.email) byEmail.set(m.email.trim().toLowerCase(), m.name ?? m.email);
    });
    const result = await archiveMeeting(db, meetingId, (email) => byEmail.get(email.trim().toLowerCase()) ?? email.split("@")[0]);
    if (result.files + result.recordings > 0) {
      const what = [result.files ? `첨부 ${result.files}개` : "", result.recordings ? `녹음 ${result.recordings}개` : ""]
        .filter(Boolean)
        .join(" · ");
      await logMeetingEvent(db, me, meetingId, "file-archived", what);
    }
    return NextResponse.json(result);
  } catch (e) {
    return failure(e);
  }
}
