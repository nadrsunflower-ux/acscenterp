// ============================================================
//  프로젝트 보고서 첫 장(요약) 검증 — lib/neander/finance/project-report.ts
// ------------------------------------------------------------
//  손으로 셀 수 있는 작은 프로젝트로 중간 보고 · 결산의 숫자를 확인한다.
//
//    npm run finance:verify-project-report
// ============================================================

import { laborCost, laborTotal, projectSummary, sanitizeLabor, sanitizeProject, type FinProjectDoc } from "@/lib/neander/finance/project";
import type { FinTransaction } from "@/lib/neander/finance/types";
import {
  bigVariances,
  checkItems,
  costSplit,
  nextPayment,
  reportPhase,
  scheduleText,
  suggestDayRates,
  verdictLine,
} from "@/lib/neander/finance/project-report";

let fails = 0;
const eq = (got: unknown, want: unknown, label: string) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(ok ? "ok  " : "FAIL", label, ok ? "" : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
};
const has = (list: { text: string }[], part: string) => list.some((c) => c.text.includes(part));

const base = {
  id: "p",
  code: "T-1",
  name: "검증",
  status: "active",
  contractAmount: 10_000_000,
  vatMode: "excluded",
  startDate: "2026-10-25",
  endDate: "2026-10-26",
  revenues: [],
  createdAt: 0,
  installments: [
    { id: "a", kind: "선금", amount: 3_000_000, dueDate: "2026-09-30", paidDate: "2026-09-30" },
    { id: "b", kind: "중도금", amount: 3_000_000, dueDate: "2026-10-10" },
    { id: "c", kind: "잔금", amount: 3_000_000 },
  ],
  lines: [
    // 확정: 견적 1,000,000 → 실제 1,400,000 (+40% · +400,000) — 큰 차이
    { id: "l1", category: "물품", item: "키오스크", qty: 1, unitPrice: 1_000_000, actual: 1_400_000, done: true, note: "환율" },
    // 확정: 견적 500,000 → 실제 520,000 (+4%) — 작은 차이
    { id: "l2", category: "물품", item: "인쇄", qty: 1, unitPrice: 500_000, actual: 520_000, done: true },
    // 남은 예상: 견적 600,000
    { id: "l3", category: "식대", item: "현장 식대", qty: 6, unitPrice: 100_000 },
  ],
} as unknown as FinProjectDoc;

const today = "2026-10-19";
const s = projectSummary(base, []);
const cost = costSplit(base.lines);

eq(reportPhase("active"), "interim", "진행 중 → 중간 보고");
eq(reportPhase("done"), "final", "완료 → 결산");
eq(cost, { plan: 2_100_000, confirmed: 1_920_000, remaining: 600_000, forecast: 2_520_000, confirmedLines: 2, remainingLines: 1 }, "원가 — 확정과 남은 예상을 섞지 않는다");
eq(cost.forecast, s.actual, "예상 최종 = 기존 「실제 원가」(빈 줄은 견적)");
eq(costSplit([...base.lines, { id: "z", category: "장비", item: "보유 포토부스", qty: 1 }] as FinProjectDoc["lines"]).confirmedLines, 3, "견적 0원 줄은 확정(0원)으로 센다");

const v = bigVariances(base.lines);
eq(v.map((x) => [x.line.id, x.diff]), [["l1", 400_000]], "큰 차이 — 10% 이상이면서 10만 원 이상만");

eq(scheduleText("2026-10-25", "2026-10-26", today), "시작까지 D-6", "일정 — 시작 전");
eq(scheduleText("2026-10-18", "2026-10-20", today), "진행 2일째 · 총 3일", "일정 — 진행 중");
eq(scheduleText("2026-10-01", "2026-10-02", today), "끝난 지 17일", "일정 — 끝난 뒤");
eq(scheduleText(undefined, undefined, today), "기간 미정", "일정 — 없음");

const n = nextPayment(base, today);
eq([n?.kind, n?.amount, n?.overdue], ["중도금", 3_300_000, true], "다음 입금 — 가장 이른 미입금 회차(부가세 포함) · 지났으면 연체");

const checks = checkItems(base, s, cost, "interim", today);
eq(checks[0].tone, "danger", "확인할 것 — 연체가 맨 앞");
eq(has(checks, "받을 날이 없는 회차 1건"), true, "받을 날 없는 회차");
eq(has(checks, "회차 합계가 계약 청구액보다 1,100,000원 적습니다"), true, "회차 합계 ≠ 계약");
eq(checks.find((c) => c.text.includes("실제금액이 없는 줄"))?.tone, "info", "중간 보고 — 빈 실제금액은 참고");
eq(checks.find((c) => c.text.includes("준비 안 된 줄"))?.tone, "warning", "시작 7일 안 — 준비 안 된 줄은 경고");
const finals = checkItems({ ...base, status: "done" }, s, cost, "final", today);
eq(finals.find((c) => c.text.includes("실제금액이 빈 줄"))?.tone, "warning", "결산 — 빈 실제금액은 경고");
eq(has(finals, "준비 안 된 줄"), false, "결산에는 준비 항목이 없다");

