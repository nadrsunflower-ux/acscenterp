// ============================================================
//  손익 막대 상세 — 칸 하나(재료비·인건비…)가 무엇으로 이루어졌나
// ------------------------------------------------------------
//  월 손익의 「매장별 손익 구조」 막대에서 칸에 커서를 두면 요약이, 누르면
//  전체 내역이 뜬다 (components/neander/sales/PnlBar.tsx).
//
//  buildPnl 과 **같은 규칙**으로 다시 나눈다 — 확정 줄만 원가·수수료,
//  이벤트는 이 달에 시작한 것, 인건비 출처는 resolveStoreLabor 결과
//  (StorePnl.labor). 그래서 상세 합계가 막대·표의 숫자와 원 단위로 같다.
//  다르면 여기가 틀린 것이다 (scripts 로 전 달·전 매장을 대조했다).
// ============================================================

import { inMonth, lineFee, lineMaterial, productIndex, type StorePnl } from "./aggregate";
import { LABOR_REASON_LABEL } from "./labor";
import {
  feeRateOf,
  fixedTotal,
  idRegularLabor,
  methodLabel,
  routeLabel,
  type SalesAssumptions,
  type SalesEvent,
  type SalesLine,
  type SalesProduct,
} from "./types";

export type PnlSegmentKey =
  | "confirmed"
  | "pending"
  | "material"
  | "labor"
  | "supplies"
  | "fee"
  | "fixed"
  | "op"
  | "loss";

export interface PnlDetailRow {
  key: string;
  label: string;
  /** 산식·건수 — 한 줄 설명 */
  sub?: string;
  value: number;
  /** 영업이익 계산에서 빼는 줄 */
  sign?: "minus";
}

/** 한 칸 안의 묶음 — 인건비처럼 성격이 다른 둘을 한 칸에 묶었을 때 */
export interface PnlDetailSection {
  key: string;
  title: string;
  total: number;
  rows: PnlDetailRow[];
  basis?: string;
  people?: PnlDetailRow[];
  note?: string;
}

export interface PnlDetail {
  key: PnlSegmentKey;
  title: string;
  /** 막대의 그 칸 금액 (손실이면 음수 영업이익) */
  total: number;
  rows: PnlDetailRow[];
  /**
   * 묶음으로 나눠 보여줄 때 (rows 대신). 커서 요약에는 합계만 뜨고,
   * 창을 열어야 묶음이 보인다 — 인건비 = 이벤트·제작 인건비 + 상시 인건비.
   */
  sections?: PnlDetailSection[];
  /** 무엇을 근거로 셌나 (실측·가정·배부율 등) */
  basis?: string;
  /** 사람별 내역 (상시 인건비 실측) */
  people?: PnlDetailRow[];
  note?: string;
}

export interface PnlDetailContext {
  month: string;
  lines: SalesLine[];
  products: SalesProduct[];
  events: SalesEvent[];
  assumptions: SalesAssumptions;
}

const won = (n: number) => Math.round(n).toLocaleString("ko-KR");
const pctText = (r: number) => `${(r * 100).toFixed(r !== 0 && Math.abs(r) < 0.1 ? 2 : 1)}%`;
const hoursText = (h: number) => (Number.isInteger(h) ? h.toLocaleString("ko-KR") : h.toFixed(1));

/** 같은 key 끼리 더해 큰 순으로 */
function grouped(
  items: { key: string; label: string; value: number; qty?: number }[],
): PnlDetailRow[] {
  const m = new Map<string, { label: string; value: number; qty: number; count: number }>();
  items.forEach((i) => {
    const g = m.get(i.key) ?? { label: i.label, value: 0, qty: 0, count: 0 };
    g.value += i.value;
    g.qty += i.qty ?? 0;
    g.count += 1;
    m.set(i.key, g);
  });
  return [...m.entries()]
    .map(([key, g]) => ({
      key,
      label: g.label,
      value: g.value,
      sub:
        g.qty > 0
          ? `${g.qty.toLocaleString("ko-KR")}개 · ${g.count.toLocaleString("ko-KR")}건`
          : `${g.count.toLocaleString("ko-KR")}건`,
    }))
    .filter((r) => r.value !== 0)
    .sort((a, b) => b.value - a.value);
}

