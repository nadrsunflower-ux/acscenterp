import { NextResponse } from "next/server";
import { requireErpUser, accessErrorResponse } from "@/lib/neander/server/auth";
import { decryptWithKnownPasswords, hasConfiguredPasswords } from "@/lib/neander/server/xlsx-passwords";

// ============================================================
//  암호 걸린 엑셀 복호화
// ------------------------------------------------------------
//  토스뱅크·카카오뱅크가 내려주는 거래내역은 암호가 걸린 xlsx 다. 브라우저
//  에서는 열 수 없어서(Node crypto 필요) 서버에서 풀어 되돌려준다.
//
//  비밀번호는 계좌마다 늘 같으므로 서버가 목록(NEANDER_XLSX_PASSWORDS)을
//  들고 차례로 시도한다 — 사람이 매달 치지 않는다. 사람이 보낸 password 가
//  있으면 그것을 먼저 쓴다 (server/xlsx-passwords.ts).
//
//  ⚠️ 파일도 비밀번호도 **저장하지 않는다.** 요청 안에서 풀어 바로 응답으로
//     흘려보내고 끝낸다. 은행 거래내역과 계좌 비밀번호를 서버 디스크나 로그에
//     남길 이유가 없다.
//
//  파일명이 route.neander.ts 인 이유는 매장(ACSCENT) 빌드에서 제외하기
//  위해서다 (next.config.mjs 의 pageExtensions 분기).
// ============================================================

export const dynamic = "force-dynamic";
/** 은행 내역은 커도 수 MB 다. 기본 제한(4.5MB)보다 넉넉히 */
export const maxDuration = 30;

export async function POST(req: Request) {
  try {
    await requireErpUser(req);
  } catch (e) {
    const denied = accessErrorResponse(e);
    if (denied) return denied;
    throw e;
  }

  try {
    const form = await req.formData();
    const file = form.get("file");
    const password = String(form.get("password") ?? "");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "파일이 없습니다." }, { status: 400 });
    }
    if (!password && !hasConfiguredPasswords()) {
      return NextResponse.json(
        {
          error:
            "이 파일은 암호가 걸려 있는데 서버에 비밀번호 목록이 없습니다. " +
            "NEANDER_XLSX_PASSWORDS 를 설정하거나 비밀번호를 입력하세요.",
          needsPassword: true,
        },
        { status: 400 },
      );
    }

    const input = Buffer.from(await file.arrayBuffer());
    const out = await decryptWithKnownPasswords(input, password || undefined);
    if (!out) {
      // 라이브러리 원문 오류는 "The file could not be decrypted..." 라 원인이 안 보인다
      return NextResponse.json(
        {
          error: "아는 비밀번호로는 열리지 않습니다. 은행에서 안내한 비밀번호를 입력하세요.",
          needsPassword: true,
        },
        { status: 400 },
      );
    }
    return body(out.buf, file.name);
  } catch (e) {
    console.error("[finance/decrypt]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "복호화에 실패했습니다." },
      { status: 500 },
    );
  }
}

function body(buf: Buffer, name: string) {
  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${encodeURIComponent(name)}"`,
      "Cache-Control": "no-store",
    },
  });
}
