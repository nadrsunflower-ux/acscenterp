// 급여 지급 — 다듬기 · 장부 맞추기 · 새 달 시작 · 알림 금액 (`npm run finance:test-payroll`)
//  공개 저장소라 실제 이름 · 금액 · 계좌를 두지 않는다 — 모두 지어낸 값이다.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  copyPlan,
  matchPayroll,
  nameFromVendor,
  payrollTotals,
  planFromLedger,
  plannedAmount,
  previousAmount,
  sanitizePayroll,
  upcomingPayMonth,
  type PayrollInput,
} from "./payroll";
import { buildMoneyRows, rowTitle, type MoneyRule } from "./money-calendar";
import type { FinTransaction } from "./types";

const tx = (date: string, vendor: string, gross: number, extra: Partial<FinTransaction> = {}) =>
  ({ id: `${date}-${vendor}-${gross}`, date, vendor, gross, adjust: 0, txType: "지출", status: "confirmed", ...extra }) as unknown as FinTransaction;
const pay = (date: string, vendor: string, gross: number, site: string, acctMinor = "직원급여") =>
  tx(date, vendor, gross, { acctMajor: "인건비", acctMid: "급여", acctMinor, site } as Partial<FinTransaction>);

const plan: PayrollInput = {
  id: "2026-12",
  payDate: "2026-12-01",
  lines: [
    { id: "a", name: "가나다", entity: "네안데르", amount: 2_000_000, bank: "가은행", account: "000-00-0000" },
    { id: "b", name: "가나다", entity: "안다르", amount: 700_000 },
    { id: "c", name: "라마바", entity: "네안데르", amount: 1_500_000 },
    { id: "d", name: "사아자", entity: "네안데르", amount: 900_000 },
    { id: "e", name: "차카타", entity: "일해라컴퍼니", amount: 3_000_000, sent: "2026-12-01" },
  ],
};

test("다듬기 — 빈 줄은 버리고 빈 칸은 지운다", () => {
  const r = sanitizePayroll({ id: "2026-12", lines: [{ id: "x", name: " 가나다 ", amount: "1200000.4", bank: "  ", entity: "없는회사" }, { id: "y", name: "", amount: 0 }] });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.value.payDate, "2026-12-01");
  assert.deepEqual(r.value.lines, [{ id: "x", name: "가나다", amount: 1_200_000 }]);
  assert.equal(sanitizePayroll({ id: "2026-13" }).ok, false);
  assert.equal(sanitizePayroll({ id: "2026-12", payDate: "12월 1일" }).ok, false);
});

test("처음 보여 줄 달 — 5일까지는 이번 달 지급, 그 뒤는 다음 달", () => {
  assert.equal(upcomingPayMonth("2026-12-03"), "2026-12");
  assert.equal(upcomingPayMonth("2026-11-25"), "2026-12");
  assert.equal(upcomingPayMonth("2026-12-28"), "2027-01");
});

test("장부 맞추기 — 이름 · 회사 · 금액, 수수료 차이, 금액 다름, 직접 표시, 지남", () => {
  const txs = [
    pay("2026-12-01", "가나다", 2_000_000, "네안데르"),
    pay("2026-12-01", "가나다", 700_500, "안다르"), // 이체 수수료 500원
    pay("2026-12-02", "12월 라마바 인건비", 1_800_000, "네안데르"), // 금액 다름 (반 안쪽)
    pay("2026-12-01", "가나다", 2_000_000, "와작홈즈"), // 다른 회사 — 붙지 않는다
    pay("2026-11-20", "사아자", 900_000, "네안데르"), // 범위(앞 5일) 밖
  ];
  const before = matchPayroll(plan, txs, "2026-11-30");
  assert.equal(before.get("a")?.state, "sent");
  assert.equal(before.get("b")?.state, "sent");
  assert.equal(before.get("b")?.diff, 500);
  assert.equal(before.get("c")?.state, "diff");
  assert.equal(before.get("c")?.diff, 300_000);
  assert.equal(before.get("d")?.state, "open");
  assert.equal(before.get("e")?.state, "manual");
  assert.equal(matchPayroll(plan, txs, "2026-12-02").get("d")?.state, "late");
});

test("장부 맞추기 — 같은 사람 두 줄이 같은 회사면 금액이 맞는 쪽부터 짝을 짓는다", () => {
  const two: PayrollInput = {
    id: "2026-12",
    payDate: "2026-12-01",
    lines: [
      { id: "near", name: "가나다", amount: 1_000_000 },
      { id: "exact", name: "가나다", amount: 1_000_400 },
    ],
  };
  const m = matchPayroll(two, [tx("2026-12-01", "가나다", 1_000_400), tx("2026-12-01", "가나다", 1_000_000, { id: "second" } as Partial<FinTransaction>)], "2026-12-01");
  assert.equal(m.get("exact")?.diff, 0);
  assert.equal(m.get("near")?.diff, 0);
});

