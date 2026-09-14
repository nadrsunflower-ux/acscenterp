"use client";

// ============================================================
//  ChartValues — 차트 아래 「월별 수치 보기」 펼침 표
// ------------------------------------------------------------
//  차트는 hover 로만 값을 주면 안 된다 (HIG Accessibility · 터치에는
//  hover 가 없다). 같은 데이터를 표로 펼쳐, 키보드·화면 낭독기·터치
//  어디서든 정확한 숫자에 닿게 한다. 표는 차트와 **같은 배열**을 받아
//  두 숫자가 어긋날 수 없다.
// ============================================================
import { useId, useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "./cn";
import { Icon } from "./icon";
import { Table, TableScroll, Td, Th, TotalRow, Tr } from "./table";

export interface ChartValueColumn {
  key: string;
  label: ReactNode;
  /** 계열 점 색 — 차트 범례와 같은 색 */
  color?: string;
}

export interface ChartValueRow {
  key: string;
  /** 행 머리 (예: 2026년 7월) */
  label: ReactNode;
  values: Record<string, number | null | undefined>;
}

const defaultFormat = (v: number) => {
  const abs = Math.abs(Math.round(v)).toLocaleString("ko-KR");
  return v < 0 ? `△${abs}` : abs;
};

export function ChartValues({
  columns,
  rows,
  label = "월별 수치 보기",
  hideLabel = "월별 수치 닫기",
  format = defaultFormat,
  /** 마지막에 합계 행을 붙인다 */
  total = false,
  totalLabel = "합계",
  /** 표 위 한 줄 주석 (예: 단위: 원) */
  note,
  rowHeader = "월",
  className,
  defaultOpen = false,
}: {
  columns: ChartValueColumn[];
  rows: ChartValueRow[];
  label?: string;
  hideLabel?: string;
  format?: (v: number) => string;
  total?: boolean;
  totalLabel?: string;
  note?: ReactNode;
  rowHeader?: ReactNode;
  className?: string;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  const sums = total
    ? columns.map((c) => rows.reduce((s, r) => s + (r.values[c.key] ?? 0), 0))
    : [];
  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={id}
        className="inline-flex h-7 items-center gap-1 rounded-full px-2 text-nd-caption font-medium text-nd-accent-strong transition-colors duration-nd-fast hover:bg-nd-accent-soft"
      >
        {open ? hideLabel : label}
        <Icon
          icon={ChevronRight}
          size={14}
          className={cn("transition-transform duration-nd-fast", open && "rotate-90")}
        />
      </button>
      <div id={id} hidden={!open} className="mt-2">
        {note && <p className="mb-1.5 text-nd-caption text-nd-fg-3">{note}</p>}
        <TableScroll className="rounded-nd-md border border-nd-line">
          <Table dense minWidth={Math.max(360, 120 + columns.length * 120)}>
            <thead>
              <tr>
                <Th className="pl-3">{rowHeader}</Th>
                {columns.map((c) => (
                  <Th key={c.key} align="right" className="last:pr-3">
                    <span className="inline-flex items-center gap-1.5">
                      {c.color && (
                        <span aria-hidden className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: c.color }} />
                      )}
                      {c.label}
                    </span>
                  </Th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Tr key={r.key} hover={false}>
                  <Td className="nd-num pl-3 text-nd-fg-2">{r.label}</Td>
                  {columns.map((c) => {
                    const v = r.values[c.key];
                    return (
                      <Td key={c.key} num className={cn("last:pr-3", v != null && v < 0 && "text-nd-danger-text")}>
                        {v == null ? <span className="text-nd-fg-4">—</span> : format(v)}
                      </Td>
                    );
                  })}
                </Tr>
              ))}
            </tbody>
            {total && rows.length > 0 && (
              <tfoot>
                <TotalRow>
                  <Td className="pl-3">{totalLabel}</Td>
                  {columns.map((c, i) => (
                    <Td key={c.key} num className={cn("last:pr-3", sums[i] < 0 && "text-nd-danger-text")}>
                      {format(sums[i])}
                    </Td>
                  ))}
                </TotalRow>
              </tfoot>
            )}
          </Table>
        </TableScroll>
      </div>
    </div>
  );
}
