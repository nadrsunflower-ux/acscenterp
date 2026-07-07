"use client";

// ============================================================
//  개발 협업 허브 레이아웃 (/neander/dev/*)
//  DevDataProvider 로 features/tasks/activity 를 한 번 구독해 하위에 공유.
//  상단에 서브 탭(한눈에/작업 보드/진행 소식/프로젝트).
//  ⚠️ 이 H1 이 개발 허브의 유일한 H1 — 하위 페이지는 h2 섹션만 쓴다.
// ============================================================

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { DevDataProvider } from "@/components/neander/dev/dev-data";
import { cn } from "@/components/neander/ui";

const TABS = [
  {
    href: "/neander/dev",
    label: "한눈에",
    icon: "📊",
    exact: true,
    title: "지금 누가 무엇을 하는지, 팀 개발 현황을 요약해서 보여줘요",
  },
  {
    href: "/neander/dev/board",
    label: "작업 보드",
    icon: "🗂️",
    title: "카드를 끌어다 놓으며 작업 상태를 바꾸는 보드예요",
  },
  {
    href: "/neander/dev/timeline",
    label: "진행 소식",
    icon: "📣",
    title: "개발 진행 업데이트가 시간순으로 올라오는 소식 피드예요",
  },
  {
    href: "/neander/dev/features",
    label: "프로젝트",
    icon: "🧩",
    title: "작업을 프로젝트 단위로 묶어 진행률을 관리해요",
  },
];

export default function DevLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <DevDataProvider>
      <div className="flex flex-col gap-5">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-zinc-900">개발 허브</h1>
            <span className="text-xl">🚀</span>
          </div>
          <p className="mt-1 text-sm text-zinc-500">
            누가 어떤 작업을 하고 있고 어디까지 진행됐는지 — 개발을 몰라도 여기서 다 볼 수 있어요.
          </p>
        </div>

        {/* 서브 탭 */}
        <div className="flex gap-1 overflow-x-auto rounded-full bg-zinc-100 p-1">
          {TABS.map((t) => {
            const active = t.exact ? pathname === t.href : pathname.startsWith(t.href);
            return (
              <Link
                key={t.href}
                href={t.href}
                title={t.title}
                className={cn(
                  "flex items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-medium transition",
                  active ? "bg-zinc-900 text-white shadow-sm" : "text-zinc-500 hover:text-zinc-800",
                )}
              >
                <span className="text-xs">{t.icon}</span>
                {t.label}
              </Link>
            );
          })}
        </div>

        <div>{children}</div>
      </div>
    </DevDataProvider>
  );
}
