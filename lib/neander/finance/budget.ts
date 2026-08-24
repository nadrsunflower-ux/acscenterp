// ============================================================
//  예산 vs 결산 — 엑셀 「예산vs결산」 시트
// ------------------------------------------------------------
//  엑셀 시트는 계정 3단(상위/하위/세부) × 월별 `예산 | 결산 | 차액` 이다.
//  세부 165개 중 161개가 현행 계정소분류와 그대로 일치해 매핑이 거의 없다.
//
//  범위를 **지출 계정으로 한정**한다. 엑셀 시트도 마케팅비~자산투자비만
//  담고 있고, "이번 달 쓸 수 있는 돈"이 예산의 용도이기 때문이다. 매출
//  목표는 성격이 달라(달성률 vs 집행률) 섞으면 차액의 부호가 헷갈린다.
//
//  결산(실적)은 **순수 지출**(지출 − 개인사용 − 환급)을 쓴다. 개인사용분은
//  회수 대상이고 환급은 이미 돌려받은 돈이라, 예산을 소진한 금액이 아니다.
// ============================================================

import type { FinAccountDoc, FinBudgetDoc } from "./db-types";
import type { TreeNode } from "./report";

/** 지출 계정의 대분류 집합 — 예산 화면이 다룰 범위 */
export function expenseMajors(accounts: FinAccountDoc[]): Set<string> {
  return new Set(accounts.filter((a) => a.txType === "지출").map((a) => a.major));
}

/** 그 달의 예산 줄 (`대|중|소` → 금액) */
export function budgetLinesOf(budgets: FinBudgetDoc[], month: string): Record<string, number> {
  return budgets.find((b) => b.month === month)?.lines ?? {};
}

export const budgetNoteOf = (budgets: FinBudgetDoc[], month: string) =>
  budgets.find((b) => b.month === month)?.note ?? "";

/**
 * 잎에 적힌 예산을 상위로 굴려 올린다.
 *
 * 예산은 **잎(계정소분류)에만** 입력한다. 중·대분류 예산을 따로 받으면
 * 잎 합계와 어긋날 수 있고, 그때 어느 쪽이 맞는지 아무도 모른다.
 */
export function rollupBudget(
  roots: TreeNode[],
  lines: Record<string, number>,
): Record<string, number> {
  const out: Record<string, number> = {};
  const walk = (node: TreeNode): number => {
    const own = node.children.length === 0 ? (lines[node.path] ?? 0) : 0;
    const sum = node.children.reduce((s, c) => s + walk(c), own);
    out[node.path] = sum;
    return sum;
  };
  roots.forEach(walk);
  return out;
}

export interface BudgetSummary {
  budget: number;
  actual: number;
  /** 남은 예산 = 예산 − 결산. 음수면 초과 */
  remaining: number;
  /** 집행률 = 결산 / 예산 */
  rate: number;
  /** 예산을 넘긴 계정 수 (잎 기준) */
  overCount: number;
  /** 예산이 없는데 지출이 있는 계정 수 (잎 기준) */
  unbudgetedCount: number;
  unbudgetedAmount: number;
}

/** 예산 대상(지출 대분류) 안에서의 합계 */
export function budgetSummary(
  roots: TreeNode[],
  rolled: Record<string, number>,
  majors: Set<string>,
): BudgetSummary {
  let budget = 0;
  let actual = 0;
  let overCount = 0;
  let unbudgetedCount = 0;
  let unbudgetedAmount = 0;

  roots
    .filter((r) => majors.has(r.major))
    .forEach((root) => {
      budget += rolled[root.path] ?? 0;
      actual += root.value.expensePure;
      const walkLeaves = (node: TreeNode) => {
        if (node.children.length === 0) {
          const b = rolled[node.path] ?? 0;
          const a = node.value.expensePure;
          if (b > 0 && a > b) overCount += 1;
          if (b === 0 && a > 0) {
            unbudgetedCount += 1;
            unbudgetedAmount += a;
          }
          return;
        }
        node.children.forEach(walkLeaves);
      };
      walkLeaves(root);
    });

  return {
    budget,
    actual,
    remaining: budget - actual,
    rate: budget > 0 ? actual / budget : 0,
    overCount,
    unbudgetedCount,
    unbudgetedAmount,
  };
}

/** 집행률 → 색 (초과는 붉게, 임박은 주의) */
export function rateTone(rate: number, hasBudget: boolean): string {
  if (!hasBudget) return "text-zinc-300";
  if (rate > 1) return "text-rose-600";
  if (rate > 0.9) return "text-amber-600";
  return "text-zinc-600";
}
