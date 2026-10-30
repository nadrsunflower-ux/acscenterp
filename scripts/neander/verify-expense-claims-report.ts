// 개인 선결제는 원가이고, 회사의 상환만 현금 지출이다. DB에 연결하지 않는다.
// npx tsx scripts/neander/verify-expense-claims-report.ts
import assert from "node:assert/strict";
import { plOnly, totals } from "@/lib/neander/finance/aggregate";
import type { FinPaymentMethodDoc } from "@/lib/neander/finance/db-types";
import { buildReport, inBasis, isExpenseClaimReimbursement, makeIsCard } from "@/lib/neander/finance/report";
import { buildRunway, DEFAULT_RUNWAY } from "@/lib/neander/finance/runway";
import { expenseClaimPaymentLabel, expenseClaimSearchText, toPatch } from "@/lib/neander/finance/sheet";
import { inScope, paymentIndex, scopeCounts, scopeOf } from "@/lib/neander/finance/sheetScope";
import { buildMerge, buildSplit } from "@/lib/neander/finance/split";
import { netAmount, type FinTransaction } from "@/lib/neander/finance/types";

let checked = 0;
function check(label: string, run: () => void) {
  run();
  checked++;
  console.log(`✓ ${label}`);
}

let seq = 0;
const tx = (patch: Partial<FinTransaction>): FinTransaction => ({
  id: `tx-${++seq}`, date: "2026-10-02", txType: "지출", gross: 100_000, adjust: 0,
  status: "confirmed", createdAt: 0, dedupHash: `hash-${seq}`, site: "네안데르", ...patch,
});
const methods: FinPaymentMethodDoc[] = [
  { id: "4223", last4: "4223", alias: "신한출금", site: "네안데르", personal: false, kind: "account" },
  { id: "3513", last4: "3513", alias: "법인카드", site: "네안데르", personal: false, kind: "card" },
  { id: "1234", last4: "1234", alias: "확인된 개인카드", site: "네안데르", personal: true, kind: "card" },
  { id: "9999", last4: "9999", alias: "현금", site: "네안데르", personal: false, kind: "cash" },
];
const isCard = makeIsCard(methods);
const cost = tx({
  vendor: "공용 구독", bizMajor: "공용", bizMinor: "공용",
  acctMajor: "운영비", acctMid: "일반운영비", acctMinor: "구독서비스비", personalUse: false,
  expenseClaim: { claimId: "claim-a", payer: "김주연", payerKey: "김주연", paymentLabel: "비자075", fileName: "개인경비.xlsx", rowNo: 2 },
});
const refund = tx({ ...cost, id: "refund", date: "2026-10-03", txType: "환급", gross: 10_000, dedupHash: "refund-hash" });
const repayment = (gross: number, patch: Partial<FinTransaction> = {}) => tx({
  date: "2026-10-10", last4: "4223", txType: "자금거래", gross,
  acctMajor: "가수금", acctMid: "가수금관리", acctMinor: "가수금지급", vendor: "김주연",
  expenseReimbursement: { claimId: "claim-a", payer: "김주연" }, ...patch,
});
const paid1 = repayment(60_000, { balanceAfter: 940_000 });
const paid2 = repayment(30_000, { date: "2026-10-20", balanceAfter: 910_000 });
const report = (rows: FinTransaction[], basis: "cash" | "accrual") => buildReport(rows, { basis, isCard }).total;

