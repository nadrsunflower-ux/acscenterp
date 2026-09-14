import { NextResponse } from "next/server";
import { requireErpUser, accessErrorResponse } from "@/lib/neander/server/auth";
import { decryptWithKnownPasswords, hasConfiguredPasswords } from "@/lib/neander/server/xlsx-passwords";

// ============================================================
//  네이버 예약자관리 파일 복호화 — 비밀번호를 사람이 치지 않는다
// ------------------------------------------------------------
//  네이버가 내려주는 예약자관리 xlsx 는 항상 같은 비밀번호로 잠겨 온다.
//  매달 그 비밀번호를 치게 하면 결국 어딘가에 적어 두게 되므로, 서버가
//  환경변수(NEANDER_XLSX_PASSWORDS — 은행 파일 것과 한 목록)로 들고 있다가
//  대신 푼다.
//
//  ⚠️ 비밀번호를 코드에 적지 않는다 — 이 저장소는 공개돼 있다.
//     .env.local 과 배포 환경변수에만 둔다. 없으면 클라이언트가 보낸
//     password 로 시도하고, 그것도 없으면 400 으로 알려 화면이 물어본다.
//
//  파일도 비밀번호도 저장하지 않는다 — 요청 안에서 풀어 바로 돌려준다
//  (finance/decrypt 와 같은 원칙). 예약자 이름·전화번호가 든 파일이다.
// ============================================================

export const dynamic = "force-dynamic";
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
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "파일이 없습니다." }, { status: 400 });
    }
    const input = Buffer.from(await file.arrayBuffer());
    const given = String(form.get("password") ?? "").trim();
    if (!given && !hasConfiguredPasswords()) {
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
    // 사람이 보낸 것 → 환경변수 목록 순으로 시도한다 (server/xlsx-passwords.ts)
    const out = await decryptWithKnownPasswords(input, given || undefined);
    if (!out) {
      return NextResponse.json(
        { error: "비밀번호가 맞지 않습니다. 네이버 파일의 비밀번호를 확인하세요.", needsPassword: true },
        { status: 400 },
      );
    }
    return body(out.buf, file.name);
  } catch (e) {
    console.error("[sales/decrypt]", e);
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
