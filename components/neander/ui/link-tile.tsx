// ============================================================
//  LinkTile — 대시보드 아래 「더 보러 가는」 타일
// ------------------------------------------------------------
//  아이콘 + 제목 + 한 줄 설명 + ›. 진짜 라우트로만 연결한다 — 목업에
//  있어도 갈 곳이 없는 타일은 만들지 않는다. 재무 대시보드의 펼침
//  버튼(SummaryLink)과 같은 생김새라 두 화면이 한 벌로 읽힌다.
// ============================================================
import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "./cn";
import { Icon, type LucideIcon } from "./icon";

export function LinkTile({
  href,
  icon,
  title,
  sub,
  badge,
  className,
}: {
  href: string;
  icon: LucideIcon;
  title: ReactNode;
  sub?: ReactNode;
  /** 오른쪽 작은 상태 (예: 건수 배지) */
  badge?: ReactNode;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "nd-surface flex items-center gap-3 rounded-nd-lg p-4 text-left transition-colors duration-nd-fast hover:bg-nd-sunken",
        className,
      )}
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-nd-md bg-nd-sunken text-nd-fg-2">
        <Icon icon={icon} size={20} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-nd-body font-semibold text-nd-fg">{title}</span>
        {sub && <span className="block truncate text-nd-caption text-nd-fg-3">{sub}</span>}
      </span>
      {badge && <span className="shrink-0">{badge}</span>}
      <Icon icon={ChevronRight} size={16} className="shrink-0 text-nd-fg-4" />
    </Link>
  );
}
