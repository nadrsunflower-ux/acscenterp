"use client";

// 재무 데이터 → 셸 사이드바 배지. 검토 대기함에 쌓인 건수를 메뉴에
// 바로 보여줘야 방치되지 않는다 (예전 FinanceTabs 의 역할).
import { useSidebarBadge } from "@/components/neander/shell/context";
import { useFinance } from "./FinanceProvider";

export function FinanceShellBridge() {
  const { transactions } = useFinance();
  const pending = transactions.filter((t) => t.status === "suggested" || t.status === "needs_review").length;
  useSidebarBadge("finance-review", pending);
  return null;
}
