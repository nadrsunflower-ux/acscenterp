import { NextResponse } from "next/server";
import { adminDb } from "@/lib/neander/server/admin";
import { accessErrorResponse, requireMember } from "@/lib/neander/server/auth";
import { bodyOf, parseRaw, unpackBody } from "@/lib/neander/mail/server/parse";
import { fetchRawForDoc } from "@/lib/neander/mail/server/sync";
import { setImapFlag } from "@/lib/neander/mail/server/imap";
import { readScheduled } from "@/lib/neander/mail/server/compose";
import {
  MailAccessError,
  boxRef,
  readPatch,
  resolveAccount,
  resolveBox,
  toSummary,
  type MailDoc,
} from "@/lib/neander/mail/server/store";
import { snippetOf } from "@/lib/neander/mail/server/parse";
import type { MailDetail } from "@/lib/neander/mail/types";

// 메일 한 통 — 본문까지. 내 메일함에서 열면 읽음으로 바꾼다.
// full=1 이면 ERP 에 잘려 들어온 본문 대신 서버 원문을 다시 받아 전부 보인다.
// acct 는 메일 계정 키 — 내 계정 중 하나, 또는 동료가 공유한 메일함의 계정
// (그때는 읽기 전용 — 읽음도 바꾸지 않는다).
export const dynamic = "force-dynamic";
// full=1 은 메일 서버에서 원문을 받는다 (확인과 겹치면 10초 기다렸다 다시 로그인)
export const maxDuration = 60;

export async function GET(req: Request) {
  try {
    const { email: me } = await requireMember(req);
    const url = new URL(req.url);
    const box = url.searchParams.get("box");
    const id = url.searchParams.get("id");
    if (!id || !/^[\w-]{1,80}$/.test(id)) return NextResponse.json({ error: "메일을 지정해 주세요." }, { status: 400 });
    const db = adminDb();
    const acct = url.searchParams.get("acct");

    // 예약 메일 — 작성 내용을 그대로 보여 준다
    if (box === "scheduled") {
      const acc = await resolveAccount(db, me, acct);
      const d = await readScheduled(db, acc.owner, id);
      const from = { name: acc?.name || undefined, address: acc?.address ?? "" };
      const detail: MailDetail = {
        id,
        box: "scheduled",
        from,
        to: d.input.self ? [from] : d.input.to,
        cc: d.input.cc,
        bcc: d.input.bcc,
        subject: d.input.subject || "(제목 없음)",
        date: d.sendAt,
        snippet: snippetOf(d.input.text),
        read: true,
        starred: false,
        attachments: d.input.blobs.map((b, index) => ({ index, name: b.name, type: b.type, size: b.size })),
        onServer: false,
        schedule: { status: d.status, error: d.error },
        html: d.input.mode !== "text" ? d.input.html : undefined,
        text: d.input.text,
        compose: d.input,
      };
      return NextResponse.json({ message: detail });
    }

    const at = await resolveBox(db, me, box, acct);
    const ref = boxRef(db, at.owner, at.box).doc(id);
    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ error: "메일을 찾지 못했습니다." }, { status: 404 });
    const d = snap.data() as MailDoc;

    let body = unpackBody(d.body);
    let partial = !!d.partial;
    if (url.searchParams.get("full") === "1" && (d.uidlHash || d.imap)) {
      body = bodyOf(await parseRaw(await fetchRawForDoc(db, at.owner, d))).full;
      partial = false;
    }

    if (!d.read && !at.readonly) {
      await ref.update(readPatch(true, d.date));
      // 네이버·Gmail 이면 서버에도 읽음 — 실패해도 읽기는 막지 않는다
      if (d.imap) await setImapFlag(at.account, [d.imap], "\\Seen", true).catch(() => undefined);
    }

    const detail: MailDetail = {
      ...toSummary(id, at.box, { ...d, read: at.readonly ? d.read : true }, at.account.externals),
      messageId: d.messageId ?? undefined,
      replyTo: d.replyTo,
      bcc: at.readonly ? undefined : d.bcc,
      html: body.html,
      text: body.text,
      partial,
      readonly: at.readonly || undefined,
      compose: at.box === "drafts" ? d.compose : undefined,
    };
    return NextResponse.json({ message: detail, wasUnread: !d.read && !at.readonly });
  } catch (e) {
    const denied = accessErrorResponse(e);
    if (denied) return denied;
    if (e instanceof MailAccessError) return NextResponse.json({ error: e.message }, { status: 403 });
    console.error("[mail/message]", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "알 수 없는 오류" }, { status: 500 });
  }
}
