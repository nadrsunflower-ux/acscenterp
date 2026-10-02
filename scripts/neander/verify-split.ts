// ============================================================
//  거래 나누기 검증 — 합이 맞는가, 무엇을 물려받고 무엇을 새로 만드는가
// ------------------------------------------------------------
//  Firestore 를 타지 않는다. finance/split.ts 가 지켜야 할 것을 못 박는다.
//  지켜야 하는 것은 하나다 — **나누고 합쳐도 장부의 금액이 달라지지 않는다.**
//
//    npm run finance:verify-split
// ============================================================

import {
  buildMerge,
  buildSplit,
  parseRatio,
  quantitiesInMemo,
  splitBlocker,
  splitByRatio,
  validateSplit,
} from "@/lib/neander/finance/split";
import type { FinTransaction } from "@/lib/neander/finance/types";

let failed = 0;
const ok = (cond: boolean, label: string, detail?: string) => {
  console.log(`${cond ? "ok  " : "FAIL"} ${label}${detail ? `  ${detail}` : ""}`);
  if (!cond) failed += 1;
};

const ORIG = {
  id: "root1", date: "2026-09-01", datetime: "2026.09.01 14:02:11", last4: "1804", txType: "지출", vendor: "드림애드컴",
  gross: 45_580, adjust: 0, status: "confirmed", acctMajor: "운영비", acctMid: "홍대공용운영비", acctMinor: "생카소모품비",
  bizMajor: "B2B", bizMinor: "조향", projectCode: "JIMFF", note: "결제예정 2026.10.15", cardMemo: "배너공장 / JIMFF 배너2, 평택배너4",
  cardChatId: "20260901-abc", vendorKind: "인쇄·제작", classReason: "거래처 「드림애드컴」 — …", engineSig: "suggested|지출|운영비|홍대공용운영비|생카소모품비|B2B|조향",
  dedupHash: "hash-1", importBatchId: "batch-9", balanceAfter: 123, createdAt: 1, updatedAt: 2, updatedBy: "someone@x.com",
} as FinTransaction & Record<string, unknown>;

console.log("=== 나눌 수 있는가 ===");
ok(splitBlocker(ORIG) === null, "보통의 지출은 나눌 수 있다");
ok(!!splitBlocker({ ...ORIG, adjust: 1000 }), "조정금액(부분 취소)이 있으면 나누지 않는다");
ok(!!splitBlocker({ ...ORIG, splitGroup: "root1" }), "이미 나눈 조각은 다시 나누지 않는다 (합친 뒤에)");
ok(!!splitBlocker({ ...ORIG, txType: "카드대금결제" }), "카드대금 결제는 나누지 않는다");

console.log("\n=== 합이 맞아야 한다 ===");
const A = { gross: 15_193, projectCode: "JIMFF", bizMajor: "B2B", bizMinor: "조향", acctMajor: "운영비", acctMid: "홍대공용운영비", acctMinor: "생카소모품비" };
const B = { gross: 30_387, projectCode: "MRNC-2609", bizMajor: "B2B", bizMinor: "조향" };
ok(validateSplit(ORIG, [A, B]) === null, "합이 원래 금액과 같으면 통과");
ok(/합\(.*\)이 원래 금액/.test(validateSplit(ORIG, [A, { ...B, gross: 30_000 }]) ?? ""), "1원이라도 모자라면 막는다", validateSplit(ORIG, [A, { ...B, gross: 30_000 }]) ?? "");
ok(!!validateSplit(ORIG, [{ ...A, gross: 45_580 }]), "한 조각으로는 나눌 수 없다");
ok(!!validateSplit(ORIG, [{ ...A, gross: 45_580 }, { ...B, gross: 0 }]), "금액이 없는 조각은 안 된다");
ok(!!validateSplit(ORIG, [{ ...A, gross: 50_000 }, { ...B, gross: -4_420 }]), "부호가 다른 조각은 안 된다 (합만 맞추는 꼼수)");
ok(!!validateSplit(ORIG, [{ ...A, gross: 15_193.5 }, { ...B, gross: 30_386.5 }]), "원 단위가 아니면 안 된다");
ok(validateSplit({ ...ORIG, gross: -2_660 }, [{ gross: -1_000 }, { gross: -1_660 }]) === null, "취소 건(음수)도 같은 부호로 나눌 수 있다");

