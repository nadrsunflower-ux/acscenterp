// ============================================================
//  표 — 안정적인 불투명 표면, 텍스트 왼쪽 · 숫자 오른쪽(tabular)
// ------------------------------------------------------------
//  데이터 영역은 유리가 아니다. 좁은 화면에서는 카드로 바꾸지 않고
//  TableScroll 안에서 가로로 스크롤한다 (열 비교를 잃지 않게).
//  기존 표들은 JSX 로 직접 짜여 있어, 데이터 주도 컴포넌트가 아니라
//  같은 톤을 내는 원소(Th/Td/…)를 제공한다.
// ============================================================
import type { HTMLAttributes, ReactNode, TdHTMLAttributes, ThHTMLAttributes } from "react";
import { cn } from "./cn";

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
      className={cn("nd-scroll w-full overflow-x-auto", maxHeight !== undefined && "overflow-y-auto", className)}
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
