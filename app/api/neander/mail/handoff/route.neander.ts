import { NextResponse } from "next/server";
import { adminDb } from "@/lib/neander/server/admin";
import { accessErrorResponse, requireMember } from "@/lib/neander/server/auth";
import { NEANDER_COL } from "@/lib/neander/collections";
import { parseRaw, unpackBody } from "@/lib/neander/mail/server/parse";
import { fetchRawForDoc } from "@/lib/neander/mail/server/sync";
import { MailAccessError, boxRef, resolveBox, type MailDoc } from "@/lib/neander/mail/server/store";
import { completeMeetingFile, createMeetingFile, putMeetingFilePart } from "@/lib/neander/meetings/server/files";
import { logMeetingEvent } from "@/lib/neander/meetings/server/log";
import { mailRefOf } from "@/lib/neander/mail/types";

// ============================================================
//  메일 한 통을 회의 자료로 (2026-09-22)
// ------------------------------------------------------------
//  받은 제안서·자료 메일을 회의 자리로 옮긴다. 서버에서 하는 이유는 **첨부**다 —
//  첨부 원본은 ERP 에 없고 메일 서버에 있어(docs/mail.md), 원문을 한 번 받아
//  꺼낸 뒤 회의 첨부(Firestore 조각)로 옮겨야 한다. 브라우저를 거치면 파일이
//  두 번 오간다.
//
//  업무요청·일일업무는 첨부가 없어 화면에서 바로 만든다 (db/requests·tasks).
// ============================================================
export const dynamic = "force-dynamic";
// 20MB 첨부 몇 개를 메일 서버에서 받아 조각으로 나눠 쓴다
export const maxDuration = 120;

/** 본문을 회의록 글로 — html 뿐이면 태그를 걷어 낸다 */
function bodyText(d: MailDoc): string {
  const body = unpackBody(d.body);
  const raw = body.text?.trim() || (body.html ?? "").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ");
  return raw
    .replace(/&nbsp;/g, " ")
    .replace(/[ \t]+/g, " ")
    .split("\n")
    .map((l) => l.trim())
    .filter((l, i, arr) => l || arr[i - 1]) // 빈 줄이 잇따르면 하나만
    .join("\n")
    .trim()
    .slice(0, 20_000);
}

const addrText = (a: { name?: string; address: string }) => (a.name ? `${a.name} <${a.address}>` : a.address);

export async function POST(req: Request) {
  try {
    const { email: me } = await requireMember(req);
    const db = adminDb();
    const body = (await req.json()) as {
      acct?: string;
      box?: string;
      id?: string;
      /** 상위 회의 — 있으면 그 회의의 자료로 들어간다 */
      parentId?: string;
      date?: string;
      title?: string;
      /** 가져올 첨부 (attachments[].index). 없으면 첨부는 안 가져온다 */
      attachments?: number[];
    };
    if (!body.id || !/^[\w-]{1,80}$/.test(body.id)) throw new Error("메일을 지정해 주세요.");

    const at = await resolveBox(db, me, body.box, body.acct);
    const snap = await boxRef(db, at.owner, at.box).doc(body.id).get();
    if (!snap.exists) throw new Error("메일을 찾지 못했습니다.");
    const d = snap.data() as MailDoc;

    const wanted = (body.attachments ?? []).filter((n) => Number.isInteger(n));
    const metas = d.attachments.filter((a) => wanted.includes(a.index));
    if (metas.length > 0 && d.imported) {
      throw new Error("백업에서 가져온 메일이라 첨부 원본이 없습니다. 첨부를 빼고 옮겨 주세요.");
    }

    // ---- 회의(자료) 만들기 --------------------------------------
    // 계정 키 = 메일 계정 문서 id (resolveBox 의 owner)
    const ref = mailRefOf({ box: at.box, id: body.id, subject: d.subject, from: d.from, date: d.date }, at.owner);
    const head = [`■ 메일에서 옮김`, `- 보낸 사람: ${addrText(d.from)}`, `- 받은 날짜: ${new Date(d.date).toLocaleString("ko-KR")}`].join("\n");
    const content = `${head}\n\n${bodyText(d)}`.trim();
    const now = Date.now();
    const meeting = await db.collection(NEANDER_COL.meetings).add({
      date: body.date || new Date(d.date).toISOString().slice(0, 10),
      title: (body.title || d.subject || "제목 없는 메일").slice(0, 200),
      content,
      actionItems: [],
      ...(body.parentId ? { parentId: body.parentId } : {}),
      mail: ref,
      createdAt: now,
      updatedAt: now,
    });
    await logMeetingEvent(db, me, meeting.id, "created", `메일에서 옮김 — ${d.subject ?? ""}`.trim());

    // ---- 첨부 옮기기 (원문을 한 번만 받아 여러 개를 꺼낸다) ------
    const moved: string[] = [];
    const skipped: { name: string; reason: string }[] = [];
    if (metas.length > 0) {
      const raw = await fetchRawForDoc(db, at.owner, d);
      const parsed = await parseRaw(raw);
      for (const meta of metas) {
        try {
          const att = parsed.attachments[meta.index];
          if (!att?.content) throw new Error("원문에서 첨부를 찾지 못했습니다.");
          const bytes = Buffer.from(att.content);
          const made = await createMeetingFile(db, me, {
            meetingId: meeting.id,
            name: meta.name,
            type: meta.type || att.contentType || "application/octet-stream",
            size: bytes.length,
          });
          for (let n = 0; n < made.parts; n++) {
            await putMeetingFilePart(db, me, made.id, n, bytes.subarray(n * made.partBytes, (n + 1) * made.partBytes));
          }
          await completeMeetingFile(db, me, made.id);
          moved.push(meta.name);
        } catch (e) {
          skipped.push({ name: meta.name, reason: e instanceof Error ? e.message : "알 수 없는 오류" });
        }
      }
      if (moved.length > 0) await logMeetingEvent(db, me, meeting.id, "file-added", moved.join(" · "));
    }

    return NextResponse.json({ meetingId: meeting.id, files: moved.length, skipped });
  } catch (e) {
    const denied = accessErrorResponse(e);
    if (denied) return denied;
    const status = e instanceof MailAccessError ? 403 : 400;
    return NextResponse.json({ error: e instanceof Error ? e.message : "알 수 없는 오류" }, { status });
  }
}
