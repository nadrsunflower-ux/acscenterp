"use client";

// ============================================================
//  리포트 › 구독 — 엑셀 「구독서비스 관리」 시트
// ------------------------------------------------------------
//  엑셀과 다른 점이 하나 있고, 그게 이 화면의 핵심이다.
//
//  엑셀·기존 대시보드는 **거래처 키워드만** 보고 구독비를 셌다. 그래서
//  키워드에 사람 이름이 들어간 규칙(`이동주`·`김제연`)이 급여 이체를
//  구독비로 끌어왔다 — 2026-07 실측 554만원. 여기서는 먼저
//  **구독 계정**(구독서비스비·툴구독비·개발프로그램구독비)으로 좁히고
//  그 안에서만 거래처를 맞춘다.
//
//  2단계에서 구독 마스터(neander_fin_subscriptions)가 정본이 됐다. 서비스마다
//  키워드를 **여러 개** 둘 수 있는데, 같은 서비스가 결제 창구에 따라 다른
//  이름으로 찍히기 때문이다 — Anthropic 은 `ANTHROPIC* CLAUDE SUB` ·
//  `ANTHROPIC` · `CLAUDE.AI SUBSCRIPTION` 세 가지로 들어온다.
//
//  검증 기준 2026-07: 구독 계정 합계 4,180,260 (키워드만 쓰면 9,310,600)
//
//  화면 구성은 형제 화면(지출상세·사업부)과 같은 순서다: 제목 줄 → 리포트
//  탭 → 집계 기준 → 핵심 지표 → 표. 다만 이 화면에는 조회 조건 줄이 없다
//  — 구독은 「그 달 전체」로만 보는 것이 맞아서 걸 것이 월 스테퍼뿐이다.
//  없는 필터를 형제와 맞추자고 새로 만들지 않았다.
// ============================================================

import {
  useMemo,
  useState,
} from "react";
import Link from "next/link";
import {
  Grid3x3,
  Repeat,
} from "lucide-react";
import {
  Badge,
  BasisLine,
  Card,
  Disclosure,
  EmptyState,
  KpiStrip,
  LoadingState,
  Money,
  MonthStepper,
  PageHeader,
  PageShell,
  rampColor,
  rampTextClass,
  RatioTile,
  SectionHeader,
  StatTile,
  Table,
  TableNote,
  TableScroll,
  Td,
  Th,
  type Tone,
  TotalRow,
  Tr,
} from "@/components/neander/ui";
import { ToolbarPortal } from "@/components/neander/shell/context";
import { useFinance } from "@/components/neander/finance/FinanceProvider";
import { ReportTabs } from "@/components/neander/finance/ReportTabs";
import { availableMonths } from "@/lib/neander/finance/aggregate";
import { ledgerHref } from "@/lib/neander/finance/ledgerLink";
import {
  SUBSCRIPTION_ACCOUNTS,
  subscriptionByMonth,
  subscriptionMatchers,
  subscriptionMonthView,
  type SubscriptionAlert,
} from "@/lib/neander/finance/report";
import { netAmount } from "@/lib/neander/finance/types";
import {
  monthLabel,
} from "@/lib/neander/format";

const TREND_MONTHS = 6;

const ALERT_TONE: Record<SubscriptionAlert["kind"], { label: string; tone: Tone }> = {
  split: { label: "카드 분산", tone: "warning" },
  missing: { label: "결제 없음", tone: "info" },
  spike: { label: "급증", tone: "danger" },
  over: { label: "예상 초과", tone: "danger" },
  review: { label: "확인 필요", tone: "neutral" },
};

function AlertChip({ alert }: { alert: SubscriptionAlert }) {
  const st = ALERT_TONE[alert.kind];
  return (
    <span title={alert.message}>
      <Badge tone={st.tone} size="sm">{st.label}</Badge>
    </span>
  );
}

