import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { StandaloneChrome } from "@/components/neander/finance/StandaloneChrome";

// ============================================================
//  카드 기록 — 휴대폰 홈 화면에 앱처럼 얹는다
// ------------------------------------------------------------
//  이 화면까지 도달하는 게 제일 번거로웠다: 브라우저 → ERP → 재무 →
//  카드 기록. 결제하고 나서 그걸 매번 하느니 카톡에 치는 게 빨랐다.
//
//  manifest 는 **페이지마다 다르게 걸 수 있다.** 그래서 ERP 전체가 아니라
//  이 화면만 별도 앱으로 설치되게 하고, start_url 을 여기로 둔다. 아이콘을
//  누르면 곧바로 입력칸이다.
//
//  ⚠️ iOS 는 manifest 만으로 홈 화면 앱이 되지 않는다. apple-* 메타가
//     따로 있어야 주소창 없이 뜬다. 팀에 아이폰·안드로이드가 섞여 있어
//     양쪽을 다 넣는다.
// ============================================================

export const metadata: Metadata = {
  title: "카드 기록",
  manifest: "/card-memo.webmanifest",
  appleWebApp: {
    capable: true,
    title: "카드 기록",
    statusBarStyle: "default",
  },
  icons: {
    apple: "/icons/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#4f46e5",
  // 금액 칸을 눌렀을 때 화면이 확대되며 튀는 것을 막는다
  maximumScale: 1,
  viewportFit: "cover",
};

export default function CardMemoLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <StandaloneChrome />
      {children}
    </>
  );
}
