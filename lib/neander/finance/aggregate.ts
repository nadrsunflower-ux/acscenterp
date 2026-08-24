// ============================================================
//  집계 엔진 — 엑셀 대시보드 시트를 코드로 재현
// ------------------------------------------------------------
//  엑셀의 SUMIFS 를 그대로 옮긴다. 검증 기준은 사업부손익 시트다.
//
//    순손익 = 수입 − (지출 − 환급)
//
//  환급은 원거래와 같은 사업부·계정으로 입력되어 지출에서 차감된다.
//  자금거래(계좌간 이동)와 카드대금결제는 실제 손익이 아니므로
//  집계에서 완전히 제외한다 — 넣으면 매출이 부풀려진다.
// ============================================================

import type { FinTransaction } from "./types";
import { netAmount } from "./types";

/** 사업소분류가 비어 있을 때 엑셀이 쓰는 표기 */
export const UNSET = "(미정)";

export interface PLRow {
  bizMajor: string;
  bizMinor: string;
  income: number;
  expense: number;
  refund: number;
  /** 순손익 = 수입 − (지출 − 환급) */
  net: number;
}

export interface Totals {
  income: number;
  expense: number;
  refund: number;
  net: number;
  count: number;
}

/** 손익 대상만 남긴다 (자금거래·카드대금결제 제외) */
export function plOnly(rows: FinTransaction[]): FinTransaction[] {
  return rows.filter(
    (t) => t.txType === "수입" || t.txType === "지출" || t.txType === "환급",
  );
}

/** 기간 필터 — month 는 `YYYY-MM`, 비우면 전체 */
export function inMonth(rows: FinTransaction[], month?: string): FinTransaction[] {
  if (!month) return rows;
  return rows.filter((t) => (t.date ?? "").startsWith(month));
}

/** 총계 */
export function totals(rows: FinTransaction[]): Totals {
  let income = 0;
  let expense = 0;
  let refund = 0;
  rows.forEach((t) => {
    const n = netAmount(t);
    if (t.txType === "수입") income += n;
    else if (t.txType === "지출") expense += n;
    else if (t.txType === "환급") refund += n;
  });
  return { income, expense, refund, net: income - (expense - refund), count: rows.length };
}

/** 사업부(대분류×소분류)별 손익 — 엑셀 사업부손익 시트 상단 표 */
export function businessUnitPL(rows: FinTransaction[]): { rows: PLRow[]; total: Totals } {
  const map = new Map<string, PLRow>();
  plOnly(rows).forEach((t) => {
    const major = t.bizMajor || UNSET;
    const minor = t.bizMinor || UNSET;
    const key = `${major}|${minor}`;
    if (!map.has(key)) {
      map.set(key, { bizMajor: major, bizMinor: minor, income: 0, expense: 0, refund: 0, net: 0 });
    }
    const r = map.get(key)!;
    const n = netAmount(t);
    if (t.txType === "수입") r.income += n;
    else if (t.txType === "지출") r.expense += n;
    else if (t.txType === "환급") r.refund += n;
  });

  const out = [...map.values()];
  out.forEach((r) => {
    r.net = r.income - (r.expense - r.refund);
  });
  // 대분류 → 소분류 순, 대분류는 B2C·B2B·공용 순서를 유지
  const majorOrder = ["B2C", "B2B", "공용", "해당없음"];
  out.sort((a, b) => {
    const ma = majorOrder.indexOf(a.bizMajor);
    const mb = majorOrder.indexOf(b.bizMajor);
    if (ma !== mb) return (ma < 0 ? 99 : ma) - (mb < 0 ? 99 : mb);
    return a.bizMinor.localeCompare(b.bizMinor, "ko");
  });

  return { rows: out, total: totals(plOnly(rows)) };
}

export interface Matrix {
  /** 행 이름 (계정대분류) */
  rowKeys: string[];
  /** 열 이름 (`대분류 · 소분류`) */
  colKeys: string[];
  /** [행][열] 금액 */
  cells: Record<string, Record<string, number>>;
  rowTotals: Record<string, number>;
  colTotals: Record<string, number>;
  grandTotal: number;
}

