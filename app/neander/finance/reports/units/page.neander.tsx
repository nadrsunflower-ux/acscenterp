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
//
//  화면 구성은 형제 화면(지출상세)과 같은 순서다:
//  제목 줄 → 리포트 탭 → 조회 조건 줄 → 집계 기준 → 경고 → 핵심 지표 →
//  표 → 배분 기준(접힘). 기준·배분 토글은 제목 줄 오른쪽이 아니라 표 위
//  FilterBar 에 둔다 — 「무엇으로 걸러 보고 있는지」는 표 옆에 있어야
//  읽히고, 컨트롤을 알림 배너 안에 숨기면 아무도 못 찾는다.
// ============================================================

import {
  useMemo,
  useState,
} from "react";
import Link from "next/link";
import {
  Building2,
  Info,
  Scale,
  TriangleAlert,
} from "lucide-react";
import {
  BasisLine,
  Card,
  Checkbox,
  Disclosure,
  EmptyState,
  FilterBar,
  FilterField,
  InlineNotice,
  KpiStrip,
  LoadingState,
  Money,
  MonthStepper,
  PageHeader,
  PageShell,
  SectionHeader,
  SegmentedControl,
  StatTile,
  Table,
  TableNote,
  Td,
  Th,
  TotalRow,
  Tr,
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
  allocate,
  unitTotals,
} from "@/lib/neander/finance/allocation";
import {
  BASIS_HINT,
  BASIS_LABEL,
  buildReport,
  makeIsCard,
  summarize,
  type Basis,
} from "@/lib/neander/finance/report";
import {
  monthLabel,
} from "@/lib/neander/format";

const ALL_UNITS = "__all__";

const COLUMNS: TreeColumn[] = [
  { key: "income", label: "수입금액", value: (v) => v.income },
  { key: "expense", label: "지출금액", value: (v) => v.expense },
  { key: "refund", label: "환급", value: (v) => v.refund },
  { key: "net", label: "순손익", value: (v) => v.net },
  { key: "count", label: "건수", value: (v) => v.count },
];

