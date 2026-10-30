import { NextResponse } from "next/server";
import { adminDb } from "@/lib/neander/server/admin";
import { accessErrorResponse, requireErpUser } from "@/lib/neander/server/auth";
import { GRANT_FILE_PART_BYTES, GRANT_FILE_READ_PARTS } from "@/lib/neander/finance/grant-files";
import {
  completeGrantFile,
  createGrantFile,
  deleteGrantFile,
  listGrantFiles,
  putGrantFilePart,
  readGrantFileParts,
} from "@/lib/neander/finance/server/grant-files";

// 모든 요청에서 재무 권한을 확인한다. 원본은 비공개 조각으로만 읽고 쓴다.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const json = (value: unknown) => NextResponse.json(value, { headers: { "Cache-Control": "private, no-store" } });
function failure(error: unknown) {
  const denied = accessErrorResponse(error);
  if (denied) return denied;
  console.error("[finance/grants/files]", error instanceof Error ? error.message : "요청 실패");
  return NextResponse.json({ error: error instanceof Error ? error.message : "파일 요청에 실패했습니다." }, { status: 400 });
}

export async function GET(req: Request) {
  try {
    await requireErpUser(req);
    const params = new URL(req.url).searchParams;
    const grantId = params.get("grantId") ?? "";
    const id = params.get("id");
    if (!id) return json({ files: await listGrantFiles(adminDb(), grantId) });
    const from = Number(params.get("from") ?? "0");
    const count = Number(params.get("count") ?? "1");
    if (!Number.isSafeInteger(from) || from < 0 || !Number.isSafeInteger(count) || count < 1 || count > GRANT_FILE_READ_PARTS) throw new Error("요청한 파일 범위가 올바르지 않습니다.");
    const bytes = await readGrantFileParts(adminDb(), grantId, id, from, count);
    return new Response(new Uint8Array(bytes), {
      headers: { "Content-Type": "application/octet-stream", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
    });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(req: Request) {
  try {
    const { email } = await requireErpUser(req);
    const body = await req.json();
    const db = adminDb();
    switch (body.action) {
      case "create":
        return json(await createGrantFile(db, email, body));
      case "part": {
        const base64 = body.base64;
        if (typeof base64 !== "string" || !base64.length || base64.length > Math.ceil(GRANT_FILE_PART_BYTES / 3) * 4 || base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) throw new Error("파일 전송 내용이 올바르지 않습니다.");
        const bytes = Buffer.from(base64, "base64");
        if (bytes.toString("base64") !== base64) throw new Error("파일 전송 내용이 올바르지 않습니다.");
        await putGrantFilePart(db, email, body.grantId, body.id, body.n, bytes);
        return json({ ok: true });
      }
      case "done":
        return json({ file: await completeGrantFile(db, email, body.grantId, body.id) });
      case "delete":
        await deleteGrantFile(db, body.grantId, body.id);
        return json({ ok: true });
      default:
        throw new Error("알 수 없는 파일 요청입니다.");
    }
  } catch (error) {
    return failure(error);
  }
}
