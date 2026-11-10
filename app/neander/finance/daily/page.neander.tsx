"use client";

// ============================================================
//  자금 일보 — 하루(또는 기간) 모든 통장 · 법인카드의 잔액 · 입출금 · 사용
// ------------------------------------------------------------
//  통장은 ERP 결제수단의 모든 계좌를 보여 준다. 숫자의 출처는 둘이다.
//    · 문자 — 은행 입출금 문자 (회사 공용폰 → api/neander/finance/sms → 받은 문자함). 실시간 · 잠정
//    · 장부 — 월 엑셀로 올린 거래 원장. 문자가 안 오는 통장은 이걸로 센다 (「~10/31」 처럼 어디까지인지 적는다)
//  연결 상태는 셋 — 문자 수신 · 문자 대기(통지를 신청했지만 아직 안 옴) · 연결 안 됨.
//  신청 목록은 neander_fin_settings/sms-feed 의 linkedAccounts · linkedCards.
//
//  법인카드는 통장과 따로 — 카드 승인 문자가 오면 「카드 승인 내역」 에 시간순으로 쌓이고,
//  그 전에는 카드 기록(월 엑셀) 기준 사용액을 보여 준다.
//  계산은 lib/neander/finance/daily-cash.ts. 문자 줄은 장부에 넣지 않는다 (4주 시험 중).
// ============================================================

import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { CreditCard, MessageSquareText, RefreshCw, TriangleAlert } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  DateStepper,
  EmptyState,
  ErrorState,
  InlineNotice,
  Input,
  KpiItem,
  KpiStrip,
  LoadingState,
  Money,
  PageHeader,
  PageShell,
  SectionHeader,
  Table,
  TableScroll,
  Tabs,
  Td,
  Th,
  Tr,
  cn,
} from "@/components/neander/ui";
import { useFinance } from "@/components/neander/finance/FinanceProvider";
import { HoverDetail } from "@/components/neander/finance/HoverDetail";
import {
  buildDailyCash,
  ledgerAccountRow,
  ledgerCardRow,
  smsCardRow,
  type CardRow,
  type CardTx,
  type CashAccount,
  type CashLink,
  type DailyCashRow,
} from "@/lib/neander/finance/daily-cash";
import {
  ledgerCardLines,
  ledgerFlowLines,
  smsCardLines,
  smsFlowLines,
  type DetailLine,
} from "@/lib/neander/finance/daily-cash-detail";
import { fetchDailyCash, type DailyCashFetch } from "@/lib/neander/finance/daily-cash-client";

