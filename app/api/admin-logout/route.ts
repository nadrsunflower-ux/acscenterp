import { NextResponse } from "next/server";
import { ADMIN_COOKIE } from "@/lib/auth";

// 쿠키 삭제 후 200
export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return res;
}