console.log("\n=== 비율 ===");
ok(splitByRatio(45_580, [2, 4]).join("+") === "15193+30387", "2:4 — 나머지 1원은 마지막 조각에", splitByRatio(45_580, [2, 4]).join(" + "));
ok(splitByRatio(100, [1, 1, 1]).join(",") === "33,33,34" && splitByRatio(100, [1, 1, 1]).reduce((s, n) => s + n, 0) === 100, "셋으로 똑같이 — 합은 정확히 100");
ok(splitByRatio(-2_660, [1, 1]).join(",") === "-1330,-1330", "음수도 같은 부호로");
ok(splitByRatio(100, [1, 0]).length === 0, "0 이 든 비율은 받지 않는다");
ok(parseRatio("2:4")?.join() === "2,4" && parseRatio("30 70")?.join() === "30,70" && parseRatio("1/2/1")?.join() === "1,2,1", "비율은 : / 빈칸 으로 적는다");
ok(parseRatio("2") === null && parseRatio("a:b") === null && parseRatio("2:0") === null, "하나뿐이거나 숫자가 아니면 읽지 않는다");
{
  const q = quantitiesInMemo("배너공장 / JIMFF 배너2, 평택배너4");
  ok(q?.weights.join(":") === "2:4" && q.labels.join("|") === "JIMFF 배너|평택배너", "카드 메모의 수량을 읽는다", q ? `${q.labels.join(" · ")} → ${q.weights.join(":")}` : "");
  ok(quantitiesInMemo("배너공장 / JIMFF 배너, 평택배너4") === null, "한 조각이라도 수량이 없으면 추측하지 않는다");
  ok(quantitiesInMemo("쿠팡 / 생수") === null && quantitiesInMemo(undefined) === null, "가를 것이 없으면 없다");
}

console.log("\n=== 쓰는 것 ===");
{
  const { rootPatch, children } = buildSplit(ORIG, [A, B], 1000, "me@x.com");
  ok(rootPatch.gross === 15_193 && children.length === 1 && children[0].gross === 30_387, "첫 조각은 원래 거래 자리, 나머지는 새 줄");
  ok((rootPatch.gross as number) + (children[0].gross as number) === ORIG.gross, "조각의 합 = 원래 금액");
  ok(rootPatch.splitGroup === "root1" && children[0].splitGroup === "root1" && rootPatch.splitNo === 1 && children[0].splitNo === 2 && children[0].splitCount === 2 && children[0].splitTotal === 45_580,
    "조각은 한 묶음이다 (원래 id · 번호 · 원래 금액)");
  ok(children[0].date === ORIG.date && children[0].vendor === ORIG.vendor && children[0].last4 === ORIG.last4 && children[0].cardMemo === ORIG.cardMemo && children[0].vendorKind === ORIG.vendorKind,
    "새 조각은 날짜 · 거래처 · 결제수단 · 메모를 물려받는다");
  ok(children[0].importBatchId === "batch-9", "적재 배치를 물려받는다 — 적재를 되돌리면 같이 지워진다");
  ok(children[0].dedupHash === "hash-1#split2" && !("dedupHash" in rootPatch), "중복 검사 키는 첫 조각만 원래 것을 갖는다 (명세서를 다시 올려도 새 거래가 안 생긴다)");
  ok(!("balanceAfter" in children[0]) && !("engineSig" in children[0]) && !("id" in children[0]), "잔액 · 지문 · id 는 물려받지 않는다");
  ok(children[0].projectCode === "MRNC-2609" && rootPatch.projectCode === "JIMFF", "조각마다 프로젝트가 다르다");
  ok(!("acctMinor" in children[0]) && children[0].status === "needs_review", "계정을 비운 조각은 계정 없이 「검토필요」 (원래 계정을 물려받지 않는다)");
  ok(rootPatch.status === "suggested" && rootPatch.engineSig === null, "확정이던 거래도 나누면 다시 본다 · 자동분류의 지문은 거둔다");
  ok(/45,580원을 2조각으로 \(1\/2\)/.test(String(rootPatch.classReason)) && /\(2\/2\)/.test(String(children[0].classReason)), "사유에 무엇을 나눈 것인지 적는다", String(rootPatch.classReason));
}

console.log("\n=== 합치기 ===");
{
  const parts = [
    { id: "root1", gross: 15_193, splitGroup: "root1", splitNo: 1 },
    { id: "c2", gross: 20_000, splitGroup: "root1", splitNo: 2 },
    { id: "c3", gross: 10_387, splitGroup: "root1", splitNo: 3 },
  ];
  const m = buildMerge(parts);
  ok(m?.rootId === "root1" && m.gross === 45_580 && m.removeIds.join() === "c2,c3", "원래 거래로 모으고 금액은 조각의 합");
  const orphan = buildMerge(parts.slice(1));
  ok(orphan?.rootId === "c2" && orphan.gross === 30_387, "원래 거래가 지워졌으면 번호가 앞선 조각으로 모은다");
  ok(buildMerge([{ id: "x", gross: 1, splitGroup: undefined, splitNo: 1 }]) === null && buildMerge([]) === null, "나눈 거래가 아니면 합치지 않는다");
  ok(buildMerge([parts[0], { id: "z", gross: 5, splitGroup: "other", splitNo: 1 }]) === null, "다른 묶음이 섞이면 합치지 않는다");
}

console.log(failed === 0 ? "\n✅ 전부 통과" : `\n❌ ${failed}건 실패`);
process.exit(failed === 0 ? 0 : 1);