const kstToday = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const WEEK = ["일", "월", "화", "수", "목", "금", "토"];
const dayLabel = (date: string) => {
  const d = new Date(`${date}T00:00:00Z`);
  return `${d.getUTCFullYear()}. ${d.getUTCMonth() + 1}. ${d.getUTCDate()} (${WEEK[d.getUTCDay()]})`;
};
const shortDay = (date: string) => {
  const d = new Date(`${date}T00:00:00Z`);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${WEEK[d.getUTCDay()]})`;
};
const md = (date?: string) => (date ? `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}` : "");
const won = (n: number) => `${n < 0 ? "-" : n > 0 ? "+" : ""}${Math.abs(n).toLocaleString("ko-KR")}원`;
const MAX_RANGE = 92;
const LINK_ORDER: Record<CashLink, number> = { sms: 0, waiting: 1, none: 2 };

type Mode = "day" | "range";
type View = "account" | "card";

function LinkBadge({ link }: { link: CashLink }) {
  if (link === "sms")
    return (
      <Badge tone="success" dot>
        문자 수신
      </Badge>
    );
  if (link === "waiting") return <Badge tone="info">문자 대기</Badge>;
  return <Badge tone="neutral">연결 안 됨</Badge>;
}

/** 금액 칸 — 장부를 아직 못 불러왔으면 「…」 */
const amountCell = (value: number | null | undefined, flow?: "income" | "expense", pending = false): ReactNode =>
  pending ? <span className="text-nd-fg-3">…</span> : value === null || value === undefined ? "—" : value === 0 && flow ? <span className="text-nd-fg-3">0</span> : <Money value={value} unit={false} flow={flow} />;

export default function DailyCashPage() {
  const { transactions, loading: ledgerLoading } = useFinance();
  const today = kstToday();
  const [mode, setMode] = useState<Mode>("day");
  const [day, setDay] = useState(today);
  const [rangeFrom, setRangeFrom] = useState(addDays(today, -6));
  const [rangeTo, setRangeTo] = useState(today);
  const [data, setData] = useState<DailyCashFetch | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 통장 · 법인카드 탭 — 주소 끝(#card)에 남겨 새로고침해도 보던 탭 그대로
  const [view, setView] = useState<View>("account");
  useEffect(() => {
    const apply = () => setView(window.location.hash === "#card" ? "card" : "account");
    apply();
    window.addEventListener("hashchange", apply);
    return () => window.removeEventListener("hashchange", apply);
  }, []);
  const goView = useCallback((key: string) => {
    const next: View = key === "card" ? "card" : "account";
    setView(next);
    window.history.replaceState(null, "", next === "card" ? "#card" : `${window.location.pathname}${window.location.search}`);
  }, []);

  const from = mode === "day" ? day : rangeFrom <= rangeTo ? rangeFrom : rangeTo;
  const to = mode === "day" ? day : rangeFrom <= rangeTo ? rangeTo : rangeFrom;
  const tooLong = (Date.parse(to) - Date.parse(from)) / 86_400_000 + 1 > MAX_RANGE;

  const load = useCallback(async () => {
    if (tooLong) return;
    setLoading(true);
    setError(null);
    try {
      setData(await fetchDailyCash(from, to));
    } catch (e) {
      setError(e instanceof Error ? e.message : "불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [from, to, tooLong]);
  useEffect(() => {
    void load();
  }, [load]);

  // ---- 통장 ----
  const smsReport = useMemo(() => (data ? buildDailyCash(data.txs, data.accounts, from, to) : null), [data, from, to]);
  const accountRows = useMemo(() => {
    if (!data || !smsReport) return [];
    const linked = new Set(data.linked.accounts);
    const list = [...data.accounts];
    for (const r of smsReport.rows) if (!list.some((a) => a.last4 === r.last4)) list.push({ last4: r.last4, label: r.label, bank: r.bank });
    return list
      .map((acct) => {
        const link: CashLink = data.lastSeen[acct.last4] ? "sms" : linked.has(acct.last4) ? "waiting" : "none";
        const sms = smsReport.rows.find((r) => r.last4 === acct.last4);
        const row: DailyCashRow | null = sms ?? (ledgerLoading ? null : ledgerAccountRow(transactions, acct, from, to));
        return { acct, link, row };
      })
      .sort((a, b) => LINK_ORDER[a.link] - LINK_ORDER[b.link] || (b.row?.closing ?? 0) - (a.row?.closing ?? 0));
  }, [data, smsReport, transactions, ledgerLoading, from, to]);

  const sumOf = (rows: (DailyCashRow | null)[], f: (r: DailyCashRow) => number) => rows.reduce((s, r) => s + (r ? f(r) : 0), 0);
  const smsRows = accountRows.filter((x) => x.row?.source === "sms").map((x) => x.row);
  const allRows = accountRows.map((x) => x.row);

  // ---- 카드 ----
  const cardRows = useMemo(() => {
    if (!data) return [] as { link: CashLink; row: CardRow | null; label: string; last4: string }[];
    const linked = new Set(data.linked.cards);
    return data.cards
      .map((card) => {
        const link: CashLink = data.cardLastSeen[card.last4] ? "sms" : linked.has(card.last4) ? "waiting" : "none";
        const row = link === "sms" ? smsCardRow(data.cardTxs, card, from, to) : ledgerLoading ? null : ledgerCardRow(transactions, card, from, to);
        return { link, row, label: card.label, last4: card.last4 };
      })
      .sort(
        (a, b) =>
          LINK_ORDER[a.link] - LINK_ORDER[b.link] ||
          (b.row?.useSum ?? 0) - (a.row?.useSum ?? 0) ||
          (b.row?.lastSeen ?? "").localeCompare(a.row?.lastSeen ?? ""),
      );
  }, [data, transactions, ledgerLoading, from, to]);
  const cardDays = useMemo(() => {
    const m = new Map<string, CardTx[]>();
    for (const t of data?.cardTxs ?? []) if (t.date >= from && t.date <= to) m.set(t.date, [...(m.get(t.date) ?? []), t]);
    return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [data, from, to]);
  const cardLabel = (last4: string) => data?.cards.find((c) => c.last4 === last4)?.label ?? `카드 ${last4}`;
  const staleCard = (r: CardRow | null) => !!r?.lastSeen && r.lastSeen.slice(0, 10) < addDays(today, -120);

  // ---- 말풍선 — 숫자에 커서를 두면 그 숫자의 내역 (HoverDetail · daily-cash-detail.ts) ----
  const smsLines = useMemo(() => smsReport?.days.flatMap((d) => d.lines) ?? [], [smsReport]);
  const periodLabel = mode === "day" ? shortDay(from) : `${shortDay(from)} ~ ${shortDay(to)}`;
  const withDate = mode === "range";
  const sourceLabel = (row: { source?: "sms" | "ledger"; coveredTo?: string }) =>
    row.source === "sms" ? "문자 기준 · 잠정" : row.coveredTo ? `장부 기준 · ${md(row.coveredTo)}까지` : "장부 기준";
  const dirOf = (kind: "입금" | "출금") => (kind === "입금" ? "in" : "out");
  const flowOf = (kind: "입금" | "출금") => (kind === "입금" ? "income" : "expense");

  /** 통장 한 줄의 입금 · 출금 칸 */
  const flowCell = (acct: CashAccount, row: DailyCashRow | null, kind: "입금" | "출금") => {
    const sum = kind === "입금" ? row?.inSum : row?.outSum;
    const count = (kind === "입금" ? row?.inCount : row?.outCount) ?? 0;
    if (!row || count === 0) return amountCell(sum, flowOf(kind), !row);
    return (
      <HoverDetail
        title={`${acct.label} ${acct.last4} · ${kind}`}
        subtitle={`${periodLabel} · ${sourceLabel(row)} · 최근 것이 위`}
        flow={flowOf(kind)}
        lines={() =>
          row.source === "sms"
            ? smsFlowLines(smsLines, kind, { last4: acct.last4, withDate })
            : ledgerFlowLines(transactions, acct.last4, from, to, dirOf(kind), { withDate })
        }
      >
        {amountCell(sum, flowOf(kind))}
        <span className="ml-1 text-nd-caption text-nd-fg-3">{count}건</span>
      </HoverDetail>
    );
  };

  /** 합계의 입금 · 출금 — 문자 통장은 시각순으로 섞고, 장부 통장은 그 뒤에 통장별로 */
  const totalFlowLines = (kind: "입금" | "출금", smsOnly: boolean): DetailLine[] => [
    ...smsFlowLines(smsLines, kind, { withDate }),
    ...(smsOnly
      ? []
      : accountRows.flatMap(({ acct, row }) =>
          row?.source === "ledger" ? ledgerFlowLines(transactions, acct.last4, from, to, dirOf(kind), { withDate, account: `${acct.label} ${acct.last4}` }) : [],
        )),
  ];
  const totalFlow = (kind: "입금" | "출금", smsOnly: boolean, value: ReactNode) =>
    sumOf(smsOnly ? smsRows : allRows, (r) => (kind === "입금" ? r.inCount : r.outCount)) === 0 ? (
      value
    ) : (
    <HoverDetail
      title={`${smsOnly ? "문자 수신 통장" : "모든 통장"} · ${kind}`}
      subtitle={`${periodLabel} · ${smsOnly ? "문자 기준 · 잠정" : "문자 통장 먼저, 장부 통장은 장부가 올라온 날까지"}`}
      flow={flowOf(kind)}
      lines={() => totalFlowLines(kind, smsOnly)}
    >
      {value}
    </HoverDetail>
  );

  /** 잔액 합계 — 통장별로 나눠 본다 */
  const balanceLines = (pick: "opening" | "closing", smsOnly: boolean): DetailLine[] =>
    accountRows
      .flatMap(({ acct, row }) =>
        row && row[pick] !== null && (!smsOnly || row.source === "sms")
          ? [{ key: acct.last4, title: `${acct.label} ${acct.last4}`, sub: sourceLabel(row), amount: row[pick] ?? 0 }]
          : [],
      )
      .sort((a, b) => b.amount - a.amount);
  const totalBalance = (pick: "opening" | "closing", smsOnly: boolean, value: ReactNode) => (
    <HoverDetail
      title={`${pick === "opening" ? openingLabel : closingLabel} · ${smsOnly ? "문자 수신 통장" : "모든 통장"}`}
      subtitle={`${pick === "opening" ? `${shortDay(from)} 시작` : `${shortDay(to)} 마지막`} · 통장별`}
      lines={() => balanceLines(pick, smsOnly)}
      countLabel={(n) => `${n}개 통장 합계`}
      footnote={smsOnly ? undefined : "장부 기준 통장은 장부가 올라온 날의 잔액이에요."}
    >
      {value}
    </HoverDetail>
  );

  /** 카드 한 줄의 사용액 칸 */
  const cardUseCell = (row: CardRow | null, label: string, last4: string) => {
    if (!row || row.approveCount + row.cancelCount === 0) return amountCell(row?.useSum, "expense", !row);
    return (
      <HoverDetail
        title={`${label} ${last4} · 사용액`}
        subtitle={`${periodLabel} · ${row.source === "sms" ? "문자 기준 · 잠정" : row.coveredTo ? `카드 기록 기준 · ${md(row.coveredTo)}까지` : "카드 기록 기준"} · 승인 − 취소`}
        flow="expense"
        lines={() => (row.source === "sms" ? smsCardLines(data?.cardTxs ?? [], last4, from, to, { withDate }) : ledgerCardLines(transactions, last4, from, to, { withDate }))}
      >
        {amountCell(row.useSum, "expense")}
      </HoverDetail>
    );
  };

  const quick = (label: string, f: string, t: string) => (
    <Button
      size="sm"
      variant={rangeFrom === f && rangeTo === t ? "secondary" : "ghost"}
      onClick={() => {
        setRangeFrom(f);
        setRangeTo(t);
      }}
    >
      {label}
    </Button>
  );
  const monthStart = `${today.slice(0, 7)}-01`;
  const lastMonthEnd = addDays(monthStart, -1);
  const lastMonthStart = `${lastMonthEnd.slice(0, 7)}-01`;
  const openingLabel = mode === "day" ? "전일 잔액" : "기초 잔액";
  const closingLabel = mode === "day" ? "금일 잔액" : "기말 잔액";

  return (
    <PageShell>
      <PageHeader
        title="자금 일보"
        description="모든 통장의 잔액 · 입출금과 법인카드 사용 — 문자로 받는 것은 실시간, 나머지는 장부(월 엑셀) 기준입니다."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Tabs
              size="sm"
              ariaLabel="보기"
              items={[
                { key: "day", label: "하루" },
                { key: "range", label: "기간" },
              ]}
              value={mode}
              onChange={(k) => setMode(k as Mode)}
            />
            <Button size="sm" variant="ghost" onClick={() => void load()} disabled={loading}>
              <RefreshCw size={15} className="mr-1" />
              새로고침
            </Button>
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {mode === "day" ? (
          <DateStepper
            label={dayLabel(day)}
            onPrev={() => setDay(addDays(day, -1))}
            onNext={() => setDay(addDays(day, 1))}
            nextDisabled={day >= today}
            onToday={day !== today ? () => setDay(today) : undefined}
            prevLabel="전날"
            nextLabel="다음 날"
          />
        ) : (
          <>
            <Input type="date" value={rangeFrom} max={today} onChange={(e) => e.target.value && setRangeFrom(e.target.value)} aria-label="시작일" className="w-[11rem]" />
            <span className="text-nd-fg-3">~</span>
            <Input type="date" value={rangeTo} max={today} onChange={(e) => e.target.value && setRangeTo(e.target.value)} aria-label="끝날" className="w-[11rem]" />
            {quick("최근 7일", addDays(today, -6), today)}
            {quick("이번 달", monthStart, today)}
            {quick("지난달", lastMonthStart, lastMonthEnd)}
          </>
        )}
      </div>

      <InlineNotice tone="info" icon={MessageSquareText} className="mb-5">
        문자는 2026-11-10부터 받았고, 4주 동안 월 엑셀과 맞춰 보는 중이라 장부에는 아직 넣지 않았어요. 문자가 안 오는 통장 · 카드는 장부(월 엑셀)가 올라온 날까지만 숫자가 있어요.
      </InlineNotice>

      {tooLong ? (
        <InlineNotice tone="warning">기간은 {MAX_RANGE}일까지 볼 수 있어요.</InlineNotice>
      ) : error ? (
        <ErrorState
          title="자금 일보를 불러오지 못했어요"
          description={error}
          action={
            <Button size="sm" variant="secondary" onClick={() => void load()}>
              다시 시도
            </Button>
          }
        />
      ) : loading && !data ? (
        <LoadingState label="받은 문자를 모으는 중" />
      ) : data && smsReport ? (
        <>
          <Tabs
            className="mb-5"
            ariaLabel="통장 · 법인카드"
            value={view}
            onChange={goView}
            items={[
              {
                key: "account",
                label: (
                  <>
                    통장 <span className="nd-num text-nd-fg-3">{accountRows.length}</span>
                  </>
                ),
              },
              {
                key: "card",
                label: (
                  <>
                    법인카드 <span className="nd-num text-nd-fg-3">{cardRows.length}</span>
                  </>
                ),
              },
            ]}
          />

          {view === "account" && (
          <>
          <KpiStrip columns={4} className="mb-2">
            <KpiItem label={openingLabel} value={totalBalance("opening", true, <Money value={sumOf(smsRows, (r) => r.opening ?? 0)} unit={false} />)} unit="원" hint={`문자 수신 통장 · ${shortDay(from)} 시작`} />
            <KpiItem label="입금" tone="success" value={totalFlow("입금", true, <Money value={sumOf(smsRows, (r) => r.inSum)} unit={false} flow="income" />)} unit="원" hint={`${sumOf(smsRows, (r) => r.inCount)}건`} />
            <KpiItem label="출금" tone="danger" value={totalFlow("출금", true, <Money value={sumOf(smsRows, (r) => r.outSum)} unit={false} flow="expense" />)} unit="원" hint={`${sumOf(smsRows, (r) => r.outCount)}건`} />
            <KpiItem label={closingLabel} value={totalBalance("closing", true, <Money value={sumOf(smsRows, (r) => r.closing ?? 0)} unit={false} />)} unit="원" hint={`문자 수신 통장 · ${shortDay(to)} 마지막`} />
          </KpiStrip>
          <p className="mb-6 text-nd-caption text-nd-fg-3">위 네 칸은 문자로 받는 통장만 합친 실시간 숫자예요. 모든 통장 합계는 아래 표 맨 끝에 있어요.</p>

          {/* ---- 통장 ---- */}
          <SectionHeader
            title="통장"
            hint={`${accountRows.length}개 · 문자 수신 ${accountRows.filter((x) => x.link === "sms").length} · 문자 대기 ${accountRows.filter((x) => x.link === "waiting").length} · 연결 안 됨 ${accountRows.filter((x) => x.link === "none").length}`}
          />
          <Card padding="none" className="mb-6 overflow-hidden">
            <TableScroll>
              <Table size="md" minWidth={980}>
                <thead>
                  <tr>
                    <Th>통장</Th>
                    <Th>연결</Th>
                    <Th align="right">{openingLabel}</Th>
                    <Th align="right">입금</Th>
                    <Th align="right">출금</Th>
                    <Th align="right">{closingLabel}</Th>
                    <Th>확인 · 기준</Th>
                  </tr>
                </thead>
                <tbody>
                  {accountRows.map(({ acct, link, row }) => {
                    const pending = !row;
                    const ledger = row?.source === "ledger";
                    const none = !!row && row.inCount + row.outCount === 0;
                    return (
                      <Tr key={acct.last4}>
                        <Td>
                          <span className="font-medium">{acct.label}</span>
                          <span className="ml-1.5 text-nd-fg-3">{acct.last4}</span>
                          {acct.site && acct.site !== "네안데르" && <span className="ml-1.5 text-nd-caption text-nd-fg-3">· {acct.site}</span>}
                        </Td>
                        <Td>
                          <LinkBadge link={link} />
                        </Td>
                        <Td num>{amountCell(row?.opening, undefined, pending)}</Td>
                        <Td num>{flowCell(acct, row, "입금")}</Td>
                        <Td num>{flowCell(acct, row, "출금")}</Td>
                        <Td num className="font-semibold">
                          {amountCell(row?.closing, undefined, pending)}
                        </Td>
                        <Td>
                          {pending ? (
                            <span className="text-nd-fg-3">장부 불러오는 중…</span>
                          ) : ledger ? (
                            <span className="text-nd-fg-3">{row.coveredTo ? `장부 기준 · ${md(row.coveredTo)}까지` : "장부에 거래 없음"}</span>
                          ) : row!.gapCount > 0 ? (
                            <Badge tone="warning" dot>
                              빠진 문자 {row!.gapCount}곳 · {won(row!.gap)}
                            </Badge>
                          ) : none ? (
                            <span className="text-nd-fg-3">거래 없음 · 마지막 문자 {row!.lastSeen?.slice(5)}</span>
                          ) : (
                            <Badge tone="success" dot>
                              잔액 맞음
                            </Badge>
                          )}
                        </Td>
                      </Tr>
                    );
                  })}
                  <Tr className="bg-nd-sunken font-semibold">
                    <Td>문자 수신 합계</Td>
                    <Td />
                    <Td num>{totalBalance("opening", true, <Money value={sumOf(smsRows, (r) => r.opening ?? 0)} unit={false} />)}</Td>
                    <Td num>{totalFlow("입금", true, <Money value={sumOf(smsRows, (r) => r.inSum)} unit={false} flow="income" />)}</Td>
                    <Td num>{totalFlow("출금", true, <Money value={sumOf(smsRows, (r) => r.outSum)} unit={false} flow="expense" />)}</Td>
                    <Td num>{totalBalance("closing", true, <Money value={sumOf(smsRows, (r) => r.closing ?? 0)} unit={false} />)}</Td>
                    <Td className="font-normal text-nd-fg-3">실시간</Td>
                  </Tr>
                  <Tr className="bg-nd-sunken font-semibold">
                    <Td>모든 통장 합계</Td>
                    <Td />
                    <Td num>{ledgerLoading ? amountCell(0, undefined, true) : totalBalance("opening", false, amountCell(sumOf(allRows, (r) => r.opening ?? 0)))}</Td>
                    <Td num>{ledgerLoading ? amountCell(0, undefined, true) : totalFlow("입금", false, amountCell(sumOf(allRows, (r) => r.inSum), "income"))}</Td>
                    <Td num>{ledgerLoading ? amountCell(0, undefined, true) : totalFlow("출금", false, amountCell(sumOf(allRows, (r) => r.outSum), "expense"))}</Td>
                    <Td num>{ledgerLoading ? amountCell(0, undefined, true) : totalBalance("closing", false, amountCell(sumOf(allRows, (r) => r.closing ?? 0)))}</Td>
                    <Td className="font-normal text-nd-fg-3">장부 기준 통장은 장부가 올라온 날까지</Td>
                  </Tr>
                </tbody>
              </Table>
            </TableScroll>
          </Card>

          <SectionHeader title="통장 거래 내역" hint={`문자로 받은 것 · ${mode === "day" ? dayLabel(day) : `${shortDay(from)} ~ ${shortDay(to)}`}`} />
          {smsReport.days.length === 0 ? (
            <Card className="mb-6">
              <EmptyState compact title="이 기간에 받은 통장 거래 문자가 없어요" description="주말 · 공휴일이거나, 문자가 오지 않았을 수 있어요." />
            </Card>
          ) : (
            smsReport.days
              .slice()
              .reverse()
              .map((d) => (
                <Card key={d.date} padding="none" className="mb-4 overflow-hidden">
                  {mode === "range" && (
                    <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-nd-line px-4 py-3">
                      <span className="text-nd-section">{dayLabel(d.date)}</span>
                      <span className="text-nd-body text-nd-fg-2">
                        입금 <Money value={d.inSum} flow="income" /> · 출금 <Money value={d.outSum} flow="expense" />
                      </span>
                    </div>
                  )}
                  <TableScroll>
                    <Table size="md" minWidth={760}>
                      <thead>
                        <tr>
                          <Th>시각</Th>
                          <Th>통장</Th>
                          <Th>구분</Th>
                          <Th align="right">금액</Th>
                          <Th align="right">거래 후 잔액</Th>
                          <Th>보낸 분 · 받는 분</Th>
                        </tr>
                      </thead>
                      <tbody>
                        {d.lines
                          .slice()
                          .reverse()
                          .map((l) => (
                            <Fragment key={l.id}>
                              <Tr>
                                <Td className="nd-num">{l.time}</Td>
                                <Td>
                                  {l.label} <span className="text-nd-fg-3">{l.last4}</span>
                                </Td>
                                <Td>
                                  <Badge tone={l.kind === "입금" ? "success" : "danger"}>{l.kind}</Badge>
                                </Td>
                                <Td num className="font-semibold">
                                  <Money value={l.amount} unit={false} flow={l.kind === "입금" ? "income" : "expense"} />
                                </Td>
                                <Td num>{l.balance === undefined ? "—" : <Money value={l.balance} unit={false} />}</Td>
                                <Td>{l.memo ?? ""}</Td>
                              </Tr>
                              {l.gapBefore !== undefined && (
                                <Tr>
                                  <Td colSpan={6} className="bg-nd-warning-soft text-nd-warning-text">
                                    <TriangleAlert size={14} className="mr-1.5 inline-block align-[-2px]" />
                                    이 거래 앞에 문자가 빠진 것으로 보여요 — 잔액 차이 {won(l.gapBefore)}
                                  </Td>
                                </Tr>
                              )}
                            </Fragment>
                          ))}
                      </tbody>
                    </Table>
                  </TableScroll>
                </Card>
              ))
          )}
          </>
          )}

          {/* ---- 법인카드 ---- */}
          {view === "card" && (
          <>
          <SectionHeader
            title="법인카드"
            hint={`${cardRows.length}장 · 문자 수신 ${cardRows.filter((x) => x.link === "sms").length} · 기간 사용 ${ledgerLoading ? "…" : `${cardRows.reduce((s, x) => s + (x.row?.useSum ?? 0), 0).toLocaleString("ko-KR")}원`}`}
          />
          <Card padding="none" className="mb-6 overflow-hidden">
            <TableScroll>
              <Table size="md" minWidth={820}>
                <thead>
                  <tr>
                    <Th>카드</Th>
                    <Th>연결</Th>
                    <Th align="right">사용액 (승인 − 취소)</Th>
                    <Th align="right">승인</Th>
                    <Th align="right">취소</Th>
                    <Th>기준</Th>
                  </tr>
                </thead>
                <tbody>
                  {cardRows.map(({ link, row, label, last4 }) => (
                    <Tr key={last4} className={cn(staleCard(row) && "text-nd-fg-3")}>
                      <Td>
                        <span className="font-medium">{label}</span>
                        <span className="ml-1.5 text-nd-fg-3">{last4}</span>
                      </Td>
                      <Td>
                        <LinkBadge link={link} />
                      </Td>
                      <Td num className="font-semibold">{cardUseCell(row, label, last4)}</Td>
                      <Td num>{row ? `${row.approveCount}건` : "…"}</Td>
                      <Td num>{row ? `${row.cancelCount}건` : "…"}</Td>
                      <Td className="text-nd-fg-3">
                        {!row
                          ? "장부 불러오는 중…"
                          : row.source === "sms"
                            ? `문자 · 마지막 ${row.lastSeen?.slice(5) ?? "—"}`
                            : row.coveredTo
                              ? `카드 기록 기준 · 마지막 사용 ${staleCard(row) ? row.coveredTo : md(row.coveredTo)}`
                              : "카드 기록에 사용 없음"}
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </TableScroll>
          </Card>

          <SectionHeader title="카드 승인 내역" hint="문자로 받은 것" />
          {cardDays.length === 0 ? (
            <InlineNotice tone="neutral" icon={CreditCard} className="mb-6">
              {data.cardTxs.length === 0 && cardRows.every((x) => x.link !== "sms")
                ? "카드 승인 문자가 연결되면 여기에 시간순으로 쌓여요. 지금 위 카드 표는 카드 기록(월 엑셀) 기준이에요."
                : "이 기간에 받은 카드 승인 문자가 없어요."}
            </InlineNotice>
          ) : (
            cardDays.map(([date, list]) => (
              <Card key={date} padding="none" className="mb-4 overflow-hidden">
                <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-nd-line px-4 py-3">
                  <span className="text-nd-section">{dayLabel(date)}</span>
                  <span className="text-nd-body text-nd-fg-2">
                    사용 <Money value={list.reduce((s, t) => s + (t.approval === "승인" ? t.amount : -t.amount), 0)} flow="expense" />
                  </span>
                </div>
                <TableScroll>
                  <Table size="md" minWidth={860}>
                    <thead>
                      <tr>
                        <Th>시각</Th>
                        <Th>카드</Th>
                        <Th>구분</Th>
                        <Th align="right">금액</Th>
                        <Th>가맹점</Th>
                        <Th>할부</Th>
                        <Th align="right" title="카드사 문자 끝의 잔액 — 신한 법인카드가 붙여 보냅니다(남은 한도로 보임)">
                          문자 속 잔액
                        </Th>
                      </tr>
                    </thead>
                    <tbody>
                      {list
                        .slice()
                        .reverse()
                        .map((t) => (
                          <Tr key={t.id}>
                            <Td className="nd-num">{t.time}</Td>
                            <Td>
                              {cardLabel(t.last4)} <span className="text-nd-fg-3">{t.last4}</span>
                            </Td>
                            <Td>
                              <Badge tone={t.approval === "승인" ? "danger" : "neutral"}>{t.approval}</Badge>
                            </Td>
                            <Td num className="font-semibold">
                              <Money value={t.approval === "승인" ? t.amount : -t.amount} unit={false} flow="expense" />
                            </Td>
                            <Td>{t.merchant ?? ""}</Td>
                            <Td className="text-nd-fg-3">{t.installment ?? ""}</Td>
                            <Td num className="text-nd-fg-2">
                              {t.remaining !== undefined ? <Money value={t.remaining} unit={false} muted /> : ""}
                            </Td>
                          </Tr>
                        ))}
                    </tbody>
                  </Table>
                </TableScroll>
              </Card>
            ))
          )}
          </>
          )}
        </>
      ) : null}
    </PageShell>
  );
}
