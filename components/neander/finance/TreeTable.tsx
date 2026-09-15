"use client";

// ============================================================
//  계정 트리 테이블 — 지출상세·사업부·예산 공용
// ------------------------------------------------------------
//  대 ▸ 중 ▸ 소 3단을 한 표에 접었다 폈다 한다. 엑셀 지출상세 시트는
//  362행을 통째로 펼쳐 놓고 스크롤로 찾았는데, 여기서는 대분류만 보고
//  필요한 가지만 연다.
//
//  숫자 칸은 전부 원장 드릴다운 링크다 — "이 숫자가 어디서 왔나"에
//  답하는 것이 이 화면의 존재 이유다.
// ============================================================

import {
  useMemo,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import {
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
} from "lucide-react";
import {
  Button,
  cn,
  Icon,
  Money,
  Table,
  TableScroll,
  Td,
  Th,
  TotalRow,
  Tr,
} from "@/components/neander/ui";
import {
  isEmptyValue,
  type ReportValue,
  type TreeNode,
} from "@/lib/neander/finance/report";
import type { MoneyFlow } from "@/components/neander/ui";
import { nodeDrill, PreviewLink, TxDrill } from "./NodePreview";
import {
  DismissAccountButton,
  FlagDot,
  HighlightLegend,
  Marker,
  useAccountSpikes,
  useFlaggedCounts,
  type HighlightScope,
} from "./Anomaly";
import type { AccountSpike } from "@/lib/neander/finance/anomaly";

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
  /** 돈의 방향 — 숫자 글자색 (수입 초록·지출 빨강·순손익은 부호로) */
  flow?: MoneyFlow;
  /**
   * 미리보기·내역 창을 달지 (preview 가 켜진 표에서, 기본 true).
   * 트리 밖의 값이 섞인 열(남은 예산처럼)은 끈다 — 창 합계가 칸과 어긋난다.
   */
  drill?: boolean;
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
  preview = false,
  highlight,
}: {
  /**
   * 형광펜 — 이 달에 튄 지출 계정의 지출 열(flow="expense")을 칠한다.
   * scope 는 표가 좁힌 범위(사업부·사업장)와 같게 줘야 "그 안에서의 평소"와 비교된다.
   */
  highlight?: HighlightScope;
  /**
   * 숫자 칸에 마우스를 올리면 그 숫자를 이루는 거래를 미리 본다.
   * 열 값이 트리 거래에서 나오는 화면만 켠다 (예산처럼 밖의 값이면 판과 칸이 어긋난다).
   */
  preview?: boolean;
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

  const spikes = useAccountSpikes(highlight);
  const flaggedCounts = useFlaggedCounts(highlight);

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
    return <p className="px-4 py-10 text-center text-nd-body text-nd-fg-3">{emptyMessage}</p>;
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
        preview={preview}
        spike={spikes.get(node.path)}
        flaggedCount={flaggedCounts.get(node.path) ?? 0}
        month={highlight?.month}
      />,
    );
    if (open) kids.forEach(push);
  };
  visible.forEach(push);

  return (
    <div>
      <div className="flex items-center justify-end gap-1 border-b border-nd-line px-3 py-1.5">
        {highlight?.month && <HighlightLegend month={highlight.month} count={spikes.size} />}
        <Button variant="ghost" size="sm" icon={ChevronsUpDown} onClick={expandAll}>
          모두 펼치기
        </Button>
        <Button variant="ghost" size="sm" icon={ChevronsDownUp} onClick={collapseAll}>
          모두 접기
        </Button>
      </div>
      <TableScroll>
        <Table minWidth={860} dense>
          <thead>
            <tr>
              <Th>계정</Th>
              {summaryFor && <Th>내역</Th>}
              {columns.map((c) => (
                <Th key={c.key} align="right">
                  {c.label}
                  {c.hint && <span className="ml-1 font-normal text-nd-fg-3">{c.hint}</span>}
                </Th>
              ))}
            </tr>
          </thead>
          <tbody>{rows}</tbody>
          <tfoot>
            <TotalRow>
              <Td>{totalLabel}</Td>
              {summaryFor && <Td />}
              {columns.map((c) => (
                <Td key={c.key} num className="whitespace-nowrap">
                  {c.renderTotal ? (
                    c.renderTotal()
                  ) : (
                    <TotalCell column={c} total={total} roots={visible} label={totalLabel} preview={preview} />
                  )}
                </Td>
              ))}
            </TotalRow>
          </tfoot>
        </Table>
      </TableScroll>
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
  preview,
  spike,
  flaggedCount,
  month,
}: {
  /** 형광펜을 끌 달 (highlight.month) */
  month?: string;
  /** 이 계정 안의 튄 거래 건수 — 계정이 안 튀었을 때 줄에 점으로 */
  flaggedCount: number;
  node: TreeNode;
  columns: TreeColumn[];
  open: boolean;
  hasKids: boolean;
  onToggle: () => void;
  href: string;
  summary?: string;
  preview: boolean;
  /** 이 계정이 이 달에 튀었으면 — 지출 열에 형광펜 */
  spike?: AccountSpike;
}) {
  const empty = isEmptyValue(node.value);
  return (
    <Tr
      className={cn(
        "group",
        node.level === 0 && "bg-nd-sunken/60 font-semibold text-nd-fg",
        node.level === 1 && "text-nd-fg",
        node.level === 2 && "text-nd-fg-2",
        empty && "text-nd-fg-4",
      )}
    >
      <Td>
        <div className="flex items-center gap-1" style={{ paddingLeft: node.level * 16 }}>
          {hasKids ? (
            <button
              type="button"
              onClick={onToggle}
              aria-expanded={open}
              aria-label={open ? `${node.label} 접기` : `${node.label} 펼치기`}
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px] text-nd-fg-3 transition-colors duration-nd-fast hover:bg-nd-fg/[.08] hover:text-nd-fg"
            >
              <Icon icon={open ? ChevronDown : ChevronRight} size={14} />
            </button>
          ) : (
            <span className="h-5 w-5 shrink-0" />
          )}
          <span className="truncate" title={node.label}>{node.label}</span>
          {/* 계정이 튀었으면 칸의 형광펜이 말해 준다. 안 튀었는데 안에 튄 거래가 있으면 점으로 —
              없으면 표에서 출발해서는 그 거래를 못 찾는다 */}
          {!spike && flaggedCount > 0 && <FlagDot count={flaggedCount} />}
          {spike && month && <DismissAccountButton month={month} path={node.path} label={node.label} />}
        </div>
      </Td>
      {summary !== undefined && (
        <Td className="max-w-[280px] truncate text-nd-caption text-nd-fg-3" title={summary}>
          {summary}
        </Td>
      )}
      {columns.map((c) => {
        if (c.render) {
          return (
            <Td key={c.key} num className="whitespace-nowrap">
              {c.render(node)}
            </Td>
          );
        }
        const v = c.key === "count" ? node.value.count : (c.value?.(node.value, node) ?? 0);
        const zero = v === 0;
        const money = c.key === "count" ? v.toLocaleString("ko-KR") : <Money value={v} unit={false} flow={c.flow} />;
        const shown =
          spike && c.flow === "expense" && !zero ? <Marker reason={`${node.label} · ${spike.reason}`}>{money}</Marker> : money;
        return (
          <Td key={c.key} num className="whitespace-nowrap">
            {zero ? (
              <span className="text-nd-fg-4">—</span>
            ) : preview && c.drill !== false ? (
              <PreviewLink
                node={node}
                colKey={c.key}
                colLabel={c.label}
                href={href}
                spike={c.flow === "expense" ? spike : undefined}
              >
                {shown}
              </PreviewLink>
            ) : (
              <Link
                href={href}
                className="rounded-[6px] px-1 transition-colors duration-nd-fast hover:bg-nd-accent-soft hover:underline"
                title="이 숫자를 이루는 거래 보기"
              >
                {shown}
              </Link>
            )}
          </Td>
        );
      })}
    </Tr>
  );
}

/** 합계 줄 한 칸 — 보이는 대분류 전체의 거래로 연다 */
function TotalCell({
  column: c,
  total,
  roots,
  label,
  preview,
}: {
  column: TreeColumn;
  total: ReportValue;
  roots: TreeNode[];
  label: string;
  preview: boolean;
}) {
  if (!c.value && c.key !== "count") return null;
  const v = c.key === "count" ? total.count : c.value!(total, { value: total } as TreeNode);
  const shown = c.key === "count" ? v.toLocaleString("ko-KR") : <Money value={v} unit={false} flow={c.flow} />;
  if (!preview || c.drill === false || v === 0) return <>{shown}</>;
  return (
    <TxDrill title={label} subtitle={c.label} {...nodeDrill({ children: roots, rows: [] }, c.key)}>
      {shown}
    </TxDrill>
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
