import type { ReactNode } from "react";
import { FinanceProvider } from "@/components/neander/finance/FinanceProvider";
import { FinanceTabs } from "@/components/neander/finance/FinanceTabs";

// 재무 영역(/neander/finance/*) 공통 레이아웃.
// 거래·마스터 구독을 여기서 한 번만 열고 하위 탭 전체가 공유한다.
export default function FinanceLayout({ children }: { children: ReactNode }) {
  return (
    <FinanceProvider>
      <FinanceTabs />
      {children}
    </FinanceProvider>
  );
}
