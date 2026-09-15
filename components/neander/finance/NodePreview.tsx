"use client";

// ============================================================
//  금액 드릴 — 올리면 미리보기, 누르면 전체 내역 창
// ------------------------------------------------------------
//  "뭐가 잡혔나"만 확인하려고 매번 원장을 열었다 돌아오기는 번거롭다.
//  커서를 잠깐 두면 큰 금액 순으로 몇 건을 팝오버로 보여 주고, 누르면
//  같은 거래 전체를 창으로 연다. 원장은 창 아래 버튼으로 간다
//  (⌘/Ctrl 클릭은 브라우저 기본대로 원장을 새 탭에 연다).
//
//  리포트의 숫자는 전부 이 부품으로 연다 — 계정 트리 칸·합계 줄·KPI 타일·
//  사업부 목록·구독 표. 화면마다 드릴 모양이 다르면 어디서 무엇을 누를 수
//  있는지 매번 다시 배워야 한다. (대시보드의 AmountBreakdown 은 창에서 분류를
//  고치는 기능까지 있어 따로 둔다.)
//
//  ⚠️ 창 합계는 칸의 숫자와 원 단위로 같아야 한다. 그래서 거래 목록뿐 아니라
//     「거래 → 이 숫자에 더해진 값」(amountOf)도 함께 받는다 — 순손익 칸에서
//     지출은 음수, 지출(순수) 칸에서 환급은 음수다.
// ============================================================

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type RefObject,
} from "react";
import Link from "next/link";
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
import type { TreeNode } from "@/lib/neander/finance/report";
import { netAmount, txFlow, type FinTransaction } from "@/lib/neander/finance/types";
import { FlagLine, Marker, SpikeBanner, useRowFlags } from "./Anomaly";
import type { AccountSpike } from "@/lib/neander/finance/anomaly";
import { ProjectTag } from "./ProjectTag";

const OPEN_DELAY = 350;
const CLOSE_DELAY = 150;
/**
 * 판에 그리는 줄 수 상한. 목록은 판 안에서 스크롤로 전부 본다 — 여덟 줄만 보여 주면
 * 나머지를 보려고 매번 창을 열어야 했다. 거래가 수백 건인 대분류에서 커서만 스쳐도
 * 수백 줄을 그리지 않게 상한만 둔다 (넘으면 창에서).
 */
const LIMIT = 300;

// ---- 칸(열) → 거래·금액 ---------------------------------------

/** 상위 노드는 rows 가 비어 있다 — 잎까지 내려가 모은다 */
export function rowsOf(node: Pick<TreeNode, "children" | "rows">): FinTransaction[] {
  if (node.children.length === 0) return node.rows;
  return node.children.flatMap(rowsOf);
}

const isExpense = (t: FinTransaction) => t.txType !== "수입" && t.txType !== "환급";

/**
 * 거래 한 건이 그 열의 숫자에 더하는 값. 그 열과 무관하면 null.
 * report.ts 의 add()·seal() 과 같은 갈래라야 창 합계가 칸과 맞는다.
 */
export function columnAmount(colKey: string, t: FinTransaction): number | null {
  const n = netAmount(t);
  switch (colKey) {
    case "income":
      return t.txType === "수입" ? n : null;
    case "expense":
      return isExpense(t) ? n : null;
    case "expensePure":
      // 지출(순수) = 지출 − 개인사용 − 환급
      if (t.txType === "환급") return -n;
      return isExpense(t) && !t.personalUse ? n : null;
    case "refund":
      return t.txType === "환급" ? n : null;
    case "diff":
      return t.txType === "환급" || (isExpense(t) && t.personalUse) ? n : null;
    case "net":
    case "count":
      // 순금액 = 수입 − 지출(순수). 개인사용 지출은 순금액에 들지 않는다
      if (t.txType === "수입" || t.txType === "환급") return n;
      if (isExpense(t)) return t.personalUse ? (colKey === "count" ? -n : null) : -n;
      return null;
    default:
      return n;
  }
}

/** 창 합계의 돈 방향 — 열마다 다르다 (차이는 개인·환급이 섞여 방향이 없다) */
export function columnFlow(colKey: string): MoneyFlow | undefined {
  switch (colKey) {
    case "income":
    case "refund":
      return "income";
    case "expense":
    case "expensePure":
      return "expense";
    case "net":
    case "count":
      return "net";
    default:
      return undefined;
  }
}

