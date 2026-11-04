"use client";

// ============================================================
//  AI STUDIO 화면 틀 — 상단 프로젝트 띠 · 모바일 하단 메뉴 (2026-11 목업 개편)
// ------------------------------------------------------------
//  프로젝트 띠: 툴바의 「프로젝트」·「보기」 아래에 지금 보고 있는 것을 다시 한 줄로 —
//    ● 살림설계사무소 [자체 운영]              영상 · 소재 기본 공개 범위: 나만 보기
//    ● 오늘의주방 공식 [대행 · 오늘의주방]     관리자 · 그 업체 담당자만 보는 프로젝트
//    ● 모든 프로젝트를 함께 보고 있습니다 [전체 현황]   (대시보드)
//  모바일은 툴바가 좁아 「프로젝트」·「보기」 고르기를 이 띠 안으로 내린다 — 맥락이 사라지지 않게.
//  하단 메뉴(모바일만): 대시보드 · 영상 · 소재 발굴 · 일정 · 전체 메뉴(사이드바 서랍).
// ============================================================

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarDays, Clapperboard, LayoutDashboard, Menu, Radar, type LucideIcon } from "lucide-react";
import { cn } from "@/components/neander/ui";
import { useShell } from "@/components/neander/shell/context";
import { spaceKind } from "@/lib/neander/shorts/spaces";
import { useShorts } from "./ShortsProvider";
import { ShortsScope, ShortsSpaceSwitch } from "./ShortsScope";
import { SpaceKindBadge } from "./studio";

const DASHBOARD = "/neander/shorts";

/** 「보기」 가 뜻하는 범위 — 띠 오른쪽 */
function useScopeText(): string {
  const { data, viewer, nameOf } = useShorts();
  const d = data!;
  if (viewer === "mine") return "영상 · 소재 기본 공개 범위: 나만 보기";
  if (viewer === "visible") return d.admin ? "모든 사용자 · 다른 사람 자료는 읽기 전용" : "내 것 + 팀 공개 · 다른 사람 자료는 읽기 전용";
  return d.admin ? `${nameOf(viewer)}의 자료 · 읽기 전용` : `${nameOf(viewer)}의 팀 공개 자료 · 읽기 전용`;
}

export function StudioContextBar() {
  const pathname = usePathname();
  const { isMobile } = useShell();
  const { data, currentSpace } = useShorts();
  const scopeText = useScopeText();
  const d = data!;
  const dashboard = pathname === DASHBOARD;
  const kind = currentSpace ? spaceKind(currentSpace) : "own";
  const client = kind === "agency" ? d.clients.find((c) => c.id === currentSpace?.clientId) : undefined;

  const context = dashboard ? (
    <>
      <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-nd-accent" />
      <span className="font-semibold text-nd-fg">모든 프로젝트를 함께 보고 있습니다</span>
      <span className="rounded-nd-sm bg-nd-fg/[.07] px-2 py-0.5 text-[13px] font-medium text-nd-fg-2">전체 현황</span>
    </>
  ) : (
    <>
      <span aria-hidden className={cn("h-2 w-2 shrink-0 rounded-full", kind === "agency" ? "bg-nd-warning" : "bg-nd-accent")} />
      <span className="min-w-0 truncate font-semibold text-nd-fg">{currentSpace?.name ?? "프로젝트"}</span>
      <SpaceKindBadge kind={kind} />
      {client && (
        <Link href={`/neander/shorts/clients/${client.id}`} className="min-w-0 truncate text-nd-fg-2 underline-offset-2 hover:text-nd-fg hover:underline">
          업체 · {client.name}
        </Link>
      )}
    </>
  );
  const right = dashboard ? (d.admin ? "관리자 · 다른 사람 자료는 읽기 전용" : "내 것 + 팀 공개 자료") : kind === "agency" ? `관리자 · 업체 담당자만 보는 프로젝트 · ${scopeText}` : scopeText;

  return (
    <div
      data-studio-context
      className="-mx-4 -mt-3 mb-6 border-b border-nd-line bg-nd-content/70 px-4 py-2.5 text-[13px] sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8"
    >
      {isMobile && (
        <div className="mb-2.5 grid grid-cols-2 gap-2">
          <ShortsSpaceSwitch inline />
          <ShortsScope inline />
        </div>
      )}
      <div className="flex min-w-0 flex-col gap-1 md:flex-row md:items-center md:justify-between md:gap-4">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">{context}</div>
        <div className="min-w-0 text-nd-fg-3 md:truncate md:text-right">{right}</div>
      </div>
    </div>
  );
}

const MOBILE_NAV: { href: string; label: string; icon: LucideIcon; exact?: boolean }[] = [
  { href: DASHBOARD, label: "대시보드", icon: LayoutDashboard, exact: true },
  { href: "/neander/shorts/projects", label: "영상", icon: Clapperboard },
  { href: "/neander/shorts/trends", label: "소재 발굴", icon: Radar },
  { href: "/neander/shorts/calendar", label: "일정", icon: CalendarDays },
];

/** 모바일 하단 메뉴 — 자주 가는 넷 + 전체 메뉴(서랍). 본문이 가려지지 않게 아래에 같은 높이 여백을 둔다 */
export function StudioMobileNav() {
  const pathname = usePathname();
  const { isMobile, setDrawerOpen } = useShell();
  if (!isMobile) return null;
  const active = (it: (typeof MOBILE_NAV)[number]) => (it.exact ? pathname === it.href : pathname === it.href || pathname.startsWith(it.href + "/"));
  return (
    <>
      <div aria-hidden className="h-16" />
      <nav
        aria-label="AI STUDIO 빠른 메뉴"
        className="fixed inset-x-0 bottom-0 z-nd-sticky border-t border-nd-line bg-nd-content/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md"
      >
        <ul className="grid grid-cols-5">
          {MOBILE_NAV.map((it) => {
            const on = active(it);
            return (
              <li key={it.href}>
                <Link
                  href={it.href}
                  aria-current={on ? "page" : undefined}
                  className={cn("flex h-16 flex-col items-center justify-center gap-1 text-[13px]", on ? "font-semibold text-nd-accent-strong" : "text-nd-fg-2")}
                >
                  <it.icon size={20} aria-hidden />
                  {it.label}
                </Link>
              </li>
            );
          })}
          <li>
            <button type="button" onClick={() => setDrawerOpen(true)} className="flex h-16 w-full flex-col items-center justify-center gap-1 text-[13px] text-nd-fg-2">
              <Menu size={20} aria-hidden />
              전체 메뉴
            </button>
          </li>
        </ul>
      </nav>
    </>
  );
}
