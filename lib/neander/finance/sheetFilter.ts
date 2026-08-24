// ============================================================
//  원장 시트 — 열 단위 필터 (엑셀 자동필터 방식)
// ------------------------------------------------------------
//  열 머리글의 드롭다운에서 값을 골라 거른다. 툴바에 필터를 따로 두는
//  것보다 "지금 이 열이 걸러져 있다"가 눈에 바로 보인다.
//
//  두 종류뿐이다:
//   - 값 목록  : 고유값 체크박스 (유형·거래처·계정·상태 …)
//   - 범위     : 최소~최대 (금액 열. 고유값이 수백 개라 목록이 무의미하다)
//
//  거래일은 값 목록이되 **월(YYYY-MM)** 단위로 묶는다. 날짜 1,460개를
//  체크박스로 고를 수는 없다.
// ============================================================

import { STATUS_LABEL, TX_TYPES, netAmount, type FinTransaction } from "./types";
import type { SortKey } from "./sheet";

/** 필터 가능한 열 — 정렬 가능한 열과 같다 */
export type FilterKey = SortKey;

export interface ValueFilter {
  kind: "values";
  /** 통과시킬 값. 빈 배열은 "필터 없음"으로 본다 */
  values: string[];
}
export interface RangeFilter {
  kind: "range";
  min?: number;
  max?: number;
}
export type ColumnFilter = ValueFilter | RangeFilter;
export type Filters = Partial<Record<FilterKey, ColumnFilter>>;

/** 금액 열은 범위로 거른다 */
export const RANGE_KEYS: FilterKey[] = ["gross", "adjust", "net"];
export const isRangeKey = (k: FilterKey) => RANGE_KEYS.includes(k);

/** 값 필터의 기준 문자열. 빈 값은 `""` 로 모은다. */
export function filterValueOf(t: FinTransaction, key: FilterKey): string {
  switch (key) {
    case "date":
      return (t.date ?? "").slice(0, 7);
    case "gross":
    case "adjust":
    case "net":
      return ""; // 범위 필터라 쓰지 않는다
    default:
      return t[key] ?? "";
  }
}

export function rangeValueOf(t: FinTransaction, key: FilterKey): number {
  if (key === "net") return netAmount(t);
  if (key === "adjust") return Number(t.adjust) || 0;
  return Number(t.gross) || 0;
}

/** 화면에 보여줄 이름 (상태 코드 → 한글, 빈 값 → 표시용 문구) */
export function filterLabelOf(key: FilterKey, value: string): string {
  if (value === "") return "(비어 있음)";
  if (key === "status") return STATUS_LABEL[value as keyof typeof STATUS_LABEL] ?? value;
  return value;
}

/** 실제로 거르고 있는 필터인가 (빈 값 목록·빈 범위는 아니다) */
export function isActiveFilter(f: ColumnFilter | undefined): boolean {
  if (!f) return false;
  return f.kind === "range" ? f.min !== undefined || f.max !== undefined : f.values.length > 0;
}

export const activeFilterKeys = (filters: Filters): FilterKey[] =>
  (Object.keys(filters) as FilterKey[]).filter((k) => isActiveFilter(filters[k]));

/**
 * 필터 적용. `except` 로 지정한 열은 건너뛴다 — 그 열의 드롭다운에 보여줄
 * 후보를 만들 때 쓴다. (엑셀과 같다: 어떤 열의 선택지는 **다른 열들의**
 * 필터를 반영하되 자기 자신의 선택 때문에 줄어들지는 않는다. 안 그러면
 * 한 번 체크를 풀면 그 값이 목록에서 사라져 되돌릴 수 없다.)
 */
