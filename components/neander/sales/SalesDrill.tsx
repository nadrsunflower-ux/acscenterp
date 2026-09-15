"use client";

// ============================================================
//  매출 금액 드릴 — 올리면 미리보기, 누르면 전체 내역 창
// ------------------------------------------------------------
//  재무 리포트의 TxDrill(components/neander/finance/NodePreview.tsx)과 같은
//  손놀림이다. 두 모듈을 번갈아 보는 사람이 "숫자에 커서 → 요약, 누르면
//  전체"를 한 번만 배우면 되게.
//
//  매출 숫자는 두 종류라 내용도 두 가지다:
//    lines  — 판매 줄의 합 (매출·확정·미확정·재료비·수수료·입금 예상)
//             → 판매 줄 목록. amountOf 가 줄마다 이 숫자에 더한 값을 준다
//    detail — 계산으로 만든 숫자 (인건비·준비물·고정비·공헌이익·영업이익)
//             → pnl-detail 의 내역(항목·산식). 손익 막대 창과 같은 표를 쓴다
//
//  ⚠️ 창 합계는 칸의 숫자와 원 단위로 같아야 한다. 줄 목록은 buildPnl 과
//     같은 거름(확정만·이 달·이 매장)으로, 내역은 pnlSegmentDetail 로 만든다.
// ============================================================

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, ExternalLink } from "lucide-react";
import {
  Button,
  cn,
  Dialog,
  Icon,
  Money,
  Popover,
  SearchInput,
  SegmentedControl,
  Table,
  TableScroll,
  Td,
  Th,
  TotalRow,
  Tr,
  type MoneyFlow,
} from "@/components/neander/ui";
import { productIndex } from "@/lib/neander/sales/aggregate";
import type { PnlDetail } from "@/lib/neander/sales/pnl-detail";
import { routeLabel, storeLabel, type SalesLine } from "@/lib/neander/sales/types";
import { useSales } from "./SalesProvider";
import { blocksOf, DetailBlock, flowOf, isFormula } from "./PnlBar";

const OPEN_DELAY = 350;
const CLOSE_DELAY = 150;
// 판 안에서 스크롤로 전부 본다 — 상한은 커서만 스쳐도 수백 줄을 그리지 않게
const LIMIT = 300;

interface Common {
  /** 창·판 제목 (예: 와우 · 재료비) */
  title: string;
  /** 제목 아래 한 마디 (예: 2026년 8월) */
  subtitle?: string;
  /** 창 아래 버튼으로 갈 곳 (예: 검토 대기함) */
  href?: string;
  hrefLabel?: string;
  className?: string;
  /** 어두운 발표 화면(Deck) 위 — 밝은 hover 바탕 대신 옅은 흰 바탕 */
  tone?: "dark";
  children: ReactNode;
}

export type SalesDrillProps = Common &
  (
    | {
        /** 이 숫자를 이루는 판매 줄 — 열 때만 부른다 */
        lines: () => SalesLine[];
        /** 줄 → 이 숫자에 더한 값. 기본은 결제 금액 */
        amountOf?: (l: SalesLine) => number;
        /** 돈 방향 — 줄 금액·합계 색 */
        flow?: MoneyFlow;
        detail?: never;
      }
    | {
        /** 계산으로 만든 숫자의 내역 — 열 때만 부른다 */
        detail: () => PnlDetail;
        lines?: never;
        amountOf?: never;
        flow?: never;
      }
  );

export function SalesDrill(props: SalesDrillProps) {
  const { title, className, children, tone } = props;
  const anchorRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const timer = useRef<number | null>(null);

  const clear = () => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
  };
  const show = () => {
    clear();
    if (detailOpen) return;
    timer.current = window.setTimeout(() => setOpen(true), OPEN_DELAY);
  };
  // 칸에서 판으로 커서를 옮기는 사이에 닫히지 않게 조금 기다린다
  const hide = () => {
    clear();
    timer.current = window.setTimeout(() => setOpen(false), CLOSE_DELAY);
  };
  useEffect(() => clear, []);

  const openDetail = () => {
    clear();
    setOpen(false);
    setDetailOpen(true);
  };

  const onClick = (e: ReactMouseEvent) => {
    // 줄 전체가 눌리는 표 안에서도 줄 선택이 같이 일어나지 않게
    e.stopPropagation();
    openDetail();
  };

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        onMouseEnter={show}
        onMouseLeave={hide}
        onClick={onClick}
        className={cn(
          "rounded-[6px] px-1 text-right transition-colors duration-nd-fast hover:underline",
          tone === "dark"
            ? "-mx-1 cursor-pointer decoration-dotted underline-offset-4 hover:bg-white/10"
            : "hover:bg-nd-accent-soft",
          className,
        )}
      >
        {children}
      </button>
      <Popover
        open={open}
        onClose={() => {
          clear();
          setOpen(false);
        }}
        anchorRef={anchorRef}
        placement="bottom-end"
        role="dialog"
        ariaLabel={`${title} 미리보기`}
        autoFocus={false}
        returnFocus={false}
        unpadded
        className="w-[26rem] max-w-[calc(100vw-1rem)]"
      >
        {/* 판 높이는 화면 남은 공간에 맞춰 줄어든다 — 목록만 스크롤하고 제목·합계·아래 줄은 고정 */}
        <div onMouseEnter={clear} onMouseLeave={hide} className="flex max-h-[inherit] flex-col">
          {open && <PreviewBody {...props} onMore={openDetail} />}
        </div>
      </Popover>
      {detailOpen &&
        (props.detail ? (
          <BreakdownDialog {...props} detail={props.detail} onClose={() => setDetailOpen(false)} />
        ) : (
          <LinesDialog {...props} lines={props.lines!} onClose={() => setDetailOpen(false)} />
        ))}
    </>
  );
}