/** 트리 노드의 한 칸을 드릴 사양으로 */
export function nodeDrill(node: Pick<TreeNode, "children" | "rows">, colKey: string) {
  return {
    rows: () => rowsOf(node).filter((t) => columnAmount(colKey, t) !== null),
    amountOf: (t: FinTransaction) => columnAmount(colKey, t) ?? 0,
    flow: columnFlow(colKey),
  };
}

// ---- 부품 -----------------------------------------------------

export interface TxDrillProps {
  /** 창·판 제목 (예: 매출 › B2C매출) */
  title: string;
  /** 제목 아래 한 마디 (예: 수입금액) */
  subtitle?: string;
  /** 이 숫자를 이루는 거래 — 열 때만 부른다 (칸마다 미리 걸러 두면 표가 무거워진다) */
  rows: () => FinTransaction[];
  /** 거래 → 이 숫자에 더해진 값. 기본은 순금액 */
  amountOf?: (t: FinTransaction) => number;
  /** 창 합계의 돈 방향 */
  flow?: MoneyFlow;
  /** 원장에서 같은 조건으로 — 없으면 창에 원장 버튼이 없다 */
  href?: string;
  /** 거래 줄에 계정을 보일지 — 계정 하나로 좁혀진 칸이면 끈다 */
  showAccount?: boolean;
  /**
   * 이 숫자의 계정이 이 달에 튀었으면 — 판·창 맨 위에 이유를 두고, 증가를 이끈
   * 거래처의 거래를 칠한다. 칸은 칠해졌는데 창에 이유가 없으면 형광펜이 막다른 길이 된다.
   */
  spike?: AccountSpike;
  className?: string;
  /** 어두운 발표 화면(Deck) 위 — 밝은 hover 바탕 대신 옅은 흰 바탕 */
  tone?: "dark";
  children: ReactNode;
}

export function TxDrill({
  title,
  subtitle,
  rows,
  amountOf = netAmount,
  flow,
  href,
  showAccount = true,
  spike,
  className,
  tone,
  children,
}: TxDrillProps) {
  const anchorRef = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState(false);
  const timer = useRef<number | null>(null);

  const clear = () => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
  };
  const show = () => {
    clear();
    if (detail) return;
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
    setDetail(true);
  };

  const onClick = (e: ReactMouseEvent) => {
    // 목록 줄 전체가 눌리는 표(사업부 목록) 안에서도 줄 선택이 같이 일어나지 않게
    e.stopPropagation();
    // 새 탭·새 창으로 여는 클릭은 원장 링크 그대로 둔다
    if (href && (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0)) return;
    e.preventDefault();
    openDetail();
  };

  const anchorCls = cn(
    "rounded-[6px] px-1 transition-colors duration-nd-fast hover:underline",
    tone === "dark"
      ? "-mx-1 cursor-pointer decoration-dotted underline-offset-4 hover:bg-white/10"
      : "hover:bg-nd-accent-soft",
    className,
  );
  const spec = { title, subtitle, rows, amountOf, flow, href, showAccount, spike };

  return (
    <>
      {href ? (
        <Link
          ref={anchorRef as RefObject<HTMLAnchorElement>}
          href={href}
          onMouseEnter={show}
          onMouseLeave={hide}
          onClick={onClick}
          className={anchorCls}
        >
          {children}
        </Link>
      ) : (
        <button
          ref={anchorRef as RefObject<HTMLButtonElement>}
          type="button"
          onMouseEnter={show}
          onMouseLeave={hide}
          onClick={onClick}
          className={anchorCls}
        >
          {children}
        </button>
      )}
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
        {/* 판 높이는 화면 남은 공간에 맞춰 줄어든다(Popover maxHeight). 제목·「전체 내역」 줄은
            고정하고 목록만 스크롤해야 아래 줄이 잘려 나가지 않는다 */}
        <div onMouseEnter={clear} onMouseLeave={hide} className="flex max-h-[inherit] flex-col">
          {open && <PreviewBody {...spec} onMore={openDetail} />}
        </div>
      </Popover>
      {detail && <DetailDialog {...spec} onClose={() => setDetail(false)} />}
    </>
  );
}

/** 계정 트리 한 칸 — TreeTable 이 쓴다 */
export function PreviewLink({
  node,
  colKey,
  colLabel,
  href,
  spike,
  children,
}: {
  node: TreeNode;
  colKey: string;
  colLabel: string;
  href?: string;
  /** 이 계정의 급증 판정 — 지출 열에서만 넘긴다 */
  spike?: AccountSpike;
  children: ReactNode;
}) {
  return (
    <TxDrill
      title={[node.major, node.mid, node.minor].filter(Boolean).join(" › ")}
      subtitle={colLabel}
      href={href}
      spike={spike}
      // 소분류 줄은 계정이 하나라 거래마다 적을 필요가 없다
      showAccount={node.level < 2}
      {...nodeDrill(node, colKey)}
    >
      {children}
    </TxDrill>
  );
}

