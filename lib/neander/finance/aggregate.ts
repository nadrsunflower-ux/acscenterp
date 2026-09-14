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

/** 매트릭스 열 이름은 `대분류 · 소분류` 로 합친다 */
export const BIZ_SEP = " · ";

/** 열 이름을 다시 사업대분류·소분류로 — 원장 드릴다운 링크에 쓴다 */
export function splitBizKey(col: string): { bizMajor: string; bizMinor: string } {
  const i = col.indexOf(BIZ_SEP);
  return i < 0
    ? { bizMajor: col, bizMinor: "" }
    : { bizMajor: col.slice(0, i), bizMinor: col.slice(i + BIZ_SEP.length) };
}

/** 매트릭스에서 이 거래가 더하는 값 — 환급은 지출을 상쇄하므로 음수 */
export function matrixDelta(t: FinTransaction): number {
  return t.txType === "환급" ? -netAmount(t) : netAmount(t);
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
  /**
   * [행][열] 을 이루는 거래.
   *
   * 숫자만 보여주면 "왜 이만큼인지" 를 다시 엑셀에서 찾아야 한다. 화면에서
   * 바로 열어 보려고 참조를 들고 있는다 — 복사가 아니라 같은 객체라
   * 메모리 부담은 없다 (한 달치 수백 건).
   */
  cellRows: Record<string, Record<string, FinTransaction[]>>;
}

/**
 * 매트릭스의 한 칸·한 줄·한 열·전체를 이루는 거래 (금액 큰 순).
 *   { row, col } 둘 다 → 그 칸 · row 만 → 그 줄 합계 · col 만 → 그 열 합계
 *   아무것도 없으면 → 전체 합계
 */
export function matrixRows(m: Matrix, sel: { row?: string; col?: string } = {}): FinTransaction[] {
  const rows = sel.row ? [sel.row] : m.rowKeys;
  const cols = sel.col ? [sel.col] : m.colKeys;
  const out: FinTransaction[] = [];
  rows.forEach((r) => {
    cols.forEach((c) => {
      const list = m.cellRows[r]?.[c];
      if (list) out.push(...list);
    });
  });
  return out.sort((a, b) => matrixDelta(b) - matrixDelta(a));
}

/**
 * 계정대분류 × 사업부 지출 매트릭스 — 엑셀 사업부손익 시트 하단 표.
 * 지출만 대상으로 하며 환급은 차감한다.
 */
export function expenseMatrix(rows: FinTransaction[]): Matrix {
  const cells: Record<string, Record<string, number>> = {};
  const cellRows: Record<string, Record<string, FinTransaction[]>> = {};
  const rowSet = new Set<string>();
  const colSet = new Set<string>();

  plOnly(rows).forEach((t) => {
    if (t.txType === "수입") return;
    const r = t.acctMajor || UNSET;
    const c = `${t.bizMajor || UNSET}${BIZ_SEP}${t.bizMinor || UNSET}`;
    rowSet.add(r);
    colSet.add(c);
    cells[r] ??= {};
    // 환급은 지출을 상쇄한다
    cells[r][c] = (cells[r][c] ?? 0) + matrixDelta(t);
    cellRows[r] ??= {};
    (cellRows[r][c] ??= []).push(t);
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

  return { rowKeys, colKeys, cells, rowTotals, colTotals, grandTotal, cellRows };
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
/**
 * 사업장(법인)별 손익. 합계뿐 아니라 **그 합계를 이룬 거래**도 함께 돌려준다 —
 * 대시보드에서 줄을 눌러 내역 창을 열기 때문이다. 합계만 주면 부르는 쪽이
 * 같은 분류를 한 번 더 해야 하고, 그러면 표의 숫자와 창의 숫자가 갈릴 수 있다.
 */
export function bySite(rows: FinTransaction[]): { site: string; t: Totals; rows: FinTransaction[] }[] {
  const map = new Map<string, FinTransaction[]>();
  plOnly(rows).forEach((t) => {
    const k = t.site || UNSET;
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(t);
  });
  return [...map.entries()]
    .map(([site, list]) => ({ site, t: totals(list), rows: list }))
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
