// ============================================================
//  급여·세무 서류 읽기 · 대조 점검 — DB 를 건드리지 않는다
// ------------------------------------------------------------
//  세무사 서식(급여대장 · 명세서 · 사업대장 · 원천세 신고서 · 납부서 · 부가세)을
//  pdf.js 가 풀어 낸 모양 그대로 흉내 낸 글자로 읽기 규칙을 본다. 이름 · 금액은
//  지어낸 것이다 — 저장소가 공개라 실제 서류 글자를 여기 두지 않는다.
//
//    npm run finance:verify-tax-docs
// ============================================================

import { folderMonthOf, readTaxDoc, shareSiblingPeriod } from "@/lib/neander/finance/tax-docs-parse";
import { buildTaxMonths, buildVatQuarters, nextBusinessDay, vatDueOf } from "@/lib/neander/finance/tax-docs-check";
import { isTaxFolderPick, personKey, pickCurrent, type TaxDoc } from "@/lib/neander/finance/tax-docs";
import type { FinTransaction } from "@/lib/neander/finance/types";

let fails = 0;
const eq = (got: unknown, want: unknown, label: string) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(ok ? "  ✓" : "  ✗", label, ok ? "" : `— got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
};

// ---- 서식 글자 (지어낸 사람 · 금액) ----------------------------------

const PAYROLL_LEDGER = `2026년09월분 급여대장
[귀속:2026년09월] [지급:2026년09월30일] page :주식회사네안데르 정렬: 코드순 1 / 1
인적사항 기 본 급 여 및 제 수 당 공 제 및 차 인 지 급 액
사원번호 성 명 기본급 국민연금 건강보험 고용보험 장기요양보험료 소득세 지방소득세
입사일 직 급 국민연금정산 고용보험정산 공제합계
퇴사일 부 서 지급합계 차인지급액
0001 가나다(대표) 2,000,000 90,000 70,000 9,000 20,000 2,000
2024-01-01 대표이사 191,000
2,000,000 1,809,000
12 라마바 1,800,000 81,000 63,000 16,200 8,100 10,000 1,000
2025-03-01 -5,000 174,300
1,800,000 1,625,700
합계(2명)
3,800,000 171,000 133,000 16,200 17,100 30,000 3,000
-5,000 365,300
3,800,000 3,434,700`;

const payslip = (code: string, name: string, gross: string, deduct: string, net: string, income: string, local: string) => `2026년09월분 급여명세서
회사명: 주식회사네안데르 지급일: 2026.09.30
사원코드: ${code} 사원명: ${name} 생년월일: 2000.01.01
기본급 ${gross} 국민연금 90,000
소득세 ${income}
지방소득세 ${local}
연말정산소득세 -1,000
지 급 내 역 지 급 액 공 제 내 역 공 제 액
공 제 액 계 ${deduct}
지 급 액 계 ${gross} 차인지급액 ${net}`;

const BIZ_LEDGER = `(2026년09월) 사업소득지급대장(합계)
회사명:주식회사네안데르
NO 코드 성 명
귀속년월
지급액
소득세 예술/특고인경비 학자금상환액
영수인
지급년월 지방소득세 고용보험료 산재보험료 차인지급액
1 000101 사아자
2026.09
500,000
15,000
2026.09 1,500 483,500
2 000102 차카타
2026.09
1,000,000
30,000
2026.09 3,000 967,000
총 계 1,500,000 45,000
4,500 1,450,500`;

const WHT_RETURN = `원천징수명세및납부세액 (단위: 원)
간이세액 A01 2 3,800,000 30,000
중도퇴사 A02
가감계 A10 2 3,800,000 30,000 5,000 25,000
매월징수 A25 2 1,500,000 45,000
가감계 A30 2 1,500,000 45,000 45,000
총합계 A99 4 5,300,000 75,000 5,000 70,000
환급세액조정 (단위: 원)
년 월
년 월
여 , 부
2026 09
2026 09
원천징수이행상황신고서
법인명(상호) 주식회사네안데르`;

const bill = (label: string, digits: string, ym: string) => `■ 국세징수법 시행규칙[별지 제1호서식]
영수증서(납세자용) (1면)
상호
(성명) 주식회사 네안데르 사업자등록번호
연도/기분 ${ym}
세목명 납부금액
${label} ${digits}
교육/방위세 0
계 ${digits}
납부기한 2026년 10월 12일`;

const VAT_RECEIPT = `부가가치세 신고서 접수증
접수번호 105-2026-2-000000000000 접수일시 2026-10-20 11:00:00 접수결과 정상
상호(성명) 주식회사 네안데르
신고년기 2026년 2기 신고기간 2026-07-01 ~ 2026-09-30
과세표준 50,000,000 차가감납부할세액 1,234,567
실제납부할세액 1,234,567`;

const VAT_RETURN = `■ 부가가치세법 시행규칙 [별지 제21호서식]
일반과세자 부가가치세 [ ]예정 [ ]확정
신고기간 2026 년 제 2 기 ( 07 월 01 일 ~ 09 월 30 일)
과세표준및매출세액
합 계 (9) 50,000,000 ㉮ 5,000,000
차 감 계 (16)-(17) (18) 37,654,330 ㉯ 3,765,433
차감ㆍ가감하여 납부할 세액(환급받을 세액)(㉰-㉱) (30) 1,234,567`;

const VAT_BILL = `■ 국세징수법 시행규칙[별지 제1호서식]
연도/기분 2026년 2기분
세목명 납부금액
부가가치세 1 , 2 3 4 , 5 6 0
계 1 , 2 3 4 , 5 6 0
납부기한 2026년 10월 26일`;

const BIZ_CERT = `■소득세법시행규칙[별지제23호서식(2)](2025.03.21 개정)
거주자의사업소득원천징수영수증
지 급 소득귀속
연 월 일 연 월 소 득 세 지방소득세 계
2026 09 30 2026 09 500,000 3.0% 15,000 1,500 16,500
주식회사네안데르
사아자`;

console.log("서식 읽기");
{
  const g = readTaxDoc({ name: "9월 급여대장.pdf", pages: [PAYROLL_LEDGER] });
  eq([g.kind, g.period, g.entity, g.periodSource], ["payroll-ledger", "2026-09", "네안데르", "text"], "급여대장 — 종류 · 귀속 · 상호");
  eq(g.data?.payDate, "2026-09-30", "급여대장 — 지급일");
  eq(g.data?.people?.map((p) => [p.name, p.gross, p.deduct, p.net]), [["가나다(대표)", 2000000, 191000, 1809000], ["라마바", 1800000, 174300, 1625700]], "급여대장 — 사람마다 지급 · 공제(정산 칸 포함) · 차인");
  eq(g.data?.total, { count: 2, gross: 3800000, net: 3434700, deduct: 365300, incomeTax: 30000, localTax: 3000 }, "급여대장 — 합계 줄");
}
{
  const two = readTaxDoc({ name: "급여명세서.pdf", pages: [payslip("0001", "가나다(대표)", "2,000,000", "191,000", "1,809,000", "20,000", "2,000"), payslip("12", "라마바", "1,800,000", "174,300", "1,625,700", "10,000", "1,000")] });
  eq([two.kind, two.period, two.data?.payDate], ["payslip", "2026-09", "2026-09-30"], "명세서 묶음 — 종류 · 귀속 · 지급일");
  eq(two.data?.people?.map((p) => [p.name, p.net, p.incomeTax, p.localTax]), [["가나다(대표)", 1809000, 20000, 2000], ["라마바", 1625700, 10000, 1000]], "명세서 — 쪽마다 한 사람 · 「연말정산소득세」 를 소득세로 안 읽음");
}
{
  const g = readTaxDoc({ name: "9월 사업대장.pdf", pages: [BIZ_LEDGER] });
  eq([g.kind, g.period], ["biz-ledger", "2026-09"], "사업대장 — 종류 · 귀속");
  eq(g.data?.people?.map((p) => [p.code, p.name, p.gross, p.incomeTax, p.localTax, p.net]), [["000101", "사아자", 500000, 15000, 1500, 483500], ["000102", "차카타", 1000000, 30000, 3000, 967000]], "사업대장 — 지급액 · 소득세 · 지방소득세 · 차인");
  eq(g.data?.total, { count: 2, gross: 1500000, incomeTax: 45000, localTax: 4500, net: 1450500, deduct: 49500 }, "사업대장 — 총계");
}
{
  const g = readTaxDoc({ name: "9월 신고서.pdf", pages: [WHT_RETURN] });
  eq([g.kind, g.period, g.data?.payMonth], ["wht-return", "2026-09", "2026-09"], "원천세 신고서 — 귀속연월 · 지급연월");
  eq(g.data?.wage, { count: 2, gross: 3800000, tax: 30000, paid: 25000, adjust: 5000 }, "신고서 — 환급을 당겨 쓴 달은 납부세액이 마지막 칸");
  eq(g.data?.biz, { count: 2, gross: 1500000, tax: 45000, paid: 45000 }, "신고서 — 사업소득 가감계");
}
{
  const g = readTaxDoc({ name: "국세.pdf", pages: [bill("근로소득세(갑)", "2 5 , 0 0 0", "2026년 09월"), bill("사업소득세", "4 5 , 0 0 0", "2026년 09월")] });
  eq([g.kind, g.period, g.data?.dueDate], ["wht-bill", "2026-09", "2026-10-12"], "국세 납부서 — 귀속 · 기한");
  eq(g.data?.items, [{ label: "근로소득세(갑)", amount: 25000 }, { label: "사업소득세", amount: 45000 }], "납부서 — 한 자씩 띄어 쓴 금액 · 쪽마다 한 장");
}
{
  const r = readTaxDoc({ name: "접수증.pdf", pages: [VAT_RECEIPT] });
  eq([r.kind, r.period, r.data?.vat], ["vat-receipt", "2026-Q3", { from: "2026-07-01", to: "2026-09-30", base: 50000000, payable: 1234567, filedAt: "2026-10-20" }], "부가세 접수증");
  const t = readTaxDoc({ name: "주식회사 네안데르_부가가치세신고_202607~202609.pdf", pages: [VAT_RETURN] });
  eq([t.kind, t.period, t.data?.vat?.base, t.data?.vat?.payable, t.data?.vat?.buyTax], ["vat-return", "2026-Q3", 50000000, 1234567, 3765433], "부가세 신고서 — 과세기간 끝 달로 분기");
  const b = readTaxDoc({ name: "납부서.pdf", pages: [VAT_BILL] });
  eq([b.kind, b.period, b.data?.items?.[0]?.amount], ["vat-bill", "2026-Q3", 1234560], "부가세 납부서 — 기한 달로 분기 (10월 → 3분기)");
}
{
  const g = readTaxDoc({ name: "사아자_940909.pdf", pages: [BIZ_CERT] });
  eq([g.kind, g.period, g.data?.payDate, g.data?.people?.[0]?.name, g.data?.people?.[0]?.net], ["biz-cert", "2026-09", "2026-09-30", "사아자", 483500], "사업소득 원천징수영수증");
}

console.log("글자 없는 스캔본 · 파일 이름 · 폴더");
{
  const nfd = "2월 지방세 신고서_네안데르.pdf".normalize("NFD");
  const g = readTaxDoc({ name: nfd, pages: [""], folderMonth: "2026-02" });
  eq([g.kind, g.period, g.scanned, g.periodSource], ["local-bill", "2026-02", true, "name"], "macOS 자모 풀린 이름(NFD)도 낱말이 맞는다");
  const s = readTaxDoc({ name: "접수증_3월_(주)네안데르.pdf", pages: [""], folderMonth: "2026-03" });
  eq([s.kind, s.period], ["wht-receipt", "2026-03"], "원천세 접수증 — 이름의 「3월」");
  const f = readTaxDoc({ name: "지방세.pdf", pages: [""], folderMonth: "2026-07" });
  eq([f.kind, f.period, f.periodSource], ["local-bill", "2026-07", "folder"], "이름에 달이 없으면 폴더 달");
  const w = readTaxDoc({ name: "급여명세서(근로기준1)_19_가나다_202607.pdf", pages: [""], folderMonth: "2026-08" });
  eq([w.kind, w.period], ["payslip", "2026-07"], "이름의 202607 이 폴더(8월)보다 먼저");
  eq(folderMonthOf("2026/10월/급여명세/a.pdf"), "2026-10", "폴더 경로 → 달");
  const sheet = readTaxDoc({ name: "0101지급.xlsx", pages: [], folderMonth: "2026-01" });
  eq([sheet.kind, sheet.period, sheet.scanned, sheet.reason.includes("스캔본")], ["pay-sheet", "2026-01", false, false], "MMDD지급 — 0101 은 1월 1일 (2001년 1월이 아니다) · 엑셀은 스캔본이 아니다");
  eq(readTaxDoc({ name: "(주)네안데르_인건비 신고내역(2604).xls", pages: [] }).period, "2026-04", "인건비 신고내역 — (2604) 는 2026년 4월");
  eq(folderMonthOf("제2분기/납부서.pdf", "2026"), undefined, "분기 폴더는 달이 아니다");
}
{
  const group = [
    { ...readTaxDoc({ name: "국세.pdf", pages: [bill("근로소득세(갑)", "1 0 0", "2026년 06월")], folderMonth: "2026-07" }), id: "a" },
    { ...readTaxDoc({ name: "지방세.pdf", pages: [""], folderMonth: "2026-07" }), id: "b" },
    { ...readTaxDoc({ name: "2월 지방세.pdf", pages: [""], folderMonth: "2026-07" }), id: "c" },
  ];
  const out = shareSiblingPeriod(group);
  eq(out.map((g) => [g.id, g.period, g.periodSource]), [["a", "2026-06", "text"], ["b", "2026-06", "sibling"], ["c", "2026-02", "name"]], "같이 올린 국세 납부서의 귀속을 빌린다 — 이름에 적힌 달은 그대로");
  const mixed = shareSiblingPeriod([...group, { ...readTaxDoc({ name: "x.pdf", pages: [bill("사업소득세", "1 0", "2026년 05월")] }), id: "d" }]);
  eq(mixed.find((g) => g.id === "b")?.period, "2026-07", "두 달이 섞인 묶음은 안 빌린다");
}

{
  eq(
    ["2026/10월/10월 신고서.pdf", "2026/10월/급여명세서.zip", "2026/10월/1001지급.xlsx", "2026/7월/2607(주)네안데르_장부.xlsx", "2026/예결산/Q1/Q1_통합거래장_인쇄용_1.pdf", "2026/5월/참고자료/a.pdf", "2026/7월/~$장부.xlsx"].map((p) => isTaxFolderPick(p)),
    [true, true, false, false, false, false, false],
    "폴더째 올리기 — 세무사 서류만 (장부 엑셀 · 통합거래장 · 참고자료 · 잠금 파일은 뺀다)",
  );
  eq(isTaxFolderPick("2026/10월/1001지급.xlsx", true), true, "급여 작업 엑셀은 withSheets 일 때만");
}

console.log("대조");
const doc = (id: string, name: string, text: string | string[], createdAt = 1): TaxDoc => {
  const g = readTaxDoc({ name, pages: Array.isArray(text) ? text : [text] });
  return { id, name, type: "application/pdf", size: 1, uploadedBy: "t", createdAt, kind: g.kind, period: g.period, entity: g.entity, data: g.data, reason: g.reason };
};
const tx = (id: string, date: string, vendor: string, amount: number, acctMid: string, acctMinor: string, acctMajor = acctMid === "급여" ? "인건비" : "세금공과"): FinTransaction =>
  ({ id, date, txType: "지출", vendor, gross: amount, adjust: 0, acctMajor, acctMid, acctMinor, status: "confirmed" }) as FinTransaction;

const monthDocs = [
  doc("l", "9월 급여대장.pdf", PAYROLL_LEDGER),
  doc("s", "명세서.pdf", [payslip("0001", "가나다(대표)", "2,000,000", "191,000", "1,809,000", "20,000", "2,000"), payslip("12", "라마바", "1,800,000", "174,300", "1,625,000", "10,000", "1,000")]),
  doc("b", "사업대장.pdf", BIZ_LEDGER),
  doc("r", "신고서.pdf", WHT_RETURN),
  doc("n", "국세.pdf", [bill("근로소득세(갑)", "2 5 , 0 0 0", "2026년 09월"), bill("사업소득세", "4 5 , 0 0 0", "2026년 09월")]),
];
{
  const txs = [
    tx("w", "2026-10-12", "국세납부", 25000, "국세", "원천징수소득세(사업 3.3%)"),
    tx("z", "2026-10-12", "국세납부", 45000, "국세", "원천징수소득세(근로)"),
    tx("k", "2026-10-12", "서울시지방세", 7500, "지방세", "지방소득세(법인)"),
    tx("p1", "2026-10-01", "가나다", 1809500, "급여", "임원급여"),
    tx("p2", "2026-10-01", "라마바", 1625700, "급여", "직원급여"),
    tx("p3", "2026-10-01", "사아자 급여", 483500, "급여", "직원급여"),
  ];
  const [m] = buildTaxMonths(monthDocs, txs, "2026-10-27");
  const state = (k: string) => [...m.checks, ...m.ledgerChecks].find((c) => c.key === k)?.state;
  eq([m.whtWage, m.whtBiz, m.localDue, m.dueDate], [25000, 45000, 7500, "2026-10-12"], "낼 돈 — 납부서 금액 · 지방소득세는 대장 합 · 기한은 납부서");
  eq([state("wage-gross"), state("wage-tax"), state("biz-gross"), state("bill-wage"), state("bill-biz")], ["ok", "ok", "ok", "ok", "ok"], "서류끼리 — 대장 · 신고서 · 납부서가 맞다");
  eq(state("slips"), "bad", "명세서 차인지급액이 대장과 다른 사람이 있으면 「안 맞음」");
  eq([state("ledger-wage"), state("ledger-biz"), state("ledger-local")], ["warn", "warn", "ok"], "장부 — 금액은 맞고 근로 · 사업 계정이 서로 바뀐 것을 짚는다");
  eq(m.people.map((p) => [p.name, p.paid?.diff ?? null]), [["가나다(대표)", 500], ["라마바", 0], ["사아자", 0], ["차카타", null]], "사람별 장부 지급 — 이름이 같은 인건비 지출 · 차이");
}
{
  const before = buildTaxMonths(monthDocs, [], "2026-10-11")[0];
  eq(before.ledgerChecks.map((c) => c.state), ["wait", "wait", "wait"], "기한 전에는 「납부 전」");
  const after = buildTaxMonths(monthDocs, [], "2026-10-20")[0];
  eq(after.ledgerChecks.map((c) => c.state), ["bad", "bad", "bad"], "기한이 닷새 넘게 지났는데 장부에 없으면 「안 맞음」");
  const once = buildTaxMonths(monthDocs, [tx("t", "2026-10-12", "국세납부", 70000, "국세", "원천징수소득세(근로)")], "2026-10-27")[0];
  eq(once.ledgerChecks[0]?.key, "ledger-wht", "근로 · 사업을 한 번에 낸 달");
}
{
  const noLedger = buildTaxMonths(monthDocs.filter((d) => d.id !== "l"), [], "2026-10-27")[0];
  eq([noLedger.checks.some((c) => c.key === "slips"), noLedger.people.filter((p) => p.type === "wage").map((p) => p.slipNet ?? null)], [false, [null, null]], "급여대장이 없는 달은 명세서를 자기 자신과 견주지 않는다");
  const local = buildTaxMonths(monthDocs, [tx("k2", "2026-10-12", "서울시지방세", 7000, "지방세", "지방소득세(법인)")], "2026-10-27")[0];
  eq([local.refundAdjusted, local.ledgerChecks.find((c) => c.key === "ledger-local")?.state], [true, "warn"], "환급을 당겨 쓴 달의 지방소득세는 금액이 달라도 「확인」");
}
{
  const fixed = doc("b2", "정정 사업대장.pdf", BIZ_LEDGER.replace("1,000,000\n30,000", "900,000\n27,000"), 0);
  eq(pickCurrent([monthDocs[2], fixed])?.id, "b2", "판이 둘이면 「정정」 붙은 것 (먼저 올렸어도)");
  eq(personKey("가나다(대표)") === personKey("가나다님") && personKey("가나다 급여").includes(personKey("가나다")), true, "이름 맞추기");
}
{
  const vat = [doc("v1", "접수증.pdf", VAT_RECEIPT), doc("v2", "납부서.pdf", VAT_BILL)];
  const [late] = buildVatQuarters(vat, [tx("x", "2026-10-27", "마포", 1234830, "국세", "부가가치세(VAT)")], "2026-10-28");
  eq([late.period, late.entity, late.billed, late.checks.find((c) => c.key === "vat-ledger")?.state], ["2026-Q3", "네안데르", 1234560, "warn"], "부가세 — 기한 넘겨 조금 더 낸 것은 「확인」 (납부지연가산세)");
  eq(vatDueOf("2026-Q1"), "2026-04-27", "1분기 기한 4/25 가 토요일이면 월요일");
  eq(vatDueOf("2026-Q4"), "2027-01-25", "4분기 기한은 다음 해 1월");
  eq(nextBusinessDay("2026-10-10"), "2026-10-12", "원천세 기한 10/10 토요일 → 10/12");
}

console.log(fails ? `\n✗ ${fails}건 실패` : "\n✓ 모두 통과");
process.exit(fails ? 1 : 0);
