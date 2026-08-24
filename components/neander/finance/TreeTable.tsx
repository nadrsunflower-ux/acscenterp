"use client";

// ============================================================
//  계정 트리 테이블 — 지출상세·사업부 공용
// ------------------------------------------------------------
//  대 ▸ 중 ▸ 소 3단을 한 표에 접었다 폈다 한다. 엑셀 지출상세 시트는
//  362행을 통째로 펼쳐 놓고 스크롤로 찾았는데, 여기서는 대분류만 보고
//  필요한 가지만 연다.
//
//  숫자 칸은 전부 원장 드릴다운 링크다 — "이 숫자가 어디서 왔나"에
//  답하는 것이 이 화면의 존재 이유다.
// ============================================================

import { Fragment, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { cn } from "@/components/neander/ui";
import { Money } from "./ui";
import { isEmptyValue, type ReportValue, type TreeNode } from "@/lib/neander/finance/report";

export interface TreeColumn {
  key: string;
  label: string;
  /** 숫자 열. 노드도 함께 받으므로 트리 밖의 값(예산 등)도 끌어올 수 있다 */
  value?: (v: ReportValue, node: TreeNode) => number;
  /**
   * 셀을 직접 그린다 (입력기·배지 등). 주면 value 대신 이걸 쓰고
   * 드릴다운 링크도 걸지 않는다 — 편집 칸이 링크면 누를 수 없다.
   */
  render?: (node: TreeNode) => ReactNode;
  /** 합계 행 셀을 직접 그린다 (render 를 쓰는 열은 이것도 주는 게 좋다) */
  renderTotal?: () => ReactNode;
  /** 머리글 밑 작은 설명 */
  hint?: string;
}

export function TreeTable({
  roots,
  total,
  columns,
  showEmpty,
  hrefFor,
  summaryFor,
  totalLabel = "합계",
  emptyMessage = "표시할 계정이 없습니다.",
  filterRoot,
}: {
  roots: TreeNode[];
  total: ReportValue;
  columns: TreeColumn[];
  /** 0원 계정도 보여줄지 */
  showEmpty: boolean;
  hrefFor: (node: TreeNode) => string;
  /** 대분류를 골라 보여준다 (예산 화면은 지출 계정만) */
  filterRoot?: (node: TreeNode) => boolean;
  /** 행 옆 한 줄 요약 (엑셀 「비고」 자리) */
  summaryFor?: (node: TreeNode) => string;
  totalLabel?: string;
  emptyMessage?: string;
}) {
  // 기본은 대분류만 펼침 — 중분류까지 보이고 소분류는 접혀 있다
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [manual, setManual] = useState(false);

  /** 예산처럼 트리 밖의 값이 있는 화면은 "비어 있음" 판정을 열이 정한다 */
  const nodeEmpty = (node: TreeNode) =>
    isEmptyValue(node.value) &&
    columns.every((c) => (c.value ? c.value(node.value, node) === 0 : true));

  const visible = useMemo(() => {
    const base = filterRoot ? roots.filter(filterRoot) : roots;
    return showEmpty ? base : base.filter((r) => !nodeEmpty(r));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roots, showEmpty, filterRoot, columns]);

  const keep = (node: TreeNode) => showEmpty || !nodeEmpty(node);

  /** 기본 상태: level 0 은 펼침, level 1 은 접힘 */
  const isOpen = (node: TreeNode) =>
    manual ? !collapsed.has(node.path) : node.level === 0;

  const toggle = (node: TreeNode) => {
    setCollapsed((prev) => {
      const next = new Set(manual ? prev : defaultCollapsed(roots));
      if (next.has(node.path)) next.delete(node.path);
      else next.add(node.path);
      return next;
    });
    setManual(true);
  };

  const expandAll = () => {
    setCollapsed(new Set());
    setManual(true);
  };
  const collapseAll = () => {
    setCollapsed(new Set(allPaths(roots)));
    setManual(true);
  };

  if (visible.length === 0) {
    return <p className="px-4 py-10 text-center text-sm text-zinc-400">{emptyMessage}</p>;
  }

  const rows: ReactNode[] = [];
  const push = (node: TreeNode) => {
    const open = isOpen(node);
    const kids = node.children.filter(keep);
    rows.push(
      <Row
        key={node.path}
        node={node}
        columns={columns}
        open={open}
        hasKids={kids.length > 0}
        onToggle={() => toggle(node)}
        href={hrefFor(node)}
        summary={summaryFor?.(node)}
      />,
    );
    if (open) kids.forEach(push);
  };
  visible.forEach(push);

  return (
    <div>
      <div className="flex items-center justify-end gap-1 border-b border-zinc-200 px-3 py-1.5">
        <button
          type="button"
          onClick={expandAll}
          className="rounded-md px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800"
        >
          모두 펼치기
        </button>
        <button
          type="button"
          onClick={collapseAll}
          className="rounded-md px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800"
        >
          모두 접기
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] text-sm">
          <thead>
            <tr className="border-b border-zinc-200 bg-zinc-50 text-xs text-zinc-500">
              <th className="px-3 py-2 text-left font-medium">계정</th>
              {summaryFor && <th className="px-3 py-2 text-left font-medium">내역</th>}
              {columns.map((c) => (
                <th key={c.key} className="whitespace-nowrap px-3 py-2 text-right font-medium">
                  {c.label}
                  {c.hint && <span className="ml-1 font-normal text-zinc-400">{c.hint}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">{rows}</tbody>
          <tfoot>
            <tr className="border-t-2 border-zinc-300 bg-zinc-50 font-semibold">
              <td className="px-3 py-2">{totalLabel}</td>
              {summaryFor && <td />}
              {columns.map((c) => (
                <td key={c.key} className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                  {c.renderTotal ? (
                    c.renderTotal()
                  ) : c.key === "count" ? (
                    total.count.toLocaleString("ko-KR")
                  ) : c.value ? (
                    <Money value={c.value(total, { value: total } as TreeNode)} unit={false} />
                  ) : null}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function Row({
  node,
  columns,
  open,
  hasKids,
  onToggle,
  href,
  summary,
}: {
  node: TreeNode;
  columns: TreeColumn[];
  open: boolean;
  hasKids: boolean;
  onToggle: () => void;
  href: string;
  summary?: string;
}) {
  const empty = isEmptyValue(node.value);
  return (
    <tr
      className={cn(
        "hover:bg-indigo-50/40",
        node.level === 0 && "bg-zinc-50/60 font-semibold text-zinc-900",
        node.level === 1 && "text-zinc-800",
        node.level === 2 && "text-zinc-600",
        empty && "text-zinc-300",
      )}
    >
      <td className="px-3 py-1.5">
        <div
          className="flex items-center gap-1"
          style={{ paddingLeft: node.level * 16 }}
        >
          {hasKids ? (
            <button
              type="button"
              onClick={onToggle}
              aria-expanded={open}
              aria-label={open ? `${node.label} 접기` : `${node.label} 펼치기`}
              className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-[9px] text-zinc-400 hover:bg-zinc-200 hover:text-zinc-700"
            >
              {open ? "▼" : "▶"}
            </button>
          ) : (
            <span className="h-4 w-4 shrink-0" />
          )}
          <span className="truncate">{node.label}</span>
        </div>
      </td>
      {summary !== undefined && (
        <td className="max-w-[280px] truncate px-3 py-1.5 text-xs text-zinc-400" title={summary}>
          {summary}
        </td>
      )}
      {columns.map((c) => {
        if (c.render) {
          return (
            <td key={c.key} className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">
              {c.render(node)}
            </td>
          );
        }
        const v = c.key === "count" ? node.value.count : (c.value?.(node.value, node) ?? 0);
        const zero = v === 0;
        return (
          <td key={c.key} className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">
            {zero ? (
              <span className="text-zinc-300">—</span>
            ) : (
              <Link
                href={href}
                className="rounded px-1 hover:bg-indigo-100 hover:underline"
                title="이 숫자를 이루는 거래 보기"
              >
                {c.key === "count" ? v.toLocaleString("ko-KR") : <Money value={v} unit={false} />}
              </Link>
            )}
          </td>
        );
      })}
    </tr>
  );
}

// ---- 펼침 상태 도우미 -------------------------------------------

function allPaths(nodes: TreeNode[]): string[] {
  const out: string[] = [];
  const walk = (n: TreeNode) => {
    if (n.children.length) {
      out.push(n.path);
      n.children.forEach(walk);
    }
  };
  nodes.forEach(walk);
  return out;
}

/** 기본 상태(대분류만 펼침)를 집합으로 — 사용자가 처음 토글할 때의 기준점 */
function defaultCollapsed(nodes: TreeNode[]): Set<string> {
  const out = new Set<string>();
  nodes.forEach((major) =>
    major.children.forEach((mid) => {
      if (mid.children.length) out.add(mid.path);
    }),
  );
  return out;
}
