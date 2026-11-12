// 문자 → 노션 알림 한 줄 (`npm run finance:test-sms-notify`) — 끝자리 · 이름 · 금액은 가짜
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseBankSms } from "./bank-sms";
import { shouldPing, smsNotice } from "./sms-notify";

const at = Date.parse("2026-11-10T16:00:00+09:00");
const doc = (id: string, text: string) => ({ id, receivedAt: at, parsed: parseBankSms(text) });
const NAMES: Record<string, string> = { "account:3456": "신한입금", "card:1234": "(신법)가나다", "card:5678": "(국법)식대" };
const names = (kind: "account" | "card", last4: string) => NAMES[`${kind}:${last4}`];

test("통장 입금 → 입출금알림 · 잔액까지 한 줄", () => {
  const n = smsNotice(doc("a", "[Web발신]\n신한11/10 15:57\n140-***-**3456\n입금   1,650,000\n잔액 33,293,118\n 주식회사가나"), names)!;
  assert.equal(n.channel, "inout");
  assert.deepEqual([n.kind, n.amount, n.where, n.balance, n.party, n.at], ["입금", 1_650_000, "신한입금 3456", 33_293_118, "주식회사가나", "2026-11-10T15:57:00+09:00"]);
  // 노션 알림 = 줄 이름(누구) + 댓글(얼마 · 어디) — 겹치지 않게
  assert.equal(n.title, "주식회사가나");
  assert.equal(n.message, "입금 1,650,000원 · 신한입금 · 잔액 33,293,118원");
});

test("ERP 에 없는 통장은 은행 이름 + 끝자리로", () => {
  const n = smsNotice(doc("b", "[Web발신]\n우리 11/10 13:06\n*549999\n출금 320원\nSMS수수료\n잔액 386,622원"), names)!;
  assert.equal(n.title, "SMS수수료");
  assert.equal(n.message, "출금 320원 · 우리 9999 · 잔액 386,622원");
});

test("카드 승인 · 취소 → 카드사용알림", () => {
  const sh = smsNotice(doc("c", "[Web발신]\n신한법인승인 1234 11/10 17:18 12,340원 가나페이 잔액1,000,000원"), names)!;
  assert.equal(sh.channel, "card");
  assert.deepEqual([sh.kind, sh.amount, sh.where, sh.party, sh.balance], ["승인", 12_340, "(신법)가나다 1234", "가나페이", 1_000_000]);
  assert.equal(sh.title, "가나페이");
  // 카드 문자 속 잔액도 끝에 (신한 = 남은 한도)
  assert.equal(sh.message, "12,340원 · (신법)가나다 · 잔액 1,000,000원");
  const kb = smsNotice(doc("d", "[Web발신]\nKB국민카드\n5678(기업)\n11/10 17:28\n4,560원\n라마 사용취소"), names)!;
  assert.equal(kb.title, "라마");
  // 국민카드 문자에는 잔액이 없다 → 안 붙는다
  assert.equal(kb.message, "취소 4,560원 · (국법)식대");
});

test("거래가 아닌 문자는 알림 없음 · 문턱 아래는 줄만", () => {
  assert.equal(smsNotice(doc("e", "[신한은행] 인증번호 [123456] 타인에게 알려주지 마세요"), names), null);
  assert.equal(smsNotice(doc("f", "[Web발신]\nKB국민카드 주식회사 가나(1234)님 카드사용알림서비스 변경 완료."), names), null);
  const tiny = smsNotice(doc("g", "[Web발신]\n신한11/10 02:38\n140-***-**3456\n출금   1\n잔액 29,145,804\n (주)가나"), names)!;
  assert.equal(shouldPing(tiny, 0), true);
  assert.equal(shouldPing(tiny, 1_000), false);
});
