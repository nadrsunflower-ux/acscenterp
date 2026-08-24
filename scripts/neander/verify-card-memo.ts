// ============================================================
//  법인카드 메모 대조 검증
// ------------------------------------------------------------
//  Firestore 를 타지 않는다. 특히 **애매한 짝을 붙이지 않는지**를 못
//  박는다 — 같은 카드로 같은 날 같은 금액을 두 번 쓰는 일(커피 두 잔,
//  택시 왕복)은 실제로 흔하고, 그때 아무 거래에나 메모를 붙이면 조용히
//  틀린 장부가 된다.
//
//    npm run finance:verify-card-memo
// ============================================================

import { matchMemos, patchFromMemo, type FinCardMemo } from "@/lib/neander/finance/card-memo";
import type { FinTransaction } from "@/lib/neander/finance/types";

let bad = 0;
const ok = (c: boolean, m: string, extra = "") => {
  console.log(`${c ? "ok  " : "FAIL"} ${m}${extra ? `  ${extra}` : ""}`);
  if (!c) bad++;
};

const memo = (o: Partial<FinCardMemo>): FinCardMemo =>
  ({ id: "m", date: "2026-08-24", last4: "1804", note: "메모", amount: 20290,
     createdAt: 0, createdBy: "t", ...o }) as FinCardMemo;
const tx = (o: Partial<FinTransaction>): FinTransaction =>
  ({ id: "t", date: "2026-08-24", txType: "지출", gross: 20290, adjust: 0,
     status: "confirmed", last4: "1804", ...o }) as FinTransaction;

console.log("=== 정확히 맞는 짝 ===");
{
  const r = matchMemos([memo({})], [tx({})]);
  ok(r.matched.length === 1 && r.matched[0].exactDate, "카드·금액·날짜가 같으면 붙는다");
  ok(r.unmatched.length === 0 && r.ambiguous.length === 0, "남는 것 없음");
}
{
  const r = matchMemos([memo({})], [tx({ date: "2026-08-25" })]);
  ok(r.matched.length === 1 && !r.matched[0].exactDate, "명세서 날짜가 하루 밀려도 붙는다");
}
{
  const r = matchMemos([memo({})], [tx({ date: "2026-08-27" })]);
  ok(r.unmatched.length === 1, "사흘 차이는 붙이지 않는다");
}

console.log("\n=== 붙이면 안 되는 것 ===");
{
  const r = matchMemos([memo({})], [tx({ last4: "9999" })]);
  ok(r.unmatched.length === 1, "카드가 다르면 금액·날짜가 같아도 안 붙는다");
}
{
  const r = matchMemos([memo({})], [tx({ gross: 20300 })]);
  ok(r.unmatched.length === 1, "금액이 10원만 달라도 안 붙는다");
}
{
  // 같은 카드로 같은 날 같은 금액 두 건 — 어느 쪽인지 알 수 없다
  const r = matchMemos([memo({})], [tx({ id: "a" }), tx({ id: "b" })]);
  ok(r.matched.length === 0, "후보가 둘이면 자동으로 붙이지 않는다");
  ok(r.ambiguous.length === 1 && r.ambiguous[0].candidates.length === 2, "사람에게 넘긴다");
}
{
  const r = matchMemos([memo({ matchedTxId: "t" })], [tx({})]);
  ok(r.matched.length === 0 && r.unmatched.length === 0, "이미 붙은 메모는 다시 보지 않는다");
}
{
  // 다른 메모가 이미 가져간 거래는 후보에서 빠진다
  const r = matchMemos([memo({ id: "m1", matchedTxId: "t1" }), memo({ id: "m2" })], [tx({ id: "t1" })]);
  ok(r.unmatched.length === 1, "남의 짝을 뺏지 않는다");
}

console.log("\n=== 날짜가 정확한 쪽이 먼저 ===");
{
  //  ±1일 후보가 정확한 짝을 밀어내면 안 된다
  const r = matchMemos(
    [memo({ id: "m1", date: "2026-08-24" })],
    [tx({ id: "near", date: "2026-08-23" }), tx({ id: "exact", date: "2026-08-24" })],
  );
  ok(r.matched.length === 1 && r.matched[0].tx.id === "exact", "정확히 같은 날을 고른다", r.matched[0]?.tx.id);
}

console.log("\n=== 환불(조정금액)도 순금액으로 본다 ===");
{
  const r = matchMemos([memo({ amount: 10000 })], [tx({ gross: 30000, adjust: 20000 })]);
  ok(r.matched.length === 1, "원금액 30,000 − 조정 20,000 = 10,000 에 붙는다");
}

console.log("\n=== 거래에 실리는 값 ===");
{
  const m = memo({ note: "JIMFF 러너 조이스틱", vendor: "쿠팡", bizMajor: "공용", acctMajor: "운영비", acctMid: "일반운영비", acctMinor: "일반소모품비" });
  const p = patchFromMemo(m, tx({}));
  ok(p.note === "JIMFF 러너 조이스틱", "비고에 메모가 들어간다");
  ok(p.vendor === "쿠팡", "거래처가 비어 있으면 채운다");
  ok(p.bizMajor === "공용" && p.bizMinor === "공용", "사업소분류를 안 적었으면 대분류와 같게");
  ok(p.acctMinor === "일반소모품비", "계정도 실린다");

  const p2 = patchFromMemo(m, tx({ note: "기존메모", vendor: "쿠팡(주)", bizMajor: "B2C", acctMinor: "비품구입비" }));
  ok(p2.note === "기존메모 / JIMFF 러너 조이스틱", "기존 비고는 지우지 않고 뒤에 붙인다", String(p2.note));
  ok(p2.vendor === undefined, "이미 있는 거래처는 덮어쓰지 않는다");
  ok(p2.bizMajor === undefined, "이미 있는 사업구분은 덮어쓰지 않는다");
  ok(p2.acctMajor === undefined, "이미 있는 계정은 덮어쓰지 않는다");
}

console.log(bad === 0 ? "\n✅ 전부 통과" : `\n❌ ${bad}건 실패`);
process.exit(bad === 0 ? 0 : 1);
