// ============================================================
//  지원사업 셈 검사 (lib/neander/finance/grant.ts) — DB 를 쓰지 않는다
//    npx tsx scripts/neander/verify-grants.ts
// ============================================================
import {
  ALLOC_IN,
  ALLOC_OUT,
  grantSummary,
  installmentViews,
  monthlyInstallments,
  newGrantInstallment,
  sanitizeGrant,
  type FinGrantInput,
} from "@/lib/neander/finance/grant";
import type { FinTransaction } from "@/lib/neander/finance/types";

let failed = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) console.log(`  ✓ ${name}`);
  else {
    failed += 1;
    console.log(`  ✗ ${name}`, detail ?? "");
  }
};

let seq = 0;
const tx = (p: Partial<FinTransaction>): FinTransaction =>
  ({ id: `t${++seq}`, date: "2026-09-15", txType: "지출", gross: 0, adjust: 0, status: "confirmed", dedupHash: `h${seq}`, createdAt: 0, ...p }) as FinTransaction;

const income = (date: string, amount: number, p: Partial<FinTransaction> = {}) =>
  tx({ date, txType: "수입", gross: amount, acctMajor: "기타수입", acctMid: "지원금", acctMinor: "창업지원금", ...p });

console.log("매달 회차");
{
  const list = monthlyInstallments("2026-11", "2027-02", 31, 8_800_000);
  check("4개", list.length === 4, list.length);
  check("해를 넘기면 해를 붙인다", list[0].label === "26년 11월분" && list[3].label === "27년 2월분", list.map((i) => i.label));
  check("없는 날은 말일로 (2월 31일 → 28일)", list[3].dueDate === "2027-02-28", list[3].dueDate);
  check("11월 31일 → 30일", list[0].dueDate === "2026-11-30", list[0].dueDate);
  const one = monthlyInstallments("2026-09", "2026-10", 15, 1);
  check("한 해 안이면 해를 안 붙인다", one[0].label === "9월분", one[0].label);
}

console.log("회차 채우기 (들어온 순서)");
{
  const insts = [
    { ...newGrantInstallment("10월분", 8_800_000), dueDate: "2026-10-15" },
    { ...newGrantInstallment("9월분", 8_800_000), dueDate: "2026-09-15" },
    { ...newGrantInstallment("11월분", 8_800_000), dueDate: "2026-11-15" },
  ];
  const v = installmentViews(insts, 8_800_000 * 2 - 2_000, "2026-11-20");
  check("화면 순서는 적은 순서", v.map((x) => x.inst.label).join(",") === "10월분,9월분,11월분");
  check("9월 · 10월 받음 (수수료 2천 원 모자라도)", v[0].status === "paid" && v[1].status === "paid", v.map((x) => x.status));
  check("11월 늦음", v[2].status === "overdue" && v[2].remaining === 8_800_000, v[2]);
  const half = installmentViews(insts, 8_800_000 + 4_500_000, "2026-10-01");
  check("일부", half.find((x) => x.inst.label === "10월분")?.status === "partial");
  check("아직이면 예정", half.find((x) => x.inst.label === "11월분")?.status === "planned");
}