// ---- 공통 조각 --------------------------------------------------

/** 닫힘 애니메이션이 끝난 뒤에 부모가 치우도록 open 을 따로 둔다 */
function useClosing(onClose: () => void) {
  const [open, setOpen] = useState(true);
  useEffect(() => {
    if (open) return;
    const t = window.setTimeout(onClose, 160);
    return () => window.clearTimeout(t);
  }, [open, onClose]);
  return [open, () => setOpen(false)] as const;
}

function Tag({ label, tone = "warning" }: { label: string; tone?: "warning" | "neutral" }) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-[4px] px-1 text-nd-micro",
        tone === "warning" ? "bg-nd-warning-soft text-nd-warning-text" : "bg-nd-fg/[.07] text-nd-fg-2",
      )}
    >
      {label}
    </span>
  );
}

/** 판매 줄 한 줄을 사람 말로 — 상품 이름(없으면 원본 내역) · 매장 · 경로 · 이벤트 */
function useLineText() {
  const { products, events } = useSales();
  return useMemo(() => {
    const idx = productIndex(products);
    const eventName = new Map(events.map((e) => [e.id, e.name]));
    return {
      name: (l: SalesLine) => {
        const p = l.productId ? idx.get(l.productId) : undefined;
        return p ? `${p.name} ${p.option}`.trim() : l.raw || "(내역 없음)";
      },
      where: (l: SalesLine) =>
        [storeLabel(l.store), routeLabel(l.route), l.eventId ? eventName.get(l.eventId) : undefined]
          .filter(Boolean)
          .join(" · "),
      tag: (l: SalesLine) =>
        l.status === "needs_review" ? "미확정" : l.status === "manual" ? "직접입력" : undefined,
    };
  }, [products, events]);
}

const detailNum = (value: number, minus?: boolean) =>
  `${minus ? "−" : ""}${Math.round(value).toLocaleString("ko-KR")}`;

function MoreButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full shrink-0 items-center justify-between border-t border-nd-line px-3.5 py-2 text-left text-nd-fg-2 transition-colors duration-nd-fast hover:bg-nd-fg/[.04] hover:text-nd-fg"
    >
      <span>{label}</span>
      <Icon icon={ArrowRight} size={14} />
    </button>
  );
}

// ---- 미리보기 판 ------------------------------------------------

