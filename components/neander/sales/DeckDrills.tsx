"use client";

// ============================================================
//  매출 보고 슬라이드의 숫자 드릴 — 올리면 미리보기, 누르면 전체 내역 창
// ------------------------------------------------------------
//  매장 대시보드(SalesDrill)와 같은 판·창을 발표 화면에서도 쓴다. 회의 중
//  "이 숫자 뭐로 이루어졌어?"에 슬라이드를 떠나지 않고 답하려는 것이다.
//
//  ⚠️ 창 합계는 슬라이드 숫자와 원 단위로 같아야 한다. 그래서 거르는 규칙을
//     집계 함수와 똑같이 둔다:
//       매장 칸      buildPnl — 이 달 · 이 매장, 원가·수수료는 확정 줄만
//       상품 칸      buildProductPerf — resolved · 이 상품
//       이벤트 칸    buildEventPerf — 이 이벤트에 붙은 이 달 줄
//     계산으로 만든 숫자(인건비·준비물·고정비·이익)는 pnlSegmentDetail 로 나눈다.
// ============================================================

import { useMemo, type ReactNode } from "react";
import {
  inMonth,
  lineFee,
  lineMaterial,
  productIndex,
  type EventPerf,
  type ProductPerf,
  type SalesPnl,
  type StorePnl,
} from "@/lib/neander/sales/aggregate";
import {
  pnlSegmentDetail,
  type PnlDetail,
  type PnlDetailSection,
  type PnlSegmentKey,
} from "@/lib/neander/sales/pnl-detail";
import { pct, storeLabel, type SalesLine, type SalesStore } from "@/lib/neander/sales/types";
import { monthLabel } from "@/lib/neander/format";
import { SalesDrill } from "./SalesDrill";
import { useSales } from "./SalesProvider";

const moved = (n: number) => Math.round(n) !== 0;

/** 발표 한 판의 드릴 재료 — 달·손익·원장 데이터 */
function useDeckCtx(month: string) {
  const { lines, products, events, assumptions } = useSales();
  return useMemo(() => {
    const idx = productIndex(products);
    const ctx = { month, lines, products, events, assumptions };
    const monthLines = () => lines.filter((l) => inMonth(l.date, month));
    return { ctx, idx, assumptions, monthLines, sub: monthLabel(month) };
  }, [month, lines, products, events, assumptions]);
}

/** 매장마다 한 줄 — 합계 줄의 계산 숫자 */
function perStoreDetail(
  pnl: SalesPnl,
  key: string,
  title: string,
  total: number,
  pick: (s: StorePnl) => number,
  direction: PnlDetail["direction"],
): PnlDetail {
  return {
    key: `all-${key}`,
    title,
    total,
    formula: false,
    direction,
    basis: "매장별 합",
    rows: pnl.stores
      .map((s) => ({ key: s.store, label: storeLabel(s.store), value: pick(s) }))
      .filter((r) => moved(r.value)),
  };
}

/** 매장마다 한 묶음 — 인건비·준비물처럼 매장 안에서도 항목이 나뉘는 숫자 */
function sectionsByStore(
  pnl: SalesPnl,
  key: PnlSegmentKey,
  title: string,
  total: number,
  ctx: Parameters<typeof pnlSegmentDetail>[2],
): PnlDetail {
  const sections: PnlDetailSection[] = pnl.stores
    .map((s) => {
      const dd = pnlSegmentDetail(key, s, ctx);
      return {
        key: s.store,
        title: storeLabel(s.store),
        total: dd.total,
        rows: dd.rows,
        basis: dd.basis,
        people: dd.people,
        note: dd.note,
      };
    })
    .filter((x) => moved(x.total));
  return { key: `all-${key}`, title, total, rows: [], sections, direction: "expense", formula: false };
}

function asSection(d: PnlDetail): PnlDetailSection {
  return { key: String(d.key), title: d.title, total: d.total, rows: d.rows, basis: d.basis, people: d.people, note: d.note };
}

// ---- 매장별 손익 표 ----------------------------------------------

export type StoreCell = "revenue" | "variable" | "contribution" | "rate" | "fixed" | "operating" | "bep";

