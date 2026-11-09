// 은행 문자 읽기 (`npm run finance:test-bank-sms`)
// ⚠️ 아래 문구는 실제 신한 문자를 받기 전에 흔한 꼴을 흉내 낸 것이다 — 실제 문자가 오면 그것으로 바꾼다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { balanceLink, parseBankSms } from "./bank-sms";

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
