import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { ADMIN_COOKIE, ADMIN_LOGIN_PATH } from "@/lib/auth";

// ============================================================
//  경로 게이트 — 빌드 타깃별로 동작이 다르다 (next.config.mjs 참고)
// ------------------------------------------------------------
//   APP_TARGET=acscent : 매장 운영 사이트(알바 공개).
//                        /admin 이하만 admin_session 쿠키로 보호.
//   APP_TARGET=neander : 본사 ERP 도메인.
//                        /neander 외 경로는 전부 /neander 로 보낸다.
//                        (NEANDER 빌드는 매장 라우트도 함께 포함하므로,
//                         본사 도메인에서 매장 사이트가 노출되지 않도록
//                         여기서 막는다. 매장 사이트는 원래 공개라
//                         보안 목적이 아니라 도메인 역할 분리 목적이다.)
// ============================================================

const TARGET =
  process.env.APP_TARGET ?? process.env.NEXT_PUBLIC_APP_TARGET ?? "acscent";

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // ---- 본사(NEANDER) 도메인 ----------------------------------
  if (TARGET === "neander") {
    if (!pathname.startsWith("/neander")) {
      const url = req.nextUrl.clone();
      url.pathname = "/neander";
      return NextResponse.redirect(url);
    }
    // /neander 이하는 클라이언트 인증 게이트(components/neander/Providers)가 담당
    return NextResponse.next();
  }

  // ---- 매장(ACSCENT) 도메인 ----------------------------------
  // /admin 이하만 보호. 로그인 페이지는 항상 통과.
  if (pathname.startsWith("/admin")) {
    if (pathname === ADMIN_LOGIN_PATH) {
      return NextResponse.next();
    }
    const hasSession = Boolean(req.cookies.get(ADMIN_COOKIE)?.value);
    if (!hasSession) {
      const url = req.nextUrl.clone();
      url.pathname = ADMIN_LOGIN_PATH;
      return NextResponse.redirect(url);
    }
  }

  return NextResponse.next();
}

// 정적 자산과 API 를 제외한 모든 경로. (타깃 분기가 내부에 있으므로
// matcher 는 두 타깃 공통으로 넓게 잡고 함수 안에서 판정한다.)
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/|images/).*)"],
};
