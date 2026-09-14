"use client";

// ============================================================
//  재무 › 리포트 하위 탭 + 월 선택 캡슐
// ------------------------------------------------------------
//  네 화면이 같은 리포트 엔진(report.ts)을 쓰고 같은 기간·기준 개념을
//  공유하므로 한 묶음으로 둔다. 탭은 URL 이동이라 공통 <Tabs> 의 href
//  모드를 쓴다(aria-current).
//
//  월 고르기(MonthStepper)는 매출도 쓰므로 components/neander/ui 로
//  옮겼다. 여기에는 리포트 탭만 남는다.
// ============================================================

import { usePathname } from "next/navigation";
import { Tabs } from "@/components/neander/ui";

const TABS = [
  { key: "detail", href: "/neander/finance/reports", label: "지출상세", hint: "계정 3단" },
  { key: "units", href: "/neander/finance/reports/units", label: "사업부", hint: "B2C·B2B·공용" },
  { key: "subs", href: "/neander/finance/reports/subscriptions", label: "구독", hint: "SaaS 지출" },
  { key: "budget", href: "/neander/finance/reports/budget", label: "예산", hint: "예산 대비 결산" },
];

export function ReportTabs({ className }: { className?: string }) {
  const pathname = usePathname();
  const active =
    TABS.find((t) =>
      t.href === "/neander/finance/reports" ? pathname === t.href : pathname.startsWith(t.href),
    )?.key ?? TABS[0].key;
  return <Tabs ariaLabel="리포트 종류" items={TABS} value={active} className={className} />;
}
