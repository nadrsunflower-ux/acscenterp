// ============================================================
//  월간 매출 보고 — 리포트 화면과 슬라이드에 올릴 숫자를 한 번에 만든다
// ------------------------------------------------------------
//  월 손익 화면과 **같은 집계 함수**(buildPnl · buildProductPerf ·
//  buildEventPerf · monthlyTrend)와 같은 인건비 맥락을 쓴다. 발표 숫자가
//  월 손익 화면과 다르면 회의가 "어느 게 맞냐"로 흘러간다.
//
//  ⚠️ 매출은 판매 실적 기준이다 — 재무 장부의 수입(정산 입금)과 다르다.
//  ⚠️ 이익률의 분모는 확정 매출이다. 미확정 금액은 항상 같이 보여 준다.
// ============================================================

import {
  availableMonths,
  buildEventPerf,
  buildPnl,
  buildProductPerf,
  monthlyTrend,
  type EventPerf,
  type ProductPerf,
  type SalesPnl,
} from "./aggregate";
import type { LaborContext } from "./labor";
import { explainOperatingChange, type PnlExplain } from "./pnl-explain";
import type { SalesAssumptions, SalesEvent, SalesLine, SalesProduct } from "./types";
import { shiftMonth } from "../format";

export interface SalesDeckLine {
  label: string;
  parent?: string;
  value: number;
  prev: number;
}

export interface SalesDeckTrend {
  month: string;
  revenue: number;
  contribution: number;
  operating: number;
}

export interface SalesDeckData {
  month: string;
  prevMonth: string;
  /** 전월에 판매·이벤트가 있었나 — 없으면 전월 대비를 숨긴다 */
  hasPrev: boolean;
  pnl: SalesPnl;
  prev: SalesPnl;
  /** 최근 6개월 (오래된 달부터, 이번 달 포함) */
  trend: SalesDeckTrend[];
  /** 추이의 달마다 — 전월 대비 영업이익이 왜 바뀌었나 (막대에 커서를 두면 뜬다) */
  explains: Record<string, PnlExplain>;
  /** 공헌이익 순 전체 */
  products: ProductPerf[];
  /** 시작일이 이 달인 이벤트 */
  events: EventPerf[];
  /** 비용 구조 — 변동비 네 갈래 + 고정비 */
  costs: SalesDeckLine[];
}

/**
 * 비용 갈래. 인건비는 변동비 합계에서 나머지를 빼서 구한다 — 접객 인건비가
 * 변동비에 들어가는지는 laborMode 가 정하므로, 필드를 직접 더하면 합계와
 * 어긋날 수 있다.
 */
function costParts(p: SalesPnl): { label: string; parent?: string; value: number }[] {
  const v = p.total.variable;
  return [
    { label: "재료비", value: v.material },
    { label: "인건비", parent: "이벤트·제작", value: v.total - v.material - v.supplies - v.fee },
    { label: "준비물", parent: "이벤트", value: v.supplies },
    { label: "결제 수수료", value: v.fee },
    { label: "고정비", parent: "공통비 배부·상시 인건비", value: p.total.fixedTotal },
  ];
}

export function buildSalesDeck(
  month: string,
  lines: SalesLine[],
  products: SalesProduct[],
  events: SalesEvent[],
  a: SalesAssumptions,
  labor?: LaborContext,
  trendMonths = 6,
): SalesDeckData {
  const prevMonth = shiftMonth(month, -1);
  const pnl = buildPnl(month, lines, products, events, a, labor);
  const prev = buildPnl(prevMonth, lines, products, events, a, labor);
  const hasPrev = availableMonths(lines, events).includes(prevMonth);

  const trend = monthlyTrend(lines, products, events, a, labor)
    .filter((p) => p.month <= month)
    .slice(-trendMonths)
    .map((p) => ({ month: p.month, ...p.total }));

  // 추이의 달마다 전월과 나란히 세어 둔다 — 같은 buildPnl 이라 막대 숫자와 설명이 원 단위로 맞는다
  const months = availableMonths(lines, events);
  const pnlCache = new Map<string, SalesPnl>([
    [month, pnl],
    [prevMonth, prev],
  ]);
  const pnlOf = (m: string) => {
    if (!pnlCache.has(m)) pnlCache.set(m, buildPnl(m, lines, products, events, a, labor));
    return pnlCache.get(m)!;
  };
  const explains: Record<string, PnlExplain> = {};
  trend.forEach((t) => {
    const pm = shiftMonth(t.month, -1);
    explains[t.month] = explainOperatingChange(pnlOf(t.month), pnlOf(pm), events, months.includes(pm));
  });

  const prevCost = new Map(costParts(prev).map((c) => [c.label, c.value]));
  const costs = costParts(pnl)
    .map((c) => ({ ...c, prev: prevCost.get(c.label) ?? 0 }))
    .filter((c) => c.value !== 0 || c.prev !== 0);

  return {
    month,
    prevMonth,
    hasPrev,
    pnl,
    prev,
    trend,
    explains,
    products: buildProductPerf(month, lines, products, a),
    events: buildEventPerf(month, lines, products, events, a, labor),
    costs,
  };
}
