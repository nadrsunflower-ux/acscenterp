// ============================================================
//  돌려줄 돈 검사 — 계산 · 행 합치기 · 상태 판정 (가짜 데이터, DB 안 씀)
//
//    npx tsx scripts/neander/verify-paybacks.ts
// ============================================================
import {
  deductionAmountForKeep,
  isOutgoing,
  openPaybacks,
  paybackCalc,
  paybackRows,
  paybackStatus,
  paybackTotals,
  projectGross,
  sanitizePayback,
  txCandidates,
  type FinPaybackDoc,
} from "@/lib/neander/finance/payback";
import { projectSummary, sanitizeDeduction, sanitizeProject, type FinProjectDoc } from "@/lib/neander/finance/project";
import type { FinTransaction } from "@/lib/neander/finance/types";

let failed = 0;
function eq(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed += 1;
  console.log(`${ok ? "✓" : "✗"} ${name}${ok ? "" : ` — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`);
}

const TODAY = "2026-10-24";

// ---- 계산 ----
// 1,100만(포함) − 부가세 100만 − 우리 몫 300만 = 700만
eq("포함 1,100만 · 우리 몫 300만", paybackCalc(11_000_000, "included", 3_000_000), { supply: 10_000_000, vat: 1_000_000, total: 11_000_000, amount: 7_000_000 });
// KPOP-2509 메모: 공급 1,800 (+부가세 180) − 우리 몫 510 = 1,290
eq("별도 1,800만 · 우리 몫 510만 (KPOP)", paybackCalc(18_000_000, "excluded", 5_100_000).amount, 12_900_000);
eq("면세 — 부가세 없음", paybackCalc(5_000_000, "exempt", 1_000_000), { supply: 5_000_000, vat: 0, total: 5_000_000, amount: 4_000_000 });
eq("우리 몫이 더 크면 음수 그대로", paybackCalc(1_100_000, "included", 1_200_000).amount, -200_000);

// ---- 정리 ----
const s1 = sanitizePayback({ vendor: "  (주)써큐 ", received: 11_000_000, vatMode: "included", keep: 5_198_000 });
eq("금액을 안 보내면 계산값", s1.ok && s1.value.amount, 4_802_000);
eq("거래처 앞뒤 공백 제거", s1.ok && s1.value.vendor, "(주)써큐");
eq("거래처가 없으면 거절", sanitizePayback({ received: 1 }).ok, false);
const s2 = sanitizePayback({ vendor: "A", received: 1_100_000, keep: 0, amount: 999_999, dueDate: "2026-11-03", dueApprox: "late" });
eq("직접 적은 금액은 그대로", s2.ok && s2.value.amount, 999_999);
eq("대략 날짜는 구간의 끝 날", s2.ok && s2.value.dueDate, "2026-11-30");
eq("부가세 기준 기본값은 포함", s2.ok && s2.value.vatMode, "included");

// ---- 상태 ----
eq("돌려준 날이 있으면 돌려줌", paybackStatus({ paidDate: "2026-10-01", dueDate: "2026-09-01" }, TODAY), "paid");
eq("예정일 지남 → 늦음", paybackStatus({ dueDate: "2026-10-23" }, TODAY), "late");
eq("오늘이 예정일 → 남음", paybackStatus({ dueDate: TODAY }, TODAY), "open");
eq("예정일 없음 → 남음", paybackStatus({}, TODAY), "open");

// ---- 프로젝트 행 ----
const project = (over: Partial<FinProjectDoc>): FinProjectDoc => ({
  id: "p1",
  code: "KPOP-2509",
  name: "KPOP 앱",
  client: "(주)케이팝",
  status: "done",
  contractAmount: 18_000_000,
  vatMode: "excluded",
  revenues: [],
  lines: [],
  createdAt: 0,
  ...over,
});
const kpop = project({
  deductions: [{ id: "d1", label: "환급", amount: 12_900_000, taxMode: "none" }],
});
eq("차감 전 숫자 되돌리기", projectGross(kpop), { total: 19_800_000, supply: 18_000_000, vat: 1_800_000, keep: 5_100_000 });
eq("우리 몫 510만 → 차감 1,290만", deductionAmountForKeep(kpop, 5_100_000, "d1"), 12_900_000);
eq("새 줄 — 다른 차감을 빼고", deductionAmountForKeep(kpop, 4_100_000, null), 1_000_000);
const inv = project({ id: "p2", vatMode: "included", contractAmount: 11_000_000, deductions: [{ id: "d2", label: "할인", amount: 1_100_000, taxMode: "invoice" }] });
eq("수정세금계산서 줄은 부가세를 더해", deductionAmountForKeep(inv, 9_000_000, "d2", "invoice"), 1_100_000);

const docs: FinPaybackDoc[] = [
  { id: "a", vendor: "써큐", received: 11_000_000, vatMode: "included", keep: 5_198_000, amount: 4_802_000, dueDate: "2026-10-10", createdAt: 0 },
  { id: "b", vendor: "워크온", received: 8_800_000, vatMode: "included", keep: 0, amount: 8_000_000, paidDate: "2026-04-30", paidAmount: 8_800_000, createdAt: 0 },
  { id: "c", vendor: "다음달", received: 2_200_000, vatMode: "included", keep: 1_000_000, amount: 1_000_000, dueDate: "2026-11-15", createdAt: 0 },
];
const cancelled = project({ id: "p3", status: "cancelled", deductions: [{ id: "x", label: "취소된 건", amount: 1, taxMode: "none" }] });
const rows = paybackRows(docs, [kpop, cancelled], TODAY);
eq("취소 프로젝트는 빠진다", rows.length, 4);
eq("늦음 → 남음 → 돌려줌 순", rows.map((r) => r.status), ["late", "open", "open", "paid"]);
const kRow = rows.find((r) => r.source === "project")!;
eq("프로젝트 행 — 받은 돈 · 부가세 · 우리 몫 · 돌려줄 돈", [kRow.received, kRow.vat, kRow.keep, kRow.amount, kRow.vendor], [19_800_000, 1_800_000, 5_100_000, 12_900_000, "(주)케이팝"]);
eq("프로젝트 행 열쇠", kRow.key, "p1:d1");
const bRow = rows.find((r) => r.key === "b")!;
eq("실제로 돌려준 돈이 있으면 그것", bRow.paid, 8_800_000);

const t = paybackTotals(rows, TODAY);
eq("남은 돈 = 써큐 + 다음달 + KPOP", t.open, 4_802_000 + 1_000_000 + 12_900_000);
eq("늦음", [t.late, t.lateCount], [4_802_000, 1]);
eq("다음 달 예정", t.nextMonth, 1_000_000);
eq("날짜 미정 (프로젝트 차감)", t.undated, 12_900_000);
eq("올해 돌려준 돈", [t.paidThisYear, t.paidThisYearCount], [8_800_000, 1]);
eq("열린 돈 목록", openPaybacks(rows).map((o) => o.amount), [4_802_000, 1_000_000, 12_900_000]);

// ---- 나눠 받고 한쪽이 돌려주는 건 (2026 다름다움) ----
// 와작 330 · 네안데르 220 (모두 부가세 포함) → 네안데르 현금 445 반환 → 우리 몫 55
const split = sanitizeProject({
  code: "X",
  name: "다름다움",
  status: "done",
  contractAmount: 5_500_000,
  vatMode: "included",
  installments: [
    { id: "i1", kind: "선금", amount: 3_300_000, entity: "와작홈즈", received: true },
    { id: "i2", kind: "잔금", amount: 2_200_000, entity: "네안데르", paidDate: "2026-10-20" },
  ],
  deductions: [
    { id: "d1", label: "현금 반환", amount: 4_450_000, taxMode: "none", entity: "네안데르", method: " 현금 ", dueDate: "2026-10-05", dueApprox: "mid" },
  ],
  lines: [],
  revenues: [],
});
const sp = split.ok ? ({ ...split.value, id: "p9", createdAt: 0 } as FinProjectDoc) : project({});
eq("회차의 받는 사업체가 프로젝트 사업체로", sp.entities, ["네안데르", "와작홈즈"]);
eq("회차 사업체는 남는다", sp.installments?.map((i) => i.entity), ["와작홈즈", "네안데르"]);
eq("차감 — 사업체 · 방법 · 대략 날짜는 구간의 끝 날", [sp.deductions?.[0].entity, sp.deductions?.[0].method, sp.deductions?.[0].dueDate], ["네안데르", "현금", "2026-10-20"]);
eq("틀린 사업체 글자는 버린다", sanitizeDeduction({ label: "x", amount: 1, taxMode: "none", entity: "없는회사" as never }).entity, undefined);
eq("우리 몫 55만 = 550 − 50 − 445", projectSummary(sp).revenue, 550_000);
eq("우리 몫 55만 → 돌려줄 돈 445만", deductionAmountForKeep(sp, 550_000, "d1"), 4_450_000);
const spRow = paybackRows([], [sp], TODAY)[0];
eq("프로젝트 차감도 예정일이 지나면 늦음", spRow.status, "late");
eq("프로젝트 차감 행 — 날짜 글자 · 돌려주는 사업체 · 방법", [spRow.dueDate, spRow.dueText !== "", spRow.entity, spRow.method], ["2026-10-20", true, "네안데르", "현금"]);
const spPaid = paybackRows([], [{ ...sp, deductions: [{ ...sp.deductions![0], paidDate: "2026-10-21" }] }], TODAY)[0];
eq("돌려준 날이 있으면 돌려줌", spPaid.status, "paid");
const spReturned = { ...sp, deductions: [{ ...sp.deductions![0], returned: true }] };
eq("날짜 없이 「돌려줌」 — 상태 · 돌려준 돈", [paybackRows([], [spReturned], TODAY)[0].status, paybackRows([], [spReturned], TODAY)[0].paid], ["paid", 4_450_000]);
eq("날짜 없이 「돌려줌」 — 돌려줄 돈 0", [projectSummary(spReturned).deductionPending, projectSummary(spReturned).returned], [0, 4_450_000]);
eq("「돌려줌」 표시는 저장에 남는다", sanitizeDeduction({ label: "x", amount: 1, taxMode: "none", returned: true }).returned, true);
eq("돌려주는 사업체가 없으면 받은 사업체들", paybackRows([], [{ ...sp, deductions: [{ ...sp.deductions![0], entity: undefined }] }], TODAY)[0].entity, "네안데르 · 와작홈즈");

// ---- 장부 후보 ----
const tx = (id: string, over: Partial<FinTransaction>): FinTransaction =>
  ({ id, date: "2026-10-01", txType: "지출", gross: 0, adjust: 0, status: "confirmed", dedupHash: id, createdAt: 0, ...over }) as FinTransaction;
const txs = [
  tx("t1", { vendor: "주식회사 써큐", gross: 4_802_000 }),
  tx("t2", { vendor: "다른곳", gross: 4_802_000 }),
  tx("t3", { vendor: "써큐", gross: 100_000, txType: "수입" }), // 들어온 돈 — 후보 아님
  tx("t4", { vendor: "써큐", gross: -4_802_000, txType: "수입" }), // 매출을 음수로 되돌린 것 — 나간 돈
  tx("t5", { vendor: "무관", gross: 1 }),
];
eq("음수 수입은 나간 돈", isOutgoing(txs[3]), true);
eq("양수 수입은 아님", isOutgoing(txs[2]), false);
const c = txCandidates({ vendor: "(주)써큐", amount: 4_802_000, txIds: ["t5"] }, txs);
eq("붙인 것 먼저, 그다음 금액+거래처", c.map((x) => x.tx.id), ["t5", "t1", "t4", "t2"]);

console.log(failed === 0 ? "\n모두 통과" : `\n${failed}개 실패`);
process.exit(failed === 0 ? 0 : 1);
