import { NextResponse } from "next/server";
import { adminDb } from "@/lib/neander/server/admin";
import { requireErpUser, accessErrorResponse } from "@/lib/neander/server/auth";
import { uploadDocFile, signedUrl, isDocPath } from "@/lib/neander/server/storage";
import { NEANDER_COL } from "@/lib/neander/collections";
import { sanitizeFiles, type FinDocFile } from "@/lib/neander/finance/docs";
import { DOC_FILE_EXTS, MAX_DOC_FILES, MAX_DOC_FILE_BYTES, docFileExt as ext } from "@/lib/neander/finance/doc-limits";

// ============================================================
//  프로젝트 문서 파일 — 붙이기 / 열기
// ------------------------------------------------------------
//  견적서·계약서에 PDF·엑셀·한글 파일을 붙인다. 문서 본문(금액·상태)은
//  mutate 라우트의 doc.save 가 다루고, 여기는 파일만 다룬다 — 파일은
//  multipart 라 JSON 규약인 mutate 에 실을 수 없다.
//
//  POST  : 파일 하나를 올리고 문서의 files 배열 뒤에 붙인다. 요청마다 한
//          파일인 이유는 Vercel 함수 본문 한도(4.5MB)가 요청 단위라서다.
//  GET   : Storage 경로 → 한 시간짜리 서명 URL. 우리 문서 폴더 밖의
//          경로는 거절한다 — 아무 경로나 서명해 주면 이 라우트가 버킷
//          전체의 열쇠가 된다.
//  떼기·삭제는 mutate(doc.removeFile · doc.delete) 에 있다 — JSON 이면 된다.
// ============================================================

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  try {
    await requireErpUser(req);
  } catch (e) {
    const denied = accessErrorResponse(e);
    if (denied) return denied;
    throw e;
  }
  const path = new URL(req.url).searchParams.get("path") ?? "";
  if (!isDocPath(path)) return NextResponse.json({ error: "열 수 없는 경로입니다." }, { status: 400 });
  try {
    return NextResponse.json({ url: await signedUrl(path) });
  } catch (e) {
    console.error("[finance/docs/files GET]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "파일 주소를 만들지 못했습니다." },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  let user;
  try {
    user = await requireErpUser(req);
  } catch (e) {
    const denied = accessErrorResponse(e);
    if (denied) return denied;
    throw e;
  }

  try {
    const form = await req.formData();
    const id = String(form.get("id") ?? "").trim();
    const file = form.get("file");
    if (!id) return NextResponse.json({ error: "문서 id 가 필요합니다." }, { status: 400 });
    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json({ error: "올릴 파일이 없습니다." }, { status: 400 });
    }
    if (file.size > MAX_DOC_FILE_BYTES) {
      return NextResponse.json(
        { error: `파일 하나는 ${MAX_DOC_FILE_BYTES / 1024 / 1024}MB 를 넘을 수 없습니다 (${file.name}). 스캔본이면 해상도를 줄여 주세요.` },
        { status: 400 },
      );
    }
    if (!DOC_FILE_EXTS.includes(ext(file.name))) {
      return NextResponse.json(
        { error: `${file.name} — 올릴 수 있는 형식은 ${DOC_FILE_EXTS.join(", ")} 입니다.` },
        { status: 400 },
      );
    }

    const ref = adminDb().collection(NEANDER_COL.finDocs).doc(id);
    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ error: "문서가 없습니다. 먼저 저장해 주세요." }, { status: 404 });
    const files = sanitizeFiles(snap.data()?.files);
    if (files.length >= MAX_DOC_FILES) {
      return NextResponse.json({ error: `한 문서에는 파일을 ${MAX_DOC_FILES}개까지 붙일 수 있습니다.` }, { status: 400 });
    }

    const path = await uploadDocFile(id, {
      name: file.name,
      type: file.type,
      bytes: Buffer.from(await file.arrayBuffer()),
    });
    const added: FinDocFile = { path, name: file.name, size: file.size, type: file.type, uploadedAt: Date.now() };
    const next = [...files, added];
    await ref.set({ files: next, updatedAt: Date.now(), updatedBy: user.email }, { merge: true });
    return NextResponse.json({ ok: true, files: next });
  } catch (e) {
    console.error("[finance/docs/files POST]", e);
    const msg = e instanceof Error ? e.message : "";
    const friendly = /bucket does not exist|No such bucket/i.test(msg)
      ? "파일 저장소(Firebase Storage)가 아직 켜져 있지 않습니다. 문서 내용은 저장됐고 파일만 올리지 못했습니다."
      : msg || "파일을 올리지 못했습니다.";
    return NextResponse.json({ error: friendly }, { status: 500 });
  }
}
