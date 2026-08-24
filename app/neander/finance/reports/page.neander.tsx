"use client";

// ============================================================
//  리포트 › 지출상세 — 엑셀 「지출상세(현금흐름)·(발생주의)」 두 시트
// ------------------------------------------------------------
//  엑셀은 기준이 다른 두 시트를 따로 뒀지만, 데이터는 하나고 보는 기준만
//  다르다. 그래서 시트 두 개가 아니라 **토글 하나**로 만든다
//  (QuickBooks·Xero 의 Cash/Accrual 토글과 같은 방식).
//
//  검증 기준 2026-07:
//    수입 41,656,602 / 발생주의 지출 58,896,728 / 현금흐름 지출 56,989,399
//    개인사용 12,800 / 환급 143,700
// ============================================================

import { useMemo, useState } from "react";
import { Card, EmptyState } from "@/components/neander/ui";
import { useFinance } from "@/components/neander/finance/FinanceProvider";
import { ReportTabs } from "@/components/neander/finance/ReportTabs";
import { TreeTable, type TreeColumn } from "@/components/neander/finance/TreeTable";
import { Money, StatTile, SectionTitle } from "@/components/neander/finance/ui";
import { availableMonths } from "@/lib/neander/finance/aggregate";
import { ledgerHref } from "@/lib/neander/finance/ledgerLink";
import {
  BASIS_HINT,
  BASIS_LABEL,
  buildReport,
  makeIsCard,
  type Basis,
} from "@/lib/neander/finance/report";

const ALL = "__all__";

const COLUMNS: TreeColumn[] = [
  { key: "income", label: "수입금액", value: (v) => v.income },
  { key: "expense", label: "지출금액", value: (v) => v.expense },
  { key: "expensePure", label: "지출(순수)", hint: "개인·환급 차감", value: (v) => v.expensePure },
  { key: "diff", label: "차이", hint: "개인·환급", value: (v) => v.diff },
  { key: "net", label: "순금액", value: (v) => v.net },
  { key: "count", label: "건수", value: (v) => v.count },
];

