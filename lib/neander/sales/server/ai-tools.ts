// ============================================================
//  매출 비서의 도구
// ------------------------------------------------------------
//  ⚠️ 이 파일의 유일한 원칙: **모델은 판매 줄을 쓰지 못한다.**
//
//  읽기 도구는 바로 실행한다 (조회는 되돌릴 게 없다).
//  쓰기는 도구가 아니라 **제안**이다 — `propose_resolve` · `propose_split` ·
//  `propose_product` · `propose_alias` 는 Firestore 를 건드리지 않고 "이렇게
//  하자"는 목록만 만든다. 사람이 화면에서 바뀔 내용을 보고 「적용」을 눌러야
//  그때 검토 대기함·마스터와 같은 저장 경로(line.bulkResolve · line.split ·
//  product.upsert)로 나간다.
//
//  새 상품은 한 답 안에서 이어 쓸 수 있다. propose_product 가 코드를 정하면
//  같은 답의 propose_resolve·propose_split 이 그 코드를 쓰고, 그 제안에
//  상품 정의가 함께 실린다(newProducts) — 어느 카드를 먼저 적용해도 상품이
//  먼저 만들어진다. 「상품을 등록하신 뒤 다시 말씀해 주세요」로 사람을 화면
//  사이로 왕복시키지 않으려는 것이다.
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
  type SalesKind,
  type SalesLine,
  type SalesLineDiscount,
  type SalesProduct,
  type SalesStore,
} from "../types";
import { argBits } from "../../ai/agent";
import { LABOR_REASON_LABEL, type LaborActuals } from "../labor";
import { PRODUCT_CODE_PREFIX, nextProductCode } from "../product-code";

const ROW_LIMIT = 50;
const GROUP_LIMIT = 30;

export interface SalesToolContext {
  lines: SalesLine[];
  products: SalesProduct[];
  events: SalesEvent[];
  assumptions: SalesAssumptions;
  /** 근무 일지 실측 인건비 — 없으면 인건비는 가정값 (화면과 같은 규칙) */
  labor?: LaborActuals | null;
  /**
   * 이번 답에서 propose_product 로 제안한 상품 — 아직 마스터에 없다.
   * 같은 답의 다음 제안이 그 코드를 쓸 수 있게 한 요청 동안 쌓는다.
   */
  pending?: SalesProduct[];
}

/** 제안 카드가 보여줄 대상 판매 줄 */
export interface SalesProposalLine {
  id: string;
  date: string;
  store: SalesStore;
  raw: string;
  amount: number;
  status: string;
  reason?: string;
  /** 「뉴진스4주년 (ID-027)」 — 어느 행사의 판매인지가 승인 판단에 필요하다 */
  event?: string;
}