// ---- 판 · 창 ---------------------------------------------------

type Spec = Required<Pick<TxDrillProps, "title" | "rows" | "amountOf" | "showAccount">> &
  Pick<TxDrillProps, "subtitle" | "flow" | "href" | "spike">;

const byDate = (a: FinTransaction, b: FinTransaction) => (a.date ?? "").localeCompare(b.date ?? "");

const tagOf = (t: FinTransaction) => (t.txType === "환급" ? "환급" : t.personalUse ? "개인" : undefined);
const accountOf = (t: FinTransaction) => [t.acctMid, t.acctMinor].filter(Boolean).join(" › ") || "(미분류)";

function Tag({ label }: { label: string }) {
  return (
    <span className="shrink-0 rounded-[4px] bg-nd-warning-soft px-1 text-nd-micro text-nd-warning-text">{label}</span>
  );
}

function PreviewBody({ title, subtitle, rows: getRows, amountOf, showAccount, spike, onMore }: Spec & { onMore: () => void }) {
  const flagsOf = useRowFlags(spike);
  const rows = getRows();
  // 형광펜 줄을 먼저 올려야 스크롤하지 않고도 "왜 칠해졌나"가 판 첫 화면에 보인다
  const shown = [...rows]
    .sort(
      (a, b) =>
        Number(!!flagsOf(b)) - Number(!!flagsOf(a)) || Math.abs(amountOf(b)) - Math.abs(amountOf(a)),
    )
    .slice(0, LIMIT);
  const rest = rows.length - shown.length;
  const flaggedFirst = shown.some((t) => flagsOf(t));

  return (
    <div className="flex min-h-0 flex-1 flex-col text-nd-caption">
      <div className="shrink-0 border-b border-nd-line px-3.5 pb-2 pt-3">
        <p className="truncate text-nd-body font-semibold text-nd-fg" title={title}>
          {title}
        </p>
        <p className="mt-0.5 text-nd-fg-3">
          {subtitle ? `${subtitle} · ` : ""}
          {rows.length.toLocaleString("ko-KR")}건 · {flaggedFirst ? "형광펜 먼저, 큰 금액 순" : "큰 금액 순"}
        </p>
      </div>
      {spike && <SpikeBanner spike={spike} compact />}

      {shown.length === 0 ? (
        <p className="px-3.5 py-4 text-center text-nd-fg-3">이 숫자에 잡힌 거래가 없습니다.</p>
      ) : (
        <ul className="nd-scroll max-h-[26rem] min-h-0 flex-1 overflow-y-auto overscroll-contain py-1">
          {shown.map((t) => {
            const tag = tagOf(t);
            const flags = flagsOf(t);
            return (
              <li key={t.id} className="flex items-center gap-2.5 px-3.5 py-1.5">
                <span className="nd-num w-10 shrink-0 text-nd-fg-3">{t.date.slice(5)}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-nd-fg" title={t.vendor}>
                      {t.vendor?.trim() || "(거래처 없음)"}
                    </span>
                    {tag && <Tag label={tag} />}
                    <ProjectTag code={t.projectCode} />
                  </span>
                  {(showAccount || t.note) && (
                    <span className="block truncate text-nd-micro text-nd-fg-3">
                      {[showAccount ? accountOf(t) : undefined, t.note].filter(Boolean).join(" · ")}
                    </span>
                  )}
                  {flags && <FlagLine flags={flags} tx={t} />}
                </span>
                {flags ? (
                  <Marker reason={flags.map((f) => f.reason).join(" · ")} className="shrink-0">
                    <Money value={amountOf(t)} unit={false} flow={txFlow(t.txType)} />
                  </Marker>
                ) : (
                  <Money value={amountOf(t)} unit={false} flow={txFlow(t.txType)} className="shrink-0" />
                )}
              </li>
            );
          })}
        </ul>
      )}

      <button
        type="button"
        onClick={onMore}
        className="flex w-full shrink-0 items-center justify-between border-t border-nd-line px-3.5 py-2 text-left text-nd-fg-2 transition-colors duration-nd-fast hover:bg-nd-fg/[.04] hover:text-nd-fg"
      >
        <span>
          {rest > 0
            ? `외 ${rest.toLocaleString("ko-KR")}건은 창에서 — 누르면 전체 내역`
            : "누르면 창에서 검색·정렬"}
        </span>
        <Icon icon={ArrowRight} size={14} />
      </button>
    </div>
  );
}