/** 매장 한 칸 (store 를 비우면 합계 줄) */
export function StoreDrill({
  month,
  pnl,
  store,
  cell,
  children,
}: {
  month: string;
  pnl: SalesPnl;
  store?: SalesStore;
  cell: StoreCell;
  children: ReactNode;
}) {
  const { ctx, sub, monthLines } = useDeckCtx(month);
  const s = store ? pnl.stores.find((x) => x.store === store) : undefined;
  const t = pnl.total;
  const name = s ? storeLabel(s.store) : "전체 매장";
  const inStore = (l: SalesLine) => !s || l.store === s.store;
  const common = { title: "", subtitle: sub, tone: "dark" as const };

  switch (cell) {
    case "revenue":
      return (
        <SalesDrill {...common} title={`${name} · 매출`} lines={() => monthLines().filter(inStore)} flow="income">
          {children}
        </SalesDrill>
      );
    case "variable": {
      const detail = (): PnlDetail => {
        if (!s) return {
          key: "all-variable",
          title: "변동비",
          total: t.variable.total,
          formula: false,
          direction: "expense",
          basis: "매장 전체",
          rows: [
            { key: "material", label: "재료비", value: t.variable.material },
            { key: "labor", label: "이벤트·제작 인건비", value: t.variable.eventLabor + t.variable.makeLabor + t.variable.serviceLabor },
            { key: "supplies", label: "준비물", value: t.variable.supplies },
            { key: "fee", label: "결제 수수료", value: t.variable.fee },
          ].filter((r) => moved(r.value)),
        };
        const v = s.variable;
        return {
          key: "variable",
          title: "변동비",
          total: v.total,
          rows: [],
          direction: "expense",
          sections: (["material", "variableLabor", "supplies", "fee"] as PnlSegmentKey[])
            .map((k) => asSection(pnlSegmentDetail(k, s, ctx)))
            .filter((x) => moved(x.total)),
          note: "판매·행사에 따라 늘고 주는 비용 — 확정 매출에서 빼면 공헌이익입니다.",
        };
      };
      return (
        <SalesDrill {...common} title={`${name} · 변동비`} detail={detail}>
          {children}
        </SalesDrill>
      );
    }
    case "contribution":
    case "rate":
      return (
        <SalesDrill
          {...common}
          title={`${name} · 공헌이익${cell === "rate" ? `률 ${pct(s ? s.contributionRate : t.contributionRate)}` : ""}`}
          detail={() =>
            s
              ? pnlSegmentDetail("contribution", s, ctx)
              : perStoreDetail(pnl, "contribution", "공헌이익", t.contribution, (x) => x.contribution, "net")
          }
        >
          {children}
        </SalesDrill>
      );
    case "fixed":
      return (
        <SalesDrill
          {...common}
          title={`${name} · 고정비`}
          detail={(): PnlDetail =>
            s
              ? {
                  key: "fixedTotal",
                  title: "고정비",
                  total: s.fixedTotal,
                  rows: [],
                  direction: "expense",
                  sections: [asSection(pnlSegmentDetail("regularLabor", s, ctx)), asSection(pnlSegmentDetail("fixed", s, ctx))].filter(
                    (x) => moved(x.total) || x.rows.length > 0,
                  ),
                  note: "매달 판매와 상관없이 나가는 비용 — 공헌이익에서 빼면 영업이익입니다.",
                }
              : perStoreDetail(pnl, "fixed", "고정비", t.fixedTotal, (x) => x.fixedTotal, "expense")
          }
        >
          {children}
        </SalesDrill>
      );
    case "operating":
      return (
        <SalesDrill
          {...common}
          title={`${name} · 영업이익`}
          detail={() =>
            s ? pnlSegmentDetail("op", s, ctx) : perStoreDetail(pnl, "op", "영업이익", t.operating, (x) => x.operating, "net")
          }
        >
          {children}
        </SalesDrill>
      );
    case "bep": {
      const bep = s ? s.bep : t.bep;
      const fixed = s ? s.fixedTotal : t.fixedTotal;
      const confirmed = s ? s.confirmedRevenue : t.confirmedRevenue;
      const rate = s ? s.contributionRate : t.contributionRate;
      if (bep === null) return <>{children}</>;
      return (
        <SalesDrill
          {...common}
          title={`${name} · 손익분기 달성`}
          detail={(): PnlDetail => ({
            key: "bep",
            title: "손익분기 매출",
            total: bep,
            formula: true,
            direction: "income",
            rows: [
              { key: "fixed", label: "고정비", value: fixed, sub: `공헌이익률 ${pct(rate)} 로 나누면 손익분기 매출` },
              { key: "confirmed", label: "이 달 확정 매출", value: confirmed, sub: `달성률 = 확정 매출 ÷ 손익분기 매출 = ${pct(s ? s.bepAchieved : t.bepAchieved)}` },
            ],
            basis: "손익분기 매출 = 고정비 ÷ 공헌이익률",
            note: "확정 매출이 손익분기 매출을 넘으면(100% 이상) 영업이익이 남습니다.",
          })}
        >
          {children}
        </SalesDrill>
      );
    }
  }
}

// ---- 비용 구조 ----------------------------------------------------