check("프로젝트·카드번호 없는 회사 비용을 발생주의에 한 번 센다", () => {
  assert.equal(cost.last4, undefined);
  assert.equal(cost.projectCode, undefined);
  assert.equal(report([cost], "accrual").expensePure, 100_000);
  assert.equal(report([cost], "accrual").personal, 0);
  assert.equal(report([cost], "cash").expensePure, 0);
});
check("개인카드 환급은 회사 입금으로 세지 않는다", () => {
  assert.equal(report([cost, refund], "accrual").expensePure, 90_000);
  assert.equal(report([cost, refund], "cash").refund, 0);
  assert.equal(report([cost, refund], "cash").net, 0);
});
check("분할 상환은 실제 통장 출금만 각각 한 번 센다", () => {
  assert.equal(report([cost, refund, paid1], "cash").expensePure, 60_000);
  assert.equal(report([cost, refund, paid1, paid2], "cash").expensePure, 90_000);
  assert.equal(report([cost, refund, paid1, paid2], "accrual").expensePure, 90_000);
  assert.equal(totals(plOnly([cost, refund, paid1, paid2])).net, -90_000);
});
check("한 출금 연결을 해제하면 남은 출금만 현금으로 센다", () => {
  assert.equal(report([cost, refund, { ...paid1, expenseReimbursement: undefined }, paid2], "cash").expensePure, 30_000);
});
check("상환 달이 다르면 비용 발생 달과 회사 현금 지급 달도 다르다", () => {
  const later = { ...paid1, date: "2026-11-10" };
  const october = [cost, refund, later].filter((t) => t.date.startsWith("2026-10"));
  const november = [cost, refund, later].filter((t) => t.date.startsWith("2026-11"));
  assert.equal(report(october, "accrual").expensePure, 90_000);
  assert.equal(report(october, "cash").expensePure, 0);
  assert.equal(report(november, "cash").expensePure, 60_000);
  assert.equal(report(november, "accrual").expensePure, 0);
});
check("대납 태그가 없는 가수금·계좌 이동은 두 기준에서 제외한다", () => {
  for (const legacy of [
    { ...paid1, expenseReimbursement: undefined },
    { ...paid1, acctMajor: "계좌간이동", expenseReimbursement: undefined },
  ]) {
    assert.equal(report([legacy], "cash").count, 0);
    assert.equal(report([legacy], "accrual").count, 0);
  }
});
check("출금 근거가 틀린 태그만으로 현금 지급을 만들지 않는다", () => {
  for (const invalid of [
    { ...paid1, acctMinor: "가수금입금" },
    { ...paid1, acctMid: "잘못된 계정" },
    { ...paid1, last4: undefined },
    { ...paid1, gross: 0 },
    { ...paid1, gross: -1 },
    { ...paid1, gross: Number.NaN },
    { ...paid1, adjust: Number.NaN },
    { ...paid1, expenseReimbursement: { claimId: "", payer: "김주연" } },
    { ...paid1, expenseReimbursement: { claimId: "claim-a", payer: "" } },
    { ...paid1, expenseClaim: cost.expenseClaim },
  ]) {
    assert.equal(isExpenseClaimReimbursement(invalid), false);
    assert.equal(inBasis(invalid, "cash", isCard), false);
  }
  assert.equal(inBasis({ ...paid1, last4: "3513" }, "cash", isCard), false);
});
check("결제수단 필드가 남아 있어도 대납 원가는 회사 현금에서 제외한다", () => {
  assert.equal(report([{ ...cost, last4: "4223" }, { ...refund, last4: "4223" }], "cash").count, 0);
});
check("기존 법인카드 사용과 카드대금은 두 기준에서 계속 한 번씩 센다", () => {
  const charge = tx({ last4: "3513", gross: 20_000 });
  const bill = tx({ last4: "4223", txType: "카드대금결제", gross: 20_000 });
  assert.equal(report([charge, bill], "accrual").expensePure, 20_000);
  assert.equal(report([charge, bill], "cash").expensePure, 20_000);
});

const run = (transactions: FinTransaction[]) => buildRunway({
  transactions, paymentMethods: methods, projects: [],
  settings: { ...DEFAULT_RUNWAY, horizon: 12 }, asOf: "2026-10", today: "2026-10-30",
});
const opening = tx({ date: "2026-10-01", last4: "4223", txType: "자금거래", gross: 1_000_000, balanceAfter: 1_000_000 });
check("회사가 갚기 전 대납은 런웨이의 현금 소진이나 통장 잔액을 줄이지 않는다", () => {
  const before = run([opening, cost, refund]);
  assert.equal(before.baseExpense, 0);
  assert.equal(before.openingCash, 1_000_000);
});
check("런웨이는 실제 상환을 지급 월에 세고 최신 통장 잔액을 다시 차감하지 않는다", () => {
  const after = run([opening, cost, refund, paid1, paid2]);
  assert.equal(after.baseExpense, 30_000); // 9만원 / 최근 3개월
  assert.equal(after.lines.find((l) => l.key === "out:expense-reimbursement")?.base.join(","), "0,0,90000");
  assert.equal(after.openingCash, 910_000);
  assert.equal(after.lines.some((l) => l.key === "out:운영비"), false);
  assert.equal(run([opening, { ...paid1, last4: "3513" }]).baseExpense, 0);
  assert.equal(run([opening, { ...paid1, last4: "9999" }]).baseExpense, 0);
  assert.equal(run([opening, { ...paid1, last4: "8888" }]).baseExpense, 0);
});

