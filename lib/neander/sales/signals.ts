// ============================================================
//  매출 월간 신호 — 보고 슬라이드에 붙일 "평소와 다르거나 돈이 걸린 사실"
// ------------------------------------------------------------
//  계약은 lib/neander/insights/types.ts. 여기서는 **숫자를 새로 계산하지 않는다.**
//  손익·이벤트·상품·추이는 전부 aggregate.ts 의 집계 함수(buildPnl ·
//  buildEventPerf · buildProductPerf · monthlyTrend)와 pnl-explain.ts 에서
//  받아, 비교하고 줄 세우고 문장으로 옮기기만 한다. 그래야 신호의 숫자가
//  슬라이드·월 손익 화면과 원 단위로 맞는다 — AI 해설은 이 숫자만 인용한다.
//
//  신호 갈래 (id = `topic:대상`, 슬라이드 장 이름은 chapter)
//    operating-bridge     영업이익 전월 대비 — 가장 크게 움직인 갈래     월별 추이
//    event-efficiency     이벤트 일당 공헌이익 순위 · 상·하위 격차       이벤트별 손익
//    bep-headroom         확정 매출 vs 손익분기 매출                    매장별 손익
//    labor-productivity   근무시간당 매출·공헌이익 (실측 달만)           매장별 손익
//    product-mix          고이익률 상품 비중 · 저이익률 상품 수량 증가 · 가격 변경  상위 상품
//    weekday-pattern      요일별 하루 평균 매출                        매장별 손익
//    data-reliability     미확정 매출 · 추정 인건비 · 전월 자료 없음      핵심 요약
//    trend-streak         영업이익 3개월 연속 증감                     월별 추이
//
//  impact(월 영향 추정)는 **근거가 있는 것만** 채운다 — 음수 공헌이익(실제로
//  샌 돈), 상·하위 이벤트 격차 × 일수, 근무시간 × 시간당 공헌이익 감소분,
//  가격 변경 뒤 판매 수량 × 개당 마진 변화. 나머지는 비운다.
//
//  순수 함수 — React 없음. 서버 라우트와 화면이 같은 함수를 부른다.
// ============================================================

import {
  availableMonths,
  buildEventPerf,
  buildPnl,
  buildProductPerf,
  inMonth,
  monthlyTrend,
  type SalesPnl,
  type StorePnl,
} from "./aggregate";
import { LABOR_REASON_LABEL, type LaborContext } from "./labor";
import { explainOperatingChange } from "./pnl-explain";
import {
  storeLabel,
  type SalesAssumptions,
  type SalesEvent,
  type SalesLine,
  type SalesProduct,
  type SalesStore,
} from "./types";
import { addDays, shiftMonth, shortWon } from "../format";
import { sortSignals, type Signal, type SignalMetric, type SignalSeverity } from "../insights/types";

export interface SalesSignalInput {
  /** `YYYY-MM` */
  month: string;
  lines: SalesLine[];
  products: SalesProduct[];
  events: SalesEvent[];
  assumptions: SalesAssumptions;
  /** 근무 일지 실측 — 없으면 인건비는 전부 가정값 (buildPnl 과 같다) */
  labor?: LaborContext;
}

/** 신호가 너무 많으면 AI 도 사람도 못 읽는다 — 갈래마다, 그리고 전체에 상한을 둔다 */
const MAX_SIGNALS = 25;
const MAX_EVENT_SIGNALS = 6;
const MAX_PRODUCT_SIGNALS = 4;

const HREF = {
  pnl: "/neander/sales",
  reports: "/neander/sales/reports",
  events: "/neander/sales/event-entry",
  products: "/neander/sales/products",
  review: "/neander/sales/review",
} as const;

// ---- 표기 ------------------------------------------------------------------

/** shortWon 은 1만원 미만 음수의 부호를 잃는다 — 부호는 여기서 붙인다 */
const won = (n: number) => `${Math.round(n) < 0 ? "-" : ""}${shortWon(Math.abs(n))}원`;
const signedWon = (n: number) => `${Math.round(n) >= 0 ? "+" : "-"}${shortWon(Math.abs(n))}원`;
/** 0.4213 → 42.1 (metric 값) */
const pct1 = (r: number) => Math.round(r * 1000) / 10;
const pctText = (r: number | null | undefined) =>
  r === null || r === undefined || !Number.isFinite(r) ? "—" : `${pct1(r).toFixed(1)}%`;
const monthNum = (m: string) => `${Number(m.slice(5, 7))}월`;
const WEEKDAY = ["일", "월", "화", "수", "목", "금", "토"];

const m = (label: string, value: number, unit: SignalMetric["unit"]): SignalMetric => ({
  label,
  value: unit === "원" ? Math.round(value) : value,
  unit,
});

