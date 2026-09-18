"use client";

// ============================================================
//  SMOAT 금액 드릴 — 올리면 미리보기, 누르면 전체 내역 창
// ------------------------------------------------------------
//  매출의 SalesDrill(components/neander/sales/SalesDrill.tsx)과 **같은
//  손놀림**이다. 두 화면을 번갈아 보는 사람이 "숫자에 커서 → 요약, 누르면
//  전체"를 한 번만 배우면 되게. 여는 시간·닫는 시간·판 너비·「누르면 창에서
//  자세히」 줄까지 같은 값을 쓴다.
//
//  ⚠️ 부품을 그대로 쓰지 않고 새로 만든 이유: SalesDrill 은 판매 줄
//     (SalesLine)을 안다 — 상품 마스터로 이름을 찾고, 매장·경로·이벤트를
//     붙이고, 미확정·할인 뱃지를 단다. SMOAT 결제에는 그 축이 하나도 없다
//     (학원·팩·크레딧·결제수단이다). 한 부품에 두 도메인을 넣으면 "SMOAT
//     이면" 분기가 줄마다 생긴다 — 모듈을 가른 이유와 같다.
//
//  내용은 두 가지다:
//    rows   결제 줄의 합 (순매출·팩별·학원별·결제수단별·판 크레딧)
//           → 결제 목록. amountOf 가 줄마다 이 숫자에 더한 값을 준다
//    facts  계산으로 만든 숫자 (AI 원가·공헌이익)
//           → 근거가 된 값들. 사이트가 월 집계로만 주어 줄이 없다
//
//  ⚠️ 창 합계는 칸의 숫자와 원 단위로 같아야 한다 — 같은 거름·같은 amountOf
//     를 쓰는 닫힘(closure)을 넘겨받는다.
// ============================================================

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { ArrowRight } from "lucide-react";
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
import { smoatKindLabel, smoatPayMethodLabel, type SmoatSale } from "@/lib/neander/smoat/types";

const OPEN_DELAY = 350;
const CLOSE_DELAY = 150;
/** 판 안에서 스크롤로 전부 본다 — 상한은 커서만 스쳐도 수백 줄을 그리지 않게 */
const LIMIT = 300;

const won = (n: number) => Math.round(n).toLocaleString("ko-KR");

/** 이 숫자가 돈인가 크레딧인가 — 크레딧에 「원」을 붙이면 안 된다 */
export type SmoatDrillUnit = "won" | "credit";

/** 요약을 무엇으로 묶을까 */
export type SmoatDrillGroup = "pack" | "account" | "method";

const GROUP_LABEL: Record<SmoatDrillGroup, string> = {
  pack: "팩별 요약",
  account: "학원별 요약",
  method: "결제수단별 요약",
};

export interface SmoatFact {
  key: string;
  label: string;
  /** 이미 사람이 읽을 수 있게 만든 값 (「$98.5」·「1,372원/$」) */
  value: string;
  sub?: string;
  /** 합계 줄처럼 굵게 */
  strong?: boolean;
}

interface Common {
  /** 창·판 제목 (예: 2026년 9월 순매출) */
  title: string;
  /** 제목 아래 한 마디 (예: 2026년 9월) */
  subtitle?: string;
  className?: string;
  children: ReactNode;
}

export type SmoatDrillProps = Common &
  (
    | {
        /** 이 숫자를 이루는 결제 줄 — 열 때만 부른다 */
        rows: () => SmoatSale[];
        /** 줄 → 이 숫자에 더한 값. 기본은 순매출(환불 뺀 금액) */
        amountOf?: (s: SmoatSale) => number;
        flow?: MoneyFlow;
        unit?: SmoatDrillUnit;
        /** 맨 위에 묶음 요약 */
        group?: SmoatDrillGroup;
        facts?: never;
        note?: never;
      }
    | {
        /** 계산으로 만든 숫자의 근거 — 열 때만 부른다 */
        facts: () => SmoatFact[];
        /** 창 아래 한 문단 설명 */
        note?: string;
        flow?: MoneyFlow;
        unit?: SmoatDrillUnit;
        rows?: never;
        amountOf?: never;
        group?: never;
      }
  );

