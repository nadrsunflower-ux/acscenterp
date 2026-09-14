import type { ReactNode } from "react";
import { SalesActivate } from "@/components/neander/sales/SalesProvider";
import { SalesShellBridge } from "@/components/neander/sales/SalesShellBridge";
import { SalesChat } from "@/components/neander/sales/SalesChat";

// 매출 영역(/neander/sales/*) 공통 레이아웃.
// 판매 줄·상품·이벤트는 ERP 공통 Providers 의 SalesProvider 가 들고 있고,
// 여기에 처음 들어올 때 받기 시작한다(SalesActivate) — 재무와 같다.
// 탐색은 셸 사이드바가 매출 워크스페이스 메뉴로 바뀌어 담당한다
// (components/neander/shell/nav-config.ts 의 WORKSPACES) — 재무와 같다.
export default function SalesLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SalesActivate />
      <SalesShellBridge />
      {/* 비서를 도킹해 열면 SalesChat 이 오른쪽에 자리를 차지해 본문이 밀린다.
          팝업 모드에서는 자리 없이 본문 위에 뜬다 (재무 레이아웃과 같다). */}
      <div className="flex items-start">
        <div className="min-w-0 flex-1">{children}</div>
        <SalesChat />
      </div>
    </>
  );
}
