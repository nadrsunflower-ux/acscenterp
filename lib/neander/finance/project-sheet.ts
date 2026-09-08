// ============================================================
//  체크리스트 시트의 보기 상태 — 정렬 · 필터 · 뷰 되돌리기
// ------------------------------------------------------------
//  원장과 같은 자동필터를 체크리스트에도 단다. 다만 한 가지가 다르다.
//
//  원장에서 정렬·필터는 **보기**일 뿐이고 저장되는 것은 거래 문서다. 그런데
//  체크리스트는 줄의 **순서 자체가 문서 내용**이다(사람이 정한 준비 순서).
//  그래서 걸러진 화면에서 고친 결과를 원본 배열에 되돌려 놓아야 한다 —
//  화면에 보이던 30줄만 저장하면 가려져 있던 32줄이 조용히 사라진다.
//  그 되돌리기가 reconcileLines() 다.
// ============================================================

import type { ColumnFilter, FilterOption } from "./sheetFilter";
import {
  CHECKLIST_FIXED_KEYS,
  extraKey,
  lineActual,
  lineEstimate,
  type FinProjectColumn,
  type FinProjectLine,
} from "./project";

/** 열 id → 필터. 열 id 는 고정 열 키 또는 `x:<사용자 열 id>` */
export type ChecklistFilters = Record<string, ColumnFilter>;

export interface ChecklistSort {
  colId: string;
  dir: "asc" | "desc";
}

/** 숫자 범위로 거르는 열 — 고유값이 수백 개라 목록이 무의미하다 */
export const CHECKLIST_RANGE_KEYS = new Set(["qty", "unitPrice", "estimate", "actual", "preparedQty"]);

export const isChecklistRangeKey = (colId: string) => CHECKLIST_RANGE_KEYS.has(colId);

/** 이 열이 값 목록·범위 어느 쪽으로도 거를 수 없는가 (지금은 없음) */
export const isChecklistFilterable = (colId: string) => colId !== "";

const DONE_LABEL = { yes: "준비 완료", no: "아직" } as const;

/** 값 필터의 기준 문자열. 빈 값은 `""` 로 모은다. */
export function checklistValueOf(l: FinProjectLine, colId: string): string {
  switch (colId) {
    case "done":
      return l.done ? "1" : "";
    case "category":
      return l.category ?? "";
    case "item":
      return l.item ?? "";
    case "unit":
      return l.unit ?? "";
    case "vendor":
      return l.vendor ?? "";
    case "location":
      return l.location ?? "";
    case "note":
      return l.note ?? "";
    default:
      if (colId.startsWith("x:")) return l.extra?.[colId.slice(2)] ?? "";
      return "";
  }
}

/** 범위 필터·정렬의 기준 숫자 */
export function checklistNumberOf(l: FinProjectLine, colId: string): number {
  switch (colId) {
    case "qty":
      return Number(l.qty) || 0;
    case "unitPrice":
      return Number(l.unitPrice ?? NaN);
    case "estimate":
      return lineEstimate(l);
    case "actual":
      // 비어 있으면 견적으로 본다 — 화면의 계산과 같은 규칙
      return lineActual(l);
    case "preparedQty":
      return Number(l.preparedQty ?? NaN);
    default:
      return NaN;
  }
}

/** 화면에 보여줄 이름 (준비 열의 1/빈값 → 한글, 빈 값 → 표시용 문구) */
export function checklistLabelOf(colId: string, value: string): string {
  if (colId === "done") return value === "1" ? DONE_LABEL.yes : DONE_LABEL.no;
  return value === "" ? "(비어 있음)" : value;
}

export function isActiveChecklistFilter(f: ColumnFilter | undefined): boolean {
  if (!f) return false;
  return f.kind === "range" ? f.min !== undefined || f.max !== undefined : f.values.length > 0;
}

export const activeChecklistFilterCount = (filters: ChecklistFilters) =>
  Object.values(filters).filter(isActiveChecklistFilter).length;

/**
 * 필터 적용. `except` 열은 건너뛴다 — 그 열의 드롭다운 후보를 만들 때 쓴다
 * (엑셀과 같다: 어떤 열의 선택지는 다른 열 필터만 반영한다).
 */
export function applyChecklistFilters(
  lines: FinProjectLine[],
  filters: ChecklistFilters,
  except?: string,
): FinProjectLine[] {
  const entries = Object.entries(filters).filter(
    ([key, f]) => key !== except && isActiveChecklistFilter(f),
  );
  if (entries.length === 0) return lines;
  return lines.filter((l) =>
    entries.every(([key, f]) => {
      if (f.kind === "range") {
        const n = checklistNumberOf(l, key);
        if (!Number.isFinite(n)) return false;
        if (f.min !== undefined && n < f.min) return false;
        if (f.max !== undefined && n > f.max) return false;
        return true;
      }
      return f.values.includes(checklistValueOf(l, key));
    }),
  );
}

