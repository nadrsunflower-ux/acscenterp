"use client";

// ============================================================
//  HoverDetail — 숫자에 커서를 두면 그 숫자의 내역이 말풍선으로
// ------------------------------------------------------------
//  자금 일보의 입금 · 출금 · 잔액 · 카드 사용액이 쓴다. 리포트의 금액 미리보기
//  (NodePreview 의 TxDrill)와 같은 손맛으로 맞췄다 — 잠깐 두면 열리고, 칸에서
//  말풍선으로 커서를 옮기는 사이에는 닫히지 않는다.
//  TxDrill 은 장부 거래(FinTransaction)만 받지만, 자금 일보는 문자 · 장부 · 카드 승인 ·
//  통장 잔액이 섞이므로 줄을 한 모양(DetailLine)으로 받는다.
//
//  누르면 말풍선이 고정된다(터치 · 키보드). 바깥을 누르거나 Esc 로 닫는다.
//  목록은 열 때만 만든다 — 칸마다 미리 걸러 두면 표가 무거워진다.
// ============================================================

import { useEffect, useRef, useState, type ReactNode } from "react";
import { TriangleAlert } from "lucide-react";
import { cn, Icon, Money, Popover } from "@/components/neander/ui";
import { sumLines, type DetailLine } from "@/lib/neander/finance/daily-cash-detail";

const OPEN_DELAY = 350;
const CLOSE_DELAY = 150;
/** 말풍선에 그리는 줄 수 상한 — 넘으면 아래 「통장 거래 내역」 표에서 */
const LIMIT = 200;

export interface HoverDetailProps {
  /** 말풍선 제목 (예: 신한입금 4248 · 입금) */
  title: string;
  /** 제목 아래 한 마디 (예: 11/10(화) · 문자 기준) */
  subtitle?: string;
  /** 이 숫자를 이루는 줄 — 열 때만 부른다 */
  lines: () => DetailLine[];
  /** 합계의 돈 방향 */
  flow?: "income" | "expense";
  /** 「합계 n건」 대신 쓸 말 (잔액 목록은 「n개 통장」) */
  countLabel?: (n: number) => string;
  /** 줄이 없을 때 */
  emptyText?: string;
  /** 맨 아래 작은 주석 */
  footnote?: string;
  className?: string;
  children: ReactNode;
}

export function HoverDetail({
  title,
  subtitle,
  lines,
  flow,
  countLabel = (n) => `합계 ${n.toLocaleString("ko-KR")}건`,
  emptyText = "이 숫자에 잡힌 내역이 없어요.",
  footnote,
  className,
  children,
}: HoverDetailProps) {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const pinned = useRef(false);
  const timer = useRef<number | null>(null);

  const clear = () => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
  };
  const show = () => {
    clear();
    timer.current = window.setTimeout(() => setOpen(true), OPEN_DELAY);
  };
  const hide = () => {
    clear();
    if (pinned.current) return;
    timer.current = window.setTimeout(() => setOpen(false), CLOSE_DELAY);
  };
  const close = () => {
    clear();
    pinned.current = false;
    setOpen(false);
  };
  useEffect(() => clear, []);

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onMouseEnter={show}
        onMouseLeave={hide}
        onClick={(e) => {
          e.stopPropagation();
          clear();
          pinned.current = true;
          setOpen(true);
        }}
        // 숫자 칸 정렬이 흔들리지 않게 안쪽 여백만큼 밖으로 당긴다
        className={cn(
          "-mx-1 cursor-pointer rounded-[6px] px-1 text-inherit decoration-dotted underline-offset-4 transition-colors duration-nd-fast hover:bg-nd-accent-soft hover:underline",
          open && "bg-nd-accent-soft",
          className,
        )}
      >
        {children}
      </button>
      <Popover
        open={open}
        onClose={close}
        anchorRef={anchorRef}
        placement="bottom-end"
        role="dialog"
        ariaLabel={`${title} 내역`}
        autoFocus={false}
        returnFocus={false}
        arrow
        unpadded
        className="w-[27rem] max-w-[calc(100vw-1rem)]"
      >
        <div onMouseEnter={clear} onMouseLeave={hide} className="flex max-h-[inherit] flex-col">
          {open && <DetailBody title={title} subtitle={subtitle} lines={lines()} flow={flow} countLabel={countLabel} emptyText={emptyText} footnote={footnote} />}
        </div>
      </Popover>
    </>
  );
}

function DetailBody({
  title,
  subtitle,
  lines,
  flow,
  countLabel,
  emptyText,
  footnote,
}: Required<Pick<HoverDetailProps, "title" | "countLabel" | "emptyText">> &
  Pick<HoverDetailProps, "subtitle" | "flow" | "footnote"> & { lines: DetailLine[] }) {
  const shown = lines.slice(0, LIMIT);
  const rest = lines.length - shown.length;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-nd-line px-4 pb-2.5 pt-3">
        <p className="truncate text-nd-body font-semibold text-nd-fg" title={title}>
          {title}
        </p>
        {subtitle && <p className="mt-0.5 text-nd-table text-nd-fg-3">{subtitle}</p>}
      </div>

      {shown.length === 0 ? (
        <p className="px-4 py-5 text-center text-nd-table text-nd-fg-3">{emptyText}</p>
      ) : (
        <ul className="nd-scroll max-h-[24rem] min-h-0 flex-1 overflow-y-auto overscroll-contain py-1">
          {shown.map((l) => (
            <li key={l.key} className="px-4 py-2">
              <div className="flex items-start gap-3">
                {l.when && <span className="nd-num shrink-0 whitespace-nowrap pt-px text-nd-table text-nd-fg-3">{l.when}</span>}
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-nd-body text-nd-fg" title={l.title}>
                      {l.title}
                    </span>
                    {l.tag && <span className="shrink-0 rounded-[4px] bg-nd-warning-soft px-1.5 text-nd-table text-nd-warning-text">{l.tag}</span>}
                  </span>
                  {l.sub && (
                    <span className="block truncate text-nd-table text-nd-fg-3" title={l.sub}>
                      {l.sub}
                    </span>
                  )}
                </span>
                <Money value={l.amount} unit={false} flow={l.flow} className="shrink-0 text-nd-body font-medium" />
              </div>
              {l.warn && (
                <p className="mt-1 flex items-start gap-1 text-nd-table text-nd-warning-text">
                  <Icon icon={TriangleAlert} size={14} className="mt-0.5 shrink-0" />
                  {l.warn}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      {lines.length > 0 && (
        <div className="flex shrink-0 items-baseline justify-between gap-3 border-t border-nd-line px-4 py-2.5 text-nd-body">
          <span className="text-nd-fg-2">{countLabel(lines.length)}</span>
          <Money value={sumLines(lines)} unit={false} flow={flow} className="font-semibold" />
        </div>
      )}
      {(rest > 0 || footnote) && (
        <p className={cn("shrink-0 px-4 pb-2.5 text-nd-table text-nd-fg-3", lines.length === 0 && "pt-2.5")}>
          {rest > 0 ? `위에는 최근 ${LIMIT}건만 — 나머지는 아래 표에서. ` : ""}
          {footnote ?? ""}
        </p>
      )}
    </div>
  );
}
