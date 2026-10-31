import type { ReactNode } from "react";
import { ShortsProvider } from "@/components/neander/shorts/ShortsProvider";
import { ShortsGate } from "@/components/neander/shorts/ShortsGate";

// 쇼핑쇼츠 영역(/neander/shorts/*) 공통 레이아웃 — 자료는 ShortsProvider 가 한 번 받아 화면들이 나눠 쓴다.
// 탐색은 셸 사이드바가 쇼핑쇼츠 워크스페이스 메뉴로 바뀌어 맡는다 (nav-config 의 SHORTS_NAV).
export default function ShortsLayout({ children }: { children: ReactNode }) {
  return (
    <ShortsProvider>
      <ShortsGate>{children}</ShortsGate>
    </ShortsProvider>
  );
}