export default function SubscriptionReport() {
  const { transactions, vendorRules, subscriptions, paymentMethods, loading } = useFinance();

  const months = useMemo(() => availableMonths(transactions), [transactions]);
  const [month, setMonth] = useState<string>("");
  const activeMonth = month || months[0] || "";

  const matchers = useMemo(
    () => subscriptionMatchers(subscriptions, vendorRules),
    [subscriptions, vendorRules],
  );

  // 최근 6개월 (오래된 달 → 최근 달 순으로 보여준다)
  const trendMonths = useMemo(() => months.slice(0, TREND_MONTHS).reverse(), [months]);

  const { views, report } = useMemo(
    () => subscriptionMonthView(transactions, matchers, activeMonth, trendMonths),
    [transactions, matchers, activeMonth, trendMonths],
  );
  const alerts = useMemo(
    () => views.filter((v) => v.alerts.length > 0),
    [views],
  );
  const viewOf = useMemo(() => new Map(views.map((v) => [v.matcher.service, v])), [views]);

  const trend = useMemo(
    () => subscriptionByMonth(transactions, matchers, trendMonths),
    [transactions, matchers, trendMonths],
  );
  const trendMax = useMemo(
    () => Math.max(1, ...trend.flatMap((r) => Object.values(r.byMonth))),
    [trend],
  );

  /** 결제수단 정비 진행률 — 개인 명의 카드로 나가는 비율 */
  const cardHealth = useMemo(() => {
    const personal = new Set(paymentMethods.filter((p) => p.personal).map((p) => p.last4));
    let personalAmt = 0;
    let corpAmt = 0;
    report.services.forEach((s) =>
      s.rows.forEach((t) => {
        if (t.txType !== "지출") return;
        if (personal.has(t.last4 ?? "")) personalAmt += netAmount(t);
        else corpAmt += netAmount(t);
      }),
    );
    const total = personalAmt + corpAmt;
    return { personalAmt, corpAmt, ratio: total > 0 ? personalAmt / total : 0 };
  }, [report, paymentMethods]);

  const aliasOf = useMemo(() => {
    const map = new Map(paymentMethods.map((p) => [p.last4, p.alias]));
    return (last4: string) => map.get(last4) ?? last4;
  }, [paymentMethods]);

  if (loading) return <LoadingState label="리포트를 만드는 중…" />;
  if (transactions.length === 0) {
    return (
      <PageShell>
        <PageHeader title="구독" description="SaaS · 툴 구독 지출" />
        <ReportTabs className="mb-6" />
        <EmptyState
          icon={Repeat}
          title="아직 거래가 없습니다"
          description="임포트 탭에서 장부를 올리면 구독 지출이 나타납니다."
        />
      </PageShell>
    );
  }

  const subsHref = (extra: { vendor?: string; acctMinor?: string } = {}) =>
    ledgerHref({ month: activeMonth, txTypes: ["지출"], ...extra });

  return (
    <PageShell>
      <ToolbarPortal order={0}>
        <MonthStepper glass months={months} value={activeMonth} onChange={setMonth} />
      </ToolbarPortal>

      <PageHeader title="구독" description="SaaS · 툴 구독 지출" className="mb-4" />
      <ReportTabs className="mb-4" />

      {/* 집계 기준은 형제 화면과 같은 자리·같은 모양의 한 줄로 — 문단으로 두면
          KPI 를 밀어내는데, 매번 읽을 문장은 아니다 */}
      <BasisLine
        className="mb-4"
        items={[
          <>
            계정소분류 <b className="font-medium text-nd-fg-2">{SUBSCRIPTION_ACCOUNTS.join(" · ")}</b> 중 거래처 규칙에 맞는 것
          </>,
          `${monthLabel(activeMonth)} ${report.count.toLocaleString("ko-KR")}건`,
          "계정으로 먼저 좁혀 이름이 같은 급여 이체가 섞이지 않음",
        ]}
      />

      <KpiStrip columns={4} className="mb-5">
        <StatTile label="구독 지출" value={report.total} hint={`${report.count.toLocaleString("ko-KR")}건 · ${monthLabel(activeMonth)}`} />
        <StatTile label="서비스 수" value={report.services.length} hint="규칙에 잡힌 것" />
        <StatTile label="미매칭" value={report.unmatchedTotal} hint={`${report.unmatched.length}건 — 규칙 추가 필요`} />
        <RatioTile
          label="개인카드 결제 비율"
          value={cardHealth.ratio}
          digits={0}
          hint={<>법인카드 전환 대상 <Money value={cardHealth.personalAmt} unit={false} />원</>}
        />
      </KpiStrip>

      {/* ---- 이번 달 확인할 것 ---- */}
      {alerts.length > 0 && (
        <Card padding="none" className="mb-5 overflow-hidden">
          <div className="px-5 pt-5">
            <SectionHeader
              title={<>이번 달 확인할 것 <span className="text-nd-fg-3">{alerts.length}건</span></>}
              hint="기준선은 직전 달들의 중앙값 — 사용량 과금이 한 달만 튀는 걸 평균보다 덜 탄다"
            />
          </div>
          <ul className="divide-y divide-nd-line border-t border-nd-line">
            {alerts.map((v) => (
              <li key={v.matcher.service} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2 text-nd-body">
                <span className="min-w-[150px] font-medium text-nd-fg">{v.matcher.service}</span>
                <span className="flex flex-wrap gap-1">
                  {v.alerts.map((a) => (
                    <AlertChip key={a.kind} alert={a} />
                  ))}
                </span>
                <span className="min-w-0 flex-1 text-nd-caption text-nd-fg-2">{v.alerts[0].message}</span>
                {v.current && (
                  <span className="shrink-0">
                    <Money value={v.current.net} unit={false} />
                  </span>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* ---- 서비스별 ---- */}
      <Card padding="none" className="mb-5 overflow-hidden">
        <div className="px-5 pt-5">
          <SectionHeader
            title="서비스별 구독비"
            hint="순지출 기준 · 결제수단이 여러 개면 카드가 흩어져 있다는 뜻"
            action={<TableNote>단위: 원</TableNote>}
          />
        </div>
        {report.services.length === 0 ? (
          /* 카드 안이라 테두리는 뺀다 — 점선 상자가 이중으로 겹치면 빈 칸이 오류처럼 보인다 */
          <EmptyState
            className="border-0"
            compact
            title="이 달에 구독 계정으로 잡힌 거래가 없습니다"
            description="구독 계정으로 분류된 지출이 들어오면 여기에 서비스별로 쌓입니다."
          />
        ) : (
          <TableScroll>
            <Table minWidth={760}>
              <thead>
                <tr>
                  <Th className="pl-5">서비스</Th>
                  <Th>결제수단</Th>
                  <Th align="right">건수</Th>
                  <Th align="right">지출</Th>
                  <Th align="right">환급</Th>
                  <Th align="right">순지출</Th>
                  <Th align="right" className="pr-5">비중</Th>
                </tr>
              </thead>
              <tbody>
                {report.services.map((s) => {
                  const share = report.total > 0 ? s.net / report.total : 0;
                  const view = viewOf.get(s.service);
                  return (
                    <Tr key={s.service}>
                      <Td className="pl-5 font-medium text-nd-fg">
                        <Link href={subsHref({ vendor: s.keywords[0] })} className="hover:underline">
                          {s.service}
                        </Link>
                        <span className="ml-1.5 text-nd-caption font-normal text-nd-fg-3">
                          {s.keywords.join(" · ")}
                        </span>
                        {(view?.alerts ?? []).length > 0 && (
                          <span className="ml-1.5 inline-flex gap-1 align-middle">
                            {view!.alerts.map((a) => (
                              <AlertChip key={a.kind} alert={a} />
                            ))}
                          </span>
                        )}
                        {view?.matcher.recommendedCard && (
                          <span className="ml-1.5 text-nd-micro font-normal text-nd-fg-3">
                            → {view.matcher.recommendedCard}
                          </span>
                        )}
                      </Td>
                      <Td>
                        <div className="flex flex-wrap gap-1">
                          {s.last4.map((l) => (
                            <span key={l} title={aliasOf(l)}>
                              <Badge tone="neutral" size="sm">{aliasOf(l)}</Badge>
                            </span>
                          ))}
                          {s.last4.length > 1 && (
                            <Badge tone="warning" size="sm">분산 {s.last4.length}</Badge>
                          )}
                        </div>
                      </Td>
                      <Td num muted>{s.count}</Td>
                      <Td num><Money value={s.expense} unit={false} /></Td>
                      <Td num>
                        {s.refund ? <Money value={s.refund} unit={false} /> : <span className="text-nd-fg-4">—</span>}
                      </Td>
                      <Td num className="font-medium"><Money value={s.net} unit={false} /></Td>
                      <Td num muted className="pr-5">{(share * 100).toFixed(1)}%</Td>
                    </Tr>
                  );
                })}
              </tbody>
              <tfoot>
                <TotalRow>
                  <Td className="pl-5" colSpan={2}>소계 (규칙에 잡힌 것)</Td>
                  <Td num>{report.services.reduce((s, x) => s + x.count, 0)}</Td>
                  <Td colSpan={2} />
                  <Td num><Money value={report.total - report.unmatchedTotal} unit={false} /></Td>
                  <Td className="pr-5" />
                </TotalRow>
              </tfoot>
            </Table>
          </TableScroll>
        )}
      </Card>

      {/* ---- 미매칭 ---- */}
      {report.unmatched.length > 0 && (
        <Card padding="none" className="mb-5 overflow-hidden">
          <div className="px-5 pt-5">
            <SectionHeader
              title="분류 안 된 구독비"
              hint="구독 계정인데 거래처 규칙에 없는 거래 — 마스터 탭에서 규칙을 추가하세요"
              action={<TableNote>단위: 원</TableNote>}
            />
          </div>
          <TableScroll>
            <Table minWidth={560}>
              <thead>
                <tr>
                  <Th className="pl-5">거래일</Th>
                  <Th>거래처</Th>
                  <Th>계정소분류</Th>
                  <Th align="right" className="pr-5">금액</Th>
                </tr>
              </thead>
              <tbody>
                {report.unmatched.map((t) => (
                  <Tr key={t.id}>
                    <Td className="nd-num whitespace-nowrap pl-5 text-nd-fg-2">{t.date}</Td>
                    <Td className="font-medium text-nd-fg">
                      <Link href={subsHref({ vendor: t.vendor })} className="hover:underline">
                        {t.vendor || "(거래처 없음)"}
                      </Link>
                    </Td>
                    <Td muted>{t.acctMinor}</Td>
                    <Td num className="pr-5"><Money value={netAmount(t)} unit={false} /></Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </TableScroll>
        </Card>
      )}

      {/* ---- 월별 추이 ----
          매달 보는 표가 아니라 "왜 이번 달만 튀었나"를 물을 때 펴는 표다.
          접힌 채로도 몇 달치인지 보이도록 meta 에 기간을 남긴다. */}
      {trend.length > 0 && trendMonths.length > 1 && (
        <Disclosure
          icon={Grid3x3}
          title="서비스 × 월"
          description="색이 진할수록 지출이 큼 · 빈 칸은 그 달에 결제가 없었다는 뜻"
          defaultOpen={false}
          meta={`최근 ${trendMonths.length}개월 · ${trend.length}개 서비스`}
          bodyClassName="!p-0"
        >
          <TableScroll>
            <Table minWidth={620} dense>
              <thead>
                <tr>
                  <Th className="pl-5">서비스</Th>
                  {trendMonths.map((m) => (
                    <Th key={m} align="right" className="nd-num px-2">{m.slice(2)}</Th>
                  ))}
                  <Th align="right" className="pr-5">합계</Th>
                </tr>
              </thead>
              <tbody>
                {trend.map((r) => (
                  <Tr key={r.service} hover={false}>
                    <Td className="pl-5 font-medium text-nd-fg">{r.service}</Td>
                    {trendMonths.map((m) => {
                      const v = r.byMonth[m] ?? 0;
                      return (
                        <Td
                          key={m}
                          num
                          className={`px-2 text-nd-caption ${rampTextClass(v, trendMax)}`}
                          style={{ backgroundColor: rampColor(v, trendMax) }}
                        >
                          {v ? Math.round(v / 1000).toLocaleString("ko-KR") : "—"}
                        </Td>
                      );
                    })}
                    <Td num className="pr-5 font-medium"><Money value={r.total} unit={false} /></Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </TableScroll>
          <TableNote className="border-t border-nd-line px-5 py-2">월별 칸은 천원 단위 · 합계는 원 단위</TableNote>
        </Disclosure>
      )}
    </PageShell>
  );
}