export function SmoatDrill(props: SmoatDrillProps) {
  const { title, className, children } = props;
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
          "rounded-[6px] px-1 text-right transition-colors duration-nd-fast hover:bg-nd-accent-soft hover:underline",
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
        {/* 판 높이는 화면 남은 공간에 맞춘다 — 목록만 스크롤하고 제목·합계·아래 줄은 고정 */}
        <div onMouseEnter={clear} onMouseLeave={hide} className="flex max-h-[inherit] flex-col">
          {open && <PreviewBody {...props} onMore={openDetail} />}
        </div>
      </Popover>
      {detailOpen &&
        (props.facts ? (
          <FactsDialog {...props} facts={props.facts} onClose={() => setDetailOpen(false)} />
        ) : (
          <RowsDialog {...props} rows={props.rows!} onClose={() => setDetailOpen(false)} />
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

function Tag({ label, tone = "neutral" }: { label: string; tone?: "warning" | "neutral" }) {
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

/** 금액이면 Money(색·부호 규칙), 크레딧이면 숫자 그대로 */
function Amount({
  value,
  unit,
  flow,
  className,
}: {
  value: number;
  unit: SmoatDrillUnit;
  flow?: MoneyFlow;
  className?: string;
}) {
  if (unit === "credit") {
    return <span className={cn("nd-num text-nd-fg", className)}>{won(value)}</span>;
  }
  return <Money value={value} unit={false} flow={flow} className={className} />;
}

/** 결제 한 줄을 사람 말로 */
const rowName = (s: SmoatSale) => s.accountName || smoatKindLabel(s.kind);
const rowWhat = (s: SmoatSale) =>
  [
    s.packLabel ?? (s.credits ? `${won(s.credits)} 크레딧` : undefined),
    s.payMethod ? smoatPayMethodLabel(s.payMethod) : undefined,
    s.kind === "deposit" ? smoatKindLabel(s.kind) : undefined,
  ]
    .filter(Boolean)
    .join(" · ");

interface GroupSum {
  key: string;
  name: string;
  count: number;
  amount: number;
  credits: number;
}

function summarize(rows: SmoatSale[], by: SmoatDrillGroup, amountOf: (s: SmoatSale) => number): GroupSum[] {
  const map = new Map<string, GroupSum>();
  for (const s of rows) {
    const name =
      by === "pack"
        ? (s.packLabel ?? (s.credits ? `${won(s.credits)} 크레딧` : "기타"))
        : by === "account"
          ? s.accountName || smoatKindLabel(s.kind)
          : s.payMethod
            ? smoatPayMethodLabel(s.payMethod)
            : "알 수 없음";
    const key = by === "account" ? s.accountId || name : name;
    const cur = map.get(key) ?? { key, name, count: 0, amount: 0, credits: 0 };
    cur.count += 1;
    cur.amount += amountOf(s);
    cur.credits += s.credits ?? 0;
    map.set(key, cur);
  }
  return [...map.values()].sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
}

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

function PreviewBody(props: SmoatDrillProps & { onMore: () => void }) {
  const { title, subtitle, onMore } = props;
  const unit = props.unit ?? "won";

  if (props.facts) {
    const items = props.facts();
    return (
      <div className="flex min-h-0 flex-1 flex-col text-nd-caption">
        <div className="shrink-0 border-b border-nd-line px-3.5 pb-2 pt-3">
          <p className="truncate text-nd-body font-semibold text-nd-fg" title={title}>
            {title}
          </p>
          {subtitle && <p className="mt-0.5 text-nd-fg-3">{subtitle}</p>}
        </div>
        <ul className="nd-scroll max-h-[26rem] min-h-0 flex-1 overflow-y-auto overscroll-contain py-1">
          {items.map((f) => (
            <li key={f.key} className="flex items-center gap-2.5 px-3.5 py-1.5">
              <span className="min-w-0 flex-1">
                <span className={cn("block truncate", f.strong ? "font-medium text-nd-fg" : "text-nd-fg")}>
                  {f.label}
                </span>
                {f.sub && <span className="block truncate text-nd-micro text-nd-fg-3">{f.sub}</span>}
              </span>
              <span className={cn("nd-num shrink-0", f.strong ? "font-semibold text-nd-fg" : "text-nd-fg-2")}>
                {f.value}
              </span>
            </li>
          ))}
        </ul>
        <MoreButton label="누르면 창에서 자세히" onClick={onMore} />
      </div>
    );
  }

  const amountOf = props.amountOf ?? ((s: SmoatSale) => s.amount);
  const rows = props.rows!();
  const shown = [...rows].sort((a, b) => Math.abs(amountOf(b)) - Math.abs(amountOf(a))).slice(0, LIMIT);
  const rest = rows.length - shown.length;
  const group = props.group ? summarize(rows, props.group, amountOf) : null;

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
        <p className="px-3.5 py-4 text-center text-nd-fg-3">이 숫자에 잡힌 결제가 없습니다.</p>
      ) : (
        <ul className="nd-scroll max-h-[26rem] min-h-0 flex-1 overflow-y-auto overscroll-contain py-1">
          {group && (
            <>
              <li className="px-3.5 pb-1 pt-1.5 text-nd-micro font-medium text-nd-fg-3">
                {GROUP_LABEL[props.group!]} · {group.length.toLocaleString("ko-KR")}가지
              </li>
              {group.map((g) => (
                <li key={g.key} className="flex items-center gap-2.5 px-3.5 py-1">
                  <span className="min-w-0 flex-1 truncate text-nd-fg">{g.name}</span>
                  <span className="nd-num shrink-0 text-nd-fg-3">{g.count}건</span>
                  <Amount value={g.amount} unit={unit} flow={props.flow} className="w-20 shrink-0 text-right font-medium" />
                </li>
              ))}
              <li className="mt-1.5 border-t border-nd-line px-3.5 pb-1 pt-2 text-nd-micro font-medium text-nd-fg-3">
                결제 줄
              </li>
            </>
          )}
          {shown.map((s) => (
            <li key={s.id} className="flex items-center gap-2.5 px-3.5 py-1.5">
              <span className="nd-num w-10 shrink-0 text-nd-fg-3">{s.date.slice(5)}</span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="truncate text-nd-fg">{rowName(s)}</span>
                  {s.refund > 0 && <Tag label="환불" tone="warning" />}
                </span>
                <span className="block truncate text-nd-micro text-nd-fg-3">{rowWhat(s)}</span>
              </span>
              <Amount value={amountOf(s)} unit={unit} flow={props.flow} className="shrink-0" />
            </li>
          ))}
        </ul>
      )}
      <MoreButton
        label={rest > 0 ? `외 ${rest.toLocaleString("ko-KR")}건은 창에서 — 누르면 전체 내역` : "누르면 창에서 자세히"}
        onClick={onMore}
      />
    </div>
  );
}

// ---- 창: 계산 근거 ----------------------------------------------

function FactsDialog({
  title,
  subtitle,
  facts,
  note,
  onClose,
}: Common & { facts: () => SmoatFact[]; note?: string; onClose: () => void }) {
  const [open, close] = useClosing(onClose);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const items = useMemo(() => facts(), []);
  return (
    <Dialog
      open={open}
      onClose={close}
      size="md"
      title={title}
      description={subtitle}
      footer={
        <Button size="sm" onClick={close}>
          닫기
        </Button>
      }
    >
      <TableScroll className="rounded-nd-md border border-nd-line">
        <Table minWidth={420} dense>
          <tbody>
            {items.map((f) => (
              <Tr key={f.key}>
                <Td className={f.strong ? "font-medium" : undefined}>
                  {f.label}
                  {f.sub && <span className="block text-nd-micro text-nd-fg-3">{f.sub}</span>}
                </Td>
                <Td num className={cn("whitespace-nowrap", f.strong && "font-semibold")}>
                  {f.value}
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </TableScroll>
      {note && <p className="mt-3 text-nd-caption text-nd-fg-3">{note}</p>}
    </Dialog>
  );
}

// ---- 창: 결제 줄 ------------------------------------------------

type Sort = "amount" | "date";

function RowsDialog({
  title,
  subtitle,
  rows,
  amountOf = (s) => s.amount,
  flow,
  unit = "won",
  group,
  onClose,
}: Common & {
  rows: () => SmoatSale[];
  amountOf?: (s: SmoatSale) => number;
  flow?: MoneyFlow;
  unit?: SmoatDrillUnit;
  group?: SmoatDrillGroup;
  onClose: () => void;
}) {
  const [open, close] = useClosing(onClose);
  const [sort, setSort] = useState<Sort>("amount");
  const [query, setQuery] = useState("");

  // 창이 열린 동안 목록이 바뀌지 않게 처음 한 번만 부른다
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const all = useMemo(() => rows(), []);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const hit = q
      ? all.filter((s) =>
          [s.accountName, s.packLabel, s.status, s.payMethod ? smoatPayMethodLabel(s.payMethod) : ""]
            .some((v) => v?.toLowerCase().includes(q)),
        )
      : all;
    return [...hit].sort(
      sort === "amount"
        ? (a, b) => Math.abs(amountOf(b)) - Math.abs(amountOf(a))
        : (a, b) => a.date.localeCompare(b.date),
    );
  }, [all, query, sort, amountOf]);

  const sum = shown.reduce((s, x) => s + amountOf(x), 0);
  const credits = shown.reduce((s, x) => s + (x.credits ?? 0), 0);
  const refund = shown.reduce((s, x) => s + x.refund, 0);
  // 요약은 검색과 상관없이 이 칸 전체 — 검색은 아래 줄 목록만 좁힌다
  const summary = useMemo(() => (group ? summarize(all, group, amountOf) : null), [group, all, amountOf]);
  const allSum = summary ? summary.reduce((s, x) => s + x.amount, 0) : 0;

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
            {query ? `검색 결과 ${shown.length.toLocaleString("ko-KR")}건` : ""}
          </span>
          <Button size="sm" onClick={close}>
            닫기
          </Button>
        </>
      }
    >
      {summary && summary.length > 0 && (
        <section className="mb-4">
          <p className="mb-1.5 text-nd-caption font-medium text-nd-fg-2">
            {GROUP_LABEL[group!]} · {summary.length.toLocaleString("ko-KR")}가지
          </p>
          <TableScroll className="rounded-nd-md border border-nd-line">
            <Table minWidth={520} dense>
              <thead>
                <tr>
                  <Th>{group === "account" ? "학원" : group === "method" ? "수단" : "팩"}</Th>
                  <Th align="right">건수</Th>
                  <Th align="right">크레딧</Th>
                  <Th align="right">금액</Th>
                  <Th align="right">비중</Th>
                </tr>
              </thead>
              <tbody>
                {summary.map((g) => (
                  <Tr key={g.key}>
                    <Td className="max-w-[320px]">
                      <button
                        type="button"
                        onClick={() => setQuery(g.name)}
                        className="truncate text-left hover:underline"
                        title="이 줄만 보기"
                      >
                        {g.name}
                      </button>
                    </Td>
                    <Td num className="text-nd-fg-3">{g.count.toLocaleString("ko-KR")}</Td>
                    <Td num className="text-nd-fg-2">{g.credits ? won(g.credits) : "—"}</Td>
                    <Td num className="whitespace-nowrap font-medium">
                      <Amount value={g.amount} unit={unit} flow={flow} />
                    </Td>
                    <Td num className="text-nd-fg-2">
                      {allSum ? `${((g.amount / allSum) * 100).toFixed(1)}%` : "—"}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </TableScroll>
        </section>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <SearchInput
          value={query}
          onValueChange={setQuery}
          placeholder="학원·팩·결제수단 검색"
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

      {shown.length === 0 ? (
        <p className="py-10 text-center text-nd-body text-nd-fg-3">
          {query ? "검색어에 맞는 결제가 없습니다." : "이 숫자에 잡힌 결제가 없습니다."}
        </p>
      ) : (
        <TableScroll className="rounded-nd-md border border-nd-line">
          <Table minWidth={760} dense>
            <thead>
              <tr>
                <Th>결제일</Th>
                <Th>학원</Th>
                <Th>팩</Th>
                <Th>수단</Th>
                <Th align="right">크레딧</Th>
                <Th align="right">환불</Th>
                <Th align="right">금액</Th>
              </tr>
            </thead>
            <tbody>
              {shown.map((s) => (
                <Tr key={s.id}>
                  <Td className="nd-num whitespace-nowrap text-nd-fg-2">{s.date}</Td>
                  <Td className="max-w-[260px]">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate" title={rowName(s)}>
                        {rowName(s)}
                      </span>
                      {s.kind !== "topup" && <Tag label={smoatKindLabel(s.kind)} />}
                    </span>
                  </Td>
                  <Td className="whitespace-nowrap text-nd-caption text-nd-fg-2">{s.packLabel ?? "—"}</Td>
                  <Td className="whitespace-nowrap text-nd-caption text-nd-fg-2">
                    {s.payMethod ? smoatPayMethodLabel(s.payMethod) : "—"}
                  </Td>
                  <Td num className="text-nd-fg-2">{s.credits ? won(s.credits) : "—"}</Td>
                  <Td num className="text-nd-fg-2">{s.refund ? won(s.refund) : "—"}</Td>
                  <Td num className="whitespace-nowrap">
                    <Amount value={amountOf(s)} unit={unit} flow={flow} />
                  </Td>
                </Tr>
              ))}
            </tbody>
            <tfoot>
              <TotalRow>
                <Td colSpan={4}>합계 {shown.length.toLocaleString("ko-KR")}건</Td>
                <Td num>{credits ? won(credits) : "—"}</Td>
                <Td num>{refund ? won(refund) : "—"}</Td>
                <Td num className="whitespace-nowrap">
                  <Amount value={sum} unit={unit} flow={flow} />
                </Td>
              </TotalRow>
            </tfoot>
          </Table>
        </TableScroll>
      )}
    </Dialog>
  );
}
