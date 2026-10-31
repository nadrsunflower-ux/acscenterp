import type { ReactNode } from "react";
import { ShortsProvider } from "@/components/neander/shorts/ShortsProvider";
import { ShortsGate } from "@/components/neander/shorts/ShortsGate";

// 쇼핑쇼츠 영역(/neander/shorts/*) 공통 레이아웃 — 자료는 ShortsProvider 가 한 번 받아 화면들이 나눠 쓴다.
// 탐색은 셸 사이드바가 쇼핑쇼츠 워크스페이스 메뉴로 바뀌어 맡는다 (nav-config 의 SHORTS_NAV).
// data-nd-text="comfortable" — 공용 부품의 12px 꼬리 글씨를 13px 로 (neander.css). 상자는 만들지 않는다(contents).
export default function ShortsLayout({ children }: { children: ReactNode }) {
  return (
    <div data-nd-text="comfortable" className="contents">
      <ShortsProvider>
        <ShortsGate>{children}</ShortsGate>
      </ShortsProvider>
    </div>
  );
}
