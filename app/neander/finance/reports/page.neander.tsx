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
import { BarChart3, Info } from "lucide-react";
import {
  Card,
  Checkbox,
  EmptyState,
  InlineNotice,
  KpiStrip,
  LoadingState,
  PageHeader,
  SectionHeader,
  SegmentedControl,
  Select,
  TableNote,
} from "@/components/neander/ui";
import { ToolbarPortal } from "@/components/neander/shell/context";
import { useFinance } from "@/components/neander/finance/FinanceProvider";
import { MonthStepper, ReportTabs } from "@/components/neander/finance/ReportTabs";
import { TreeTable, type TreeColumn } from "@/components/neander/finance/TreeTable";
import { Money, StatTile, monthLabel } from "@/components/neander/finance/ui";
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

  if (loading) return <LoadingState label="리포트를 만드는 중…" />;
  if (transactions.length === 0) {
    return (
      <div>
        <PageHeader title="리포트" description="지출상세 · 사업부 · 구독 · 예산" />
        <ReportTabs className="mb-6" />
        <EmptyState
          icon={BarChart3}
          title="아직 거래가 없습니다"
          description="임포트 탭에서 장부를 올리면 여기에 계정별 상세가 나타납니다."
        />
      </div>
    );
  }

  const t = report.total;
  const scopeQuery = { month: activeMonth || undefined, site: site === ALL ? undefined : site };

  return (
    <div>
      <ToolbarPortal order={0}>
        <MonthStepper glass months={months} value={activeMonth} onChange={setMonth} />
      </ToolbarPortal>

      <PageHeader
        title="리포트"
        description="지출상세 — 계정 3단으로 본 수입·지출"
        actions={
          <>
            <Select size="sm" value={site} onChange={(e) => setSite(e.target.value)} aria-label="사업장">
              <option value={ALL}>전체 사업장</option>
              {sites.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </Select>
            {/* 기준 토글 — 엑셀의 두 시트를 대신한다 */}
            <SegmentedControl<Basis>
              size="sm"
              ariaLabel="집계 기준"
              value={basis}
              onChange={setBasis}
              options={(["accrual", "cash"] as Basis[]).map((b) => ({ value: b, label: BASIS_LABEL[b] }))}
            />
            <Checkbox
              label="0원 계정도 보기"
              checked={showEmpty}
              onChange={(e) => setShowEmpty(e.target.checked)}
              className="text-nd-caption text-nd-fg-2"
            />
          </>
        }
      />

      <ReportTabs className="mb-5" />

      <p className="mb-4 text-nd-caption text-nd-fg-3">
        <b className="font-medium text-nd-fg-2">{BASIS_LABEL[basis]}</b> · {BASIS_HINT[basis]}
        <span className="ml-2">
          {monthLabel(activeMonth)} 거래 {report.scopedCount.toLocaleString("ko-KR")}건 중 {report.usedCount.toLocaleString("ko-KR")}건 집계
          (자금거래{basis === "accrual" ? "·카드대금결제" : "·카드사용분"} 제외)
        </span>
      </p>

      <KpiStrip columns={5} className="mb-5">
        <StatTile label="수입금액" value={t.income} hint={`${t.count.toLocaleString("ko-KR")}건 기준`} />
        <StatTile label="지출금액" value={t.expense} hint={BASIS_LABEL[basis]} />
        <StatTile label="지출(순수)" value={t.expensePure} hint="개인사용·환급 차감" />
        <StatTile label="차이" value={t.diff} hint={`개인 ${t.personal.toLocaleString("ko-KR")} · 환급 ${t.refund.toLocaleString("ko-KR")}`} />
        <StatTile label="순금액" value={t.net} hint="수입 − 순수지출" />
      </KpiStrip>

      {t.personal !== 0 && (
        <InlineNotice tone="warning" icon={Info} className="mb-4 text-nd-caption">
          이 표의 <b>순금액</b>은 개인사용분 <Money value={t.personal} unit={false} />원을 지출에서 뺀 값입니다(엑셀 지출상세와 같은 계산).
          대시보드의 <b>순손익</b>은 개인사용을 비용으로 두므로 그만큼 낮게 나옵니다 — 둘 다 맞는 관점이라 어느 쪽도 바꾸지 않았습니다.
        </InlineNotice>
      )}

      <Card padding="none" className="overflow-hidden">
        <div className="px-5 pt-5">
          <SectionHeader
            title="계정별 수입·지출"
            hint="통합_MAP 순서 · 숫자를 누르면 원장이 그 조건으로 열립니다"
            action={<TableNote>단위: 원</TableNote>}
          />
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
