"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import Badge from "@/components/ui/Badge";
import { storeLabel } from "@/lib/content";

// 악센트 아이디 하위 페이지들(영업시간/운영상품 및 환불/매장 이벤트/기타/청소/향료).
const SUB_NAV: { href: string; label: string }[] = [
  { href: "/id", label: "영업시간" },
  { href: "/id/products", label: "상품 및 결제" },
  { href: "/id/events", label: "매장 이벤트" },
  { href: "/id/guide", label: "재고 및 와이파이" },
  { href: "/id/cleaning", label: "청소 가이드" },
  { href: "/id/fragrance", label: "향료 교체" },
];

export default function IdLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname() || "/id";

  return (
    <div className="space-y-6">
      {/* 페이지 헤더 */}
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold text-gray-900">{storeLabel.id}</h1>
        <Badge color="brand">매장 운영 안내</Badge>
      </div>

      {/* 하위 페이지 서브 네비 */}
      <nav className="flex items-center gap-1.5 overflow-x-auto rounded-2xl bg-gray-100 p-1.5 sm:gap-2">
        {SUB_NAV.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={
                "whitespace-nowrap rounded-xl px-3 py-1.5 text-sm font-medium transition-colors " +
                (active
                  ? "bg-brand text-white shadow-sm"
                  : "text-gray-600 hover:text-brand-dark")
              }
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* 선택된 하위 페이지 */}
      <div>{children}</div>
    </div>
  );
}
