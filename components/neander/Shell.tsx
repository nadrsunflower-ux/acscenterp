"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { useAppData } from "@/components/neander/app-data";
import { useAuth } from "@/components/neander/auth";
import { useChat } from "@/components/neander/chat";
import { seedDefaultMembers } from "@/lib/neander/db/members";
import { Button, cn } from "@/components/neander/ui";

const NAV = [
  { href: "/neander", label: "대시보드", icon: "📊" },
  { href: "/neander/dev", label: "개발", icon: "🚀" },
  { href: "/neander/tasks", label: "일일업무", icon: "✅" },
  { href: "/neander/requests", label: "업무요청", icon: "✉️" },
  { href: "/neander/messenger", label: "메신저", icon: "💬" },
  { href: "/neander/shortcuts", label: "바로가기", icon: "🔗" },
  { href: "/neander/schedule", label: "스케줄", icon: "🗓️" },
  { href: "/neander/meetings", label: "회의록", icon: "📝" },
  { href: "/neander/sales", label: "매출", icon: "💰" },
  { href: "/neander/finance", label: "재무", icon: "📒" },
  { href: "/neander/members", label: "팀원", icon: "👥" },
];

/** 사이드바 접힘 상태 저장 키 — 기기별 취향이라 localStorage 로 충분하다 */
const SIDEBAR_KEY = "neander.sidebar.collapsed";

export function Shell({ children }: { children: ReactNode }) {
  const { members, requests, currentMember } = useAppData();
  const { user, logout } = useAuth();
  const { totalUnread } = useChat();
  const pathname = usePathname();
  const [seeding, setSeeding] = useState(false);

  // 사이드바 접기 — 시트처럼 가로가 넓어야 하는 화면에서 쓴다.
  // 초기값은 펼침으로 두고 마운트 후 저장값을 읽는다 (SSR 불일치 방지).
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(SIDEBAR_KEY) === "1");
    } catch {
      /* 저장소 접근 불가 — 펼침 유지 */
    }
  }, []);
  const toggleSidebar = () => {
    setCollapsed((c) => {
      try {
        localStorage.setItem(SIDEBAR_KEY, c ? "0" : "1");
      } catch {
        /* noop */
      }
      return !c;
    });
  };

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
      {/* 사이드바 — 펼치면 아이콘+이름, 접으면 아이콘만 */}
      {/* 뷰포트에 고정한다. flex 기본값(stretch)으로 두면 사이드바가 문서
          전체 높이만큼 늘어나 접기 버튼의 top-1/2 이 화면 밖으로 밀린다.
          sticky + h-screen + self-start 로 항상 화면 높이와 같게 맞춘다. */}
      <aside
        className={cn(
          "sticky top-0 z-20 hidden h-screen shrink-0 flex-col self-start border-r border-zinc-200 bg-white transition-[width] duration-200 sm:flex",
          collapsed ? "w-14 p-1.5" : "w-44 p-2.5",
        )}
      >
        {/* 접기 버튼 — 사이드바 오른쪽 테두리 위, 세로 한가운데.
            테두리에 걸치게 두면 "이 경계를 민다"는 뜻이 그대로 읽힌다. */}
        <button
          type="button"
          onClick={toggleSidebar}
          title={collapsed ? "사이드바 펼치기" : "사이드바 접기"}
          aria-label={collapsed ? "사이드바 펼치기" : "사이드바 접기"}
          aria-expanded={!collapsed}
          className="absolute -right-3 top-1/2 z-20 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-400 shadow-sm transition-colors hover:border-indigo-300 hover:text-indigo-600"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            className={cn("h-3.5 w-3.5 transition-transform duration-200", collapsed && "rotate-180")}
            aria-hidden
          >
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>

        <div className={cn("mb-3 flex items-start", collapsed ? "justify-center" : "px-1.5")}>
          {collapsed ? (
            <div className="mt-1 text-base font-bold tracking-tight text-zinc-900" title="NEANDER ERP">N</div>
          ) : (
            <div>
              <div className="text-base font-bold tracking-tight text-zinc-900">NEANDER</div>
              <div className="text-[11px] font-medium text-indigo-500">ERP</div>
            </div>
          )}
        </div>
        {/* 화면이 낮으면 메뉴만 스크롤한다 (하단 매장 링크는 계속 보이게) */}
        <nav className="flex min-h-0 flex-col gap-1 overflow-y-auto">
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
                title={collapsed ? item.label : undefined}
                className={cn(
                  "relative flex items-center rounded-lg text-sm font-medium transition-colors",
                  collapsed ? "justify-center px-0 py-2" : "justify-between px-2.5 py-1.5",
                  active
                    ? "bg-indigo-50 text-indigo-700"
                    : "text-zinc-600 hover:bg-zinc-100",
                )}
              >
                <span className="flex items-center gap-2">
                  <span className="text-[15px]">{item.icon}</span>
                  {!collapsed && item.label}
                </span>
                {badge > 0 &&
                  (collapsed ? (
                    <span className="absolute right-1 top-1 flex min-w-[15px] items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold leading-4 text-white">
                      {badge}
                    </span>
                  ) : (
                    <span className="rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
                      {badge}
                    </span>
                  ))}
              </Link>
            );
          })}
        </nav>

        {/* 하단: AC'SCENT 매장 관리로 복귀 */}
        <div className="mt-auto border-t border-zinc-100 pt-3">
          <Link
            href="/"
            title={collapsed ? "AC'SCENT 매장" : undefined}
            className={cn(
              "flex items-center gap-2 rounded-lg text-sm font-medium text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-700",
              collapsed ? "justify-center px-0 py-2" : "px-2.5 py-1.5",
            )}
          >
            <span>🏬</span>
            {!collapsed && <>AC&apos;SCENT 매장</>}
          </Link>
        </div>
      </aside>

      {/* 메인 영역 */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* 상단바 */}
        <header className="neander-topbar flex items-center justify-between gap-3 border-b border-zinc-200 bg-white px-5 py-3">
          {/* 모바일용 간단 네비 */}
          <nav className="-mx-1 flex items-center gap-1 overflow-x-auto px-1 sm:hidden">
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
          <div className="hidden sm:block" />

          {/* 로그인 사용자 + 로그아웃 */}
          <div className="flex items-center gap-3">
            {/* 모바일: AC'SCENT 복귀 */}
            <Link
              href="/"
              className="rounded-lg px-2 py-1.5 text-xs font-medium text-zinc-500 hover:bg-zinc-100 sm:hidden"
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

        <main className="neander-main w-full flex-1 p-4 sm:p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
