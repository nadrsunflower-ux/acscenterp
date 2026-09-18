import { NextResponse } from "next/server";
import { adminDb } from "@/lib/neander/server/admin";
import { accessErrorResponse, requireMember } from "@/lib/neander/server/auth";
import { blobComplete, createBlob, deleteBlobs, putPart, readParts } from "@/lib/neander/mail/server/blobs";
import { BLOB_PART_BYTES, MAX_BLOB_BYTES } from "@/lib/neander/mail/types";

// 첨부 조각 — 20MB 첨부를 Vercel 요청 한도(4.5MB) 아래로 나눠 올리고 받는다.
// 조각은 올린 사람만 읽고 지울 수 있다 (blobs.ts ownBlob).
export const dynamic = "force-dynamic";

/** 한 번에 내려주는 조각 수 — 5 × 768KB ≈ 3.8MB (응답 한도 4.5MB 아래) */
const MAX_READ_PARTS = 5;

function failure(e: unknown) {
  const denied = accessErrorResponse(e);
  if (denied) return denied;
  return NextResponse.json({ error: e instanceof Error ? e.message : "알 수 없는 오류" }, { status: 400 });
}

/** 조각 [from, from+count) — 이어 붙인 바이트 */
export async function GET(req: Request) {
  try {
    const { email: me } = await requireMember(req);
    const url = new URL(req.url);
    const id = url.searchParams.get("id") ?? "";
    const from = Math.max(0, Number(url.searchParams.get("from")) || 0);
    const count = Math.min(MAX_READ_PARTS, Math.max(1, Number(url.searchParams.get("count")) || 1));
    const { bytes } = await readParts(adminDb(), me, id, from, count);
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
      id?: string;
      ids?: string[];
      n?: number;
      base64?: string;
      name?: string;
      type?: string;
      size?: number;
    };
    switch (body.action) {
      case "create": {
        const size = Number(body.size) || 0;
        if (size <= 0) throw new Error("빈 파일은 첨부할 수 없습니다.");
        // 보내기 첨부의 20MB 는 쓰기 창과 send.ts 가 막는다. 여기는 백업 가져오기의 큰 메일까지 받는다
        if (size > MAX_BLOB_BYTES) throw new Error("60MB 가 넘는 파일은 올릴 수 없습니다.");
        return NextResponse.json(await createBlob(db, me, { name: String(body.name ?? ""), type: String(body.type ?? ""), size }));
      }
      case "part": {
        const data = Buffer.from(String(body.base64 ?? ""), "base64");
        if (data.length > BLOB_PART_BYTES) throw new Error("조각이 너무 큽니다.");
        await putPart(db, me, String(body.id ?? ""), Number(body.n), data);
        return NextResponse.json({ ok: true });
      }
      case "done":
        if (!(await blobComplete(db, me, String(body.id ?? "")))) throw new Error("첨부가 다 올라가지 않았습니다. 다시 첨부해 주세요.");
        return NextResponse.json({ ok: true });
      case "delete":
        await deleteBlobs(db, me, Array.isArray(body.ids) ? body.ids.map(String) : [String(body.id ?? "")]);
        return NextResponse.json({ ok: true });
      default:
        throw new Error("알 수 없는 동작입니다.");
    }
  } catch (e) {
    return failure(e);
  }
}
