"use client";

// ============================================================
//  리포트 › 사업부 — 엑셀 「B2C」·「B2B」·「공용」 세 시트
// ------------------------------------------------------------
//  엑셀은 사업대분류마다 시트를 나누고 그 안에서 사업소분류를 섹션으로
//  쌓았다(B2C 시트만 1,462행). 여기서는 왼쪽에서 사업부를 고르고
//  오른쪽에 그 사업부의 계정 트리를 편다.
//
//  엑셀의 「비고」 열은 사람이 손으로 쓴 설명이었다. 그건 3단계의 월 마감
//  메모로 받기로 하고, 여기서는 거래에서 뽑은 자동 요약(상위 거래처·건수)
//  을 같은 자리에 둔다.
//
//  공용·홍대공용 비용은 기본적으로 어느 사업부에도 배분되지 않는다. 그래서
//  와우·아이디의 흑자는 "공통비 빼기 전" 숫자다. 마스터 › 배분 규칙에서
//  규칙을 켜면 **배분 후** 손익을 함께 볼 수 있다.
//
//  ⚠️ 배분은 사실이 아니라 경영 판단이라, 배분 전 숫자를 지우지 않는다.
//     항상 전/후를 나란히 두고 어떤 규칙이 얼마를 옮겼는지 밝힌다.
// ============================================================

import { useMemo, useState } from "react";
import Link from "next/link";
import { Building2, Info, TriangleAlert } from "lucide-react";
import {
  Card,
  Checkbox,
  EmptyState,
  InlineNotice,
  LoadingState,
  PageHeader,
  SectionHeader,
  SegmentedControl,
  TableNote,
  cn,
} from "@/components/neander/ui";
import { ToolbarPortal } from "@/components/neander/shell/context";
import { useFinance } from "@/components/neander/finance/FinanceProvider";
import { MonthStepper, ReportTabs } from "@/components/neander/finance/ReportTabs";
import { TreeTable, type TreeColumn } from "@/components/neander/finance/TreeTable";
import { Money, monthLabel } from "@/components/neander/finance/ui";
import { availableMonths } from "@/lib/neander/finance/aggregate";
import { ledgerHref } from "@/lib/neander/finance/ledgerLink";
import { allocate, unitTotals } from "@/lib/neander/finance/allocation";
import {
  BASIS_HINT,
  BASIS_LABEL,
  buildReport,
  makeIsCard,
  summarize,
  type Basis,
} from "@/lib/neander/finance/report";

const ALL_UNITS = "__all__";

const COLUMNS: TreeColumn[] = [
  { key: "income", label: "수입금액", value: (v) => v.income },
  { key: "expense", label: "지출금액", value: (v) => v.expense },
  { key: "refund", label: "환급", value: (v) => v.refund },
  { key: "net", label: "순손익", value: (v) => v.net },
  { key: "count", label: "건수", value: (v) => v.count },
];

