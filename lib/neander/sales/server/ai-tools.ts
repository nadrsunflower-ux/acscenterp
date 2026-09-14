// ============================================================
//  매출 비서의 도구
// ------------------------------------------------------------
//  ⚠️ 이 파일의 유일한 원칙: **모델은 판매 줄을 쓰지 못한다.**
//
//  읽기 도구는 바로 실행한다 (조회는 되돌릴 게 없다).
//  쓰기는 도구가 아니라 **제안**이다 — `propose_resolve` 와 `propose_alias`
//  는 Firestore 를 건드리지 않고 "이렇게 하자"는 목록만 만든다. 사람이
//  화면에서 바뀔 내용을 보고 「적용」을 눌러야 그때 기존 저장 경로
//  (line.bulkResolve · product.upsert)로 나간다.
//
//  재무 비서(finance/server/ai-tools.ts)와 같은 구조다. 다른 것은 도메인
//  뿐이다 — 장부 거래가 아니라 판매 줄·상품·이벤트·단위경제.
// ============================================================

import {
  buildEventPerf,
  buildPnl,
  buildProductPerf,
  inMonth,
  productEconomics,
  productIndex,
} from "../aggregate";
import { resolveRow } from "../resolve";
import {
  REASON_LABEL,
  SALES_STORES,
  eventLabelOf,
  kindLabel,
  productInScope,
  routeLabel,
  storeLabel,
  valueAt,
  type SalesAssumptions,
  type SalesEvent,
  type SalesLine,
  type SalesProduct,
  type SalesStore,
} from "../types";
import { argBits } from "../../ai/agent";
import { LABOR_REASON_LABEL, type LaborActuals } from "../labor";

const ROW_LIMIT = 50;
const GROUP_LIMIT = 30;

export interface SalesToolContext {
  lines: SalesLine[];
  products: SalesProduct[];
  events: SalesEvent[];
  assumptions: SalesAssumptions;
  /** 근무 일지 실측 인건비 — 없으면 인건비는 가정값 (화면과 같은 규칙) */
  labor?: LaborActuals | null;
}

/** 사람이 승인해야 반영되는 변경 제안 */
export type SalesProposal =
  | {
      kind: "resolve";
      id: string;
      /** 대상 판매 줄 */
      ids: string[];
      productId: string;
      productLabel: string;
      /** 줄마다 적용할 수량 */
      qty: number;
      reason: string;
      before: {
        id: string;
        date: string;
        store: SalesStore;
        raw: string;
        amount: number;
        status: string;
        reason?: string;
        /** 「뉴진스4주년 (ID-027)」 — 어느 행사의 판매인지가 승인 판단에 필요하다 */
        event?: string;
      }[];
    }
  | {
      kind: "alias";
      id: string;
      productId: string;
      productLabel: string;
      alias: string;
      reason: string;
      /** 이 별칭이 잡을 미확정 줄 (미리보기) */
      matchCount: number;
      matchAmount: number;
      sampleRaw: string[];
    };

// ---- 도구 정의 (OpenAI function calling 형식) -------------------

const STORE_ENUM = SALES_STORES.map((s) => s.value);

const FILTERS = {
  month: { type: "string", description: "YYYY-MM. 그 달만" },
  dateFrom: { type: "string", description: "YYYY-MM-DD 이상" },
  dateTo: { type: "string", description: "YYYY-MM-DD 이하" },
  store: { type: "string", enum: STORE_ENUM, description: "wow=와우 · id=아이디 · online=온라인" },
  route: { type: "string", enum: ["payhere", "naver", "online"], description: "결제 경로 (현장결제·네이버예약·온라인)" },
  status: { type: "string", enum: ["resolved", "needs_review", "manual"], description: "확정 · 미확정(검토 대기) · 직접입력" },
  reason: {
    type: "string",
    enum: ["multi_item", "amount_only", "unknown_item", "price_mismatch", "refunded"],
    description: "미확정 이유",
  },
  productId: { type: "string", description: "상품코드 (IDI-001 등)" },
  eventId: { type: "string", description: "이벤트코드 (WE-053 등). 'none' 이면 이벤트 귀속 없는 상시 판매만" },
  raw: { type: "string", description: "원본 결제 내역 문자열에 이 글자가 포함된 것 (대소문자 무시)" },
  minAmount: { type: "number" },
  maxAmount: { type: "number" },
} as const;

