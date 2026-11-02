import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyProject, projectSummary, type FinProjectDoc } from "./project";
import { applyProjectFilters, isProjectRangeKey, projectNumberOf, sortProjectRows, type ProjectListRow } from "./project-list";

function row(id: string, patch: Partial<FinProjectDoc>): ProjectListRow {
  const p: FinProjectDoc = { ...emptyProject(), id, code: id, name: id, createdAt: 0, ...patch };
  return { p, s: projectSummary(p, [], "2026-10-31"), quotes: 0, contracts: 0, entities: [] };
}

const ids = (rows: ProjectListRow[]) => rows.map(({ p }) => p.id);

test("sales sort uses the chosen supply or billed total when VAT modes differ", () => {
  const rows = [
    row("taxable", { contractAmount: 1_000, vatMode: "excluded" }),
    row("exempt", { contractAmount: 1_050, vatMode: "exempt" }),
    row("inclusive", { contractAmount: 1_067, vatMode: "included" }),
  ];
  assert.deepEqual(ids(sortProjectRows(rows, { key: "revenue", dir: "asc" })), ["inclusive", "taxable", "exempt"]);
  assert.deepEqual(ids(sortProjectRows(rows, { key: "revenueTotal", dir: "asc" })), ["exempt", "inclusive", "taxable"]);
  assert.deepEqual(ids(applyProjectFilters(rows, { revenueTotal: { kind: "range", min: 1_060, max: 1_080 } })), ["inclusive"]);
  assert.deepEqual(ids(rows), ["taxable", "exempt", "inclusive"], "sorting leaves the source order intact");
});

test("settlement columns retain received, returned and overdue totals from the project summary", () => {
  const paid = row("paid", {
    contractAmount: 1_000, vatMode: "excluded",
    installments: [{ id: "paid", kind: "선금", amount: 400, received: true }],
    deductions: [{ id: "refund", label: "반환", amount: 100, taxMode: "none", returned: true }],
  });
  const late = row("late", {
    contractAmount: 1_050, vatMode: "exempt",
    installments: [{ id: "late", kind: "잔금", amount: 500, dueDate: "2026-10-01" }],
  });
  assert.equal(projectNumberOf(paid, "received"), 440);
  assert.equal(projectNumberOf(paid, "returned"), 100);
  assert.equal(projectNumberOf(late, "overdue"), 500);
  assert.equal(projectNumberOf(paid, "revenueTotal"), 1_000, "a non-VAT-adjusted refund does not cause a blanket 1.1 conversion");
  for (const key of ["revenueTotal", "received", "returned", "overdue"] as const) assert.equal(isProjectRangeKey(key), true);
  for (const key of ["received", "returned"] as const) {
    assert.deepEqual(ids(sortProjectRows([late, paid], { key, dir: "desc" })), ["paid", "late"]);
    assert.deepEqual(ids(applyProjectFilters([late, paid], { [key]: { kind: "range", min: 1 } })), ["paid"]);
  }
  assert.deepEqual(ids(sortProjectRows([paid, late], { key: "overdue", dir: "desc" })), ["late", "paid"]);
  assert.deepEqual(ids(applyProjectFilters([paid, late], { overdue: { kind: "range", min: 100 } })), ["late"]);
});

test("existing profit filters, stable ties and unsorted views remain unchanged", () => {
  const a = row("a", { contractAmount: 1_000 });
  const b = row("b", { contractAmount: 1_000 });
  const c = row("c", { contractAmount: 2_000 });
  const rows = [b, a, c];
  assert.deepEqual(ids(sortProjectRows(rows, { key: "profit", dir: "desc" })), ["c", "b", "a"]);
  assert.deepEqual(ids(applyProjectFilters(rows, { profit: { kind: "range", max: 1_500 } })), ["b", "a"]);
  assert.equal(sortProjectRows(rows, null), rows);
});
