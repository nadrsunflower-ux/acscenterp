// ============================================================
//  빌드 타깃 분리 — ACSCENT ERP / NEANDER ERP
// ------------------------------------------------------------
//  하나의 레포에서 두 개의 Vercel 프로젝트(= 서로 다른 도메인)를 배포한다.
//  어느 쪽을 빌드할지는 환경변수 APP_TARGET 으로 정한다.
//
//    APP_TARGET=acscent  (기본) → 매장 운영 사이트. 알바 직원 공개.
//    APP_TARGET=neander           → 본사 ERP. 이사진·핵심 직원 전용.
//
//  ⚠️ 분리 방식: pageExtensions
//  ------------------------------------------------------------
//  NEANDER 라우트 파일은 `page.tsx` 가 아니라 `page.neander.tsx` 로 둔다.
//  Next.js 는 pageExtensions 목록에 있는 확장자만 라우트로 인식하므로,
//  ACSCENT 빌드(['tsx','ts'])에서는 `page.neander.tsx` 가 라우트로 잡히지
//  않는다. 라우트가 없으면 그 트리를 import 하는 코드도 없으므로
//  NEANDER 화면 코드는 **매장 도메인 번들에 아예 포함되지 않는다.**
//
//  이게 중요한 이유: 로그인 게이트는 클라이언트에서 화면만 가릴 뿐,
//  정적 청크(/_next/static/*)는 인증과 무관하게 공개 서빙된다. 실제로
//  분리 전에는 회의 준비 발표덱 전문이 로그인 없이 읽혔다. 번들에서
//  빼는 것만이 확실한 차단이다.
//
//  ➡️ NEANDER 라우트를 새로 만들 때는 반드시 `page.neander.tsx` /
//     `layout.neander.tsx` 로 이름 짓는다. `page.tsx` 로 만들면 매장
//     도메인에도 배포되어 유출된다.
// ============================================================

const TARGET = process.env.APP_TARGET === "neander" ? "neander" : "acscent";

// NEANDER 빌드는 자기 라우트(.neander.tsx)와 공용 라우트(.tsx)를 모두 포함한다.
// ACSCENT 빌드는 공용 라우트만 포함한다 → NEANDER 라우트 전면 제외.
const pageExtensions =
  TARGET === "neander"
    ? ["neander.tsx", "neander.ts", "tsx", "ts"]
    : ["tsx", "ts"];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  pageExtensions,
  images: {
    // 로컬/정적 이미지를 그대로 사용 (외부 도메인 설정 불필요)
    unoptimized: true,
  },
  env: {
    // 클라이언트에서도 현재 빌드 타깃을 알 수 있게 노출 (크롬 분기 등에 사용)
    NEXT_PUBLIC_APP_TARGET: TARGET,
  },
};

export default nextConfig;
