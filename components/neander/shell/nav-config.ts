// ============================================================
//  탐색 구성 — 전역 ERP 메뉴 · 재무 워크스페이스 메뉴 · 경로 설명
// ------------------------------------------------------------
//  사이드바(데스크톱·드로어)와 상단 브레드크럼이 같은 표를 본다.
//  재무·매출 아래에서는 사이드바 내용이 그 워크스페이스 그룹으로 바뀌고
//  "전체 ERP" 로 돌아가는 길이 붙는다 (승인 목업 기준).
//
//  워크스페이스가 둘이 되면서 분기를 WORKSPACES 표 하나로 모았다 —
//  Sidebar 가 if (finance) 로 갈라지면 세 번째가 생길 때 또 갈라진다.
// ============================================================
import type { LucideIcon } from "lucide-react";
import {
  Boxes,
  CalendarCheck,
  CalendarPlus,
  CalendarDays,
  ChartColumn,
  ChartNoAxesColumn,
  CreditCard,
  Database,
  Download,
  FileText,
  FolderOpen,
  Inbox,
  LayoutDashboard,
  Link2,
  ListChecks,
  MessageCircle,
  Package,
  RefreshCw,
  Rocket,
  Scale,
  ScrollText,
  Send,
  Server,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";

/** 사이드바 배지 키 — 값은 ShellContext.badges 에서 온다 */
export type BadgeKey = "requests" | "messenger" | "finance-review" | "sales-review";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** 정확히 일치할 때만 활성 (섹션 홈) */
  exact?: boolean;
  badge?: BadgeKey;
}

export interface NavGroup {
  label?: string;
  items: NavItem[];
}

export const GLOBAL_NAV: NavGroup[] = [
  {
    label: "업무",
    items: [
      { href: "/neander", label: "대시보드", icon: LayoutDashboard, exact: true },
      { href: "/neander/tasks", label: "일일업무", icon: ListChecks },
      { href: "/neander/requests", label: "업무요청", icon: Send, badge: "requests" },
      { href: "/neander/schedule", label: "스케줄", icon: CalendarDays },
    ],
  },
  {
    label: "협업",
    items: [
      { href: "/neander/dev", label: "개발", icon: Rocket },
      { href: "/neander/messenger", label: "메신저", icon: MessageCircle, badge: "messenger" },
      { href: "/neander/meetings", label: "회의록", icon: FileText },
      { href: "/neander/shortcuts", label: "바로가기", icon: Link2 },
    ],
  },
  {
    label: "경영",
    items: [
      { href: "/neander/sales", label: "매출", icon: TrendingUp },
      { href: "/neander/finance", label: "재무", icon: Wallet },
    ],
  },
  {
    label: "조직",
    items: [{ href: "/neander/members", label: "팀원", icon: Users }],
  },
];

/**
 * 재무 메뉴도 매출처럼 **한 달을 닫는 순서**로 읽힌다.
 *
 *   데이터 : 엑셀 임포트 → 검토 대기함 → 월 마감   (이 달에 하는 일)
 *   재무   : 대시보드 · 거래 원장 · 카드 기록       (그래서 나온 결과)
 */
export const FINANCE_NAV: NavGroup[] = [
  {
    label: "재무",
    items: [
      { href: "/neander/finance", label: "대시보드", icon: ChartNoAxesColumn, exact: true },
      { href: "/neander/finance/ledger", label: "거래 원장", icon: ScrollText },
      { href: "/neander/finance/card", label: "카드 기록", icon: CreditCard },
    ],
  },
  {
    label: "분석 및 관리",
    items: [
      { href: "/neander/finance/reports", label: "리포트", icon: ChartColumn },
      { href: "/neander/finance/projects", label: "프로젝트", icon: FolderOpen },
    ],
  },
  {
    label: "데이터",
    items: [
      { href: "/neander/finance/import", label: "엑셀 임포트", icon: Download },
      { href: "/neander/finance/review", label: "검토 대기함", icon: Inbox, badge: "finance-review" },
      { href: "/neander/finance/close", label: "월 마감", icon: CalendarCheck },
      { href: "/neander/finance/master", label: "마스터", icon: Database },
    ],
  },
];

/**
 * 매출 메뉴는 **한 달을 닫는 순서**로 읽힌다.
 *
 *   데이터 : 매출 적재 → 이벤트 입력 → 검토 대기함   (이 달에 하는 일)
 *   매출   : AC'SCENT 대시보드 · SMOAT 대시보드            (그래서 나온 결과)
 *
 * 검토 대기함이 위쪽 「매출」에 있을 때는 적재·이벤트와 떨어져 있어서,
 * 매달 하는 세 단계가 메뉴에서 이어지지 않았다. 재무와 자리가 달라지지만
 * 재무의 검토는 상시로 쌓이고 매출의 검토는 적재 직후에만 생긴다.
 */
