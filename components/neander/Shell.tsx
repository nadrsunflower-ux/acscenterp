"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { useAppData } from "@/components/neander/app-data";
import { useAuth } from "@/components/neander/auth";
import { useChat } from "@/components/neander/chat";
import { seedDefaultMembers } from "@/lib/neander/db/members";
import { Button, cn } from "@/components/neander/ui";

const NAV = [
  { href: "/neander", label: "대시보드", icon: "📊" },
  { href: "/neander/tasks", label: "일일업무", icon: "✅" },
  { href: "/neander/requests", label: "업무요청", icon: "✉️" },
  { href: "/neander/messenger", label: "메신저", icon: "💬" },
  { href: "/neander/schedule", label: "스케줄", icon: "🗓️" },
  { href: "/neander/meetings", label: "회의록", icon: "📝" },
  { href: "/neander/sales", label: "매출", icon: "💰" },
  { href: "/neander/members", label: "팀원", icon: "👥" },
];

export function Shell({ children }: { children: ReactNode }) {
  const { members, requests, currentMember } = useAppData();
  const { user, logout } = useAuth();
  const { totalUnread } = useChat();
  const pathname = usePathname();
  const [seeding, setSeeding] = useState(false);

  // 현재 사용자가 받은 요청 중 '확인완료'하지 않은 수 (네비 뱃지)
  const myPendingReqs = currentMember
    ? requests.filter((r) => r.toId === currentMember.id && !r.acknowledged).length
    : 0;

  // 네비 항목별 뱃지 수
  const badgeFor = (href: string) =>
    href === "/neander/requests" ? myPendingReqs : href === "/neander/messenger" ? totalUnread : 0;

  // 팀원이 한 명도 없으면 셋업 화면
  if (members.length === 0) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50 p-6">
        <div className="w-full max-w-md rounded-xl border border-zinc-200 bg-white p-8 text-center shadow-sm">
          <div className="mb-3 text-4xl">👋</div>
          <h1 className="text-xl font-bold text-zinc-900">NEANDER ERP 시작하기</h1>
          <p className="mt-2 text-sm text-zinc-500">
            먼저 팀원을 등록해야 합니다. 기본 5명을 만든 뒤 팀원 메뉴에서 실제 이름과
            Google 이메일을 입력하세요.
          </p>
          <Button
            className="mt-5 w-full"
            disabled={seeding}
            onClick={async () => {
              setSeeding(true);
              try {
                await seedDefaultMembers();
              } finally {
                setSeeding(false);
              }
            }}
          >
            {seeding ? "생성 중…" : "기본 팀원 5명 생성"}
          </Button>
          <button
            onClick={() => logout()}
            className="mt-3 text-xs text-zinc-400 hover:text-zinc-600"
          >
            로그아웃
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-zinc-50">
      {/* 사이드바 */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-zinc-200 bg-white p-4 md:flex">
        <div className="mb-6 px-2">
          <div className="text-lg font-bold tracking-tight text-zinc-900">NEANDER</div>
          <div className="text-xs font-medium text-indigo-500">ERP</div>
        </div>
        <nav className="flex flex-col gap-1">
          {NAV.map((item) => {
            const active =
              item.href === "/neander"
                ? pathname === "/neander"
                : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center justify-between rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "bg-indigo-50 text-indigo-700"
                    : "text-zinc-600 hover:bg-zinc-100",
                )}
              >
                <span className="flex items-center gap-2.5">
                  <span>{item.icon}</span>
                  {item.label}
                </span>
                {badgeFor(item.href) > 0 && (
                  <span className="rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
                    {badgeFor(item.href)}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        {/* 하단: AC'SCENT 매장 관리로 복귀 */}
        <div className="mt-auto border-t border-zinc-100 pt-3">
          <Link
            href="/"
            className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-700"
          >
            <span>🏬</span>
            AC&apos;SCENT 매장 관리
          </Link>
        </div>
      </aside>

      {/* 메인 영역 */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* 상단바 */}
        <header className="flex items-center justify-between gap-3 border-b border-zinc-200 bg-white px-5 py-3">
          {/* 모바일용 간단 네비 */}
          <nav className="-mx-1 flex items-center gap-1 overflow-x-auto px-1 md:hidden">
            {NAV.map((item) => {
              const active =
                item.href === "/neander"
                  ? pathname === "/neander"
                  : pathname.startsWith(item.href);
              const badge = badgeFor(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "relative whitespace-nowrap rounded-lg px-2.5 py-1.5 text-xs font-medium",
                    active ? "bg-indigo-50 text-indigo-700" : "text-zinc-500",
                  )}
                >
                  {item.label}
                  {badge > 0 && (
                    <span className="absolute -right-0.5 -top-0.5 flex min-w-[15px] items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white">
                      {badge}
                    </span>
                  )}
                </Link>
              );
            })}
          </nav>
          <div className="hidden md:block" />

          {/* 로그인 사용자 + 로그아웃 */}
          <div className="flex items-center gap-3">
            {/* 모바일: AC'SCENT 복귀 */}
            <Link
              href="/"
              className="rounded-lg px-2 py-1.5 text-xs font-medium text-zinc-500 hover:bg-zinc-100 md:hidden"
            >
              🏬 매장
            </Link>
            <div className="flex items-center gap-1.5">
              {currentMember ? (
                <>
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: currentMember.color ?? "#71717a" }}
                  />
                  <span className="text-sm font-medium text-zinc-800">{currentMember.name}</span>
                </>
              ) : (
                <span className="text-sm text-zinc-500" title="이 계정은 아직 팀원과 연결되지 않았습니다">
                  {user?.email}
                </span>
              )}
            </div>
            <button
              onClick={() => logout()}
              className="rounded-lg px-2 py-1.5 text-xs font-medium text-zinc-500 hover:bg-zinc-100"
            >
              로그아웃
            </button>
          </div>
        </header>

        <main className="w-full flex-1 p-4 sm:p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
