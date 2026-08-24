// ============================================================
//  월 마감 점검 엔진 검증
// ------------------------------------------------------------
//  Firestore 를 타지 않는다. 손으로 만든 거래로 점검 규칙이 무엇을 잡고
//  무엇을 넘기는지 못 박는다.
//
//  특히 **오탐 두 가지**를 지킨다. 둘 다 실제 장부를 돌려 보고 찾은 것이다:
//    · 환급이 지출 계정을 쓰는 건 정상이다 (되돌린 대상을 가리켜야 한다).
//      이걸 불일치로 보는 바람에 장부의 환급 4건이 전부 「검토필요」로
//      떨어져 있었다.
//    · 자금거래는 이체출금·이체입금을 양쪽 다 기록한다. 같은 날 같은 금액
//      같은 상대가 두 줄 나오는 게 설계다 (2.84억이 중복으로 잡혔었다).
//
//    npm run finance:verify-close
// ============================================================

import { runMonthChecks, monthSnapshot, monthsOf, blockingChecks } from "@/lib/neander/finance/close";
import { filtersFromQuery } from "@/lib/neander/finance/ledgerLink";
import type { FinTransaction } from "@/lib/neander/finance/types";
import type { FinAccountDoc, FinPaymentMethodDoc } from "@/lib/neander/finance/db-types";

let failed = 0;
const ok = (cond: boolean, label: string, detail?: string) => {
  console.log(`${cond ? "ok  " : "FAIL"} ${label}${detail ? `  ${detail}` : ""}`);
  if (!cond) failed += 1;
};

const acct = (major: string, mid: string, minor: string, txType: string): FinAccountDoc =>
  ({ id: `${major}|${mid}|${minor}`, lookupKey: "", txType, major, mid, minor,
     example: "", code: "", vat: "", asset: "", pay: "", branch: "" }) as FinAccountDoc;

const ACCOUNTS = [
  acct("운영비", "일반운영비", "일반소모품비", "지출"),
  acct("매출", "B2C매출", "와우판매", "수입"),
  acct("계좌간이동", "이체출금", "운영자금이동", "자금거래"),
  acct("재무비용", "금융비용", "카드대금결제", "지출"),
];
const METHODS = [
  { id: "1", last4: "1111", alias: "국민", site: "네안데르", personal: false, kind: "account" },
] as FinPaymentMethodDoc[];

const tx = (o: Partial<FinTransaction>): FinTransaction =>
  ({ id: "x", date: "2026-07-05", txType: "지출", gross: 1000, adjust: 0,
     status: "confirmed", bizMajor: "공용", bizMinor: "공용", vendor: "쿠팡",
     last4: "1111", acctMajor: "운영비", acctMid: "일반운영비", acctMinor: "일반소모품비",
     ...o }) as FinTransaction;

const run = (rows: FinTransaction[]) =>
  runMonthChecks({ month: "2026-07", transactions: rows, accounts: ACCOUNTS, paymentMethods: METHODS });
const has = (rows: FinTransaction[], id: string) => run(rows).find((c) => c.id === id);

console.log("=== 깨끗한 달은 아무것도 잡지 않는다 ===");
ok(run([tx({ id: "1" })]).length === 0, "정상 거래 1건 → 점검 0건");

console.log("\n=== 오탐 방지 ===");
ok(
  !has([tx({ id: "1", txType: "환급", gross: 5000 })], "tx-mismatch"),
  "환급이 지출 계정을 써도 불일치가 아니다",
);
ok(
  !has([tx({ id: "1", txType: "카드대금결제", acctMajor: "재무비용", acctMid: "금융비용", acctMinor: "카드대금결제" })], "tx-mismatch"),
  "카드대금결제의 관행적 불일치도 넘어간다",
);
{
  const pair = [
    tx({ id: "1", txType: "자금거래", gross: 1e7, vendor: "(주)네안데르", acctMajor: "계좌간이동", acctMid: "이체출금", acctMinor: "운영자금이동" }),
    tx({ id: "2", txType: "자금거래", gross: 1e7, vendor: "(주)네안데르", acctMajor: "계좌간이동", acctMid: "이체출금", acctMinor: "운영자금이동" }),
  ];
  ok(!has(pair, "dup"), "자금거래의 출금·입금 짝은 중복이 아니다");
}
{
  const split = [
    tx({ id: "1", vendor: "짱탁구장", gross: 15000, last4: "1111" }),
    tx({ id: "2", vendor: "짱탁구장", gross: 15000, last4: "2222" }),
  ];
  ok(!has(split, "dup"), "같은 가게를 다른 카드로 각자 계산한 건 중복이 아니다");
}

