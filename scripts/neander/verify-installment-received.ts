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
  installmentStatus,
  installmentStatusText,
  isInstallmentReceived,
  paidLabel,
  projectSummary,
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

console.log(fails === 0 ? "\n모두 통과" : `\n실패 ${fails}건`);
process.exit(fails === 0 ? 0 : 1);
