"use client";

// ============================================================
//  상단바 — 위치(브레드크럼) + 페이지가 올리는 툴바 컨트롤
// ------------------------------------------------------------
//  바탕은 투명에 가깝다(유리 사이드바와 겹치지 않도록). 스크롤 시
//  본문과 겹치는 경계만 옅게 흐려 글자가 읽히게 한다 (scroll edge).
//  오른쪽 슬롯에는 페이지가 ToolbarPortal 로 캡슐 컨트롤을 올린다.
// ============================================================
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu as MenuIcon } from "lucide-react";
import { cn, IconButton } from "@/components/neander/ui";
import { RecordingIndicator } from "@/components/neander/meetings/RecordingProvider";
import { useShell } from "./context";
import { describePath } from "./nav-config";

export function Topbar() {
  const pathname = usePathname();
  const { isMobile, setDrawerOpen, setToolbarEl } = useShell();
  const crumb = describePath(pathname);

  return (
    <header
      data-nd-topbar
      className="sticky top-0 z-nd-sticky flex h-[var(--nd-topbar-h)] items-center gap-2 bg-nd-page/80 px-3 backdrop-blur-md sm:gap-3 sm:px-5 lg:px-6"
    >
      {/* 모바일은 드로어를 연다. 데스크톱 접기·펼치기는 사이드바 변의 동그라미 버튼 */}
      {isMobile && (
        <IconButton icon={MenuIcon} label="메뉴 열기" variant="secondary" pill onClick={() => setDrawerOpen(true)} />
      )}

      {/* 브레드크럼 */}
      <nav aria-label="현재 위치" className="flex shrink-0 items-center gap-1.5 text-nd-body">
        {crumb.module && (
          <>
            <Link href={crumb.module.href} className="hidden shrink-0 rounded-[6px] px-1 text-nd-fg-2 hover:text-nd-fg sm:inline">
              {crumb.module.label}
            </Link>
            <span aria-hidden className="hidden text-nd-fg-4 sm:inline">
              /
            </span>
          </>
        )}
        <span className="max-w-[40vw] truncate px-1 font-semibold text-nd-fg sm:max-w-none" aria-current="page">
          {crumb.page}
        </span>
      </nav>

      {/* 회의 녹음 중이면 어느 화면에서든 — 누르면 그 회의로 */}
      <RecordingIndicator />

      {/* 페이지 툴바 슬롯 */}
      <div
        ref={setToolbarEl}
        className={cn(
          "nd-scroll ml-auto flex min-w-0 items-center gap-2 overflow-x-auto",
          isMobile && "-mr-1 pr-1",
        )}
      />
    </header>
  );
}
