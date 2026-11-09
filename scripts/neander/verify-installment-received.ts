// ============================================================
//  입금 회차 「받음」 판단 검증 — 입금일을 몰라도 받은 돈
// ------------------------------------------------------------
//  회차의 받음 여부는 isInstallmentReceived 하나로 판단한다
//  (입금일이 있거나 received 표시). 미수금 · 런웨이 받을 돈 ·
//  다음 입금 · 확인할 것 · 저장 다듬기가 같은 답을 내는지 본다. DB 는 안 건드린다.
//
//    npm run finance:verify-installments
// ============================================================

import {
  installmentFromBilled,
  installmentSplit,
  installmentStatus,
  installmentStatusText,
  isInstallmentReceived,
  paidLabel,
  projectSummary,
  rebaseInstallments,
  sanitizeInstallment,
  sanitizeProject,
  type FinProjectDoc,
  type FinProjectInstallment,
} from "@/lib/neander/finance/project";
import { checkItems, costSplit, nextPayment } from "@/lib/neander/finance/project-report";
import { projectInflows } from "@/lib/neander/finance/runway";

let fails = 0;
const eq = (got: unknown, want: unknown, label: string) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(ok ? "ok  " : "FAIL", label, ok ? "" : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
};

const TODAY = "2026-10-24";
const START = "2026-10";

const project = (installments: FinProjectInstallment[], extra: Partial<FinProjectDoc> = {}): FinProjectDoc =>
  ({
    id: "p",
    code: "T-1",
    name: "검증",
    status: "active",
    contractAmount: 5_340_000,
    vatMode: "excluded",
    revenues: [],
    lines: [],
    installments,
    createdAt: 0,
    ...extra,
  }) as FinProjectDoc;

const inflowsOf = (p: FinProjectDoc) => projectInflows([p], START, new Set(), TODAY);

console.log("① 입금일만 있는 예전 회차 → 받음 (회귀 없음)");
{
  const i: FinProjectInstallment = { id: "a", kind: "선금", amount: 3_300_000, paidDate: "2026-07-03" };
  eq(isInstallmentReceived(i), true, "받음으로 본다");
  eq(installmentStatus(i, TODAY), "paid", "상태 paid");
  eq(installmentStatusText(i, TODAY), "받음", "글자 「받음」");
  const s = projectSummary(project([i]), [], TODAY);
  eq(s.received, 3_630_000, "받은 돈에 든다 (부가세 포함)");
  eq(inflowsOf(project([i])).length, 0, "런웨이 받을 돈에 없다 — 회차를 다 받았으니 계약 통째 「날짜 미정」 도 아니다");
}

console.log("\n② received: true · 입금일 없음 → 받음, 미수금·런웨이에서 빠진다");
{
  const i: FinProjectInstallment = { id: "a", kind: "선금", amount: 3_300_000, received: true };
  eq(isInstallmentReceived(i), true, "받음으로 본다");
  eq(installmentStatusText(i, TODAY), "받음 · 날짜 미확인", "글자 「받음 · 날짜 미확인」");
  eq(paidLabel(i), "", "입금일 글자는 비어 있다");
  const p = project([i], { contractAmount: 3_300_000 });
  const s = projectSummary(p, [], TODAY);
  eq([s.received, s.unpaid], [3_630_000, 0], "받은 돈 3,630,000 · 미수금 0");
  eq(inflowsOf(p).length, 0, "런웨이 받을 돈 목록에 없다");
  eq(nextPayment(p, TODAY), null, "다음 입금 없음");
  eq(checkItems(p, s, costSplit([]), "interim", TODAY).some((c) => c.text.includes("받을 날이 없는 회차")), false, "「받을 날이 없는 회차」 경고에 안 든다");
}

console.log("\n③ received 없음 · 입금일 없음 · 받기로 한 날 있음 → 예정, 런웨이 그 달");
{
  const i: FinProjectInstallment = { id: "b", kind: "잔금", amount: 2_040_000, dueDate: "2026-11-20", dueApprox: "mid" };
  eq(installmentStatus(i, TODAY), "planned", "상태 예정");
  const f = inflowsOf(project([i]));
  eq(f.map((x) => [x.id, x.month, x.status, x.included, x.amount]), [["b", "2026-11", "scheduled", true, 2_244_000]], "11월에 2,244,000 으로 잡힌다");
}

console.log("\n④ received 없음 · 입금일 없음 · 받기로 한 날 없음 → 「받을 날 미정」");
{
  const i: FinProjectInstallment = { id: "c", kind: "중도금", amount: 1_000_000 };
  const p = project([i]);
  const f = inflowsOf(p);
  eq(f.map((x) => [x.id, x.month, x.status, x.included]), [["c", null, "undated", false]], "날짜 미정 목록에 뜬다");
  const s = projectSummary(p, [], TODAY);
  eq(checkItems(p, s, costSplit([]), "interim", TODAY).some((c) => c.text.includes("받을 날이 없는 회차 1건")), true, "「받을 날이 없는 회차 1건」 경고");
}

