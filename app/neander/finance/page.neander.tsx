"use client";

// ============================================================
//  재무 대시보드 — 엑셀 「사업부손익」·「핵심대시보드」 시트의 재현
// ------------------------------------------------------------
//  검증 기준: 2026-07 총수입 41,656,602 / 총지출 58,896,728 /
//             환급 143,700 / 순손익 -17,096,426
//  이 수치가 엑셀과 원 단위로 맞아야 이관이 성공한 것이다.
//
//  화면 구성은 승인 목업을 따른다: 제목 줄(검토 대기·검토하기) →
//  핵심 지표 띠 → [월별 추이 | 이번 달 확인할 항목] → 사업부별 손익 →
//  요약 링크 4장(매트릭스·사업장·거래처·구독). 링크는 장식이 아니라
//  누르면 아래로 펼쳐져 기존 표가 그대로 나온다.
// ============================================================

import Link from "next/link";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Building2,
  CalendarCheck,
  ChevronRight,
  CreditCard,
  Download,
  ExternalLink,
  FolderOpen,
  Grid2x2,
  Inbox,
  TriangleAlert,
  Users,
  type LucideIcon,
} from "lucide-react";
import {
  Badge,
  BasisLine,
  Button,
  Card,
  ChartValues,
  cn,
  DateStepper,
  EmptyState,
  Icon,
  InfoPopover,
  KpiStrip,
  LoadingState,
  Menu,
  Money,
  PageHeader,
  PageShell,
  rampColor,
  rampTextClass,
  SectionHeader,
  SegmentedControl,
  SERIES,
  StatTile,
  StatusDot,
  Table,
  TableNote,
  TableScroll,
  Td,
  Th,
  TotalRow,
  Tr,
} from "@/components/neander/ui";
import { ToolbarPortal } from "@/components/neander/shell/context";
import { useFinance } from "@/components/neander/finance/FinanceProvider";
import { TrendChart } from "@/components/neander/finance/TrendChart";
import {
  availableMonths,
  businessUnitPL,
  expenseMatrix,
  inMonth,
  matrixRows,
  monthlyTrend,
  bySite,
  splitBizKey,
  topVendors,
  totals,
  plOnly,
  BIZ_SEP,
  UNSET,
} from "@/lib/neander/finance/aggregate";
import { ledgerHref } from "@/lib/neander/finance/ledgerLink";
import { AmountBreakdown } from "@/components/neander/finance/AmountBreakdown";
import {
  SUBSCRIPTION_ACCOUNTS,
  subscriptionMatchers,
  subscriptionReport,
} from "@/lib/neander/finance/report";
import {
  netAmount,
  type FinTransaction,
} from "@/lib/neander/finance/types";
import type { MoneyFlow } from "@/components/neander/ui";
import {
  formatSigned,
  monthLabel,
} from "@/lib/neander/format";

/** 빈 칸에 매번 새 배열을 만들지 않는다 (드릴다운의 memo 가 깨진다) */
const NO_ROWS: FinTransaction[] = [];

/** 손익 한 줄이 품은 거래 — 칸(수입·지출·환급)과 줄 전체 */
interface PLBucket {
  all: FinTransaction[];
  수입: FinTransaction[];
  지출: FinTransaction[];
  환급: FinTransaction[];
}
const EMPTY_BUCKET: PLBucket = { all: NO_ROWS, 수입: NO_ROWS, 지출: NO_ROWS, 환급: NO_ROWS };

/**
 * 순손익 칸이 이 거래에서 더하는 값 — 수입·환급은 +, 지출은 −.
 * 합치면 `수입 − (지출 − 환급)` 이라 표의 순손익과 원 단위로 맞는다.
 */
const plDelta = (t: FinTransaction) => (t.txType === "지출" ? -netAmount(t) : netAmount(t));
const PL_NET_NOTE = "순손익 기준 — 지출이 음수(-), 수입·환급이 양수입니다";

/** 히트맵 위 숫자 색 — 음수(환급이 지출을 넘김)는 - 와 함께 붉게 */
function cellTextClass(v: number, max: number): string {
  if (v < 0) return "text-nd-expense-text";
  if (v > 0) return rampTextClass(v, max);
  return "text-nd-fg-4";
}

type Detail = "matrix" | "sites" | "vendors" | "subs";
type Range = "6" | "12" | "all";

const DETAIL_HASHES: Record<Detail, string> = {
  matrix: "#matrix",
  sites: "#sites",
  vendors: "#vendors",
  subs: "#subscriptions",
};

