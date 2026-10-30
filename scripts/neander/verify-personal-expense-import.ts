import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import { readFileSync } from "node:fs";
import { looksLikePersonalExpenseWorkbook, parsePersonalExpenseWorkbook, suggestPersonalExpenseRows } from "../../lib/neander/finance/personal-expense-import";
import type { FinAccountDoc } from "../../lib/neander/finance/db-types";
import type { FinProjectDoc } from "../../lib/neander/finance/project";
import type { FinTransaction } from "../../lib/neander/finance/types";

const wb = (data: unknown[][]) => {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(data), "내역");
  return book;
};
const detailed = wb([
  [null, "이용일자", "이용카드", "이용가맹점", "계정", "프로젝트명", "이용금액", null, "이번달 결제금액"],
  [null, null, null, null, null, null, null, null, "원금", "수수료"],
  [null, "26.09.18", "비자075", "업무도구", "공용 구독서비스비", null, 110, null, 100, 10],
  [null, "26.10.01", "비자075", "업무도구", "공용 구독서비스비", null, 220, null, 200, 20],
  [null, "합계 4건", null, null, null, null, null, null, 500, 30],
]);
const parsed = parsePersonalExpenseWorkbook(detailed);
assert(looksLikePersonalExpenseWorkbook(detailed));
assert.equal(parsed.rows.length, 2);assert.equal(parsed.actualTotal, 330);
assert.equal(parsed.declaredCount, 4);assert.equal(parsed.declaredTotal, 530);
assert.equal(parsed.rows[0].paymentLabel, "비자075");
assert.equal(parsed.from, "2026-09-18");assert.equal(parsed.to, "2026-10-01");
assert.equal(parsed.errors.length, 0);assert.equal(parsed.warnings.length, 3);
console.log("✓ two-line headers, two-digit years, actual dates, fees already included, count/total discrepancies");

const repeated = parsePersonalExpenseWorkbook(wb([
  ["사용일", "사용처", "금액"],
  ["2026-10-15", "API서비스", 1000], ["2026-10-15", "API서비스", 1000],
  ["2026-10-16", "API서비스", -200],
]));
assert.equal(repeated.rows.length, 3);assert.equal(repeated.rows[2].txType, "환급");
assert.equal(repeated.actualTotal, 1800);
console.log("✓ repeated real charges preserved and refunds subtract once");

const bad = parsePersonalExpenseWorkbook(wb([
  ["사용일", "사용처", "금액"],
  ["2026-02-30", "도구", 100], ["2026-10-01", "도구", "$20"],
  ["2026-10-02", "도구", 12.5], ["2026-10-03", "", 100],
]));
assert.equal(bad.rows.length, 0);assert.equal(bad.errors.length, 4);
console.log("✓ invalid dates, unknown vendors, foreign amounts and fractional KRW are reported");

const account = { id: "sub", lookupKey: "지출|운영비|일반운영비|구독서비스비", txType: "지출", major: "운영비", mid: "일반운영비", minor: "구독서비스비", active: true } as FinAccountDoc;
const suggestions = suggestPersonalExpenseRows(parsed.rows, [account], [], []).rows;
assert(suggestions.every((r) => r.bizMajor === "공용" && r.bizMinor === "공용" && !r.projectCode));
assert(suggestions.every((r) => r.acctMinor === "구독서비스비"));
console.log("✓ shared subscription costs need no project and use the existing expense account");

const project = { id: "project001", code: "WEB-TEST", name: "2026 예시 웹사이트", client: "예시고객", status: "active", bizMinor: "개발", contractAmount: 0, revenues: [], lines: [], createdAt: 0 } as FinProjectDoc;
const domainAccount = { ...account, id: "domain", lookupKey: "지출|서비스개발비|서버인프라비용|도메인비", major: "서비스개발비", mid: "서버인프라비용", minor: "도메인비" } as FinAccountDoc;
const existing = { id: "bank-cost", date: "2026-10-08", txType: "지출", vendor: "예시고객 도메인 구매", gross: 19800, adjust: 0, acctMajor: domainAccount.major, acctMid: domainAccount.mid, acctMinor: domainAccount.minor, projectCode: project.code, status: "confirmed", createdAt: 0, dedupHash: "existing" } as FinTransaction;
const withProject = suggestPersonalExpenseRows([{ rowNo: 4, date: "2026-10-08", vendor: "결제대행-도메인", gross: 19800, txType: "지출", accountText: "B2B 도메인비", projectText: "예시고객" }], [domainAccount], [project], [existing]).rows[0];
assert.equal(withProject.projectCode, project.code);assert.equal(withProject.acctMinor, "도메인비");
assert.equal(withProject.duplicateCandidates?.[0].id, existing.id);
const unknown = suggestPersonalExpenseRows([{ ...parsed.rows[0], projectText: "신규프로젝트:알수없는건" }], [account], [project], []).rows[0];
assert.equal(unknown.projectCode, undefined);assert(unknown.warnings?.some((w) => w.includes("알수없는건")));
console.log("✓ unique project matches, cross-account cost duplicates, and unknown project source notes");

const fullCard = parsePersonalExpenseWorkbook(wb([["사용일", "사용처", "금액", "이용카드"], ["2026-10-01", "도구", 100, "1234-5678-9012-3456"]]));
assert.equal(fullCard.rows[0].paymentLabel, "개인카드 …3456");
assert(!looksLikePersonalExpenseWorkbook(wb([["사용일", "사용처", "금액", "이용카드"], ["2026-10-01", "도구", 100, "법인카드"]])));
console.log("✓ personal source labels mask full card numbers and corporate drop targets are not guessed");

if (process.argv[2]) {
  const file = XLSX.read(readFileSync(process.argv[2]), { type: "buffer", cellDates: true });
  const result = parsePersonalExpenseWorkbook(file);
  console.log(JSON.stringify({ actualFile: { rows: result.rows.length, total: result.actualTotal, declaredCount: result.declaredCount, declaredTotal: result.declaredTotal, from: result.from, to: result.to, errors: result.errors, warnings: result.warnings } }, null, 2));
}
console.log("Personal expense import verification passed.");