// 원장 대조 — 확정 원가와만 견준다
const withLedger = { ...s, ledger: { count: 3, income: 0, expense: 2_500_000, refund: 0 } };
eq(has(checkItems(base, withLedger, cost, "interim", today), "원장 지출이 확정 원가보다 580,000원 많습니다"), true, "원장 지출 > 확정 원가");

const verdict = verdictLine(s, "interim", checks);
// 수입 10,000,000 · 계획 이익률 79% → 예상 74.8% (−4%p)
eq(verdict[0], "계획 이익률 79% → 예상 75% (-4%p)", "판정 — 이익률 계획 → 예상");
eq(verdict[1], "미수 7,700,000원 (연체 1건)", "판정 — 미수");
eq(verdict[2].startsWith("확인할 것 "), true, "판정 — 확인할 것 개수");

const empty = { ...base, lines: [], installments: [] } as unknown as FinProjectDoc;
const se = projectSummary(empty, []);
const ce = checkItems(empty, se, costSplit([]), "interim", today);
eq(has(ce, "지출 줄이 없습니다"), true, "지출 줄 없음 경고");
eq(has(ce, "입금 회차가 없습니다"), true, "입금 회차 없음 경고");

// ---- 사내 인력 ----
const sl0 = sanitizeLabor({ name: " 이동주 ", days: 1.234, dayRate: -5 });
eq([sl0.name, sl0.days, sl0.dayRate, typeof sl0.id], ["이동주", 1.23, 0, "string"], "인력 다듬기 — 이름 공백 · 일수 소수 둘째 자리 · 음수 단가 0");
eq(laborCost({ days: 2.5, dayRate: 180_000 }), 450_000, "인력 금액 = 일수 × 하루 단가");
const labor = [{ id: "a", name: "이동주", days: 3, dayRate: 200_000 }, { id: "b", name: "유다혜", days: 2, dayRate: 150_000 }];
eq(laborTotal(labor), 900_000, "인력 합계");
const saved = sanitizeProject({ ...base, labor: [...labor, { id: "c", name: "", days: 0, dayRate: 0 }], todos: [{ id: "t", text: " 잔금 청구 " }, { id: "e", text: "  " }], lessons: " 다음엔 식대 견적 " } as never);
eq(saved.ok && [saved.value.labor?.length, saved.value.todos?.map((t) => t.text), saved.value.lessons], [2, ["잔금 청구"], "다음엔 식대 견적"], "저장 — 빈 인력 줄 · 빈 할 일은 버리고 글자는 다듬는다");

const withLabor = { ...base, labor, todos: [{ id: "t1", text: "잔금 청구" }, { id: "t2", text: "장비 반납", done: true }] } as unknown as FinProjectDoc;
const sl = projectSummary(withLabor, []);
const vl = verdictLine(sl, "interim", checkItems(withLabor, sl, costSplit(withLabor.lines), "interim", today), { labor: 900_000, openTodos: 1 });
// 수입 10,000,000 − 원가 2,520,000 − 인력 900,000 = 6,580,000 → 66%
eq(vl.includes("인력 반영 66%"), true, "판정 — 인력 반영 이익률");
eq(vl.includes("남은 일 1건"), true, "판정 — 끝나지 않은 남은 일 수");
eq(checks.find((c) => c.text.includes("사내 인력을 안 적었습니다"))?.tone, "info", "중간 보고 — 사내 인력 빈칸은 참고");
eq(finals.find((c) => c.text.includes("사내 인력을 안 적었습니다"))?.tone, "warning", "결산 — 사내 인력 빈칸은 경고");
eq(has(checkItems(withLabor, sl, costSplit(withLabor.lines), "final", today), "사내 인력을 안 적었습니다"), false, "사내 인력을 적으면 경고가 없다");

// 하루 단가 추천 — 끝난 달 최근 3개월 급여, 급여가 찍힌 달로만 나눈다
const pay = (date: string, vendor: string, gross: number) =>
  ({ id: date + vendor, date, txType: "지출", acctMajor: "인건비", acctMid: "급여", acctMinor: "직원급여", vendor, gross, adjust: 0, status: "confirmed", dedupHash: "", createdAt: 0 }) as FinTransaction;
const hints = suggestDayRates(
  [
    pay("2026-07-10", "유다혜", 2_600_000),
    pay("2026-08-10", "유다혜", 2_600_000),
    pay("2026-09-10", "유다혜", 2_600_000),
    pay("2026-10-10", "유다혜", 9_999_999), // 이번 달 — 안 센다
    pay("2026-09-10", "새사람", 2_100_000), // 한 달만 — 그 달로 나눈다
  ],
  "2026-10",
);
// 2,600,000 × 1.1 ÷ 21 = 136,190.4 → 137,000 · 2,100,000 × 1.1 ÷ 21 = 110,000
eq(hints.map((h) => [h.name, h.dayRate, h.months]), [["유다혜", 137_000, 3], ["새사람", 110_000, 1]], "하루 단가 추천 — 월평균 × 1.1 ÷ 21, 천 원 올림");

console.log(fails ? `\n${fails}건 실패` : "\n전부 통과");
process.exit(fails ? 1 : 0);
