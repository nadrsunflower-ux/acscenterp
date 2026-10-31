// 미래 예산 월 선택과 연속 이동을 검증한다. 실제 DB/API에 접근하지 않는다.
// npx tsx scripts/neander/verify-budget-months.ts
import assert from "node:assert/strict";
import { budgetMonthOf, budgetMonths } from "../../lib/neander/finance/budget";
import { todayStrKST } from "../../lib/neander/format";

const current = "2026-10";
let checked = 0;
function check(label: string, run: () => void) {
  run();
  checked++;
  console.log(`✓ ${label}`);
}
function assertContinuous(months: string[]) {
  assert.equal(months.length, new Set(months).size);
  for (let index = 0; index < months.length; index++) {
    assert.match(months[index], /^\d{4}-(0[1-9]|1[0-2])$/);
    if (!index) continue;
    const [newYear, newMonth] = months[index - 1].split("-").map(Number);
    const [oldYear, oldMonth] = months[index].split("-").map(Number);
    assert.equal(newYear * 12 + newMonth - (oldYear * 12 + oldMonth), 1);
  }
}

check("거래·저장 예산이 없는 2028년 선택도 그대로 유지한다", () => {
  assert.equal(budgetMonthOf("2028-04", current), "2028-04");
  const months = budgetMonths(["2026-09"], "2028-04", current);
  assert.equal(months[0], "2029-04");
  assert.ok(months.includes("2028-04"));
  assert.equal(months.at(-1), "2026-09");
  assertContinuous(months);
});
check("비어 있거나 잘못된 월 선택은 이번 달로 돌아간다", () => {
  for (const invalid of ["", "bad", "2026-13", "2026-00", "2026-1", "26-10", "2026-10-01", " 2026-10 "]) {
    assert.equal(budgetMonthOf(invalid, current), current);
    assert.deepEqual(budgetMonths([], invalid, current), budgetMonths([], current, current));
  }
});
check("빈 장부에서도 이번 달과 앞으로 12개월을 고를 수 있다", () => {
  const months = budgetMonths([], "", current);
  assert.equal(months.length, 13);
  assert.equal(months[0], "2027-10");
  assert.equal(months.at(-1), current);
  assertContinuous(months);
});
check("12월에서 다음 해로 넘어가도 월이 중복되거나 빠지지 않는다", () => {
  const months = budgetMonths(["2025-12", "2026-02"], current, current);
  assert.equal(months[0], "2027-10");
  assert.equal(months.at(-1), "2025-12");
  assert.ok(months.includes("2026-01"));
  assert.ok(months.includes("2027-01"));
  assertContinuous(months);
});
check("거래 없는 미래 저장 예산 월과 그 사이 빠진 달도 보존한다", () => {
  const months = budgetMonths(["2026-08", "2029-06"], current, current);
  assert.equal(months[0], "2029-06");
  assert.equal(months.at(-1), "2026-08");
  assert.ok(months.includes("2028-11"));
  assert.ok(months.includes(current));
  assertContinuous(months);
});
check("가장 먼 미래 월을 선택하면 다시 1년 뒤까지 계속 늘어난다", () => {
  const first = budgetMonths([], current, current);
  const second = budgetMonths([], first[0], current);
  const third = budgetMonths([], second[0], current);
  assert.equal(first[0], "2027-10");
  assert.equal(second[0], "2028-10");
  assert.equal(third[0], "2029-10");
  const far = budgetMonths([], "2045-12", current);
  assert.equal(far[0], "2046-12");
  assert.ok(far.includes("2045-12"));
  assertContinuous(far);
});
check("지난 선택 월도 보존하되 미래 범위는 이번 달을 기준으로 연다", () => {
  const months = budgetMonths([], "2025-02", current);
  assert.equal(months[0], "2027-10");
  assert.equal(months.at(-1), "2025-02");
  assert.ok(months.includes(current));
  assertContinuous(months);
});
check("known의 잘못된 월과 중복은 버리고 입력 배열을 바꾸지 않는다", () => {
  const known = ["2026-08", "2026-08", "2026-13", "2026-00", "2026-9", "invalid", "2027-02"];
  const before = [...known];
  const months = budgetMonths(known, current, current);
  assert.deepEqual(known, before);
  assert.equal(months[0], "2027-10");
  assert.equal(months.at(-1), "2026-08");
  assertContinuous(months);
});
check("기본 이번 달은 기기 시간대와 무관하게 KST 월을 쓴다", () => {
  const today = todayStrKST().slice(0, 7);
  assert.equal(budgetMonthOf(""), today);
  assert.ok(budgetMonths([], "").includes(today));
});

console.log(`\n${checked}개 검증 통과 — 실제 DB/API 접근 없음`);