/** 비용 항목 한 줄 — 매장 전체 (monthlyDeck costParts 의 라벨) */
export function CostDrill({ month, pnl, label, children }: { month: string; pnl: SalesPnl; label: string; children: ReactNode }) {
  const { ctx, sub, idx, assumptions, monthLines } = useDeckCtx(month);
  const t = pnl.total;
  const common = { subtitle: sub, tone: "dark" as const };
  const confirmed = () => monthLines().filter((l) => l.status !== "needs_review");

  switch (label) {
    case "재료비":
      return (
        <SalesDrill
          {...common}
          title="재료비"
          lines={() => confirmed().filter((l) => moved(lineMaterial(l, idx)))}
          amountOf={(l) => lineMaterial(l, idx)}
          flow="expense"
        >
          {children}
        </SalesDrill>
      );
    case "결제 수수료":
      return (
        <SalesDrill
          {...common}
          title="결제 수수료"
          lines={() => confirmed().filter((l) => moved(lineFee(l, assumptions)))}
          amountOf={(l) => lineFee(l, assumptions)}
          flow="expense"
        >
          {children}
        </SalesDrill>
      );
    case "인건비":
      return (
        <SalesDrill {...common} title="이벤트·제작 인건비" detail={() => sectionsByStore(pnl, "variableLabor", "이벤트·제작 인건비", t.variable.total - t.variable.material - t.variable.supplies - t.variable.fee, ctx)}>
          {children}
        </SalesDrill>
      );
    case "준비물":
      return (
        <SalesDrill {...common} title="준비물" detail={() => sectionsByStore(pnl, "supplies", "준비물", t.variable.supplies, ctx)}>
          {children}
        </SalesDrill>
      );
    case "고정비":
      return (
        <SalesDrill
          {...common}
          title="고정비"
          detail={(): PnlDetail => ({
            key: "all-fixedTotal",
            title: "고정비",
            total: t.fixedTotal,
            rows: [],
            direction: "expense",
            sections: pnl.stores
              .map((s) => ({
                key: s.store,
                title: storeLabel(s.store),
                total: s.fixedTotal,
                rows: [
                  { key: "regular", label: "상시 인건비", value: s.regularLabor, sub: s.labor.source === "actual" ? "근무 일지 실측" : "가정값" },
                  { key: "fixed", label: "배부 고정비", value: s.allocatedFixed, sub: "공통 고정비 × 배부 비율" },
                ].filter((r) => moved(r.value)),
              }))
              .filter((x) => moved(x.total)),
            note: "매장 한 곳을 열어 보려면 「매장별 손익」 장의 고정비 칸에 커서를 두세요.",
          })}
        >
          {children}
        </SalesDrill>
      );
    default:
      return <>{children}</>;
  }
}

// ---- 상위 상품 ------------------------------------------------------

export type ProductCell = "qty" | "revenue" | "contribution" | "rate" | "unit";

export function ProductDrill({ month, perf: p, cell, children }: { month: string; perf: ProductPerf; cell: ProductCell; children: ReactNode }) {
  const { sub, assumptions: a, monthLines } = useDeckCtx(month);
  const name = `${p.product.name} ${p.product.option}`.trim();
  const common = { subtitle: sub, tone: "dark" as const };
  // buildProductPerf 와 같은 거름 — resolved · 이 상품
  const lines = () => monthLines().filter((l) => l.status === "resolved" && l.productId === p.product.id);

  if (cell === "qty" || cell === "revenue") {
    return (
      <SalesDrill {...common} title={`${name} · ${cell === "qty" ? `수량 ${p.qty.toLocaleString("ko-KR")}개` : "매출"}`} lines={lines} flow="income">
        {children}
      </SalesDrill>
    );
  }
  // buildProductPerf 의 인건비 규칙 — 엑셀 재현 모드면 접객+제작, 아니면 제작만
  const labor = a.laborMode === "excel" ? p.labor : (p.product.makeMin / 60) * p.qty * a.wage.puddi;
  return (
    <SalesDrill
      {...common}
      title={`${name} · ${cell === "unit" ? "개당 공헌이익" : cell === "rate" ? `공헌이익률 ${pct(p.contributionRate)}` : "공헌이익"}`}
      detail={(): PnlDetail => ({
        key: "product-contribution",
        title: "공헌이익",
        total: p.contribution,
        formula: true,
        rows: [
          { key: "rev", label: "매출", value: p.revenue, sub: `${p.qty.toLocaleString("ko-KR")}개` },
          { key: "material", label: "재료비", value: p.material, sign: "minus" },
          { key: "labor", label: a.laborMode === "excel" ? "인건비 (접객 + 제작)" : "제작 인건비", value: labor, sign: "minus" },
          { key: "fee", label: "결제 수수료", value: p.fee, sign: "minus" },
        ],
        basis: `공헌이익률 ${pct(p.contributionRate)}`,
        note: cell === "unit" ? `개당 공헌이익 = 공헌이익 ÷ 수량 ${p.qty.toLocaleString("ko-KR")}개 = ${p.unitContribution.toLocaleString("ko-KR")}원` : undefined,
      })}
    >
      {children}
    </SalesDrill>
  );
}

