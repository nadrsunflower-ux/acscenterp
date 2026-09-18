import { NextResponse } from "next/server";
import { adminDb } from "@/lib/neander/server/admin";
import { accessErrorResponse, requireMember } from "@/lib/neander/server/auth";
import { deleteBlobs, readBlob } from "@/lib/neander/mail/server/blobs";
import { importRaw, type ImportOutcome } from "@/lib/neander/mail/server/importer";
import { MailAccessError, resolveAccount } from "@/lib/neander/mail/server/store";
import { isCustomBox, isMailBox } from "@/lib/neander/mail/types";

// 카페24 웹메일 백업 가져오기 — 브라우저가 zip 을 풀어 .eml 을 몇 통씩 보낸다.
// 큰 메일(3MB 넘게)은 조각으로 먼저 올리고 blobId 로 부른다 (importer.ts).
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const { email: me } = await requireMember(req);
    const db = adminDb();
    const body = (await req.json()) as { box?: string; items?: { base64?: string }[]; blobId?: string; acct?: string };
    const acc = await resolveAccount(db, me, body.acct);
    const key = acc.owner;
    const box = body.box;
    if (!isMailBox(box) || box === "drafts") {
      return NextResponse.json({ error: "가져올 메일함을 골라 주세요." }, { status: 400 });
    }
    if (isCustomBox(box)) {
      if (!acc.folders?.some((f) => f.id === box)) {
        return NextResponse.json({ error: "메일함을 찾지 못했습니다." }, { status: 404 });
      }
    }

    const result: Record<ImportOutcome, number> = { added: 0, duplicate: 0, failed: 0 };
    if (body.blobId) {
      const { bytes } = await readBlob(db, me, body.blobId);
      result[await importRaw(db, key, box, bytes)]++;
      await deleteBlobs(db, me, [body.blobId]);
    }
    for (const it of (body.items ?? []).slice(0, 50)) {
      const raw = Buffer.from(String(it.base64 ?? ""), "base64");
      if (!raw.length) {
        result.failed++;
        continue;
      }
      result[await importRaw(db, key, box, raw)]++;
    }
    return NextResponse.json(result);
  } catch (e) {
    const denied = accessErrorResponse(e);
    if (denied) return denied;
    if (e instanceof MailAccessError) return NextResponse.json({ error: e.message }, { status: 403 });
    console.error("[mail/import]", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "알 수 없는 오류" }, { status: 500 });
  }
}
