// 은행 문자 읽기 (`npm run finance:test-bank-sms`)
// 첫 시험은 실제 신한 문자 꼴(2026-11-10 받은 것 — 계좌 · 이름 · 금액만 가짜로 바꿈). 나머지는 흔한 꼴을 흉내 낸 것.
import { test } from "node:test";
import assert from "node:assert/strict";
import { balanceLink, parseBankSms } from "./bank-sms";

test("실제 신한 꼴 — 은행 이름에 날짜가 붙고 금액 앞 빈칸이 길다", () => {
  const out = parseBankSms("[Web발신]\n신한11/10 02:38\n140-***-**3456\n출금           1\n잔액 29,145,804\n (주)가나다");
  assert.deepEqual(
    [out.bank, out.kind, out.amount, out.balance, out.last4, out.when, out.memo, out.ok],
    ["신한", "출금", 1, 29_145_804, "3456", "11-10 02:38", "(주)가나다", true],
  );
  const inn = parseBankSms("[Web발신]\n신한11/10 02:38\n140-***-**5432\n입금           1\n잔액  9,643,054\n (주)가나다");
  assert.deepEqual([inn.kind, inn.amount, inn.balance, inn.last4], ["입금", 1, 9_643_054, "5432"]);
});

test("여러 줄 꼴 — 입금 · 금액 · 잔액 · 끝 네 자리 · 날짜", () => {
  const p = parseBankSms("[Web발신]\n신한 11/10 09:12\n100-***-123456\n입금      1,000,000\n잔액      5,000,000\n (주)가나다");
  assert.equal(p.bank, "신한");
  assert.equal(p.kind, "입금");
  assert.equal(p.amount, 1_000_000);
  assert.equal(p.balance, 5_000_000);
  assert.equal(p.last4, "3456");
  assert.equal(p.when, "11-10 09:12");
  assert.equal(p.memo, "(주)가나다");
  assert.equal(p.ok, true);
});

test("한 줄 꼴 — 출금 · 원 붙음", () => {
  const p = parseBankSms("[신한은행] 11/10 13:05 140-***-765432 출금 250,000원 잔액 1,234,567원 홍길동");
  assert.equal(p.kind, "출금");
  assert.equal(p.amount, 250_000);
  assert.equal(p.balance, 1_234_567);
  assert.equal(p.last4, "5432");
  assert.equal(p.ok, true);
});

test("우리은행 꼴 — 별표 뒤 여섯 자리 · 줄마다 한 칸 (acscent · SMOAT 입금 확인이 받는 형식)", () => {
  const p = parseBankSms("[Web발신]\n우리 11/09 14:23\n*123456\n입금 48,000원\n가나다\n잔액 1,234,567원");
  assert.equal(p.bank, "우리");
  assert.equal(p.last4, "3456");
  assert.equal(p.kind, "입금");
  assert.equal(p.amount, 48_000);
  assert.equal(p.balance, 1_234_567);
  assert.equal(p.when, "11-09 14:23");
  assert.equal(p.memo, "가나다");
});

test("실제 우리 출금 꼴 — 받는 분 이름의 「신한」을 은행으로 읽지 않는다", () => {
  const p = parseBankSms("[Web발신]\n우리 11/10 03:14\n*123456\n출금 1원\n신한（주）가나\n잔액 386,942원");
  assert.deepEqual(
    [p.bank, p.last4, p.kind, p.amount, p.balance, p.when, p.ok],
    ["우리", "3456", "출금", 1, 386_942, "11-10 03:14", true],
  );
});

test("거래 문자가 아니면 ok=false", () => {
  assert.equal(parseBankSms("[신한은행] 인증번호 [123456] 타인에게 알려주지 마세요").ok, false);
});

test("잔액이 이어지면 빠진 거래 없음, 어긋나면 그 차이", () => {
  const a = parseBankSms("신한 11/10 09:00 100-***-123456 입금 100,000 잔액 1,100,000");
  const b = parseBankSms("신한 11/10 10:00 100-***-123456 출금 30,000 잔액 1,070,000");
  const c = parseBankSms("신한 11/10 12:00 100-***-123456 입금 10,000 잔액 1,580,000");
  assert.deepEqual(balanceLink(a, b), { continuous: true });
  assert.deepEqual(balanceLink(b, c), { continuous: false, gap: 500_000 });
  assert.deepEqual(balanceLink(undefined, c), { continuous: null });
});
