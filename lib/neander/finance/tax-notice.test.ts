// 세금 고지서 읽기 · 돈 나가는 날 한 줄 (`npm run finance:test-tax-notice`)
//
// ⚠️ 아래 문구는 실제 알림을 받기 전에 쓴 **짐작** 이다 (국세청 · 위택스는 양식을 공개하지 않는다).
//    전용폰으로 첫 알림이 오면 받은 문자함(neander_fin_sms_inbox) 원문을 여기에 그대로 더한다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { arrivalText, noticeLabel, noticeNeeds, noticeRule, readTaxNotice, type TaxNotice } from "./tax-notice";
import { buildMoneyRows } from "./money-calendar";
import type { FinTransaction } from "./types";

const at = Date.parse("2026-11-14T12:00:00+09:00");

test("국세 전자고지 — 세목 · 금액 · 납기 · 사업자 · 꼬리표", () => {
  const r = readTaxNotice({
    from: "카카오톡:국세청",
    receivedAt: at,
    text: "[국세청] 국세 고지서가 도착했습니다.\n납세자: (주)네안데르\n세목: 부가가치세(예정고지)\n납부할 세액: 790,130원\n납부기한: 2026.11.27\n전자납부번호: 0126-1-11-012345678",
  });
  assert.ok(r);
  assert.equal(r.kind, "notice");
  assert.equal(r.level, "국세");
  assert.equal(r.item, "부가가치세");
  assert.deepEqual(r.tags, ["예정고지"]);
  assert.equal(r.site, "네안데르");
  assert.equal(r.amount, 790_130);
  assert.equal(r.dueDate, "2026-11-27");
  assert.equal(r.payNo, "0126-1-11-012345678");
});

test("홈택스 납부 화면 글자 — 가린 사업자번호로 사업자, 귀속 연월", () => {
  const r = readTaxNotice({
    from: "",
    receivedAt: at,
    text: "국세청 홈택스 고지분(체납) 부가가치세 귀속연월 2026-07 징수기관명 서대문(110) 납세자번호 7151302*** 납부세액 811,640원 납부기한 2026-11-30",
  });
  assert.ok(r);
  assert.equal(r.site, "일해라컴퍼니");
  assert.equal(r.amount, 811_640);
  assert.equal(r.dueDate, "2026-11-30");
  assert.ok(r.tags.includes("체납"));
  assert.equal(r.period, "2026-07");
});

test("지방세 — 위택스 메일 · 해 없는 날짜 · 12월에 받은 1월 납기", () => {
  const r = readTaxNotice({
    from: "noreply@wetax.go.kr",
    subject: "[위택스] 지방세 전자고지서가 송달되었습니다",
    receivedAt: Date.parse("2026-12-20T09:00:00+09:00"),
    text: "마포구청 주민세(사업소분) 납부금액 62,500원 1월 31일까지 납부하시기 바랍니다. 납세자 와작홈즈",
  });
  assert.ok(r);
  assert.equal(r.level, "지방세");
  assert.equal(r.item, "주민세");
  assert.equal(r.office, "마포구청");
  assert.equal(r.site, "와작홈즈");
  assert.equal(r.amount, 62_500);
  assert.equal(r.dueDate, "2027-01-31");
});

test("못 읽은 칸은 비워 두고 고지서는 남긴다", () => {
  const r = readTaxNotice({ from: "1588-0060", receivedAt: at, text: "[국세청] 전자고지서가 도착하였습니다. 손택스에서 확인하세요." });
  assert.ok(r);
  assert.equal(r.kind, "notice");
  assert.equal(r.amount, undefined);
  assert.equal(r.dueDate, undefined);
  assert.deepEqual(noticeNeeds({}), ["납기", "금액", "사업자", "세목"]);
});

test("세금 알림이 아닌 것 · 낸 뒤 알림", () => {
  assert.equal(readTaxNotice({ from: "15771577", receivedAt: at, text: "[신한] 11/14 21:37 출금 811,640원 카카오일컴" }), null);
  assert.equal(readTaxNotice({ from: "국세청", receivedAt: at, text: "[국세청] 인증번호 [123456]을 입력해 주세요" }), null);
  assert.equal(readTaxNotice({ from: "국세청", receivedAt: at, text: "[국세청] 부가가치세 확정신고 기간입니다. 1월 26일까지 신고하시기 바랍니다." }), null);
  const paid = readTaxNotice({ from: "금융결제원", receivedAt: at, text: "국세 인터넷 납부 납부결과: 정상납부 부가가치세 811,640원 서대문(110)세무서" });
  assert.equal(paid?.kind, "paid");
});

const notice = (over: Partial<TaxNotice> = {}): TaxNotice => ({
  id: "AbC123",
  level: "국세",
  item: "부가가치세",
  tags: ["예정고지"],
  site: "네안데르",
  amount: 790_130,
  dueDate: "2026-11-27",
  source: "sms",
  receivedAt: at,
  createdAt: at,
  state: "open",
  ...over,
});

test("고지서 → 돈 나가는 날 한 줄 — 금액이 같은 출금을 찾으면 냈음", () => {
  const rule = noticeRule(notice())!;
  assert.equal(rule.id, "tax-abc123");
  assert.equal(rule.label, "부가가치세 예정고지 (네안데르)");
  assert.equal(rule.once, "2026-11-27");
  assert.ok(rule.window!.before >= 13); // 받은 날(11/14) 뒤에 낸 것도 찾는다

  const rows = buildMoneyRows([rule], [], "2026-11-01", "2026-12-31");
  assert.equal(rows[0].state, "예정");
  assert.equal(rows[0].amount, 790_130);
  const paid = { id: "t", date: "2026-11-20", gross: 790_130, adjust: 0, txType: "지출", site: "네안데르", acctMid: "국세", acctMinor: "원천징수소득세(근로)", status: "confirmed" } as unknown as FinTransaction;
  assert.equal(buildMoneyRows([rule], [paid], "2026-11-01", "2026-12-31")[0].state, "냈음");

  // 금액 모름 · 납기 모름 — 받은 날에 「납기 모름」 으로
  const blank = noticeRule(notice({ amount: undefined, dueDate: undefined }))!;
  assert.equal(blank.once, "2026-11-14");
  assert.match(blank.note ?? "", /납기 모름/);
  assert.deepEqual(blank.match, { site: "네안데르", acctMinor: ["부가가치세(VAT)"] });

  // 무시한 고지서는 줄이 없다 · 사람이 냈음으로 표시
  assert.equal(noticeRule(notice({ state: "dismissed" })), null);
  assert.equal(buildMoneyRows([noticeRule(notice({ state: "paid", paidDate: "2026-11-15" }))!], [], "2026-11-01", "2026-12-31")[0].state, "냈음");
});

test("이름 · 도착 알림 글", () => {
  assert.equal(noticeLabel({ item: undefined, level: "지방세", site: undefined, payer: "홍길동" }), "지방세 고지 (홍길동)");
  assert.equal(arrivalText(notice()), "고지서 도착 · 790,130원 · 납기 11/27(금)");
  assert.equal(arrivalText(notice({ amount: undefined, dueDate: undefined, office: "서대문세무서" })), "고지서 도착 · 서대문세무서 · 납기 · 금액 못 읽음 — ERP 에서 채워 주세요");
});
