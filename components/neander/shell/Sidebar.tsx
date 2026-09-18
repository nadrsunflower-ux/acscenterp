"use client";

// ============================================================
//  사이드바 — 유리(regular) 탐색 레이어
// ------------------------------------------------------------
//  데스크톱: 화면 왼쪽에 떠 있는 유리 패널(펼침 248 / 접힘 64).
//  태블릿: 기본 접힘. 모바일(<768): 같은 내용을 왼쪽 드로어(Sheet)로.
//  재무·매출 아래에서는 그 워크스페이스 메뉴로 바뀌고 "전체 ERP" 링크가
//  붙는다. 어떤 경로가 워크스페이스인지는 nav-config 의 WORKSPACES 가
//  정한다 — 여기서 모듈 이름으로 분기하지 않는다.
//  선택 행은 accent-soft 단색 — 유리 위에 유리를 겹치지 않는다.
// ============================================================
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronsUpDown, LayoutGrid, LogOut, ShieldCheck, Store } from "lucide-react";
import { ADMIN_LOGIN_PATH } from "@/lib/auth";
import { useAppData } from "@/components/neander/app-data";
import { useAuth } from "@/components/neander/auth";
import {
  BrandMark,
  ProductWordmark,
  cn,
  CountBadge,
  Icon,
  Menu,
  MemberAvatar,
  Sheet,
  Tooltip,
} from "@/components/neander/ui";
import { useShell } from "./context";
import { GLOBAL_NAV, WORKSPACES, isActive, workspaceOf, type NavItem } from "./nav-config";

/**
 * 셸 머리의 상표.
 *
 * ⚠️ 로고 파일이 저장소에 들어오면 `components/neander/ui/brand.tsx` 의
 *    `BRAND_LOGO` 에 경로를 채우고, 그때 이 자리가 파일로 바뀐다. 채워지기
 *    전에는 글자로 둔다 — 다른 브랜드의 로고를 임시로 끼워 넣지 않는다.
 *    (회사 로고 AC'SCENT 는 매장 브랜드이고, 이 자리는 ERP 제품 자리다)
 */
function Wordmark({ compact = false }: { compact?: boolean }) {
  return (
    <span className="relative flex h-8 items-center">
      <span className={cn("whitespace-nowrap", fade(!compact))}>
        <ProductWordmark height={15} className="px-1" />
      </span>
      <span className={cn("absolute left-0 top-0", fade(compact))}>
        <BrandMark />
      </span>
    </span>
  );
}

/**
 * 접기·펼치기 움직임.
 * 폭은 aside 가 SIDEBAR_MS 동안 옮기고, 안의 줄은 모양을 바꾸지 않는다 —
 * 아이콘은 제자리에 있고 글자만 흐려지며 가장자리에 잘린다. 접을 때는 글자가
 * 먼저 사라지고, 펼칠 때는 폭이 조금 벌어진 뒤 나타나야 눌린 글자가 안 보인다.
 */
const SIDEBAR_MS = 240;
function fade(visible: boolean) {
  return cn(
    "transition-opacity ease-nd",
    visible ? "opacity-100 duration-nd delay-[60ms]" : "pointer-events-none opacity-0 duration-nd-fast",
  );
}

