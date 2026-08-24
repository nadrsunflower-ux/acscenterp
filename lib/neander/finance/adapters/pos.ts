// ============================================================
//  페이히어 POS 매출 — **적재가 아니라 대사(對査)용**
// ------------------------------------------------------------
//  ⚠️ POS 매출을 거래로 적재하면 매출이 두 번 잡힌다.
//
//  현재 장부는 매장 매출을 **카드사 정산 입금**으로 잡고 있다
//  (2026-07 와우판매 105건이 삼성·KB·NH·SHC·하나 등 카드사 입금이다).
//  같은 판매를 POS 쪽에서 한 번 더 넣으면 매출이 2배가 된다.
//
//  그래서 이 어댑터는 거래를 만들지 않는다. 대신 **POS 총매출과 장부에
//  잡힌 매출을 맞춰 본다** — 정산이 누락됐는지, 카드 수수료가 얼마나
//  떼였는지가 그 차이에서 드러난다. 이게 POS 데이터의 실제 값이다.
//
//  (POS 를 매출의 정본으로 바꾸고 정산 입금을 자금거래로 돌리는 방법도
//   있다. 회계적으로는 그게 더 정확하지만 과거 장부 전체를 다시 정의해야
//   하므로, 결정하기 전까지는 대사만 한다.)
// ============================================================

import type { WorkBook } from "xlsx";
import { cellAt, col, findHeaderRow, hasLabels, parseAmount, parseDateTime, pickSheet, sheetRange, str } from "./util";

export interface PosSale {
  rowNo: number;
  date: string;
  datetime?: string;
  /** 상품 요약 ("포도알 50ml 향수 외 1건") */
  items: string;
  total: number;
  card: number;
  cash: number;
  easy: number;
  other: number;
  online: number;
  /** 환불 일시가 찍혀 있으면 환불 건 */
  refundedAt?: string;
}

export interface PosResult {
  /** 어느 출처인가 (페이히어 · 네이버 예약 …) */
  sourceLabel: string;
  /** 매장·채널 이름 (시트 상단 또는 파일명에서) */
  store: string;
  /**
   * 파서가 아는 귀속. 없으면 storeToUnit(store) 로 추정한다.
   * 네이버 예약처럼 채널이 정해져 있으면 파서가 직접 채운다.
   */
  unit?: { bizMajor?: string; bizMinor?: string; acctMinor?: string };
  /** 조회 기간 문구 */
  period: string;
  from?: string;
  to?: string;
  /** 상단 요약 (총 매출 · 실 매출 · 결제 건수 · 총 환불 …) */
  summary: {
    total: number;
    net: number;
    count: number;
    avg: number;
    refund: number;
    refundCount: number;
  };
  sales: PosSale[];
  /** 결제수단별 합계 — 카드사 정산과 맞출 때 쓴다 */
  byMethod: { card: number; cash: number; easy: number; other: number; online: number };
  sheetName: string;
  warnings: string[];
}

/** 사업소분류 추정 — 「악센트 아이디」 → 아이디 */
export function storeToUnit(store: string): { bizMinor?: string; acctMinor?: string } {
  if (/아이디|ID/i.test(store)) return { bizMinor: "아이디", acctMinor: "아이디판매" };
  if (/와우|WOW/i.test(store)) return { bizMinor: "와우", acctMinor: "와우판매" };
  if (/신촌/.test(store)) return { bizMinor: "신촌", acctMinor: "신촌판매" };
  return {};
}

export function detectPayhere(wb: WorkBook): number {
  return hasLabels(wb, ["결제일", "결제 내역", "카드 결제"]) ? 0.95 : 0;
}