console.log("\n⑤ 실제 사례 모양 — JRO-2605 (선금 받음·날짜 모름 + 잔금 11월 중)");
{
  const p = project([
    { id: "wv25y5z6", kind: "선금", amount: 3_300_000, received: true },
    { id: "g0j7uf23", kind: "잔금", amount: 2_040_000, dueDate: "2026-11-20", dueApprox: "mid" },
  ]);
  const s = projectSummary(p, [], TODAY);
  eq([s.received, s.unpaid], [3_630_000, 2_244_000], "받은 돈 3,630,000 · 미수금 2,244,000");
  eq(inflowsOf(p).map((x) => [x.id, x.month, x.status]), [["g0j7uf23", "2026-11", "scheduled"]], "런웨이엔 잔금만 11월");
}

console.log("\n⑥ 저장 다듬기 — 새 칸이 잘리지 않는다");
{
  const a = sanitizeInstallment({ id: "x", kind: "선금", amount: 1, received: true });
  eq([a.received, a.paidDate], [true, undefined], "received 는 남는다");
  const b = sanitizeInstallment({ id: "x", kind: "선금", amount: 1, paidDate: "2026-07-03", paidApprox: "early" });
  eq([b.paidDate, b.paidApprox, paidLabel(b)], ["2026-07-10", "early", "2026년 7월 초"], "대략 입금일은 구간 끝 날로 맞추고 「7월 초」 로 읽는다");
  eq(sanitizeInstallment({ id: "x", kind: "선금", amount: 1, paidApprox: "late" }).paidApprox, undefined, "날짜 없는 대략은 버린다");
  eq(sanitizeInstallment({ id: "x", kind: "선금", amount: 1, received: "yes" as never }).received, true, "참 같은 값은 true 로");
  eq("received" in sanitizeInstallment({ id: "x", kind: "선금", amount: 1, received: false }), false, "false 는 칸을 남기지 않는다");

  const saved = sanitizeProject({
    code: "T-1",
    name: "검증",
    contractAmount: 0,
    revenues: [],
    lines: [],
    installments: [{ id: "only", kind: "선금", amount: 0, received: true }],
  });
  eq(saved.ok && saved.value.installments?.map((i) => [i.id, i.received]), [["only", true]], "금액 0 이라도 받음 표시 회차는 버리지 않는다");
}

console.log("\n⑦ 런웨이 「적기」(project.setDue) 가 받음 · 대략 입금일을 덮어쓰지 않는다");
{
  // 서버는 지금 회차를 펼쳐 받을 날만 바꾼다 (mutate route 의 project.setDue)
  const cur: FinProjectInstallment = { id: "a", kind: "잔금", amount: 1, paidDate: "2026-07-10", paidApprox: "early", received: true, note: "메모" };
  const next = sanitizeInstallment({ ...cur, dueDate: "2026-11-02", dueApprox: "mid" });
  eq([next.received, next.paidDate, next.paidApprox, next.note, next.dueDate], [true, "2026-07-10", "early", "메모", "2026-11-20"], "나머지 칸은 그대로");
  eq(isInstallmentReceived({ received: true }), true, "받음 표시 회차는 「이미 받은 회차」 로 막힌다");
}

