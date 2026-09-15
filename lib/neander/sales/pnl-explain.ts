// ============================================================
//  영업이익이 왜 바뀌었나 — 전월 대비 변화를 갈래별로 나눠 설명한다
// ------------------------------------------------------------
//  "매출은 줄었는데 영업이익은 크게 늘었다" 같은 달에 사람이 가장 먼저 묻는
//  것은 "왜?" 다. 이걸 AI 에 묻지 않고 **숫자로** 나눈다 — 설명이 표의 숫자와
//  원 단위로 맞아야 회의에서 믿고 쓸 수 있다.
//
//  영업이익 = 확정 매출 − 변동비(재료비·이벤트·제작 인건비·준비물·수수료)
//                       − 고정비(상시 인건비·배부 고정비)     (aggregate.ts buildPnl)
//
//  그래서 전월 대비 영업이익 변화 = 각 갈래 변화의 합이다 (비용은 부호를 뒤집는다).
//  갈래마다 무엇이 움직였는지(매장·이벤트·비율)를 곁들이고, 영향이 큰 순서로
//  한 문장 요약을 만든다.
// ============================================================

import { inMonth, type SalesPnl, type StorePnl } from "./aggregate";
import { storeLabel, type SalesEvent, type SalesStore } from "./types";
import { shortWon } from "../format";

/** 영업이익을 움직인 갈래 하나 */
export interface BridgeItem {
  key: "confirmed" | "material" | "variableLabor" | "supplies" | "fee" | "regularLabor" | "fixed";
  label: string;
  /** 이 갈래가 영업이익을 얼마나 올렸나 (+) · 내렸나 (−) */
  impact: number;
  /** 갈래 자체의 금액 — 이번 달 · 전월 */
  cur: number;
  prev: number;
  /** 무엇이 움직였나 (매장별·이벤트별·비율) */
  details: string[];
}

export interface PnlExplain {
  month: string;
  prevMonth: string;
  /** 전월 자료가 있나 — 없으면 설명하지 않는다 */
  hasPrev: boolean;
  revenue: { cur: number; prev: number };
  operating: { cur: number; prev: number };
  /** 영향이 큰 순서. 합 = operating.cur − operating.prev */
  items: BridgeItem[];
  /** 한두 문장 요약 */
  headline: string;
  notes: string[];
}

const monthNum = (m: string) => `${Number(m.slice(5, 7))}월`;
const wonText = (n: number) => `${shortWon(Math.round(n))}원`;
const absWon = (n: number) => wonText(Math.abs(n));
const signed = (n: number) => `${n >= 0 ? "+" : "−"}${absWon(n)}`;
const rate = (part: number, whole: number) => (whole ? `${((part / whole) * 100).toFixed(1)}%` : "—");
/** 반올림해서 1원도 안 되는 변화는 변화로 보지 않는다 */
const moved = (n: number) => Math.round(n) !== 0;

const STORES: SalesStore[] = ["wow", "id", "online"];
const storeOf = (p: SalesPnl, s: SalesStore): StorePnl | undefined => p.stores.find((x) => x.store === s);
const sumStores = (p: SalesPnl, f: (s: StorePnl) => number) => p.stores.reduce((a, s) => a + f(s), 0);
const variableLabor = (p: SalesPnl) =>
  p.total.variable.eventLabor + p.total.variable.makeLabor + p.total.variable.serviceLabor;

/** 매장별로 움직인 것만 한 줄씩 */
function perStore(cur: SalesPnl, prev: SalesPnl, f: (s: StorePnl) => number, suffix?: (c?: StorePnl, p?: StorePnl) => string) {
  return STORES.flatMap((s) => {
    const c = storeOf(cur, s);
    const p = storeOf(prev, s);
    const a = c ? f(c) : 0;
    const b = p ? f(p) : 0;
    if (!moved(a - b)) return [];
    return [`${storeLabel(s)} ${wonText(b)} → ${wonText(a)} (${signed(a - b)})${suffix ? suffix(c, p) : ""}`];
  });
}

/** 그 달에 시작한 이벤트의 준비물 — 이름과 금액 */
function suppliesOf(events: SalesEvent[], month: string): string {
  const list = events
    .filter((e) => inMonth(e.from, month) && e.supplies > 0)
    .sort((a, b) => b.supplies - a.supplies);
  if (list.length === 0) return "없음";
  const head = list.slice(0, 3).map((e) => `${e.name} ${wonText(e.supplies)}`);
  return list.length > 3 ? `${head.join(" · ")} 외 ${list.length - 3}건` : head.join(" · ");
}

