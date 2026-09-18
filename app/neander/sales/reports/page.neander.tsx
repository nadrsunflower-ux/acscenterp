"use client";

// ============================================================
//  매출 › 리포트 — 한 달을 보고용으로 묶어 본다
// ------------------------------------------------------------
//  매장 대시보드는 "들여다보는" 화면이다(드릴·도움말·인건비 내역). 여기는
//  회의에 들고 갈 요약이다 — 핵심 지표 · 매장별 손익 · 비용 구조 · 상위 상품 ·
//  이벤트. 같은 숫자를 「슬라이드로 보기」로 16:9 발표 화면에 띄운다.
//
//  숫자는 lib/neander/sales/monthlyDeck.ts 한 곳에서 만든다 — 화면과
//  슬라이드가 같은 값을 보여야 한다. 그 안은 매장 대시보드와 같은 집계다.
// ============================================================

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Boxes, CalendarPlus, Presentation, TrendingUp } from "lucide-react";
import {
  BasisLine,
  Button,
  Card,
  EmptyState,
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
import { ProductCell, Rate, StoreBadge } from "@/components/neander/sales/ui";
import { TermLabel } from "@/components/neander/sales/TermHint";
import { EventDrill } from "@/components/neander/sales/DeckDrills";
import { InsightPanel } from "@/components/neander/insights/InsightPanel";
import { availableMonths } from "@/lib/neander/sales/aggregate";
import { buildSalesDeck } from "@/lib/neander/sales/monthlyDeck";
import { pct } from "@/lib/neander/sales/types";
import { monthLabel } from "@/lib/neander/format";

const n = (v: number) => Math.round(v).toLocaleString("ko-KR");

export default function SalesReportPage() {
  const router = useRouter();
  const { lines, products, events, assumptions, loading, labor } = useSales();
  const laborCtx = useMemo(() => ({ actuals: labor }), [labor]);
  const months = useMemo(() => availableMonths(lines, events), [lines, events]);
  const [month, setMonth] = useState("");

  // 슬라이드에서 돌아오면 보던 달을 그대로 잇는다 (?month=)
  useEffect(() => {
    const m = new URLSearchParams(window.location.search).get("month");
    if (m) setMonth(m);
  }, []);

  const activeMonth = months.includes(month) ? month : months[0] || "";
  const d = useMemo(
    () => (activeMonth ? buildSalesDeck(activeMonth, lines, products, events, assumptions, laborCtx) : null),
    [activeMonth, lines, products, events, assumptions, laborCtx],
  );

  if (loading) return <LoadingState label="리포트를 만드는 중…" />;
  if (!d) {
    return (
      <PageShell>
        <PageHeader title="리포트" description="월간 매출 보고 — 매장 손익 · 상품 · 이벤트" />
        <EmptyState
          icon={TrendingUp}
          title="아직 판매가 없습니다"
          description="매출 적재에서 판매 파일을 올리면 여기에 월간 보고가 나타납니다."
        />
      </PageShell>
    );
  }

  const t = d.pnl.total;
  const p = d.prev.total;
  const delta = (cur: number, prev: number) => {
    if (!d.hasPrev) return "전월 자료 없음";
    const x = cur - prev;
    return x === 0 ? "전월과 같음" : `전월 대비 ${x > 0 ? "+" : "−"}${n(Math.abs(x))}`;
  };
  const storeRows = d.pnl.stores.filter((s) => s.revenue !== 0 || s.fixedTotal !== 0 || s.variable.total !== 0);
  const costTotal = t.variable.total + t.fixedTotal;
  const evRows = [...d.events].sort((a, b) => a.event.from.localeCompare(b.event.from));

  return (
    <PageShell>
      <ToolbarPortal order={0}>
        <MonthStepper glass months={months} value={activeMonth} onChange={setMonth} />
      </ToolbarPortal>

      <PageHeader
        title="리포트"
        description="월간 매출 보고 — 매장 손익 · 상품 · 이벤트"
        className="mb-3"
        actions={
          <Button
            variant="primary"
            icon={Presentation}
            onClick={() => router.push(`/neander/sales/reports/deck?month=${activeMonth}`)}
            title="임원 회의용 월간 보고 슬라이드 · F 전체화면"
          >
            슬라이드로 보기
          </Button>
        }
      />

      <BasisLine
        className="mb-4"
        items={[
          "판매 실적 기준",
          "재무 장부와 별도 집계",
          `${monthLabel(activeMonth)} 판매일 기준`,
          "이익률 분모는 확정 매출",
        ]}
      />

      <KpiStrip columns={4} className="mb-4">
        <StatTile label="매출" value={t.revenue} flow="income" hint={delta(t.revenue, p.revenue)} />
        <StatTile label={<TermLabel term="공헌이익" />} value={t.contribution} flow="net" hint={`이익률 ${pct(t.contributionRate)} · ${delta(t.contribution, p.contribution)}`} />
        <StatTile label={<TermLabel term="영업이익" />} value={t.operating} flow="net" hint={`이익률 ${pct(t.operatingRate)} · ${delta(t.operating, p.operating)}`} />
        <StatTile
          label="미확정 매출"
          value={t.pendingRevenue}
          tone={t.reviewCount > 0 ? "warning" : undefined}
          hint={t.reviewCount > 0 ? `${n(t.reviewCount)}건 · 이익률 계산에서 제외` : "전 건 확정"}
        />
      </KpiStrip>

      {/* 이번 달 인사이트 — 숫자를 읽기 전에 무엇이 중요한지. 발표 슬라이드와 같은 문서 */}
      <InsightPanel module="sales" month={activeMonth} />

      {/* 매장별 손익 */}
      <Card padding="none" className="mb-4 overflow-hidden">
        <div className="px-5 pt-4">
          <SectionHeader title="매장별 손익" hint={`${monthLabel(activeMonth)} · 고정비 = 공통비 배부 + 상시 인건비`} action={<TableNote>단위: 원</TableNote>} />
        </div>
        <TableScroll>
          <Table minWidth={820}>
            <thead>
              <tr>
                <Th className="pl-5">매장</Th>
                <Th align="right">매출</Th>
                <Th align="right">변동비</Th>
                <Th align="right"><TermLabel term="공헌이익" /></Th>
                <Th align="right">이익률</Th>
                <Th align="right">고정비</Th>
                <Th align="right"><TermLabel term="영업이익" /></Th>
                <Th align="right" className="pr-5">BEP 달성</Th>
              </tr>
            </thead>
            <tbody>
              {storeRows.map((s) => (
                <Tr key={s.store}>
                  <Td className="pl-5">
                    <div className="flex items-center gap-2">
                      <StoreBadge store={s.store} size="sm" />
                      <span className="text-nd-caption text-nd-fg-3">
                        {s.reviewCount ? `미확정 ${n(s.reviewCount)}건` : `인건비 ${s.labor.source === "actual" ? "실측" : "가정값"}`}
                      </span>
                    </div>
                  </Td>
                  <Td num><Money value={s.revenue} unit={false} flow="income" /></Td>
                  <Td num muted>{n(s.variable.total)}</Td>
                  <Td num className="font-semibold"><Money value={s.contribution} unit={false} flow="net" /></Td>
                  <Td num><Rate value={s.contributionRate} /></Td>
                  <Td num muted>{n(s.fixedTotal)}</Td>
                  <Td num className="font-semibold"><Money value={s.operating} unit={false} flow="net" /></Td>
                  <Td num className="pr-5">{pct(s.bepAchieved)}</Td>
                </Tr>
              ))}
              <TotalRow>
                <Td className="pl-5">합계</Td>
                <Td num><Money value={t.revenue} unit={false} flow="income" /></Td>
                <Td num>{n(t.variable.total)}</Td>
                <Td num><Money value={t.contribution} unit={false} flow="net" /></Td>
                <Td num><Rate value={t.contributionRate} /></Td>
                <Td num>{n(t.fixedTotal)}</Td>
                <Td num><Money value={t.operating} unit={false} flow="net" /></Td>
                <Td num className="pr-5">{pct(t.bepAchieved)}</Td>
              </TotalRow>
            </tbody>
          </Table>
        </TableScroll>
      </Card>

      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        {/* 비용 구조 */}
        <Card padding="none" className="overflow-hidden">
          <div className="px-5 pt-4">
            <SectionHeader title="비용 구조" hint={`매출 대비 ${pct(t.revenue ? costTotal / t.revenue : null)}`} action={<TableNote>단위: 원</TableNote>} />
          </div>
          <TableScroll>
            <Table minWidth={420}>
              <thead>
                <tr>
                  <Th className="pl-5">항목</Th>
                  <Th align="right">{monthLabel(activeMonth)}</Th>
                  <Th align="right">전월</Th>
                  <Th align="right" className="pr-5">비중</Th>
                </tr>
              </thead>
              <tbody>
                {d.costs.map((c) => (
                  <Tr key={c.label}>
                    <Td className="pl-5">
                      {c.label}
                      {c.parent && <span className="ml-1.5 text-nd-caption text-nd-fg-3">{c.parent}</span>}
                    </Td>
                    <Td num>{n(c.value)}</Td>
                    <Td num muted>{d.hasPrev ? n(c.prev) : "—"}</Td>
                    <Td num className="pr-5">{pct(costTotal ? c.value / costTotal : null)}</Td>
                  </Tr>
                ))}
                <TotalRow>
                  <Td className="pl-5">합계</Td>
                  <Td num>{n(costTotal)}</Td>
                  <Td num>{d.hasPrev ? n(d.prev.total.variable.total + d.prev.total.fixedTotal) : "—"}</Td>
                  <Td num className="pr-5">100.0%</Td>
                </TotalRow>
              </tbody>
            </Table>
          </TableScroll>
        </Card>

        {/* 상위 상품 */}
        <Card padding="none" className="overflow-hidden">
          <div className="px-5 pt-4">
            <SectionHeader
              title="공헌이익 상위 상품"
              hint="확정 판매만"
              action={
                <Link href="/neander/sales/products" className="text-nd-caption font-medium text-nd-accent-strong hover:underline">
                  전체 보기 →
                </Link>
              }
            />
          </div>
          {d.products.length === 0 ? (
            <EmptyState icon={Boxes} title="확정된 판매가 없습니다" description="검토 대기함에서 상품을 정하면 여기에 나타납니다." className="border-0" />
          ) : (
            <TableScroll>
              <Table minWidth={460}>
                <thead>
                  <tr>
                    <Th className="pl-5">상품</Th>
                    <Th align="right">수량</Th>
                    <Th align="right">매출</Th>
                    <Th align="right"><TermLabel term="공헌이익" /></Th>
                    <Th align="right" className="pr-5">이익률</Th>
                  </tr>
                </thead>
                <tbody>
                  {d.products.slice(0, 8).map((x) => (
                    <Tr key={x.product.id}>
                      <Td className="pl-5"><ProductCell product={x.product} className="max-w-[14rem]" /></Td>
                      <Td num>{n(x.qty)}</Td>
                      <Td num><Money value={x.revenue} unit={false} flow="income" /></Td>
                      <Td num className="font-semibold"><Money value={x.contribution} unit={false} flow="net" /></Td>
                      <Td num className="pr-5"><Rate value={x.contributionRate} tone="auto" /></Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </TableScroll>
          )}
        </Card>
      </div>

      {/* 이벤트별 손익 */}
      <Card padding="none" className="overflow-hidden">
        <div className="px-5 pt-4">
          <SectionHeader
            title="이벤트별 손익"
            hint={`${monthLabel(activeMonth)} 시작 ${n(d.events.length)}건 · 확정 매출 기준`}
            action={<TableNote>단위: 원</TableNote>}
          />
        </div>
        {evRows.length === 0 ? (
          <EmptyState icon={CalendarPlus} title="이 달에 시작한 이벤트가 없습니다" className="border-0" />
        ) : (
          <TableScroll>
            <Table minWidth={760}>
              <thead>
                <tr>
                  <Th className="pl-5">이벤트</Th>
                  <Th>기간</Th>
                  <Th align="right">매출</Th>
                  <Th align="right"><TermLabel term="공헌이익" /></Th>
                  <Th align="right">이익률</Th>
                  <Th align="right" className="pr-5">일당 공헌</Th>
                </tr>
              </thead>
              <tbody>
                {evRows.map((e) => (
                  <Tr key={e.event.id}>
                    <Td className="pl-5">
                      <div className="flex items-center gap-2">
                        <StoreBadge store={e.event.store} size="sm" />
                        <span className="font-medium">{e.event.name}</span>
                      </div>
                    </Td>
                    <Td muted>{e.event.from.slice(5)} ~ {e.event.to.slice(5)} · {e.days}일</Td>
                    <Td num>
                      <EventDrill month={activeMonth} perf={e} cell="revenue" tone="light">
                        <Money value={e.revenue} unit={false} flow="income" />
                      </EventDrill>
                    </Td>
                    <Td num className="font-semibold">
                      <EventDrill month={activeMonth} perf={e} cell="contribution" tone="light">
                        <Money value={e.contribution} unit={false} flow="net" />
                      </EventDrill>
                    </Td>
                    <Td num>
                      <EventDrill month={activeMonth} perf={e} cell="rate" tone="light">
                        <Rate value={e.contributionRate} tone="auto" />
                      </EventDrill>
                    </Td>
                    <Td num className="pr-5">
                      <EventDrill month={activeMonth} perf={e} cell="perDay" tone="light">
                        {n(e.contributionPerDay)}
                      </EventDrill>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </TableScroll>
        )}
      </Card>
    </PageShell>
  );
}
