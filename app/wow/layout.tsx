"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import Badge from "@/components/ui/Badge";
import { storeLabel } from "@/lib/content";

// 악센트 와우 하위 페이지들.
const SUB_NAV: { href: string; label: string }[] = [
  { href: "/wow", label: "영업시간" },
  { href: "/wow/products", label: "상품 및 결제" },
  { href: "/wow/cleaning", label: "청소 가이드" },
  { href: "/wow/fragrance", label: "향료 교체" },
];

export default function WowLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname() || "/wow";

  return (
    <div className="space-y-6">
      {/* 페이지 헤더 */}
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold text-gray-900">{storeLabel.wow}</h1>
        <Badge color="orange">매장 운영 안내</Badge>
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
                  ? "bg-wow text-white shadow-sm"
                  : "text-gray-600 hover:text-orange-700")
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
