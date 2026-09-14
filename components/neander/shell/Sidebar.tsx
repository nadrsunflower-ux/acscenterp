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
import { useRef, useState } from "react";
import { ChevronLeft, ChevronsUpDown, LayoutGrid, LogOut, PanelLeftClose, PanelLeftOpen, Store } from "lucide-react";
import { useAppData } from "@/components/neander/app-data";
import { useAuth } from "@/components/neander/auth";
import {
  BrandMark,
  ProductWordmark,
  cn,
  CountBadge,
  Icon,
  IconButton,
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
  if (compact) return <BrandMark />;
  return <ProductWordmark height={15} className="px-1" />;
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
        "relative flex h-9 items-center rounded-nd-md text-nd-body font-medium transition-colors duration-nd-fast ease-nd",
        collapsed ? "w-10 justify-center" : "gap-2.5 px-2.5",
        active ? "bg-nd-accent-soft text-nd-accent-strong" : "text-nd-fg-2 hover:bg-nd-fg/[.05] hover:text-nd-fg",
      )}
    >
      <Icon icon={item.icon} size={18} className={active ? "text-nd-accent" : "text-nd-fg-3"} />
      {!collapsed && <span className="min-w-0 flex-1 truncate">{item.label}</span>}
      {badge > 0 &&
        (collapsed ? (
          <span className="absolute -right-1.5 -top-1.5 scale-90">
            <CountBadge count={badge} tone={active ? "accent" : "danger"} label={`${item.label} ${badge}건`} />
          </span>
        ) : (
          <CountBadge count={badge} tone={active ? "accent" : "neutral"} label={`${item.label} ${badge}건`} />
        ))}
    </Link>
  );
  if (!collapsed) return row;
  return (
    <Tooltip label={badge > 0 ? `${item.label} · ${badge}건` : item.label} side="bottom">
      {row}
    </Tooltip>
  );
}

