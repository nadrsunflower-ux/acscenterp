// ============================================================
//  표 — 안정적인 불투명 표면, 텍스트 왼쪽 · 숫자 오른쪽(tabular)
// ------------------------------------------------------------
//  데이터 영역은 유리가 아니다. 좁은 화면에서는 카드로 바꾸지 않고
//  TableScroll 안에서 가로로 스크롤한다 (열 비교를 잃지 않게).
//  기존 표들은 JSX 로 직접 짜여 있어, 데이터 주도 컴포넌트가 아니라
//  같은 톤을 내는 원소(Th/Td/…)를 제공한다.
// ============================================================
import type { HTMLAttributes, ReactNode, TdHTMLAttributes, ThHTMLAttributes } from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { cn } from "./cn";
import { Icon } from "./icon";

/** 가로 스크롤 컨테이너. minWidth 는 표가 찌그러지지 않는 하한 */
export function TableScroll({
  children,
  className,
  maxHeight,
}: {
  children: ReactNode;
  className?: string;
  /** 세로도 스크롤 (머리글 sticky 와 함께) */
  maxHeight?: number | string;
}) {
  return (
    <div
      // relative — 표 안의 sr-only(절대 위치) 가 기준 상자를 못 찾아 화면 밖 좌표에 놓이면
      // 페이지가 통째로 옆으로 밀린다 (2026-09-21 매출 대시보드에서 474px 밀림을 발견)
      className={cn("nd-scroll relative w-full overflow-x-auto", maxHeight !== undefined && "overflow-y-auto", className)}
      style={maxHeight !== undefined ? { maxHeight } : undefined}
    >
      {children}
    </div>
  );
}

export function Table({
  children,
  className,
  minWidth,
  dense = false,
  ...rest
}: HTMLAttributes<HTMLTableElement> & { minWidth?: number; dense?: boolean }) {
  return (
    <table
      className={cn("w-full border-collapse text-nd-table text-nd-fg", dense && "[&_td]:py-1.5 [&_th]:py-1.5", className)}
      style={minWidth ? { minWidth } : undefined}
      {...rest}
    >
      {children}
    </table>
  );
}

type Align = "left" | "right" | "center";
const alignCls: Record<Align, string> = { left: "text-left", right: "text-right", center: "text-center" };

export function Th({
  align = "left",
  sticky,
  className,
  children,
  ...rest
}: ThHTMLAttributes<HTMLTableCellElement> & {
  align?: Align;
  /** 스크롤해도 붙어 있을 방향. right 는 금액처럼 잘리면 안 되는 열에 */
  sticky?: "left" | "top" | "both" | "right" | "top-right";
}) {
  return (
    <th
      scope="col"
      className={cn(
        "whitespace-nowrap border-y border-nd-line bg-nd-sunken px-3 py-2 text-nd-caption font-medium text-nd-fg-2",
        alignCls[align],
        sticky === "left" && "sticky left-0 z-10",
        sticky === "top" && "sticky top-0 z-10",
        sticky === "both" && "sticky left-0 top-0 z-20",
        sticky === "right" && "sticky right-0 z-10",
        sticky === "top-right" && "sticky right-0 top-0 z-20",
        className,
      )}
      {...rest}
    >
      {children}
    </th>
  );
}

// ---- 정렬 머리글 -------------------------------------------------

export type SortDir = "asc" | "desc";
export interface SortState<K extends string = string> {
  key: K;
  dir: SortDir;
}

/**
 * 누르면 그 열로 정렬하는 머리글. 같은 열을 다시 누르면 방향이 뒤집힌다.
 *
 * 처음 누를 때의 방향: 숫자 열(오른쪽 정렬)은 **큰 값부터**, 글자 열은
 * 가나다순부터 — 금액 열을 누르는 사람은 대개 「제일 큰 게 뭐냐」를 묻는다.
 * 정렬 상태는 색만이 아니라 화살표와 aria-sort 로도 알린다.
 *
 * 재무 시트(ColumnMenu)는 필터·열 숨기기까지 있는 무거운 판이라 따로 두고,
 * 일반 표는 이것 하나로 맞춘다.
 */
export function SortTh<K extends string>({
  sortKey,
  sort,
  onSort,
  firstDir,
  align = "left",
  sticky,
  className,
  children,
}: {
  sortKey: K;
  sort: SortState<K> | null;
  onSort: (next: SortState<K>) => void;
  /** 처음 누를 때 방향 — 없으면 숫자 열 desc · 글자 열 asc */
  firstDir?: SortDir;
  align?: Align;
  sticky?: "left" | "top" | "both" | "right" | "top-right";
  className?: string;
  children: ReactNode;
}) {
  const active = sort?.key === sortKey;
  const dir = active ? sort!.dir : undefined;
  const next: SortDir = active ? (dir === "asc" ? "desc" : "asc") : (firstDir ?? (align === "right" ? "desc" : "asc"));
  return (
    <Th
      align={align}
      sticky={sticky}
      className={className}
      aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        onClick={() => onSort({ key: sortKey, dir: next })}
        className={cn(
          "group inline-flex items-center gap-1 rounded-[4px] outline-none transition-colors duration-nd-fast hover:text-nd-fg focus-visible:ring-2 focus-visible:ring-nd-accent/50",
          // 숫자 열은 글자 끝을 숫자 끝에 맞추려고 화살표를 왼쪽에 둔다
          align === "right" && "flex-row-reverse",
          active && "text-nd-fg",
        )}
      >
        <span>{children}</span>
        <Icon
          icon={!active ? ChevronsUpDown : dir === "asc" ? ArrowUp : ArrowDown}
          size={12}
          className={cn(!active && "opacity-35 group-hover:opacity-70")}
        />
      </button>
    </Th>
  );
}

export function Td({
  align = "left",
  num = false,
  muted = false,
  sticky,
  className,
  children,
  ...rest
}: TdHTMLAttributes<HTMLTableCellElement> & {
  align?: Align;
  /** 숫자 — 오른쪽 정렬 + tabular */
  num?: boolean;
  muted?: boolean;
  /** 스크롤해도 붙어 있을 방향. right 는 금액처럼 잘리면 안 되는 열에 */
  sticky?: "left" | "right";
}) {
  return (
    <td
      className={cn(
        "px-3 py-2 align-middle",
        num ? "nd-num text-right" : alignCls[align],
        muted && "text-nd-fg-3",
        sticky === "left" && "sticky left-0 z-10 bg-nd-content",
        sticky === "right" && "sticky right-0 z-10 bg-nd-content",
        className,
      )}
      {...rest}
    >
      {children}
    </td>
  );
}

export function Tr({
  className,
  hover = true,
  selected = false,
  children,
  ...rest
}: HTMLAttributes<HTMLTableRowElement> & { hover?: boolean; selected?: boolean }) {
  return (
    <tr
      className={cn(
        "border-b border-nd-line last:border-b-0",
        hover && "transition-colors duration-nd-fast hover:bg-nd-fg/[.03]",
        selected && "bg-nd-accent-soft/60",
        className,
      )}
      {...rest}
    >
      {children}
    </tr>
  );
}

/** 합계 행 — tfoot 안에서 */
export function TotalRow({ className, children, ...rest }: HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr className={cn("border-t-2 border-nd-strong bg-nd-sunken font-semibold [&_td]:py-2.5", className)} {...rest}>
      {children}
    </tr>
  );
}

/** "단위: 원" 같은 표 각주 */
export function TableNote({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("text-nd-caption text-nd-fg-3", className)}>{children}</p>;
}
