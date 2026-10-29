// ============================================================
//  프로젝트 목록의 보기 상태 — 열 머리글 정렬 · 필터
// ------------------------------------------------------------
//  원장·체크리스트와 같은 자동필터(ColumnMenu)를 목록 표에도 단다.
//  목록은 저장할 것이 없는 순수한 보기라, 체크리스트처럼 걸러진 화면을
//  원본에 되돌려 놓는 일(reconcile)이 없다.
//
//  두 종류뿐이다:
//   - 값 목록 : 프로젝트 · 상태 · 사업체 · 진행 기간(시작 월) · 납기(월) · 준비 · 문서
//               (사업체만 한 줄에 값이 여럿일 수 있다 — 하나라도 맞으면 통과)
//   - 범위    : 금액 열과 이익률 (고유값이 건마다 달라 목록이 무의미하다)
// ============================================================

import type { ColumnFilter, FilterOption } from "./sheetFilter";
import {
  PROJECT_ENTITIES,
  PROJECT_STATUS_LABEL,
  PROJECT_STATUSES,
  type FinProjectDoc,
  type ProjectEntity,
  type ProjectSummary,
} from "./project";

/** 표 한 줄 — 화면이 이미 계산해 둔 값을 그대로 거른다 */
export interface ProjectListRow {
  p: FinProjectDoc;
  s: ProjectSummary;
  quotes: number;
  contracts: number;
  /** projectEntities() 결과 — 고른 값이거나 원장 입금으로 추정한 값 */
  entities: ProjectEntity[];
}

export const PROJECT_LIST_KEYS = [
  "name",
  "status",
  "entity",
  "period",
  "delivery",
  "revenue",
  "estimate",
  "actual",
  "profit",
  "margin",
  "unpaid",
  "ledger",
  "ready",
  "docs",
] as const;
export type ProjectListKey = (typeof PROJECT_LIST_KEYS)[number];

export type ProjectListFilters = Partial<Record<ProjectListKey, ColumnFilter>>;
export interface ProjectListSort {
  key: ProjectListKey;
  dir: "asc" | "desc";
}

const RANGE_KEYS = new Set<ProjectListKey>(["revenue", "estimate", "actual", "profit", "margin", "unpaid", "ledger"]);
export const isProjectRangeKey = (k: ProjectListKey) => RANGE_KEYS.has(k);

/**
 * 범위·숫자 정렬의 기준값. 이익률은 퍼센트 숫자(48.1)로 — 메뉴에 0.481 을
 * 치게 하면 아무도 못 맞힌다. 수입이 없어 이익률이 없는 건은 NaN 이다.
 */
export function projectNumberOf(r: ProjectListRow, key: ProjectListKey): number {
  switch (key) {
    case "revenue":
      return r.s.revenue;
    case "estimate":
      return r.s.estimate;
    case "actual":
      return r.s.actual;
    case "profit":
      return r.s.profitActual;
    case "margin":
      return r.s.marginActual === null ? NaN : Math.round(r.s.marginActual * 1000) / 10;
    case "unpaid":
      return r.s.unpaid;
    case "ledger":
      return r.s.ledger.count > 0 ? r.s.ledger.expense - r.s.ledger.refund : NaN;
    default:
      return NaN;
  }
}

/** 값 필터의 기준 문자열들. 사업체만 여럿일 수 있고, 나머지는 한 개다. */
function projectValuesOf(r: ProjectListRow, key: ProjectListKey): string[] {
  if (key === "entity") return r.entities.length > 0 ? r.entities : [""];
  return [projectValueOf(r, key)];
}

/** 값 필터의 기준 문자열. 빈 값은 `""` 로 모은다. */
export function projectValueOf(r: ProjectListRow, key: ProjectListKey): string {
  switch (key) {
    case "name":
      return r.p.name;
    case "status":
      return r.p.status;
    case "entity":
      return r.entities.join(" · ");
    case "period":
      // 날짜 하나하나는 고를 수 없다 — 시작 월로 묶는다 (원장 거래일과 같은 방식)
      return (r.p.startDate ?? "").slice(0, 7);
    case "delivery":
      return (r.p.deliveryDate ?? "").slice(0, 7);
    case "ready":
      if (r.s.lineCount === 0) return "";
      return r.s.doneCount === r.s.lineCount ? "all" : "partial";
    case "docs":
      if (r.quotes > 0 && r.contracts > 0) return "both";
      if (r.quotes > 0) return "quote";
      if (r.contracts > 0) return "contract";
      return "";
    default:
      return "";
  }
}

const READY_LABEL: Record<string, string> = { all: "모두 준비됨", partial: "준비 중" };
const DOCS_LABEL: Record<string, string> = { both: "견적서 · 계약서", quote: "견적서만", contract: "계약서만" };