/** 사이드바 본문 — aside 와 드로어가 같이 쓴다 */
export function SidebarContent({
  collapsed = false,
  inDrawer = false,
  onNavigate,
}: {
  collapsed?: boolean;
  inDrawer?: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const workspace = workspaceOf(pathname);
  const groups = workspace ? workspace.nav : GLOBAL_NAV;
  const { badges, toggleCollapsed } = useShell();
  const { currentMember } = useAppData();
  const { user, logout } = useAuth();

  const wsRef = useRef<HTMLButtonElement>(null);
  const [wsOpen, setWsOpen] = useState(false);
  const userRef = useRef<HTMLButtonElement>(null);
  const [userOpen, setUserOpen] = useState(false);

  const workspaceLabel = workspace ? `${workspace.label} 워크스페이스` : "전체 ERP";
  const workspaceIcon = workspace ? workspace.icon : LayoutGrid;

  return (
    <div className={cn("flex h-full min-h-0 flex-col", collapsed ? "items-center px-3 py-3" : "px-3 py-3")}>
      {/* 로고 + 접기 */}
      <div className={cn("flex items-center", collapsed ? "mb-3 flex-col gap-2" : "mb-3 justify-between pl-1")}>
        <Link href="/neander" onClick={onNavigate} className="rounded-nd-md">
          <Wordmark compact={collapsed} />
        </Link>
        {!inDrawer && (
          <IconButton
            icon={collapsed ? PanelLeftOpen : PanelLeftClose}
            label={collapsed ? "사이드바 펼치기" : "사이드바 접기"}
            size="sm"
            onClick={toggleCollapsed}
            aria-expanded={!collapsed}
            className="text-nd-fg-3"
          />
        )}
      </div>

      {/* 워크스페이스 스위처 */}
      <button
        ref={wsRef}
        type="button"
        onClick={() => setWsOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={wsOpen}
        aria-label={collapsed ? `워크스페이스: ${workspaceLabel}` : undefined}
        className={cn(
          "flex items-center rounded-nd-md border border-nd-border bg-nd-content/70 text-nd-body font-medium text-nd-fg transition-colors duration-nd-fast hover:bg-nd-content",
          collapsed ? "h-10 w-10 justify-center" : "h-10 w-full gap-2.5 px-2.5",
        )}
      >
        <Icon icon={workspaceIcon} size={18} className="text-nd-fg-2" />
        {!collapsed && (
          <>
            <span className="min-w-0 flex-1 truncate text-left">{workspaceLabel}</span>
            <Icon icon={ChevronsUpDown} size={15} className="text-nd-fg-3" />
          </>
        )}
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
      {workspace &&
        (collapsed ? (
          <Tooltip label="전체 ERP" side="bottom">
            <Link
              href="/neander"
              onClick={onNavigate}
              className="mt-2 flex h-9 w-10 items-center justify-center rounded-nd-md text-nd-fg-2 hover:bg-nd-fg/[.05] hover:text-nd-fg"
              aria-label="전체 ERP 로"
            >
              <Icon icon={ChevronLeft} size={18} />
            </Link>
          </Tooltip>
        ) : (
          <Link
            href="/neander"
            onClick={onNavigate}
            className="mt-2 flex h-8 items-center gap-1 rounded-nd-md px-2 text-nd-caption font-medium text-nd-fg-2 hover:bg-nd-fg/[.05] hover:text-nd-fg"
          >
            <Icon icon={ChevronLeft} size={15} />
            전체 ERP
          </Link>
        ))}

      {/* 메뉴 — 화면이 낮으면 이 부분만 스크롤 */}
      <nav aria-label={workspace ? `${workspace.label} 메뉴` : "ERP 메뉴"} className="nd-scroll mt-1 min-h-0 flex-1 overflow-y-auto">
        {groups.map((g, gi) => (
          <div key={g.label ?? gi} className={cn(gi > 0 && (collapsed ? "mt-2 border-t border-nd-line pt-2" : "mt-3"))}>
            {g.label && !collapsed && (
              <div className="px-2.5 pb-1 pt-2 text-nd-caption font-medium text-nd-fg-3">{g.label}</div>
            )}
            <ul className={cn("flex flex-col gap-0.5", collapsed && "items-center")}>
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
      <div className={cn("mt-2 border-t border-nd-line pt-2", collapsed ? "flex justify-center" : "")}>
        <button
          ref={userRef}
          type="button"
          onClick={() => setUserOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={userOpen}
          aria-label={collapsed ? `${currentMember?.name ?? user?.email ?? "사용자"} 메뉴` : undefined}
          className={cn(
            "flex items-center rounded-nd-md text-left transition-colors duration-nd-fast hover:bg-nd-fg/[.05]",
            collapsed ? "h-10 w-10 justify-center" : "h-12 w-full gap-2.5 px-2",
          )}
        >
          <MemberAvatar
            name={currentMember?.name ?? user?.email ?? "?"}
            color={currentMember?.color ?? "#64748b"}
            avatar={currentMember?.avatar}
            className="h-8 w-8 text-sm"
          />
          {!collapsed && (
            <span className="min-w-0 flex-1">
              <span className="block truncate text-nd-body font-semibold text-nd-fg">
                {currentMember?.name ?? "미연결 계정"}
              </span>
              <span className="block truncate text-nd-caption text-nd-fg-3">
                {currentMember ? "NEANDER" : user?.email}
              </span>
            </span>
          )}
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
            { key: "store", label: "AC'SCENT 매장 사이트", icon: Store, onSelect: () => { window.location.assign("/"); } },
            { type: "separator", key: "s1" },
            { key: "logout", label: "로그아웃", icon: LogOut, danger: true, onSelect: () => void logout() },
          ]}
        />
      </div>
    </div>
  );
}

export function Sidebar() {
  const { isMobile, collapsed, drawerOpen, setDrawerOpen } = useShell();

  if (isMobile) {
    return (
      <Sheet open={drawerOpen} onClose={() => setDrawerOpen(false)} side="left" width={288} ariaLabel="메뉴" hideClose>
        <SidebarContent inDrawer onNavigate={() => setDrawerOpen(false)} />
      </Sheet>
    );
  }

  return (
    <aside
      data-nd-sidebar
      className="sticky top-0 hidden h-screen shrink-0 self-start py-3 pl-3 md:block"
      style={{ width: `calc(${collapsed ? "var(--nd-sidebar-w-collapsed)" : "var(--nd-sidebar-w)"} + 12px)` }}
    >
      <div className="nd-glass h-full rounded-nd-xl transition-[width] duration-nd ease-nd">
        <SidebarContent collapsed={collapsed} />
      </div>
    </aside>
  );
}