// ---- 이벤트별 손익 ---------------------------------------------------

export type EventCell = "revenue" | "contribution" | "rate" | "perDay";

const eventFormula = (e: EventPerf, note?: string): PnlDetail => ({
  key: "event-contribution",
  title: "공헌이익",
  total: e.contribution,
  formula: true,
  rows: [
    { key: "rev", label: "확정 매출", value: e.confirmedRevenue, sub: e.pendingRevenue ? `미확정 ${Math.round(e.pendingRevenue).toLocaleString("ko-KR")}원 제외` : undefined },
    { key: "material", label: "재료비", value: e.material, sign: "minus" },
    { key: "labor", label: "인건비", value: e.labor, sign: "minus", sub: e.laborSource === "actual" ? "이벤트 스태프(근무 일지 실측) + 제작" : "이벤트 스태프(가정값) + 제작" },
    { key: "supplies", label: "준비물", value: e.supplies, sign: "minus" },
    { key: "fee", label: "결제 수수료", value: e.fee, sign: "minus" },
  ],
  basis: `${e.event.from} ~ ${e.event.to} · ${e.days}일 · 공헌이익률 ${pct(e.contributionRate)}`,
  note,
});

export function EventDrill({
  month,
  perf: e,
  cell,
  tone = "dark",
  children,
}: {
  month: string;
  perf: EventPerf;
  cell: EventCell;
  /** 리포트 화면처럼 밝은 바탕 위면 "light" */
  tone?: "dark" | "light";
  children: ReactNode;
}) {
  const { sub, monthLines } = useDeckCtx(month);
  const common = { subtitle: `${storeLabel(e.event.store)} · ${sub}`, tone: tone === "dark" ? ("dark" as const) : undefined };
  if (cell === "revenue") {
    return (
      <SalesDrill {...common} title={`${e.event.name} · 매출`} lines={() => monthLines().filter((l) => l.eventId === e.event.id)} flow="income" byProduct>
        {children}
      </SalesDrill>
    );
  }
  return (
    <SalesDrill
      {...common}
      title={`${e.event.name} · ${cell === "perDay" ? "일당 공헌이익" : cell === "rate" ? "공헌이익률" : "공헌이익"}`}
      detail={() =>
        eventFormula(
          e,
          cell === "perDay"
            ? `일당 공헌이익 = 공헌이익 ÷ 운영 ${e.days}일 = ${e.contributionPerDay.toLocaleString("ko-KR")}원`
            : undefined,
        )
      }
    >
      {children}
    </SalesDrill>
  );
}

/** 이벤트 합계 줄 */
export function EventTotalDrill({
  month,
  events,
  cell,
  children,
}: {
  month: string;
  events: EventPerf[];
  cell: "revenue" | "contribution";
  children: ReactNode;
}) {
  const { sub, monthLines } = useDeckCtx(month);
  const ids = new Set(events.map((e) => e.event.id));
  const common = { subtitle: sub, tone: "dark" as const };
  if (cell === "revenue") {
    return (
      <SalesDrill {...common} title="이벤트 합계 · 매출" lines={() => monthLines().filter((l) => !!l.eventId && ids.has(l.eventId))} flow="income" byProduct>
        {children}
      </SalesDrill>
    );
  }
  return (
    <SalesDrill
      {...common}
      title="이벤트 합계 · 공헌이익"
      detail={(): PnlDetail => ({
        key: "events-contribution",
        title: "공헌이익",
        total: events.reduce((s, e) => s + e.contribution, 0),
        formula: false,
        direction: "net",
        basis: "이벤트별 합",
        rows: [...events]
          .sort((a, b) => b.contribution - a.contribution)
          .map((e) => ({ key: e.event.id, label: e.event.name, value: e.contribution, sub: `${storeLabel(e.event.store)} · ${e.days}일` })),
      })}
    >
      {children}
    </SalesDrill>
  );
}

// ---- 핵심 요약 ------------------------------------------------------

export function SummaryDrill({ month, pnl, kind, children }: { month: string; pnl: SalesPnl; kind: "revenue" | "contribution" | "operating"; children: ReactNode }) {
  if (kind === "revenue") {
    return (
      <StoreDrill month={month} pnl={pnl} cell="revenue">
        {children}
      </StoreDrill>
    );
  }
  return (
    <StoreDrill month={month} pnl={pnl} cell={kind}>
      {children}
    </StoreDrill>
  );
}