export function parsePayhere(wb: WorkBook, fileName?: string): PosResult | null {
  const picked = pickSheet(wb, "매출 내역", "매출내역");
  if (!picked) return null;
  const { name, ws } = picked;

  // 상단 메타 — 기간(4행 근처)·매장(5행 근처)·요약(8~9행)
  const range = sheetRange(ws);
  let period = "";
  let store = "";
  for (let r = range.s.r; r <= Math.min(range.e.r, range.s.r + 8); r++) {
    const v = str(cellAt(ws, r, range.s.c));
    if (!v) continue;
    if (/^\d{4}-\d{2}-\d{2}\s*~/.test(v)) period = v;
    else if (/악센트|매장/.test(v) && !/매출/.test(v)) store = v;
  }
  if (!store && fileName) {
    const m = fileName.match(/_([^_]+)\.xlsx?$/i);
    if (m) store = m[1];
  }
  const pm = period.match(/(\d{4}-\d{2}-\d{2})\s*~\s*(\d{4}-\d{2}-\d{2})/);

  // 요약 행: 「총 매출 | 실 매출 | 결제 건수 | 건 단가 | 총 환불 | 환불 건수」 바로 아래
  const sumHead = findHeaderRow(ws, ["총 매출", "실 매출", "결제 건수"], 12);
  const summary = { total: 0, net: 0, count: 0, avg: 0, refund: 0, refundCount: 0 };
  if (sumHead) {
    const r = sumHead.row + 1;
    const get = (...a: string[]) => {
      const c = col(sumHead.cols, ...a);
      return c >= 0 ? parseAmount(cellAt(ws, r, c)).amount : 0;
    };
    summary.total = get("총 매출");
    summary.net = get("실 매출");
    summary.count = get("결제 건수");
    summary.avg = get("건 단가");
    summary.refund = get("총 환불");
    summary.refundCount = get("환불 건수");
  }

  // 거래 목록 — 「결제일 | 결제시간 | 결제 내역 | 합계 | … 」
  const head = findHeaderRow(ws, ["결제일", "결제 내역", "합계"], 20);
  const sales: PosSale[] = [];
  const warnings: string[] = [];
  if (head) {
    const c = {
      date: col(head.cols, "결제일"),
      time: col(head.cols, "결제시간"),
      items: col(head.cols, "결제 내역", "결제내역"),
      total: col(head.cols, "합계"),
      card: col(head.cols, "카드 결제", "카드결제"),
      cash: col(head.cols, "현금 결제", "현금결제"),
      easy: col(head.cols, "간편 결제", "간편결제"),
      other: col(head.cols, "기타 결제", "기타결제"),
      online: col(head.cols, "온라인 스토어", "온라인스토어"),
      refundAt: col(head.cols, "환불 일시", "환불일시"),
    };
    for (let r = head.row + 1; r <= range.e.r; r++) {
      const rowNo = r + 1;
      const rawDate = str(cellAt(ws, r, c.date));
      // 첫 데이터 행은 「전체합계」다 — 넣으면 매출이 두 배가 된다
      if (/전체합계|합계/.test(rawDate)) continue;
      const dt = parseDateTime(cellAt(ws, r, c.date), c.time >= 0 ? cellAt(ws, r, c.time) : undefined);
      if (!dt) continue;
      const amt = (k: number) => (k >= 0 ? parseAmount(cellAt(ws, r, k)).amount : 0);
      const total = amt(c.total);
      if (!total) continue;
      sales.push({
        rowNo,
        date: dt.date,
        datetime: dt.datetime,
        items: c.items >= 0 ? str(cellAt(ws, r, c.items)) : "",
        total,
        card: amt(c.card),
        cash: amt(c.cash),
        easy: amt(c.easy),
        other: amt(c.other),
        online: amt(c.online),
        refundedAt: c.refundAt >= 0 ? str(cellAt(ws, r, c.refundAt)) || undefined : undefined,
      });
    }
  } else {
    warnings.push("결제 내역 표를 찾지 못했습니다. 요약 수치만 사용합니다.");
  }

  const byMethod = sales.reduce(
    (s, x) => ({
      card: s.card + x.card,
      cash: s.cash + x.cash,
      easy: s.easy + x.easy,
      other: s.other + x.other,
      online: s.online + x.online,
    }),
    { card: 0, cash: 0, easy: 0, other: 0, online: 0 },
  );

  // 목록 합계가 요약과 어긋나면 알린다 (필터가 걸린 파일일 수 있다)
  const listTotal = sales.reduce((s, x) => s + x.total, 0);
  if (summary.total && Math.abs(listTotal - summary.total) > 1) {
    warnings.push(
      `목록 합계 ${listTotal.toLocaleString("ko-KR")} 원이 상단 요약 ${summary.total.toLocaleString("ko-KR")} 원과 다릅니다.`,
    );
  }

  return {
    sourceLabel: "페이히어 POS",
    store: store || "(매장 미상)",
    period,
    from: pm?.[1],
    to: pm?.[2],
    summary,
    sales,
    byMethod,
    sheetName: name,
    warnings,
  };
}

// ---- 대사 -----------------------------------------------------

export interface PosReconcileInput {
  /** 장부에 잡힌 그 매장의 매출 (기간 안, 수입 − 환급) */
  ledgerSales: number;
  ledgerCount: number;
}

export interface PosReconcile {
  posTotal: number;
  posNet: number;
  posCount: number;
  ledgerSales: number;
  ledgerCount: number;
  /** 장부 − POS. 음수면 장부가 덜 잡혔다 (정산 누락 또는 카드 수수료) */
  gap: number;
  gapRate: number;
  /** 카드 결제분 — 정산 입금으로 들어오는 몫 */
  cardPortion: number;
  /** 현금 결제분 — 통장에 안 들어오고 시재로 남는 몫 */
  cashPortion: number;
}

export function reconcilePos(pos: PosResult, ledger: PosReconcileInput): PosReconcile {
  const posNet = pos.summary.net || pos.sales.reduce((s, x) => s + x.total, 0);
  const gap = ledger.ledgerSales - posNet;
  return {
    posTotal: pos.summary.total,
    posNet,
    posCount: pos.summary.count || pos.sales.length,
    ledgerSales: ledger.ledgerSales,
    ledgerCount: ledger.ledgerCount,
    gap,
    gapRate: posNet ? gap / posNet : 0,
    cardPortion: pos.byMethod.card,
    cashPortion: pos.byMethod.cash,
  };
}
