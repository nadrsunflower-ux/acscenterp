// ============================================================
//  탐색 구성 — 전역 ERP 메뉴 · 재무 워크스페이스 메뉴 · 경로 설명
// ------------------------------------------------------------
//  사이드바(데스크톱·드로어)와 상단 브레드크럼이 같은 표를 본다.
//  재무 아래(/neander/finance/*)에서는 사이드바 내용이 재무 그룹으로
//  바뀌고 "전체 ERP" 로 돌아가는 길이 붙는다 (승인 목업 기준).
// ============================================================
import type { LucideIcon } from "lucide-react";
import {
  CalendarCheck,
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
  Rocket,
  ScrollText,
  Send,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";

/** 사이드바 배지 키 — 값은 ShellContext.badges 에서 온다 */
export type BadgeKey = "requests" | "messenger" | "finance-review";

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

export const FINANCE_NAV: NavGroup[] = [
  {
    label: "재무",
    items: [
      { href: "/neander/finance", label: "대시보드", icon: ChartNoAxesColumn, exact: true },
      { href: "/neander/finance/ledger", label: "거래 원장", icon: ScrollText },
      { href: "/neander/finance/review", label: "검토 대기함", icon: Inbox, badge: "finance-review" },
      { href: "/neander/finance/card", label: "카드 기록", icon: CreditCard },
    ],
  },
  {
    label: "분석 및 관리",
    items: [
      { href: "/neander/finance/reports", label: "리포트", icon: ChartColumn },
      { href: "/neander/finance/projects", label: "프로젝트", icon: FolderOpen },
      { href: "/neander/finance/close", label: "월 마감", icon: CalendarCheck },
    ],
  },
  {
    label: "데이터",
    items: [
      { href: "/neander/finance/import", label: "엑셀 임포트", icon: Download },
      { href: "/neander/finance/master", label: "마스터", icon: Database },
    ],
  },
];

/** 개발 허브 하위 탭 — 브레드크럼용 (탭 자체는 dev/layout 이 그린다) */
const DEV_TABS: { href: string; label: string; exact?: boolean }[] = [
  { href: "/neander/dev", label: "한눈에", exact: true },
  { href: "/neander/dev/board", label: "작업 보드" },
  { href: "/neander/dev/timeline", label: "진행 소식" },
  { href: "/neander/dev/features", label: "프로젝트" },
];

export const isFinancePath = (pathname: string) => pathname.startsWith("/neander/finance");

export function isActive(item: { href: string; exact?: boolean }, pathname: string): boolean {
  return item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(item.href + "/");
}

/** 현재 경로를 "모듈 / 화면" 으로 — 상단 브레드크럼 */
export function describePath(pathname: string): { module?: { label: string; href: string }; page: string } {
  if (isFinancePath(pathname)) {
    const items = FINANCE_NAV.flatMap((g) => g.items);
    const hit = items.filter((i) => isActive(i, pathname)).sort((a, b) => b.href.length - a.href.length)[0];
    return { module: { label: "재무", href: "/neander/finance" }, page: hit?.label ?? "재무" };
  }
  if (pathname.startsWith("/neander/dev")) {
    const hit = DEV_TABS.filter((t) => isActive(t, pathname)).sort((a, b) => b.href.length - a.href.length)[0];
    return { module: { label: "개발", href: "/neander/dev" }, page: hit?.label ?? "개발" };
  }
  const items = GLOBAL_NAV.flatMap((g) => g.items);
  const hit = items.filter((i) => isActive(i, pathname)).sort((a, b) => b.href.length - a.href.length)[0];
  return { page: hit?.label ?? "NEANDER ERP" };
}