console.log("원장에서 고르기");
{
  const g: FinGrantInput = {
    code: "GR-START",
    name: "창업",
    kind: "창업지원금",
    status: "active",
    total: 17_600_000,
    accounts: ["9678"],
    startDate: "2026-09-01",
    endDate: "2027-02-28",
    installments: [
      { ...newGrantInstallment("9월분", 8_800_000), dueDate: "2026-09-15" },
      { ...newGrantInstallment("10월분", 8_800_000), dueDate: "2026-10-15" },
    ],
    budget: [
      { id: "L1", item: "인건비", label: "김제연", amount: 12_900_000, who: "김제연", acct: "인건비" },
      { id: "L2", item: "임차료", amount: 27_000_000 },
    ],
  };
  // 9월 — 하루에 세 건으로
  const a = income("2026-09-15", 2_150_000, { last4: "9678" });
  const b = income("2026-09-15", 2_150_000, { last4: "9678" });
  const c = income("2026-09-15", 4_500_000, { last4: "9678" });
  // 10월 — 두 건만 원장에 있고 한 건은 다른 통장(조건 밖) → 사람이 넣는다
  const d = income("2026-10-12", 4_400_000, { last4: "9678" });
  const e = income("2026-10-12", 4_400_000, { last4: "4248", vendor: "세종중앙" });
  const other = income("2026-10-12", 1_000_000, { last4: "4248", acctMinor: "고용지원금", vendor: "기술벤처스" });
  const wrong = income("2026-10-20", 500_000, { last4: "9678" });
  const refund = tx({ date: "2026-12-01", txType: "지출", gross: 300_000, acctMajor: "환불·반환", acctMid: "환불지출", acctMinor: "지원금환불", last4: "9678" });
  const salary = tx({ date: "2026-09-25", gross: 2_500_000, vendor: "김제연", acctMajor: "인건비", acctMid: "급여", last4: "4223" });
  const salaryBefore = tx({ date: "2026-08-25", gross: 2_500_000, vendor: "김제연", acctMajor: "인건비", acctMid: "급여", last4: "4223" });
  const rent = tx({ date: "2026-09-30", gross: 4_500_000, vendor: "건물주", acctMajor: "임차료", last4: "4223", projectCode: "gr-start" });
  const fromAcct = tx({ date: "2026-10-01", gross: 100_000, vendor: "쿠팡", acctMajor: "운영비", last4: "9678" });
  const move = tx({ date: "2026-10-02", txType: "자금거래", gross: 5_000_000, last4: "9678" });
  const all = [a, b, c, d, e, other, wrong, refund, salary, salaryBefore, rent, fromAcct, move];

  const s0 = grantSummary(g, all, "2026-12-31");
  check("전용 계좌 입금만 (다른 통장 · 다른 지원금 빼고)", s0.ledger.incomes.length === 5, s0.ledger.incomes.map((x) => x.tx.id));

  const g2 = { ...g, alloc: { [e.id]: ALLOC_IN, [wrong.id]: ALLOC_OUT } };
  const s = grantSummary(g2, all, "2026-12-31");
  check("사람이 넣은 입금 · 뺀 입금", s.ledger.incomes.length === 5 && s.ledger.incomes.some((x) => x.tx.id === e.id && x.why === "manual") && !s.ledger.incomes.some((x) => x.tx.id === wrong.id));
  check("반납은 받은 돈에서 뺀다", s.refunded === 300_000 && s.received === 17_600_000 - 300_000, { refunded: s.refunded, received: s.received });
  check("반납만큼 10월분이 일부로", s.installments[1].status === "partial", s.installments.map((v) => v.status));
  check("남은 지원금", s.remaining === 300_000, s.remaining);
  const spendIds = s.ledger.spends.map((x) => x.tx.id);
  check("단서로 찾은 인건비 (협약 전 급여는 빼고)", spendIds.includes(salary.id) && !spendIds.includes(salaryBefore.id), spendIds);
  check("코드 꼬리표 (대소문자 무시)", s.ledger.spends.some((x) => x.tx.id === rent.id && x.why === "code"));
  // 비목 미정 = 전용 계좌 지출 10만 + 단서 없는 비목이라 못 정한 코드 꼬리표 월세 450만
  check("전용 계좌 지출 · 단서 없는 꼬리표는 비목 미정", s.ledger.spends.some((x) => x.tx.id === fromAcct.id && !x.lineId) && s.unassigned === 4_600_000, s.unassigned);
  check("자금거래 · 반납은 쓴 돈이 아니다", !spendIds.includes(move.id) && !spendIds.includes(refund.id));
  check("비목별 쓴 돈", s.budget.find((x) => x.line.id === "L1")?.spent === 2_500_000, s.budget);

  const g3 = { ...g2, alloc: { ...g2.alloc, [rent.id]: "L2", [fromAcct.id]: ALLOC_OUT } };
  const s3 = grantSummary(g3, all, "2026-12-31");
  check("비목 배정", s3.budget.find((x) => x.line.id === "L2")?.spent === 4_500_000);
  check("뺀 지출", !s3.ledger.spends.some((x) => x.tx.id === fromAcct.id) && s3.unassigned === 0);

  const byPayer = grantSummary({ ...g, accounts: undefined, payer: "(사)기술 벤처스" }, all, "2026-12-31");
  check("입금자로 찾기 ((사) · 띄어쓰기 무시)", byPayer.ledger.incomes.length === 1 && byPayer.ledger.incomes[0].tx.id === other.id);
  const noRoute = grantSummary({ ...g, accounts: undefined }, all, "2026-12-31");
  check("조건이 없으면 코드 꼬리표만", noRoute.ledger.incomes.length === 0);
}

console.log("저장 전 다듬기");
{
  const r = sanitizeGrant({
    code: " GR ",
    name: " 이름 ",
    kind: "없는종류" as never,
    total: "1000" as never,
    accounts: ["9678", "12", "9678"],
    installments: [newGrantInstallment(), { ...newGrantInstallment("1차", 100), dueDate: "2026-11-30", dueApprox: "late" }],
    budget: [{ id: "L1", item: "인건비", amount: 1 }, { id: "L2", item: "", amount: 0 }],
    alloc: { a: "L1", b: "L2", c: "in", d: "x", e: "nope" },
  });
  check("통과", r.ok);
  if (r.ok) {
    const v = r.value;
    check("공백 다듬기", v.code === "GR" && v.name === "이름");
    check("모르는 종류는 정부지원금", v.kind === "정부지원금");
    check("계좌는 네 자리만 · 겹침 없이", JSON.stringify(v.accounts) === '["9678"]', v.accounts);
    check("빈 회차 · 빈 비목은 버린다", v.installments.length === 1 && v.budget.length === 1);
    check("없는 비목 · 모르는 값의 배정은 버린다", JSON.stringify(Object.keys(v.alloc ?? {}).sort()) === '["a","c","d"]', v.alloc);
    check("대략 날짜는 구간 끝 날", v.installments[0].dueDate === "2026-11-30" && v.installments[0].dueApprox === "late");
  }
  check("이름 없으면 거절", !sanitizeGrant({ code: "X", name: " " }).ok);
}

console.log(failed === 0 ? "\n모두 통과" : `\n실패 ${failed}건`);
process.exit(failed === 0 ? 0 : 1);
