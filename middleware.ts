import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { ADMIN_COOKIE, ADMIN_LOGIN_PATH } from "@/lib/auth";

// /admin 이하 경로 보호. admin_session 쿠키 없으면 /admin/login 으로 redirect.
// 단 /admin/login 은 예외.
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // 로그인 페이지는 항상 통과
  if (pathname === ADMIN_LOGIN_PATH) {
    return NextResponse.next();
  }

  const hasSession = Boolean(req.cookies.get(ADMIN_COOKIE)?.value);
  if (!hasSession) {
    const url = req.nextUrl.clone();
    url.pathname = ADMIN_LOGIN_PATH;
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

// /admin 으로 시작하는 모든 경로에만 적용
export const config = {
  matcher: ["/admin/:path*"],
};