export function pnlSegmentDetail(key: PnlSegmentKey, s: StorePnl, ctx: PnlDetailContext): PnlDetail {
  const { month, lines, products, events, assumptions: a } = ctx;
  const idx = productIndex(products);
  const productName = (id?: string) => {
    const p = id ? idx.get(id) : undefined;
    return p ? `${p.name} ${p.option}` : undefined;
  };
  const ls = lines.filter((l) => l.store === s.store && inMonth(l.date, month));
  // buildPnl 과 같다 — 미확정(needs_review)만 빼면 원가·수수료 계산에 들어간다
  const confirmed = ls.filter((l) => l.status !== "needs_review");
  const evs = events.filter((e) => e.store === s.store && inMonth(e.from, month));
  const v = s.variable;

  /** 이벤트·제작(·접객) 인건비 — 판매·행사에 따라 움직이는 몫 (공헌이익 위) */
  function variableLabor(): PnlDetailSection {
    const L = s.labor;
    const rows: PnlDetailRow[] = evs
      .filter((e) => (L.eventLabor[e.id] ?? 0) !== 0)
      .map((e) => ({
        key: `event:${e.id}`,
        label: e.name,
        value: L.eventLabor[e.id],
        sub:
          L.source === "actual"
            ? "근무 일지 — 그날 근무를 열린 이벤트에 똑같이 나눈 몫"
            : `스태프 ${e.staff}명 × 하루 ${e.hoursPerDay}시간 × 시급 ${won(e.wage ?? a.wage.eventStaff)}원`,
      }))
      .sort((x, y) => y.value - x.value);
    const make = grouped(
      confirmed.flatMap((l) => {
        const p = l.productId ? idx.get(l.productId) : undefined;
        if (!p || !p.makeMin) return [];
        return [
          {
            key: `make:${p.id}`,
            label: `제작 · ${p.name} ${p.option}`,
            value: (p.makeMin / 60) * l.qty * a.wage.puddi,
            qty: l.qty,
          },
        ];
      }),
    ).map((r) => ({ ...r, sub: `${r.sub} · 개당 제작 시간 × 시급 ${won(a.wage.puddi)}원` }));
    rows.push(...make);
    if (v.serviceLabor > 0) {
      rows.push({
        key: "service",
        label: "접객 인건비 (엑셀 재현 모드)",
        value: v.serviceLabor,
        sub: `상품별 접객 시간 × 시급 ${won(a.wage.idRegular)}원`,
      });
    }
    return {
      key: "variable",
      title: "이벤트·제작 인건비",
      total: v.eventLabor + v.makeLabor + v.serviceLabor,
      rows,
      basis: `이벤트 인건비 ${LABOR_REASON_LABEL[L.reason]}`,
    };
  }

  /** 상시 인건비 — 매장을 지키는 고정비 (공헌이익 아래) */
  function regularLabor(): PnlDetailSection {
    const L = s.labor;
    const A = L.actual;
    if (A) {
      const rows: PnlDetailRow[] = [
        { key: "paid", label: "알바 실지급", value: A.paid, sub: `근무 ${hoursText(A.hours - A.staffHours)}시간` },
        { key: "holiday", label: "주휴수당", value: A.holiday },
        {
          key: "staff",
          label: "정직원 근무 환산",
          value: A.staffEquivalent,
          sub: `${hoursText(A.staffHours)}시간 × 가정 시급 ${won(A.staffWage)}원 — 실제로 나간 돈은 아닙니다`,
        },
      ].filter((r) => r.value !== 0);
      if (A.eventShare > 0) {
        rows.push({
          key: "eventShare",
          label: "이벤트 인건비로 나눈 몫",
          value: A.eventShare,
          sign: "minus",
          sub: "이벤트가 열린 날의 근무 — 위 「이벤트·제작 인건비」에 들어갔습니다",
        });
      }
      return {
        key: "regular",
        title: "상시 인건비",
        total: s.regularLabor,
        rows,
        basis: `${LABOR_REASON_LABEL[L.reason]} · 근무 ${A.shifts.toLocaleString("ko-KR")}건 · ${A.recordDays}일`,
        people: A.employees
          .map((emp) => ({
            key: emp.id,
            label: `${emp.name}${emp.staff ? " (정직원)" : ""}${emp.unknown ? " (직원 명단에 없음)" : ""}`,
            value: emp.paid + emp.holiday + emp.staffHours * A.staffWage,
            sub: `${hoursText(emp.hours)}시간`,
          }))
          .sort((x, y) => y.value - x.value),
        note:
          A.eventShare > 0
            ? "직원별 금액은 이 달 근무 전부입니다 — 이벤트 날 근무도 들어 있어 합이 상시 인건비보다 큽니다."
            : undefined,
      };
    }
    return {
      key: "regular",
      title: "상시 인건비",
      total: s.regularLabor,
      rows:
        s.regularLabor > 0 && s.store === "id"
          ? [
              {
                key: "assumed",
                label: "상시 운영 (가정)",
                value: idRegularLabor(a),
                sub: `하루 ${a.idOps.hoursPerDay}시간 × ${a.idOps.daysPerMonth}일 × 시급 ${won(a.wage.idRegular)}원`,
              },
            ]
          : [],
      basis: LABOR_REASON_LABEL[L.reason],
    };
  }

  switch (key) {
    case "confirmed":
      return {
        key,
        title: "확정 매출",
        total: s.confirmedRevenue,
        rows: grouped(
          confirmed.map((l) => {
            const name = productName(l.productId);
            return {
              key: name ? `p:${l.productId}` : "manual",
              label: name ?? "직접입력 (상품 없음)",
              value: l.amount,
              qty: name ? l.qty : 0,
            };
          }),
        ),
        basis: "상품이 정해진 판매 — 이익률의 분모",
      };

    case "pending":
      return {
        key,
        title: "미확정",
        total: s.pendingRevenue,
        rows: grouped(
          ls
            .filter((l) => l.status === "needs_review")
            .map((l) => ({ key: `raw:${l.raw}`, label: l.raw || "(내역 없음)", value: l.amount })),
        ),
        basis: "상품을 못 정한 판매 — 원가를 몰라 손익에서 뺐다",
        note: "검토 대기함에서 상품을 정하면 확정 매출로 옮겨 가고 원가도 잡힙니다.",
      };

    case "material":
      return {
        key,
        title: "재료비",
        total: v.material,
        rows: grouped(
          confirmed.map((l) => {
            const name = productName(l.productId);
            return {
              key: name ? `p:${l.productId}` : "manual",
              label: name ?? "직접입력 원가",
              value: lineMaterial(l, idx),
              qty: name ? l.qty : 0,
            };
          }),
        ),
        basis: "상품 마스터의 재료비 × 수량 (그 판매 날짜 기준 값)",
      };

    case "labor": {
      const variable = variableLabor();
      const regular = regularLabor();
      return {
        key,
        title: "인건비",
        total: variable.total + regular.total,
        rows: [],
        sections: [variable, regular].filter((x) => x.total !== 0 || x.rows.length > 0),
        note:
          "이벤트·제작 인건비는 판매·행사에 따라 늘고 줄고, 상시 인건비는 매장을 지키는 고정비입니다. 막대에서는 하나로 묶었습니다.",
      };
    }

    case "supplies":
      return {
        key,
        title: "준비물",
        total: v.supplies,
        rows: evs
          .filter((e) => e.supplies > 0)
          .map((e) => ({ key: `event:${e.id}`, label: e.name, value: e.supplies, sub: `${e.from} ~ ${e.to}` }))
          .sort((x, y) => y.value - x.value),
        basis: "이 달에 시작한 이벤트의 준비물 — 판매 확정 여부와 무관하게 전액",
      };

    case "fee": {
      const m = new Map<string, { label: string; amount: number; fee: number; rate: number; count: number }>();
      confirmed.forEach((l) => {
        const k = `${l.route}|${l.payMethod ?? ""}`;
        const g =
          m.get(k) ??
          {
            label: `${routeLabel(l.route)}${l.payMethod ? ` · ${methodLabel(l.payMethod)}` : ""}`,
            amount: 0,
            fee: 0,
            rate: feeRateOf(l.route, a.fee, l.payMethod),
            count: 0,
          };
        g.amount += l.amount;
        g.fee += lineFee(l, a);
        g.count += 1;
        m.set(k, g);
      });
      return {
        key,
        title: "수수료",
        total: v.fee,
        rows: [...m.entries()]
          .map(([k, g]) => ({
            key: k,
            label: g.label,
            value: g.fee,
            sub: `결제 ${won(g.amount)}원 × ${pctText(g.rate)} · ${g.count.toLocaleString("ko-KR")}건`,
          }))
          .filter((r) => r.value !== 0)
          .sort((x, y) => y.value - x.value),
        basis: "경로·결제수단별 요율 — 마스터 › 결제 수수료율",
      };
    }

    case "fixed": {
      const alloc = a.allocation[s.store] ?? 0;
      const items = [
        ["rent", "임대료"],
        ["utility", "전기·수도·가스"],
        ["telecom", "통신비"],
        ["insurance", "보험료"],
        ["etc", "기타"],
      ] as const;
      return {
        key,
        title: "배부 고정비",
        total: s.allocatedFixed,
        rows: items
          .map(([k, label]) => ({
            key: k,
            label,
            value: a.fixed[k] * alloc,
            sub: `월 ${won(a.fixed[k])}원 × 배부 ${pctText(alloc)}`,
          }))
          .filter((r) => r.value !== 0),
        basis: `공통 고정비 월 ${won(fixedTotal(a))}원 중 ${pctText(alloc)}`,
        note: "배부 비율은 사실이 아니라 경영 판단입니다 — 마스터 › 기본가정에서 바꿉니다.",
      };
    }

    case "op":
    case "loss":
      return {
        key,
        title: key === "loss" ? "손실" : "영업이익",
        total: s.operating,
        rows: [
          { key: "rev", label: "확정 매출", value: s.confirmedRevenue },
          { key: "material", label: "재료비", value: v.material, sign: "minus" },
          {
            key: "labor",
            label: "인건비",
            value: v.eventLabor + v.makeLabor + v.serviceLabor + s.regularLabor,
            sign: "minus",
            sub: "이벤트·제작 + 상시 — 「인건비」 칸을 누르면 나눠 봅니다",
          },
          { key: "supplies", label: "준비물", value: v.supplies, sign: "minus" },
          { key: "fee", label: "수수료", value: v.fee, sign: "minus" },
          { key: "fixed", label: "배부 고정비", value: s.allocatedFixed, sign: "minus" },
        ],
        basis:
          s.operatingRate === null ? "확정 매출 기준" : `확정 매출 기준 · 영업이익률 ${pctText(s.operatingRate)}`,
        note:
          s.pendingRevenue > 0
            ? `미확정 ${won(s.pendingRevenue)}원은 원가를 몰라 넣지 않았습니다.`
            : undefined,
      };
  }
}