console.log("\n⑧ 청구액(통장에 찍히는 돈)으로 적는다 — 적은 값이 1원도 바뀌지 않는다");
{
  // 2026 익선재: 계약 1,300만 별도 · 통장에 1,000만 · 300만 · 130만
  const ik = [10_000_000, 3_000_000, 1_300_000].map((b, n) => ({ id: `i${n}`, kind: "중도금" as const, ...installmentFromBilled(b, "excluded"), received: true }));
  eq(ik.map((i) => i.amount), [9_090_909, 2_727_273, 1_181_818], "지금까지 손으로 계산해 넣던 공급가액과 같다");
  eq(ik.map((i) => "billed" in i && i.billed !== undefined), [false, false, false], "되돌려 맞는 금액은 칸을 더 남기지 않는다");
  const sk = projectSummary(project(ik, { contractAmount: 13_000_000 }), [], TODAY);
  eq([sk.received, sk.scheduleGap, sk.unpaid], [14_300_000, 0, 0], "받은 돈 1,430만 · 일정 차이 0 · 미수금 0");

  // 공급가액 정수로 나타낼 수 없는 금액
  const five = installmentFromBilled(5_000_000, "excluded");
  eq(five, { amount: 4_545_455, billed: 5_000_000 }, "500만원 → 공급가액 4,545,455 · 적은 값 보존");
  eq(installmentSplit(five, "excluded"), { supply: 4_545_455, vat: 454_545, total: 5_000_000 }, "공급가액 + 부가세 = 청구액");
  const p5 = project(
    [
      { id: "a", kind: "선금", ...five, received: true },
      { id: "b", kind: "잔금", ...installmentFromBilled(6_000_000, "excluded"), dueDate: "2026-11-20" },
    ],
    { contractAmount: 10_000_000 },
  );
  const s5 = projectSummary(p5, [], TODAY);
  eq([s5.received, s5.scheduleGap, s5.unpaid], [5_000_000, 0, 6_000_000], "500만 + 600만 = 계약 1,100만 — 1원 차이 알림이 뜨지 않는다");

  // 받을 돈 쪽도 적은 값 그대로
  const pOpen = project([{ id: "a", kind: "잔금", ...five, dueDate: "2026-11-20" }], { contractAmount: 4_545_455 });
  eq(inflowsOf(pOpen)[0].amount, 5_000_000, "런웨이 받을 돈 500만");
  eq(nextPayment(pOpen, TODAY)?.amount, 5_000_000, "다음 입금 500만");

  // 어떤 금액을 쳐도 그대로 보인다 — 치는 도중의 숫자까지
  let bad = 0;
  for (const mode of ["excluded", "included", "exempt"] as const) {
    for (let b = 0; b <= 300_000; b++) if (installmentSplit(installmentFromBilled(b, mode), mode).total !== b) bad++;
    for (let b = 300_000; b <= 200_000_000; b += 7_919) if (installmentSplit(installmentFromBilled(b, mode), mode).total !== b) bad++;
  }
  eq(bad, 0, "0 ~ 2억 어떤 값도 어긋나지 않는다");

  eq(installmentFromBilled(10_000_000, "included"), { amount: 10_000_000, billed: undefined }, "부가세 포함 계약은 금액 = 청구액");
  eq(installmentFromBilled(10_000_000, "exempt"), { amount: 10_000_000, billed: undefined }, "면세 계약도 금액 = 청구액");
  eq(installmentSplit({ amount: 10_000_000 }, "included"), { supply: 9_090_909, vat: 909_091, total: 10_000_000 }, "포함 계약의 공급가액");

  // 예전 회차 — billed 없이 amount 만
  eq(installmentSplit({ amount: 3_300_000 }, "excluded").total, 3_630_000, "예전 회차는 전과 같은 청구액");

  // amount 를 다른 데서 고치면 낡은 billed 는 믿지 않는다
  eq(installmentSplit({ amount: 1_000_000, billed: 5_000_000 }, "excluded").total, 1_100_000, "어긋난 billed 는 무시");

  // 부가세 기준을 바꿔도 청구액은 그대로
  const list: FinProjectInstallment[] = [{ id: "a", kind: "선금", ...five, received: true }, { id: "b", kind: "잔금", amount: 9_090_909 }];
  const inc = rebaseInstallments(list, "excluded", "included")!;
  eq(inc.map((i) => installmentSplit(i, "included").total), [5_000_000, 10_000_000], "별도 → 포함: 청구액 유지");
  eq(inc.map((i) => [i.amount, i.billed]), [[5_000_000, undefined], [10_000_000, undefined]], "포함이 되면 금액 = 청구액");
  eq(inc[0].received, true, "다른 칸은 그대로");
  const back = rebaseInstallments(inc, "included", "excluded")!;
  eq(back.map((i) => installmentSplit(i, "excluded").total), [5_000_000, 10_000_000], "포함 → 별도: 청구액 유지");
  eq(rebaseInstallments(list, "excluded", "excluded"), list, "같은 기준이면 그대로");
  eq(rebaseInstallments(undefined, "excluded", "included"), undefined, "회차 없음");

  // 저장 다듬기 · 받을 날만 고치기에서 살아남는다
  const kept = sanitizeInstallment({ id: "x", kind: "선금", ...five });
  eq([kept.amount, kept.billed], [4_545_455, 5_000_000], "저장해도 billed 가 남는다");
  eq("billed" in sanitizeInstallment({ id: "x", kind: "선금", amount: 1, billed: undefined }), false, "필요 없으면 칸을 남기지 않는다");
  eq(sanitizeInstallment({ ...kept, dueDate: "2026-11-02" }).billed, 5_000_000, "받을 날을 고쳐도 그대로");
  const whole = sanitizeProject({ code: "T-1", name: "검증", contractAmount: 0, revenues: [], lines: [], installments: [{ id: "x", kind: "선금", ...five }] });
  eq(whole.ok && whole.value.installments?.map((i) => [i.amount, i.billed]), [[4_545_455, 5_000_000]], "프로젝트 통째 저장에서도 남는다");
}

console.log(fails === 0 ? "\n모두 통과" : `\n실패 ${fails}건`);
process.exit(fails === 0 ? 0 : 1);