function NavRow({
  item,
  active,
  collapsed,
  badge,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  collapsed: boolean;
  badge: number;
  onNavigate?: () => void;
}) {
  const row = (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        // 접힘 폭(40)에서 18px 아이콘이 가운데 오도록 px 11 — 펼침에서도 같은 자리
        "relative flex h-9 w-full items-center gap-2.5 rounded-nd-md px-[11px] text-nd-body font-medium transition-colors duration-nd-fast ease-nd",
        active ? "bg-nd-accent-soft text-nd-accent-strong" : "text-nd-fg-2 hover:bg-nd-fg/[.05] hover:text-nd-fg",
      )}
    >
      <Icon icon={item.icon} size={18} className={cn("shrink-0", active ? "text-nd-accent" : "text-nd-fg-3")} />
      <span className={cn("min-w-0 flex-1 truncate", fade(!collapsed))}>{item.label}</span>
      {badge > 0 && (
        <>
          <span className={cn("absolute -right-1.5 -top-1.5 scale-90", fade(collapsed))} aria-hidden={!collapsed}>
            <CountBadge count={badge} tone="danger" label={`${item.label} ${badge}건`} />
          </span>
          <span className={cn("shrink-0", fade(!collapsed))} aria-hidden={collapsed}>
            <CountBadge count={badge} tone="danger" label={`${item.label} ${badge}건`} />
          </span>
        </>
      )}
    </Link>
  );
  // 접힘 여부로 감쌌다 풀면 링크가 다시 그려져 움직임이 끊긴다 — 늘 감싸고 끈다
  return (
    <Tooltip
      label={badge > 0 ? `${item.label} · ${badge}건` : item.label}
      side="bottom"
      disabled={!collapsed}
      className="flex w-full"
    >
      {row}
    </Tooltip>
  );
}

/**
 * 매장 운영 사이트(ACSCENT ERP) 주소.
 * 같은 레포지만 Vercel 프로젝트가 따로라 도메인이 다르다 — 본사 도메인의
 * "/" 는 미들웨어가 /neander 로 되돌려서, 상대 경로로는 갈 수 없다.
 */
const ACSCENT_ERP_ORIGIN = "https://acscenterp.vercel.app";

