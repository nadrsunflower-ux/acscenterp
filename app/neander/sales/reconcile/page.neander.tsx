"use client";

// ============================================================
//  매출 › 장부 대사 — 매출을 두 번 잡지 않으면서 두 모듈을 잇는 자리
// ------------------------------------------------------------
//  ⚠️ 이 화면은 장부를 고치지 않는다. 매장 매출은 카드사 정산 입금으로,
//     네이버 예약은 Npay 정산으로 재무 장부에 이미 들어와 있다
//     (adapters/pos.ts · naver.ts 주석). POS 를 거래로 적재하면 매출이
//     두 배가 되므로, 이 모듈이 장부와 만나는 방법은 **대사뿐**이다.
//
//  대사의 값은 차이에서 나온다:
//    POS 합계 − 수수료 = 예상 입금액
//    예상 입금액 vs 장부 입금액 = 미정산 + 수수료 오차
//
//  장부 쪽 숫자는 재무 원장에 있다. 같은 조건이 걸린 링크를 옆에 둔다 —
//  두 화면을 번갈아 보는 것이 두 숫자를 한 표에 억지로 합치는 것보다 낫다.
// ============================================================

import {
  useMemo,
  useState,
} from "react";
import Link from "next/link";
import {
  Calculator,
  ExternalLink,
  Scale,
  TriangleAlert,
} from "lucide-react";
import {
  Badge,
  BasisLine,
  Button,
  Card,
  Disclosure,
  EmptyState,
  ErrorState,
  InfoPopover,
  InlineNotice,
  KpiStrip,
  LoadingState,
  Money,
  MonthStepper,
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
import { useSales } from "@/components/neander/sales/SalesProvider";
import {
  Rate,
  SalesDrill,
  StoreBadge,
} from "@/components/neander/sales/ui";
import {
  availableMonths,
  buildReconcile,
  inMonth,
  lineFee,
} from "@/lib/neander/sales/aggregate";
import { ledgerHref } from "@/lib/neander/finance/ledgerLink";
import { EXCEL_BASELINE } from "@/lib/neander/sales/master-data";
import {
  SALES_STORES,
  feeRateOf,
  routeLabel,
  type PayRoute,
  type SalesLine,
  type SalesStore,
} from "@/lib/neander/sales/types";
import { monthLabel } from "@/lib/neander/format";

/** 매장 → 장부의 사업소분류·계정소분류 (naver.ts · pos.ts 의 실측 기준) */
const LEDGER_UNIT: Record<SalesStore, { bizMinor: string; acctMinor: string }> = {
  wow: { bizMinor: "와우", acctMinor: "와우판매" },
  id: { bizMinor: "아이디", acctMinor: "아이디판매" },
  online: { bizMinor: "아이디", acctMinor: "온라인판매" },
};

const storeName = (s: SalesStore) => SALES_STORES.find((x) => x.value === s)?.label ?? s;

/** 표 칸의 금액 — 0원이 아니면 올리면 미리보기, 누르면 판매 줄 창 */
function Drill({
  value,
  flow,
  title,
  subtitle,
  lines,
  amountOf,
}: {
  value: number;
  flow: "income" | "expense";
  title: string;
  subtitle: string;
  lines: () => SalesLine[];
  amountOf?: (l: SalesLine) => number;
}) {
  const money = <Money value={value} unit={false} flow={flow} />;
  if (value === 0) return money;
  return (
    <SalesDrill title={title} subtitle={subtitle} lines={lines} amountOf={amountOf} flow={flow}>
      {money}
    </SalesDrill>
  );
}

export default function SalesReconcilePage() {
  const { lines, events, assumptions, loading, error } = useSales();
  const months = useMemo(() => availableMonths(lines, events), [lines, events]);
  const [month, setMonth] = useState<string>("");
  const activeMonth = month || months[0] || "";

  const rows = useMemo(
    () => buildReconcile(activeMonth, lines, assumptions),
    [activeMonth, lines, assumptions],
  );

  /** 경로별 합계 — 수수료율이 경로에서 나오므로 근거를 같이 보여준다 */
  const byRoute = useMemo(() => {
    const acc = new Map<PayRoute, { amount: number; fee: number; count: number }>();
    lines
      .filter((l) => inMonth(l.date, activeMonth))
      .forEach((l) => {
        const cur = acc.get(l.route) ?? { amount: 0, fee: 0, count: 0 };
        cur.amount += l.amount;
        cur.fee += Math.round(l.amount * feeRateOf(l.route, assumptions.fee));
        cur.count += 1;
        acc.set(l.route, cur);
      });
    return [...acc.entries()].map(([route, v]) => ({ route, ...v }));
  }, [lines, activeMonth, assumptions]);

  // ---- 드릴 — 창 합계가 칸과 원 단위로 같도록 buildReconcile·byRoute 와 같은 거름 ----
  const recStores = new Set(rows.map((r) => r.store));
  /** 매장 하나(없으면 대사 대상 매장 전부)의 이 달 줄 */
  const storeLines = (store?: SalesStore) => () =>
    lines.filter(
      (l) => inMonth(l.date, activeMonth) && (store ? l.store === store : recStores.has(l.store)),
    );
  const routeLines = (route: PayRoute) => () =>
    lines.filter((l) => inMonth(l.date, activeMonth) && l.route === route);
  const feeOf = (l: SalesLine) => lineFee(l, assumptions);
  const depositOf = (l: SalesLine) => l.amount - lineFee(l, assumptions);
  /** 결제 경로별 표의 수수료 — 표가 쓰는 식(경로 요율만) 그대로 */
  const routeFeeOf = (l: SalesLine) => Math.round(l.amount * feeRateOf(l.route, assumptions.fee));
  const sub = monthLabel(activeMonth);

  if (loading) return <LoadingState label="매출을 불러오는 중…" />;

  const total = rows.reduce(
    (a, r) => ({
      posTotal: a.posTotal + r.posTotal,
      fee: a.fee + r.fee,
      expectedDeposit: a.expectedDeposit + r.expectedDeposit,
    }),
    { posTotal: 0, fee: 0, expectedDeposit: 0 },
  );

  // 엑셀과 같은 달이면 원본 합계를 나란히 둘 수 있다
  const isBaselineMonth = activeMonth === EXCEL_BASELINE.month;

  // 불러오지 못한 것과 아직 없는 것은 다르다 — 예전에는 둘 다 「적재된 판매가 없다」로 보였다
  if (error) {
    return (
      <PageShell width="form">
        <PageHeader title="장부 대사" description="POS 합계와 장부 입금액을 맞춰 봅니다." />
        <ErrorState
          title="매출을 불러올 수 없습니다"
          description={error instanceof Error ? error.message : "알 수 없는 오류"}
        />
      </PageShell>
    );
  }

  if (rows.every((r) => r.posTotal === 0)) {
    return (
      <PageShell width="form">
        <PageHeader title="장부 대사" description="POS 합계와 장부 입금액을 맞춰 봅니다." />
        <EmptyState
          icon={Scale}
          title={`${monthLabel(activeMonth) || "이 달"} 적재된 판매가 없습니다`}
          description={
            <>
              먼저{" "}
              <Link
                href="/neander/sales/import"
                className="font-medium text-nd-accent-strong hover:underline"
              >
                매출 적재
              </Link>
              에서 페이히어·네이버 원본을 올리세요.
            </>
          }
        />
      </PageShell>
    );
  }

  return (
    <PageShell>
      <ToolbarPortal order={0}>
        <MonthStepper glass months={months} value={activeMonth} onChange={setMonth} />
      </ToolbarPortal>

      <PageHeader
        title="장부 대사"
        description="POS·예약 합계에서 수수료를 빼면 통장에 들어올 금액이 됩니다."
        className="mb-3"
        actions={
          <Link
            href={ledgerHref({ month: activeMonth, txTypes: ["수입"] })}
          >
            <Button variant="secondary" icon={ExternalLink}>
              원장 열기
            </Button>
          </Link>
        }
      />

      <BasisLine
        className="mb-4"
        items={["판매 실적 기준", `${monthLabel(activeMonth)} 판매일 기준`, "장부는 고치지 않습니다"]}
      >
        <InfoPopover
          label="계산 기준"
          title="장부 대사 계산 기준"
          terms={[
            { term: "POS 합계", desc: "적재된 판매 줄의 금액 합입니다. 미확정 줄도 금액은 들어갑니다." },
            { term: "수수료", desc: "결제 경로별 요율을 각 줄에 적용해 더한 값입니다. 아래 「결제 경로별」 표에서 어느 율이 걸렸는지 볼 수 있습니다." },
            { term: "예상 입금액", desc: "POS 합계 − 수수료. 장부의 정산 입금과 맞춰 볼 금액입니다." },
            { term: "장부 입금액", desc: "여기서 보여주지 않습니다. 원장 링크로 넘어가 같은 조건으로 확인하세요 — 두 숫자를 한 표에 억지로 합치면 어느 쪽이 정본인지 흐려집니다." },
            { term: "시차", desc: "정산 입금은 며칠 뒤에 들어옵니다. 한 달만 떼어 보면 안 맞는 것이 정상이고, 차이가 계속 남으면 미정산입니다." },
          ]}
        />
      </BasisLine>

      {/* 이 화면의 존재 이유이자 가장 큰 오해 — 접지 않는다 */}
      <InlineNotice tone="warning" icon={TriangleAlert} className="mb-4">
        이 화면은 <b>장부를 고치지 않습니다.</b> 매장 매출은 카드사 정산 입금으로 이미 장부에 잡혀
        있어서, POS 를 거래로 적재하면 매출이 두 번 계상됩니다. 여기서 하는 일은 두 숫자를 맞춰
        보는 것뿐입니다.
      </InlineNotice>

      <KpiStrip columns={3} className="mb-5">
        <StatTile
          label={`${monthLabel(activeMonth)} POS 합계`}
          value={total.posTotal}
          flow="income"
          hint="적재된 판매 줄의 합"
          wrapValue={(money) => (
            <SalesDrill title="POS 합계" subtitle={sub} lines={storeLines()} flow="income">
              {money}
            </SalesDrill>
          )}
        />
        <StatTile
          label="결제 수수료"
          value={total.fee}
          flow="expense"
          hint={`실효 ${total.posTotal ? ((total.fee / total.posTotal) * 100).toFixed(2) : "0"}%`}
          wrapValue={(money) => (
            <SalesDrill title="결제 수수료" subtitle={sub} lines={storeLines()} amountOf={feeOf} flow="expense">
              {money}
            </SalesDrill>
          )}
        />
        <StatTile
          label="예상 입금액"
          value={total.expectedDeposit}
          flow="income"
          hint="장부의 정산 입금과 맞춰 볼 금액"
          wrapValue={(money) => (
            <SalesDrill title="예상 입금액" subtitle={`${sub} · 줄마다 금액 − 수수료`} lines={storeLines()} amountOf={depositOf} flow="income">
              {money}
            </SalesDrill>
          )}
        />
      </KpiStrip>

      <Card padding="none" className="mb-5 overflow-hidden">
        <div className="px-5 pt-4">
          <SectionHeader
            title="매장별 대사"
            hint="장부 쪽 숫자는 원장 링크에서 확인합니다"
          />
        </div>
        <TableScroll>
          <Table minWidth={900} dense>
            <thead>
              <tr>
                <Th sticky="top" className="pl-5">매장</Th>
                <Th sticky="top" align="right">POS 합계</Th>
                <Th sticky="top" align="right">수수료</Th>
                <Th sticky="top" align="right">예상 입금액</Th>
                {isBaselineMonth && <Th sticky="top" align="right">엑셀 원본 합계</Th>}
                {isBaselineMonth && <Th sticky="top" align="right">차이</Th>}
                <Th sticky="top" className="pr-5">장부</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const excel =
                  EXCEL_BASELINE.posSourceTotal[r.store as keyof typeof EXCEL_BASELINE.posSourceTotal] ??
                  0;
                // 네이버 예약은 아이디로 적재되므로 엑셀 비교 시 함께 더한다
                const excelTotal =
                  r.store === "id" ? excel + EXCEL_BASELINE.naverSourceTotal : excel;
                const gap = r.posTotal - excelTotal;
                const unit = LEDGER_UNIT[r.store];
                return (
                  <Tr key={r.store}>
                    <Td className="pl-5">
                      <StoreBadge store={r.store} size="sm" />
                    </Td>
                    <Td num>
                      <Drill value={r.posTotal} flow="income" title={`${storeName(r.store)} · POS 합계`} subtitle={sub} lines={storeLines(r.store)} />
                    </Td>
                    <Td num>
                      <Drill value={r.fee} flow="expense" title={`${storeName(r.store)} · 수수료`} subtitle={sub} lines={storeLines(r.store)} amountOf={feeOf} />
                    </Td>
                    <Td num className="font-semibold">
                      <Drill value={r.expectedDeposit} flow="income" title={`${storeName(r.store)} · 예상 입금액`} subtitle={`${sub} · 줄마다 금액 − 수수료`} lines={storeLines(r.store)} amountOf={depositOf} />
                    </Td>
                    {isBaselineMonth && (
                      <Td num muted><Money value={excelTotal} unit={false} muted /></Td>
                    )}
                    {isBaselineMonth && (
                      <Td num>
                        {gap === 0 ? (
                          <Badge tone="success" size="sm">일치</Badge>
                        ) : (
                          <Money value={gap} unit={false} />
                        )}
                      </Td>
                    )}
                    <Td className="pr-5">
                      <Link
                        href={ledgerHref({
                          month: activeMonth,
                          txTypes: ["수입"],
                          bizMinor: unit.bizMinor,
                          acctMinor: unit.acctMinor,
                        })}
                        className="inline-flex items-center gap-1 text-nd-caption font-medium text-nd-accent-strong hover:underline"
                      >
                        {unit.acctMinor} 원장
                        <ExternalLink size={12} aria-hidden />
                      </Link>
                    </Td>
                  </Tr>
                );
              })}
              <TotalRow>
                <Td className="pl-5 font-semibold">합계</Td>
                <Td num className="font-semibold">
                  <Drill value={total.posTotal} flow="income" title="POS 합계" subtitle={sub} lines={storeLines()} />
                </Td>
                <Td num>
                  <Drill value={total.fee} flow="expense" title="수수료" subtitle={sub} lines={storeLines()} amountOf={feeOf} />
                </Td>
                <Td num className="font-semibold">
                  <Drill value={total.expectedDeposit} flow="income" title="예상 입금액" subtitle={`${sub} · 줄마다 금액 − 수수료`} lines={storeLines()} amountOf={depositOf} />
                </Td>
                {isBaselineMonth && <Td />}
                {isBaselineMonth && <Td />}
                <Td className="pr-5" />
              </TotalRow>
            </tbody>
          </Table>
        </TableScroll>
        <TableNote className="px-5 py-2">
          장부의 <b>정산 입금</b>은 며칠 뒤에 들어옵니다. 월말 판매의 입금이 다음 달에 잡히므로,
          한 달만 떼어 보면 예상 입금액과 장부가 맞지 않는 게 정상입니다 — 그 차이가 계속 남으면
          미정산입니다.
        </TableNote>
      </Card>

      <Card padding="none" className="overflow-hidden">
        <div className="px-5 pt-4">
          <SectionHeader title="결제 경로별" hint="수수료율이 여기서 정해집니다" />
        </div>
        <TableScroll>
          <Table minWidth={640} dense>
            <thead>
              <tr>
                <Th sticky="top" className="pl-5">경로</Th>
                <Th sticky="top" align="right">건수</Th>
                <Th sticky="top" align="right">금액</Th>
                <Th sticky="top" align="right">적용 수수료율</Th>
                <Th sticky="top" align="right" className="pr-5">수수료</Th>
              </tr>
            </thead>
            <tbody>
              {byRoute.map((r) => (
                <Tr key={r.route}>
                  <Td className="pl-5 text-nd-fg">{routeLabel(r.route)}</Td>
                  <Td num>{r.count.toLocaleString("ko-KR")}</Td>
                  <Td num>
                    <Drill value={r.amount} flow="income" title={`${routeLabel(r.route)} · 금액`} subtitle={sub} lines={routeLines(r.route)} />
                  </Td>
                  <Td num>
                    <Rate value={feeRateOf(r.route, assumptions.fee)} digits={1} />
                    {r.route === "naver" && (
                      <span className="ml-1 text-nd-micro text-nd-fg-3">
                        예약 {(assumptions.fee.naverBooking * 100).toFixed(1)} + 카드{" "}
                        {(assumptions.fee.card * 100).toFixed(1)}
                      </span>
                    )}
                  </Td>
                  <Td num className="pr-5">
                    <Drill value={r.fee} flow="expense" title={`${routeLabel(r.route)} · 수수료`} subtitle={sub} lines={routeLines(r.route)} amountOf={routeFeeOf} />
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </TableScroll>
        <TableNote className="px-5 py-2">
          경로마다 요율 하나만 겁니다.{" "}
          <Link
            href="/neander/sales/master"
            className="font-medium text-nd-accent-strong hover:underline"
          >
            마스터에서 율 고치기
          </Link>
        </TableNote>
      </Card>

      {/* 수수료율을 왜 이렇게 잡았는지는 숫자를 의심할 때 필요하다 — 매번 읽을 것은 아니다 */}
      <Disclosure
        className="mt-5"
        icon={Calculator}
        title="계산 기준"
        description="수수료율 근거와 엑셀과의 차이"
      >
        <div className="flex flex-col gap-3 text-nd-caption leading-relaxed text-nd-fg-2">
          <p>
            엑셀은 네이버 건에 「예약 1.8% + 카드 2.2% = 4.0%」를 매겼지만, 네이버 공식 안내는 Npay
            수수료 표 밑에 「따로 부과되는 카드사 수수료는 없습니다」라고 밝히고 있습니다. 카드 몫이
            Npay 수수료에 이미 들어 있어, 더하면 이중 계상입니다. 여기서는 경로마다 하나씩만
            겁니다 — 네이버예약 Npay{" "}
            {(assumptions.fee.naverBooking * 100).toFixed(1)}% · 현장·온라인 카드{" "}
            {(assumptions.fee.card * 100).toFixed(1)}% (부가세 별도).
          </p>
          {isBaselineMonth && (
            <p>
              {monthLabel(activeMonth)}은 엑셀 검증 기준월입니다. 와우 원본 합계{" "}
              {EXCEL_BASELINE.posSourceTotal.wow.toLocaleString("ko-KR")}원은 엑셀의 이벤트 합계
              8,658,000원보다 30,000원 많습니다 — 이벤트 기간 밖 판매가 엑셀 분석에서 빠져
              있었습니다. 이 모듈은 그 줄을 상시로 잡으므로 사라지지 않습니다.
            </p>
          )}
        </div>
      </Disclosure>
    </PageShell>
  );
}
