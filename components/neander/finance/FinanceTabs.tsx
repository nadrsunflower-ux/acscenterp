"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/components/neander/ui";
import { useFinance } from "./FinanceProvider";

const TABS = [
  { href: "/neander/finance", label: "대시보드" },
  { href: "/neander/finance/ledger", label: "거래 원장" },
  { href: "/neander/finance/review", label: "검토 대기함" },
  { href: "/neander/finance/card", label: "카드 기록" },
  { href: "/neander/finance/reports", label: "리포트" },
  { href: "/neander/finance/projects", label: "프로젝트" },
  { href: "/neander/finance/close", label: "월 마감" },
  { href: "/neander/finance/import", label: "엑셀 임포트" },
  { href: "/neander/finance/master", label: "마스터" },
];

export function FinanceTabs() {
  const pathname = usePathname();
  const { transactions } = useFinance();

  // 검토 대기함에 쌓인 건수 — 탭에 바로 보여줘야 방치되지 않는다
  const pending = transactions.filter(
    (t) => t.status === "suggested" || t.status === "needs_review",
  ).length;

  return (
    <div className="finance-tabs sticky top-0 z-10 border-b border-zinc-200 bg-white/90 backdrop-blur">
      <nav className="mx-auto flex w-full max-w-7xl gap-1 overflow-x-auto px-5">
        {TABS.map((t) => {
          const active =
            t.href === "/neander/finance"
              ? pathname === t.href
              : pathname.startsWith(t.href);
          const badge = t.href.endsWith("/review") ? pending : 0;
          return (
            <Link
              key={t.href}
              href={t.href}
              className={cn(
                "relative shrink-0 border-b-2 px-3.5 py-3 text-sm font-medium transition",
                active
                  ? "border-indigo-600 text-indigo-700"
                  : "border-transparent text-zinc-500 hover:text-zinc-800",
              )}
            >
              {t.label}
              {badge > 0 && (
                <span className="ml-1.5 rounded-full bg-rose-100 px-1.5 py-0.5 text-xs font-semibold text-rose-700">
                  {badge}
                </span>
              )}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