/** 사이드바 본문 — aside 와 드로어가 같이 쓴다 */
export function SidebarContent({
  collapsed = false,
  onNavigate,
  onMenuOpenChange,
}: {
  collapsed?: boolean;
  onNavigate?: () => void;
  /** 워크스페이스·사용자 메뉴가 열려 있는가 — 엿보기가 그동안 접히지 않게 */
  onMenuOpenChange?: (open: boolean) => void;
}) {
  const pathname = usePathname();
  const workspace = workspaceOf(pathname);
  const groups = workspace ? workspace.nav : GLOBAL_NAV;
  const { badges } = useShell();
  const { currentMember } = useAppData();
  const { user, logout } = useAuth();

  const wsRef = useRef<HTMLButtonElement>(null);
  const [wsOpen, setWsOpen] = useState(false);
  const userRef = useRef<HTMLButtonElement>(null);
  const [userOpen, setUserOpen] = useState(false);
  const menuOpen = wsOpen || userOpen;
  useEffect(() => {
    onMenuOpenChange?.(menuOpen);
  }, [menuOpen, onMenuOpenChange]);

  const workspaceLabel = workspace ? `${workspace.label} 워크스페이스` : "전체 ERP";
  const workspaceIcon = workspace ? workspace.icon : LayoutGrid;

  return (
    <div className="flex h-full min-h-0 flex-col px-3 py-3">
      {/* 로고 — 여닫기는 사이드바 오른쪽 변의 동그라미(EdgeToggle)가 맡는다 */}
      <div className="mb-3 flex h-8 items-center">
        <Link href="/neander" onClick={onNavigate} className="ml-1 rounded-nd-md">
          <Wordmark compact={collapsed} />
        </Link>
      </div>

      {/* 워크스페이스 스위처 */}
      <button
        ref={wsRef}
        type="button"
        onClick={() => setWsOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={wsOpen}
        aria-label={collapsed ? `워크스페이스: ${workspaceLabel}` : undefined}
        className="flex h-10 w-full items-center gap-2.5 overflow-hidden rounded-nd-md border border-nd-border bg-nd-content/70 px-2.5 text-nd-body font-medium text-nd-fg transition-colors duration-nd-fast hover:bg-nd-content"
      >
        <Icon icon={workspaceIcon} size={18} className="shrink-0 text-nd-fg-2" />
        <span className={cn("min-w-0 flex-1 truncate text-left", fade(!collapsed))}>{workspaceLabel}</span>
        <Icon icon={ChevronsUpDown} size={15} className={cn("shrink-0 text-nd-fg-3", fade(!collapsed))} />
      </button>
      <Menu
        open={wsOpen}
        onClose={() => setWsOpen(false)}
        anchorRef={wsRef}
        ariaLabel="워크스페이스 선택"
        matchWidth={!collapsed}
        items={[
          { key: "erp", label: "전체 ERP", icon: LayoutGrid, checked: !workspace, onSelect: () => { window.location.assign("/neander"); } },
          ...WORKSPACES.map((w) => ({
            key: w.key,
            label: `${w.label} 워크스페이스`,
            icon: w.icon,
            checked: workspace?.key === w.key,
            onSelect: () => { window.location.assign(w.href); },
          })),
        ]}
      />

      {/* 워크스페이스 → 전체 ERP 로 돌아가는 길 */}
      {workspace && (
        <Tooltip label="전체 ERP" side="bottom" disabled={!collapsed} className="mt-2 flex w-full">
          <Link
            href="/neander"
            onClick={onNavigate}
            className="flex h-8 w-full items-center gap-1 overflow-hidden rounded-nd-md px-3 text-nd-caption font-medium text-nd-fg-2 hover:bg-nd-fg/[.05] hover:text-nd-fg"
            aria-label={collapsed ? "전체 ERP 로" : undefined}
          >
            <Icon icon={ChevronLeft} size={16} className="shrink-0" />
            <span className={cn("whitespace-nowrap", fade(!collapsed))}>전체 ERP</span>
          </Link>
        </Tooltip>
      )}

      {/* 메뉴 — 화면이 낮으면 이 부분만 스크롤.
          스크롤 상자는 넘친 것을 자른다 — 접힘 배지가 행 모서리 밖(6px)으로
          나가므로 상자를 유리판 가장자리까지 넓히고(-mx-3 px-3) 위에도 그만큼 비운다 */}
      <nav
        aria-label={workspace ? `${workspace.label} 메뉴` : "ERP 메뉴"}
        className="nd-scroll -mx-3 min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-3 pt-1.5"
      >
        {groups.map((g, gi) => (
          <div
            key={g.label ?? gi}
            className={cn(
              gi > 0 && "border-t transition-[margin,padding,border-color] ease-nd",
              gi > 0 && (collapsed ? "mt-2 border-nd-line pt-2" : "mt-3 border-transparent pt-0"),
            )}
            style={gi > 0 ? { transitionDuration: `${SIDEBAR_MS}ms` } : undefined}
          >
            {g.label && (
              <div
                className={cn(
                  "grid transition-[grid-template-rows] ease-nd",
                  collapsed ? "grid-rows-[0fr]" : "grid-rows-[1fr]",
                )}
                style={{ transitionDuration: `${SIDEBAR_MS}ms` }}
                aria-hidden={collapsed || undefined}
              >
                <div className="min-h-0 overflow-hidden">
                  <div className={cn("whitespace-nowrap px-2.5 pb-1 pt-2 text-nd-caption font-medium text-nd-fg-3", fade(!collapsed))}>
                    {g.label}
                  </div>
                </div>
              </div>
            )}
            <ul className="flex flex-col gap-0.5">
              {g.items.map((item) => (
                <li key={item.href}>
                  <NavRow
                    item={item}
                    active={isActive(item, pathname)}
                    collapsed={collapsed}
                    badge={item.badge ? (badges[item.badge] ?? 0) : 0}
                    onNavigate={onNavigate}
                  />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      {/* 사용자 */}
      <div className="mt-2 border-t border-nd-line pt-2">
        <button
          ref={userRef}
          type="button"
          onClick={() => setUserOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={userOpen}
          aria-label={collapsed ? `${currentMember?.name ?? user?.email ?? "사용자"} 메뉴` : undefined}
          className="flex h-12 w-full items-center gap-2.5 overflow-hidden rounded-nd-md px-1 text-left transition-colors duration-nd-fast hover:bg-nd-fg/[.05]"
        >
          <MemberAvatar
            name={currentMember?.name ?? user?.email ?? "?"}
            color={currentMember?.color ?? "#64748b"}
            avatar={currentMember?.avatar}
            className="h-8 w-8 shrink-0 text-sm"
          />
          <span className={cn("min-w-0 flex-1", fade(!collapsed))}>
            <span className="block truncate text-nd-body font-semibold text-nd-fg">
              {currentMember?.name ?? "미연결 계정"}
            </span>
            <span className="block truncate text-nd-caption text-nd-fg-3">
              {currentMember ? "NEANDER" : user?.email}
            </span>
          </span>
        </button>
        <Menu
          open={userOpen}
          onClose={() => setUserOpen(false)}
          anchorRef={userRef}
          placement="top-start"
          ariaLabel="사용자 메뉴"
          matchWidth={!collapsed}
          items={[
            { type: "label", key: "who", label: user?.email ?? "" },
            { key: "store", label: "AC'SCENT ERP", icon: Store, onSelect: () => { window.open(`${ACSCENT_ERP_ORIGIN}/`, "_blank", "noopener"); } },
            { key: "store-admin", label: "AC'SCENT ERP 관리자", icon: ShieldCheck, onSelect: () => { window.open(`${ACSCENT_ERP_ORIGIN}${ADMIN_LOGIN_PATH}`, "_blank", "noopener"); } },
            { type: "separator", key: "s1" },
            { key: "logout", label: "로그아웃", icon: LogOut, danger: true, onSelect: () => void logout() },
          ]}
        />
      </div>
    </div>
  );
}

/**
 * 여닫기 버튼 — 사이드바 오른쪽 변 한가운데에 반쯤 걸친 동그라미.
 * 화살표 하나가 방향을 돌린다 (펼침 ‹ 접기 · 접힘 › 펼치기).
 */
function EdgeToggle({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const label = collapsed ? "사이드바 펼치기" : "사이드바 접기";
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={label}
      title={label}
      aria-expanded={!collapsed}
      className="absolute right-0 top-1/2 flex h-6 w-6 -translate-y-1/2 translate-x-1/2 items-center justify-center rounded-full border border-nd-border bg-nd-content text-nd-fg-3 shadow-nd-pop transition-colors duration-nd-fast ease-nd hover:bg-nd-accent-soft hover:text-nd-accent-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nd-accent/40"
    >
      <span
        className={cn("flex transition-transform ease-nd", collapsed && "rotate-180")}
        style={{ transitionDuration: `${SIDEBAR_MS}ms` }}
      >
        <Icon icon={ChevronLeft} size={14} />
      </span>
    </button>
  );
}

/**
 * 접힌 사이드바 엿보기 — 커서를 올리면 잠깐 펼친다.
 * 자리(aside 폭)는 접힘 그대로 두고 유리판만 넓혀 본문 위에 덮는다 — 본문은
 * 밀리지 않는다. 지나가던 커서에 튀어나오지 않게 조금 기다렸다 열고, 판
 * 밖으로 살짝 빗나가도 바로 닫히지 않게 조금 기다렸다 닫는다.
 */
const PEEK_OPEN_MS = 150;
const PEEK_CLOSE_MS = 200;

export function Sidebar() {
  const { isMobile, collapsed, sidebarReady, toggleCollapsed, drawerOpen, setDrawerOpen } = useShell();

  // 저장된 접힘을 읽어 그린 다음 프레임부터 폭 전환을 켠다 —
  // 그러지 않으면 새로고침할 때마다 펼침 → 접힘으로 한 번 움직인다.
  const [animate, setAnimate] = useState(false);
  useEffect(() => {
    if (!sidebarReady) return;
    const id = requestAnimationFrame(() => setAnimate(true));
    return () => cancelAnimationFrame(id);
  }, [sidebarReady]);

  const asideRef = useRef<HTMLElement>(null);
  const [hovered, setHovered] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const hoverTimer = useRef<number | undefined>(undefined);
  // 메뉴는 포탈로 뜬다 — React 의 onPointerLeave 는 포탈을 자식으로 쳐서 메뉴를
  // 닫은 뒤에 떠나도 모를 수 있다. 실제 DOM 기준으로 들고 나는 것을 본다.
  useEffect(() => {
    const el = asideRef.current;
    if (!el) return;
    const later = (v: boolean, ms: number) => {
      window.clearTimeout(hoverTimer.current);
      hoverTimer.current = window.setTimeout(() => setHovered(v), ms);
    };
    // 터치는 누르는 순간 이동한다 — 펼칠 틈이 없으니 마우스만
    const enter = (e: PointerEvent) => { if (e.pointerType === "mouse") later(true, PEEK_OPEN_MS); };
    const leave = () => later(false, PEEK_CLOSE_MS);
    el.addEventListener("pointerenter", enter);
    el.addEventListener("pointerleave", leave);
    return () => {
      el.removeEventListener("pointerenter", enter);
      el.removeEventListener("pointerleave", leave);
      window.clearTimeout(hoverTimer.current);
    };
  }, [isMobile]);
  // 메뉴가 열려 있는 동안은 커서가 메뉴로 나가도 접지 않는다
  const peek = collapsed && (hovered || menuOpen);
  const onToggle = () => {
    // 접으려고 누른 사람 앞에서 도로 펼치지 않는다 — 한 번 나갔다 와야 다시 엿본다
    window.clearTimeout(hoverTimer.current);
    setHovered(false);
    toggleCollapsed();
  };

  if (isMobile) {
    return (
      <Sheet open={drawerOpen} onClose={() => setDrawerOpen(false)} side="left" width={288} ariaLabel="메뉴" hideClose>
        <SidebarContent onNavigate={() => setDrawerOpen(false)} />
      </Sheet>
    );
  }

  return (
    <aside
      ref={asideRef}
      data-nd-sidebar
      data-nd-peek={peek || undefined}
      // z-nd-sidebar — 변에 걸친 동그라미 반쪽과 엿보는 판이 본문 밑에 깔리지 않게
      className={cn(
        "sticky top-0 z-nd-sidebar hidden h-screen shrink-0 self-start py-3 pl-3 md:block",
        animate && "transition-[width] ease-nd",
      )}
      style={{
        width: `calc(${collapsed ? "var(--nd-sidebar-w-collapsed)" : "var(--nd-sidebar-w)"} + 12px)`,
        transitionDuration: animate ? `${SIDEBAR_MS}ms` : undefined,
      }}
    >
      {/* 판 + 동그라미. 엿볼 때는 이 상자만 넓어져 aside 밖(본문 위)으로 넘친다 —
          동그라미도 판 가장자리를 따라가서, 누르면 그 자리에서 펼침으로 고정된다 */}
      <div
        className={cn("relative h-full", animate && "transition-[width] ease-nd")}
        style={{
          width: collapsed && !peek ? "var(--nd-sidebar-w-collapsed)" : "var(--nd-sidebar-w)",
          transitionDuration: animate ? `${SIDEBAR_MS}ms` : undefined,
        }}
      >
        {/* 덮을 때는 짙은 유리 + 뜬 그림자 — 본문 위에 올라왔다는 게 보이게 */}
        <div
          className={cn(
            "h-full overflow-hidden rounded-nd-xl transition-[background-color,box-shadow] duration-nd ease-nd",
            peek ? "nd-glass-strong" : "nd-glass",
          )}
        >
          <SidebarContent collapsed={collapsed && !peek} onMenuOpenChange={setMenuOpen} />
        </div>
        {/* 유리판은 글자를 자르느라 overflow-hidden — 동그라미는 그 밖에 둔다 */}
        <EdgeToggle collapsed={collapsed} onToggle={onToggle} />
      </div>
    </aside>
  );
}
