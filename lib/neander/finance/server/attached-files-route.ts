import "server-only";

import { NextResponse } from "next/server";
import { adminDb } from "@/lib/neander/server/admin";
import { accessErrorResponse, requireErpUser } from "@/lib/neander/server/auth";
import { ATTACHED_FILE_PART_BYTES, ATTACHED_FILE_READ_PARTS } from "@/lib/neander/finance/attached-files";
import type { AttachedFileStore } from "./attached-files";

// 첨부파일 라우트 — 모든 요청에서 재무 권한을 확인한다. 원본은 비공개 조각으로만 읽고 쓴다.
// 주인 id 는 저장소의 key(grantId · projectId) 이름 그대로 쿼리·본문에 싣는다.
const json = (value: unknown) => NextResponse.json(value, { headers: { "Cache-Control": "private, no-store" } });

export function attachedFileRoute(store: AttachedFileStore, logTag: string) {
  const failure = (error: unknown) => {
    const denied = accessErrorResponse(error);
    if (denied) return denied;
    console.error(`[${logTag}]`, error instanceof Error ? error.message : "요청 실패");
    return NextResponse.json({ error: error instanceof Error ? error.message : "파일 요청에 실패했습니다." }, { status: 400 });
  };

  async function GET(req: Request) {
    try {
      await requireErpUser(req);
      const params = new URL(req.url).searchParams;
      const ownerId = params.get(store.key) ?? "";
      const id = params.get("id");
      if (!id) return json({ files: await store.list(adminDb(), ownerId) });
      const from = Number(params.get("from") ?? "0");
      const count = Number(params.get("count") ?? "1");
      if (!Number.isSafeInteger(from) || from < 0 || !Number.isSafeInteger(count) || count < 1 || count > ATTACHED_FILE_READ_PARTS) throw new Error("요청한 파일 범위가 올바르지 않습니다.");
      const bytes = await store.read(adminDb(), ownerId, id, from, count);
      return new Response(new Uint8Array(bytes), {
        headers: { "Content-Type": "application/octet-stream", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
      });
    } catch (error) {
      return failure(error);
    }
  }

  async function POST(req: Request) {
    try {
      const { email } = await requireErpUser(req);
      const body = await req.json();
      const db = adminDb();
      const ownerId = body[store.key];
      switch (body.action) {
        case "create":
          return json(await store.create(db, email, ownerId, body));
        case "part": {
          const base64 = body.base64;
          if (typeof base64 !== "string" || !base64.length || base64.length > Math.ceil(ATTACHED_FILE_PART_BYTES / 3) * 4 || base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) throw new Error("파일 전송 내용이 올바르지 않습니다.");
          const bytes = Buffer.from(base64, "base64");
          if (bytes.toString("base64") !== base64) throw new Error("파일 전송 내용이 올바르지 않습니다.");
          await store.putPart(db, email, ownerId, body.id, body.n, bytes);
          return json({ ok: true });
        }
        case "done":
          return json({ file: await store.complete(db, email, ownerId, body.id) });
        case "delete":
          await store.remove(db, ownerId, body.id);
          return json({ ok: true });
        default:
          throw new Error("알 수 없는 파일 요청입니다.");
      }
    } catch (error) {
      return failure(error);
    }
  }

  return { GET, POST };
}