export const SALES_TOOL_DEFS = [
  {
    type: "function" as const,
    function: {
      name: "search_sales",
      description:
        `조건에 맞는 판매 줄을 찾는다. 최대 ${ROW_LIMIT}건까지 내용을 돌려주고 전체 건수·합계는 항상 정확히 알려준다. ` +
        "건수가 많으면 summarize_sales 로 먼저 큰 그림을 보는 게 낫다. 미확정 줄을 확정하려면 이걸로 id 를 먼저 확인한다.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: { ...FILTERS, limit: { type: "number", description: `최대 ${ROW_LIMIT}` } },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "summarize_sales",
      description:
        "조건에 맞는 판매 줄을 축으로 묶어 건수·금액·수량을 낸다. '어느 매장이 얼마 팔았나', '무슨 상품이 많이 나갔나', '미확정이 왜 남았나' 에 먼저 쓴다.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["groupBy"],
        properties: {
          groupBy: {
            type: "string",
            enum: ["month", "store", "route", "product", "event", "kind", "status", "reason", "raw"],
            description: "kind=상시/이벤트 · raw=원본 결제 내역 문구",
          },
          ...FILTERS,
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_month_pnl",
      description:
        "그 달의 단위경제 손익 — 매장별 매출·확정매출·변동비(재료비·인건비·준비물·수수료)·공헌이익·고정비·영업이익·BEP. " +
        "'이번 달 남긴 게 얼마냐', '와우 공헌이익률이 왜 낮냐' 에 쓴다. 이익률의 분모는 확정 매출이다.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["month"],
        properties: { month: { type: "string", description: "YYYY-MM" } },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_event_report",
      description:
        "그 달 이벤트별 실적 — 기간·운영일수·매출·재료비·인건비·준비물·수수료·공헌이익·일당 공헌이익·구매전환율. '어느 이벤트가 잘됐나' 에 쓴다.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["month"],
        properties: {
          month: { type: "string", description: "YYYY-MM" },
          store: { type: "string", enum: STORE_ENUM },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "find_products",
      description:
        "상품 마스터를 찾는다 — 코드·이름·옵션·별칭으로. 판매가·재료비·쿠폰 할인율·과거 가격 구간이 나온다. " +
        "확정을 제안하기 전에 **반드시** 이걸로 실재하는 상품인지, 매장이 맞는지 확인한다.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          query: { type: "string", description: "이름·별칭·코드의 일부. 비우면 전부" },
          store: { type: "string", enum: STORE_ENUM },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_product_performance",
      description:
        "상품별 수익성. mode=structure 는 1개당 공헌이익(판매 실적과 무관한 구조), mode=actual 은 그 달 실제 실적(수량·매출·공헌이익). '무엇을 더 팔아야 하나' 에 쓴다.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["mode"],
        properties: {
          mode: { type: "string", enum: ["structure", "actual"] },
          month: { type: "string", description: "actual 일 때 YYYY-MM" },
          store: { type: "string", enum: STORE_ENUM },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "propose_resolve",
      description:
        "미확정 판매 줄들을 이 상품으로 확정하자고 **제안**한다. 저장되지 않는다 — 사용자가 화면에서 보고 승인해야 반영된다. " +
        "제안 전에 search_sales 로 대상 id 를, find_products 로 상품을 확인할 것. 매장이 다른 상품은 거부된다.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["ids", "productId", "reason"],
        properties: {
          ids: { type: "array", items: { type: "string" }, description: "판매 줄 id 들 (모두 같은 매장)" },
          productId: { type: "string" },
          qty: { type: "number", description: "줄마다 수량. 비우면 금액÷정가로 계산, 안 나눠지면 1" },
          reason: { type: "string", description: "왜 이 상품인지 한 문장. 사용자가 이걸 보고 승인한다" },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "propose_alias",
      description:
        "상품에 POS 별칭을 추가하자고 **제안**한다 — 같은 문구가 계속 미확정으로 쌓일 때. 저장되지 않는다. " +
        "제안 전에 find_products 로 상품을 확인하고, 그 별칭이 지금 몇 건을 잡는지는 결과에 함께 나온다.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["productId", "alias", "reason"],
        properties: {
          productId: { type: "string" },
          alias: { type: "string", description: "원본 결제 내역에 실제로 찍히는 문구 그대로" },
          reason: { type: "string" },
        },
      },
    },
  },
];

// ---- 실행 ----------------------------------------------------

type Args = Record<string, unknown>;
const s = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const won = (v: number) => Math.round(v);

function applyFilters(rows: SalesLine[], a: Args): SalesLine[] {
  const raw = s(a.raw)?.toLowerCase();
  const ev = s(a.eventId);
  return rows.filter((l) => {
    if (s(a.month) && !inMonth(l.date, s(a.month)!)) return false;
    if (s(a.dateFrom) && l.date < s(a.dateFrom)!) return false;
    if (s(a.dateTo) && l.date > s(a.dateTo)!) return false;
    if (s(a.store) && l.store !== s(a.store)) return false;
    if (s(a.route) && l.route !== s(a.route)) return false;
    if (s(a.status) && l.status !== s(a.status)) return false;
    if (s(a.reason) && l.reason !== s(a.reason)) return false;
    if (s(a.productId) && l.productId !== s(a.productId)) return false;
    if (ev === "none" ? !!l.eventId : ev && l.eventId !== ev) return false;
    if (raw && !l.raw.toLowerCase().includes(raw)) return false;
    if (n(a.minAmount) !== undefined && l.amount < n(a.minAmount)!) return false;
    if (n(a.maxAmount) !== undefined && l.amount > n(a.maxAmount)!) return false;
    return true;
  });
}

const productLabel = (p: SalesProduct | undefined) => (p ? `${p.name} ${p.option} (${p.id})` : "(미확정)");

function rowView(l: SalesLine, idx: Map<string, SalesProduct>, events: Map<string, SalesEvent>) {
  const p = l.productId ? idx.get(l.productId) : undefined;
  return {
    id: l.id,
    date: l.date,
    store: storeLabel(l.store),
    route: routeLabel(l.route),
    raw: l.raw,
    amount: l.amount,
    qty: l.status === "resolved" ? l.qty : undefined,
    product: p ? productLabel(p) : undefined,
    status: l.status,
    reason: l.reason ? REASON_LABEL[l.reason] : undefined,
    event: l.eventId ? eventLabelOf(l.eventId, events) : undefined,
  };
}

let proposalSeq = 0;

export function runSalesTool(
  name: string,
  args: Args,
  ctx: SalesToolContext,
): { result: unknown; proposal?: SalesProposal } {
  const idx = productIndex(ctx.products);
  const evIdx = new Map(ctx.events.map((e) => [e.id, e]));

  switch (name) {
    case "search_sales": {
      const hits = applyFilters(ctx.lines, args).sort((a, b) => b.date.localeCompare(a.date));
      const limit = Math.min(n(args.limit) ?? ROW_LIMIT, ROW_LIMIT);
      return {
        result: {
          count: hits.length,
          totalAmount: won(hits.reduce((x, l) => x + l.amount, 0)),
          confirmedAmount: won(hits.filter((l) => l.status !== "needs_review").reduce((x, l) => x + l.amount, 0)),
          shown: Math.min(hits.length, limit),
          truncated: hits.length > limit,
          rows: hits.slice(0, limit).map((l) => rowView(l, idx, evIdx)),
        },
      };
    }

    case "summarize_sales": {
      const hits = applyFilters(ctx.lines, args);
      const key = String(args.groupBy);
      const pick = (l: SalesLine): string => {
        switch (key) {
          case "month": return l.date.slice(0, 7);
          case "store": return storeLabel(l.store);
          case "route": return routeLabel(l.route);
          case "product": return productLabel(l.productId ? idx.get(l.productId) : undefined);
          case "event": return eventLabelOf(l.eventId, evIdx);
          case "kind": return l.eventId ? kindLabel("event") : kindLabel("regular");
          case "status": return l.status;
          case "reason": return l.reason ? REASON_LABEL[l.reason] : "(확정)";
          case "raw": return l.raw;
          default: return storeLabel(l.store);
        }
      };
      const map = new Map<string, { count: number; amount: number; qty: number }>();
      hits.forEach((l) => {
        const k = pick(l);
        const g = map.get(k) ?? { count: 0, amount: 0, qty: 0 };
        g.count += 1;
        g.amount += l.amount;
        if (l.status === "resolved") g.qty += l.qty;
        map.set(k, g);
      });
      const groups = [...map.entries()]
        .map(([k, v]) => ({ key: k, count: v.count, amount: won(v.amount), qty: v.qty }))
        .sort((a, b) => b.amount - a.amount);
      return {
        result: {
          totalCount: hits.length,
          totalAmount: won(hits.reduce((x, l) => x + l.amount, 0)),
          groupCount: groups.length,
          shown: Math.min(groups.length, GROUP_LIMIT),
          groups: groups.slice(0, GROUP_LIMIT),
        },
      };
    }

    case "get_month_pnl": {
      const month = s(args.month) ?? "";
      const pnl = buildPnl(month, ctx.lines, ctx.products, ctx.events, ctx.assumptions, { actuals: ctx.labor });
      const view = (x: (typeof pnl.stores)[number] | null) => ({
        revenue: won(x ? x.revenue : pnl.total.revenue),
        confirmedRevenue: won(x ? x.confirmedRevenue : pnl.total.confirmedRevenue),
        pendingRevenue: won(x ? x.pendingRevenue : pnl.total.pendingRevenue),
        variable: {
          material: won((x ?? pnl.total).variable.material),
          eventLabor: won((x ?? pnl.total).variable.eventLabor),
          makeLabor: won((x ?? pnl.total).variable.makeLabor),
          supplies: won((x ?? pnl.total).variable.supplies),
          fee: won((x ?? pnl.total).variable.fee),
          total: won((x ?? pnl.total).variable.total),
        },
        contribution: won((x ?? pnl.total).contribution),
        contributionRate: (x ?? pnl.total).contributionRate,
        fixed: won((x ?? pnl.total).fixedTotal),
        // 인건비가 근무 일지 실측인지 가정값(추정)인지 — 비서가 숫자를 단정하지 않게 함께 준다
        ...(x && x.store !== "online"
          ? {
              regularLabor: won(x.regularLabor),
              laborSource: x.labor.source,
              laborBasis: LABOR_REASON_LABEL[x.labor.reason],
              laborActual: x.labor.actual
                ? {
                    hours: Math.round(x.labor.actual.hours * 10) / 10,
                    partTimePaid: won(x.labor.actual.paid),
                    holidayPay: won(x.labor.actual.holiday),
                    staffHours: Math.round(x.labor.actual.staffHours * 10) / 10,
                    staffAssumedPay: won(x.labor.actual.staffEquivalent),
                    total: won(x.labor.actual.total),
                  }
                : null,
            }
          : {}),
        operating: won((x ?? pnl.total).operating),
        operatingRate: (x ?? pnl.total).operatingRate,
        bep: (x ?? pnl.total).bep,
        bepAchieved: (x ?? pnl.total).bepAchieved,
        reviewCount: (x ?? pnl.total).reviewCount,
      });
      return {
        result: {
          month,
          note:
            "이익률의 분모는 확정 매출(상품이 정해진 줄)이다. 미확정 매출은 매출 합계에는 있고 이익률 계산에서는 빠진다. " +
            "인건비는 laborSource 가 actual 이면 근무 일지 실측(저장 급여 + 주휴수당 + 정직원 근무시간 × 가정 시급 — staffAssumedPay 는 실제로 지급되지 않은 환산액), " +
            "assumed 이면 가정값이다(진행 중인 달·기록 없는 달). 아이디 근무는 regularLabor(고정비), 와우 근무는 그날 열린 이벤트의 eventLabor 로 들어간다.",
          laborMode: ctx.assumptions.laborMode,
          total: view(null),
          stores: Object.fromEntries(pnl.stores.map((st) => [storeLabel(st.store), view(st)])),
        },
      };
    }

    case "get_event_report": {
      const month = s(args.month) ?? "";
      const store = s(args.store) as SalesStore | undefined;
      const perf = buildEventPerf(month, ctx.lines, ctx.products, ctx.events, ctx.assumptions, { actuals: ctx.labor }).filter(
        (p) => !store || p.event.store === store,
      );
      return {
        result: {
          month,
          count: perf.length,
          events: perf.map((p) => ({
            id: p.event.id,
            name: p.event.name,
            store: storeLabel(p.event.store),
            period: `${p.event.from}~${p.event.to}`,
            days: p.days,
            revenue: won(p.revenue),
            confirmedRevenue: won(p.confirmedRevenue),
            material: won(p.material),
            labor: won(p.labor),
            laborSource: p.laborSource,
            supplies: won(p.supplies),
            fee: won(p.fee),
            contribution: won(p.contribution),
            contributionRate: p.contributionRate,
            contributionPerDay: p.contributionPerDay,
            conversion: p.conversion,
            buyers: p.event.buyers,
            nonBuyers: p.event.nonBuyers,
            reviewCount: p.reviewCount,
          })),
        },
      };
    }

    case "find_products": {
      const q = (s(args.query) ?? "").toLowerCase();
      const store = s(args.store);
      const hits = ctx.products.filter((p) => {
        if (store && p.store !== store) return false;
        if (!q) return true;
        return [p.id, p.name, p.option, ...(p.aliases ?? [])].join(" ").toLowerCase().includes(q);
      });
      return {
        result: {
          count: hits.length,
          products: hits.slice(0, 40).map((p) => ({
            id: p.id,
            name: p.name,
            option: p.option,
            store: storeLabel(p.store),
            kind: kindLabel(p.kind),
            price: p.price,
            material: p.material,
            bottles: p.bottles,
            discountRate: p.discountRate,
            aliases: p.aliases,
            eventIds: p.eventIds,
            scope: p.eventIds?.length
              ? `전용 — ${p.eventIds.map((id) => eventLabelOf(id, new Map(ctx.events.map((e) => [e.id, e])))).join(", ")}`
              : `공용 (${storeLabel(p.store)} 전체)`,
            history: p.history,
            note: p.note,
            unconfirmed: p.unconfirmed,
          })),
        },
      };
    }

    case "get_product_performance": {
      const store = s(args.store) as SalesStore | undefined;
      if (s(args.mode) === "actual") {
        const month = s(args.month) ?? "";
        const perf = buildProductPerf(month, ctx.lines, ctx.products, ctx.assumptions, store ? { store } : undefined);
        return {
          result: {
            mode: "actual",
            month,
            products: perf.map((p) => ({
              id: p.product.id,
              name: `${p.product.name} ${p.product.option}`,
              store: storeLabel(p.product.store),
              qty: p.qty,
              revenue: won(p.revenue),
              material: won(p.material),
              fee: won(p.fee),
              contribution: won(p.contribution),
              contributionRate: p.contributionRate,
              unitContribution: p.unitContribution,
            })),
          },
        };
      }
      const econ = productEconomics(
        ctx.products.filter((p) => !store || p.store === store),
        ctx.assumptions,
      );
      return {
        result: {
          mode: "structure",
          products: econ.map((e) => ({
            id: e.product.id,
            name: `${e.product.name} ${e.product.option}`,
            store: storeLabel(e.product.store),
            price: e.price,
            material: e.material,
            labor: won(e.labor),
            fee: e.fee,
            contribution: won(e.contribution),
            contributionRate: e.contributionRate,
          })),
        },
      };
    }

    case "propose_resolve": {
      const ids = Array.isArray(args.ids) ? args.ids.map(String) : [];
      const productId = s(args.productId) ?? "";
      const reason = s(args.reason) ?? "";
      const p = idx.get(productId);
      if (!p) {
        return { result: { ok: false, error: `상품 ${productId} 이 마스터에 없습니다. find_products 로 확인하세요.` } };
      }
      const byId = new Map(ctx.lines.map((l) => [l.id, l]));
      const targets = ids.map((id) => byId.get(id)).filter(Boolean) as SalesLine[];
      const missing = ids.filter((id) => !byId.has(id));
      if (targets.length === 0) {
        return { result: { ok: false, error: "해당 id 의 판매 줄을 찾지 못했습니다. search_sales 로 먼저 확인하세요.", missing } };
      }
      const wrongStore = targets.filter((l) => l.store !== p.store);
      if (wrongStore.length > 0) {
        return {
          result: {
            ok: false,
            error: `${wrongStore.length}건이 ${storeLabel(p.store)} 매장이 아닙니다. 매장이 다른 상품으로는 확정할 수 없습니다.`,
          },
        };
      }
      // 전용 이벤트가 지정된 상품은 그 행사의 줄에만 쓸 수 있다
      const outOfScope = targets.filter((l) => !productInScope(p, l.eventId));
      if (outOfScope.length > 0) {
        return {
          result: {
            ok: false,
            error:
              `${p.id} 는 ${(p.eventIds ?? []).map((id) => eventLabelOf(id, evIdx)).join(", ")} 전용 상품입니다. ` +
              `대상 ${outOfScope.length}건이 그 행사의 판매가 아니어서 확정할 수 없습니다 ` +
              `(예: ${outOfScope.slice(0, 3).map((l) => `${l.date} ${eventLabelOf(l.eventId, evIdx)}`).join(" · ")}).`,
          },
        };
      }
      if (!reason) return { result: { ok: false, error: "reason 이 필요합니다. 사용자가 이걸 보고 승인합니다." } };

      // 수량: 지정이 없으면 금액 ÷ 그 시점 정가. 안 나눠지면 1 (할인·복합)
      let qty = n(args.qty);
      if (qty === undefined) {
        const first = targets[0];
        const price = valueAt(p, first.date).price;
        qty = price > 0 && first.amount % price === 0 ? first.amount / price : 1;
      }

      const proposal: SalesProposal = {
        kind: "resolve",
        id: `s${++proposalSeq}-${Date.now()}`,
        ids: targets.map((l) => l.id),
        productId: p.id,
        productLabel: productLabel(p),
        qty,
        reason,
        before: targets.map((l) => ({
          id: l.id,
          date: l.date,
          store: l.store,
          raw: l.raw,
          amount: l.amount,
          status: l.status,
          reason: l.reason ? REASON_LABEL[l.reason] : undefined,
          event: l.eventId ? eventLabelOf(l.eventId, evIdx) : undefined,
        })),
      };
      return {
        proposal,
        result: {
          ok: true,
          proposed: targets.length,
          qty,
          missing: missing.length ? missing : undefined,
          note: "제안을 사용자 화면에 올렸습니다. **아직 저장되지 않았습니다** — 사용자가 승인해야 반영됩니다. 같은 내용을 다시 제안하지 마세요.",
        },
      };
    }

    case "propose_alias": {
      const productId = s(args.productId) ?? "";
      const alias = s(args.alias) ?? "";
      const reason = s(args.reason) ?? "";
      const p = idx.get(productId);
      if (!p) return { result: { ok: false, error: `상품 ${productId} 이 마스터에 없습니다.` } };
      if (!alias) return { result: { ok: false, error: "alias 가 필요합니다." } };
      if ((p.aliases ?? []).some((a) => a.toLowerCase() === alias.toLowerCase())) {
        return { result: { ok: false, error: "이미 있는 별칭입니다." } };
      }
      if (!reason) return { result: { ok: false, error: "reason 이 필요합니다." } };

      // 이 별칭을 넣었을 때 지금 미확정 중 몇 건이 확정으로 바뀌는지 미리 돈다
      const trial = { ...p, aliases: [...(p.aliases ?? []), alias] };
      const trialProducts = ctx.products.map((x) => (x.id === p.id ? trial : x));
      const pending = ctx.lines.filter((l) => l.status === "needs_review" && l.store === p.store);
      const wouldResolve = pending.filter((l) => {
        const r = resolveRow(
          { date: l.date, items: l.raw, total: l.amount },
          {
            products: trialProducts,
            events: ctx.events,
            store: l.store,
            route: l.route,
            assumptions: ctx.assumptions,
          },
        );
        return r.status === "resolved" && r.productId === p.id;
      });

      const proposal: SalesProposal = {
        kind: "alias",
        id: `a${++proposalSeq}-${Date.now()}`,
        productId: p.id,
        productLabel: productLabel(p),
        alias,
        reason,
        matchCount: wouldResolve.length,
        matchAmount: won(wouldResolve.reduce((x, l) => x + l.amount, 0)),
        sampleRaw: [...new Set(wouldResolve.map((l) => l.raw))].slice(0, 5),
      };
      return {
        proposal,
        result: {
          ok: true,
          wouldResolveNow: wouldResolve.length,
          amount: proposal.matchAmount,
          note:
            "별칭 제안을 화면에 올렸습니다. 승인되면 마스터에 저장되고 **다음 적재부터** 자동으로 잡힙니다. " +
            "이미 적재된 미확정 줄은 별칭만으로는 바뀌지 않으니, 지금 것을 확정하려면 propose_resolve 도 함께 쓰세요.",
        },
      };
    }

    default:
      return { result: { ok: false, error: `알 수 없는 도구: ${name}` } };
  }
}

/** 화면에 "무엇을 조회했는지" 한 줄 */
export function summarizeSalesTool(name: string, a: Args, result: unknown): string {
  const r = result as Record<string, unknown> | undefined;
  const bits = argBits(a);
  switch (name) {
    case "search_sales": return `판매 조회 ${bits} → ${r?.count ?? 0}건`;
    case "summarize_sales": return `집계 ${bits} → ${r?.groupCount ?? 0}개 그룹 / ${r?.totalCount ?? 0}건`;
    case "get_month_pnl": return `월 손익 ${bits}`;
    case "get_event_report": return `이벤트 실적 ${bits} → ${r?.count ?? 0}건`;
    case "find_products": return `상품 검색 ${bits} → ${r?.count ?? 0}종`;
    case "get_product_performance": return `상품 수익성 ${bits}`;
    case "propose_resolve": return r?.ok ? `확정 제안 ${r?.proposed ?? 0}건` : `확정 제안 거부 — ${r?.error ?? ""}`;
    case "propose_alias": return r?.ok ? `별칭 제안 (지금 ${r?.wouldResolveNow ?? 0}건 해당)` : `별칭 제안 거부 — ${r?.error ?? ""}`;
    default: return `${name} ${bits}`;
  }
}
