import { NextResponse } from "next/server";
import {
  ADMIN_COOKIE,
  ADMIN_COOKIE_VALUE,
  ADMIN_COOKIE_MAX_AGE,
} from "@/lib/auth";

// POST { password } -> process.env.ADMIN_PASSWORD 와 비교.
// 일치: httpOnly 쿠키 admin_session 설정 후 200 / 불일치: 401
export async function POST(req: Request) {
  let password = "";
  try {
    const body = await req.json();
    password = typeof body?.password === "string" ? body.password : "";
  } catch {
    password = "";
  }

  const expected = process.env.ADMIN_PASSWORD;

  // 서버에 비밀번호가 설정되지 않았으면 로그인 불가
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

  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE, ADMIN_COOKIE_VALUE, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ADMIN_COOKIE_MAX_AGE,
  });
  return res;
}
