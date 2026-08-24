import { NextResponse } from "next/server";
import { requireFinanceUser, accessErrorResponse } from "@/lib/neander/finance/server/auth";

// ============================================================
//  암호 걸린 엑셀 복호화
// ------------------------------------------------------------
//  토스뱅크·카카오뱅크가 내려주는 거래내역은 암호가 걸린 xlsx 다. 브라우저
//  에서는 열 수 없어서(Node crypto 필요) 서버에서 풀어 되돌려준다.
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
    await requireFinanceUser(req);
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
    if (!password) {
      return NextResponse.json({ error: "비밀번호가 필요합니다." }, { status: 400 });
    }

    const input = Buffer.from(await file.arrayBuffer());

    // 동적 import — 이 라우트를 부르지 않는 요청에 라이브러리를 얹지 않는다
    const oct = (await import("officecrypto-tool")) as {
      isEncrypted: (b: Buffer) => boolean;
      decrypt: (b: Buffer, o: { password: string }) => Promise<Buffer>;
    };

    if (!oct.isEncrypted(input)) {
      // 암호가 안 걸린 파일이면 그대로 돌려준다 (호출부가 분기하지 않아도 되게)
      return body(input, file.name);
    }

    let output: Buffer;
    try {
      output = await oct.decrypt(input, { password });
    } catch {
      // 라이브러리 원문 오류는 "The file could not be decrypted..." 라 원인이 안 보인다
      return NextResponse.json(
        { error: "비밀번호가 맞지 않습니다. 은행에서 안내한 비밀번호를 다시 확인해주세요." },
        { status: 400 },
      );
    }

    return body(output, file.name);
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
