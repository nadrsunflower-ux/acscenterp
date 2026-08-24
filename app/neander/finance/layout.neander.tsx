import type { ReactNode } from "react";
import { FinanceProvider } from "@/components/neander/finance/FinanceProvider";
import { FinanceTabs } from "@/components/neander/finance/FinanceTabs";
import { ErrorBanner } from "@/components/neander/finance/ErrorBanner";
import { FinanceChat } from "@/components/neander/finance/FinanceChat";

// 재무 영역(/neander/finance/*) 공통 레이아웃.
// 거래·마스터 구독을 여기서 한 번만 열고 하위 탭 전체가 공유한다.
export default function FinanceLayout({ children }: { children: ReactNode }) {
  return (
    <FinanceProvider>
      <FinanceTabs />
      <ErrorBanner />
      {children}
      {/* 재무 화면 어디서나 열리는 비서 패널 (오른쪽 아래 버튼) */}
      <FinanceChat />
    </FinanceProvider>
  );
}