/** 배분 규칙의 드라이버를 사람 말로 — 「무엇에 비례해 나눴나」가 판단의 전부다 */
const DRIVER_LABEL: Record<string, string> = {
  revenue: "매출비율",
  expense: "지출비율",
  fixed: "고정비율",
};

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
      <PageShell>
        <PageHeader title="사업부" description="B2C · B2B · 공용 손익" />
        <ReportTabs className="mb-6" />
        <EmptyState
          icon={Building2}
          title="아직 거래가 없습니다"
          description="임포트 탭에서 장부를 올리면 사업부별 손익이 나타납니다."
        />
      </PageShell>
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

  const movedTotal = alloc.lines.reduce((s, l) => s + l.amount, 0);
  const selectedLabel = selected ? `${selected.bizMajor} · ${selected.bizMinor}` : "전체 사업부";
  const selectedDelta = selected ? alloc.delta[selected.key] ?? 0 : 0;
  /** 전체 줄과 사업부 줄을 한 번에 그린다 — 두 벌로 나누면 생김새가 갈라진다 */
  const rows = [
    { key: ALL_UNITS, name: "전체", major: "", net: grand.net, before: grand.net },
    ...units.map((u) => ({
      key: u.key,
      name: u.bizMinor,
      major: u.bizMajor,
      net: netOf(u.key, u.net),
      before: u.net,
    })),
  ];

  return (
    <PageShell>
      <ToolbarPortal order={0}>
        <MonthStepper glass months={months} value={activeMonth} onChange={setMonth} />
      </ToolbarPortal>

      <PageHeader title="사업부" description="B2C · B2B · 공용 손익" className="mb-4" />

      <ReportTabs className="mb-4" />

      {/* 조회 조건 — 사업부는 왼쪽 목록에서 고르므로 여기엔 사업장 Select 가 없다.
          없던 필터를 새로 만들면 집계 인자가 달라지므로 있는 것만 옮겼다. */}
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
        <FilterField label="기준" as="div">
          <SegmentedControl<Basis>
            size="sm"
            ariaLabel="집계 기준"
            value={basis}
            onChange={setBasis}
            options={(["accrual", "cash"] as Basis[]).map((b) => ({ value: b, label: BASIS_LABEL[b] }))}
          />
        </FilterField>
        {/* 배분 토글은 규칙이 실제로 걸린 달에만 — 아무것도 안 바뀌는 스위치는 두지 않는다 */}
        {alloc.applied > 0 && (
          <FilterField label="공통비 배분" as="div">
            <Checkbox
              label={showAlloc ? "적용 중" : "꺼짐"}
              checked={allocOn}
              onChange={(e) => setAllocOn(e.target.checked)}
              className="text-nd-caption text-nd-fg-2"
            />
          </FilterField>
        )}
      </FilterBar>

      {/* 지금 무엇을 세고 있는지 한 줄 — 배분 규칙의 상세는 아래 「배분 기준」으로 */}
      <BasisLine
        className="mb-4"
        items={[
          <>
            <b className="font-medium text-nd-fg-2">{BASIS_LABEL[basis]}</b> · {BASIS_HINT[basis]}
          </>,
          `${monthLabel(activeMonth)} · ${selectedLabel}`,
          showAlloc ? (
            <>
              배분 후 · 규칙 {alloc.applied}개로 <Money value={movedTotal} unit={false} />원 이동
            </>
          ) : (
            "배분 전 (공통비 미포함)"
          ),
        ]}
      />

      {/* 경고만 배너로 — 「이 숫자를 사실로 읽지 말라」는 경고라 접어 둘 수 없다 */}
      {showAlloc ? (
        <InlineNotice tone="warning" icon={Info} className="mb-4 text-nd-caption">
          지금 보는 사업부 손익은 <b>배분 후</b> 숫자입니다. 배분은 사실이 아니라 경영 판단이라
          드라이버를 바꾸면 결과가 통째로 달라집니다 — 원본(배분 전) 숫자는 목록에 함께 남습니다.
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

      {/* 고른 사업부의 요약 — 형제 화면과 같은 KpiStrip 이라 숫자를 찾는 자리가 같다 */}
      <KpiStrip columns={4} className="mb-4">
        <StatTile
          label="수입금액"
          value={report.total.income}
          hint={`${report.total.count.toLocaleString("ko-KR")}건 기준`}
        />
        <StatTile label="지출금액" value={report.total.expense} hint={BASIS_LABEL[basis]} />
        <StatTile label="환급" value={report.total.refund} hint="지출에서 되돌아온 금액" />
        <StatTile
          label="순손익"
          value={report.total.net}
          hint={
            selected && showAlloc && selectedDelta !== 0 ? (
              <>
                배분 후 <Money value={report.total.net + selectedDelta} unit={false} />원
              </>
            ) : (
              selectedLabel
            )
          }
        />
      </KpiStrip>

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
          {/* 표로 두면 고른 줄 강조(Tr selected)와 합계 줄(TotalRow)을 공통 부품이 맡는다.
              줄 전체가 눌리되 이름 칸의 버튼이 키보드 초점을 받는다. */}
          <Table>
            <thead>
              <tr>
                <Th className="pl-4">사업부</Th>
                <Th align="right" className="pr-4">순손익</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const active = unitKey === r.key;
                const moved = r.net !== r.before;
                return (
                  <Tr
                    key={r.key}
                    selected={active}
                    onClick={() => setUnitKey(r.key)}
                    className="cursor-pointer"
                  >
                    <Td className="pl-4">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setUnitKey(r.key);
                        }}
                        aria-pressed={active}
                        className="block min-w-0 max-w-full truncate text-left"
                        title={r.major ? `${r.major} · ${r.name}` : r.name}
                      >
                        <span className={active ? "font-medium text-nd-accent-strong" : undefined}>{r.name}</span>
                        {r.major && (
                          <span className="ml-1.5 text-nd-caption font-normal text-nd-fg-3">{r.major}</span>
                        )}
                      </button>
                    </Td>
                    <Td num className="pr-4">
                      <Money value={r.net} unit={false} />
                      {moved && (
                        <span className="block text-nd-micro font-normal text-nd-fg-3">
                          배분 전 {r.before.toLocaleString("ko-KR")}
                        </span>
                      )}
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
            <tfoot>
              <TotalRow>
                <Td className="pl-4">합계</Td>
                <Td num className="pr-4">
                  <Money value={grand.net} unit={false} />
                </Td>
              </TotalRow>
            </tfoot>
          </Table>
        </Card>

        {/* ---- 오른쪽: 계정 트리 ---- */}
        <Card padding="none" className="overflow-hidden">
          <div className="px-5 pt-5">
            <SectionHeader
              title={`${selectedLabel} 수입·지출 상세`}
              hint="숫자를 누르면 원장이 그 조건으로 열립니다"
              action={<TableNote>단위: 원</TableNote>}
            />

            {/* ---- 배분 내역 — 어떤 규칙이 얼마를 옮겼는지 ---- */}
            {selected && showAlloc && myLines.length > 0 && (
              <InlineNotice tone="accent" icon={Scale} className="mb-4 text-nd-caption">
                <p className="mb-1 font-medium">공통비 배분 내역</p>
                <ul className="space-y-0.5">
                  {myLines.map((l, i) => {
                    const incoming = l.to === selected.key;
                    return (
                      <li key={`${l.rule}-${i}`} className="flex flex-wrap items-baseline gap-x-2">
                        <span className={incoming ? "text-nd-danger-text" : "text-nd-success-text"}>
                          {incoming ? "받음" : "내보냄"}
                        </span>
                        <span className="nd-num font-medium">
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
              </InlineNotice>
            )}
          </div>

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

      {/* 배분 규칙은 매번 읽을 것은 아니지만, 숫자가 왜 그렇게 나왔는지 물을 때
          바로 찾을 수 있어야 한다. 접힌 채로도 몇 개가 켜져 있는지는 보인다. */}
      <Disclosure
        className="mt-3"
        icon={Scale}
        title="배분 기준"
        description="공용·홍대공용 비용을 어떤 규칙으로 나누는가"
        defaultOpen={false}
        meta={`규칙 ${activeRules.length}/${allocations.length}개 켜짐`}
      >
        <p className="mb-3 text-nd-caption leading-relaxed text-nd-fg-2">
          공용·홍대공용에 쌓인 비용은 기본적으로 어느 사업부에도 실리지 않습니다. 규칙을 켜면 정해진
          드라이버(매출·지출·고정 비율)에 비례해 나눠 싣고, 원본 숫자는 그대로 남습니다 —{" "}
          <Link href="/neander/finance/master" className="font-medium underline">마스터 › 배분 규칙</Link>에서
          켜고 끕니다.
        </p>
        {allocations.length === 0 ? (
          <p className="text-nd-caption text-nd-fg-3">등록된 배분 규칙이 없습니다.</p>
        ) : (
          <ul className="flex flex-col gap-2 text-nd-caption">
            {allocations.map((r) => (
              <li key={r.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3">
                <span className="min-w-0">
                  <span className={r.active ? "font-medium text-nd-fg" : "text-nd-fg-3"}>{r.name}</span>
                  {r.note && <span className="block leading-relaxed text-nd-fg-3">{r.note}</span>}
                </span>
                <span className="shrink-0 text-nd-fg-2">
                  {DRIVER_LABEL[r.driver] ?? r.driver} · {r.active ? "켜짐" : "꺼짐"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Disclosure>
    </PageShell>
  );
}
