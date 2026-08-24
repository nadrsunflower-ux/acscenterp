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
// ============================================================

import { useMemo, useState } from "react";
import Link from "next/link";
import { Card, EmptyState } from "@/components/neander/ui";
import { useFinance } from "@/components/neander/finance/FinanceProvider";
import { ReportTabs } from "@/components/neander/finance/ReportTabs";
import { Money, StatTile, SectionTitle, rampColor, rampTextClass } from "@/components/neander/finance/ui";
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

const TREND_MONTHS = 6;

const ALERT_STYLE: Record<SubscriptionAlert["kind"], { label: string; cls: string }> = {
  split: { label: "카드 분산", cls: "bg-amber-100 text-amber-800" },
  missing: { label: "결제 없음", cls: "bg-sky-100 text-sky-800" },
  spike: { label: "급증", cls: "bg-rose-100 text-rose-800" },
  over: { label: "예상 초과", cls: "bg-rose-100 text-rose-800" },
  review: { label: "확인 필요", cls: "bg-zinc-200 text-zinc-700" },
};

function AlertChip({ alert }: { alert: SubscriptionAlert }) {
  const st = ALERT_STYLE[alert.kind];
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${st.cls}`}
      title={alert.message}
    >
      {st.label}
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

  if (loading) {
    return <div className="px-5 py-16 text-center text-zinc-400">불러오는 중…</div>;
  }
  if (transactions.length === 0) {
    return (
      <div className="mx-auto w-full max-w-7xl px-5 py-8">
        <ReportTabs />
        <div className="mt-6">
          <EmptyState icon="🔁" title="아직 거래가 없습니다" description="임포트 탭에서 장부를 올리면 구독 지출이 나타납니다." />
        </div>
      </div>
    );
  }

  const subsHref = (extra: { vendor?: string; acctMinor?: string } = {}) =>
    ledgerHref({ month: activeMonth, txTypes: ["지출"], ...extra });

  return (
    <div className="mx-auto w-full max-w-7xl px-5 py-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <ReportTabs />
        <select
          value={activeMonth}
          onChange={(e) => setMonth(e.target.value)}
          className="h-8 cursor-pointer rounded-md border border-zinc-300 bg-white pl-2 pr-6 text-xs text-zinc-800 outline-none focus:border-indigo-500"
        >
          {months.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
      </div>

      <p className="mb-4 text-xs text-zinc-500">
        집계 기준: 계정소분류가 <b className="font-medium text-zinc-700">{SUBSCRIPTION_ACCOUNTS.join(" · ")}</b> 인 거래
        중 거래처 규칙에 맞는 것. 계정으로 먼저 좁히므로 이름이 같은 급여 이체가 섞이지 않습니다.
      </p>

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="구독 지출" value={report.total} hint={`${report.count.toLocaleString("ko-KR")}건 · ${activeMonth}`} />
        <StatTile label="서비스 수" value={report.services.length} hint="규칙에 잡힌 것" />
        <StatTile label="미매칭" value={report.unmatchedTotal} hint={`${report.unmatched.length}건 — 규칙 추가 필요`} />
        <div className="relative overflow-hidden rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
          <p className="text-xs text-zinc-500">개인카드 결제 비율</p>
          <p className="mt-1 text-xl font-bold tracking-tight tabular-nums">
            {Math.round(cardHealth.ratio * 100)}%
          </p>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-100">
            <div
              className="h-full rounded-full bg-amber-500"
              style={{ width: `${Math.round(cardHealth.ratio * 100)}%` }}
            />
          </div>
          <p className="mt-1 text-xs text-zinc-400">
            법인카드 전환 대상 <Money value={cardHealth.personalAmt} unit={false} />원
          </p>
        </div>
      </div>

      {/* ---- 이번 달 확인할 것 ---- */}
      {alerts.length > 0 && (
        <Card className="mb-5 overflow-hidden p-0">
          <div className="border-b border-zinc-200 px-4 py-3">
            <SectionTitle hint="기준선은 직전 달들의 중앙값 — 사용량 과금이 한 달만 튀는 걸 평균보다 덜 탄다">
              이번 달 확인할 것 <span className="text-zinc-400">{alerts.length}건</span>
            </SectionTitle>
          </div>
          <ul className="divide-y divide-zinc-100">
            {alerts.map((v) => (
              <li key={v.matcher.service} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm">
                <span className="min-w-[150px] font-medium text-zinc-900">{v.matcher.service}</span>
                <span className="flex flex-wrap gap-1">
                  {v.alerts.map((a) => (
                    <AlertChip key={a.kind} alert={a} />
                  ))}
                </span>
                <span className="min-w-0 flex-1 text-xs text-zinc-500">{v.alerts[0].message}</span>
                {v.current && (
                  <span className="shrink-0 text-sm">
                    <Money value={v.current.net} unit={false} />
                  </span>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* ---- 서비스별 ---- */}
      <Card className="mb-5 overflow-hidden p-0">
        <div className="border-b border-zinc-200 px-4 py-3">
          <SectionTitle hint="순지출 기준 · 결제수단이 여러 개면 카드가 흩어져 있다는 뜻">
            서비스별 구독비
          </SectionTitle>
        </div>
        {report.services.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-zinc-400">
            이 달에 구독 계정으로 잡힌 거래가 없습니다.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-zinc-200 bg-zinc-50 text-xs text-zinc-500">
                  <th className="px-4 py-2 text-left font-medium">서비스</th>
                  <th className="px-3 py-2 text-left font-medium">결제수단</th>
                  <th className="px-3 py-2 text-right font-medium">건수</th>
                  <th className="px-3 py-2 text-right font-medium">지출</th>
                  <th className="px-3 py-2 text-right font-medium">환급</th>
                  <th className="px-3 py-2 text-right font-medium">순지출</th>
                  <th className="px-4 py-2 text-right font-medium">비중</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {report.services.map((s) => {
                  const share = report.total > 0 ? s.net / report.total : 0;
                  return (
                    <tr key={s.service} className="hover:bg-indigo-50/40">
                      <td className="px-4 py-2 font-medium text-zinc-900">
                        <Link href={subsHref({ vendor: s.keywords[0] })} className="hover:underline">
                          {s.service}
                        </Link>
                        <span className="ml-1.5 text-xs font-normal text-zinc-400">
                          {s.keywords.join(" · ")}
                        </span>
                        {(viewOf.get(s.service)?.alerts ?? []).length > 0 && (
                          <span className="ml-1.5 inline-flex gap-1 align-middle">
                            {viewOf.get(s.service)!.alerts.map((a) => (
                              <AlertChip key={a.kind} alert={a} />
                            ))}
                          </span>
                        )}
                        {viewOf.get(s.service)?.matcher.recommendedCard && (
                          <span className="ml-1.5 text-[11px] font-normal text-zinc-400">
                            → {viewOf.get(s.service)!.matcher.recommendedCard}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-1">
                          {s.last4.map((l) => (
                            <span
                              key={l}
                              className="rounded border border-zinc-200 px-1.5 py-0.5 text-[11px] text-zinc-500"
                              title={aliasOf(l)}
                            >
                              {aliasOf(l)}
                            </span>
                          ))}
                          {s.last4.length > 1 && (
                            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-800">
                              분산 {s.last4.length}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-zinc-600">{s.count}</td>
                      <td className="px-3 py-2 text-right"><Money value={s.expense} unit={false} /></td>
                      <td className="px-3 py-2 text-right">
                        {s.refund ? <Money value={s.refund} unit={false} /> : <span className="text-zinc-300">—</span>}
                      </td>
                      <td className="px-3 py-2 text-right font-medium"><Money value={s.net} unit={false} /></td>
                      <td className="px-4 py-2 text-right tabular-nums text-zinc-500">
                        {(share * 100).toFixed(1)}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-zinc-300 bg-zinc-50 font-semibold">
                  <td className="px-4 py-2" colSpan={2}>소계 (규칙에 잡힌 것)</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {report.services.reduce((s, x) => s + x.count, 0)}
                  </td>
                  <td colSpan={2} />
                  <td className="px-3 py-2 text-right">
                    <Money value={report.total - report.unmatchedTotal} unit={false} />
                  </td>
                  <td className="px-4 py-2" />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>

      {/* ---- 미매칭 ---- */}
      {report.unmatched.length > 0 && (
        <Card className="mb-5 overflow-hidden p-0">
          <div className="border-b border-zinc-200 px-4 py-3">
            <SectionTitle hint="구독 계정인데 거래처 규칙에 없는 거래 — 마스터 탭에서 규칙을 추가하세요">
              분류 안 된 구독비
            </SectionTitle>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-zinc-200 bg-zinc-50 text-xs text-zinc-500">
                  <th className="px-4 py-2 text-left font-medium">거래일</th>
                  <th className="px-3 py-2 text-left font-medium">거래처</th>
                  <th className="px-3 py-2 text-left font-medium">계정소분류</th>
                  <th className="px-4 py-2 text-right font-medium">금액</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {report.unmatched.map((t) => (
                  <tr key={t.id} className="hover:bg-indigo-50/40">
                    <td className="whitespace-nowrap px-4 py-2 tabular-nums text-zinc-600">{t.date}</td>
                    <td className="px-3 py-2 font-medium text-zinc-900">
                      <Link href={subsHref({ vendor: t.vendor })} className="hover:underline">
                        {t.vendor || "(거래처 없음)"}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-zinc-500">{t.acctMinor}</td>
                    <td className="px-4 py-2 text-right"><Money value={netAmount(t)} unit={false} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* ---- 월별 추이 ---- */}
      {trend.length > 0 && trendMonths.length > 1 && (
        <Card className="overflow-hidden p-0">
          <div className="border-b border-zinc-200 px-4 py-3">
            <SectionTitle hint="색이 진할수록 지출이 큼 · 빈 칸은 그 달에 결제가 없었다는 뜻">
              서비스 × 월
            </SectionTitle>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-sm">
              <thead>
                <tr className="border-b border-zinc-200 bg-zinc-50 text-xs text-zinc-500">
                  <th className="px-4 py-2 text-left font-medium">서비스</th>
                  {trendMonths.map((m) => (
                    <th key={m} className="px-2 py-2 text-right font-medium tabular-nums">{m.slice(2)}</th>
                  ))}
                  <th className="px-4 py-2 text-right font-medium">합계</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {trend.map((r) => (
                  <tr key={r.service}>
                    <td className="px-4 py-1.5 font-medium text-zinc-800">{r.service}</td>
                    {trendMonths.map((m) => {
                      const v = r.byMonth[m] ?? 0;
                      return (
                        <td
                          key={m}
                          className={`px-2 py-1.5 text-right tabular-nums text-xs ${rampTextClass(v, trendMax)}`}
                          style={{ backgroundColor: rampColor(v, trendMax) }}
                        >
                          {v ? Math.round(v / 1000).toLocaleString("ko-KR") : "—"}
                        </td>
                      );
                    })}
                    <td className="px-4 py-1.5 text-right font-medium"><Money value={r.total} unit={false} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="border-t border-zinc-100 px-4 py-2 text-xs text-zinc-400">월별 칸은 천원 단위 · 합계는 원 단위</p>
        </Card>
      )}
    </div>
  );
}