/**
 * 계정대분류 × 사업부 지출 매트릭스 — 엑셀 사업부손익 시트 하단 표.
 * 지출만 대상으로 하며 환급은 차감한다.
 */
export function expenseMatrix(rows: FinTransaction[]): Matrix {
  const cells: Record<string, Record<string, number>> = {};
  const rowSet = new Set<string>();
  const colSet = new Set<string>();

  plOnly(rows).forEach((t) => {
    if (t.txType === "수입") return;
    const r = t.acctMajor || UNSET;
    const c = `${t.bizMajor || UNSET} · ${t.bizMinor || UNSET}`;
    rowSet.add(r);
    colSet.add(c);
    cells[r] ??= {};
    // 환급은 지출을 상쇄한다
    const delta = t.txType === "환급" ? -netAmount(t) : netAmount(t);
    cells[r][c] = (cells[r][c] ?? 0) + delta;
  });

  const rowKeys = [...rowSet].sort((a, b) => a.localeCompare(b, "ko"));
  const colKeys = [...colSet].sort((a, b) => a.localeCompare(b, "ko"));

  const rowTotals: Record<string, number> = {};
  const colTotals: Record<string, number> = {};
  let grandTotal = 0;
  rowKeys.forEach((r) => {
    rowTotals[r] = colKeys.reduce((s, c) => s + (cells[r]?.[c] ?? 0), 0);
    grandTotal += rowTotals[r];
  });
  colKeys.forEach((c) => {
    colTotals[c] = rowKeys.reduce((s, r) => s + (cells[r]?.[c] ?? 0), 0);
  });

  return { rowKeys, colKeys, cells, rowTotals, colTotals, grandTotal };
}

export interface MonthPoint {
  month: string;
  income: number;
  expense: number;
  net: number;
}

/** 월별 추이 — 오래된 달부터 */
export function monthlyTrend(rows: FinTransaction[]): MonthPoint[] {
  const map = new Map<string, MonthPoint>();
  plOnly(rows).forEach((t) => {
    const m = (t.date ?? "").slice(0, 7);
    if (!m) return;
    if (!map.has(m)) map.set(m, { month: m, income: 0, expense: 0, net: 0 });
    const p = map.get(m)!;
    const n = netAmount(t);
    if (t.txType === "수입") p.income += n;
    else if (t.txType === "지출") p.expense += n;
    else if (t.txType === "환급") p.expense -= n;
  });
  const out = [...map.values()].sort((a, b) => a.month.localeCompare(b.month));
  out.forEach((p) => {
    p.net = p.income - p.expense;
  });
  return out;
}

/** 사업장(법인)별 손익 — 네안데르 / 안다르 / 일해라컴퍼니 / 와작홈즈 */
export function bySite(rows: FinTransaction[]): { site: string; t: Totals }[] {
  const map = new Map<string, FinTransaction[]>();
  plOnly(rows).forEach((t) => {
    const k = t.site || UNSET;
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(t);
  });
  return [...map.entries()]
    .map(([site, list]) => ({ site, t: totals(list) }))
    .sort((a, b) => b.t.expense + b.t.income - (a.t.expense + a.t.income));
}

export interface VendorSpend {
  vendor: string;
  count: number;
  amount: number;
}

/** 지출 상위 거래처 */
export function topVendors(rows: FinTransaction[], limit = 15): VendorSpend[] {
  const map = new Map<string, VendorSpend>();
  plOnly(rows).forEach((t) => {
    if (t.txType !== "지출") return;
    const v = t.vendor?.trim() || "(거래처 없음)";
    if (!map.has(v)) map.set(v, { vendor: v, count: 0, amount: 0 });
    const s = map.get(v)!;
    s.count += 1;
    s.amount += netAmount(t);
  });
  return [...map.values()].sort((a, b) => b.amount - a.amount).slice(0, limit);
}

/** 사용 가능한 월 목록 (최신순) */
export function availableMonths(rows: FinTransaction[]): string[] {
  const set = new Set<string>();
  rows.forEach((t) => {
    const m = (t.date ?? "").slice(0, 7);
    if (m) set.add(m);
  });
  return [...set].sort((a, b) => b.localeCompare(a));
}
