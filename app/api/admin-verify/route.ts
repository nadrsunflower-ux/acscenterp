import { NextResponse } from "next/server";

// POST { password } -> process.env.ADMIN_PASSWORD 와 단순 비교만 한다.
// admin-login 과 달리 쿠키/세션을 설정하지 않는다(부수효과 없음).
// 대시보드 업무 "관리자 확인" 같은 단발성 비밀번호 확인 용도.
export async function POST(req: Request) {
  let password = "";
  try {
    const body = await req.json();
    password = typeof body?.password === "string" ? body.password : "";
  } catch {
    password = "";
  }

  const expected = process.env.ADMIN_PASSWORD;

  if (!expected) {
    return NextResponse.json(
      { ok: false, error: "ADMIN_PASSWORD 가 설정되지 않았습니다." },
      { status: 401 }
    );
  }

  if (password !== expected) {
    return NextResponse.json(
      { ok: false, error: "비밀번호가 일치하지 않습니다." },
      { status: 401 }
    );
  }

  return NextResponse.json({ ok: true });
}
