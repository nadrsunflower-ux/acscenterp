import type { ReactNode } from "react";
import { FinanceProvider } from "@/components/neander/finance/FinanceProvider";
import { FinanceShellBridge } from "@/components/neander/finance/FinanceShellBridge";
import { ErrorBanner } from "@/components/neander/finance/ErrorBanner";
import { FinanceChat } from "@/components/neander/finance/FinanceChat";

// 재무 영역(/neander/finance/*) 공통 레이아웃.
// 거래·마스터 구독을 여기서 한 번만 열고 하위 화면 전체가 공유한다.
// 재무 탐색은 셸 사이드바가 재무 워크스페이스 메뉴로 바뀌어 담당한다
// (components/neander/shell/nav-config.ts) — 탭 줄을 따로 두지 않는다.
export default function FinanceLayout({ children }: { children: ReactNode }) {
  return (
    <FinanceProvider>
      <FinanceShellBridge />
      {/* 비서를 도킹해 열면 FinanceChat 이 오른쪽에 자리(placeholder)를 차지해
          본문이 밀린다. 팝업 모드에서는 자리 없이 본문 위에 뜬다. */}
      <div className="flex items-start">
        <div className="min-w-0 flex-1">
          <ErrorBanner />
          {children}
        </div>
        <FinanceChat />
      </div>
    </FinanceProvider>
  );
}
