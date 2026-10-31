import { NextResponse } from "next/server";
import { adminDb } from "@/lib/neander/server/admin";
import { finishOAuth } from "@/lib/neander/shorts/server/accounts";

// 제공사 동의 화면에서 돌아오는 곳 — 브라우저 이동이라 로그인 토큰이 없다.
// 누구의 연결인지는 시작할 때 만든 state 문서가 안다 (10분 · 한 번 쓰면 지움).
// 이 주소를 Google Cloud · Meta 앱의 「승인된 리디렉션 URI」 에 넣어야 한다.
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const back = new URL("/neander/shorts/accounts", url.origin);
  const state = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("code") ?? "";
  const denied = url.searchParams.get("error");
  if (denied || !code) {
    back.searchParams.set("error", denied === "access_denied" ? "연결을 취소했습니다." : "제공사에서 연결 코드를 받지 못했습니다.");
    return NextResponse.redirect(back);
  }
  try {
    const r = await finishOAuth(adminDb(), state, code);
    back.searchParams.set("connected", r.platform);
    back.searchParams.set("n", String(r.created));
  } catch (e) {
    back.searchParams.set("error", e instanceof Error ? e.message.slice(0, 200) : "연결에 실패했습니다.");
  }
  return NextResponse.redirect(back);
}