function PreviewBody(props: SalesDrillProps & { onMore: () => void }) {
  const text = useLineText();
  const { title, subtitle, onMore } = props;

  if (props.detail) {
    const d = props.detail();
    const formula = isFormula(d);
    // 묶음이 있는 칸(인건비)은 묶음 소계만 — 나눠 보는 건 창에서
    const items = d.sections
      ? d.sections.map((s) => ({ key: s.key, label: s.title, value: s.total, minus: false, sub: s.basis }))
      : (formula ? d.rows : d.rows.slice(0, LIMIT)).map((r) => ({
          key: r.key,
          label: r.label,
          value: r.value,
          minus: r.sign === "minus",
          sub: r.sub,
        }));
    const rest = d.sections || formula ? 0 : d.rows.length - items.length;
    return (
      <div className="flex min-h-0 flex-1 flex-col text-nd-caption">
        <div className="shrink-0 border-b border-nd-line px-3.5 pb-2 pt-3">
          <p className="truncate text-nd-body font-semibold text-nd-fg" title={title}>
            {title}
          </p>
          <p className="mt-0.5 text-nd-fg-3">{[subtitle, d.basis].filter(Boolean).join(" · ")}</p>
        </div>
        {items.length === 0 ? (
          <p className="px-3.5 py-4 text-center text-nd-fg-3">이 달에는 내역이 없습니다.</p>
        ) : (
          <ul className="nd-scroll max-h-[26rem] min-h-0 flex-1 overflow-y-auto overscroll-contain py-1">
            {items.map((r) => (
              <li key={r.key} className="flex items-center gap-2.5 px-3.5 py-1.5">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-nd-fg">{r.label}</span>
                  {r.sub && <span className="block truncate text-nd-micro text-nd-fg-3">{r.sub}</span>}
                </span>
                <span className={cn("nd-num shrink-0", r.minus ? "text-nd-fg-2" : "text-nd-fg")}>
                  {detailNum(r.value, r.minus)}
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="flex shrink-0 items-center justify-between border-t border-nd-line px-3.5 py-1.5 font-semibold">
          <span className="text-nd-fg-2">{formula ? `= ${d.title}` : "합계"}</span>
          <Money value={Math.round(d.total)} unit={false} flow={flowOf(d)} />
        </div>
        <MoreButton label={rest > 0 ? `외 ${rest.toLocaleString("ko-KR")}개는 창에서 — 누르면 전체 내역` : "누르면 창에서 자세히"} onClick={onMore} />
      </div>
    );
  }

  const amountOf = props.amountOf ?? ((l: SalesLine) => l.amount);
  const rows = props.lines!();
  const shown = [...rows].sort((a, b) => Math.abs(amountOf(b)) - Math.abs(amountOf(a))).slice(0, LIMIT);
  const rest = rows.length - shown.length;
  return (
    <div className="flex min-h-0 flex-1 flex-col text-nd-caption">
      <div className="shrink-0 border-b border-nd-line px-3.5 pb-2 pt-3">
        <p className="truncate text-nd-body font-semibold text-nd-fg" title={title}>
          {title}
        </p>
        <p className="mt-0.5 text-nd-fg-3">
          {subtitle ? `${subtitle} · ` : ""}
          {rows.length.toLocaleString("ko-KR")}건 · 큰 금액 순
        </p>
      </div>
      {shown.length === 0 ? (
        <p className="px-3.5 py-4 text-center text-nd-fg-3">이 숫자에 잡힌 판매가 없습니다.</p>
      ) : (
        <ul className="nd-scroll max-h-[26rem] min-h-0 flex-1 overflow-y-auto overscroll-contain py-1">
          {shown.map((l) => {
            const tag = text.tag(l);
            return (
              <li key={l.id} className="flex items-center gap-2.5 px-3.5 py-1.5">
                <span className="nd-num w-10 shrink-0 text-nd-fg-3">{l.date.slice(5)}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-nd-fg" title={l.raw}>
                      {text.name(l)}
                    </span>
                    {l.qty > 1 && <span className="shrink-0 text-nd-fg-3">×{l.qty}</span>}
                    {tag && <Tag label={tag} tone={tag === "미확정" ? "warning" : "neutral"} />}
                  </span>
                  <span className="block truncate text-nd-micro text-nd-fg-3">{text.where(l)}</span>
                </span>
                <Money value={amountOf(l)} unit={false} flow={props.flow} className="shrink-0" />
              </li>
            );
          })}
        </ul>
      )}
      <MoreButton label={rest > 0 ? `외 ${rest.toLocaleString("ko-KR")}건은 창에서 — 누르면 전체 내역` : "누르면 창에서 자세히"} onClick={onMore} />
    </div>
  );
}

// ---- 창: 계산 내역 ----------------------------------------------

function BreakdownDialog({
  title,
  subtitle,
  href,
  hrefLabel,
  detail,
  onClose,
}: Common & { detail: () => PnlDetail; onClose: () => void }) {
  const router = useRouter();
  const [open, close] = useClosing(onClose);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const d = useMemo(() => detail(), []);
  return (
    <Dialog
      open={open}
      onClose={close}
      size="md"
      title={title}
      description={[subtitle, d.basis].filter(Boolean).join(" · ")}
      footer={
        <>
          {href && (
            <Button variant="secondary" size="sm" icon={ExternalLink} onClick={() => router.push(href)}>
              {hrefLabel ?? "자세히 보기"}
            </Button>
          )}
          <Button size="sm" onClick={close}>
            닫기
          </Button>
        </>
      }
    >
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <span className="text-nd-caption text-nd-fg-2">{isFormula(d) ? d.title : "합계"}</span>
        <span className="nd-num text-nd-section font-semibold text-nd-fg">
          <Money value={Math.round(d.total)} unit={false} flow={flowOf(d)} />원
        </span>
      </div>
      {blocksOf(d).map((b) => (
        <DetailBlock key={b.key} detail={d} block={b} titled={!!d.sections} />
      ))}
      {d.note && <p className="mt-3 text-nd-caption text-nd-fg-3">{d.note}</p>}
    </Dialog>
  );
}

// ---- 창: 판매 줄 ------------------------------------------------

type Sort = "amount" | "date";

function LinesDialog({
  title,
  subtitle,
  href,
  hrefLabel,
  lines,
  amountOf = (l) => l.amount,
  flow,
  onClose,
}: Common & {
  lines: () => SalesLine[];
  amountOf?: (l: SalesLine) => number;
  flow?: MoneyFlow;
  onClose: () => void;
}) {
  const router = useRouter();
  const text = useLineText();
  const [open, close] = useClosing(onClose);
  const [sort, setSort] = useState<Sort>("amount");
  const [query, setQuery] = useState("");

  // 창이 열린 동안 목록이 바뀌지 않게 처음 한 번만 부른다
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const all = useMemo(() => lines(), []);
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const hit = q
      ? all.filter((l) => [text.name(l), l.raw, l.memo, text.where(l)].some((s) => s?.toLowerCase().includes(q)))
      : all;
    return [...hit].sort(
      sort === "amount"
        ? (a, b) => Math.abs(amountOf(b)) - Math.abs(amountOf(a))
        : (a, b) => a.date.localeCompare(b.date),
    );
  }, [all, query, sort, amountOf, text]);
  const sum = rows.reduce((s, l) => s + amountOf(l), 0);
  const qty = rows.reduce((s, l) => s + (l.status === "needs_review" ? 0 : l.qty), 0);

  return (
    <Dialog
      open={open}
      onClose={close}
      size="xl"
      title={title}
      description={`${subtitle ? `${subtitle} · ` : ""}${all.length.toLocaleString("ko-KR")}건`}
      footer={
        <>
          <span className="mr-auto text-nd-caption text-nd-fg-3">
            {query ? `검색 결과 ${rows.length.toLocaleString("ko-KR")}건` : ""}
          </span>
          {href && (
            <Button variant="secondary" size="sm" icon={ExternalLink} onClick={() => router.push(href)}>
              {hrefLabel ?? "자세히 보기"}
            </Button>
          )}
          <Button size="sm" onClick={close}>
            닫기
          </Button>
        </>
      }
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <SearchInput
          value={query}
          onValueChange={setQuery}
          placeholder="상품·결제 내역·매장 검색"
          className="w-full sm:w-64"
        />
        <SegmentedControl<Sort>
          size="sm"
          ariaLabel="정렬"
          value={sort}
          onChange={setSort}
          options={[
            { value: "amount", label: "큰 금액 순" },
            { value: "date", label: "날짜 순" },
          ]}
        />
      </div>

      {rows.length === 0 ? (
        <p className="py-10 text-center text-nd-body text-nd-fg-3">
          {query ? "검색어에 맞는 판매가 없습니다." : "이 숫자에 잡힌 판매가 없습니다."}
        </p>
      ) : (
        <TableScroll className="rounded-nd-md border border-nd-line">
          <Table minWidth={760} dense>
            <thead>
              <tr>
                <Th>날짜</Th>
                <Th>상품 · 결제 내역</Th>
                <Th>매장 · 경로</Th>
                <Th align="right">수량</Th>
                <Th align="right">금액</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((l) => {
                const tag = text.tag(l);
                const name = text.name(l);
                return (
                  <Tr key={l.id}>
                    <Td className="nd-num whitespace-nowrap text-nd-fg-2">{l.date}</Td>
                    <Td className="max-w-[320px]">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate" title={name}>
                          {name}
                        </span>
                        {tag && <Tag label={tag} tone={tag === "미확정" ? "warning" : "neutral"} />}
                      </span>
                      {/* 상품으로 바뀐 줄도 원본 결제 내역이 판단의 근거라 함께 둔다 */}
                      {l.productId && l.raw && l.raw !== name && (
                        <span className="block truncate text-nd-micro text-nd-fg-3" title={l.raw}>
                          {l.raw}
                        </span>
                      )}
                    </Td>
                    <Td className="whitespace-nowrap text-nd-caption text-nd-fg-2">{text.where(l)}</Td>
                    <Td num className="text-nd-fg-2">
                      {l.status === "needs_review" ? "—" : l.qty.toLocaleString("ko-KR")}
                    </Td>
                    <Td num className="whitespace-nowrap">
                      <Money value={amountOf(l)} unit={false} flow={flow} />
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
            <tfoot>
              <TotalRow>
                <Td colSpan={3}>합계 {rows.length.toLocaleString("ko-KR")}건</Td>
                <Td num>{qty.toLocaleString("ko-KR")}</Td>
                <Td num className="whitespace-nowrap">
                  <Money value={sum} unit={false} flow={flow} />
                </Td>
              </TotalRow>
            </tfoot>
          </Table>
        </TableScroll>
      )}
    </Dialog>
  );
}