export default function FinanceDashboard() {
  const { transactions, vendorRules, subscriptions, closes, projects, loading, masterEmpty } = useFinance();
  const months = useMemo(() => availableMonths(transactions), [transactions]);
  const [month, setMonth] = useState<string>("");

  // 기본 선택: 가장 최근 달
  const activeMonth = month || months[0] || "";
  const scoped = useMemo(
    () => inMonth(transactions, activeMonth),
    [transactions, activeMonth],
  );

  const t = useMemo(() => totals(plOnly(scoped)), [scoped]);
  const pl = useMemo(() => businessUnitPL(scoped), [scoped]);
  const matrix = useMemo(() => expenseMatrix(scoped), [scoped]);
  const trendAll = useMemo(() => monthlyTrend(transactions), [transactions]);
  const sites = useMemo(() => bySite(scoped), [scoped]);
  const vendors = useMemo(() => topVendors(scoped, 10), [scoped]);
  // 구독 집계는 리포트 탭과 같은 함수를 쓴다 — 계정으로 먼저 좁혀야
  // 이름이 같은 급여 이체가 구독비로 섞이지 않는다 (report.ts 주석 참고)
  const matchers = useMemo(
    () => subscriptionMatchers(subscriptions, vendorRules),
    [subscriptions, vendorRules],
  );
  const subs = useMemo(() => subscriptionReport(scoped, matchers), [scoped, matchers]);

  // 매트릭스 숫자를 누르면 무엇이 들어 있는지 보여준다 — 줄·열·전체 합계는
  // 여러 칸의 거래를 합쳐야 하므로 달이 바뀔 때 한 번만 만들어 둔다.
  const matrixRowRows = useMemo(() => {
    const out: Record<string, FinTransaction[]> = {};
    matrix.rowKeys.forEach((r) => {
      out[r] = matrixRows(matrix, { row: r });
    });
    return out;
  }, [matrix]);
  const matrixColRows = useMemo(() => {
    const out: Record<string, FinTransaction[]> = {};
    matrix.colKeys.forEach((c) => {
      out[c] = matrixRows(matrix, { col: c });
    });
    return out;
  }, [matrix]);
  const matrixAllRows = useMemo(() => matrixRows(matrix), [matrix]);

  // 사업부 손익도 같은 방식으로 연다 — 줄마다, 그리고 칸마다 무엇이 들어
  // 있는지. 한 번 훑으면서 줄 전체와 수입·지출·환급을 동시에 모아 둔다.
  const plRowRows = useMemo(() => {
    const out: Record<string, PLBucket> = {};
    plOnly(scoped).forEach((t) => {
      const key = `${t.bizMajor || UNSET}|${t.bizMinor || UNSET}`;
      const b = (out[key] ??= { all: [], 수입: [], 지출: [], 환급: [] });
      b.all.push(t);
      const bucket = b[t.txType as keyof PLBucket];
      if (Array.isArray(bucket) && bucket !== b.all) bucket.push(t);
    });
    return out;
  }, [scoped]);
  const plAllRows = useMemo(() => {
    const all = plOnly(scoped);
    return {
      all,
      수입: all.filter((t) => t.txType === "수입"),
      지출: all.filter((t) => t.txType === "지출"),
      환급: all.filter((t) => t.txType === "환급"),
    } satisfies PLBucket;
  }, [scoped]);

  const matrixNote = `${monthLabel(activeMonth)} · 환급 차감 반영`;
  const plNote = `${monthLabel(activeMonth)} · 자금거래·카드대금결제 제외`;

  /** 같은 조건이 걸린 채로 원장 열기 (지출·환급만) */
  const matrixHref = (row?: string, col?: string) => {
    const biz = col ? splitBizKey(col) : undefined;
    return ledgerHref({
      month: activeMonth,
      txTypes: ["지출", "환급"],
      acctMajor: row,
      bizMajor: biz?.bizMajor,
      bizMinor: biz?.bizMinor,
    });
  };

  /** 사업부 손익 → 원장. 칸을 누르면 그 거래유형까지 걸린다 */
  const plHref = (biz?: { bizMajor: string; bizMinor: string }, txTypes?: string[]) =>
    ledgerHref({
      month: activeMonth,
      txTypes,
      bizMajor: biz?.bizMajor,
      bizMinor: biz?.bizMinor,
    });

  /** 사업장별 손익 → 원장 */
  const siteHref = (site?: string, txTypes?: string[]) =>
    ledgerHref({ month: activeMonth, txTypes, site });

  const pending = transactions.filter(
    (x) => x.status === "suggested" || x.status === "needs_review",
  ).length;

  // 월별 추이 표시 범위 — 달이 많으면 막대가 가늘어져 최근 12개월이 기본
  const [range, setRange] = useState<Range>("12");
  const trend = useMemo(() => {
    if (range === "all") return trendAll;
    const n = Number(range);
    // 선택한 달을 끝으로 잡는다 (그 달이 최근이 아닐 수도 있다)
    const idx = trendAll.findIndex((p) => p.month === activeMonth);
    const end = idx >= 0 ? idx + 1 : trendAll.length;
    return trendAll.slice(Math.max(0, end - n), end);
  }, [trendAll, range, activeMonth]);

  // 요약 링크 → 펼침 상세. URL 해시로 열린 상태를 남긴다.
  const [detail, setDetail] = useState<Detail | null>(null);
  useEffect(() => {
    // 주소창의 해시를 따른다. 우리가 여는 것은 replaceState 라 hashchange 를
    // 일으키지 않으므로, 여기 걸리는 것은 "밖에서 들어온 링크" 뿐이다
    // (이미 이 화면을 보고 있을 때 #matrix 링크를 눌러도 열린다).
    const apply = () => {
      const h = window.location.hash;
      const hit = (Object.keys(DETAIL_HASHES) as Detail[]).find((k) => DETAIL_HASHES[k] === h);
      setDetail(hit ?? null);
    };
    apply();
    window.addEventListener("hashchange", apply);
    return () => window.removeEventListener("hashchange", apply);
  }, []);
  const toggleDetail = (d: Detail) => {
    const next = detail === d ? null : d;
    setDetail(next);
    const url = next ? DETAIL_HASHES[next] : window.location.pathname;
    window.history.replaceState(null, "", url);
  };
  const detailRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (detail) detailRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [detail]);

  // 월 선택 — ‹ › 와 목록
  const monthIdx = months.indexOf(activeMonth);
  const monthBtnRef = useRef<HTMLButtonElement>(null);
  const [monthOpen, setMonthOpen] = useState(false);

  const closed = useMemo(() => closes.find((c) => c.month === activeMonth), [closes, activeMonth]);
  const activeProjects = useMemo(() => projects.filter((p) => p.status === "active").length, [projects]);

  if (loading) return <LoadingState label="장부를 불러오는 중…" />;

  // 아직 아무것도 없는 상태 — 무엇부터 해야 하는지 알려준다
  if (transactions.length === 0) {
    return (
      <PageShell width="form">
        <PageHeader title="재무" description="통합거래장 · 자동분류 · 손익" />
        <EmptyState
          icon={Download}
          title="아직 거래가 없습니다"
          description={
            masterEmpty
              ? "먼저 마스터에서 계정·계좌 마스터를 적재한 뒤, 엑셀 임포트에서 장부 엑셀을 올리세요."
              : "엑셀 임포트에서 통합거래장 엑셀을 올리면 여기에 손익이 나타납니다."
          }
          action={
            <>
              {masterEmpty && (
                <Link href="/neander/finance/master">
                  <Button>마스터 적재하기</Button>
                </Link>
              )}
              <Link href="/neander/finance/import">
                <Button variant={masterEmpty ? "secondary" : "primary"}>엑셀 임포트</Button>
              </Link>
            </>
          }
        />
      </PageShell>
    );
  }

  const maxCell = Math.max(
    1,
    ...matrix.rowKeys.flatMap((r) => matrix.colKeys.map((c) => matrix.cells[r]?.[c] ?? 0)),
  );
  const mm = activeMonth ? Number(activeMonth.slice(5)) : 0;
  const isLoss = t.net < 0;

  return (
    <PageShell width="wide">
      {/* 상단 툴바: 월 선택 */}
      <ToolbarPortal order={0}>
        <DateStepper
          glass
          onPrev={() => monthIdx < months.length - 1 && setMonth(months[monthIdx + 1])}
          onNext={() => monthIdx > 0 && setMonth(months[monthIdx - 1])}
          prevDisabled={monthIdx >= months.length - 1}
          nextDisabled={monthIdx <= 0}
          prevLabel="이전 달"
          nextLabel="다음 달"
        >
          <button
            ref={monthBtnRef}
            type="button"
            onClick={() => setMonthOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={monthOpen}
            aria-label={`월 선택: ${monthLabel(activeMonth)}`}
            className="nd-num h-8 min-w-[6.5rem] rounded-full px-2 text-nd-body font-semibold text-nd-fg hover:bg-nd-fg/[.06]"
          >
            {monthLabel(activeMonth)}
          </button>
        </DateStepper>
        <Menu
          open={monthOpen}
          onClose={() => setMonthOpen(false)}
          anchorRef={monthBtnRef}
          placement="bottom"
          ariaLabel="월 선택"
          className="max-h-[60vh]"
          items={months.map((m) => ({
            key: m,
            label: monthLabel(m),
            checked: m === activeMonth,
            onSelect: () => setMonth(m),
          }))}
        />
      </ToolbarPortal>

      <PageHeader
        title="재무"
        description="수입과 지출, 사업부 손익을 한눈에."
        className="mb-3"
        meta={
          pending > 0 ? (
            // 미확정 거래가 있으면 캡슐로 눈에 띄게 — 글자와 아이콘이 함께라 색만으로 뜻을 전하지 않는다
            <Link
              href="/neander/finance/review"
              className="inline-flex h-ctl-md items-center gap-1.5 rounded-full border border-nd-warning/40 bg-nd-warning-soft px-3 text-nd-body font-medium text-nd-warning-text transition-colors duration-nd-fast hover:bg-nd-warning/15"
            >
              <Icon icon={TriangleAlert} size={15} />
              검토 대기 {pending.toLocaleString("ko-KR")}건
            </Link>
          ) : (
            <StatusDot tone="success" className="text-nd-body">
              검토 대기 없음
            </StatusDot>
          )
        }
        actions={
          <Link href="/neander/finance/review">
            <Button variant={pending > 0 ? "primary" : "secondary"}>검토하기</Button>
          </Link>
        }
      />

      {/* 집계 기준 — 숫자보다 먼저 "무엇을 세고 무엇을 뺐는지" (aggregate.ts 의 plOnly · totals 그대로) */}
      <BasisLine
        className="mb-5"
        items={["자금거래 · 카드대금결제 제외", "환급은 지출에서 차감", `${monthLabel(activeMonth)} 거래일 기준`]}
      >
        <InfoPopover
          label="집계 기준"
          title="재무 대시보드 집계 기준"
          terms={[
            { term: "집계 대상", desc: "거래유형이 수입·지출·환급인 거래만 셉니다. 자금거래(계좌 간 이동)와 카드대금결제는 돈이 자리만 옮긴 것이라 손익에서 완전히 뺍니다." },
            { term: "금액", desc: "거래의 총액에서 조정액을 뺀 순금액입니다." },
            { term: "총수입", desc: "수입 거래의 순금액 합계." },
            { term: "총지출", desc: "지출 거래의 순금액 합계. 환급을 빼기 전 금액입니다." },
            { term: "환급", desc: "환급 거래의 합계. 순손익에서는 지출에서 차감합니다." },
            { term: "순손익", desc: "총수입 − (총지출 − 환급). 음수는 - 로 표시합니다." },
            { term: "월 기준", desc: "거래일자가 그 달에 속하는 거래. 마감 여부와 무관합니다." },
            { term: "검토 대기", desc: "자동분류가 제안 상태거나 검토 필요로 표시된 거래 수. 집계에는 이미 들어 있습니다." },
          ]}
          footer="이 기준은 원장·리포트·월 마감과 같은 계산 함수를 씁니다."
        />
      </BasisLine>

      {/* 헤드라인 — 하나의 표면, 얇은 선으로 구분 */}
      <KpiStrip columns={4} className="mb-5">
        <StatTile label="총수입" value={t.income} flow="income" accent={SERIES.income} size="lg" />
        <StatTile label="총지출" value={t.expense} flow="expense" accent={SERIES.expense} size="lg" />
        <StatTile label="환급" value={t.refund} flow="income" accent={SERIES.neutral} hint="지출에서 차감" size="lg" />
        <StatTile
          label="순손익"
          value={t.net}
          flow="net"
          accent={isLoss ? "#dc2626" : "#16a34a"}
          hint="수입 − 지출 + 환급"
          size="lg"
          tag={
            <Badge tone={isLoss ? "danger" : "success"} size="sm">
              {isLoss ? "손실" : "이익"}
            </Badge>
          }
        />
      </KpiStrip>

      {/* 월별 추이 + 이번 달 확인할 항목 */}
      <div className="mb-5 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <SectionHeader
            title="월별 추이"
            action={
              trendAll.length > 6 && (
                <SegmentedControl<Range>
                  size="sm"
                  ariaLabel="표시 기간"
                  value={range}
                  onChange={setRange}
                  options={[
                    { value: "6", label: "6개월" },
                    { value: "12", label: "12개월" },
                    { value: "all", label: "전체" },
                  ]}
                />
              )
            }
          />
          {trend.length >= 2 ? (
            <>
              <TrendChart points={trend} />
              {/* 차트와 같은 배열을 표로 — hover 없이도(터치·키보드·낭독기) 정확한 값에 닿는다 */}
              <ChartValues
                className="mt-2"
                note="단위: 원 · 순손익 = 수입 − (지출 − 환급)"
                columns={[
                  { key: "income", label: "수입", color: SERIES.income },
                  { key: "expense", label: "지출", color: SERIES.expense },
                  { key: "net", label: "순손익" },
                ]}
                rows={trend.map((p) => ({
                  key: p.month,
                  label: monthLabel(p.month),
                  values: { income: p.income, expense: p.expense, net: p.net },
                }))}
              />
            </>
          ) : (
            <p className="py-10 text-center text-nd-caption text-nd-fg-3">두 달 이상 쌓이면 추이가 나타납니다.</p>
          )}
        </Card>

        <Card className="flex flex-col">
          <SectionHeader title={mm ? `${mm}월 확인할 항목` : "이번 달 확인할 항목"} />
          <ul className="divide-y divide-nd-line">
            <ChecklistRow
              icon={Inbox}
              title="분류 검토"
              sub={pending > 0 ? `미확정 거래 ${pending.toLocaleString("ko-KR")}건` : "미확정 거래 없음"}
              href="/neander/finance/review"
              tone={pending > 0 ? "warning" : "success"}
            />
            <ChecklistRow
              icon={CalendarCheck}
              title="월 마감"
              sub={
                closed
                  ? `${mm}월 마감됨 · ${new Date(closed.closedAt).toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" })}`
                  : `${mm}월 내역 확인`
              }
              href="/neander/finance/close"
              tone={closed ? "success" : undefined}
            />
            <ChecklistRow
              icon={FolderOpen}
              title="프로젝트"
              sub={activeProjects > 0 ? `진행 중 ${activeProjects}건 · 프로젝트별 수입·지출` : "프로젝트별 수입·지출"}
              href="/neander/finance/projects"
            />
          </ul>
        </Card>
      </div>

      {/* 사업부손익 */}
      <Card padding="none" className="mb-5 overflow-hidden">
        <div className="px-5 pt-5">
          <SectionHeader
            title="사업부별 손익"
            hint="금액을 선택하면 세부 거래를 볼 수 있어요 · 사업구분 축"
            action={
              <>
                <TableNote>단위: 원</TableNote>
                <Link href={plHref()} className="rounded-nd-md">
                  <Button variant="secondary" size="sm" icon={ExternalLink}>
                    원장 열기
                  </Button>
                </Link>
              </>
            }
          />
        </div>
        <TableScroll>
          <Table minWidth={640}>
            <thead>
              <tr>
                <Th className="pl-5">대분류</Th>
                <Th>소분류</Th>
                <Th align="right">수입</Th>
                <Th align="right">지출</Th>
                <Th align="right">환급</Th>
                <Th align="right" className="pr-5">순손익</Th>
              </tr>
            </thead>
            <tbody>
              {pl.rows.map((r) => {
                const key = `${r.bizMajor}|${r.bizMinor}`;
                const bucket = plRowRows[key] ?? EMPTY_BUCKET;
                const name = `${r.bizMajor}${BIZ_SEP}${r.bizMinor}`;
                return (
                  <Tr key={key}>
                    <Td className="pl-5 text-nd-fg-2">{r.bizMajor}</Td>
                    <Td className="font-medium">
                      {/* 줄 이름을 누르면 그 사업부의 이번 달 거래가 통째로 열린다 */}
                      <AmountBreakdown
                        value={r.net}
                        rows={bucket.all}
                        amountOf={plDelta}
                        amountNote={PL_NET_NOTE}
                        label={r.bizMinor}
                        title={`${name} 전체`}
                        subtitle={plNote}
                        ledgerHref={plHref(r)}
                        scope={{ bizKey: name, month: activeMonth }}
                      />
                    </Td>
                    <Td num>
                      <PLCell flow="income" value={r.income} rows={bucket.수입} title={`${name} 수입`} subtitle={plNote} href={plHref(r, ["수입"])} bizKey={name} month={activeMonth} />
                    </Td>
                    <Td num>
                      <PLCell flow="expense" value={r.expense} rows={bucket.지출} title={`${name} 지출`} subtitle={plNote} href={plHref(r, ["지출"])} bizKey={name} month={activeMonth} />
                    </Td>
                    <Td num>
                      <PLCell flow="income" value={r.refund} rows={bucket.환급} title={`${name} 환급`} subtitle={plNote} href={plHref(r, ["환급"])} bizKey={name} month={activeMonth} />
                    </Td>
                    <Td num className="pr-5 font-semibold">
                      <AmountBreakdown
                        value={r.net}
                        rows={bucket.all}
                        amountOf={plDelta}
                        amountNote={PL_NET_NOTE}
                        emptyText="0"
                        title={`${name} 순손익`}
                        subtitle={plNote}
                        ledgerHref={plHref(r)}
                        scope={{ bizKey: name, month: activeMonth }}
                        flow="net"
                      />
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
            <tfoot>
              <TotalRow>
                <Td className="pl-5" colSpan={2}>총계</Td>
                <Td num>
                  <PLCell flow="income" value={pl.total.income} rows={plAllRows.수입} title="전체 수입" subtitle={plNote} href={plHref(undefined, ["수입"])} month={activeMonth} />
                </Td>
                <Td num>
                  <PLCell flow="expense" value={pl.total.expense} rows={plAllRows.지출} title="전체 지출" subtitle={plNote} href={plHref(undefined, ["지출"])} month={activeMonth} />
                </Td>
                <Td num>
                  <PLCell flow="income" value={pl.total.refund} rows={plAllRows.환급} title="전체 환급" subtitle={plNote} href={plHref(undefined, ["환급"])} month={activeMonth} />
                </Td>
                <Td num className="pr-5">
                  <AmountBreakdown
                    value={pl.total.net}
                    rows={plAllRows.all}
                    amountOf={plDelta}
                    amountNote={PL_NET_NOTE}
                    emptyText="0"
                    title="전체 순손익"
                    subtitle={plNote}
                    ledgerHref={plHref()}
                    scope={{ month: activeMonth }}
                    flow="net"
                  />
                </Td>
              </TotalRow>
            </tfoot>
          </Table>
        </TableScroll>
      </Card>

      {/* 요약 링크 — 누르면 아래로 펼쳐진다 */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryLink
          icon={Grid2x2}
          title="사업부 지출 매트릭스"
          sub="계정대분류 × 사업부 지출을 한눈에"
          active={detail === "matrix"}
          onClick={() => toggleDetail("matrix")}
          controls="fin-detail"
          preview={
            matrix.rowKeys.length > 0 && (
              <MiniHeatmap matrix={matrix} max={maxCell} />
            )
          }
        />
        <SummaryLink
          icon={Building2}
          title="사업장별 손익"
          sub={`법인 ${sites.length}곳의 수입과 지출`}
          active={detail === "sites"}
          onClick={() => toggleDetail("sites")}
          controls="fin-detail"
        />
        <SummaryLink
          icon={Users}
          title="상위 거래처"
          sub="지출 기준 상위 10곳"
          active={detail === "vendors"}
          onClick={() => toggleDetail("vendors")}
          controls="fin-detail"
        />
        <SummaryLink
          icon={CreditCard}
          title="구독 서비스"
          sub={subs.count > 0 ? `${subs.services.length}개 서비스 · ${formatSigned(subs.services.reduce((s, x) => s + x.net, 0))}원` : "이번 달 구독 지출 없음"}
          active={detail === "subs"}
          onClick={() => toggleDetail("subs")}
          controls="fin-detail"
        />
      </div>

      <div id="fin-detail" ref={detailRef} className={cn(detail && "mt-4")}>
        {detail === "matrix" && (
          <Card padding="none" className="overflow-hidden">
            <div className="px-5 pt-5">
              <SectionHeader
                title="계정대분류 × 사업부 지출"
                hint="색이 진할수록 지출이 큼 · 숫자에 올리면 내역, 누르면 창"
                action={<TableNote>단위: 원</TableNote>}
              />
            </div>
            {matrix.rowKeys.length === 0 ? (
              <p className="px-5 pb-6 text-nd-caption text-nd-fg-3">이 달에는 지출이 없습니다.</p>
            ) : (
              <TableScroll>
                <Table>
                  <thead>
                    <tr>
                      <Th sticky="left" className="pl-5">계정대분류</Th>
                      {matrix.colKeys.map((c) => (
                        <Th key={c} align="right" className="px-2.5">{c}</Th>
                      ))}
                      <Th align="right" className="pr-5">합계</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {matrix.rowKeys.map((r) => (
                      <Tr key={r} hover={false}>
                        <Td sticky="left" className="pl-5 font-medium">{r}</Td>
                        {matrix.colKeys.map((c) => {
                          const v = matrix.cells[r]?.[c] ?? 0;
                          return (
                            <Td key={c} num className="px-2.5" style={{ backgroundColor: rampColor(v, maxCell) }}>
                              <AmountBreakdown
                                value={v}
                                rows={matrix.cellRows[r]?.[c] ?? NO_ROWS}
                                title={`${r} × ${c}`}
                                subtitle={matrixNote}
                                ledgerHref={matrixHref(r, c)}
                                scope={{ acctMajor: r, bizKey: c, month: activeMonth }}
                                className={cellTextClass(v, maxCell)}
                              />
                            </Td>
                          );
                        })}
                        <Td num className="pr-5 font-semibold">
                          <AmountBreakdown
                            value={matrix.rowTotals[r] ?? 0}
                            rows={matrixRowRows[r] ?? NO_ROWS}
                            title={`${r} 합계`}
                            subtitle={matrixNote}
                            ledgerHref={matrixHref(r)}
                            scope={{ acctMajor: r, month: activeMonth }}
                          />
                        </Td>
                      </Tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <TotalRow>
                      <Td sticky="left" className="!bg-nd-sunken pl-5">합계</Td>
                      {matrix.colKeys.map((c) => (
                        <Td key={c} num className="px-2.5">
                          <AmountBreakdown
                            value={matrix.colTotals[c] ?? 0}
                            rows={matrixColRows[c] ?? NO_ROWS}
                            title={`${c} 합계`}
                            subtitle={matrixNote}
                            ledgerHref={matrixHref(undefined, c)}
                            scope={{ bizKey: c, month: activeMonth }}
                          />
                        </Td>
                      ))}
                      <Td num className="pr-5">
                        <AmountBreakdown
                          value={matrix.grandTotal}
                          rows={matrixAllRows}
                          title="전체 합계"
                          subtitle={matrixNote}
                          ledgerHref={matrixHref()}
                          scope={{ month: activeMonth }}
                        />
                      </Td>
                    </TotalRow>
                  </tfoot>
                </Table>
              </TableScroll>
            )}
          </Card>
        )}

        {detail === "sites" && (
          <Card padding="none" className="overflow-hidden">
            <div className="px-5 pt-5">
              <SectionHeader title="사업장별 손익" hint="법인 단위" action={<TableNote>단위: 원</TableNote>} />
            </div>
            <TableScroll>
              <Table minWidth={520}>
                <thead>
                  <tr>
                    <Th className="pl-5">사업장</Th>
                    <Th align="right">수입</Th>
                    <Th align="right">지출</Th>
                    <Th align="right" className="pr-5">순손익</Th>
                  </tr>
                </thead>
                <tbody>
                  {sites.map((s) => {
                    // 사업장 이름은 「이 줄 전체」 를 여는 자리다 (AmountBreakdown 의 label).
                    // 칸마다 따로 열 수도 있어야 해서 수입·지출·순손익도 각각 연다 —
                    // 사업부 손익 표와 같은 규칙이라 두 표에서 손이 달라지지 않는다.
                    const inc = s.rows.filter((t) => t.txType === "수입");
                    const exp = s.rows.filter((t) => t.txType === "지출");
                    return (
                      <Tr key={s.site}>
                        <Td className="pl-5 font-medium">
                          <AmountBreakdown
                            value={s.t.net}
                            rows={s.rows}
                            amountOf={plDelta}
                            amountNote={PL_NET_NOTE}
                            label={s.site}
                            title={`${s.site} 손익`}
                            subtitle={plNote}
                            ledgerHref={siteHref(s.site)}
                            scope={{ month: activeMonth }}
                          />
                        </Td>
                        <Td num>
                          <PLCell flow="income" value={s.t.income} rows={inc} title={`${s.site} 수입`} subtitle={plNote} href={siteHref(s.site, ["수입"])} month={activeMonth} />
                        </Td>
                        <Td num>
                          <PLCell flow="expense" value={s.t.expense} rows={exp} title={`${s.site} 지출`} subtitle={plNote} href={siteHref(s.site, ["지출"])} month={activeMonth} />
                        </Td>
                        <Td num className="pr-5 font-semibold">
                          <AmountBreakdown
                            value={s.t.net}
                            rows={s.rows}
                            amountOf={plDelta}
                            amountNote={PL_NET_NOTE}
                            emptyText="0"
                            title={`${s.site} 순손익`}
                            subtitle={plNote}
                            ledgerHref={siteHref(s.site)}
                            scope={{ month: activeMonth }}
                            flow="net"
                          />
                        </Td>
                      </Tr>
                    );
                  })}
                </tbody>
              </Table>
            </TableScroll>
          </Card>
        )}

        {detail === "vendors" && (
          <Card padding="none" className="overflow-hidden">
            <div className="px-5 pt-5">
              <SectionHeader title="거래처" hint="지출 기준 상위 10" action={<TableNote>단위: 원</TableNote>} />
            </div>
            {vendors.length === 0 ? (
              <p className="px-5 pb-6 text-nd-caption text-nd-fg-3">지출 거래가 없습니다.</p>
            ) : (
              <TableScroll>
                <Table minWidth={420}>
                  <thead>
                    <tr>
                      <Th className="pl-5">거래처</Th>
                      <Th align="right">건수</Th>
                      <Th align="right" className="pr-5">지출</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {vendors.map((v) => (
                      <Tr key={v.vendor}>
                        <Td className="pl-5">
                          <span className="block max-w-[28rem] truncate" title={v.vendor}>{v.vendor}</span>
                        </Td>
                        <Td num muted>{v.count}건</Td>
                        <Td num className="pr-5 font-medium"><Money value={v.amount} unit={false} flow="expense" /></Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              </TableScroll>
            )}
          </Card>
        )}

        {detail === "subs" && (
          <Card>
            <SectionHeader
              title="구독 서비스 지출"
              hint={`계정 ${SUBSCRIPTION_ACCOUNTS.join("·")} 안에서 거래처 규칙 매칭`}
              action={
                <Link href="/neander/finance/reports/subscriptions" className="inline-flex items-center gap-1 text-nd-caption font-medium text-nd-accent-strong hover:underline">
                  리포트에서 자세히 <Icon icon={ChevronRight} size={14} />
                </Link>
              }
            />
            {subs.count === 0 ? (
              <p className="text-nd-caption text-nd-fg-3">이 달에는 구독 지출이 없습니다.</p>
            ) : (
              <div className="grid gap-x-8 gap-y-0 sm:grid-cols-2 lg:grid-cols-3">
                {subs.services.map((s) => (
                  <div key={s.service} className="flex items-center justify-between gap-3 border-b border-nd-line py-2 text-nd-table">
                    <span className="min-w-0 truncate text-nd-fg" title={s.service}>{s.service}</span>
                    <span className="flex shrink-0 items-center gap-3">
                      <span className="nd-num text-nd-caption text-nd-fg-3">{s.count}건</span>
                      <Money value={s.net} unit={false} flow="expense" />
                    </span>
                  </div>
                ))}
              </div>
            )}
            {subs.unmatched.length > 0 && (
              <p className="mt-3 text-nd-caption text-nd-fg-2">
                규칙에 없는 구독 {subs.unmatched.length}건 <Money value={subs.unmatchedTotal} unit={false} flow="expense" />원 —{" "}
                <Link href="/neander/finance/master" className="font-medium text-nd-accent-strong hover:underline">
                  마스터에서 거래처 규칙을 추가
                </Link>
                하세요.
              </p>
            )}
          </Card>
        )}
      </div>
    </PageShell>
  );
}

// ---- 부품 ------------------------------------------------------

/**
 * 사업부 손익의 수입·지출·환급 칸.
 *
 * 한 칸에는 거래유형이 한 가지뿐이라 금액은 늘 양수다 — 그래서 매트릭스의
 * 기본값(환급을 음수로 보는 `matrixDelta`) 대신 `netAmount` 를 쓴다.
 * 그러지 않으면 환급 칸의 창 합계만 부호가 뒤집혀 표와 어긋난다.
 */
function PLCell({
  value,
  rows,
  title,
  subtitle,
  href,
  bizKey,
  month,
  flow,
}: {
  value: number;
  rows: FinTransaction[];
  title: string;
  subtitle: string;
  href: string;
  bizKey?: string;
  month: string;
  /** 수입 칸은 수입, 지출 칸은 지출, 환급 칸은 되돌아온 돈이라 수입 */
  flow: MoneyFlow;
}) {
  return (
    <AmountBreakdown
      value={value}
      rows={rows}
      amountOf={netAmount}
      emptyText="0"
      title={title}
      subtitle={subtitle}
      ledgerHref={href}
      scope={{ bizKey, month }}
      amountNote=""
      flow={flow}
      className={value ? undefined : "text-nd-fg-4"}
    />
  );
}

function ChecklistRow({
  icon,
  title,
  sub,
  href,
  tone,
}: {
  icon: LucideIcon;
  title: string;
  sub: string;
  href: string;
  tone?: "warning" | "success";
}) {
  return (
    <li>
      <Link
        href={href}
        className="-mx-2 flex items-center gap-3 rounded-nd-md px-2 py-3 transition-colors duration-nd-fast hover:bg-nd-sunken"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-nd-md bg-nd-sunken text-nd-fg-2">
          <Icon icon={icon} size={18} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-nd-body font-semibold text-nd-fg">{title}</span>
          <span className={cn("block truncate text-nd-caption", tone === "warning" ? "text-nd-warning-text" : tone === "success" ? "text-nd-success-text" : "text-nd-fg-3")}>
            {sub}
          </span>
        </span>
        <Icon icon={ChevronRight} size={16} className="text-nd-fg-4" />
      </Link>
    </li>
  );
}

function SummaryLink({
  icon,
  title,
  sub,
  active,
  onClick,
  controls,
  preview,
}: {
  icon: LucideIcon;
  title: string;
  sub: string;
  active: boolean;
  onClick: () => void;
  controls: string;
  preview?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={active}
      aria-controls={controls}
      className={cn(
        "nd-surface flex items-center gap-3 rounded-nd-lg p-4 text-left transition-colors duration-nd-fast hover:bg-nd-sunken",
        active && "ring-2 ring-nd-accent/60",
      )}
    >
      {preview ? (
        <span className="shrink-0">{preview}</span>
      ) : (
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-nd-md bg-nd-sunken text-nd-fg-2">
          <Icon icon={icon} size={20} />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block text-nd-body font-semibold text-nd-fg">{title}</span>
        <span className="block truncate text-nd-caption text-nd-fg-3">{sub}</span>
      </span>
      <Icon
        icon={ChevronRight}
        size={16}
        className={cn("shrink-0 text-nd-fg-4 transition-transform duration-nd-fast", active && "rotate-90 text-nd-accent")}
      />
    </button>
  );
}

/** 매트릭스 썸네일 — 실제 값의 농도를 그대로 축소 */
function MiniHeatmap({
  matrix,
  max,
}: {
  matrix: ReturnType<typeof expenseMatrix>;
  max: number;
}) {
  const rows = matrix.rowKeys.slice(0, 6);
  const cols = matrix.colKeys.slice(0, 8);
  return (
    <span
      aria-hidden
      className="grid gap-px overflow-hidden rounded-[6px] bg-nd-fg/10 p-px"
      style={{ gridTemplateColumns: `repeat(${cols.length}, 7px)` }}
    >
      {rows.map((r) =>
        cols.map((c) => (
          <span
            key={`${r}|${c}`}
            className="block h-[7px] w-[7px]"
            style={{ backgroundColor: rampColor(matrix.cells[r]?.[c] ?? 0, max) || "#fff", opacity: (matrix.cells[r]?.[c] ?? 0) > 0 ? 1 : 0.5, background: (matrix.cells[r]?.[c] ?? 0) > 0 ? rampColor(matrix.cells[r]?.[c] ?? 0, max) : "#fff" }}
          />
        )),
      )}
    </span>
  );
}