/** 나눠 확정할 때 한 상품 몫 */
export interface SalesSplitPart {
  productId: string;
  productLabel: string;
  qty: number;
  /** 그 날짜 정가 */
  unit: number;
  /** 정가 × 수량 */
  list: number;
  /** 이 줄의 매출 — 할인이 있으면 정가 비율로 나눈 결제액 몫 */
  amount: number;
  discount?: SalesLineDiscount;
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
      before: SalesProposalLine[];
      /** 정가보다 덜 받은 줄 — 사용자가 할인이라고 확인했을 때만 붙는다 */
      discount?: SalesLineDiscount;
      /** 아직 마스터에 없는 상품 — 이 제안을 적용하면 먼저 만든다 */
      newProducts?: SalesProduct[];
    }
  | {
      kind: "split";
      id: string;
      /** 대상 판매 줄 — 모두 같은 결제액이다 */
      ids: string[];
      parts: SalesSplitPart[];
      /** 한 줄의 결제액 */
      amount: number;
      /** 정가 합계 */
      list: number;
      /** 정가 합계 대비 할인율 — 정가 그대로 받았으면 없다 */
      discountRate?: number;
      reason: string;
      before: SalesProposalLine[];
      newProducts?: SalesProduct[];
    }
  | {
      kind: "product";
      id: string;
      product: SalesProduct;
      productLabel: string;
      /** 전용 이벤트 표시 이름 — 없으면 매장 공용 */
      eventLabel?: string;
      reason: string;
      /** 지금 미확정 중 이 상품을 쓸 수 있고 판매가와 같은 금액인 줄 */
      sameAmountCount: number;
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
        "제안 전에 search_sales 로 대상 id 를, find_products 로 상품을 확인할 것. 매장이 다른 상품은 거부된다. " +
        "같은 답에서 propose_product 로 제안한 새 상품 코드도 쓸 수 있다. 한 결제에 상품이 여럿이면 이것 말고 propose_split.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["ids", "productId", "reason"],
        properties: {
          ids: { type: "array", items: { type: "string" }, description: "판매 줄 id 들 (모두 같은 매장)" },
          productId: { type: "string" },
          qty: { type: "number", description: "줄마다 수량. 비우면 금액÷정가로 계산, 안 나눠지면 1" },
          discount: {
            type: "boolean",
            description:
              "정가 × 수량보다 덜 받은 줄을 할인으로 기록한다. 사용자가 할인이라고 확인했을 때만 true. 대상 줄은 모두 같은 금액이어야 한다",
          },
          reason: { type: "string", description: "왜 이 상품인지 한 문장. 사용자가 이걸 보고 승인한다" },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "propose_split",
      description:
        "한 결제에 여러 상품이 들어 있는 미확정 줄(「복합 결제」 등)을 상품별 줄로 나눠 확정하자고 **제안**한다 — 검토 대기함 「조합으로 나누기」와 같다. " +
        "저장되지 않는다. 대상 줄은 모두 같은 결제액·같은 매장이어야 하고, 상품마다 그 날짜 정가 × 수량으로 금액을 낸다. " +
        "정가 합계가 결제액과 같으면 그대로 나누고, 결제액이 적으면 discount: true 일 때만 차액을 상품별 정가 비율로 나눠 할인으로 기록한다. " +
        "결제액이 더 크면 빠진 상품이 있다는 뜻이라 거부된다. 같은 답에서 propose_product 로 제안한 새 상품 코드도 쓸 수 있다.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["ids", "parts", "reason"],
        properties: {
          ids: { type: "array", items: { type: "string" }, description: "판매 줄 id 들 (모두 같은 결제액)" },
          parts: {
            type: "array",
            description: "결제 한 건에 들어 있던 상품 — 2개 이상. 같은 상품 여러 개는 qty 로",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["productId", "qty"],
              properties: {
                productId: { type: "string" },
                qty: { type: "number", description: "결제 한 건 안의 수량 (정수)" },
              },
            },
          },
          discount: {
            type: "boolean",
            description: "정가 합계보다 덜 받은 차액을 할인으로 기록한다. 사용자가 할인·실결제액을 확인했을 때만 true",
          },
          reason: { type: "string", description: "왜 이 조합인지 한 문장. 사용자가 이걸 보고 승인한다" },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "propose_product",
      description:
        "상품 마스터에 새 상품을 만들자고 **제안**한다 — 검토 대기함 「새 상품 만들기」와 같다. 저장되지 않는다. " +
        "맞는 상품이 마스터에 없을 때만 쓴다(find_products 로 먼저 확인). eventId 를 주면 그 행사 전용(기본으로 권장 — 일회성 품목이 다른 행사의 같은 금액을 가져가지 않게). " +
        "코드는 자동으로 정해져 결과로 돌아오고, 그 코드로 같은 답에서 바로 propose_resolve·propose_split 을 이어 제안할 수 있다.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["store", "name", "price", "reason"],
        properties: {
          store: { type: "string", enum: STORE_ENUM },
          name: { type: "string", description: "상품명 — 사용자가 부른 이름 그대로 (예: 비아이 클리커)" },
          option: { type: "string", description: "용량·구성. 비우면 「기본」" },
          price: { type: "number", description: "판매가(원) — 사용자가 알려준 값만" },
          eventId: { type: "string", description: "전용 이벤트 코드 (ID-036 등). 행사 판매라면 넣는다" },
          kind: { type: "string", enum: ["event", "regular"], description: "eventId 가 있으면 event 로 고정" },
          material: { type: "number", description: "재료비(원) — 사용자가 알려줬을 때만. 비우면 0 + 「단가 미확정」 표시" },
          bottles: { type: "number", description: "세트 구성 병 수. 낱개는 1 (기본)" },
          alias: {
            type: "string",
            description: "POS 별칭 — 사용자가 요청했거나 문구가 이 상품만 가리킬 때만. 「금액 입력」 같은 여러 뜻 문구는 금지",
          },
          reason: { type: "string", description: "왜 이 상품이 필요한지 한 문장" },
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

function lineBefore(l: SalesLine, events: Map<string, SalesEvent>): SalesProposalLine {
  return {
    id: l.id,
    date: l.date,
    store: l.store,
    raw: l.raw,
    amount: l.amount,
    status: l.status,
    reason: l.reason ? REASON_LABEL[l.reason] : undefined,
    event: l.eventId ? eventLabelOf(l.eventId, events) : undefined,
  };
}

/**
 * 결제액을 상품별 정가 비율로 나눈다 — 정가 합계와 같으면 정가 그대로.
 * 원 단위 반올림 나머지는 정가가 가장 큰 몫에 얹어 합계가 결제액과 꼭 같게 한다
 * (line.split 이 합계 ≠ 결제액이면 거절한다).
 */
export function allocateSplit(lists: number[], amount: number): number[] {
  const listSum = lists.reduce((a, b) => a + b, 0);
  if (listSum === amount || listSum <= 0) return lists.slice();
  const out = lists.map((l) => Math.round((l * amount) / listSum));
  const biggest = lists.indexOf(Math.max(...lists));
  out[biggest] += amount - out.reduce((a, b) => a + b, 0);
  return out;
}

function pickLines(lines: SalesLine[], ids: string[]) {
  const byId = new Map(lines.map((l) => [l.id, l]));
  return {
    targets: [...new Set(ids)].map((id) => byId.get(id)).filter(Boolean) as SalesLine[],
    missing: ids.filter((id) => !byId.has(id)),
  };
}

/** 이 상품으로 이 줄들을 확정할 수 없는 이유 — 매장이 다르거나 전용 행사 밖 */
function fitError(p: SalesProduct, targets: SalesLine[], events: Map<string, SalesEvent>): string | null {
  const wrongStore = targets.filter((l) => l.store !== p.store);
  if (wrongStore.length > 0) {
    return `${wrongStore.length}건이 ${storeLabel(p.store)} 매장이 아닙니다. 매장이 다른 상품(${p.id})으로는 확정할 수 없습니다.`;
  }
  // 전용 이벤트가 지정된 상품은 그 행사의 줄에만 쓸 수 있다
  const outOfScope = targets.filter((l) => !productInScope(p, l.eventId));
  if (outOfScope.length > 0) {
    return (
      `${p.id} 는 ${(p.eventIds ?? []).map((id) => eventLabelOf(id, events)).join(", ")} 전용 상품입니다. ` +
      `대상 ${outOfScope.length}건이 그 행사의 판매가 아니어서 확정할 수 없습니다 ` +
      `(예: ${outOfScope.slice(0, 3).map((l) => `${l.date} ${eventLabelOf(l.eventId, events)}`).join(" · ")}).`
    );
  }
  return null;
}

/** 이름·옵션 비교용 — 띄어쓰기·대소문자 무시 */
const sameText = (a: string, b: string) => a.replace(/\s+/g, "").toLowerCase() === b.replace(/\s+/g, "").toLowerCase();

let proposalSeq = 0;

export function runSalesTool(
  name: string,
  args: Args,
  ctx: SalesToolContext,
): { result: unknown; proposal?: SalesProposal } {
  // 이번 답에서 제안한 새 상품도 조회·제안에 쓸 수 있다 (아직 저장 전)
  const pending = ctx.pending ?? [];
  const allProducts = pending.length ? [...ctx.products, ...pending] : ctx.products;
  const idx = productIndex(allProducts);
  const evIdx = new Map(ctx.events.map((e) => [e.id, e]));
  const isPending = (id: string) => pending.some((p) => p.id === id);
  /** 제안이 쓰는 상품 중 아직 마스터에 없는 것 — 적용할 때 먼저 만든다 */
  const newProductsOf = (ids: string[]) => {
    const list = pending.filter((p) => ids.includes(p.id));
    return list.length ? list : undefined;
  };

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
      const hits = allProducts.filter((p) => {
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
            ...(isPending(p.id) ? { pending: "이번 답에서 제안만 한 상품 — 아직 마스터에 없다" } : {}),
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
        return { result: { ok: false, error: `상품 ${productId} 이 마스터에 없습니다. find_products 로 확인하거나, 정말 없으면 propose_product 로 먼저 제안하세요.` } };
      }
      const { targets, missing } = pickLines(ctx.lines, ids);
      if (targets.length === 0) {
        return { result: { ok: false, error: "해당 id 의 판매 줄을 찾지 못했습니다. search_sales 로 먼저 확인하세요.", missing } };
      }
      const misfit = fitError(p, targets, evIdx);
      if (misfit) return { result: { ok: false, error: misfit } };
      if (!reason) return { result: { ok: false, error: "reason 이 필요합니다. 사용자가 이걸 보고 승인합니다." } };

      // 수량: 지정이 없으면 금액 ÷ 그 시점 정가. 안 나눠지면 1 (할인·복합)
      let qty = n(args.qty);
      if (qty === undefined) {
        const first = targets[0];
        const price = valueAt(p, first.date).price;
        qty = price > 0 && first.amount % price === 0 ? first.amount / price : 1;
      }
      if (!(qty > 0) || !Number.isInteger(qty)) {
        return { result: { ok: false, error: `수량 ${qty} 은 쓸 수 없습니다 — 1 이상의 정수여야 합니다.` } };
      }

      // 할인 기록 — 검토 대기함 「할인 적용」과 같은 규칙: 정가 × 수량 − 할인 = 결제액.
      // 한 기록을 모든 줄에 쓰므로 금액·정가가 같은 줄끼리만 된다.
      let discount: SalesLineDiscount | undefined;
      const listOf = (l: SalesLine) => valueAt(p, l.date).price * qty!;
      if (args.discount === true) {
        const amounts = new Set(targets.map((l) => l.amount));
        const lists = new Set(targets.map(listOf));
        if (amounts.size > 1 || lists.size > 1) {
          return {
            result: {
              ok: false,
              error: "할인 확정은 결제액과 정가가 같은 줄끼리만 됩니다. 금액·날짜(가격 구간)별로 나눠서 제안하세요.",
            },
          };
        }
        const list = [...lists][0];
        const amount = targets[0].amount;
        if (!(list > amount)) {
          return {
            result: {
              ok: false,
              error: `정가 ${list.toLocaleString("ko-KR")}원(× ${qty})이 결제액 ${amount.toLocaleString("ko-KR")}원보다 크지 않아 할인이 아닙니다. discount 없이 제안하세요.`,
            },
          };
        }
        discount = { list, rate: (list - amount) / list };
      }

      // 정가와 결제액이 어긋나는 줄 — 모델이 보고 사용자에게 확인할 수 있게 돌려준다
      const offPrice = discount ? [] : targets.filter((l) => listOf(l) !== l.amount);

      const proposal: SalesProposal = {
        kind: "resolve",
        id: `s${++proposalSeq}-${Date.now()}`,
        ids: targets.map((l) => l.id),
        productId: p.id,
        productLabel: productLabel(p),
        qty,
        reason,
        before: targets.map((l) => lineBefore(l, evIdx)),
        ...(discount ? { discount } : {}),
        ...(newProductsOf([p.id]) ? { newProducts: newProductsOf([p.id]) } : {}),
      };
      return {
        proposal,
        result: {
          ok: true,
          proposed: targets.length,
          qty,
          missing: missing.length ? missing : undefined,
          discount: discount ? { list: discount.list, rate: Math.round(discount.rate * 1000) / 10 + "%" } : undefined,
          priceMismatch: offPrice.length
            ? `${offPrice.length}건은 정가 × ${qty} 과 결제액이 다릅니다 (예: ${offPrice[0].amount.toLocaleString("ko-KR")}원 vs ${listOf(offPrice[0]).toLocaleString("ko-KR")}원). 사용자에게 알리세요.`
            : undefined,
          newProduct: isPending(p.id) ? `${p.id} 는 새 상품 — 이 제안을 적용하면 상품도 함께 만들어집니다.` : undefined,
          note: "제안을 사용자 화면에 올렸습니다. **아직 저장되지 않았습니다** — 사용자가 승인해야 반영됩니다. 같은 내용을 다시 제안하지 마세요.",
        },
      };
    }

    case "propose_split": {
      const ids = Array.isArray(args.ids) ? args.ids.map(String) : [];
      const reason = s(args.reason) ?? "";
      // 같은 상품이 두 번 오면 수량을 합친다
      const wanted = new Map<string, number>();
      for (const raw of Array.isArray(args.parts) ? args.parts : []) {
        const part = (raw ?? {}) as Args;
        const pid = s(part.productId);
        const q = n(part.qty);
        if (!pid || !q || q <= 0 || !Number.isInteger(q)) {
          return { result: { ok: false, error: "parts 의 상품마다 productId 와 1 이상의 정수 qty 가 필요합니다." } };
        }
        wanted.set(pid, (wanted.get(pid) ?? 0) + q);
      }
      if (wanted.size < 2) {
        return {
          result: {
            ok: false,
            error: "나누려면 서로 다른 상품이 2개 이상이어야 합니다. 한 상품 여러 개면 propose_resolve 에 qty 로 제안하세요.",
          },
        };
      }
      const unknown = [...wanted.keys()].filter((pid) => !idx.has(pid));
      if (unknown.length) {
        return {
          result: {
            ok: false,
            error: `상품 ${unknown.join(", ")} 이 마스터에 없습니다. find_products 로 확인하거나, 정말 없으면 propose_product 로 먼저 제안하세요.`,
          },
        };
      }
      const { targets, missing } = pickLines(ctx.lines, ids);
      if (targets.length === 0) {
        return { result: { ok: false, error: "해당 id 의 판매 줄을 찾지 못했습니다. search_sales 로 먼저 확인하세요.", missing } };
      }
      // line.split 은 미확정 줄만 나눈다 (두 번 나누면 매출이 불어난다)
      const done = targets.filter((l) => l.status !== "needs_review");
      if (done.length) {
        return { result: { ok: false, error: `${done.length}건은 이미 확정된 줄입니다 (${done.map((l) => l.id).join(", ")}). 미확정 줄만 나눌 수 있습니다.` } };
      }
      const amounts = [...new Set(targets.map((l) => l.amount))];
      if (amounts.length > 1) {
        return {
          result: {
            ok: false,
            error: `결제액이 다른 줄이 섞여 있습니다 (${amounts.map((a) => a.toLocaleString("ko-KR")).join(" · ")}원). 결제액별로 따로 제안하세요.`,
          },
        };
      }
      const amount = amounts[0];
      const products = [...wanted.keys()].map((pid) => idx.get(pid)!);
      for (const p of products) {
        const misfit = fitError(p, targets, evIdx);
        if (misfit) return { result: { ok: false, error: misfit } };
      }
      if (!reason) return { result: { ok: false, error: "reason 이 필요합니다. 사용자가 이걸 보고 승인합니다." } };

      // 그 날짜 정가 — 대상 줄마다 같아야 한 조합을 모두에 쓸 수 있다
      const unitsOf = (l: SalesLine) => products.map((p) => valueAt(p, l.date).price);
      const units = unitsOf(targets[0]);
      if (targets.some((l) => unitsOf(l).join() !== units.join())) {
        return { result: { ok: false, error: "대상 줄 사이에 가격이 바뀐 상품이 있습니다. 날짜(가격 구간)별로 나눠서 제안하세요." } };
      }
      const zero = products.filter((_, i) => !(units[i] > 0));
      if (zero.length) {
        return { result: { ok: false, error: `${zero.map((p) => p.id).join(", ")} 의 정가가 0 이라 금액을 나눌 수 없습니다.` } };
      }
      const lists = products.map((p, i) => units[i] * wanted.get(p.id)!);
      const list = lists.reduce((a, b) => a + b, 0);
      const gap = list - amount;
      if (gap < 0) {
        return {
          result: {
            ok: false,
            error:
              `정가 합계 ${list.toLocaleString("ko-KR")}원이 결제액 ${amount.toLocaleString("ko-KR")}원보다 ` +
              `${(-gap).toLocaleString("ko-KR")}원 적습니다 — 빠진 상품이 있는지 사용자에게 확인하세요.`,
          },
        };
      }
      if (gap > 0 && args.discount !== true) {
        return {
          result: {
            ok: false,
            needsConfirmation: true,
            error:
              `정가 합계 ${list.toLocaleString("ko-KR")}원 − 결제액 ${amount.toLocaleString("ko-KR")}원 = ${gap.toLocaleString("ko-KR")}원 ` +
              `(${Math.round((gap / list) * 1000) / 10}%) 차이입니다. 할인인지 사용자에게 확인하고, 할인이 맞으면 discount: true 로 다시 제안하세요. ` +
              `조합이 틀렸을 수도 있습니다.`,
          },
        };
      }
      const rate = gap > 0 ? gap / list : undefined;
      const shares = allocateSplit(lists, amount);
      if (shares.some((x) => x <= 0)) {
        return { result: { ok: false, error: "할인을 나누면 0원 이하가 되는 상품이 있습니다. 조합을 다시 확인하세요." } };
      }
      const parts: SalesSplitPart[] = products.map((p, i) => ({
        productId: p.id,
        productLabel: productLabel(p),
        qty: wanted.get(p.id)!,
        unit: units[i],
        list: lists[i],
        amount: shares[i],
        ...(rate ? { discount: { list: lists[i], rate } } : {}),
      }));
      const fresh = newProductsOf(products.map((p) => p.id));
      const proposal: SalesProposal = {
        kind: "split",
        id: `x${++proposalSeq}-${Date.now()}`,
        ids: targets.map((l) => l.id),
        parts,
        amount,
        list,
        ...(rate ? { discountRate: rate } : {}),
        reason,
        before: targets.map((l) => lineBefore(l, evIdx)),
        ...(fresh ? { newProducts: fresh } : {}),
      };
      return {
        proposal,
        result: {
          ok: true,
          proposed: targets.length,
          linesPerPayment: parts.length,
          parts: parts.map((x) => ({ productId: x.productId, qty: x.qty, list: x.list, amount: x.amount })),
          discount: rate ? `${gap.toLocaleString("ko-KR")}원 (${Math.round(rate * 1000) / 10}%) — 정가 비율로 나눠 기록` : undefined,
          missing: missing.length ? missing : undefined,
          newProducts: fresh ? `${fresh.map((x) => x.id).join(", ")} 는 새 상품 — 이 제안을 적용하면 함께 만들어집니다.` : undefined,
          note: "나누기 제안을 사용자 화면에 올렸습니다. **아직 저장되지 않았습니다** — 사용자가 승인해야 반영됩니다. 같은 내용을 다시 제안하지 마세요.",
        },
      };
    }

    case "propose_product": {
      const store = s(args.store) as SalesStore | undefined;
      const name = s(args.name);
      const option = s(args.option) ?? "기본";
      const price = n(args.price);
      const eventId = s(args.eventId);
      const material = n(args.material);
      const bottles = n(args.bottles);
      const alias = s(args.alias);
      const reason = s(args.reason);
      if (!store || !STORE_ENUM.includes(store)) return { result: { ok: false, error: "store 가 필요합니다 (wow · id · online)." } };
      if (!name) return { result: { ok: false, error: "name 이 필요합니다 — 사용자가 부른 이름 그대로." } };
      if (!price || price <= 0 || !Number.isInteger(price)) {
        return { result: { ok: false, error: "price 는 1원 이상의 정수여야 합니다 — 사용자가 알려준 값만 쓰세요." } };
      }
      if (material !== undefined && (material < 0 || !Number.isInteger(material))) {
        return { result: { ok: false, error: "material 은 0 이상의 정수여야 합니다. 모르면 비워 두세요." } };
      }
      if (bottles !== undefined && (bottles < 1 || !Number.isInteger(bottles))) {
        return { result: { ok: false, error: "bottles 는 1 이상의 정수여야 합니다." } };
      }
      const ev = eventId ? evIdx.get(eventId) : undefined;
      if (eventId && !ev) return { result: { ok: false, error: `이벤트 ${eventId} 가 없습니다. search_sales·get_event_report 로 코드를 확인하세요.` } };
      if (ev && ev.store !== store) {
        return { result: { ok: false, error: `${eventLabelOf(ev.id, evIdx)} 는 ${storeLabel(ev.store)} 이벤트입니다. 매장을 맞추세요.` } };
      }
      if (!reason) return { result: { ok: false, error: "reason 이 필요합니다. 사용자가 이걸 보고 승인합니다." } };

      // 같은 매장에 같은 이름·옵션이 이미 있으면 새로 만들지 않는다
      const dup = allProducts.find((p) => p.store === store && sameText(p.name, name) && sameText(p.option, option));
      if (dup) {
        return {
          result: {
            ok: false,
            existing: dup.id,
            error: isPending(dup.id)
              ? `이번 답에서 이미 ${dup.id} 로 제안한 상품입니다. 그 코드를 쓰세요.`
              : `마스터에 이미 ${productLabel(dup)} 이 있습니다 (${dup.eventIds?.length ? `전용: ${dup.eventIds.join(", ")}` : "공용"}). ` +
                `그 상품을 쓰고, 전용 범위에 이 행사를 넣어야 하면 사용자에게 마스터에서 고치라고 안내하세요.`,
          },
        };
      }
      if (alias) {
        const taken = allProducts.find(
          (p) => p.store === store && (p.aliases ?? []).some((a) => a.toLowerCase() === alias.toLowerCase()),
        );
        if (taken) return { result: { ok: false, error: `별칭 「${alias}」 은 이미 ${productLabel(taken)} 이 쓰고 있습니다.` } };
      }

      const kind: SalesKind = ev || s(args.kind) === "event" ? "event" : "regular";
      const id = nextProductCode(allProducts, PRODUCT_CODE_PREFIX[store][kind]);
      const eventLabel = ev ? eventLabelOf(ev.id, evIdx) : undefined;
      const product: SalesProduct = {
        id,
        store,
        kind,
        name,
        option,
        price,
        material: material ?? 0,
        timeMin: 0,
        makeMin: 0,
        bottles: bottles ?? 1,
        ...(ev ? { eventIds: [ev.id] } : {}),
        ...(alias ? { aliases: [alias] } : {}),
        // 재료비를 모르면 0 으로 두고 「단가 미확정」으로 드러낸다 — 공헌이익이 부푼다
        ...(material === undefined ? { unconfirmed: true } : {}),
        note: [eventLabel ? `${eventLabel} 전용` : null, "매출 비서 제안으로 만듦", material === undefined ? "재료비 미확인" : null]
          .filter(Boolean)
          .join(" · "),
      };
      (ctx.pending ??= []).push(product);

      const sameAmount = ctx.lines.filter(
        (l) => l.status === "needs_review" && l.store === store && l.amount === price && productInScope(product, l.eventId),
      );
      const proposal: SalesProposal = {
        kind: "product",
        id: `p${++proposalSeq}-${Date.now()}`,
        product,
        productLabel: productLabel(product),
        ...(eventLabel ? { eventLabel } : {}),
        reason,
        sameAmountCount: sameAmount.length,
      };
      return {
        proposal,
        result: {
          ok: true,
          productId: id,
          scope: eventLabel ? `${eventLabel} 전용` : `${storeLabel(store)} 공용`,
          materialUnknown: material === undefined || undefined,
          sameAmountPending: sameAmount.length,
          note:
            `상품 제안을 화면에 올렸습니다 (**아직 저장 안 됨**). 이 답 안에서 ${id} 로 propose_resolve·propose_split 을 바로 이어서 제안하세요 — ` +
            "그 제안을 적용하면 상품도 함께 만들어집니다. 사용자에게 「등록한 뒤 다시 말해 달라」고 하지 마세요.",
        },
      };
    }

    case "propose_alias": {
      const productId = s(args.productId) ?? "";
      const alias = s(args.alias) ?? "";
      const reason = s(args.reason) ?? "";
      const p = idx.get(productId);
      if (!p) return { result: { ok: false, error: `상품 ${productId} 이 마스터에 없습니다.` } };
      if (isPending(p.id)) {
        return { result: { ok: false, error: `${p.id} 는 아직 제안만 한 새 상품입니다. 별칭은 propose_product 의 alias 로 함께 넣으세요.` } };
      }
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
    case "get_month_pnl": return `AC'SCENT 대시보드 ${bits}`;
    case "get_event_report": return `이벤트 실적 ${bits} → ${r?.count ?? 0}건`;
    case "find_products": return `상품 검색 ${bits} → ${r?.count ?? 0}종`;
    case "get_product_performance": return `상품 수익성 ${bits}`;
    case "propose_resolve": return r?.ok ? `확정 제안 ${r?.proposed ?? 0}건` : `확정 제안 거부 — ${r?.error ?? ""}`;
    case "propose_split":
      return r?.ok
        ? `나누기 제안 ${r?.proposed ?? 0}건 · 결제마다 ${r?.linesPerPayment ?? 0}줄`
        : `나누기 제안 거부 — ${r?.error ?? ""}`;
    case "propose_product": return r?.ok ? `새 상품 제안 ${r?.productId ?? ""}` : `새 상품 제안 거부 — ${r?.error ?? ""}`;
    case "propose_alias": return r?.ok ? `별칭 제안 (지금 ${r?.wouldResolveNow ?? 0}건 해당)` : `별칭 제안 거부 — ${r?.error ?? ""}`;
    default: return `${name} ${bits}`;
  }
}