type Sort = "amount" | "date";

function DetailDialog({
  title,
  subtitle,
  rows: getRows,
  amountOf,
  flow,
  href,
  showAccount,
  spike,
  onClose,
}: Spec & { onClose: () => void }) {
  const router = useRouter();
  const flagsOf = useRowFlags(spike);
  // 닫힘 애니메이션이 끝난 뒤에 부모가 치우도록 open 을 따로 둔다
  const [open, setOpen] = useState(true);
  const [sort, setSort] = useState<Sort>("amount");
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (open) return;
    const t = window.setTimeout(onClose, 160);
    return () => window.clearTimeout(t);
  }, [open, onClose]);

  // 창이 열린 동안 목록이 바뀌지 않게 처음 한 번만 부른다
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const all = useMemo(() => getRows(), []);
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const hit = q
      ? all.filter((t) =>
          [t.vendor, t.note, t.acctMid, t.acctMinor, t.acctNote, t.site, t.projectCode]
            .some((s) => s?.toLowerCase().includes(q)),
        )
      : all;
    return [...hit].sort(sort === "amount" ? (a, b) => Math.abs(amountOf(b)) - Math.abs(amountOf(a)) : byDate);
  }, [all, query, sort, amountOf]);
  const sum = rows.reduce((s, t) => s + amountOf(t), 0);

  return (
    <Dialog
      open={open}
      onClose={() => setOpen(false)}
      size="xl"
      title={title}
      description={`${subtitle ? `${subtitle} · ` : ""}${all.length.toLocaleString("ko-KR")}건`}
      footer={
        <>
          <span className="mr-auto text-nd-caption text-nd-fg-3">
            {query
              ? `검색 결과 ${rows.length.toLocaleString("ko-KR")}건`
              : href
                ? "원장에서는 이 조건으로 걸린 채 열립니다"
                : ""}
          </span>
          {href && (
            <Button variant="secondary" size="sm" icon={ExternalLink} onClick={() => router.push(href)}>
              원장에서 열기
            </Button>
          )}
          <Button size="sm" onClick={() => setOpen(false)}>
            닫기
          </Button>
        </>
      }
    >
      {spike && <SpikeBanner spike={spike} />}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <SearchInput
          value={query}
          onValueChange={setQuery}
          placeholder="거래처·비고·계정 검색"
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
          {query ? "검색어에 맞는 거래가 없습니다." : "이 숫자에 잡힌 거래가 없습니다."}
        </p>
      ) : (
        <TableScroll className="rounded-nd-md border border-nd-line">
          <Table minWidth={720} dense>
            <thead>
              <tr>
                <Th>날짜</Th>
                <Th>거래처</Th>
                {showAccount && <Th>계정</Th>}
                <Th>사업장</Th>
                <Th>비고</Th>
                <Th align="right">금액</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => {
                const tag = tagOf(t);
                const flags = flagsOf(t);
                return (
                  <Tr key={t.id}>
                    <Td className="nd-num whitespace-nowrap text-nd-fg-2">{t.date}</Td>
                    <Td className="max-w-[220px]">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate" title={t.vendor}>
                          {t.vendor?.trim() || "(거래처 없음)"}
                        </span>
                        {tag && <Tag label={tag} />}
                        <ProjectTag code={t.projectCode} />
                      </span>
                      {flags && <FlagLine flags={flags} tx={t} />}
                    </Td>
                    {showAccount && <Td className="whitespace-nowrap text-nd-fg-2">{accountOf(t)}</Td>}
                    <Td className="whitespace-nowrap text-nd-fg-2">{t.site || "—"}</Td>
                    <Td className="max-w-[260px] truncate text-nd-caption text-nd-fg-3" title={t.note}>
                      {t.note || ""}
                    </Td>
                    <Td num className="whitespace-nowrap">
                      {flags ? (
                        <Marker reason={flags.map((f) => f.reason).join(" · ")}>
                          <Money value={amountOf(t)} unit={false} flow={txFlow(t.txType)} />
                        </Marker>
                      ) : (
                        <Money value={amountOf(t)} unit={false} flow={txFlow(t.txType)} />
                      )}
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
            <tfoot>
              <TotalRow>
                <Td colSpan={showAccount ? 5 : 4}>합계 {rows.length.toLocaleString("ko-KR")}건</Td>
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