export function projectLabelOf(key: ProjectListKey, value: string): string {
  if (value === "") {
    if (key === "ready") return "(지출 줄 없음)";
    if (key === "docs") return "(문서 없음)";
    if (key === "period") return "(시작일 없음)";
    if (key === "delivery") return "(납기 없음)";
    if (key === "entity") return "(모름)";
    return "(비어 있음)";
  }
  if (key === "status") return PROJECT_STATUS_LABEL[value as keyof typeof PROJECT_STATUS_LABEL] ?? value;
  if (key === "ready") return READY_LABEL[value] ?? value;
  if (key === "docs") return DOCS_LABEL[value] ?? value;
  return value;
}

const isActive = (f: ColumnFilter | undefined) =>
  !!f && (f.kind === "values" ? f.values.length > 0 : f.min !== undefined || f.max !== undefined);

export const activeProjectFilterCount = (filters: ProjectListFilters) =>
  Object.values(filters).filter(isActive).length;

/**
 * 열 필터를 건다. `except` 열은 빼고 건다 — 그 열의 드롭다운 후보는
 * 「다른 열 필터를 통과한 줄」에서 뽑아야 고를 값이 사라지지 않는다.
 */
export function applyProjectFilters(
  rows: ProjectListRow[],
  filters: ProjectListFilters,
  except?: ProjectListKey,
): ProjectListRow[] {
  const entries = (Object.entries(filters) as [ProjectListKey, ColumnFilter][]).filter(
    ([k, f]) => k !== except && isActive(f),
  );
  if (entries.length === 0) return rows;
  return rows.filter((r) =>
    entries.every(([k, f]) => {
      if (f.kind === "range") {
        const n = projectNumberOf(r, k);
        if (!Number.isFinite(n)) return false;
        if (f.min !== undefined && n < f.min) return false;
        if (f.max !== undefined && n > f.max) return false;
        return true;
      }
      return projectValuesOf(r, k).some((v) => f.values.includes(v));
    }),
  );
}

/** 드롭다운에 띄울 고유값 + 건수 */
export function projectOptions(rows: ProjectListRow[], key: ProjectListKey): FilterOption[] {
  const counts = new Map<string, number>();
  rows.forEach((r) => {
    projectValuesOf(r, key).forEach((v) => counts.set(v, (counts.get(v) ?? 0) + 1));
  });
  const entityOrder = (v: string) => PROJECT_ENTITIES.indexOf(v as ProjectEntity);
  const statusOrder = (v: string) => PROJECT_STATUSES.indexOf(v as (typeof PROJECT_STATUSES)[number]);
  return [...counts.entries()]
    .map(([value, count]) => ({ value, label: projectLabelOf(key, value), count }))
    .sort((a, b) => {
      // 빈 값은 언제나 맨 아래
      if (a.value === "") return 1;
      if (b.value === "") return -1;
      if (key === "status") return statusOrder(a.value) - statusOrder(b.value);
      if (key === "entity") return entityOrder(a.value) - entityOrder(b.value);
      // 기간은 최근 달부터 — 지난 행사를 찾을 때 보통 가까운 달부터 본다
      if (key === "period" || key === "delivery") return b.value.localeCompare(a.value);
      return a.label.localeCompare(b.label, "ko");
    });
}

/**
 * 정렬. 정렬이 없으면 들어온 순서(sortProjects) 그대로다.
 * 같은 값이면 원래 순서를 지킨다 — 정렬을 풀었을 때 줄이 뒤섞이지 않게.
 */
export function sortProjectRows(rows: ProjectListRow[], sort: ProjectListSort | null): ProjectListRow[] {
  if (!sort) return rows;
  const sign = sort.dir === "asc" ? 1 : -1;
  const text = (r: ProjectListRow): string => {
    if (sort.key === "period") return r.p.startDate ?? "";
    if (sort.key === "delivery") return r.p.deliveryDate ?? "";
    if (sort.key === "status") return String(PROJECT_STATUSES.indexOf(r.p.status));
    if (sort.key === "entity") return r.entities.map((e) => PROJECT_ENTITIES.indexOf(e)).join(",");
    if (sort.key === "ready") return r.s.lineCount ? String(r.s.doneCount / r.s.lineCount) : "";
    if (sort.key === "docs") return String(r.quotes + r.contracts);
    return projectValueOf(r, sort.key);
  };
  return rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => {
      let d: number;
      if (isProjectRangeKey(sort.key)) {
        const x = projectNumberOf(a.r, sort.key);
        const y = projectNumberOf(b.r, sort.key);
        // 값이 없는 줄은 방향과 무관하게 뒤로 — 위로 올라오면 표가 안 읽힌다
        if (!Number.isFinite(x) && !Number.isFinite(y)) d = 0;
        else if (!Number.isFinite(x)) return 1;
        else if (!Number.isFinite(y)) return -1;
        else d = x - y;
      } else {
        const x = text(a.r);
        const y = text(b.r);
        if (x === "" && y !== "") return 1;
        if (y === "" && x !== "") return -1;
        d = x.localeCompare(y, "ko", { numeric: true });
      }
      return d !== 0 ? d * sign : a.i - b.i;
    })
    .map((x) => x.r);
}