console.log("\n=== 진짜 문제는 잡는다 ===");
ok(has([tx({ id: "1", acctMinor: undefined })], "no-account")?.severity === "block", "계정 미기입 → 마감 불가");
ok(has([tx({ id: "1", acctMinor: "소모품비" })], "unknown-account")?.severity === "block", "마스터에 없는 계정 → 마감 불가");
ok(has([tx({ id: "1", status: "needs_review" })], "pending")?.severity === "block", "검토 미완 → 마감 불가");
ok(has([tx({ id: "1", bizMajor: undefined })], "no-biz")?.severity === "warn", "사업구분 미기입 → 경고");
ok(has([tx({ id: "1", txType: "수입", gross: 5000 })], "tx-mismatch")?.severity === "warn", "수입인데 지출 계정 → 경고");
ok(has([tx({ id: "1", last4: "9999" })], "unknown-last4")?.severity === "warn", "마스터에 없는 카드 → 경고");
ok(has([tx({ id: "1", vendor: undefined })], "no-vendor")?.severity === "info", "거래처 미기입 → 참고");
ok(has([tx({ id: "1", gross: 5000, adjust: 5000 })], "zero")?.severity === "info", "순금액 0원 → 참고");
{
  const dup = [tx({ id: "1" }), tx({ id: "2" })];
  ok(has(dup, "dup")?.count === 2, "같은 날·금액·거래처·카드 두 건 → 중복 의심");
}

console.log("\n=== 마감 게이트 ===");
ok(blockingChecks(run([tx({ id: "1", bizMajor: undefined })])).length === 0, "경고만 있으면 마감할 수 있다");
ok(blockingChecks(run([tx({ id: "1", status: "suggested" })])).length === 1, "block 이 있으면 마감을 막는다");

console.log("\n=== 스냅샷 ===");
{
  const rows = [
    tx({ id: "1", txType: "수입", gross: 1000, acctMajor: "매출", acctMid: "B2C매출", acctMinor: "와우판매" }),
    tx({ id: "2", txType: "지출", gross: 400 }),
    tx({ id: "3", txType: "환급", gross: 100 }),
    tx({ id: "4", txType: "자금거래", gross: 99999, acctMajor: "계좌간이동", acctMid: "이체출금", acctMinor: "운영자금이동" }),
  ];
  const s = monthSnapshot(rows, "2026-07");
  ok(s.income === 1000 && s.expense === 400 && s.refund === 100, "수입·지출·환급을 유형대로 나눈다");
  ok(s.net === 700, "순손익 = 수입 − (지출 − 환급)", `${s.net}`);
  ok(s.count === 4, "건수는 비손익도 센다 (그 달에 실제로 있는 줄이므로)");
  ok(monthsOf(rows).length === 1 && monthsOf(rows)[0] === "2026-07", "달 목록");
}

console.log("\n=== 드릴다운 링크 ===");
{
  const rows = [tx({ id: "1", acctMinor: undefined }), tx({ id: "2", bizMajor: undefined })];
  const hrefs = run(rows)
    .flatMap((c) => [c.href, ...c.groups.map((g) => g.href)])
    .filter((h): h is string => !!h && h.includes("?"));
  ok(hrefs.length > 0, `링크 ${hrefs.length}개 생성`);
  ok(
    hrefs.every((h) => filtersFromQuery(h.slice(h.indexOf("?"))) !== null),
    "모든 링크가 원장 필터로 되살아난다",
  );
}

console.log(failed === 0 ? "\n✅ 전부 통과" : `\n❌ ${failed}건 실패`);
process.exit(failed === 0 ? 0 : 1);
