"use client";

// ============================================================
//  금액 드릴다운 — 올리면 미리보기, 누르면 창으로 고정
// ------------------------------------------------------------
//  합계 숫자는 언제나 "왜 이만큼인지"를 묻게 만든다. 엑셀에서는 SUMIFS 를
//  뜯어야 알 수 있었고, 그래서 아무도 확인하지 않았다. 여기서는 두 단계다.
//
//    올리면 → 큰 것부터 몇 줄 (읽기 전용)
//    누르면 → 전체 내역 창 (스크롤 · 원장으로 이어짐)
//
//  ⚠️ 미리보기 판은 pointer-events:none 이다. 포인터가 판을 통과해 아래
//     숫자에 계속 닿아야 판이 꺼지지 않는다 — 판에 마우스가 얹히는 순간
//     숫자에서 벗어나 깜빡이는 문제를 이렇게 막는다. 그래서 미리보기 안에는
//     누를 것을 두지 않는다(누를 것은 전부 창에 있다).
//
//  표면은 불투명하다. 유리는 탐색·조작 레이어의 것이고, 이건 읽어야 하는
//  숫자판이다.
// ============================================================

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink, Table2 } from "lucide-react";
import {
  Badge,
  Button,
  Dialog,
  Icon,
  Portal,
  Table,
  TableScroll,
  Td,
  Th,
  TotalRow,
  Tr,
  cn,
  useAnchorPosition,
} from "@/components/neander/ui";
import { matrixDelta } from "@/lib/neander/finance/aggregate";
import type { FinTransaction } from "@/lib/neander/finance/types";
import { formatSigned } from "@/lib/neander/finance/types";
import { Money } from "./ui";

/** 올린 뒤 이만큼 지나야 뜬다 — 표를 훑고 지나갈 때 따라 뜨지 않도록 */
const HOVER_DELAY = 160;
/** 미리보기에 보여줄 줄 수 */
const PREVIEW_ROWS = 6;

const shortDate = (d: string) => (d?.length >= 10 ? `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}` : d);

/** 계정 3단 중 아래 두 단 — 대분류는 이미 행 제목이라 반복하지 않는다 */
const acctTail = (t: FinTransaction) => [t.acctMid, t.acctMinor].filter(Boolean).join(" › ");

export interface AmountBreakdownProps {
  /** 화면에 찍힌 합계 */
  value: number;
  /** 이 합계를 이루는 거래 */
  rows: FinTransaction[];
  /** 무엇의 합계인지 — 미리보기·창 제목 */
  title: string;
  /** 기준 설명 (예: `2026년 8월 · 환급 차감 반영`) */
  subtitle?: string;
  /** 원장에서 같은 조건으로 열기 */
  ledgerHref?: string;
  /** 숫자에 입힐 색 (히트맵 대비) */
  className?: string;
  /** 합계가 0 일 때 찍을 글자 */
  emptyText?: string;
  /**
   * 거래 → 이 합계에 더해진 값. 기본은 지출 기준(환급은 음수)이다.
   */
  amountOf?: (t: FinTransaction) => number;
}

export function AmountBreakdown({
  value,
  rows,
  title,
  subtitle,
  ledgerHref,
  className,
  emptyText = "—",
  amountOf = matrixDelta,
}: AmountBreakdownProps) {
  // 큰 것부터 — 호출부는 정렬하지 않은 배열을 그대로 넘겨도 된다
  const sorted = useMemo(() => [...rows].sort((a, b) => amountOf(b) - amountOf(a)), [rows, amountOf]);

  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const timer = useRef<number | null>(null);
  const [hover, setHover] = useState(false);
  const [open, setOpen] = useState(false);
  const pos = useAnchorPosition(btnRef, panelRef, hover, { placement: "bottom-start", offset: 8 });

  const clearTimer = () => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
  };
  const show = useCallback(() => {
    clearTimer();
    timer.current = window.setTimeout(() => setHover(true), HOVER_DELAY);
  }, []);
  const hide = useCallback(() => {
    clearTimer();
    setHover(false);
  }, []);
  useEffect(() => clearTimer, []);

  // 값이 0 이면 볼 내역도 없다 — 그냥 글자
  if (value === 0 && rows.length === 0) {
    return <span className="text-nd-fg-4">{emptyText}</span>;
  }

  const preview = sorted.slice(0, PREVIEW_ROWS);
  const rest = sorted.length - preview.length;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        onClick={() => {
          hide();
          setOpen(true);
        }}
        aria-haspopup="dialog"
        aria-label={`${title} ${formatSigned(value)}원, ${sorted.length}건. 세부 내역 열기`}
        className={cn(
          "nd-num -mx-1 w-[calc(100%+0.5rem)] rounded-[6px] px-1 py-0.5 text-right underline-offset-4 transition-colors duration-nd-fast hover:underline hover:decoration-dotted",
          className,
        )}
      >
        {value === 0 ? emptyText : formatSigned(value)}
      </button>

      {/* 미리보기 — 마우스를 받지 않는다 (위 주석 참고) */}
      {hover && (
        <Portal>
          <div
            ref={panelRef}
            data-nd-breakdown
            aria-hidden
            style={{ position: "fixed", top: pos.top, left: pos.left }}
            className="nd-surface pointer-events-none z-nd-popover w-[22rem] max-w-[calc(100vw-1rem)] rounded-nd-md p-3 shadow-nd-pop animate-in fade-in zoom-in-95 duration-nd-fast"
          >
            <p className="truncate text-nd-caption font-semibold text-nd-fg">{title}</p>
            {subtitle && <p className="mt-0.5 truncate text-nd-micro text-nd-fg-3">{subtitle}</p>}

            <ul className="mt-2 flex flex-col gap-1 border-t border-nd-line pt-2">
              {preview.map((t) => (
                <li key={t.id} className="flex items-baseline gap-2 text-nd-caption">
                  <span className="nd-num w-9 shrink-0 text-nd-fg-3">{shortDate(t.date)}</span>
                  <span className="min-w-0 flex-1 truncate text-nd-fg">{t.vendor || acctTail(t) || "(거래처 없음)"}</span>
                  <Money value={amountOf(t)} unit={false} className="shrink-0" />
                </li>
              ))}
            </ul>

            <div className="mt-2 flex items-baseline justify-between gap-2 border-t border-nd-line pt-2 text-nd-caption">
              <span className="text-nd-fg-3">
                {rest > 0
                  ? `외 ${rest.toLocaleString("ko-KR")}건 · 모두 ${sorted.length.toLocaleString("ko-KR")}건`
                  : `모두 ${sorted.length.toLocaleString("ko-KR")}건`}
              </span>
              <span className="font-semibold">
                <Money value={value} unit={false} />원
              </span>
            </div>
            <p className="mt-1.5 text-nd-micro text-nd-fg-3">누르면 전체 내역이 창으로 열립니다</p>
          </div>
        </Portal>
      )}

      <BreakdownDialog
        open={open}
        onClose={() => setOpen(false)}
        title={title}
        subtitle={subtitle}
        rows={sorted}
        value={value}
        ledgerHref={ledgerHref}
        amountOf={amountOf}
      />
    </>
  );
}