const splitRows = (original: FinTransaction, amounts: number[]) => {
  const { rootPatch, children } = buildSplit(original as FinTransaction & Record<string, unknown>, amounts.map((gross) => ({
    gross, bizMajor: original.bizMajor, bizMinor: original.bizMinor,
    acctMajor: original.acctMajor, acctMid: original.acctMid, acctMinor: original.acctMinor,
  })), 1000, "verify@example.test");
  return [
    { ...original, ...rootPatch } as FinTransaction,
    ...children.map((child, i) => ({ ...child, id: `child-${i}` }) as unknown as FinTransaction),
  ];
};
check("실제 비용 나누기 후에도 출처와 합계를 보존하고 현금 비용이 생기지 않는다", () => {
  const parts = splitRows(cost, [33_333, 66_667]);
  assert.equal(parts.reduce((s, t) => s + netAmount(t), 0), 100_000);
  assert.ok(parts.every((t) => t.expenseClaim?.claimId === "claim-a"));
  assert.equal(report(parts, "cash").expensePure, 0);
  assert.equal(report(parts, "accrual").expensePure, 100_000);
  assert.equal(buildMerge(parts)?.gross, 100_000);
});
check("상환 출금을 나눠도 각 조각의 합만큼 현금에 한 번 센다", () => {
  const parts = splitRows(repayment(90_000), [40_000, 50_000]);
  assert.ok(parts.every(isExpenseClaimReimbursement));
  assert.equal(report([cost, refund, ...parts], "cash").expensePure, 90_000);
  assert.equal(report([cost, refund, ...parts], "accrual").expensePure, 90_000);
  assert.equal(run([opening, cost, refund, ...parts]).baseExpense, 30_000);
  const unlinked = parts.map((part, i) => i === 0 ? { ...part, expenseReimbursement: undefined } : part);
  assert.equal(report(unlinked, "cash").expensePure, 50_000);
});
check("개인경비·통장·법인카드·현금·미지정의 건수가 전체와 맞는다", () => {
  const rows = [cost, refund, paid1, tx({ last4: "3513" }), tx({ last4: "1234" }), tx({ last4: "9999" }), tx({})];
  const index = paymentIndex(methods);
  assert.equal(scopeOf(cost, index), "employee");
  assert.equal(scopeOf(paid1, index), "account");
  assert.equal(inScope(cost, "card", index), false);
  const counts = scopeCounts(rows, index);
  assert.equal(counts.employee, 3);
  assert.equal(counts.card, 1);
  assert.equal(counts.unknown, 1);
  assert.equal(counts.account + counts.card + counts.employee + counts.cash + counts.unknown, counts.all);
});
check("부분 카드 표기와 결제자는 출처로 표시·검색하고 가짜 뒷자리를 만들지 않는다", () => {
  assert.equal(expenseClaimPaymentLabel(cost), "김주연 · 비자075 · 대납");
  assert.equal(expenseClaimPaymentLabel(cost)?.includes("0075"), false);
  assert.equal(cost.last4, undefined);
  for (const keyword of ["김주연", "비자075", "개인경비.xlsx", "claim-a"]) assert.ok(expenseClaimSearchText(cost).includes(keyword));
  assert.ok(expenseClaimSearchText(paid1).includes("상환"));
  assert.equal(expenseClaimSearchText(tx({})), "");
  const patch = toPatch({ ...cost, note: "분류 메모를 추가" });
  assert.equal("expenseClaim" in patch, false);
  assert.equal("expenseReimbursement" in patch, false);
  assert.equal("dedupHash" in patch, false);
  assert.equal(typeof toPatch(tx({})).dedupHash, "string");
});

console.log(`\n${checked}개 검증 통과 — 실제 DB 읽기·쓰기 없음`);