export default function ExpenseDetailReport() {
  const { transactions, accounts, paymentMethods, loading } = useFinance();

  const months = useMemo(() => availableMonths(transactions), [transactions]);
  const [month, setMonth] = useState<string>("");
  const [basis, setBasis] = useState<Basis>("accrual");
  const [site, setSite] = useState(ALL);
  const [showEmpty, setShowEmpty] = useState(false);

  const activeMonth = month || months[0] || "";
  const sites = useMemo(
    () => [...new Set(transactions.map((t) => t.site).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b, "ko")),
    [transactions],
  );

  const isCard = useMemo(() => makeIsCard(paymentMethods), [paymentMethods]);
  const scope = useMemo(
    () => ({ month: activeMonth || undefined, site: site === ALL ? undefined : site }),
    [activeMonth, site],
  );
  const report = useMemo(
    () => buildReport(transactions, { basis, isCard, scope, accounts }),
    [transactions, basis, isCard, scope, accounts],
  );

  if (loading) {
    return <div className="px-5 py-16 text-center text-zinc-400">불러오는 중…</div>;
  }
  if (transactions.length === 0) {
    return (
      <div className="mx-auto w-full max-w-7xl px-5 py-8">
        <ReportTabs />
        <div className="mt-6">
          <EmptyState icon="📊" title="아직 거래가 없습니다" description="임포트 탭에서 장부를 올리면 여기에 계정별 상세가 나타납니다." />
        </div>
      </div>
    );
  }

  const t = report.total;
  const scopeQuery = { month: activeMonth || undefined, site: site === ALL ? undefined : site };

  return (
    <div className="mx-auto w-full max-w-7xl px-5 py-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <ReportTabs />
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={activeMonth}
            onChange={(e) => setMonth(e.target.value)}
            className="h-8 cursor-pointer rounded-md border border-zinc-300 bg-white pl-2 pr-6 text-xs text-zinc-800 outline-none focus:border-indigo-500"
          >
            {months.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
          <select
            value={site}
            onChange={(e) => setSite(e.target.value)}
            className="h-8 cursor-pointer rounded-md border border-zinc-300 bg-white pl-2 pr-6 text-xs text-zinc-800 outline-none focus:border-indigo-500"
          >
            <option value={ALL}>전체 사업장</option>
            {sites.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>

          {/* 기준 토글 — 엑셀의 두 시트를 대신한다 */}
          <div className="flex items-center rounded-md border border-zinc-300 p-0.5" role="group" aria-label="집계 기준">
            {(["accrual", "cash"] as Basis[]).map((b) => (
              <button
                key={b}
                type="button"
                onClick={() => setBasis(b)}
                aria-pressed={basis === b}
                className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                  basis === b ? "bg-indigo-600 text-white" : "text-zinc-600 hover:bg-zinc-100"
                }`}
              >
                {BASIS_LABEL[b]}
              </button>
            ))}
          </div>

          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-zinc-600">
            <input
              type="checkbox"
              checked={showEmpty}
              onChange={(e) => setShowEmpty(e.target.checked)}
              className="accent-indigo-600"
            />
            0원 계정도 보기
          </label>
        </div>
      </div>

      <p className="mb-4 text-xs text-zinc-500">
        <b className="font-medium text-zinc-700">{BASIS_LABEL[basis]}</b> · {BASIS_HINT[basis]}
        <span className="ml-2 text-zinc-400">
          {activeMonth} 거래 {report.scopedCount.toLocaleString("ko-KR")}건 중 {report.usedCount.toLocaleString("ko-KR")}건 집계
          (자금거래{basis === "accrual" ? "·카드대금결제" : "·카드사용분"} 제외)
        </span>
      </p>

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatTile label="수입금액" value={t.income} hint={`${t.count.toLocaleString("ko-KR")}건 기준`} />
        <StatTile label="지출금액" value={t.expense} hint={BASIS_LABEL[basis]} />
        <StatTile label="지출(순수)" value={t.expensePure} hint="개인사용·환급 차감" />
        <StatTile label="차이" value={t.diff} hint={`개인 ${t.personal.toLocaleString("ko-KR")} · 환급 ${t.refund.toLocaleString("ko-KR")}`} />
        <StatTile label="순금액" value={t.net} hint="수입 − 순수지출" />
      </div>

      {t.personal !== 0 && (
        <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          이 표의 <b>순금액</b>은 개인사용분 <Money value={t.personal} unit={false} />원을 지출에서 뺀 값입니다(엑셀 지출상세와 같은 계산).
          대시보드의 <b>순손익</b>은 개인사용을 비용으로 두므로 그만큼 낮게 나옵니다 — 둘 다 맞는 관점이라 어느 쪽도 바꾸지 않았습니다.
        </p>
      )}

      <Card className="overflow-hidden p-0">
        <div className="border-b border-zinc-200 px-4 py-3">
          <SectionTitle hint="통합_MAP 순서 · 숫자를 누르면 원장이 그 조건으로 열립니다">
            계정별 수입·지출
          </SectionTitle>
        </div>
        <TreeTable
          roots={report.roots}
          total={report.total}
          columns={COLUMNS}
          showEmpty={showEmpty}
          hrefFor={(node) =>
            ledgerHref({
              ...scopeQuery,
              acctMajor: node.major,
              acctMid: node.level >= 1 ? node.mid : undefined,
              acctMinor: node.level >= 2 ? node.minor : undefined,
            })
          }
          emptyMessage={
            showEmpty ? "계정 마스터가 비어 있습니다." : "이 조건에 잡힌 거래가 없습니다. 「0원 계정도 보기」를 켜면 전체 계정이 나옵니다."
          }
        />
      </Card>
    </div>
  );
}
