"use client";

// ============================================================
//  매출 › AC'SCENT 대시보드 — 엑셀 「통합BEP」 시트의 재현
// ------------------------------------------------------------
//  ⚠️ 이 화면은 "얼마 벌었나"를 말하지 않는다. 매장 매출은 카드사 정산
//     입금·Npay 정산으로 재무 장부에 이미 들어와 있다. 여기서 답하는 것은
//     **단위경제**다 — 무엇을 몇 개 팔아 얼마 남겼나.
//
//  ⚠️ 이익률의 분모는 **확정 매출**이다 (상품이 정해진 줄만).
//     미확정 매출을 분모에 넣고 원가는 0 으로 두면 이익률이 부풀려지고,
//     엑셀처럼 평균원가율로 메우면 원가가 사실과 달라진다. 둘 다 수량과
//     금액을 다른 모집단에서 가져오는 오류다. 그래서 확정분으로만 계산하고
//     미확정 금액을 화면에 항상 같이 띄운다.
//
//  검증 (2026-07, npm run sales:verify): 원본 합계 24,467,300 원 단위 일치.
//  엑셀과의 차이는 세 가지로만 설명된다 — ① 미확정 매출 제외
//  ② 인건비 이중계상 해소 +1,295,000 ③ 이벤트 기간 밖 +30,000.
//
//  화면 구성은 재무 대시보드와 한 벌이다 (승인 목업): 제목 줄 + 계산 기준 →
//  핵심 지표 띠 → 미확정 띠 → [월별 추이 | 매장별 매출] → 매장별 손익 구조 →
//  매장별 손익 표 → 상시·이벤트 · 상위 상품 → 하위 화면 타일.
//  긴 설명은 「계산 기준」 도움말로 넘겼고, 판단에 필요한 상태(미확정
//  건수·금액·제외 여부)는 화면에 남긴다.
// ============================================================

