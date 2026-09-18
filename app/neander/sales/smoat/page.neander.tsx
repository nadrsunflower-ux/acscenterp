"use client";

// ============================================================
//  매출 › SMOAT 대시보드 — 향수가 아닌 사업의 월 손익 (매장 대시보드와 한 벌)
// ------------------------------------------------------------
//  ⚠️ 이 화면은 매장 손익 표에 SMOAT 을 끼워 넣지 않는다. 같은 워크스페이스
//     안의 **다른 사업**이다 (lib/neander/smoat/types.ts 주석에 왜 그런지
//     적어 두었다). 향수의 축(상품·수량·재료비·접객 시간·이벤트)이 여기에는
//     하나도 없다.
//
//  ⚠️ 여기 금액도 **회사 매출의 정본이 아니다.** 장부에는 다날 정산 입금과
//     계좌이체가 「SMOAT매출」로 이미 들어와 있다. 매장 모듈이 POS 를 거래로
//     적재하지 않는 것과 같은 이유다. 이 화면이 답하는 것은 "누가 어떤 팩을
//     샀나"이고, 장부와는 맨 아래 대사 줄에서 만난다.
//
//  화면 순서는 매장 대시보드와 한 벌이다:
//    제목 + 계산 기준 → 핵심 지표 → 선수금 띠 → 팩별·결제수단별 → 학원별
// ============================================================

import { useMemo, useState } from "react";
import Link from "next/link";
import { ExternalLink, RefreshCw, Server, TriangleAlert } from "lucide-react";
import {
  BasisLine,
  Button,
  Card,
  ChartValues,
  EmptyState,
  ErrorState,
  InfoPopover,
  InlineNotice,
  KpiItem,
  KpiStrip,
  LoadingState,
  Money,
  MonthStepper,
  SegmentedControl,
  SERIES,
  PageHeader,
  PageShell,
  SectionHeader,
  StatTile,
  Table,
  TableNote,
  TableScroll,
  Td,
  Th,
  TotalRow,
  Tr,
} from "@/components/neander/ui";
import { ToolbarPortal } from "@/components/neander/shell/context";
import { SmoatDrill, type SmoatFact } from "@/components/neander/smoat/SmoatDrill";
// 매장 대시보드와 **같은 부품**이다 — 축 여백·눈금·hover 가 그대로라 두 화면을
// 번갈아 보는 사람이 다시 적응할 이유가 없다 (MonthTrendChart 주석 참고).
import { MonthTrendChart } from "@/components/neander/sales/MonthTrendChart";
import { useSmoat, useSmoatActivate } from "@/components/neander/smoat/SmoatProvider";
import {
  accountMethodText,
  buildSmoatPnl,
  smoatAccounts,
  smoatKindLabel,
  smoatMonths,
  smoatPayMethodLabel,
  smoatTrend,
  type SmoatPayMethod,
  type SmoatSale,
} from "@/lib/neander/smoat/types";
import { monthLabel } from "@/lib/neander/format";
import { selectableMonths } from "@/lib/neander/months";

/** 장부에서 같은 조건으로 보기 — 매장 대사 화면과 같은 방식 */
function ledgerHref(month: string): string {
  const params = new URLSearchParams({
    month,
    bizMinor: "SMOAT",
    txTypes: "수입",
  });
  return `/neander/finance/ledger?${params.toString()}`;
}

const pct = (v: number | null) => (v === null ? "—" : `${(v * 100).toFixed(1)}%`);
const num = (n: number) => n.toLocaleString("ko-KR");

type TrendRange = "6" | "12" | "all";

/**
 * 추이 막대 세 갈래 — 매장 대시보드가 매장 셋을 놓는 자리에 이쪽은 손익 셋을 놓는다.
 *
 * 공헌이익은 순매출과 AI 원가의 **차이**라서 「합계」 자리에 둔다 (total). 그래야
 * 커서를 올렸을 때 부분 두 줄 다음에 결과 한 줄로 읽힌다.
 */
const TREND_SERIES = [
  { key: "revenue", label: "순매출", color: SERIES.income },
  { key: "aiCost", label: "AI 원가", color: SERIES.expense },
  { key: "contribution", label: "공헌이익", color: SERIES.neutral, total: true },
];