const LABOR_STORES: SalesStore[] = ["id", "wow"];
const storeOf = (p: SalesPnl, s: SalesStore): StorePnl | undefined => p.stores.find((x) => x.store === s);
const sourceText = (s: StorePnl) => (s.labor.source === "actual" ? "실측" : "추정");

/** YYYY-MM-DD → 요일 번호 (시간대 무관) */
function weekdayOf(date: string): number | null {
  const [y, mo, d] = date.split("-").map(Number);
  if (!y || !mo || !d) return null;
  return new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
}

// ============================================================

export function buildSalesSignals(input: SalesSignalInput): Signal[] {
  const { month, lines, products, events, assumptions: a, labor } = input;
  if (!/^\d{4}-\d{2}$/.test(month)) return [];

  const months = availableMonths(lines, events);
  if (!months.includes(month)) return [];

  const prevMonth = shiftMonth(month, -1);
  const hasPrev = months.includes(prevMonth);
  const pnl = buildPnl(month, lines, products, events, a, labor);
  const prev = buildPnl(prevMonth, lines, products, events, a, labor);

  const out: Signal[] = [];
  const ids = new Set<string>();
  const push = (s: Omit<Signal, "module">) => {
    // 이벤트 코드가 해를 넘겨 재사용된다 — 같은 달에 겹쳐도 id 는 겹치지 않게
    let id = s.id;
    for (let i = 2; ids.has(id); i++) id = `${s.id}#${i}`;
    ids.add(id);
    out.push({ ...s, id, module: "sales" });
  };

  operatingBridge();
  eventEfficiency();
  bepHeadroom();
  laborProductivity();
  productMix();
  weekdayPattern();
  dataReliability();
  trendStreak();

  return sortSignals(out).slice(0, MAX_SIGNALS);

  // ---- 1. 영업이익 전월 대비 -------------------------------------------------
  function operatingBridge() {
    if (!hasPrev) return; // 전월 자료 없음은 data-reliability 가 말한다
    const ex = explainOperatingChange(pnl, prev, events, true);
    const dOp = ex.operating.cur - ex.operating.prev;
    if (Math.round(dOp) === 0) return;

    const same = ex.items.filter((x) => x.impact < 0 === dOp < 0);
    const drivers = (same.length ? same : ex.items).slice(0, 2);
    const prevAbs = Math.abs(ex.operating.prev);
    const severity: SignalSeverity =
      Math.abs(dOp) >= 2_000_000 || (prevAbs > 0 && Math.abs(dOp) >= prevAbs * 0.2)
        ? "high"
        : Math.abs(dOp) >= 500_000
          ? "medium"
          : "low";

    const driverText = drivers.map((x) => `${x.label} ${signedWon(x.impact)}`).join(" · ");
    const sourceShift = LABOR_STORES.some((s) => {
      const c = storeOf(pnl, s);
      const p = storeOf(prev, s);
      return c && p && c.labor.source !== p.labor.source;
    });

    push({
      id: "operating-bridge:total",
      topic: "operating-bridge",
      severity,
      title: `영업이익 ${monthNum(prevMonth)} 대비 ${signedWon(dOp)} (${won(ex.operating.prev)} → ${won(ex.operating.cur)})${
        driverText ? ` — ${driverText}` : ""
      }`,
      detail: [
        `${monthNum(prevMonth)}과 ${monthNum(month)} 손익(buildPnl)을 갈래별로 나눈 결과입니다.`,
        ex.headline,
        sourceShift ? "인건비 기준(실측·추정)이 전월과 달라 인건비 갈래는 비교에 주의가 필요합니다." : "",
      ]
        .filter(Boolean)
        .join(" "),
      metrics: [
        m("영업이익", ex.operating.cur, "원"),
        m("전월 영업이익", ex.operating.prev, "원"),
        m("영업이익 변화", dOp, "원"),
        m("매출 변화", ex.revenue.cur - ex.revenue.prev, "원"),
        ...drivers.map((x) => m(`${x.label} 영향`, x.impact, "원")),
      ],
      chapter: "월별 추이",
      href: HREF.reports,
    });
  }

  // ---- 2. 이벤트 효율 -------------------------------------------------------
  function eventEfficiency() {
    const perfs = buildEventPerf(month, lines, products, events, a, labor)
      .filter((x) => x.days > 0)
      .sort(
        (x, y) =>
          y.contributionPerDay - x.contributionPerDay ||
          x.event.from.localeCompare(y.event.from) ||
          x.event.id.localeCompare(y.event.id),
      );
    const n = perfs.length;
    if (n === 0) return;

    // 상위(1위)·하위(꼴찌)·적자는 항상, 나머지는 자리가 남을 때만
    const picked = perfs
      .map((x, i) => ({ x, rank: i + 1 }))
      .filter(({ x, rank }) => x.contribution < 0 || rank === 1 || rank === n)
      .concat(perfs.map((x, i) => ({ x, rank: i + 1 })).filter(({ x, rank }) => !(x.contribution < 0 || rank === 1 || rank === n)))
      .slice(0, MAX_EVENT_SIGNALS)
      .sort((p, q) => p.rank - q.rank);

    picked.forEach(({ x, rank }) => {
      const e = x.event;
      const severity: SignalSeverity = x.contribution < 0 ? "high" : n >= 2 && rank === n ? "medium" : "low";
      const conv = x.conversion;
      push({
        id: `event-efficiency:${e.id}`,
        topic: "event-efficiency",
        severity,
        title: `${storeLabel(e.store)} ${e.name} 일당 공헌이익 ${won(x.contributionPerDay)} (${n}건 중 ${rank}위)`,
        detail: [
          `${e.from}~${e.to} ${x.days}일 운영, 확정 매출 ${won(x.confirmedRevenue)}에서 재료비 ${won(x.material)} · 인건비 ${won(x.labor)}(${x.laborSource === "actual" ? "실측" : "추정"}) · 준비물 ${won(x.supplies)} · 수수료 ${won(x.fee)}을 빼 공헌이익 ${won(x.contribution)}입니다.`,
          `순위는 ${monthNum(month)}에 시작한 이벤트 ${n}건의 일당 공헌이익 기준입니다.`,
          x.pendingRevenue > 0 ? `미확정 매출 ${won(x.pendingRevenue)}은 원가를 몰라 공헌이익에서 빠져 있습니다.` : "",
          conv !== null ? `구매전환율 ${pctText(conv)}.` : "",
        ]
          .filter(Boolean)
          .join(" "),
        // 적자 이벤트는 이 달에 실제로 샌 돈이다
        impact: x.contribution < 0 ? Math.round(x.contribution) : undefined,
        metrics: [
          m("운영일", x.days, "일"),
          m("매출", x.revenue, "원"),
          m("확정 매출", x.confirmedRevenue, "원"),
          m("준비물", x.supplies, "원"),
          m("인건비", x.labor, "원"),
          m("공헌이익", x.contribution, "원"),
          m("일당 공헌이익", x.contributionPerDay, "원"),
          ...(conv !== null ? [m("구매전환율", pct1(conv), "%")] : []),
        ],
        chapter: "이벤트별 손익",
        href: HREF.events,
      });
    });

    if (n < 2) return;
    const best = perfs[0];
    const worst = perfs[n - 1];
    const perDays = perfs.map((x) => x.contributionPerDay).sort((p, q) => p - q);
    const median = n % 2 ? perDays[(n - 1) / 2] : (perDays[n / 2 - 1] + perDays[n / 2]) / 2;
    const gap = best.contributionPerDay - worst.contributionPerDay;
    const below = worst.contributionPerDay < median;
    const impact = below && gap > 0 ? Math.round(gap * worst.days) : undefined;

    push({
      id: "event-efficiency:summary",
      topic: "event-efficiency",
      severity: impact ? "medium" : "low",
      title: `이벤트 일당 공헌이익 격차 ${won(gap)} — ${best.event.name} ${won(best.contributionPerDay)} vs ${worst.event.name} ${won(worst.contributionPerDay)}`,
      detail: [
        `${monthNum(month)}에 시작한 이벤트 ${n}건 중 일당 공헌이익 최상위와 최하위를 비교했습니다 (중앙값 ${won(median)}).`,
        impact
          ? `같은 일수(${worst.days}일)를 상위 행사 수준으로 운영했다면 공헌이익이 약 ${won(impact)} 더 났을 것이라는 추정입니다 — 행사 성격·장소 차이는 반영하지 않았습니다.`
          : "최하위 이벤트가 중앙값 아래가 아니어서 영향은 추정하지 않았습니다.",
      ].join(" "),
      impact,
      metrics: [
        m("상위 일당 공헌이익", best.contributionPerDay, "원"),
        m("하위 일당 공헌이익", worst.contributionPerDay, "원"),
        m("중앙값", median, "원"),
        m("하위 운영일", worst.days, "일"),
        m("이벤트 수", n, "건"),
      ],
      chapter: "이벤트별 손익",
      href: HREF.events,
    });
  }

  // ---- 3. 손익분기 여유 -----------------------------------------------------
  function bepHeadroom() {
    type Row = {
      key: string;
      label: string;
      confirmedRevenue: number;
      pendingRevenue: number;
      contribution: number;
      contributionRate: number | null;
      fixedTotal: number;
      operating: number;
      bep: number | null;
      bepAchieved: number | null;
      isStore: boolean;
    };
    const rows: Row[] = [
      ...pnl.stores
        .filter((s) => s.fixedTotal > 0 && (s.revenue > 0 || s.count > 0 || s.labor.eventLaborTotal > 0))
        .map((s) => ({ ...s, key: s.store, label: storeLabel(s.store), isStore: true })),
      { ...pnl.total, key: "total", label: "전체", isStore: false },
    ];

    rows.forEach((r) => {
      if (r.fixedTotal <= 0) return;
      const base = {
        topic: "bep-headroom",
        chapter: "매장별 손익",
        href: HREF.pnl,
      };
      if (r.bep === null || r.bepAchieved === null) {
        if (r.confirmedRevenue <= 0) return;
        push({
          ...base,
          id: `bep-headroom:${r.key}`,
          severity: "high",
          title: `${r.label} 공헌이익 ${won(r.contribution)} — 매출을 늘려도 손익분기에 닿지 않음`,
          detail: `확정 매출 ${won(r.confirmedRevenue)}보다 변동비가 커서 공헌이익률이 ${pctText(r.contributionRate)}입니다. 공헌이익률이 0 이하면 손익분기 매출을 계산할 수 없어, 고정비 ${won(r.fixedTotal)}을 덮으려면 가격·원가 구조부터 봐야 합니다.`,
          impact: r.isStore ? Math.round(r.operating) : undefined,
          metrics: [
            m("확정 매출", r.confirmedRevenue, "원"),
            m("공헌이익", r.contribution, "원"),
            m("고정비", r.fixedTotal, "원"),
            m("영업이익", r.operating, "원"),
          ],
        });
        return;
      }
      const gap = r.bep - r.confirmedRevenue;
      const short = r.bepAchieved < 1;
      // 공헌이익률이 아주 낮으면 손익분기 매출이 수억·수십억으로 튄다. 맞는 계산이지만
      // 「12억 더 팔자」는 행동이 아니다 — 달성률 20% 미만이면 매출이 아니라 구조 문제로 말한다
      const unrealistic = short && r.bepAchieved < 0.2;
      const severity: SignalSeverity = short ? "high" : r.bepAchieved < 1.1 ? "medium" : "low";
      push({
        ...base,
        id: `bep-headroom:${r.key}`,
        severity,
        title: unrealistic
          ? `${r.label} 공헌이익률 ${pctText(r.contributionRate)} — 고정비 ${won(r.fixedTotal)}을 매출로 덮기 어려운 구조`
          : short
            ? `${r.label} 손익분기까지 확정 매출 ${won(gap)} 부족 (달성률 ${pctText(r.bepAchieved)})`
            : `${r.label} 손익분기 대비 확정 매출 ${won(-gap)} 여유 (달성률 ${pctText(r.bepAchieved)})`,
        detail: [
          `손익분기 매출 ${won(r.bep)} = 고정비 ${won(r.fixedTotal)} ÷ 공헌이익률 ${pctText(r.contributionRate)}이고, 확정 매출은 ${won(r.confirmedRevenue)}입니다.`,
          unrealistic
            ? `확정 매출의 ${pctText(r.bepAchieved)}만 채운 상태라 매출만 늘려서는 닿기 어렵습니다 — 변동비(재료비·인건비·준비물)를 줄이거나 가격을 올려 공헌이익률부터 높여야 합니다.`
            : short
              ? `같은 공헌이익률로 ${won(gap)}을 더 팔아야 영업이익이 0 이 됩니다.`
              : `확정 매출이 ${won(-gap)} 줄어도 영업이익은 0 이상입니다.`,
          r.pendingRevenue > 0
            ? `미확정 매출 ${won(r.pendingRevenue)}은 원가를 몰라 확정 매출에 넣지 않았습니다${short && r.pendingRevenue >= gap ? " — 확정되면 부족분을 덮을 수 있는 금액입니다" : ""}.`
            : "",
        ]
          .filter(Boolean)
          .join(" "),
        // 부족분 × 공헌이익률 = 영업손실. 매장 단위만 (전체는 매장 합이라 겹친다)
        impact: short && r.isStore ? Math.round(r.operating) : undefined,
        metrics: [
          m("확정 매출", r.confirmedRevenue, "원"),
          m("손익분기 매출", r.bep, "원"),
          m("달성률", pct1(r.bepAchieved), "%"),
          m(short ? "부족분" : "여유", Math.abs(gap), "원"),
          m("공헌이익률", r.contributionRate === null ? 0 : pct1(r.contributionRate), "%"),
          m("고정비", r.fixedTotal, "원"),
        ],
      });
    });
  }

  // ---- 4. 근무시간당 생산성 --------------------------------------------------
  function laborProductivity() {
    LABOR_STORES.forEach((store) => {
      const s = storeOf(pnl, store);
      if (!s) return;
      const act = s.labor.actual;

      if (s.labor.source !== "actual" || !act || act.hours <= 0) {
        const laborCost = s.regularLabor + s.labor.eventLaborTotal;
        if (laborCost <= 0) return;
        push({
          id: `labor-productivity:${store}`,
          topic: "labor-productivity",
          severity: "low",
          title: `${storeLabel(store)} 근무시간당 생산성 계산 불가 — 인건비 ${won(laborCost)}이 추정값`,
          detail: `${LABOR_REASON_LABEL[s.labor.reason]}. 근무 일지 실측이 있어야 근무시간당 매출·공헌이익을 전월과 비교할 수 있습니다.`,
          metrics: [m("추정 인건비", laborCost, "원")],
          chapter: "매장별 손익",
          href: HREF.pnl,
        });
        return;
      }

      const revPerHour = s.revenue / act.hours;
      const contribPerHour = s.contribution / act.hours;
      const p = storeOf(prev, store);
      const pAct = hasPrev && p?.labor.source === "actual" ? p.labor.actual : undefined;
      const metrics: SignalMetric[] = [
        m("근무시간", Math.round(act.hours * 10) / 10, "시간"),
        m("인건비(실측)", act.total, "원"),
        m("시간당 매출", revPerHour, "원"),
        m("시간당 공헌이익", contribPerHour, "원"),
      ];

      if (!pAct || pAct.hours <= 0 || !p) {
        push({
          id: `labor-productivity:${store}`,
          topic: "labor-productivity",
          severity: "low",
          title: `${storeLabel(store)} 근무시간당 매출 ${won(revPerHour)} · 공헌이익 ${won(contribPerHour)} (${Math.round(act.hours)}시간)`,
          detail: `근무 일지 실측 ${Math.round(act.hours)}시간으로 매출 ${won(s.revenue)}과 공헌이익 ${won(s.contribution)}을 나눈 값입니다. ${monthNum(prevMonth)}은 실측이 없어 전월과 비교하지 않았습니다.`,
          metrics,
          chapter: "매장별 손익",
          href: HREF.pnl,
        });
        return;
      }

      const pRev = p.revenue / pAct.hours;
      const pContrib = p.contribution / pAct.hours;
      // 변화율은 전월 값이 양수일 때만 뜻이 있다 (음수에서 음수로의 % 는 부호가 뒤집혀 읽힌다)
      const revChg = pRev > 0 ? (revPerHour - pRev) / pRev : null;
      const contribChg = pContrib > 0 ? (contribPerHour - pContrib) / pContrib : null;
      const worst = Math.min(revChg ?? 0, contribChg ?? 0);
      // 전월부터 시간당 공헌이익이 0 이하였다면 비율 대신 "더 나빠졌나"로 본다
      const negWorse = pContrib <= 0 && contribPerHour < pContrib;
      const severity: SignalSeverity =
        worst <= -0.3 || (negWorse && contribPerHour < 0) ? "high" : worst <= -0.15 || negWorse ? "medium" : "low";
      // 같은 근무시간을 전월 생산성으로 운영했다면 — 시간당 공헌이익이 15% 이상(또는 음수에서 더) 떨어졌을 때만
      const impact =
        (contribChg !== null && contribChg <= -0.15) || negWorse
          ? Math.round((contribPerHour - pContrib) * act.hours)
          : undefined;

      push({
        id: `labor-productivity:${store}`,
        topic: "labor-productivity",
        severity,
        title: `${storeLabel(store)} 근무시간당 공헌이익 ${won(contribPerHour)} (${monthNum(prevMonth)} ${won(pContrib)}${
          contribChg !== null ? ` · ${contribChg >= 0 ? "+" : ""}${pctText(contribChg)}` : ""
        })`,
        detail: [
          `근무 일지 실측 기준: 이번 달 ${Math.round(act.hours)}시간에 매출 ${won(s.revenue)} · 공헌이익 ${won(s.contribution)}, ${monthNum(prevMonth)}은 ${Math.round(pAct.hours)}시간에 매출 ${won(p.revenue)} · 공헌이익 ${won(p.contribution)}입니다.`,
          `시간당 매출은 ${won(pRev)} → ${won(revPerHour)}${revChg !== null ? ` (${revChg >= 0 ? "+" : ""}${pctText(revChg)})` : ""}입니다.`,
          impact !== undefined
            ? `이번 달 근무시간을 전월 시간당 공헌이익으로 운영했다면 약 ${won(-impact)} 더 남았을 것이라는 추정입니다.`
            : "",
        ]
          .filter(Boolean)
          .join(" "),
        impact,
        metrics: [
          ...metrics,
          m("전월 근무시간", Math.round(pAct.hours * 10) / 10, "시간"),
          m("전월 시간당 매출", pRev, "원"),
          m("전월 시간당 공헌이익", pContrib, "원"),
        ],
        chapter: "매장별 손익",
        href: HREF.pnl,
      });
    });
  }

  // ---- 5. 상품 구성 ---------------------------------------------------------
  function productMix() {
    const cur = buildProductPerf(month, lines, products, a).filter((x) => x.revenue > 0 && x.contributionRate !== null);
    const prv = hasPrev ? buildProductPerf(prevMonth, lines, products, a) : [];
    const n = cur.length;
    if (n < 3) return;
    let emitted = 0;

    const byRate = [...cur].sort(
      (x, y) => (y.contributionRate ?? 0) - (x.contributionRate ?? 0) || x.product.id.localeCompare(y.product.id),
    );
    const k = Math.max(1, Math.min(3, Math.floor(n / 3)));
    const top = byRate.slice(0, k);
    const bottom = byRate.slice(n - k);
    const topIds = new Set(top.map((x) => x.product.id));
    const curTotal = cur.reduce((s, x) => s + x.revenue, 0);
    const prvTotal = prv.reduce((s, x) => s + x.revenue, 0);
    const name = (p: SalesProduct) => `${p.name}${p.option ? ` ${p.option}` : ""}`;

    // (a) 고이익률 상품 비중
    if (curTotal > 0 && prvTotal > 0) {
      const curShare = top.reduce((s, x) => s + x.revenue, 0) / curTotal;
      const prvShare = prv.filter((x) => topIds.has(x.product.id)).reduce((s, x) => s + x.revenue, 0) / prvTotal;
      const d = curShare - prvShare;
      push({
        id: "product-mix:top-rate-share",
        topic: "product-mix",
        severity: d <= -0.05 ? "medium" : "low",
        title: `공헌이익률 상위 ${k}개 상품 매출 비중 ${pctText(curShare)} (${monthNum(prevMonth)} ${pctText(prvShare)})`,
        detail: `이번 달 공헌이익률 상위 ${k}개(${top.map((x) => `${name(x.product)} ${pctText(x.contributionRate)}`).join(" · ")})가 확정된 상품 매출에서 차지하는 비중을 전월 같은 상품과 비교했습니다. 비중이 ${Math.abs(pct1(d)).toFixed(1)}%p ${d < 0 ? "줄어 같은 매출에서 남는 몫이 작아지는 방향" : "늘어 같은 매출에서 남는 몫이 커지는 방향"}입니다.`,
        metrics: [
          m("이번 달 비중", pct1(curShare), "%"),
          m("전월 비중", pct1(prvShare), "%"),
          m("비중 변화(%p)", pct1(d), "%"),
          m("상품 매출", curTotal, "원"),
        ],
        chapter: "상위 상품",
        href: HREF.products,
      });
      emitted++;
    }

    // (b) 이익률 하위인데 수량이 늘어난 상품
    const prvQty = new Map(prv.map((x) => [x.product.id, x.qty]));
    bottom
      .filter((x) => !topIds.has(x.product.id))
      .forEach((x) => {
        if (emitted >= MAX_PRODUCT_SIGNALS) return;
        const pq = prvQty.get(x.product.id) ?? 0;
        if (pq <= 0 || x.qty < pq * 1.2 || x.qty - pq < 2) return;
        push({
          id: `product-mix:low-rate-rising:${x.product.id}`,
          topic: "product-mix",
          severity: "medium",
          title: `${name(x.product)} 판매 ${pq}→${x.qty}개 — 공헌이익률 ${pctText(x.contributionRate)}로 하위`,
          detail: `이번 달 확정 판매 상품 ${n}종 중 공헌이익률 하위 ${k}개에 드는데 수량은 ${monthNum(prevMonth)}보다 ${x.qty - pq}개 늘었습니다. 개당 공헌이익은 ${won(x.unitContribution)}이라 판매가 이 상품으로 쏠리면 매출보다 이익이 덜 늡니다.`,
          metrics: [
            m("수량", x.qty, "개"),
            m("전월 수량", pq, "개"),
            m("매출", x.revenue, "원"),
            m("공헌이익률", pct1(x.contributionRate ?? 0), "%"),
            m("개당 공헌이익", x.unitContribution, "원"),
          ],
          chapter: "상위 상품",
          href: HREF.products,
        });
        emitted++;
      });

    // (c) 최근 두 달 안의 가격 변경 — 변경 뒤 판매 수량 × 개당 마진 변화
    const windowStart = `${shiftMonth(month, -2)}-01`;
    const monthEnd = `${month}-31`;
    cur
      .slice()
      .sort((x, y) => y.revenue - x.revenue || x.product.id.localeCompare(y.product.id))
      .forEach((x) => {
        if (emitted >= MAX_PRODUCT_SIGNALS) return;
        const p = x.product;
        const hist = p.history ?? [];
        // 창 안의 가장 최근 변경 하나
        let idx = -1;
        let effective = "";
        for (let i = 0; i < hist.length; i++) {
          const eff = addDays(hist[i].until, 1);
          const next = hist[i + 1] ?? { price: p.price, material: p.material };
          if (eff >= windowStart && eff <= monthEnd && next.price !== hist[i].price) {
            idx = i;
            effective = eff;
          }
        }
        if (idx < 0) return;
        const old = hist[idx];
        const nextPeriod = hist[idx + 1];
        const neo = nextPeriod ?? { price: p.price, material: p.material };
        const qtyAfter = lines
          .filter(
            (l) =>
              inMonth(l.date, month) &&
              l.status === "resolved" &&
              l.productId === p.id &&
              l.date > old.until &&
              (!nextPeriod || l.date <= nextPeriod.until),
          )
          .reduce((s, l) => s + l.qty, 0);
        if (qtyAfter <= 0) return;
        const unitDelta = neo.price - neo.material - (old.price - old.material);
        const impact = Math.round(qtyAfter * unitDelta);
        push({
          id: `product-mix:price-change:${p.id}`,
          topic: "product-mix",
          severity: neo.price < old.price ? "medium" : "low",
          title: `${name(p)} 가격 ${won(old.price)} → ${won(neo.price)} (${effective}부터) · 변경 후 ${qtyAfter}개 판매`,
          detail: `상품 마스터의 가격 구간이 ${effective}에 바뀌었습니다 (재료비 ${won(old.material)} → ${won(neo.material)}). 이번 달 변경 후 판매 ${qtyAfter}개를 옛 가격·재료비로 팔았을 때와 비교하면 개당 마진이 ${signedWon(unitDelta)}, 합계 ${signedWon(impact)}입니다 — 수수료와 수량 변화는 반영하지 않은 추정입니다.`,
          impact: impact || undefined,
          metrics: [
            m("이전 가격", old.price, "원"),
            m("현재 가격", neo.price, "원"),
            m("변경 후 판매", qtyAfter, "개"),
            m("개당 마진 변화", unitDelta, "원"),
          ],
          chapter: "상위 상품",
          href: HREF.products,
        });
        emitted++;
      });
  }

  // ---- 6. 요일 패턴 ---------------------------------------------------------
  function weekdayPattern() {
    (["id", "wow"] as SalesStore[]).forEach((store) => {
      const byDate = new Map<string, number>();
      lines.forEach((l) => {
        if (l.store !== store || !inMonth(l.date, month)) return;
        byDate.set(l.date, (byDate.get(l.date) ?? 0) + l.amount);
      });
      if (byDate.size < 8) return;

      const acc = WEEKDAY.map(() => ({ revenue: 0, days: 0 }));
      [...byDate.entries()].forEach(([date, amt]) => {
        const w = weekdayOf(date);
        if (w === null) return;
        acc[w].revenue += amt;
        acc[w].days += 1;
      });
      const rows = acc
        .map((x, w) => ({ w, ...x, avg: x.days ? x.revenue / x.days : 0 }))
        .filter((x) => x.days >= 2);
      if (rows.length < 2) return;
      const strong = rows.reduce((b, x) => (x.avg > b.avg ? x : b));
      const weak = rows.reduce((b, x) => (x.avg < b.avg ? x : b));
      if (strong.w === weak.w || weak.avg <= 0) return;
      const times = strong.avg / weak.avg;
      if (times < 1.2) return;

      push({
        id: `weekday-pattern:${store}`,
        topic: "weekday-pattern",
        severity: times >= 2 ? "medium" : "low",
        title: `${storeLabel(store)} ${WEEKDAY[strong.w]}요일 하루 평균 매출 ${won(strong.avg)} — ${WEEKDAY[weak.w]}요일(${won(weak.avg)})의 ${times.toFixed(1)}배`,
        detail: `${monthNum(month)} 판매가 있던 ${byDate.size}일의 매출(미확정 포함)을 요일별로 모아 영업일당 평균을 냈습니다. ${WEEKDAY[strong.w]}요일 ${strong.days}일 합계 ${won(strong.revenue)}, ${WEEKDAY[weak.w]}요일 ${weak.days}일 합계 ${won(weak.revenue)}이며, 영업일이 2일 이상인 요일만 비교했습니다.`,
        metrics: [
          m(`${WEEKDAY[strong.w]}요일 평균`, strong.avg, "원"),
          m(`${WEEKDAY[weak.w]}요일 평균`, weak.avg, "원"),
          m("배수", Math.round(times * 10) / 10, "배"),
          m("영업일", byDate.size, "일"),
        ],
        chapter: "매장별 손익",
      });
    });
  }

  // ---- 7. 데이터 신뢰도 -----------------------------------------------------
  function dataReliability() {
    const t = pnl.total;
    if (t.revenue > 0) {
      const share = t.pendingRevenue / t.revenue;
      if (share >= 0.05) {
        push({
          id: "data-reliability:pending",
          topic: "data-reliability",
          severity: "high",
          title: `미확정 매출 ${won(t.pendingRevenue)} (${pctText(share)}) — 이익률 계산에서 빠짐`,
          detail: `검토 대기 ${t.reviewCount}건은 상품이 정해지지 않아 원가를 알 수 없어 확정 매출·공헌이익·손익분기 계산에서 뺐습니다. 비중이 5% 이상이라 이 달의 이익률과 손익분기 달성률은 확정되면 달라질 수 있습니다.`,
          metrics: [
            m("미확정 매출", t.pendingRevenue, "원"),
            m("매출", t.revenue, "원"),
            m("비중", pct1(share), "%"),
            m("검토 대기", t.reviewCount, "건"),
          ],
          chapter: "핵심 요약",
          href: HREF.review,
        });
      }
    }

    LABOR_STORES.forEach((store) => {
      const s = storeOf(pnl, store);
      if (!s || s.labor.source !== "assumed") return;
      const laborCost = s.regularLabor + s.labor.eventLaborTotal;
      if (laborCost <= 0) return;
      push({
        id: `data-reliability:labor-${store}`,
        topic: "data-reliability",
        severity: s.labor.reason === "month_open" ? "low" : "medium",
        title: `${storeLabel(store)} 인건비 ${won(laborCost)}이 ${sourceText(s)}값`,
        detail: `${LABOR_REASON_LABEL[s.labor.reason]}. 상시 인건비 ${won(s.regularLabor)} · 이벤트 인건비 ${won(s.labor.eventLaborTotal)}이 기본가정(운영시간 × 일수 × 시급)으로 잡혀 있어 영업이익이 실제와 다를 수 있습니다.`,
        metrics: [
          m("추정 인건비", laborCost, "원"),
          m("상시 인건비", s.regularLabor, "원"),
          m("이벤트 인건비", s.labor.eventLaborTotal, "원"),
        ],
        chapter: "핵심 요약",
        href: HREF.pnl,
      });
    });

    if (!hasPrev) {
      push({
        id: "data-reliability:no-prev",
        topic: "data-reliability",
        severity: "low",
        title: `${monthNum(prevMonth)} 자료 없음 — 전월 대비 비교 불가`,
        detail: `${prevMonth}에 적재된 판매·이벤트가 없어 영업이익 변화·근무시간당 생산성·상품 비중을 전월과 비교하지 않았습니다. 적재된 가장 이른 달은 ${months[months.length - 1]}입니다.`,
        metrics: [m("적재된 달", months.length, "개")],
        chapter: "핵심 요약",
      });
    }
  }

  // ---- 8. 연속 증감 --------------------------------------------------------
  function trendStreak() {
    const trend = monthlyTrend(lines, products, events, a, labor);
    const idx = trend.findIndex((p) => p.month === month);
    if (idx < 3) return;

    const targets: { key: string; label: string; value: (i: number) => number }[] = [
      { key: "total", label: "전체", value: (i) => trend[i].total.operating },
      ...LABOR_STORES.map((s) => ({
        key: s,
        label: storeLabel(s),
        value: (i: number) => trend[i].byStore[s]?.operating ?? 0,
      })),
    ];

    targets.forEach(({ key, label, value }) => {
      let dir = 0;
      let count = 0;
      for (let j = idx; j > 0; j--) {
        if (trend[j - 1].month !== shiftMonth(trend[j].month, -1)) break;
        const d = Math.round(value(j) - value(j - 1));
        const sgn = Math.sign(d);
        if (sgn === 0 || (dir !== 0 && sgn !== dir)) break;
        dir = sgn;
        count++;
      }
      if (count < 3) return;
      const startMonth = trend[idx - count].month;
      const from = value(idx - count);
      const to = value(idx);
      const down = dir < 0;
      push({
        id: `trend-streak:${key}`,
        topic: "trend-streak",
        severity: down ? (to < 0 ? "high" : "medium") : "low",
        title: `${label} 영업이익 ${count}개월 연속 ${down ? "감소" : "증가"} (${monthNum(startMonth)} ${won(from)} → ${monthNum(month)} ${won(to)})`,
        detail: `월별 추이(달마다 buildPnl)에서 ${startMonth}부터 ${month}까지 영업이익이 매달 전월보다 ${down ? "낮았" : "높았"}습니다. 누적 변화는 ${signedWon(to - from)}입니다.`,
        metrics: [
          m("연속 개월", count, "개"),
          m("시작 달 영업이익", from, "원"),
          m("이번 달 영업이익", to, "원"),
          m("누적 변화", to - from, "원"),
        ],
        chapter: "월별 추이",
        href: HREF.reports,
      });
    });
  }
}