export default function UnitReport() {
  const { transactions, accounts, paymentMethods, allocations, loading } = useFinance();

  const months = useMemo(() => availableMonths(transactions), [transactions]);
  const [month, setMonth] = useState<string>("");
  const [basis, setBasis] = useState<Basis>("accrual");
  const [unitKey, setUnitKey] = useState<string>(ALL_UNITS);
  const [showEmpty, setShowEmpty] = useState(false);
  const [allocOn, setAllocOn] = useState(true);

  const activeMonth = month || months[0] || "";
  const isCard = useMemo(() => makeIsCard(paymentMethods), [paymentMethods]);

  /** 사업부별 합계 — 거래를 한 번만 훑는다 */
  const UNIT_MAJOR_ORDER = ["B2C", "B2B", "공용", "해당없음"];
  const units = useMemo(() => {
    const list = unitTotals(transactions, { basis, isCard, month: activeMonth });
    return list.sort((a, b) => {
      const ia = UNIT_MAJOR_ORDER.indexOf(a.bizMajor);
      const ib = UNIT_MAJOR_ORDER.indexOf(b.bizMajor);
      if (ia !== ib) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
      return a.bizMinor.localeCompare(b.bizMinor, "ko");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transactions, basis, isCard, activeMonth]);

  const activeRules = useMemo(() => allocations.filter((r) => r.active), [allocations]);
  const alloc = useMemo(
    () =>
      allocate({
        transactions,
        units,
        rules: allocations,
        basis,
        isCard,
        month: activeMonth,
      }),
    [transactions, units, allocations, basis, isCard, activeMonth],
  );
  /** 배분이 실제로 일어났고 사용자가 켜 두었을 때만 배분 후를 보여준다 */
  const showAlloc = allocOn && alloc.applied > 0;
  const netOf = (key: string, before: number) =>
    showAlloc ? before + (alloc.delta[key] ?? 0) : before;

  const selected = units.find((u) => u.key === unitKey);
  const scope = useMemo(
    () => ({
      month: activeMonth,
      bizMajor: selected?.bizMajor,
      bizMinor: selected?.bizMinor,
    }),
    [activeMonth, selected],
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
          icon={Building2}
          title="아직 거래가 없습니다"
          description="임포트 탭에서 장부를 올리면 사업부별 손익이 나타납니다."
        />
      </div>
    );
  }

  const grand = units.reduce(
    (s, u) => ({ income: s.income + u.income, cost: s.cost + u.cost, net: s.net + u.net }),
    { income: 0, cost: 0, net: 0 },
  );
  // 아직 배분되지 않고 공통 사업부에 남아 있는 비용
  const unallocated = units
    .filter((u) => u.bizMajor === "공용" || u.bizMinor === "홍대공용")
    .reduce((s, u) => s + netOf(u.key, u.net), 0);
  /** 선택한 사업부의 배분 내역 */
  const myLines = selected
    ? alloc.lines.filter((l) => l.to === selected.key || l.from === selected.key)
    : [];

  const unitBtn = (active: boolean) =>
    cn(
      "flex w-full items-center justify-between gap-2 px-4 py-2 text-left text-nd-body transition-colors duration-nd-fast",
      active ? "bg-nd-accent-soft font-medium text-nd-accent-strong" : "hover:bg-nd-sunken",
    );

  return (
    <div>
      <ToolbarPortal order={0}>
        <MonthStepper glass months={months} value={activeMonth} onChange={setMonth} />
      </ToolbarPortal>

      <PageHeader
        title="리포트"
        description="사업부 — B2C · B2B · 공용 손익"
        actions={
          <>
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

      {/* ---- 배분 상태 ---- */}
      {alloc.applied > 0 ? (
        <InlineNotice tone="accent" className="mb-4 text-nd-caption">
          <Checkbox
            checked={allocOn}
            onChange={(e) => setAllocOn(e.target.checked)}
            className="items-start text-nd-caption text-nd-accent-strong"
            label={
              <span>
                <b>공통비 배분 {showAlloc ? "적용 중" : "꺼짐"}</b> — 규칙 {alloc.applied}개 ·{" "}
                {alloc.lines.length}줄로 <Money value={alloc.lines.reduce((s, l) => s + l.amount, 0)} unit={false} />
                원이 옮겨집니다. 배분은 경영 판단이라 원본 숫자는 바뀌지 않습니다.
              </span>
            }
          />
        </InlineNotice>
      ) : (
        unallocated !== 0 && (
          <InlineNotice tone="warning" icon={Info} className="mb-4 text-nd-caption">
            공용·홍대공용의 <Money value={unallocated} unit={false} />원은 <b>아직 어느 사업부에도 배분되지 않았습니다.</b>{" "}
            와우·아이디 등의 순손익은 공통비를 빼기 전 숫자입니다 —{" "}
            <Link href="/neander/finance/master" className="font-medium underline">마스터 › 배분 규칙</Link>에서 규칙을 켜면 배분 후 손익을 볼 수 있습니다.
            {activeRules.length > 0 && " (켜진 규칙이 있지만 이 달에는 적용되지 않았습니다.)"}
          </InlineNotice>
        )
      )}
      {alloc.warnings.length > 0 && (
        <InlineNotice tone="warning" icon={TriangleAlert} className="mb-4 text-nd-caption">
          <ul className="space-y-1">
            {alloc.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </InlineNotice>
      )}

      <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)] [&>*]:min-w-0">
        {/* ---- 왼쪽: 사업부 목록 ---- */}
        <Card padding="none" className="h-fit overflow-hidden">
          <div className="px-4 pt-4">
            <SectionHeader
              as="h3"
              title="사업부"
              hint={`${monthLabel(activeMonth)} · ${BASIS_LABEL[basis]}${showAlloc ? " · 배분 후" : ""}`}
            />
          </div>
          <ul className="divide-y divide-nd-line border-t border-nd-line">
            <li>
              <button
                type="button"
                onClick={() => setUnitKey(ALL_UNITS)}
                aria-pressed={unitKey === ALL_UNITS}
                className={unitBtn(unitKey === ALL_UNITS)}
              >
                <span>전체</span>
                <span className="nd-num text-nd-caption">
                  <Money value={grand.net} unit={false} />
                </span>
              </button>
            </li>
            {units.map((u) => {
              const after = netOf(u.key, u.net);
              const moved = showAlloc && (alloc.delta[u.key] ?? 0) !== 0;
              const active = unitKey === u.key;
              return (
                <li key={u.key}>
                  <button
                    type="button"
                    onClick={() => setUnitKey(u.key)}
                    aria-pressed={active}
                    className={unitBtn(active)}
                  >
                    <span className="min-w-0 truncate" title={`${u.bizMajor} · ${u.bizMinor}`}>
                      {u.bizMinor}
                      <span className="ml-1.5 text-nd-caption font-normal text-nd-fg-3">{u.bizMajor}</span>
                    </span>
                    <span className="nd-num shrink-0 text-right text-nd-caption">
                      <Money value={after} unit={false} />
                      {moved && (
                        <span className="block text-nd-micro font-normal text-nd-fg-3">
                          배분 전 {u.net.toLocaleString("ko-KR")}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="flex items-center justify-between border-t border-nd-strong bg-nd-sunken px-4 py-2 text-nd-caption">
            <span className="font-medium text-nd-fg-2">합계</span>
            <span className="nd-num font-semibold">
              <Money value={grand.net} unit={false} />
            </span>
          </div>
        </Card>

        {/* ---- 오른쪽: 계정 트리 ---- */}
        <Card padding="none" className="overflow-hidden">
          <div className="px-5 pt-5">
            <SectionHeader
              title={`${selected ? `${selected.bizMajor} · ${selected.bizMinor}` : "전체 사업부"} 수입·지출 상세`}
              hint={BASIS_HINT[basis]}
              action={<TableNote>단위: 원</TableNote>}
              className="mb-1"
            />
            <div className="mb-4 flex flex-wrap gap-x-5 gap-y-1 text-nd-caption text-nd-fg-2">
              <span>수입 <Money value={report.total.income} unit={false} /></span>
              <span>지출 <Money value={report.total.expense} unit={false} /></span>
              <span>환급 <Money value={report.total.refund} unit={false} /></span>
              <span>순손익 <Money value={report.total.net} unit={false} className="font-semibold" /></span>
              {selected && showAlloc && (alloc.delta[selected.key] ?? 0) !== 0 && (
                <span className="text-nd-accent-strong">
                  배분 후{" "}
                  <Money
                    value={report.total.net + (alloc.delta[selected.key] ?? 0)}
                    unit={false}
                    className="font-semibold"
                  />
                </span>
              )}
              <span className="text-nd-fg-3">{report.total.count.toLocaleString("ko-KR")}건</span>
            </div>
          </div>

          {/* ---- 배분 내역 — 어떤 규칙이 얼마를 옮겼는지 ---- */}
          {selected && showAlloc && myLines.length > 0 && (
            <div className="border-t border-nd-line bg-nd-accent-soft/40 px-5 py-2.5">
              <p className="mb-1.5 text-nd-caption font-medium text-nd-accent-strong">공통비 배분 내역</p>
              <ul className="space-y-0.5 text-nd-caption text-nd-fg-2">
                {myLines.map((l, i) => {
                  const incoming = l.to === selected.key;
                  return (
                    <li key={`${l.rule}-${i}`} className="flex flex-wrap items-baseline gap-x-2">
                      <span className={incoming ? "text-nd-danger-text" : "text-nd-success-text"}>
                        {incoming ? "받음" : "내보냄"}
                      </span>
                      <span className="nd-num font-medium text-nd-fg">
                        {incoming ? "−" : "+"}
                        {l.amount.toLocaleString("ko-KR")}
                      </span>
                      <span>
                        {incoming ? `${l.from} 에서` : `${l.to} 로`} · {(l.share * 100).toFixed(1)}%
                      </span>
                      <span className="text-nd-fg-3">「{l.rule}」</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          <TreeTable
            roots={report.roots}
            total={report.total}
            columns={COLUMNS}
            showEmpty={showEmpty}
            summaryFor={summarize}
            hrefFor={(node) =>
              ledgerHref({
                month: activeMonth,
                bizMajor: selected?.bizMajor,
                bizMinor: selected?.bizMinor,
                acctMajor: node.major,
                acctMid: node.level >= 1 ? node.mid : undefined,
                acctMinor: node.level >= 2 ? node.minor : undefined,
              })
            }
            totalLabel={selected ? `${selected.bizMinor} 합계` : "전체 합계"}
            emptyMessage="이 사업부에 잡힌 거래가 없습니다."
          />
        </Card>
      </div>
    </div>
  );
}