export const SALES_NAV: NavGroup[] = [
  {
    label: "매출",
    items: [
      { href: "/neander/sales", label: "AC'SCENT 대시보드", icon: ChartNoAxesColumn, exact: true },
      // SMOAT 은 향수 매장과 성격이 달라 매장 축에 끼우지 않았다. 같은
      // 워크스페이스 안의 **다른 사업**이라 메뉴에서도 옆자리에 둔다
      // (lib/neander/smoat/types.ts 주석).
      { href: "/neander/sales/smoat", label: "SMOAT 대시보드", icon: Server },
    ],
  },
  {
    label: "분석 및 관리",
    items: [
      { href: "/neander/sales/reports", label: "리포트", icon: ChartColumn },
      { href: "/neander/sales/products", label: "상품 수익성", icon: Boxes },
      { href: "/neander/sales/catalog", label: "상품 관리", icon: Package },
      { href: "/neander/sales/reconcile", label: "장부 대사", icon: Scale },
    ],
  },
  {
    label: "데이터",
    items: [
      { href: "/neander/sales/import", label: "매출 적재", icon: Download },
      { href: "/neander/sales/sync", label: "자동 동기화", icon: RefreshCw },
      { href: "/neander/sales/event-entry", label: "이벤트 입력", icon: CalendarPlus },
      { href: "/neander/sales/review", label: "검토 대기함", icon: Inbox, badge: "sales-review" },
      { href: "/neander/sales/master", label: "마스터", icon: Database },
    ],
  },
];

/**
 * 워크스페이스 — 전역 ERP 밖으로 나가는 모듈들.
 * 사이드바·브레드크럼·스위처가 모두 이 표 하나를 본다.
 */
export interface Workspace {
  key: string;
  label: string;
  href: string;
  /** 스위처에 쓰는 아이콘 */
  icon: LucideIcon;
  nav: NavGroup[];
}

export const WORKSPACES: Workspace[] = [
  { key: "finance", label: "재무", href: "/neander/finance", icon: Wallet, nav: FINANCE_NAV },
  { key: "sales", label: "매출", href: "/neander/sales", icon: TrendingUp, nav: SALES_NAV },
];

/** 이 경로가 어느 워크스페이스인가 (아니면 undefined) */
export function workspaceOf(pathname: string): Workspace | undefined {
  return WORKSPACES.find((w) => pathname === w.href || pathname.startsWith(w.href + "/"));
}

/** 개발 허브 하위 탭 — 브레드크럼용 (탭 자체는 dev/layout 이 그린다) */
const DEV_TABS: { href: string; label: string; exact?: boolean }[] = [
  { href: "/neander/dev", label: "한눈에", exact: true },
  { href: "/neander/dev/board", label: "작업 보드" },
  { href: "/neander/dev/timeline", label: "진행 소식" },
  { href: "/neander/dev/features", label: "프로젝트" },
];

export const isFinancePath = (pathname: string) => pathname.startsWith("/neander/finance");
export const isSalesPath = (pathname: string) => pathname.startsWith("/neander/sales");

export function isActive(item: { href: string; exact?: boolean }, pathname: string): boolean {
  return item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(item.href + "/");
}

/** 현재 경로를 "모듈 / 화면" 으로 — 상단 브레드크럼 */
export function describePath(pathname: string): { module?: { label: string; href: string }; page: string } {
  const ws = workspaceOf(pathname);
  if (ws) {
    const items = ws.nav.flatMap((g) => g.items);
    const hit = items.filter((i) => isActive(i, pathname)).sort((a, b) => b.href.length - a.href.length)[0];
    return { module: { label: ws.label, href: ws.href }, page: hit?.label ?? ws.label };
  }
  if (pathname.startsWith("/neander/dev")) {
    const hit = DEV_TABS.filter((t) => isActive(t, pathname)).sort((a, b) => b.href.length - a.href.length)[0];
    return { module: { label: "개발", href: "/neander/dev" }, page: hit?.label ?? "개발" };
  }
  const items = GLOBAL_NAV.flatMap((g) => g.items);
  const hit = items.filter((i) => isActive(i, pathname)).sort((a, b) => b.href.length - a.href.length)[0];
  return { page: hit?.label ?? "NEANDER ERP" };
}