/** 전체 내역 창 — 큰 것부터, 원장으로 이어진다 */
function BreakdownDialog({
  open,
  onClose,
  title,
  subtitle,
  rows,
  value,
  ledgerHref,
  amountOf,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  rows: FinTransaction[];
  value: number;
  ledgerHref?: string;
  amountOf: (t: FinTransaction) => number;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="xl"
      title={title}
      description={
        <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          {subtitle && <span>{subtitle}</span>}
          <span className="nd-num">{rows.length.toLocaleString("ko-KR")}건</span>
          <span className="font-semibold text-nd-fg">
            합계 <Money value={value} unit={false} />원
          </span>
        </span>
      }
      bodyClassName="px-0 sm:px-0"
      footer={
        <>
          {ledgerHref && (
            <Link href={ledgerHref}>
              <Button variant="secondary" icon={ExternalLink}>
                원장에서 보기
              </Button>
            </Link>
          )}
          <Button onClick={onClose}>닫기</Button>
        </>
      }
    >
      {rows.length === 0 ? (
        <p className="px-5 py-8 text-center text-nd-body text-nd-fg-3 sm:px-6">이 조건에 해당하는 거래가 없습니다.</p>
      ) : (
        <TableScroll maxHeight="min(56vh, 32rem)">
          <Table minWidth={560}>
            <thead>
              <tr>
                <Th sticky="top" className="pl-5 sm:pl-6">거래일</Th>
                <Th sticky="top">거래처</Th>
                <Th sticky="top">계정</Th>
                <Th sticky="top">비고</Th>
                {/* 금액은 가로로 밀려도 늘 보여야 한다 */}
                <Th sticky="top-right" align="right" className="pr-5 shadow-[-8px_0_8px_-8px_rgba(15,23,42,0.18)] sm:pr-6">
                  금액
                </Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => {
                const memo = [t.acctNote, t.note].filter(Boolean).join(" · ");
                return (
                  <Tr key={t.id}>
                    <Td className="nd-num whitespace-nowrap pl-5 text-nd-fg-2 sm:pl-6">{t.date}</Td>
                    <Td>
                      <span className="flex items-center gap-1.5">
                        <span className="max-w-[11rem] truncate" title={t.vendor}>
                          {t.vendor || "—"}
                        </span>
                        {t.txType === "환급" && (
                          <Badge tone="info" size="sm">
                            환급
                          </Badge>
                        )}
                        {t.personalUse && (
                          <Badge tone="warning" size="sm">
                            개인사용
                          </Badge>
                        )}
                      </span>
                    </Td>
                    <Td className="text-nd-fg-2">
                      <span className="block max-w-[10rem] truncate" title={acctTail(t)}>
                        {acctTail(t) || "—"}
                      </span>
                    </Td>
                    <Td className="text-nd-fg-3">
                      <span className="block max-w-[13rem] truncate" title={memo}>
                        {memo || "—"}
                      </span>
                    </Td>
                    <Td num sticky="right" className="pr-5 font-medium shadow-[-8px_0_8px_-8px_rgba(15,23,42,0.18)] sm:pr-6">
                      <Money value={amountOf(t)} unit={false} />
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
            <tfoot>
              <TotalRow>
                <Td className="pl-5 sm:pl-6" colSpan={4}>
                  합계
                </Td>
                <Td num sticky="right" className="!bg-nd-sunken pr-5 shadow-[-8px_0_8px_-8px_rgba(15,23,42,0.18)] sm:pr-6">
                  <Money value={value} unit={false} />
                </Td>
              </TotalRow>
            </tfoot>
          </Table>
        </TableScroll>
      )}
      <p className="flex items-center gap-1.5 border-t border-nd-line px-5 pt-3 text-nd-caption text-nd-fg-3 sm:px-6">
        <Icon icon={Table2} size={14} />
        환급은 지출에서 차감되어 음수(△)로 표시됩니다 · 금액 큰 순
      </p>
    </Dialog>
  );
}
