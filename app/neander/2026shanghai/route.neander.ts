import { SHANGHAI_2026_HTML } from "@/lib/neander/trip/shanghai2026Html";

// 상하이 출장(2026-11-28~30) 일정 페이지. ERP 로그인 게이트(Providers)를 거치지 않는
// 독립 HTML 이라 링크만 있으면 열린다 — 중국 현지에서 구글 로그인이 막혀도 보이게.
// NEANDER 빌드에만 들어간다(.neander.ts).
export const dynamic = "force-static";

export function GET() {
  return new Response(SHANGHAI_2026_HTML, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "x-robots-tag": "noindex, nofollow",
    },
  });
}