/** 드롭다운에 띄울 고유값 + 건수 */
export function checklistOptions(lines: FinProjectLine[], colId: string): FilterOption[] {
  const counts = new Map<string, number>();
  lines.forEach((l) => {
    const v = checklistValueOf(l, colId);
    counts.set(v, (counts.get(v) ?? 0) + 1);
  });
  return [...counts.entries()]
    .map(([value, count]) => ({ value, label: checklistLabelOf(colId, value), count }))
    .sort((a, b) => {
      // 빈 값은 언제나 맨 아래 — 목록의 앞자리는 실제 값이 차지해야 한다
      if (a.value === "") return 1;
      if (b.value === "") return -1;
      return a.label.localeCompare(b.label, "ko");
    });
}

/**
 * 정렬. 원본 배열은 건드리지 않는다.
 * 같은 값이면 원래 순서를 지킨다 — 정렬을 풀었을 때 줄이 뒤섞이지 않게.
 */
export function sortChecklist(lines: FinProjectLine[], sort: ChecklistSort | null): FinProjectLine[] {
  if (!sort) return lines;
  const numeric = isChecklistRangeKey(sort.colId);
  const sign = sort.dir === "asc" ? 1 : -1;
  return lines
    .map((l, i) => ({ l, i }))
    .sort((a, b) => {
      let d: number;
      if (numeric) {
        const x = checklistNumberOf(a.l, sort.colId);
        const y = checklistNumberOf(b.l, sort.colId);
        // 값이 없는 줄은 방향과 무관하게 뒤로 — 위로 올라오면 표가 안 읽힌다
        if (!Number.isFinite(x) && !Number.isFinite(y)) d = 0;
        else if (!Number.isFinite(x)) return 1;
        else if (!Number.isFinite(y)) return -1;
        else d = x - y;
      } else {
        d = checklistValueOf(a.l, sort.colId).localeCompare(
          checklistValueOf(b.l, sort.colId),
          "ko",
        );
      }
      return d !== 0 ? d * sign : a.i - b.i;
    })
    .map((x) => x.l);
}

/**
 * 걸러진 화면에서 고친 결과를 원본 줄 배열로 되돌린다.
 *
 *  - 화면에 없던 줄은 그대로 둔다 (필터에 가려져 있었을 뿐이다)
 *  - 화면에 있었는데 돌아오지 않은 줄은 지워진 것이다
 *  - 처음 보는 id 는 새로 만들어진 줄 — 맨 뒤에 붙인다
 *
 * 마지막 규칙 때문에, 필터나 정렬이 걸린 상태에서 시트 안에서 줄을 끼워
 * 넣으면 문서에서는 맨 끝에 붙는다. 걸러진 화면의 "이 줄 아래"가 원본의
 * 어디인지는 정할 수 없기 때문이다. 그래서 툴바의 「행 추가」는 선택한
 * 줄의 **원본 위치**를 찾아 그 아래에 넣는다.
 */
export function reconcileLines(
  prev: FinProjectLine[],
  view: FinProjectLine[],
  nextView: FinProjectLine[],
): FinProjectLine[] {
  const inView = new Set(view.map((l) => l.id));
  const nextById = new Map(nextView.map((l) => [l.id, l]));
  const out: FinProjectLine[] = [];

  prev.forEach((l) => {
    if (!inView.has(l.id)) {
      out.push(l);
      return;
    }
    const n = nextById.get(l.id);
    if (n) {
      out.push(n);
      nextById.delete(l.id);
    }
  });
  // 남은 것 = 새로 생긴 줄. 화면에 있던 순서를 지켜 붙인다.
  nextView.forEach((l) => {
    if (nextById.has(l.id)) out.push(l);
  });
  return out;
}

/** 사용자 열의 이름 (없으면 열 id 그대로) */
export function columnLabel(colId: string, columns: FinProjectColumn[], fixed: Record<string, string>): string {
  if (colId.startsWith("x:")) {
    const id = colId.slice(2);
    return columns.find((c) => c.id === id)?.label ?? "새 열";
  }
  return fixed[colId] ?? colId;
}

/** 새 사업 열을 어느 열 뒤에 넣을지 — 고른 열이 없으면 맨 뒤 */
export function anchorFor(activeColId: string | undefined, columns: FinProjectColumn[]): string | undefined {
  if (activeColId) return activeColId;
  const last = CHECKLIST_FIXED_KEYS[CHECKLIST_FIXED_KEYS.length - 1];
  const tail = columns.filter((c) => c.after === last);
  return tail.length > 0 ? extraKey(tail[tail.length - 1].id) : last;
}
