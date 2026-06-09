"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

interface NavItem {
  href: string;
  label: string;
}

// 관리자(/admin)는 네비게이션에 노출하지 않음 — 직접 URL 로만 접근(미들웨어 비번 보호).
const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "대시보드" },
  { href: "/suggestions", label: "건의함" },
  { href: "/id", label: "악센트 아이디" },
  { href: "/wow", label: "악센트 와우" },
];

// 현재 경로가 해당 항목에 속하는지 (정확 매칭 또는 하위 경로)
function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function Nav() {
  const pathname = usePathname() || "/";

  return (
    <header className="sticky top-0 z-30 border-b border-black/5 bg-white/80 backdrop-blur">
      <nav className="mx-auto flex w-full items-center gap-1 px-2 py-3 sm:gap-2 sm:px-4">
        <Link href="/" className="mr-2 shrink-0 text-base font-bold text-brand-dark">
          악센트
        </Link>
        <div className="flex flex-1 items-center gap-1 overflow-x-auto sm:gap-2">
          {NAV_ITEMS.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={
                  "whitespace-nowrap rounded-xl px-3 py-1.5 text-sm font-medium transition-colors " +
                  (active
                    ? "bg-brand text-white"
                    : "text-gray-600 hover:bg-brand-light hover:text-brand-dark")
                }
              >
                {item.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </header>
  );
}
