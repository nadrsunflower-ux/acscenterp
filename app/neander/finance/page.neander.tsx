"use client";

// ============================================================
//  재무 대시보드 — 엑셀 「사업부손익」·「핵심대시보드」 시트의 재현
// ------------------------------------------------------------
//  검증 기준: 2026-07 총수입 41,656,602 / 총지출 58,896,728 /
//             환급 143,700 / 순손익 △17,096,426
//  이 수치가 엑셀과 원 단위로 맞아야 이관이 성공한 것이다.
// ============================================================

import Link from "next/link";
import { useMemo, useState } from "react";
import { Card, PageHeader, Badge, EmptyState, Select } from "@/components/neander/ui";
import { useFinance } from "@/components/neander/finance/FinanceProvider";
import {
  Money,
  StatTile,
  SectionTitle,
  SERIES,
  rampColor,
  rampTextClass,
} from "@/components/neander/finance/ui";
import { TrendChart } from "@/components/neander/finance/TrendChart";
import {
  availableMonths,
  businessUnitPL,
  expenseMatrix,
  inMonth,
  monthlyTrend,
  bySite,
  topVendors,
  subscriptionSpend,
  totals,
  plOnly,
} from "@/lib/neander/finance/aggregate";

export default function FinanceDashboard() {
  const { transactions, vendorRules, loading, masterEmpty } = useFinance();
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
  const trend = useMemo(() => monthlyTrend(transactions), [transactions]);
  const sites = useMemo(() => bySite(scoped), [scoped]);
  const vendors = useMemo(() => topVendors(scoped, 10), [scoped]);
  const subs = useMemo(
    () => subscriptionSpend(scoped, vendorRules).filter((s) => s.count > 0),
    [scoped, vendorRules],
  );

  const pending = transactions.filter(
    (x) => x.status === "suggested" || x.status === "needs_review",
  ).length;

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-7xl px-5 py-16 text-center text-zinc-400">
        불러오는 중…
      </div>
    );
  }

  // 아직 아무것도 없는 상태 — 무엇부터 해야 하는지 알려준다
  if (transactions.length === 0) {
    return (
      <div className="mx-auto w-full max-w-7xl px-5 py-8">
        <PageHeader title="재무" description="통합거래장 · 자동분류 · 손익" />
        <EmptyState
          icon="📒"
          title="아직 거래가 없습니다"
          description={
            masterEmpty
              ? "먼저 마스터 탭에서 계정·계좌 마스터를 적재한 뒤, 임포트 탭에서 장부 엑셀을 올리세요."
              : "임포트 탭에서 통합거래장 엑셀을 올리면 여기에 손익이 나타납니다."
          }
        />
        <div className="mt-4 flex justify-center gap-2">
          {masterEmpty && (
            <Link
              href="/neander/finance/master"
              className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
            >
              마스터 적재하기
            </Link>
          )}
          <Link
            href="/neander/finance/import"
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
          >
            엑셀 임포트
          </Link>
        </div>
      </div>
    );
  }

  const maxCell = Math.max(
    1,
    ...matrix.rowKeys.flatMap((r) => matrix.colKeys.map((c) => matrix.cells[r]?.[c] ?? 0)),
  );

  return (
    <div className="mx-auto w-full max-w-7xl px-5 py-8">
      <PageHeader
        title="재무"
        description="통합거래장 기준 손익 — 자금거래·카드대금결제는 손익에서 제외되고 환급은 지출에서 차감됩니다."
        actions={
          <div className="flex items-center gap-2">
            {pending > 0 && (
              <Link href="/neander/finance/review">
                <Badge color="#e11d48">검토 대기 {pending}건</Badge>
              </Link>
            )}
            <Select value={activeMonth} onChange={(e) => setMonth(e.target.value)}>
              {months.map((m) => (
                <option key={m} value={m}>
                  {m.replace("-", "년 ")}월
                </option>
              ))}
            </Select>
          </div>
        }
      />

      {/* 헤드라인 */}
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="총수입" value={t.income} accent={SERIES.income} />
        <StatTile label="총지출" value={t.expense} accent={SERIES.expense} />
        <StatTile label="환급" value={t.refund} hint="지출에서 차감됨" />
        <StatTile
          label="순손익"
          value={t.net}
          hint="수입 − (지출 − 환급)"
        />
      </div>

      {/* 월별 추이 */}
      {trend.length >= 2 && (
        <Card className="mb-6">
          <SectionTitle hint="전체 기간">월별 추이</SectionTitle>
          <TrendChart points={trend} />
        </Card>
      )}

      {/* 사업부손익 */}
      <Card className="mb-6 overflow-hidden p-0">
        <div className="px-5 pt-5">
          <SectionTitle hint="사업구분 축">사업부별 손익</SectionTitle>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-y border-zinc-200 bg-zinc-50 text-xs text-zinc-500">
                <th className="px-5 py-2 text-left font-medium">대분류</th>
                <th className="px-3 py-2 text-left font-medium">소분류</th>
                <th className="px-3 py-2 text-right font-medium">수입</th>
                <th className="px-3 py-2 text-right font-medium">지출</th>
                <th className="px-3 py-2 text-right font-medium">환급</th>
                <th className="px-5 py-2 text-right font-medium">순손익</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {pl.rows.map((r) => (
                <tr key={`${r.bizMajor}|${r.bizMinor}`} className="hover:bg-zinc-50/70">
                  <td className="px-5 py-2 text-zinc-500">{r.bizMajor}</td>
                  <td className="px-3 py-2 font-medium text-zinc-800">{r.bizMinor}</td>
                  <td className="px-3 py-2 text-right"><Money value={r.income} unit={false} muted={!r.income} /></td>
                  <td className="px-3 py-2 text-right"><Money value={r.expense} unit={false} muted={!r.expense} /></td>
                  <td className="px-3 py-2 text-right"><Money value={r.refund} unit={false} muted={!r.refund} /></td>
                  <td className="px-5 py-2 text-right font-semibold"><Money value={r.net} unit={false} /></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-zinc-300 bg-zinc-50 font-semibold">
                <td className="px-5 py-2.5" colSpan={2}>총계</td>
                <td className="px-3 py-2.5 text-right"><Money value={pl.total.income} unit={false} /></td>
                <td className="px-3 py-2.5 text-right"><Money value={pl.total.expense} unit={false} /></td>
                <td className="px-3 py-2.5 text-right"><Money value={pl.total.refund} unit={false} /></td>
                <td className="px-5 py-2.5 text-right"><Money value={pl.total.net} unit={false} /></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>

      {/* 지출 매트릭스 */}
      {matrix.rowKeys.length > 0 && (
        <Card className="mb-6 overflow-hidden p-0">
          <div className="px-5 pt-5">
            <SectionTitle hint="색이 진할수록 지출이 큼 · 환급 차감 반영">
              계정대분류 × 사업부 지출
            </SectionTitle>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-y border-zinc-200 bg-zinc-50 text-xs text-zinc-500">
                  <th className="sticky left-0 z-10 bg-zinc-50 px-5 py-2 text-left font-medium">
                    계정대분류
                  </th>
                  {matrix.colKeys.map((c) => (
                    <th key={c} className="whitespace-nowrap px-2.5 py-2 text-right font-medium">
                      {c}
                    </th>
                  ))}
                  <th className="px-5 py-2 text-right font-medium">합계</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {matrix.rowKeys.map((r) => (
                  <tr key={r}>
                    <td className="sticky left-0 z-10 bg-white px-5 py-1.5 font-medium text-zinc-800">
                      {r}
                    </td>
                    {matrix.colKeys.map((c) => {
                      const v = matrix.cells[r]?.[c] ?? 0;
                      return (
                        <td
                          key={c}
                          className="px-2.5 py-1.5 text-right tabular-nums"
                          style={{ backgroundColor: rampColor(v, maxCell) }}
                        >
                          <span className={v > 0 ? rampTextClass(v, maxCell) : "text-zinc-300"}>
                            {v > 0 ? Math.round(v).toLocaleString("ko-KR") : "—"}
                          </span>
                        </td>
                      );
                    })}
                    <td className="px-5 py-1.5 text-right font-semibold tabular-nums text-zinc-900">
                      {Math.round(matrix.rowTotals[r]).toLocaleString("ko-KR")}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-zinc-300 bg-zinc-50 text-sm font-semibold">
                  <td className="sticky left-0 z-10 bg-zinc-50 px-5 py-2">합계</td>
                  {matrix.colKeys.map((c) => (
                    <td key={c} className="px-2.5 py-2 text-right tabular-nums">
                      {Math.round(matrix.colTotals[c]).toLocaleString("ko-KR")}
                    </td>
                  ))}
                  <td className="px-5 py-2 text-right tabular-nums">
                    {Math.round(matrix.grandTotal).toLocaleString("ko-KR")}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* 법인별 */}
        <Card>
          <SectionTitle hint="법인 단위">사업장별 손익</SectionTitle>
          <ul className="divide-y divide-zinc-100">
            {sites.map((s) => (
              <li key={s.site} className="flex items-center justify-between py-2">
                <span className="font-medium text-zinc-800">{s.site}</span>
                <span className="flex items-center gap-4 text-sm">
                  <span className="text-zinc-400">
                    수입 <Money value={s.t.income} unit={false} muted={!s.t.income} />
                  </span>
                  <span className="text-zinc-400">
                    지출 <Money value={s.t.expense} unit={false} muted={!s.t.expense} />
                  </span>
                  <span className="w-28 text-right font-semibold">
                    <Money value={s.t.net} unit={false} />
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </Card>

        {/* 상위 거래처 */}
        <Card>
          <SectionTitle hint="지출 기준 상위 10">거래처</SectionTitle>
          <ul className="divide-y divide-zinc-100">
            {vendors.map((v) => (
              <li key={v.vendor} className="flex items-center justify-between py-2 text-sm">
                <span className="min-w-0 truncate text-zinc-800">{v.vendor}</span>
                <span className="ml-3 flex shrink-0 items-center gap-3">
                  <span className="text-xs text-zinc-400">{v.count}건</span>
                  <span className="w-28 text-right font-medium">
                    <Money value={v.amount} unit={false} />
                  </span>
                </span>
              </li>
            ))}
            {vendors.length === 0 && (
              <li className="py-6 text-center text-sm text-zinc-400">지출 거래가 없습니다.</li>
            )}
          </ul>
        </Card>
      </div>

      {/* 구독 서비스 */}
      {subs.length > 0 && (
        <Card className="mt-4">
          <SectionTitle hint="거래처 키워드 규칙 기준 · 규칙에 없는 구독은 잡히지 않습니다">
            구독 서비스 지출
          </SectionTitle>
          <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
            {subs.map((s) => (
              <div
                key={s.keyword}
                className="flex items-center justify-between border-b border-zinc-100 py-2 text-sm"
              >
                <span className="min-w-0 truncate text-zinc-800">{s.service}</span>
                <span className="ml-3 flex shrink-0 items-center gap-3">
                  <span className="text-xs text-zinc-400">{s.count}건</span>
                  <Money value={s.amount} unit={false} />
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