import {
  useMemo,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  Boxes,
  Download,
  Inbox,
  Package,
  Scale,
  CalendarPlus,
  TriangleAlert,
} from "lucide-react";
import {
  Badge,
  BasisLine,
  Button,
  Card,
  ChartValues,
  cn,
  EmptyState,
  ErrorState,
  Icon,
  InfoPopover,
  InlineNotice,
  KpiItem,
  KpiStrip,
  LinkTile,
  LoadingState,
  Money,
  MonthStepper,
  PageHeader,
  PageShell,
  SectionHeader,
  SegmentedControl,
  Select,
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
import { useSales } from "@/components/neander/sales/SalesProvider";
import { pnlSegmentDetail, type PnlDetail } from "@/lib/neander/sales/pnl-detail";
import {
  PnlBar,
  PnlBarLegend,
  ProductCell,
  Rate,
  SalesDrill,
  STORE_SERIES,
  STORE_TOTAL_COLOR,
  StoreBadge,
  pnlBarExtent,
  type SalesDrillProps,
} from "@/components/neander/sales/ui";
import { TermLabel } from "@/components/neander/sales/TermHint";
import { MonthTrendChart } from "@/components/neander/sales/MonthTrendChart";
import {
  TREND_METRICS,
  availableMonths,
  buildPnl,
  buildProductPerf,
  inMonth,
  lineFee,
  lineMaterial,
  monthlyTrend,
  productIndex,
  type StorePnl,
  type TrendMetric,
} from "@/lib/neander/sales/aggregate";
import {
  SALES_STORES,
  pct,
  storeLabel,
  type SalesLine,
  type SalesStore,
} from "@/lib/neander/sales/types";
import { monthLabel } from "@/lib/neander/format";
import { buildEventPerf, type EventPerf } from "@/lib/neander/sales/aggregate";
import { Disclosure, SortTh, type SortState } from "@/components/neander/ui";
import { LABOR_REASON_LABEL, type StoreLabor } from "@/lib/neander/sales/labor";
import type { SalesAssumptions } from "@/lib/neander/sales/types";

/** 이벤트별 손익 표를 정렬할 수 있는 열 */
type EventSortKey = "name" | "from" | "revenue" | "variable" | "contribution" | "rate" | "perDay";
const EVENT_SORT_VALUE: Record<EventSortKey, (e: EventPerf) => string | number | null> = {
  name: (e) => e.event.name,
  from: (e) => e.event.from,
  revenue: (e) => e.revenue,
  variable: (e) => e.variable,
  contribution: (e) => e.contribution,
  rate: (e) => e.contributionRate,
  perDay: (e) => e.contributionPerDay,
};

// ---- 인건비 출처 · 내역 -------------------------------------------

const wonText = (n: number) => Math.round(n).toLocaleString("ko-KR");
const hoursText = (h: number) => `${(Math.round(h * 10) / 10).toLocaleString("ko-KR")}시간`;

/** 인건비 칸의 출처 — 실측(근무 일지) · 추정(가정값). 색만이 아니라 글자로 */
function LaborTag({ labor }: { labor: StoreLabor }) {
  const actual = labor.source === "actual";
  return (
    <Badge size="sm" tone={actual ? "accent" : "neutral"} className="shrink-0">
      <span className="sr-only">인건비 출처 </span>
      {actual ? "실측" : "추정"}
    </Badge>
  );
}

function LaborStat({
  label,
  value,
  hint,
  strong = false,
  warning = false,
}: {
  label: string;
  value: string;
  hint?: string;
  strong?: boolean;
  warning?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-nd-fg-3">{label}</dt>
      <dd
        className={cn(
          "nd-num text-nd-body",
          strong ? "font-semibold text-nd-fg" : "text-nd-fg",
          warning && "text-nd-warning-text",
        )}
      >
        {value}
      </dd>
      {hint && <dd className="text-nd-micro text-nd-fg-3">{hint}</dd>}
    </div>
  );
}

/**
 * 인건비 내역 — 매장마다 출처와 합계, 실측이면 직원별 시간·금액.
 * 「정직원 가정 시급 환산」은 실제로 나간 돈이 아니다 — 정직원은 급여 0 으로
 * 기록되어, 근무시간 × 가정 시급으로 채워 넣은 몫이라 따로 드러낸다.
 */
function LaborBreakdown({
  stores,
  assumptions,
  warnings,
}: {
  stores: StorePnl[];
  assumptions: SalesAssumptions;
  warnings: string[];
}) {
  return (
    <div className="flex flex-col gap-6">
      {stores
        .filter((s) => s.store !== "online")
        .map((s) => {
          const L = s.labor;
          const act = L.actual;
          return (
            <section key={s.store} className="min-w-0">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <StoreBadge store={s.store} size="sm" />
                <LaborTag labor={L} />
                <span className="text-nd-caption text-nd-fg-2">{LABOR_REASON_LABEL[L.reason]}</span>
              </div>
              {!act ? (
                <p className="text-nd-caption text-nd-fg-2">
                  {s.store === "id"
                    ? `상시 인건비 ${wonText(L.regularLabor)}원 = 하루 ${assumptions.idOps.hoursPerDay}시간 × ${assumptions.idOps.daysPerMonth}일 × 시급 ${wonText(assumptions.wage.idRegular)}원`
                    : `이벤트 인건비 ${wonText(L.eventLaborTotal)}원 = 이벤트마다 운영일 × 하루 시간 × 스태프 × 시급(기본 ${wonText(assumptions.wage.eventStaff)}원)`}
                </p>
              ) : (
                <>
                  <dl className="mb-3 grid grid-cols-2 gap-x-6 gap-y-3 text-nd-caption sm:grid-cols-3 xl:grid-cols-6">
                    <LaborStat label="근무" value={hoursText(act.hours)} hint={`${act.recordDays}일 · ${act.shifts}건`} />
                    <LaborStat label="알바 지급" value={`${wonText(act.paid)}원`} hint="근무 일지에 저장된 급여" />
                    <LaborStat label="주휴수당" value={`${wonText(act.holiday)}원`} hint="주 15시간 이상" />
                    <LaborStat
                      label="정직원 가정 시급 환산"
                      value={`${wonText(act.staffEquivalent)}원`}
                      hint={`${hoursText(act.staffHours)} × ${wonText(act.staffWage)}원 · 실제 지급 없음`}
                      warning={act.staffEquivalent > 0}
                    />
                    <LaborStat label="합계" value={`${wonText(act.total)}원`} strong />
                    <LaborStat
                      label="들어간 칸"
                      value={s.store === "wow" ? `이벤트 ${wonText(act.eventShare)}원` : "상시 인건비"}
                      hint={s.store === "wow" ? `이벤트 없는 날 ${wonText(act.commonShare)}원 → 상시 인건비` : undefined}
                    />
                  </dl>
                  <TableScroll>
                    <Table minWidth={620} dense>
                      <thead>
                        <tr>
                          <Th className="pl-0">직원</Th>
                          <Th>구분</Th>
                          <Th align="right">시간</Th>
                          <Th align="right">지급</Th>
                          <Th align="right">주휴수당</Th>
                          <Th align="right" className="pr-0">가정 시급 환산</Th>
                        </tr>
                      </thead>
                      <tbody>
                        {act.employees.map((p) => (
                          <Tr key={p.id}>
                            <Td className="pl-0">{p.name}</Td>
                            <Td>
                              {p.unknown ? (
                                <Badge size="sm" tone="warning">목록에 없음</Badge>
                              ) : p.staff ? (
                                <Badge size="sm">정직원</Badge>
                              ) : (
                                <span className="text-nd-fg-2">알바</span>
                              )}
                            </Td>
                            <Td num>{hoursText(p.hours)}</Td>
                            <Td num>
                              <Money value={p.paid} unit={false} muted={p.paid === 0} flow="expense" />
                            </Td>
                            <Td num>
                              <Money value={p.holiday} unit={false} muted={p.holiday === 0} flow="expense" />
                            </Td>
                            <Td num className="pr-0">
                              {p.staffHours > 0 ? (
                                <span className="text-nd-warning-text">{wonText(p.staffHours * act.staffWage)}</span>
                              ) : (
                                <span className="text-nd-fg-4">0</span>
                              )}
                            </Td>
                          </Tr>
                        ))}
                      </tbody>
                    </Table>
                  </TableScroll>
                </>
              )}
            </section>
          );
        })}
      {warnings.length > 0 && <TableNote className="pt-0 text-nd-warning-text">{warnings.join(" ")}</TableNote>}
      <TableNote className="pt-0">
        실측 = 근무 일지(AC&apos;SCENT 관리자 › 근무 일지)의 저장된 급여 + 주휴수당(급여 보고서와 같은 규칙 · 그 주의
        마지막 근무일이 속한 달) + 정직원 근무시간 × 가정 시급. 3.3% 원천징수는 직원 몫이라 더하지 않습니다. 와우는
        날마다 그날 열린 이벤트(이 달 시작)에 똑같이 나누고, 이벤트가 없는 날은 상시 인건비로 둡니다. 가정값과는
        더하지 않습니다.
      </TableNote>
    </div>
  );
}

/** 드릴 설정 — children 만 뺀다 (lines·detail 두 갈래가 섞이지 않게 갈래마다) */
type DrillSpec = SalesDrillProps extends infer T ? (T extends unknown ? Omit<T, "children"> : never) : never;

/** 0 이면 드릴 없이 그대로 — 열어 볼 내역이 없다 */
function drill(value: number, node: ReactNode, spec: DrillSpec): ReactNode {
  if (Math.round(value) === 0) return node;
  return <SalesDrill {...(spec as SalesDrillProps)}>{node}</SalesDrill>;
}

/** 추이 표시 범위 — 달이 많으면 막대가 가늘어져 최근 12개월이 기본 */
type TrendRange = "6" | "12" | "all";

/** 매장 손익 → 막대 입력. 인건비는 집계의 세 갈래를 합친다 (표의 인건비 열과 같은 정의) */
const barInput = (s: StorePnl) => ({
  revenue: s.revenue,
  confirmedRevenue: s.confirmedRevenue,
  pendingRevenue: s.pendingRevenue,
  material: s.variable.material,
  labor: s.variable.eventLabor + s.variable.makeLabor + s.variable.serviceLabor,
  supplies: s.variable.supplies,
  fee: s.variable.fee,
  // 고정비에서 상시 인건비를 떼어 따로 칠한다 — 합은 fixedTotal 그대로
  fixed: s.allocatedFixed,
  regularLabor: s.regularLabor,
  operating: s.operating,
});

export default function SalesDashboard() {
  const { lines, products, events, assumptions, loading, masterEmpty, error, labor } = useSales();
  // 근무 일지 실측 — 손익·추이·이벤트 세 집계가 같은 맥락을 받아야 숫자가 갈라지지 않는다
  const laborCtx = useMemo(() => ({ actuals: labor }), [labor]);
  const months = useMemo(() => availableMonths(lines, events), [lines, events]);
  const idx = useMemo(() => productIndex(products), [products]);
  const [month, setMonth] = useState<string>("");
  const activeMonth = month || months[0] || "";

  const pnl = useMemo(
    () => buildPnl(activeMonth, lines, products, events, assumptions, laborCtx),
    [activeMonth, lines, products, events, assumptions, laborCtx],
  );
  const perf = useMemo(
    () => buildProductPerf(activeMonth, lines, products, assumptions),
    [activeMonth, lines, products, assumptions],
  );

  /**
   * 이벤트별 손익 — 이벤트 입력 화면의 「실적」과 **같은 계산**(buildEventPerf)이다.
   * 대시보드에서 따로 세면 두 화면의 숫자가 갈라진다.
   * 시작일이 이 달인 이벤트만 센다 (월말에 걸친 행사는 시작한 달에 잡힌다).
   */
  const eventPerf = useMemo(
    () => buildEventPerf(activeMonth, lines, products, events, assumptions, laborCtx),
    [activeMonth, lines, products, events, assumptions, laborCtx],
  );
  // 열 제목을 눌러 정렬한다 — 기본은 시작일 순 (합계 줄은 정렬과 무관하게 맨 아래)
  const [eventSort, setEventSort] = useState<SortState<EventSortKey>>({ key: "from", dir: "asc" });
  const eventRows = useMemo(() => {
    const get = EVENT_SORT_VALUE[eventSort.key];
    const sign = eventSort.dir === "asc" ? 1 : -1;
    return [...eventPerf].sort((a, b) => {
      const va = get(a);
      const vb = get(b);
      // 이익률이 없는 줄(확정 매출 0)은 방향과 상관없이 맨 뒤로
      if (va === null || vb === null) return va === vb ? 0 : va === null ? 1 : -1;
      const c = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb), "ko");
      return c * sign || a.event.from.localeCompare(b.event.from);
    });
  }, [eventPerf, eventSort]);
  const eventTotal = useMemo(() => {
    // 줄마다 **보이는 원 단위 값**을 더한다. 수수료에 원 미만이 있어, 소수째 더한 뒤
    // 반올림하면 합계 줄이 줄의 합과 1원씩 어긋난다(2608 실측: 변동비 2,871,546 vs 547).
    const t = eventPerf.reduce(
      (acc, e) => ({
        revenue: acc.revenue + Math.round(e.revenue),
        confirmed: acc.confirmed + Math.round(e.confirmedRevenue),
        pending: acc.pending + Math.round(e.pendingRevenue),
        variable: acc.variable + Math.round(e.variable),
        contribution: acc.contribution + Math.round(e.contribution),
        days: acc.days + e.days,
      }),
      { revenue: 0, confirmed: 0, pending: 0, variable: 0, contribution: 0, days: 0 },
    );
    return {
      ...t,
      rate: t.confirmed ? t.contribution / t.confirmed : null,
      perDay: t.days ? Math.round(t.contribution / t.days) : 0,
    };
  }, [eventPerf]);

  // 월별 추이 — 매장별 그룹 막대
  const [metric, setMetric] = useState<TrendMetric>("revenue");
  const [range, setRange] = useState<TrendRange>("12");
  const trendAll = useMemo(
    () => monthlyTrend(lines, products, events, assumptions, laborCtx),
    [lines, products, events, assumptions, laborCtx],
  );
  const trend = useMemo(() => {
    // 선택한 달을 끝으로 잡는다 (그 달이 최근이 아닐 수도 있다)
    const idx = trendAll.findIndex((p) => p.month === activeMonth);
    const end = idx >= 0 ? idx + 1 : trendAll.length;
    const n = range === "all" ? trendAll.length : Number(range);
    return trendAll.slice(Math.max(0, end - n), end).map((p) => {
      const values: Record<string, number> = Object.fromEntries(
        (Object.keys(p.byStore) as SalesStore[]).map((k) => [k, p.byStore[k][metric]]),
      );
      // 매장 셋을 합친 막대(회색) — 그래프와 아래 값 표가 같은 숫자를 쓰게 여기서 한 번만 센다
      values.total = SALES_STORES.reduce((a, s2) => a + (values[s2.value] ?? 0), 0);
      return { month: p.month, values };
    });
  }, [trendAll, range, activeMonth, metric]);
  const metricMeta = TREND_METRICS.find((m) => m.value === metric);

  if (loading) return <LoadingState label="매출을 불러오는 중…" />;

  if (error) {
    return (
      <PageShell width="form">
        <PageHeader title="AC'SCENT 대시보드" description="매장별 수량 · 원가 · 공헌이익" />
        <ErrorState
          title="매출 데이터를 불러올 수 없습니다"
          description={error instanceof Error ? error.message : "알 수 없는 오류"}
        />
      </PageShell>
    );
  }

  // 아직 아무것도 없는 상태 — 무엇부터 해야 하는지 알려준다
  if (masterEmpty || lines.length === 0) {
    return (
      <PageShell width="form">
        <PageHeader title="AC'SCENT 대시보드" description="매장별 수량 · 원가 · 공헌이익" />
        <EmptyState
          icon={masterEmpty ? Package : Download}
          title={masterEmpty ? "아직 상품 마스터가 없습니다" : "아직 적재된 판매가 없습니다"}
          description={
            masterEmpty
              ? "상품과 기본가정(고정비·시급·수수료율)을 먼저 적재해야 공헌이익을 계산할 수 있습니다."
              : "매출 적재에서 페이히어·네이버 예약 파일을 올리면 여기에 손익이 나타납니다."
          }
          action={
            <>
              {masterEmpty && (
                <Link href="/neander/sales/master">
                  <Button>마스터 적재하기</Button>
                </Link>
              )}
              <Link href="/neander/sales/import">
                <Button variant={masterEmpty ? "secondary" : "primary"}>매출 적재</Button>
              </Link>
            </>
          }
        />
      </PageShell>
    );
  }

  const t = pnl.total;
  const lineCount = pnl.stores.reduce((s, x) => s + x.count, 0);
  const reviewShare = t.revenue ? t.reviewAmount / t.revenue : null;
  // 손익 막대 축 — 매장들 중 가장 긴 것(손실이면 비용이 매출보다 길다)
  const barScale = Math.max(1, ...pnl.stores.map((s) => pnlBarExtent(barInput(s))));
  const maxStoreRevenue = Math.max(0, ...pnl.stores.map((s) => s.revenue));
  // 끝난 달은 근무 일지 실측, 진행 중이거나 기록이 없는 달은 가정값 (labor.ts)
  const laborNote = `제작${assumptions.laborMode === "excel" ? " · 접객(엑셀 재현 모드 · 추정 달만)" : ""} · 이벤트 스태프(근무 일지 실측 · 없으면 가정값)`;
  const alloc = `${Math.round(assumptions.allocation.wow * 100)}:${Math.round(assumptions.allocation.id * 100)}`;

  // ---- 숫자 드릴 — 커서를 두면 내역, 누르면 전체 창 -----------------------
  //  ⚠️ 창 합계 = 칸의 숫자 (원 단위). 거름은 buildPnl · buildEventPerf ·
  //     buildProductPerf 와 똑같이 — 이 달 · 이 매장 · 확정만(원가·수수료).
  const sub = monthLabel(activeMonth);
  const detailCtx = { month: activeMonth, lines, products, events, assumptions };
  const monthLines = () => lines.filter((l) => inMonth(l.date, activeMonth));
  const storeLines = (store: SalesStore) => monthLines().filter((l) => l.store === store);
  const isConfirmed = (l: SalesLine) => l.status !== "needs_review";
  const materialOf = (l: SalesLine) => lineMaterial(l, idx);
  const feeOf = (l: SalesLine) => lineFee(l, assumptions);
  const pendingHref = { href: "/neander/sales/review", hrefLabel: "검토 대기함" };
  /** 매장 한 칸의 계산 내역 (막대 창과 같은 표) */
  const segment = (key: Parameters<typeof pnlSegmentDetail>[0], s: StorePnl) => () =>
    pnlSegmentDetail(key, s, detailCtx);
  /** 합계 줄의 계산 칸 — 매장별로 나눠 본다 */
  const perStore = (
    key: string,
    title: string,
    valueOf: (s: StorePnl) => number,
    direction: "expense" | "net",
  ) => (): PnlDetail => ({
    key: `total-${key}`,
    title,
    formula: false,
    direction,
    total: pnl.stores.reduce((a, s) => a + valueOf(s), 0),
    rows: pnl.stores
      .map((s) => ({ key: s.store, label: storeLabel(s.store), value: valueOf(s) }))
      .filter((r) => r.value !== 0),
    basis: "매장별 합",
  });
  const variableLabor = (s: { variable: StorePnl["variable"] }) =>
    s.variable.eventLabor + s.variable.makeLabor + s.variable.serviceLabor;
  // 이벤트 합계 줄 — 이 달에 시작한 이벤트에 붙은 판매
  const eventIds = new Set(eventPerf.map((e) => e.event.id));
  const eventLines = () => monthLines().filter((l) => !!l.eventId && eventIds.has(l.eventId));
  /** 합계 줄의 계산 칸 — 이벤트별로 (합계 줄과 같이 원 단위로 반올림한 값을 더한다) */
  const perEvent = (key: string, title: string, valueOf: (e: EventPerf) => number, direction: "expense" | "net") =>
    (): PnlDetail => {
      const rows = eventPerf
        .map((e) => ({ key: e.event.id, label: e.event.name, value: Math.round(valueOf(e)) }))
        .filter((r) => r.value !== 0);
      return {
        key: `events-${key}`,
        title,
        formula: false,
        direction,
        total: rows.reduce((a, r) => a + r.value, 0),
        rows,
        basis: "이벤트별 합",
      };
    };

  return (
    <PageShell width="wide">
      <ToolbarPortal order={0}>
        <MonthStepper glass months={months} value={activeMonth} onChange={setMonth} />
      </ToolbarPortal>

      <PageHeader
        title="AC'SCENT 대시보드"
        description="매장별 수량 · 원가 · 공헌이익"
        className="mb-3"
        meta={
          t.reviewCount === 0 ? (
            <StatusDot tone="success" className="text-nd-body">
              {monthLabel(activeMonth)} 전 건 확정
            </StatusDot>
          ) : undefined
        }
        actions={
          <Link href="/neander/sales/import">
            <Button variant="secondary" icon={Download}>
              매출 적재
            </Button>
          </Link>
        }
      />

      {/* 이 화면이 무엇인지, 무엇이 아닌지 — 한 줄. 긴 설명은 도움말 판으로 (aggregate.ts buildPnl 그대로) */}
      <BasisLine
        className="mb-5"
        items={["판매 실적 기준", "재무 장부와 별도 집계", `${monthLabel(activeMonth)} 판매일 기준`]}
      >
        <Link
          href="/neander/sales/reconcile"
          className="inline-flex items-center gap-0.5 rounded-[6px] font-medium text-nd-accent-strong hover:underline"
        >
          장부 대사
          <Icon icon={ArrowUpRight} size={13} />
        </Link>
        <InfoPopover
          label="계산 기준"
          title="매출 대시보드 계산 기준"
          terms={[
            { term: "총매출", desc: "적재된 판매 전부(페이히어 POS · 네이버 예약 · 온라인). 장부의 정산 입금과 맞춰 보는 금액입니다." },
            { term: "확정 매출", desc: "상품이 정해진 판매만. 모든 이익률의 분모입니다." },
            { term: "미확정", desc: "상품을 아직 못 정한 판매. 총매출에는 들어가고, 원가·이익률 계산에서는 매출과 함께 빠집니다. 평균원가율로 추정하지 않습니다." },
            { term: "변동비", desc: `재료비(상품 마스터 단가 × 수량) + 인건비(${laborNote}) + 이벤트 준비물 + 결제 수수료(경로별 요율). 이벤트 인건비·준비물은 이벤트당 한 번만 더합니다.` },
            { term: "공헌이익", desc: "확정 매출 − 변동비. 공헌이익률 = 공헌이익 ÷ 확정 매출." },
            { term: "고정비", desc: `공통 고정비 배부(와우:아이디 = ${alloc}) + 아이디 상시 인건비. 온라인은 배부가 없어 공헌이익이 곧 영업이익입니다. 배부 비율은 사실이 아니라 경영 판단입니다.` },
            { term: "영업이익", desc: "공헌이익 − 고정비. 영업이익률의 분모도 확정 매출입니다." },
            { term: "BEP", desc: "손익분기 매출 = 고정비 ÷ 공헌이익률, 달성률 = 확정 매출 ÷ 손익분기 매출. 공헌이익률이 0 이하이거나 고정비가 없으면 산출하지 않습니다(—)." },
          ]}
          footer="매출 금액의 정본은 재무 장부(카드사 정산 입금 · Npay 정산)입니다. 이 화면은 같은 판매를 수량 · 원가로 봅니다."
        />
      </BasisLine>

      {/* 핵심 지표 — 총매출과 확정 매출을 늘 함께 */}
      <KpiStrip columns={4} className="mb-4">
        <StatTile
          label="총매출"
          value={t.revenue}
          flow="income"
          accent={STORE_SERIES.id}
          size="lg"
          wrapValue={(money) => (
            <SalesDrill title="총매출" subtitle={sub} lines={monthLines} flow="income">
              {money}
            </SalesDrill>
          )}
          hint={
            <>
              확정 <Money value={t.confirmedRevenue} unit={false} className="text-nd-fg-2" />원 ·{" "}
              {lineCount.toLocaleString("ko-KR")}건
            </>
          }
        />
        {/* 금액이 먼저, 비율은 아래 — 옆 칸 총매출·영업이익이 모두 금액이라 같은 줄에서 비교된다 */}
        <StatTile
          label={<TermLabel term="공헌이익" />}
          value={t.contribution}
          flow="net"
          size="lg"
          tag={
            <Badge tone={t.pendingRevenue > 0 ? "warning" : "neutral"} size="sm">
              확정 기준
            </Badge>
          }
          wrapValue={(money) => (
            <SalesDrill
              title="공헌이익"
              subtitle={sub}
              detail={perStore("contribution", "공헌이익", (s) => s.contribution, "net")}
            >
              {money}
            </SalesDrill>
          )}
          hint={
            <span className="inline-flex items-center gap-1">
              <TermLabel term="공헌이익률" />
              <span className="nd-num">{pct(t.contributionRate)}</span>
            </span>
          }
        />
        <StatTile
          label={<TermLabel term="영업이익" />}
          value={t.operating}
          flow="net"
          size="lg"
          wrapValue={(money) => (
            <SalesDrill title="영업이익" subtitle={sub} detail={perStore("op", "영업이익", (s) => s.operating, "net")}>
              {money}
            </SalesDrill>
          )}
          tone={t.operating < 0 ? "danger" : undefined}
          tag={t.operating < 0 ? <Badge tone="danger" size="sm">손실</Badge> : undefined}
          hint={`확정 매출 기준 · 영업이익률 ${pct(t.operatingRate)}`}
        />
        <KpiItem
          label="BEP 달성률"
          size="lg"
          value={<span className="nd-num">{pct(t.bepAchieved, 0)}</span>}
          tone={t.bepAchieved === null ? "neutral" : t.bepAchieved >= 1 ? "success" : "warning"}
          hint={
            t.bep === null ? (
              "손익분기 산출 불가 (공헌이익률 ≤ 0)"
            ) : (
              <>
                손익분기 <Money value={t.bep} unit={false} className="text-nd-fg-2" />원
              </>
            )
          }
        />
      </KpiStrip>

      {/* 미확정 — 판단에 필요한 상태라 도움말로 숨기지 않는다. 엑셀이 평균원가율로 메웠던 지점 */}
      {t.reviewCount > 0 && (
        <InlineNotice
          tone="warning"
          icon={TriangleAlert}
          className="mb-5 items-center"
          action={
            <Link href="/neander/sales/review">
              <Button size="sm">{t.reviewCount.toLocaleString("ko-KR")}건 검토하기</Button>
            </Link>
          }
        >
          <span className="font-semibold">
            미확정 {t.reviewCount.toLocaleString("ko-KR")}건 ·{" "}
            <span className="nd-num">{t.reviewAmount.toLocaleString("ko-KR")}</span>원
          </span>
          {/* 좁은 화면에서 「총매출의」가 줄 사이에서 갈라져 「총 / 매출의」로 읽혔다 —
              한 덩이로 두고 좁으면 아래 줄로 통째로 내린다 */}
          <span className="mt-0.5 block text-nd-caption sm:ml-2 sm:mt-0 sm:inline">
            총매출의 {pct(reviewShare)} · 이익률 계산에서 제외
          </span>
        </InlineNotice>
      )}

      {/* 월별 추이 + 매장별 매출 */}
      <div className="mb-5 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <SectionHeader
            title="월별 추이"
            hint={metricMeta ? `매장별 · ${metricMeta.hint}` : "매장별"}
            action={
              <div className="flex flex-wrap items-center gap-2">
                {/* 지표는 셀렉트 — 좁은 화면에서 세그먼트 둘이 나란히 서면 줄이 넘친다 */}
                <Select
                  size="sm"
                  aria-label="추이 지표"
                  value={metric}
                  onChange={(e) => setMetric(e.target.value as TrendMetric)}
                  className="w-auto min-w-[6.5rem]"
                >
                  {TREND_METRICS.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </Select>
                <SegmentedControl
                  size="sm"
                  ariaLabel="표시 범위"
                  value={range}
                  onChange={(v) => setRange(v as TrendRange)}
                  options={[
                    { value: "6", label: "6개월" },
                    { value: "12", label: "12개월" },
                    { value: "all", label: "전체" },
                  ]}
                />
              </div>
            }
          />
          {trend.length >= 2 ? (
            <>
              <MonthTrendChart
                points={trend}
                series={[
                  ...SALES_STORES.map((s2) => ({
                    key: s2.value,
                    label: s2.label,
                    color: STORE_SERIES[s2.value],
                  })),
                  // 세 매장을 합친 막대 — 매장 막대 오른쪽에 회색으로
                  { key: "total", label: "합계", color: STORE_TOTAL_COLOR, total: true },
                ]}
              />
              <ChartValues
                className="mt-2"
                note={`단위: 원 · ${metricMeta?.label ?? ""} (${metricMeta?.hint ?? ""})`}
                columns={[
                  ...SALES_STORES.map((s2) => ({ key: s2.value, label: s2.label, color: STORE_SERIES[s2.value] })),
                  { key: "total", label: "합계", color: STORE_TOTAL_COLOR },
                ]}
                rows={trend.map((p) => ({
                  key: p.month,
                  label: monthLabel(p.month),
                  values: p.values,
                }))}
              />
            </>
          ) : (
            <p className="py-10 text-center text-nd-caption text-nd-fg-3">두 달 이상 쌓이면 추이가 나타납니다.</p>
          )}
          <TableNote className="pt-2">
            공헌이익·영업이익은 <b>확정 매출</b> 기준이라, 미확정이 많은 달은 낮게 보입니다.
          </TableNote>
        </Card>

        {/* 매장별 매출 — 총매출(미확정 포함)의 매장 비중. 색은 차트·표와 같다 */}
        <Card className="flex flex-col">
          <SectionHeader title="매장별 매출" hint="총매출 기준" />
          {t.revenue <= 0 ? (
            <p className="py-8 text-center text-nd-caption text-nd-fg-3">이 달에는 판매가 없습니다.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {pnl.stores.map((s) => {
                const share = t.revenue ? s.revenue / t.revenue : null;
                return (
                  <li key={s.store} className="grid grid-cols-[4rem_1fr_auto] items-center gap-3">
                    <span className="text-nd-body text-nd-fg">{storeLabel(s.store)}</span>
                    <div
                      className="h-4 overflow-hidden rounded-[3px] bg-nd-sunken"
                      role="img"
                      aria-label={`${storeLabel(s.store)} 매출 ${s.revenue.toLocaleString("ko-KR")}원, 비중 ${pct(share)}`}
                    >
                      <div
                        className="h-full rounded-[3px]"
                        style={{
                          width: `${maxStoreRevenue ? (s.revenue / maxStoreRevenue) * 100 : 0}%`,
                          backgroundColor: STORE_SERIES[s.store],
                        }}
                      />
                    </div>
                    <span className="text-right">
                      <span className="block">
                        {drill(s.revenue, <Money value={s.revenue} unit={false} flow="income" />, {
                          title: `${storeLabel(s.store)} · 총매출`,
                          subtitle: sub,
                          lines: () => storeLines(s.store),
                          flow: "income",
                        })}
                        <span className="text-nd-caption text-nd-fg-3">원</span>
                      </span>
                      <span className="nd-num block text-nd-caption text-nd-fg-3">{pct(share)}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="mt-auto pt-4 text-nd-caption text-nd-fg-3">
            판매 실적 기준 · 미확정 {t.pendingRevenue > 0 ? <Money value={t.pendingRevenue} unit={false} className="text-nd-fg-3" /> : "0"}원 포함
          </p>
        </Card>
      </div>

      {/* 매장별 손익 구조 — 두 줄 막대: 매출 줄 · 비용 줄. 비용이 매출보다 길면 그만큼이 손실 */}
      <Card className="mb-5">
        <SectionHeader
          title="매장별 손익 구조"
          hint="위 줄은 매출, 아래 줄은 비용과 영업이익 · 아래 줄이 더 길면 손실 · 칸에 커서를 두면 내역, 누르면 자세히"
        />
        <PnlBarLegend className="mb-4" />
        <div className="flex flex-col gap-4">
          {pnl.stores.map((s) => {
            const v = barInput(s);
            return (
              <div key={s.store} className="grid grid-cols-[5.5rem_1fr] items-center gap-3 sm:grid-cols-[5.5rem_1fr_11rem]">
                <div className="flex items-center gap-2">
                  <StoreBadge store={s.store} size="sm" />
                </div>
                <PnlBar
                  value={v}
                  scale={barScale}
                  label={storeLabel(s.store)}
                  caption={monthLabel(activeMonth)}
                  detailOf={(key) =>
                    pnlSegmentDetail(key, s, { month: activeMonth, lines, products, events, assumptions })
                  }
                />
                <div className="col-span-2 text-nd-caption text-nd-fg-2 sm:col-span-1 sm:text-right">
                  공헌 <Rate value={s.contributionRate} className="font-semibold" /> · 영업{" "}
                  <Rate value={s.operatingRate} className="font-semibold" />
                  {s.operating < 0 && (
                    <span className="block text-nd-micro text-nd-danger-text">
                      손실{" "}
                      <SalesDrill title={`${storeLabel(s.store)} · 영업이익`} subtitle={sub} detail={segment("op", s)}>
                        <Money value={s.operating} unit={false} flow="net" />
                      </SalesDrill>
                      원
                    </span>
                  )}
                  {s.pendingRevenue > 0 && (
                    <span className="block text-nd-micro text-nd-warning-text">
                      미확정{" "}
                      <SalesDrill
                        title={`${storeLabel(s.store)} · 미확정`}
                        subtitle={sub}
                        lines={() => storeLines(s.store).filter((l) => !isConfirmed(l))}
                        flow="income"
                        {...pendingHref}
                      >
                        <span className="nd-num">{s.pendingRevenue.toLocaleString("ko-KR")}</span>
                      </SalesDrill>
                      원 제외
                    </span>
                  )}
                  {s.revenue === 0 && s.fixedTotal > 0 && (
                    <span className="block text-nd-micro text-nd-fg-3">매출 없음 · 고정비만</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <TableNote className="pt-4">
          고정비 {alloc} 배부는 사실이 아니라 경영 판단입니다. 온라인은 배부가 없어 공헌이익이 곧
          영업이익입니다. 미확정은 원가를 모르니 손익으로 쪼개지 않고 매출 줄에 빗금으로만 둡니다.
        </TableNote>
      </Card>

      {/* 손익 표 */}
      <Card padding="none" className="mb-5 overflow-hidden">
        <div className="px-5 pt-4">
          <SectionHeader title="매장별 손익" hint={`${monthLabel(activeMonth)} · 단위: 원 · 숫자에 커서를 두면 내역, 누르면 자세히`} />
        </div>
        <TableScroll>
          <Table minWidth={1260}>
            <thead>
              <tr>
                <Th sticky="left" className="pl-5">매장</Th>
                <Th align="right">총매출</Th>
                <Th align="right">확정 매출</Th>
                <Th align="right">미확정</Th>
                <Th align="right">재료비</Th>
                <Th align="right">인건비</Th>
                <Th align="right">준비물</Th>
                <Th align="right">수수료</Th>
                <Th align="right"><TermLabel term="공헌이익" /></Th>
                <Th align="right"><TermLabel term="공헌이익률" /></Th>
                {/* 고정비를 둘로 — 상시 인건비를 섞으면 아이디만 인건비가 없는 것처럼 보였다 */}
                <Th align="right">상시 인건비</Th>
                <Th align="right">배부 고정비</Th>
                <Th align="right"><TermLabel term="영업이익" /></Th>
                <Th align="right" className="pr-5">BEP 달성률</Th>
              </tr>
            </thead>
            <tbody>
              {pnl.stores.map((s) => (
                <Tr key={s.store}>
                  <Td sticky="left" className="pl-5">
                    <div className="flex items-center gap-2">
                      <StoreBadge store={s.store} size="sm" />
                    </div>
                  </Td>
                  <Td num className="font-medium">
                    {drill(s.revenue, <Money value={s.revenue} unit={false} flow="income" />, {
                      title: `${storeLabel(s.store)} · 총매출`,
                      subtitle: sub,
                      lines: () => storeLines(s.store),
                      flow: "income",
                    })}
                  </Td>
                  <Td num>
                    {drill(s.confirmedRevenue, <Money value={s.confirmedRevenue} unit={false} flow="income" />, {
                      title: `${storeLabel(s.store)} · 확정 매출`,
                      subtitle: sub,
                      lines: () => storeLines(s.store).filter(isConfirmed),
                      flow: "income",
                    })}
                  </Td>
                  <Td num>
                    {s.pendingRevenue > 0 ? (
                      <SalesDrill
                        title={`${storeLabel(s.store)} · 미확정`}
                        subtitle={sub}
                        lines={() => storeLines(s.store).filter((l) => !isConfirmed(l))}
                        flow="income"
                        {...pendingHref}
                      >
                        <span className="text-nd-warning-text">
                          {s.pendingRevenue.toLocaleString("ko-KR")}
                          <span className="ml-1 text-nd-micro">{s.reviewCount}건</span>
                        </span>
                      </SalesDrill>
                    ) : (
                      <span className="text-nd-fg-4">0</span>
                    )}
                  </Td>
                  <Td num>
                    {drill(s.variable.material, <Money value={s.variable.material} unit={false} flow="expense" />, {
                      title: `${storeLabel(s.store)} · 재료비`,
                      subtitle: sub,
                      lines: () => storeLines(s.store).filter((l) => isConfirmed(l) && materialOf(l) !== 0),
                      amountOf: materialOf,
                      flow: "expense",
                    })}
                  </Td>
                  <Td num>
                    {/* 출처(실측·추정)를 금액 옆에 — 같은 칸이 달마다 다른 근거에서 온다 */}
                    <span className="inline-flex items-center justify-end gap-1.5">
                      {s.store !== "online" && <LaborTag labor={s.labor} />}
                      {drill(variableLabor(s), <Money value={variableLabor(s)} unit={false} flow="expense" />, {
                        title: `${storeLabel(s.store)} · 인건비`,
                        subtitle: sub,
                        detail: segment("variableLabor", s),
                      })}
                    </span>
                  </Td>
                  <Td num>
                    {drill(s.variable.supplies, <Money value={s.variable.supplies} unit={false} flow="expense" />, {
                      title: `${storeLabel(s.store)} · 준비물`,
                      subtitle: sub,
                      detail: segment("supplies", s),
                    })}
                  </Td>
                  <Td num>
                    {drill(s.variable.fee, <Money value={s.variable.fee} unit={false} flow="expense" />, {
                      title: `${storeLabel(s.store)} · 수수료`,
                      subtitle: sub,
                      lines: () => storeLines(s.store).filter((l) => isConfirmed(l) && feeOf(l) !== 0),
                      amountOf: feeOf,
                      flow: "expense",
                    })}
                  </Td>
                  <Td num className="font-semibold">
                    {drill(s.contribution, <Money value={s.contribution} unit={false} flow="net" />, {
                      title: `${storeLabel(s.store)} · 공헌이익`,
                      subtitle: sub,
                      detail: segment("contribution", s),
                    })}
                  </Td>
                  <Td num><Rate value={s.contributionRate} /></Td>
                  <Td num>
                    <span className="inline-flex items-center justify-end gap-1.5">
                      {s.store !== "online" && (s.regularLabor > 0 || s.labor.source === "actual") && (
                        <LaborTag labor={s.labor} />
                      )}
                      {s.regularLabor > 0 ? (
                        <SalesDrill
                          title={`${storeLabel(s.store)} · 상시 인건비`}
                          subtitle={sub}
                          detail={segment("regularLabor", s)}
                        >
                          <Money value={s.regularLabor} unit={false} flow="expense" />
                        </SalesDrill>
                      ) : (
                        <span className="text-nd-fg-4">0</span>
                      )}
                    </span>
                  </Td>
                  <Td num>
                    {drill(s.allocatedFixed, <Money value={s.allocatedFixed} unit={false} flow="expense" />, {
                      title: `${storeLabel(s.store)} · 배부 고정비`,
                      subtitle: sub,
                      detail: segment("fixed", s),
                    })}
                  </Td>
                  <Td num className="font-semibold">
                    {drill(s.operating, <Money value={s.operating} unit={false} flow="net" />, {
                      title: `${storeLabel(s.store)} · 영업이익`,
                      subtitle: sub,
                      detail: segment("op", s),
                    })}
                  </Td>
                  <Td num className={cn("pr-5", s.bepAchieved === null && "text-nd-fg-4")}>{pct(s.bepAchieved, 0)}</Td>
                </Tr>
              ))}
            </tbody>
            <tfoot>
              <TotalRow>
                <Td sticky="left" className="!bg-nd-sunken pl-5">합계</Td>
                <Td num>
                  {drill(t.revenue, <Money value={t.revenue} unit={false} flow="income" />, {
                    title: "합계 · 총매출",
                    subtitle: sub,
                    lines: monthLines,
                    flow: "income",
                  })}
                </Td>
                <Td num>
                  {drill(t.confirmedRevenue, <Money value={t.confirmedRevenue} unit={false} flow="income" />, {
                    title: "합계 · 확정 매출",
                    subtitle: sub,
                    lines: () => monthLines().filter(isConfirmed),
                    flow: "income",
                  })}
                </Td>
                <Td num>
                  {t.pendingRevenue > 0 ? (
                    <SalesDrill
                      title="합계 · 미확정"
                      subtitle={sub}
                      lines={() => monthLines().filter((l) => !isConfirmed(l))}
                      flow="income"
                      {...pendingHref}
                    >
                      <span className="text-nd-warning-text">{t.pendingRevenue.toLocaleString("ko-KR")}</span>
                    </SalesDrill>
                  ) : (
                    <span className="text-nd-fg-4">0</span>
                  )}
                </Td>
                <Td num>
                  {drill(t.variable.material, <Money value={t.variable.material} unit={false} flow="expense" />, {
                    title: "합계 · 재료비",
                    subtitle: sub,
                    lines: () => monthLines().filter((l) => isConfirmed(l) && materialOf(l) !== 0),
                    amountOf: materialOf,
                    flow: "expense",
                  })}
                </Td>
                <Td num>
                  {drill(variableLabor(t), <Money value={variableLabor(t)} unit={false} flow="expense" />, {
                    title: "합계 · 인건비",
                    subtitle: sub,
                    detail: perStore("variableLabor", "인건비", variableLabor, "expense"),
                  })}
                </Td>
                <Td num>
                  {drill(t.variable.supplies, <Money value={t.variable.supplies} unit={false} flow="expense" />, {
                    title: "합계 · 준비물",
                    subtitle: sub,
                    detail: perStore("supplies", "준비물", (s) => s.variable.supplies, "expense"),
                  })}
                </Td>
                <Td num>
                  {drill(t.variable.fee, <Money value={t.variable.fee} unit={false} flow="expense" />, {
                    title: "합계 · 수수료",
                    subtitle: sub,
                    lines: () => monthLines().filter((l) => isConfirmed(l) && feeOf(l) !== 0),
                    amountOf: feeOf,
                    flow: "expense",
                  })}
                </Td>
                <Td num>
                  {drill(t.contribution, <Money value={t.contribution} unit={false} flow="net" />, {
                    title: "합계 · 공헌이익",
                    subtitle: sub,
                    detail: perStore("contribution", "공헌이익", (s) => s.contribution, "net"),
                  })}
                </Td>
                <Td num><Rate value={t.contributionRate} /></Td>
                <Td num>
                  {drill(
                    pnl.stores.reduce((a, s) => a + s.regularLabor, 0),
                    <Money value={pnl.stores.reduce((a, s) => a + s.regularLabor, 0)} unit={false} flow="expense" />,
                    {
                      title: "합계 · 상시 인건비",
                      subtitle: sub,
                      detail: perStore("regularLabor", "상시 인건비", (s) => s.regularLabor, "expense"),
                    },
                  )}
                </Td>
                <Td num>
                  {drill(
                    pnl.stores.reduce((a, s) => a + s.allocatedFixed, 0),
                    <Money value={pnl.stores.reduce((a, s) => a + s.allocatedFixed, 0)} unit={false} flow="expense" />,
                    {
                      title: "합계 · 배부 고정비",
                      subtitle: sub,
                      detail: perStore("fixed", "배부 고정비", (s) => s.allocatedFixed, "expense"),
                    },
                  )}
                </Td>
                <Td num>
                  {drill(t.operating, <Money value={t.operating} unit={false} flow="net" />, {
                    title: "합계 · 영업이익",
                    subtitle: sub,
                    detail: perStore("op", "영업이익", (s) => s.operating, "net"),
                  })}
                </Td>
                <Td num className={cn("pr-5", t.bepAchieved === null && "text-nd-fg-4")}>{pct(t.bepAchieved, 0)}</Td>
              </TotalRow>
            </tfoot>
          </Table>
        </TableScroll>
        <TableNote className="px-5 py-2">
          공헌이익 · 영업이익 · 이익률 · BEP 는 <b>확정 매출</b> 기준입니다. 미확정 금액은 분자·분모에서
          함께 빠집니다. 분모가 0 이면 「—」 로 둡니다. 인건비 = {laborNote}. 「상시 인건비」는 아이디 매장
          근무(와우는 이벤트 없는 날의 근무)라 매달 나가는 비용으로 보고 공헌이익 아래에 둡니다. 끝난 달은
          근무 일지 실측(저장된 급여 + 주휴수당 + 정직원 근무시간 × 가정 시급), 진행 중이거나 기록이 없는
          달은 가정값(아이디 하루 {assumptions.idOps.hoursPerDay}시간 × {assumptions.idOps.daysPerMonth}일 ×
          시급 {assumptions.wage.idRegular.toLocaleString("ko-KR")}원 · 와우 이벤트 운영일 × 시간 × 스태프 ×
          시급)이며 칸에 「실측」·「추정」으로 표시합니다. 내역은 아래 「인건비 내역」에 있습니다.
        </TableNote>
      </Card>

      {/* 인건비 내역 — 근무 일지에서 온 숫자를 매장 → 직원으로 펼쳐 본다 (달은 위에서 고른 달) */}
      <Disclosure
        className="mb-5"
        title="인건비 내역"
        description={`${monthLabel(activeMonth)} · 근무 일지 실측 또는 가정값`}
        meta={pnl.stores
          .filter((s) => s.store !== "online")
          .map((s) => `${storeLabel(s.store)} ${s.labor.source === "actual" ? "실측" : "추정"}`)
          .join(" · ")}
      >
        <LaborBreakdown stores={pnl.stores} assumptions={assumptions} warnings={labor?.warnings ?? []} />
      </Disclosure>

      {/* 한 줄에 하나씩 — 상시·이벤트(190px)와 상위 상품(540px)을 나란히 두면 짧은 쪽 아래로
          회색 바탕이 350px 비었다. 늘려 맞추면 카드 안이 빈 종이가 되고, 이벤트별 손익을 반 칸에
          넣으면 표가 스크롤된다. 그래서 세 카드를 위에서 아래로 쌓는다. */}
      <div className="mb-5 flex flex-col gap-5 [&>*]:min-w-0">
        {/* 상시 · 이벤트 */}
        <Card padding="none" className="overflow-hidden">
          <div className="px-5 pt-4">
            <SectionHeader title="상시 · 이벤트" hint="손익을 가르는 두 번째 축" />
          </div>
          <TableScroll>
            <Table minWidth={420}>
              <thead>
                <tr>
                  <Th className="pl-5">매장</Th>
                  <Th align="right">상시</Th>
                  <Th align="right">이벤트</Th>
                  <Th align="right" className="pr-5">이벤트 비중</Th>
                </tr>
              </thead>
              <tbody>
                {pnl.stores
                  .filter((s) => s.revenue > 0)
                  .map((s) => (
                    <Tr key={s.store}>
                      <Td className="pl-5"><StoreBadge store={s.store} size="sm" /></Td>
                      <Td num>
                        {drill(s.revenueRegular, <Money value={s.revenueRegular} unit={false} flow="income" />, {
                          title: `${storeLabel(s.store)} · 상시 매출`,
                          subtitle: sub,
                          lines: () => storeLines(s.store).filter((l) => !l.eventId),
                          flow: "income",
                        })}
                      </Td>
                      <Td num>
                        {drill(s.revenueEvent, <Money value={s.revenueEvent} unit={false} flow="income" />, {
                          title: `${storeLabel(s.store)} · 이벤트 매출`,
                          subtitle: sub,
                          lines: () => storeLines(s.store).filter((l) => !!l.eventId),
                          flow: "income",
                          byProduct: true,
                        })}
                      </Td>
                      <Td num className="pr-5">
                        {s.revenue ? pct(s.revenueEvent / s.revenue) : "—"}
                      </Td>
                    </Tr>
                  ))}
              </tbody>
            </Table>
          </TableScroll>
          <TableNote className="px-5 py-2">
            이벤트 귀속은 <b>날짜</b>로 정합니다. 기간이 겹치는 이벤트가 없으면 상시입니다.
          </TableNote>
        </Card>

        {/* 이벤트별 손익 — 전체 폭. 반 칸에 두면 열 여섯 개가 좁아 좌우로, 행사가 많으면
            상하로 스크롤됐다. 달마다 10~15건이라 높이를 막지 않고 한 번에 다 보인다. */}
        <Card padding="none" className="overflow-hidden">
          <div className="px-5 pt-4">
            <SectionHeader
              title="이벤트별 손익"
              hint={`${monthLabel(activeMonth)} 시작 ${eventPerf.length.toLocaleString("ko-KR")}건 · 확정 매출 기준`}
              action={
                <Link
                  href="/neander/sales/event-entry"
                  className="text-nd-caption font-medium text-nd-accent-strong hover:underline"
                >
                  이벤트 입력 →
                </Link>
              }
            />
          </div>
          {eventPerf.length === 0 ? (
            <EmptyState
              icon={CalendarPlus}
              title="이 달에 시작한 이벤트가 없습니다"
              description="이벤트 입력에서 기간을 적으면 그 기간의 판매가 이벤트에 붙습니다."
              className="border-0"
            />
          ) : (
            <TableScroll>
              {/* 최소 폭은 좁은 화면(휴대폰)에서만 걸린다 — 넓은 화면은 카드 폭 안에 다 들어온다 */}
              <Table minWidth={560} dense>
                <thead>
                  <tr>
                    <SortTh sticky="top" className="pl-5" sortKey="from" sort={eventSort} onSort={setEventSort}>
                      이벤트
                    </SortTh>
                    <SortTh sticky="top" align="right" sortKey="revenue" sort={eventSort} onSort={setEventSort}>
                      매출
                    </SortTh>
                    <SortTh sticky="top" align="right" sortKey="variable" sort={eventSort} onSort={setEventSort}>
                      변동비
                    </SortTh>
                    <SortTh sticky="top" align="right" sortKey="contribution" sort={eventSort} onSort={setEventSort}>
                      <TermLabel term="공헌이익" />
                    </SortTh>
                    <SortTh sticky="top" align="right" sortKey="rate" sort={eventSort} onSort={setEventSort}>
                      이익률
                    </SortTh>
                    <SortTh sticky="top" align="right" className="pr-5" sortKey="perDay" sort={eventSort} onSort={setEventSort}>
                      일당
                    </SortTh>
                  </tr>
                </thead>
                <tbody>
                  {eventRows.map((ep) => (
                    <Tr key={ep.event.id}>
                      <Td className="pl-5">
                        <span className="flex min-w-0 items-center gap-1.5">
                          <StoreBadge store={ep.event.store} size="sm" />
                          <span className="truncate font-medium text-nd-fg" title={ep.event.name}>
                            {ep.event.name}
                          </span>
                        </span>
                        <span className="nd-num block text-nd-micro text-nd-fg-3">
                          {ep.event.from.slice(5).replace("-", ".")}~{ep.event.to.slice(5).replace("-", ".")} · {ep.days}일
                        </span>
                      </Td>
                      <Td num>
                        {drill(ep.revenue, <Money value={ep.revenue} unit={false} flow="income" />, {
                          title: `${ep.event.name} · 매출`,
                          subtitle: sub,
                          lines: () => monthLines().filter((l) => l.eventId === ep.event.id),
                          flow: "income",
                          byProduct: true,
                        })}
                        {/* 미확정은 이익률에서 빠진다 — 얼마가 빠졌는지 옆에 둔다 */}
                        {ep.pendingRevenue > 0 && (
                          <span className="block text-nd-micro text-nd-warning-text">
                            미확정{" "}
                            <SalesDrill
                              title={`${ep.event.name} · 미확정`}
                              subtitle={sub}
                              lines={() => monthLines().filter((l) => l.eventId === ep.event.id && !isConfirmed(l))}
                              flow="income"
                              {...pendingHref}
                            >
                              <Money value={ep.pendingRevenue} unit={false} />
                            </SalesDrill>
                          </span>
                        )}
                      </Td>
                      <Td num>
                        {drill(ep.variable, <Money value={ep.variable} unit={false} flow="expense" />, {
                          title: `${ep.event.name} · 변동비`,
                          subtitle: sub,
                          detail: () => ({
                            key: "event-variable",
                            title: "변동비",
                            formula: false,
                            direction: "expense",
                            total: ep.variable,
                            rows: [
                              { key: "material", label: "재료비", value: ep.material },
                              {
                                key: "labor",
                                label: "인건비",
                                value: ep.labor,
                                sub: `이벤트 스태프(${ep.laborSource === "actual" ? "근무 일지 실측" : "가정값"}) + 제작`,
                              },
                              { key: "supplies", label: "준비물", value: ep.supplies },
                              { key: "fee", label: "수수료", value: ep.fee },
                            ].filter((r) => r.value !== 0),
                            basis: "확정 판매 · 이벤트 기간 비용",
                          }),
                        })}
                      </Td>
                      <Td num className="font-semibold">
                        {drill(ep.contribution, <Money value={ep.contribution} unit={false} flow="net" />, {
                          title: `${ep.event.name} · 공헌이익`,
                          subtitle: sub,
                          detail: () => ({
                            key: "event-contribution",
                            title: "공헌이익",
                            formula: true,
                            direction: "net",
                            total: ep.contribution,
                            rows: [
                              { key: "rev", label: "확정 매출", value: ep.confirmedRevenue },
                              { key: "material", label: "재료비", value: ep.material, sign: "minus" },
                              { key: "labor", label: "인건비", value: ep.labor, sign: "minus" },
                              { key: "supplies", label: "준비물", value: ep.supplies, sign: "minus" },
                              { key: "fee", label: "수수료", value: ep.fee, sign: "minus" },
                            ],
                            basis: "확정 매출 기준",
                            note:
                              ep.pendingRevenue > 0
                                ? `미확정 ${ep.pendingRevenue.toLocaleString("ko-KR")}원은 원가를 몰라 넣지 않았습니다.`
                                : undefined,
                          }),
                        })}
                      </Td>
                      <Td num>
                        <Rate value={ep.contributionRate} tone="auto" />
                      </Td>
                      <Td num className="pr-5">
                        {drill(ep.contributionPerDay, <Money value={ep.contributionPerDay} unit={false} flow="net" />, {
                          title: `${ep.event.name} · 일당`,
                          subtitle: sub,
                          detail: () => ({
                            key: "event-per-day",
                            title: "일당 공헌이익",
                            formula: true,
                            direction: "net",
                            total: ep.contributionPerDay,
                            rows: [
                              { key: "contribution", label: "공헌이익", value: ep.contribution },
                              { key: "days", label: "÷ 운영일수", sub: "원이 아니라 일수", value: ep.days },
                            ],
                            basis: "공헌이익 ÷ 운영일수 · 원 단위 반올림",
                          }),
                        })}
                      </Td>
                    </Tr>
                  ))}
                  <TotalRow>
                    <Td className="pl-5">합계</Td>
                    <Td num>
                      {drill(eventTotal.revenue, <Money value={eventTotal.revenue} unit={false} flow="income" />, {
                        title: "이벤트 합계 · 매출",
                        subtitle: sub,
                        lines: eventLines,
                        flow: "income",
                        byProduct: true,
                      })}
                      {eventTotal.pending > 0 && (
                        <span className="block text-nd-micro font-normal text-nd-warning-text">
                          미확정{" "}
                          <SalesDrill
                            title="이벤트 합계 · 미확정"
                            subtitle={sub}
                            lines={() => eventLines().filter((l) => !isConfirmed(l))}
                            flow="income"
                            {...pendingHref}
                          >
                            <Money value={eventTotal.pending} unit={false} />
                          </SalesDrill>
                        </span>
                      )}
                    </Td>
                    <Td num>
                      {drill(eventTotal.variable, <Money value={eventTotal.variable} unit={false} flow="expense" />, {
                        title: "이벤트 합계 · 변동비",
                        subtitle: sub,
                        detail: perEvent("variable", "변동비", (e) => e.variable, "expense"),
                      })}
                    </Td>
                    <Td num>
                      {drill(eventTotal.contribution, <Money value={eventTotal.contribution} unit={false} flow="net" />, {
                        title: "이벤트 합계 · 공헌이익",
                        subtitle: sub,
                        detail: perEvent("contribution", "공헌이익", (e) => e.contribution, "net"),
                      })}
                    </Td>
                    <Td num>
                      <Rate value={eventTotal.rate} tone="auto" />
                    </Td>
                    <Td num className="pr-5">
                      <Money value={eventTotal.perDay} unit={false} flow="net" />
                    </Td>
                  </TotalRow>
                </tbody>
              </Table>
            </TableScroll>
          )}
          <TableNote className="px-5 py-2">
            변동비 = 재료비 + 인건비(이벤트 스태프·제작) + 준비물 + 결제 수수료. 공헌이익·이익률은 <b>확정 매출</b> 기준이고,
            고정비는 매장 단위라 이벤트에 나누지 않습니다. 일당 = 공헌이익 ÷ 운영일수. 자세한 내역은 이벤트 입력의 「실적」에 있습니다.
          </TableNote>
        </Card>

        {/* 상품 수익성 */}
        <Card padding="none" className="overflow-hidden">
          <div className="px-5 pt-4">
            <SectionHeader
              title="공헌이익 상위 상품"
              hint="확정 판매만 · 수량과 금액이 같은 모집단"
              action={
                <Link
                  href="/neander/sales/products"
                  className="text-nd-caption font-medium text-nd-accent-strong hover:underline"
                >
                  전체 보기 →
                </Link>
              }
            />
          </div>
          {perf.length === 0 ? (
            <EmptyState
              icon={Boxes}
              title="확정된 판매가 없습니다"
              description="검토 대기함에서 상품을 정하면 여기에 나타납니다."
              className="border-0"
            />
          ) : (
            <TableScroll>
              <Table minWidth={460}>
                <thead>
                  <tr>
                    <Th className="pl-5">상품</Th>
                    <Th align="right">수량</Th>
                    <Th align="right">매출</Th>
                    <Th align="right"><TermLabel term="공헌이익" /></Th>
                    <Th align="right" className="pr-5">이익률</Th>
                  </tr>
                </thead>
                <tbody>
                  {perf.slice(0, 8).map((p) => (
                    <Tr key={p.product.id}>
                      <Td className="pl-5">
                        <ProductCell product={p.product} className="max-w-[16rem]" />
                      </Td>
                      <Td num>{p.qty.toLocaleString("ko-KR")}</Td>
                      <Td num>
                        {drill(p.revenue, <Money value={p.revenue} unit={false} flow="income" />, {
                          title: `${p.product.name} ${p.product.option}`.trim() + " · 매출",
                          subtitle: sub,
                          lines: () => monthLines().filter((l) => l.status === "resolved" && l.productId === p.product.id),
                          flow: "income",
                        })}
                      </Td>
                      <Td num className="font-semibold">
                        {drill(p.contribution, <Money value={p.contribution} unit={false} flow="net" />, {
                          title: `${p.product.name} ${p.product.option}`.trim() + " · 공헌이익",
                          subtitle: sub,
                          detail: () => {
                            // buildProductPerf 와 같은 인건비 규칙 — 엑셀 모드만 접객을 넣는다
                            const excel = assumptions.laborMode === "excel";
                            const labor = excel
                              ? p.labor
                              : (p.product.makeMin / 60) * p.qty * assumptions.wage.puddi;
                            return {
                              key: "product-contribution",
                              title: "공헌이익",
                              formula: true,
                              direction: "net",
                              total: p.contribution,
                              rows: [
                                { key: "rev", label: "매출", value: p.revenue, sub: `${p.qty.toLocaleString("ko-KR")}개` },
                                { key: "material", label: "재료비", value: p.material, sign: "minus" },
                                {
                                  key: "labor",
                                  label: excel ? "인건비 (접객·제작)" : "제작 인건비",
                                  value: labor,
                                  sign: "minus",
                                },
                                { key: "fee", label: "수수료", value: p.fee, sign: "minus" },
                              ],
                              basis: "확정 판매만",
                            };
                          },
                        })}
                      </Td>
                      <Td num className="pr-5"><Rate value={p.contributionRate} tone="auto" /></Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </TableScroll>
          )}
        </Card>
      </div>

      {/* 하위 화면으로 — 실제 라우트만 (nav-config 의 SALES_NAV 와 같은 곳) */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <LinkTile href="/neander/sales/event-entry" icon={CalendarPlus} title="이벤트 입력" sub="기간 · 준비물 · 방문자 — 이 달 행사 적기" />
        <LinkTile href="/neander/sales/products" icon={Boxes} title="상품 수익성" sub="1개당 공헌이익과 이 달의 실적" />
        <LinkTile href="/neander/sales/reconcile" icon={Scale} title="장부 대사" sub="POS 합계와 장부 입금액 맞춰 보기" />
        <LinkTile
          href="/neander/sales/review"
          icon={Inbox}
          title="검토 대기함"
          sub={t.reviewCount > 0 ? "상품을 정하면 공헌이익이 정확해집니다" : "미확정 판매 없음"}
          badge={t.reviewCount > 0 ? <Badge tone="warning">{t.reviewCount.toLocaleString("ko-KR")}건</Badge> : undefined}
        />
      </div>
    </PageShell>
  );
}
