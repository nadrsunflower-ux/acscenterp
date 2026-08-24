"use client";

// 재무 > 리포트 하위 탭. 세 화면이 같은 리포트 엔진(report.ts)을 쓰고
// 같은 기간·기준 개념을 공유하므로 한 묶음으로 둔다.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/components/neander/ui";

const TABS = [
  { href: "/neander/finance/reports", label: "지출상세", hint: "계정 3단" },
  { href: "/neander/finance/reports/units", label: "사업부", hint: "B2C·B2B·공용" },
  { href: "/neander/finance/reports/subscriptions", label: "구독", hint: "SaaS 지출" },
  { href: "/neander/finance/reports/budget", label: "예산", hint: "예산 대비 결산" },
];

export function ReportTabs() {
  const pathname = usePathname();
  return (
    <div className="flex flex-wrap items-center gap-1">
      {TABS.map((t) => {
        const active =
          t.href === "/neander/finance/reports"
            ? pathname === t.href
            : pathname.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            className={cn(
              "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
              active
                ? "bg-indigo-600 text-white"
                : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900",
            )}
          >
            {t.label}
            <span className={cn("ml-1.5 text-xs font-normal", active ? "text-indigo-200" : "text-zinc-400")}>
              {t.hint}
            </span>
          </Link>
        );
      })}
    </div>
  );
}