export default function SmoatPage() {
  const { sales, costs, states, loading, refreshing, error, refresh } = useSmoat();
  const [month, setMonth] = useState("");
  // 이 화면에 들어올 때 받기 시작한다. 로딩·오류로 일찍 반환하기 **전에** 불러야 한다
  useSmoatActivate();

  const known = useMemo(() => smoatMonths(sales), [sales]);
  const months = useMemo(() => selectableMonths(known), [known]);
  const activeMonth = month || known[0] || months[0] || "";

  const pnl = useMemo(
    () => buildSmoatPnl(activeMonth, sales, costs),
    [activeMonth, sales, costs],
  );
  const accounts = useMemo(() => smoatAccounts(sales, activeMonth), [sales, activeMonth]);

  const [range, setRange] = useState<TrendRange>("12");
  /**
   * 월별 추이. 원가를 아직 못 받은 달은 AI 원가·공헌이익 **막대를 그리지 않는다**
   * — 0 으로 두면 "그 달은 원가가 없었다"로 읽힌다.
   */
  const trend = useMemo(() => {
    const asc = [...known].sort();
    const window = range === "all" ? asc : asc.slice(-Number(range));
    return smoatTrend(window, sales, costs);
  }, [known, range, sales, costs]);
  const trendPoints = useMemo(
    () =>
      trend.map((p) => ({
        month: p.month,
        values: {
          revenue: p.revenue,
          ...(p.aiCost === null ? {} : { aiCost: p.aiCost }),
          ...(p.contribution === null ? {} : { contribution: p.contribution }),
        },
      })),
    [trend],
  );

  // ---- 드릴이 여는 줄 — buildSmoatPnl 과 **같은 거름**이어야 창 합계가 칸과 같다 ----
  const monthRows = () => sales.filter((x) => x.date.slice(0, 7) === activeMonth && x.amount > 0);
  const packName = (x: SmoatSale) =>
    x.packLabel ?? (x.credits ? `${num(x.credits)} 크레딧` : "기타");
  const cost = costs.find((c) => c.id === activeMonth);
  /** 이 달 원가의 근거 — 사이트가 월 집계로만 주어 줄이 없다 */
  const costFacts = (): SmoatFact[] => {
    if (!cost) return [{ key: "none", label: "아직 받지 못했습니다", value: "—" }];
    return [
      { key: "usd", label: "AI 호출 비용", value: `$${cost.aiUsd.toFixed(2)}`, sub: "공급사에 지불한 달러" },
      {
        key: "fx",
        label: "환산 환율",
        value: cost.fxRate ? `${num(Math.round(cost.fxRate))}원/$` : "—",
        sub: "사이트가 호출마다 실제로 쓴 환율의 역산",
      },
      { key: "krw", label: "원화 원가", value: `${num(cost.aiKrw)}원`, strong: true },
      { key: "used", label: "이 달 쓰인 크레딧", value: num(cost.creditsUsed), sub: "무료 크레딧 사용분 포함" },
    ];
  };

  const state = states.find((s) => s.id === "smoat");
  const notConfigured = state && !state.configured;

  if (loading) return <LoadingState label="SMOAT 매출을 불러오는 중…" />;

  if (error) {
    return (
      <PageShell width="form">
        <PageHeader title="SMOAT 대시보드" description="영어 내신 문제·시험 생성 서비스의 매출입니다." />
        <ErrorState
          title="SMOAT 매출을 불러올 수 없습니다"
          description={error instanceof Error ? error.message : "알 수 없는 오류"}
        />
      </PageShell>
    );
  }

  if (sales.length === 0) {
    return (
      <PageShell width="form">
        <PageHeader title="SMOAT 대시보드" description="영어 내신 문제·시험 생성 서비스의 매출입니다." />
        <EmptyState
          icon={Server}
          title="아직 받아 온 결제가 없습니다"
          description={
            notConfigured ? (
              <>
                smoat.co.kr 피드가 아직 연결되지 않았습니다.{" "}
                <Link
                  href="/neander/sales/sync"
                  className="font-medium text-nd-accent-strong hover:underline"
                >
                  자동 동기화
                </Link>
                에서 설정 상태를 확인하세요.
              </>
            ) : (
              <>
                <Link
                  href="/neander/sales/sync"
                  className="font-medium text-nd-accent-strong hover:underline"
                >
                  자동 동기화
                </Link>
                에서 「지금 동기화」를 눌러 첫 적재를 시작하세요.
              </>
            )
          }
        />
      </PageShell>
    );
  }

  const sub = monthLabel(activeMonth);
  const hasSubscription = sales.some((s) => s.kind === "subscription");

  return (
    <PageShell>
      <ToolbarPortal order={0}>
        <MonthStepper glass months={months} value={activeMonth} onChange={setMonth} />
      </ToolbarPortal>

      <PageHeader
        title="SMOAT 대시보드"
        description="영어 내신 문제·시험 생성 서비스 (smoat.co.kr) 의 결제 실적입니다."
        className="mb-3"
        actions={
          <>
            <Button
              variant="secondary"
              icon={RefreshCw}
              onClick={() => void refresh()}
              disabled={refreshing}
            >
              {refreshing ? "받는 중…" : "새로고침"}
            </Button>
            <Link href={ledgerHref(activeMonth)}>
              <Button variant="secondary" icon={ExternalLink}>
                원장 열기
              </Button>
            </Link>
          </>
        }
      />

      <BasisLine
        className="mb-4"
        items={[
          "결제일 기준",
          `${sub} 확정 결제`,
          "환불은 뺀 순매출",
          "장부는 고치지 않습니다",
        ]}
      >
        <InfoPopover
          label="계산 기준"
          title="SMOAT 매출 계산 기준"
          terms={[
            {
              term: "결제일 기준",
              desc: "돈이 들어온 날로 답니다. 크레딧이 실제로 쓰인 달이 아닙니다 — 장부의 입금과 맞춰 보려면 결제일이어야 합니다.",
            },
            {
              term: "순매출",
              desc: "결제액에서 취소·환불액을 뺀 값입니다. 사이트의 /admin/costs 화면은 환불을 상태로만 걸러 부분취소가 남아 있습니다. 두 숫자가 다르면 이쪽이 맞습니다.",
            },
            {
              term: "AI 원가",
              desc: "그 달의 AI 호출 비용입니다. 향수의 직접재료비에 해당하는 자리입니다. 달러로 기록된 값을 사이트가 쓴 환율로 환산해 받습니다.",
            },
            {
              term: "공헌이익",
              desc: "순매출 − AI 원가. 원가를 아직 못 받은 달은 0 이 아니라 「—」로 둡니다 — 0 으로 두면 이익이 부풀려 보입니다.",
            },
            {
              term: "미소진 크레딧",
              desc: "판 크레딧에서 쓰인 크레딧을 뺀 누계로, 선수금의 근사치입니다. 쓰인 크레딧에 무료 체험·프로모션 크레딧의 사용분이 섞여 있어 실제보다 작게 나옵니다. 음수가 되면 근사가 깨졌다는 뜻입니다.",
            },
            {
              term: "신규 학원",
              desc: "그 학원의 첫 결제가 이 달인 경우입니다. 무통장 수기 지급은 어느 학원인지 모를 수 있어 세지 않습니다.",
            },
          ]}
        />
      </BasisLine>

      {!hasSubscription && (
        <InlineNotice tone="info" className="mb-4">
          지금 SMOAT 의 매출은 <b>크레딧 팩 선결제</b>가 거의 전부입니다. 정기구독은 다날 정기결제
          심사가 끝나지 않아 사이트에서 꺼져 있어 결제 건수가 0 입니다. 심사가 끝나면 이 화면에
          구독 줄이 저절로 들어옵니다.
        </InlineNotice>
      )}

      {pnl.aiCost === null && (
        <InlineNotice tone="warning" icon={TriangleAlert} className="mb-4">
          {sub} 의 AI 원가를 아직 받지 못했습니다. 공헌이익을 계산할 수 없어 「—」로 둡니다.
        </InlineNotice>
      )}

      <KpiStrip columns={4} className="mb-5">
        <StatTile
          label={`${sub} 순매출`}
          value={pnl.revenue}
          flow="income"
          hint={pnl.refund > 0 ? `환불 ${num(pnl.refund)}원 뺀 값` : `결제 ${pnl.count}건`}
          wrapValue={(money) => (
            <SmoatDrill title={`${sub} 순매출`} subtitle={sub} rows={monthRows} group="pack" flow="income">
              {money}
            </SmoatDrill>
          )}
        />
        <StatTile
          label="AI 원가"
          value={pnl.aiCost ?? 0}
          flow="expense"
          hint={pnl.aiCost === null ? "아직 받지 못했습니다" : "그 달 호출 비용"}
          wrapValue={(money) => (
            <SmoatDrill
              title="AI 원가"
              subtitle={sub}
              facts={costFacts}
              note="SMOAT 의 변동비는 AI 호출 비용입니다. 향수의 직접재료비에 해당하는 자리입니다. 사이트가 달러로 기록한 값을 그때그때의 환율로 환산해 받습니다."
            >
              {money}
            </SmoatDrill>
          )}
        />
        <StatTile
          label="공헌이익"
          value={pnl.contribution ?? 0}
          flow="income"
          hint={pnl.contribution === null ? "원가를 모릅니다" : `이익률 ${pct(pnl.contributionRate)}`}
          tag={pnl.contribution !== null && pnl.contribution < 0 ? "손실" : undefined}
          wrapValue={(money) => (
            <SmoatDrill
              title="공헌이익"
              subtitle={sub}
              facts={(): SmoatFact[] => [
                { key: "rev", label: "순매출", value: `${num(pnl.revenue)}원`, sub: `결제 ${pnl.count}건 · 환불 뺀 값` },
                { key: "cost", label: "AI 원가", value: pnl.aiCost === null ? "—" : `−${num(pnl.aiCost)}원` },
                {
                  key: "sum",
                  label: "= 공헌이익",
                  value: pnl.contribution === null ? "—" : `${num(pnl.contribution)}원`,
                  sub: pnl.contribution === null ? "원가를 몰라 계산할 수 없습니다" : `이익률 ${pct(pnl.contributionRate)}`,
                  strong: true,
                },
              ]}
              note="고정비(인건비·서버 외)는 아직 넣지 않았습니다. 여기서 빠진 것은 변동비 하나뿐이라, 이 숫자는 영업이익이 아닙니다."
            >
              {money}
            </SmoatDrill>
          )}
        />
        {/* 학원 수는 돈이 아니다 — StatTile 은 「원」을 붙이므로 KpiItem 으로 */}
        <KpiItem
          label="결제 학원"
          unit="곳"
          value={
            <SmoatDrill
              title="결제한 학원"
              subtitle={sub}
              rows={() => monthRows().filter((x) => x.accountId)}
              group="account"
              flow="income"
            >
              {num(pnl.accounts)}
            </SmoatDrill>
          }
          hint={`신규 ${pnl.newAccounts}곳 · 학원당 ${pnl.arpa === null ? "—" : `${num(pnl.arpa)}원`}`}
        />
      </KpiStrip>

      {/* 월별 추이 — 매장 대시보드와 같은 자리·같은 부품 */}
      <Card className="mb-5">
        <SectionHeader
          title="월별 추이"
          hint="순매출 · AI 원가 · 공헌이익"
          action={
            <SegmentedControl<TrendRange>
              size="sm"
              ariaLabel="기간"
              value={range}
              onChange={setRange}
              options={[
                { value: "6", label: "6개월" },
                { value: "12", label: "12개월" },
                { value: "all", label: "전체" },
              ]}
            />
          }
        />
        {trendPoints.length >= 2 ? (
          <>
            <MonthTrendChart points={trendPoints} series={TREND_SERIES} />
            <ChartValues
              className="mt-2"
              note="단위: 원 · 순매출은 환불을 뺀 값"
              columns={TREND_SERIES.map((x) => ({ key: x.key, label: x.label, color: x.color }))}
              rows={trend.map((p) => ({
                key: p.month,
                label: monthLabel(p.month),
                values: { revenue: p.revenue, aiCost: p.aiCost, contribution: p.contribution },
              }))}
            />
          </>
        ) : (
          <p className="py-10 text-center text-nd-caption text-nd-fg-3">
            두 달 이상 쌓이면 추이가 나타납니다.
          </p>
        )}
        <TableNote className="pt-2">
          AI 원가를 아직 받지 못한 달은 그 막대가 비어 있습니다 — 0 원이라는 뜻이 아닙니다.
        </TableNote>
      </Card>

      {/* 선수금 — 매출과 나란히 두어야 "번 것"과 "갚아야 할 것"이 갈린다 */}
      <Card className="mb-5">
        <SectionHeader
          title="크레딧"
          hint="판 것과 쓰인 것의 차이가 아직 갚지 않은 몫입니다"
        />
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <div className="text-nd-sm text-nd-fg-3">이 달 판 크레딧</div>
            <div className="nd-num text-nd-lg font-semibold">
              <SmoatDrill
                title="이 달 판 크레딧"
                subtitle={sub}
                rows={() => monthRows().filter((x) => (x.credits ?? 0) > 0)}
                amountOf={(x) => x.credits ?? 0}
                unit="credit"
                group="pack"
              >
                {num(pnl.creditsSold)}
              </SmoatDrill>
            </div>
          </div>
          <div>
            <div className="text-nd-sm text-nd-fg-3">이 달 쓰인 크레딧</div>
            <div className="nd-num text-nd-lg font-semibold">
              <SmoatDrill
                title="이 달 쓰인 크레딧"
                subtitle={sub}
                unit="credit"
                facts={(): SmoatFact[] => [
                  { key: "used", label: "쓰인 크레딧", value: num(pnl.creditsUsed), strong: true },
                  { key: "sold", label: "판 크레딧", value: num(pnl.creditsSold) },
                  {
                    key: "gap",
                    label: "이 달 차이",
                    value: num(pnl.creditsSold - pnl.creditsUsed),
                    sub: "판 것에서 쓰인 것을 뺀 값",
                  },
                ]}
                note="사이트는 크레딧 사용을 월 집계로만 줍니다. 어느 학원이 무엇에 썼는지는 SMOAT 관리자 화면에서 봅니다. 쓰인 크레딧에는 무료 체험·프로모션으로 준 크레딧의 사용분도 섞여 있습니다."
              >
                {num(pnl.creditsUsed)}
              </SmoatDrill>
            </div>
          </div>
          <div>
            <div className="text-nd-sm text-nd-fg-3">판 것 − 쓰인 것 누계 (선수금 근사)</div>
            <div
              className={`nd-num text-nd-lg font-semibold ${pnl.unusedCredits < 0 ? "text-nd-danger" : ""}`}
            >
              <SmoatDrill
                title="판 것 − 쓰인 것 누계"
                subtitle={`${sub} 까지`}
                unit="credit"
                facts={(): SmoatFact[] => [
                  ...costs
                    .filter((c) => c.id <= activeMonth)
                    .sort((a, b) => a.id.localeCompare(b.id))
                    .map((c) => ({
                      key: c.id,
                      label: monthLabel(c.id),
                      value: num(c.creditsSold - c.creditsUsed),
                      sub: `판 것 ${num(c.creditsSold)} · 쓰인 것 ${num(c.creditsUsed)}`,
                    })),
                  { key: "sum", label: "= 누계", value: num(pnl.unusedCredits), strong: true },
                ]}
                note="무료 체험·프로모션으로 준 크레딧의 사용분이 섞여 있어 실제 선수금보다 작게 나옵니다. 음수면 그 달들에 무료 크레딧이 많이 쓰였다는 뜻입니다."
              >
                {num(pnl.unusedCredits)}
              </SmoatDrill>
            </div>
            <div className="mt-0.5 text-nd-micro text-nd-fg-3">
              무료 크레딧 사용분이 섞여 실제보다 작게 나옵니다
            </div>
          </div>
        </div>
      </Card>

      <div className="mb-5 grid gap-4 lg:grid-cols-2">
        <Card padding="none" className="overflow-hidden">
          <div className="px-5 pt-4">
            <SectionHeader title="팩별" />
          </div>
          <TableScroll>
            <Table minWidth={420} dense>
              <thead>
                <tr>
                  <Th sticky="top" className="pl-5">팩</Th>
                  <Th sticky="top" align="right">건수</Th>
                  <Th sticky="top" align="right">크레딧</Th>
                  <Th sticky="top" align="right" className="pr-5">순매출</Th>
                </tr>
              </thead>
              <tbody>
                {pnl.byPack.map((p) => (
                  <Tr key={p.label}>
                    <Td className="pl-5">{p.label}</Td>
                    <Td num>{p.count}</Td>
                    <Td num>{num(p.credits)}</Td>
                    <Td num className="pr-5 font-semibold">
                      <SmoatDrill
                        title={`${p.label} · 순매출`}
                        subtitle={sub}
                        rows={() => monthRows().filter((x) => packName(x) === p.label)}
                        group="account"
                        flow="income"
                      >
                        <Money value={p.amount} unit={false} flow="income" />
                      </SmoatDrill>
                    </Td>
                  </Tr>
                ))}
                <TotalRow>
                  <Td className="pl-5">합계</Td>
                  <Td num>{pnl.count}</Td>
                  <Td num>{num(pnl.byPack.reduce((s, p) => s + p.credits, 0))}</Td>
                  <Td num className="pr-5">
                    <SmoatDrill title={`${sub} 순매출`} subtitle={sub} rows={monthRows} group="pack" flow="income">
                      <Money value={pnl.revenue} unit={false} flow="income" />
                    </SmoatDrill>
                  </Td>
                </TotalRow>
              </tbody>
            </Table>
          </TableScroll>
        </Card>

        <Card padding="none" className="overflow-hidden">
          <div className="px-5 pt-4">
            <SectionHeader title="결제수단별" hint="PG 수수료의 근거" />
          </div>
          <TableScroll>
            <Table minWidth={420} dense>
              <thead>
                <tr>
                  <Th sticky="top" className="pl-5">수단</Th>
                  <Th sticky="top" align="right">건수</Th>
                  <Th sticky="top" align="right" className="pr-5">순매출</Th>
                </tr>
              </thead>
              <tbody>
                {pnl.byMethod.map((m) => {
                  const label =
                    m.method === "unknown" ? "알 수 없음" : smoatPayMethodLabel(m.method as SmoatPayMethod);
                  return (
                    <Tr key={m.method}>
                      <Td className="pl-5">{label}</Td>
                      <Td num>{m.count}</Td>
                      <Td num className="pr-5 font-semibold">
                        <SmoatDrill
                          title={`${label} · 순매출`}
                          subtitle={sub}
                          rows={() =>
                            monthRows().filter((x) => (x.payMethod ?? "unknown") === m.method)
                          }
                          group="account"
                          flow="income"
                        >
                          <Money value={m.amount} unit={false} flow="income" />
                        </SmoatDrill>
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
          </TableScroll>
          <TableNote>
            요율은 아직 넣지 않았습니다 — 다날 정산 내역이 정본이고, 그 값을 받기 전까지
            추정하지 않습니다.
          </TableNote>
        </Card>
      </div>

      <Card padding="none" className="overflow-hidden">
        <div className="px-5 pt-4">
          <SectionHeader title="학원별" hint={`${sub} 에 결제한 학원 ${accounts.length}곳`} />
        </div>
        <TableScroll>
          <Table minWidth={720} dense>
            <thead>
              <tr>
                <Th sticky="top" className="pl-5">학원</Th>
                <Th sticky="top" align="right">건수</Th>
                <Th sticky="top">결제수단</Th>
                <Th sticky="top" align="right">순매출</Th>
                <Th sticky="top" className="pr-5">첫 결제</Th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => {
                const isNew = a.firstDate.slice(0, 7) === activeMonth;
                return (
                  <Tr key={a.accountId}>
                    <Td className="pl-5">{a.accountName}</Td>
                    <Td num>{a.count}</Td>
                    <Td className="whitespace-nowrap text-nd-caption text-nd-fg-2">
                      {accountMethodText(a)}
                    </Td>
                    <Td num className="font-semibold">
                      <SmoatDrill
                        title={`${a.accountName} · 순매출`}
                        subtitle={sub}
                        rows={() => monthRows().filter((x) => x.accountId === a.accountId)}
                        group="pack"
                        flow="income"
                      >
                        <Money value={a.amount} unit={false} flow="income" />
                      </SmoatDrill>
                    </Td>
                    <Td className="pr-5 text-nd-sm text-nd-fg-3">
                      {a.firstDate}
                      {isNew && <span className="ml-1 text-nd-accent-strong">신규</span>}
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        </TableScroll>
        <TableNote>
          무통장 수기 지급({smoatKindLabel("deposit")})은 어느 학원인지 모를 수 있어 이 표에
          나오지 않습니다. 위 순매출에는 들어갑니다.
        </TableNote>
      </Card>
    </PageShell>
  );
}
