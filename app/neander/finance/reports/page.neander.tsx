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
//
//  화면 구성은 승인 목업(all-pages/finance-reports-detail.png)을 따른다:
//  제목 줄 → 리포트 탭 → 조회 조건 줄 → 핵심 지표 → 표 → 계산식 안내(접힘).
//  조회 조건(사업장·기준·0원 계정)은 제목 줄 오른쪽이 아니라 표 바로 위
//  FilterBar 에 둔다 — 「지금 무엇으로 걸러 보고 있는지」가 표 옆에 붙어
//  있어야 읽힌다. 제목 줄 오른쪽은 검토 대기처럼 상태와 주요 동작 자리다.
// ============================================================

import {
  useMemo,
  useState,
} from "react";
import {
  BarChart3,
  Calculator,
} from "lucide-react";
import {
  BasisLine,
  Card,
  Checkbox,
  Disclosure,
  EmptyState,
  FilterBar,
  FilterField,
  KpiStrip,
  LoadingState,
  Money,
  MonthStepper,
  PageHeader,
  PageShell,
  SectionHeader,
  SegmentedControl,
  Select,
  StatTile,
  TableNote,
} from "@/components/neander/ui";
import { ToolbarPortal } from "@/components/neander/shell/context";
import { useFinance } from "@/components/neander/finance/FinanceProvider";
import { ReportTabs } from "@/components/neander/finance/ReportTabs";
import {
  TreeTable,
  type TreeColumn,
} from "@/components/neander/finance/TreeTable";
import { availableMonths } from "@/lib/neander/finance/aggregate";
import { ledgerHref } from "@/lib/neander/finance/ledgerLink";
import {
  BASIS_HINT,
  BASIS_LABEL,
  buildReport,
  makeIsCard,
  type Basis,
} from "@/lib/neander/finance/report";
import {
  monthLabel,
} from "@/lib/neander/format";

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
      <PageShell>
        <PageHeader title="지출상세" description="계정 3단으로 본 수입·지출" />
        <ReportTabs className="mb-6" />
        <EmptyState
          icon={BarChart3}
          title="아직 거래가 없습니다"
          description="엑셀 임포트에서 장부를 올리면 여기에 계정별 상세가 나타납니다."
        />
      </PageShell>
    );
  }

  const t = report.total;
  const scopeQuery = { month: activeMonth || undefined, site: site === ALL ? undefined : site };

  return (
    <PageShell>
      <ToolbarPortal order={0}>
        <MonthStepper glass months={months} value={activeMonth} onChange={setMonth} />
      </ToolbarPortal>

      <PageHeader title="지출상세" description="계정 3단으로 본 수입·지출" className="mb-4" />

      <ReportTabs className="mb-4" />

      {/* 조회 조건 — 무엇으로 걸러 보고 있는지가 표 바로 위에 */}
      <FilterBar
        className="mb-3"
        actions={
          <Checkbox
            label="0원 계정도 보기"
            checked={showEmpty}
            onChange={(e) => setShowEmpty(e.target.checked)}
            className="text-nd-caption text-nd-fg-2"
          />
        }
      >
        <FilterField label="사업장" htmlFor="rep-site">
          <Select id="rep-site" size="sm" className="w-auto min-w-[9rem]" value={site} onChange={(e) => setSite(e.target.value)}>
            <option value={ALL}>전체 사업장</option>
            {sites.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </Select>
        </FilterField>
        <FilterField label="기준" as="div">
          <SegmentedControl<Basis>
            size="sm"
            ariaLabel="집계 기준"
            value={basis}
            onChange={setBasis}
            options={(["accrual", "cash"] as Basis[]).map((b) => ({ value: b, label: BASIS_LABEL[b] }))}
          />
        </FilterField>
      </FilterBar>

      {/* 지금 무엇을 세고 있는지 한 줄 — 긴 설명은 아래 「계산식 안내」로 */}
      <BasisLine
        className="mb-4"
        items={[
          <>
            <b className="font-medium text-nd-fg-2">{BASIS_LABEL[basis]}</b> · {BASIS_HINT[basis]}
          </>,
          <>
            {monthLabel(activeMonth)} {report.scopedCount.toLocaleString("ko-KR")}건 중{" "}
            {report.usedCount.toLocaleString("ko-KR")}건 집계
          </>,
          `자금거래${basis === "accrual" ? "·카드대금결제" : "·카드사용분"} 제외`,
        ]}
      />

      <KpiStrip columns={5} className="mb-4">
        <StatTile label="수입금액" value={t.income} hint={`${t.count.toLocaleString("ko-KR")}건 기준`} />
        <StatTile label="지출금액" value={t.expense} hint={BASIS_LABEL[basis]} />
        <StatTile label="지출(순수)" value={t.expensePure} hint="개인사용·환급 차감" />
        <StatTile label="차이" value={t.diff} hint={`개인 ${t.personal.toLocaleString("ko-KR")} · 환급 ${t.refund.toLocaleString("ko-KR")}`} />
        <StatTile label="순금액" value={t.net} hint="수입 − 순수지출" />
      </KpiStrip>

      <Card padding="none" className="mb-3 overflow-hidden">
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

      {/* 두 관점의 차이 — 판단에 필요하지만 매번 읽을 것은 아니다.
          개인사용분이 있는 달에는 접힌 채로도 금액이 보이게 meta 에 둔다. */}
      <Disclosure
        icon={Calculator}
        title="계산식 안내"
        description="순금액과 대시보드 순손익이 다른 이유"
        defaultOpen={false}
        meta={
          t.personal !== 0 ? (
            <span className="text-nd-warning-text">
              개인사용 <Money value={t.personal} unit={false} className="text-nd-warning-text" />원
            </span>
          ) : undefined
        }
      >
        <dl className="flex flex-col gap-2.5 text-nd-caption leading-relaxed">
          <div className="grid grid-cols-[minmax(6rem,auto)_1fr] gap-x-3">
            <dt className="font-medium text-nd-fg">지출(순수)</dt>
            <dd className="text-nd-fg-2">지출금액에서 개인사용분과 환급을 뺀 값입니다.</dd>
          </div>
          <div className="grid grid-cols-[minmax(6rem,auto)_1fr] gap-x-3">
            <dt className="font-medium text-nd-fg">순금액</dt>
            <dd className="text-nd-fg-2">수입금액 − 지출(순수). 엑셀 지출상세와 같은 계산입니다.</dd>
          </div>
          <div className="grid grid-cols-[minmax(6rem,auto)_1fr] gap-x-3">
            <dt className="font-medium text-nd-fg">대시보드 순손익</dt>
            <dd className="text-nd-fg-2">
              개인사용을 비용으로 둡니다. 그래서 이 표의 순금액보다 개인사용분만큼 낮습니다 — 둘 다 맞는
              관점이라 어느 쪽도 바꾸지 않았습니다.
            </dd>
          </div>
          <div className="grid grid-cols-[minmax(6rem,auto)_1fr] gap-x-3">
            <dt className="font-medium text-nd-fg">발생 · 현금</dt>
            <dd className="text-nd-fg-2">
              발생주의는 카드 사용 시점, 현금흐름은 카드대금이 빠져나간 시점으로 봅니다. 어느 쪽이든
              자금거래(계좌 간 이동)는 빠집니다.
            </dd>
          </div>
        </dl>
      </Disclosure>
    </PageShell>
  );
}
