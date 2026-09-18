import { NextResponse } from "next/server";
import { adminDb } from "@/lib/neander/server/admin";
import { accessErrorResponse, requireMember } from "@/lib/neander/server/auth";
import { sendComposed } from "@/lib/neander/mail/server/send";
import { scheduleMail } from "@/lib/neander/mail/server/compose";
import { publicOrigin } from "@/lib/neander/mail/server/track";
import { MailAccessError, resolveAccount } from "@/lib/neander/mail/server/store";
import { isMailBox, type MailAddr, type MailBlobRef, type MailSendInput } from "@/lib/neander/mail/types";

// 메일 보내기 — 카페24 SMTP 로 보내고 ERP 「보낸메일함」에 남긴다 (send.ts).
// sendAt 이 있으면 예약메일함에 넣는다 (compose.ts).
export const dynamic = "force-dynamic";
// 20MB 첨부를 모아 붙이고, 전달이면 원본 첨부를 메일 서버에서 받아 붙인다
export const maxDuration = 60;

const addrList = (v: unknown): MailAddr[] =>
  Array.isArray(v)
    ? v
        .filter((a): a is MailAddr => !!a && typeof (a as MailAddr).address === "string" && !!(a as MailAddr).address.trim())
        .slice(0, 200)
        .map((a) => (a.name ? { name: String(a.name), address: a.address.trim() } : { address: a.address.trim() }))
    : [];

const MODES = ["reply", "replyAll", "forward"] as const;

function refOf(v: unknown): MailSendInput["ref"] {
  const r = v as MailSendInput["ref"];
  if (!r || !isMailBox(r.box) || typeof r.id !== "string" || !/^[\w-]{1,80}$/.test(r.id)) return undefined;
  if (!MODES.includes(r.mode)) return undefined;
  return { box: r.box, id: r.id, mode: r.mode, ...(typeof r.owner === "string" && r.owner ? { owner: r.owner } : {}) };
}

const blobList = (v: unknown): MailBlobRef[] =>
  Array.isArray(v)
    ? v
        .filter((b): b is MailBlobRef => !!b && typeof (b as MailBlobRef).id === "string")
        .map((b) => ({ id: b.id, name: String(b.name ?? ""), type: String(b.type ?? ""), size: Number(b.size) || 0 }))
    : [];

export async function POST(req: Request) {
  try {
    const { email: me } = await requireMember(req);
    const raw = (await req.json()) as Partial<MailSendInput> & { acct?: string };
    const input: MailSendInput = {
      to: addrList(raw.to),
      cc: addrList(raw.cc),
      bcc: addrList(raw.bcc),
      subject: String(raw.subject ?? "").trim(),
      html: typeof raw.html === "string" ? raw.html : undefined,
      text: String(raw.text ?? ""),
      mode: raw.mode === "text" || raw.mode === "html" ? raw.mode : "rich",
      ref: refOf(raw.ref),
      blobs: blobList(raw.blobs),
      forwardSkip: Array.isArray(raw.forwardSkip) ? raw.forwardSkip.filter(Number.isInteger) : undefined,
      self: raw.self === true,
      saveSent: raw.saveSent !== false,
      individually: raw.individually === true,
      draftId: typeof raw.draftId === "string" && /^[\w-]{1,80}$/.test(raw.draftId) ? raw.draftId : undefined,
      sendAt: Number(raw.sendAt) || undefined,
    };
    const db = adminDb();
    // 보내는 계정 — 내 메일 계정 중 하나여야 한다
    const key = (await resolveAccount(db, me, raw.acct)).owner;
    const origin = publicOrigin(req);
    if (input.sendAt) {
      const scheduled = await scheduleMail(db, key, input, origin, me);
      return NextResponse.json({ scheduled });
    }
    const out = await sendComposed(db, key, input, origin, me);
    return NextResponse.json(out);
  } catch (e) {
    const denied = accessErrorResponse(e);
    if (denied) return denied;
    if (e instanceof MailAccessError) return NextResponse.json({ error: e.message }, { status: 403 });
    console.error("[mail/send]", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "알 수 없는 오류" }, { status: 500 });
  }
}
