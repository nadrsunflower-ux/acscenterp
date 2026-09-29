import type { Metadata } from "next";

// 회의 준비 자료(웹 발표자료) — 내부 자료라 검색에 올리지 않는다.
// 화면은 로그인 게이트(components/neander/Providers) 뒤에 있지만, 게이트가
// 뜨기 전 껍데기도 색인되지 않게 여기서 한 번 더 막는다.
export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
};

export default function PrepLayout({ children }: { children: React.ReactNode }) {
  return children;
}
