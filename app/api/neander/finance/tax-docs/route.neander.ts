import { NextResponse } from "next/server";
import { adminDb } from "@/lib/neander/server/admin";
import { accessErrorResponse, requireErpUser } from "@/lib/neander/server/auth";
import {
  completeTaxDoc,
  createTaxDoc,
  deleteTaxDoc,
  listTaxDocs,
  putTaxDocPart,
  readTaxDocParts,
  shareTaxDocSiblings,
  updateTaxDoc,
} from "@/lib/neander/finance/server/tax-docs";

// 급여·세무 서류 — 목록 · 올리기(조각) · 고치기 · 지우기 · 받기.
// 저장 방식은 finance/server/tax-docs.ts. 급여 · 주민번호가 담긴 서류라 권한은 재무와 같다.
export const dynamic = "force-dynamic";
// 조각이 다 오면 PDF 를 읽는다 — 10쪽짜리 부가세 신고서도 몇 초면 된다
export const maxDuration = 60;

/** 한 번에 내려주는 조각 수 — 5 × 768KB ≈ 3.8MB (응답 한도 4.5MB 아래) */
const MAX_READ_PARTS = 5;

function failure(e: unknown) {
  const denied = accessErrorResponse(e);
  if (denied) return denied;
  console.error("[finance/tax-docs]", e);
  return NextResponse.json({ error: e instanceof Error ? e.message : "알 수 없는 오류" }, { status: 400 });
}

/** id 가 없으면 목록, 있으면 그 서류의 조각 [from, from+count) */
export async function GET(req: Request) {
  try {
    await requireErpUser(req);
    const url = new URL(req.url);
    const id = url.searchParams.get("id");
    if (!id) return NextResponse.json({ docs: await listTaxDocs(adminDb()) });
    const from = Math.max(0, Number(url.searchParams.get("from")) || 0);
    const count = Math.min(MAX_READ_PARTS, Math.max(1, Number(url.searchParams.get("count")) || 1));
    const bytes = await readTaxDocParts(adminDb(), id, from, count);
    return new Response(new Uint8Array(bytes), {
      headers: { "Content-Type": "application/octet-stream", "Cache-Control": "private, no-store" },
    });
  } catch (e) {
    return failure(e);
  }
}

export async function POST(req: Request) {
  try {
    const { email: me } = await requireErpUser(req);
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
      sha256?: string;
      folderMonth?: string;
      patch?: { kind?: unknown; period?: unknown; entity?: unknown; note?: unknown };
    };
    switch (body.action) {
      case "create":
        return NextResponse.json(await createTaxDoc(db, me, body));
      case "part":
        await putTaxDocPart(db, me, body.id, Number(body.n), Buffer.from(String(body.base64 ?? ""), "base64"));
        return NextResponse.json({ ok: true });
      case "done":
        return NextResponse.json({ doc: await completeTaxDoc(db, me, body.id) });
      case "siblings":
        return NextResponse.json({ docs: await shareTaxDocSiblings(db, body.ids) });
      case "update":
        return NextResponse.json({ doc: await updateTaxDoc(db, me, body.id, body.patch ?? {}) });
      case "delete":
        await deleteTaxDoc(db, body.id);
        return NextResponse.json({ ok: true });
      default:
        throw new Error("알 수 없는 동작입니다.");
    }
  } catch (e) {
    return failure(e);
  }
}