export function explainOperatingChange(
  cur: SalesPnl,
  prev: SalesPnl,
  events: SalesEvent[],
  hasPrev = true,
): PnlExplain {
  const ct = cur.total;
  const pt = prev.total;
  const item = (
    key: BridgeItem["key"],
    label: string,
    c: number,
    p: number,
    cost: boolean,
    details: string[],
  ): BridgeItem => ({ key, label, cur: c, prev: p, impact: cost ? p - c : c - p, details });

  const items: BridgeItem[] = [
    item("confirmed", "확정 매출", ct.confirmedRevenue, pt.confirmedRevenue, false, [
      ...perStore(cur, prev, (s) => s.confirmedRevenue),
      ...(moved(ct.pendingRevenue - pt.pendingRevenue)
        ? [`미확정 ${wonText(pt.pendingRevenue)} → ${wonText(ct.pendingRevenue)} — 미확정은 원가를 몰라 확정 매출에서 뺍니다`]
        : []),
    ]),
    item("material", "재료비", ct.variable.material, pt.variable.material, true, [
      `확정 매출 대비 재료비 ${rate(pt.variable.material, pt.confirmedRevenue)} → ${rate(ct.variable.material, ct.confirmedRevenue)}`,
      ...perStore(cur, prev, (s) => s.variable.material),
    ]),
    item("variableLabor", "이벤트·제작 인건비", variableLabor(cur), variableLabor(prev), true, [
      ...perStore(
        cur,
        prev,
        (s) => s.variable.eventLabor + s.variable.makeLabor + s.variable.serviceLabor,
        (c, p) => {
          const n = (x?: StorePnl) => Object.keys(x?.labor.eventLabor ?? {}).length;
          return n(c) !== n(p) ? ` · 이벤트 ${n(p)}건 → ${n(c)}건` : "";
        },
      ),
      ...(moved(ct.variable.makeLabor - pt.variable.makeLabor)
        ? [`제작 인건비 ${wonText(pt.variable.makeLabor)} → ${wonText(ct.variable.makeLabor)}`]
        : []),
    ]),
    item("supplies", "준비물", ct.variable.supplies, pt.variable.supplies, true, [
      `${monthNum(prev.month)}: ${suppliesOf(events, prev.month)}`,
      `${monthNum(cur.month)}: ${suppliesOf(events, cur.month)}`,
      "준비물은 이벤트가 시작한 달에 전액 잡힙니다",
    ]),
    item("fee", "결제 수수료", ct.variable.fee, pt.variable.fee, true, [
      `확정 매출 대비 수수료 ${rate(pt.variable.fee, pt.confirmedRevenue)} → ${rate(ct.variable.fee, ct.confirmedRevenue)}`,
    ]),
    item("regularLabor", "상시 인건비", sumStores(cur, (s) => s.regularLabor), sumStores(prev, (s) => s.regularLabor), true,
      perStore(cur, prev, (s) => s.regularLabor, (c, p) => {
        const src = (x?: StorePnl) => (x?.labor.source === "actual" ? "실측" : "추정");
        return c && p && c.labor.source !== p.labor.source ? ` · ${src(p)} → ${src(c)} (기준이 달라 비교에 주의)` : "";
      }),
    ),
    item("fixed", "배부 고정비", sumStores(cur, (s) => s.allocatedFixed), sumStores(prev, (s) => s.allocatedFixed), true,
      perStore(cur, prev, (s) => s.allocatedFixed),
    ),
  ]
    .filter((x) => moved(x.impact))
    .sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact));

  const dRev = ct.revenue - pt.revenue;
  const dOp = ct.operating - pt.operating;
  const notes: string[] = [];

  let headline: string;
  if (!hasPrev) {
    headline = `${monthNum(prev.month)} 자료가 없어 전월과 비교할 수 없습니다.`;
  } else if (!moved(dOp)) {
    headline = `영업이익이 ${monthNum(prev.month)}과 같습니다.`;
  } else {
    const revPart = !moved(dRev)
      ? "매출은 전월과 같고"
      : `매출은 ${absWon(dRev)} ${dRev < 0 ? "줄었" : "늘었"}${dRev < 0 !== dOp < 0 ? "지만" : "고"}`;
    const opPart = `영업이익은 ${absWon(dOp)} ${dOp < 0 ? "줄었습니다" : "늘었습니다"}`;
    const phrase = (x: BridgeItem) => {
      const d = x.cur - x.prev;
      return `${x.label} ${absWon(d)} ${d < 0 ? "감소" : "증가"}`;
    };
    const same = items.filter((x) => x.impact < 0 === dOp < 0);
    const against = items.filter((x) => x.impact < 0 !== dOp < 0);
    const main = same.slice(0, 2).map(phrase).join(", ");
    headline = `${revPart} ${opPart}.${main ? ` 가장 크게 작용한 것은 ${main}입니다.` : ""}`;
    // 반대 방향으로 작용한 큰 갈래 — "매출이 줄었는데 왜 올랐나"의 나머지 절반
    const top = against[0];
    if (top && Math.abs(top.impact) >= Math.abs(dOp) * 0.1) {
      headline += ` 반대로 ${phrase(top)}는 영업이익을 ${absWon(top.impact)} ${top.impact < 0 ? "낮췄" : "높였"}습니다.`;
    }
  }

  if (moved(ct.revenue - ct.confirmedRevenue) || moved(pt.revenue - pt.confirmedRevenue)) {
    notes.push("영업이익은 확정 매출 기준입니다 — 매출(총매출)과 방향이 다를 수 있습니다.");
  }

  return {
    month: cur.month,
    prevMonth: prev.month,
    hasPrev,
    revenue: { cur: ct.revenue, prev: pt.revenue },
    operating: { cur: ct.operating, prev: pt.operating },
    items,
    headline,
    notes,
  };
}
