import { NextResponse } from "next/server";
import { adminDb } from "@/lib/neander/server/admin";
import { accessErrorResponse, requireMember } from "@/lib/neander/server/auth";
import { parseRaw } from "@/lib/neander/mail/server/parse";
import { fetchRawForDoc } from "@/lib/neander/mail/server/sync";
import { saveBuffer } from "@/lib/neander/mail/server/blobs";
import { MailAccessError, boxRef, resolveBox, type MailDoc } from "@/lib/neander/mail/server/store";

// 첨부 한 개 — ERP 에는 첨부를 두지 않는다 (Storage 버킷이 없다, parse.ts).
// 누를 때 메일 서버에서 원문을 받아 그 첨부만 꺼내 준다. 몇 초 걸린다.
//
// ⚠️ 응답 한도: Vercel 함수 응답은 4.5MB 까지다. 그보다 큰 첨부는 조각
//    저장소(blobs.ts)에 잠시 두고 { blob } 만 돌려준다 — 브라우저가 조각을
//    나눠 받아 붙인 뒤 지운다.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DIRECT_MAX = 4 * 1024 * 1024;

export async function GET(req: Request) {
  try {
    const { email: me } = await requireMember(req);
    const url = new URL(req.url);
    const id = url.searchParams.get("id");
    const index = Number(url.searchParams.get("i"));
    if (!id || !/^[\w-]{1,80}$/.test(id) || !Number.isInteger(index)) {
      return NextResponse.json({ error: "첨부를 지정해 주세요." }, { status: 400 });
    }

    const db = adminDb();
    const at = await resolveBox(db, me, url.searchParams.get("box"), url.searchParams.get("acct"));
    const snap = await boxRef(db, at.owner, at.box).doc(id).get();
    if (!snap.exists) return NextResponse.json({ error: "메일을 찾지 못했습니다." }, { status: 404 });
    const d = snap.data() as MailDoc;
    const meta = d.attachments.find((a) => a.index === index);
    if (!meta) return NextResponse.json({ error: "첨부를 찾지 못했습니다." }, { status: 404 });
    if (d.imported) {
      return NextResponse.json(
        { error: "백업에서 가져온 메일이라 첨부 원본이 ERP 에 없습니다. 카페24 웹메일에서 받아 주세요." },
        { status: 409 },
      );
    }
    if (!d.uidlHash && !d.imap) {
      return NextResponse.json(
        { error: "원문이 아직 메일 서버에 없습니다. 보낸 메일은 사본이 들어온 뒤(1분 안팎) 열 수 있어요." },
        { status: 409 },
      );
    }

    const parsed = await parseRaw(await fetchRawForDoc(db, at.owner, d));
    // 자리(index)보다 내용 확인값을 먼저 믿는다 — 보낸 메일 사본은 다시 짠 MIME 이라 자리가 어긋날 수 있다
    const a =
      (meta.checksum && parsed.attachments.find((x) => x.checksum === meta.checksum)) ||
      parsed.attachments[meta.index];
    if (!a) return NextResponse.json({ error: "원문에서 첨부를 찾지 못했습니다." }, { status: 404 });

    if (a.content.length > DIRECT_MAX) {
      // 조각은 받는 사람(나) 이름으로 둔다 — 공유 메일함이어도 내려받는 건 나다
      const blob = await saveBuffer(db, me, meta.name, meta.type, a.content);
      return NextResponse.json({ blob });
    }
    return new Response(new Uint8Array(a.content), {
      headers: {
        "Content-Type": meta.type || "application/octet-stream",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(meta.name)}`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    const denied = accessErrorResponse(e);
    if (denied) return denied;
    if (e instanceof MailAccessError) return NextResponse.json({ error: e.message }, { status: 403 });
    console.error("[mail/attachment]", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "알 수 없는 오류" }, { status: 500 });
  }
}
