"use client";

// 매출 데이터 → 셸 사이드바 배지. 상품을 못 정한 줄이 쌓이면 손익이 그만큼
// 미확정이라는 뜻이니, 메뉴에서 바로 보여줘야 방치되지 않는다
// (재무 FinanceShellBridge 와 같은 역할).
import { useSidebarBadge } from "@/components/neander/shell/context";
import { useSales } from "./SalesProvider";

export function SalesShellBridge() {
  const { lines } = useSales();
  const pending = lines.filter((l) => l.status === "needs_review").length;
  useSidebarBadge("sales-review", pending);
  return null;
}
