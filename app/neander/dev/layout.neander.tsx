"use client";

// ============================================================
//  개발 협업 허브 레이아웃 (/neander/dev/*)
//  DevDataProvider 로 features/tasks/activity 를 한 번 구독해 하위에 공유.
//  상단에 서브 탭(한눈에/작업 보드/진행 소식/프로젝트).
//  ⚠️ 이 H1 이 개발 허브의 유일한 H1 — 하위 페이지는 h2 섹션만 쓴다.
// ============================================================

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Blocks, LayoutDashboard, Megaphone, SquareKanban } from "lucide-react";
import { DevDataProvider } from "@/components/neander/dev/dev-data";
import { PageHeader, Tabs, type TabItem } from "@/components/neander/ui";

const TABS: (TabItem & { exact?: boolean })[] = [
  { key: "home", href: "/neander/dev", label: "한눈에", icon: LayoutDashboard, exact: true },
  { key: "board", href: "/neander/dev/board", label: "작업 보드", icon: SquareKanban },
  { key: "timeline", href: "/neander/dev/timeline", label: "진행 소식", icon: Megaphone },
  { key: "features", href: "/neander/dev/features", label: "프로젝트", icon: Blocks },
];

export default function DevLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const active =
    TABS.find((t) => (t.exact ? pathname === t.href : !!t.href && pathname.startsWith(t.href)))?.key ?? "home";

  return (
    <DevDataProvider>
      <div>
        <PageHeader
          compact
          title="개발 허브"
          description="누가 어떤 작업을 하고 있고 어디까지 진행됐는지 — 개발을 몰라도 여기서 다 볼 수 있어요."
        />

        {/* 서브 탭 — 다른 화면으로 가는 탐색 */}
        <Tabs items={TABS} value={active} ariaLabel="개발 허브 화면" className="mb-5" />

        <div>{children}</div>
      </div>
    </DevDataProvider>
  );
}