test("합계 — 회사별 · 보낸 돈", () => {
  const status = matchPayroll(plan, [pay("2026-12-01", "가나다", 2_000_000, "네안데르")], "2026-12-01");
  const t = payrollTotals(plan.lines, status);
  assert.equal(t.count, 5);
  assert.equal(t.amount, 8_100_000);
  assert.equal(t.sentCount, 2); // 장부 1 + 직접 표시 1
  assert.equal(t.sentAmount, 5_000_000);
  assert.deepEqual(
    t.byEntity.map((e) => [e.entity, e.amount, e.left]),
    [
      ["네안데르", 4_400_000, 2_400_000],
      ["일해라컴퍼니", 3_000_000, 0],
      ["안다르", 700_000, 700_000],
    ],
  );
});

test("새 달 — 지난달 표를 가져오면 보냄 표시만 지워진다 · 지난번 금액은 id 로 찾는다", () => {
  const next = copyPlan(plan, "2027-01");
  assert.equal(next.payDate, "2027-01-01");
  assert.equal(next.lines.length, 5);
  assert.equal(next.lines.find((l) => l.id === "e")?.sent, undefined);
  assert.equal(next.lines[0].account, "000-00-0000");
  assert.equal(previousAmount({ ...next.lines[0], amount: 1 }, plan), 2_000_000);
  assert.equal(previousAmount({ id: "new", name: "라마바", entity: "네안데르", amount: 1 }, plan), 1_500_000);
  assert.equal(previousAmount({ id: "new", name: "없는 사람", amount: 1 }, plan), undefined);
});

test("장부에서 시작 — 가장 최근 1일 무렵 급여 출금 묶음", () => {
  const txs = [
    pay("2026-10-01", "가나다", 1_000_000, "네안데르"),
    pay("2026-10-01", "라마바", 1_000_000, "네안데르"),
    pay("2026-10-01", "사아자", 1_000_000, "네안데르"),
    pay("2026-10-31", "10월 가나다 인건비", 2_000_000, "네안데르"), // 11/1 몫을 말일에 당겨 보냄
    pay("2026-11-01", "라마바 급여", 2_100_000, "안다르", "임원급여"),
    pay("2026-11-03", "사아자", 2_200_000, "네안데르"),
    pay("2026-11-20", "사아자", 50_000, "네안데르"), // 범위 밖
    tx("2026-11-01", "가나다", 9_999, { acctMajor: "복리후생비" } as Partial<FinTransaction>),
  ];
  const r = planFromLedger(txs, "2026-12", "2026-12-01");
  assert.ok(r);
  assert.equal(r!.from, "2026-11-01");
  assert.deepEqual(
    r!.plan.lines.map((l) => [l.name, l.amount, l.entity, l.kind]),
    [
      ["가나다", 2_000_000, "네안데르", "직원"],
      ["사아자", 2_200_000, "네안데르", "직원"],
      ["라마바", 2_100_000, "안다르", "임원"],
    ],
  );
  assert.equal(nameFromVendor("김명연 급여"), "김명연");
  assert.equal(nameFromVendor("월급"), "월급");
});

test("돈 나가는 날 — 급여 규칙이 그 달 표의 그 회사 몫을 금액으로 쓴다", () => {
  assert.deepEqual(plannedAmount(plan, "네안데르"), { amount: 4_400_000, count: 3 });
  assert.equal(plannedAmount(plan, "와작홈즈"), null);
  const rule: MoneyRule = { id: "payroll", kind: "급여·월세", label: "급여 (네안데르)", day: 1, shift: "none", match: { site: "네안데르", acctMid: "급여" } };
  const old = [pay("2026-11-01", "가나다", 1_000_000, "네안데르")];
  const [row] = buildMoneyRows([rule], old, "2026-11-28", "2026-12-05", (occ) => {
    const p = plannedAmount(occ.nominal.startsWith("2026-12") ? plan : undefined, occ.rule.match?.site);
    return p ? { amount: p.amount, note: `급여 지급 표 ${p.count}줄` } : null;
  });
  assert.equal(row.amount, 4_400_000);
  assert.equal(rowTitle(row), "🟠 4,400,000원 · 급여 (네안데르)");
  assert.match(row.basis, /급여 지급 표 3줄 · 지난번 11\/1\(일\) 1,000,000원/);
  // 표가 없으면 예전처럼 지난번 금액
  const [bare] = buildMoneyRows([rule], old, "2026-11-28", "2026-12-05");
  assert.equal(rowTitle(bare), "🟠 약 100만 원 · 급여 (네안데르)");
});