export function applyFilters(
  rows: FinTransaction[],
  filters: Filters,
  except?: FilterKey,
): FinTransaction[] {
  const active = activeFilterKeys(filters).filter((k) => k !== except);
  if (active.length === 0) return rows;

  const sets = new Map<FilterKey, Set<string>>();
  active.forEach((k) => {
    const f = filters[k]!;
    if (f.kind === "values") sets.set(k, new Set(f.values));
  });

  return rows.filter((t) =>
    active.every((k) => {
      const f = filters[k]!;
      if (f.kind === "range") {
        const v = rangeValueOf(t, k);
        if (f.min !== undefined && v < f.min) return false;
        if (f.max !== undefined && v > f.max) return false;
        return true;
      }
      return sets.get(k)!.has(filterValueOf(t, k));
    }),
  );
}

export interface FilterOption {
  value: string;
  label: string;
  count: number;
}

/** 드롭다운에 띄울 고유값 + 건수 */
export function columnOptions(rows: FinTransaction[], key: FilterKey): FilterOption[] {
  const counts = new Map<string, number>();
  rows.forEach((t) => {
    const v = filterValueOf(t, key);
    counts.set(v, (counts.get(v) ?? 0) + 1);
  });

  const opts = [...counts.entries()].map(([value, count]) => ({
    value,
    label: filterLabelOf(key, value),
    count,
  }));

  // 빈 값은 항상 맨 아래. 그 외 순서는 열의 성격을 따른다.
  const rank = (o: FilterOption) => {
    if (key === "txType") return (TX_TYPES as readonly string[]).indexOf(o.value);
    if (key === "status") return ["confirmed", "suggested", "needs_review"].indexOf(o.value);
    return null;
  };
  return opts.sort((a, b) => {
    if (a.value === "") return 1;
    if (b.value === "") return -1;
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== null && rb !== null) return ra - rb;
    // 월은 최근이 위로 (거래를 볼 때 최근부터 본다)
    if (key === "date") return b.value.localeCompare(a.value);
    return a.label.localeCompare(b.label, "ko");
  });
}

// ---- 기간(연·월) 선택 ------------------------------------------
//  거래일 열은 월(YYYY-MM) 단위 값 필터다. 툴바의 연/월 선택기도 **같은
//  필터**를 읽고 쓴다. 따로 상태를 두면 둘이 어긋나서, 툴바에는 「2026년」
//  이라고 떠 있는데 실제로는 7월만 걸려 있는 표가 된다.

export interface Period {
  /** `YYYY` — 빈 문자열이면 전체 */
  year: string;
  /** `MM` — 빈 문자열이면 그 해 전체 */
  month: string;
  /** 연/월로 표현할 수 없는 조합 (열 드롭다운에서 달을 골라 담은 경우) */
  custom: boolean;
}

/** 장부에 실제로 있는 그 해의 달 목록 */
export const monthsOfYear = (months: string[], year: string) =>
  year ? months.filter((m) => m.startsWith(`${year}-`)) : [];

/** 현재 거래일 필터를 연/월로 읽는다 */
export function periodOf(filter: ColumnFilter | undefined, months: string[]): Period {
  if (!filter || filter.kind !== "values" || filter.values.length === 0) {
    return { year: "", month: "", custom: false };
  }
  const vs = filter.values;
  const years = new Set(vs.map((v) => v.slice(0, 4)));
  if (years.size !== 1) return { year: "", month: "", custom: true };
  const year = [...years][0];
  if (vs.length === 1) return { year, month: vs[0].slice(5, 7), custom: false };
  // 그 해의 달을 **전부** 고른 것이어야 「연 전체」다. 몇 달만 골랐으면
  // 연 전체라고 말할 수 없으므로 직접 선택으로 둔다.
  const all = monthsOfYear(months, year);
  const whole = all.length === vs.length && all.every((m) => vs.includes(m));
  return { year, month: "", custom: !whole };
}

/** 연/월 선택 → 거래일 필터 (없으면 null = 필터 해제) */
export function periodFilter(months: string[], year: string, month: string): ValueFilter | null {
  if (!year) return null;
  if (month) return { kind: "values", values: [`${year}-${month}`] };
  const vs = monthsOfYear(months, year);
  return vs.length > 0 ? { kind: "values", values: vs } : null;
}
