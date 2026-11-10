// 은행 문자 읽기 (`npm run finance:test-bank-sms`)
// 첫 시험은 실제 신한 문자 꼴(2026-11-10 받은 것 — 계좌 · 이름 · 금액만 가짜로 바꿈). 나머지는 흔한 꼴을 흉내 낸 것.
import { test } from "node:test";
import assert from "node:assert/strict";
import { balanceLink, matchCardLast4, parseBankSms } from "./bank-sms";

test("실제 신한 꼴 — 은행 이름에 날짜가 붙고 금액 앞 빈칸이 길다", () => {
  const out = parseBankSms("[Web발신]\n신한11/10 02:38\n140-***-**3456\n출금           1\n잔액 29,145,804\n (주)가나다");
  assert.deepEqual(
    [out.bank, out.kind, out.amount, out.balance, out.last4, out.when, out.memo, out.ok],
    ["신한", "출금", 1, 29_145_804, "3456", "11-10 02:38", "(주)가나다", true],
  );
  const inn = parseBankSms("[Web발신]\n신한11/10 02:38\n140-***-**5432\n입금           1\n잔액  9,643,054\n (주)가나다");
  assert.deepEqual([inn.kind, inn.amount, inn.balance, inn.last4], ["입금", 1, 9_643_054, "5432"]);
});

test("상대 이름은 장부와 같은 글자 그대로 — 가맹점 번호 · 귀속월 앞머리 · 이름 속 은행 낱말", () => {
  const card = parseBankSms("[Web발신]\n신한11/10 07:01\n140-***-**3456\n입금      95,220\n잔액 29,563,551\n KB12345678");
  assert.equal(card.memo, "KB12345678");
  const ins = parseBankSms("[Web발신]\n신한11/10 07:04\n140-***-**3456\n출금   1,237,560\n잔액 8,405,497\n 2610국민건강");
  assert.equal(ins.memo, "2610국민건강");
  const woori = parseBankSms("[Web발신]\n우리 11/10 03:14\n*123456\n출금 1원\n신한（주）가나\n잔액 386,942원");
  assert.equal(woori.memo, "신한（주）가나");
  const one = parseBankSms("[신한은행] 11/10 13:05 140-***-765432 출금 250,000원 잔액 1,234,567원 원천세 홍길동");
  assert.equal(one.memo, "원천세 홍길동");
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

test("실제 신한 법인카드 꼴 — 「신한법인승인 끝자리」 한 줄 · 끝의 잔액은 금액이 아니다", () => {
  // 2026-11-10 받은 것 — 끝자리 · 금액 · 가맹점 · 잔액만 가짜로 바꿈
  const p = parseBankSms("[Web발신]\n신한법인승인 1234 11/10 17:18 12,340원 가나다페이 잔액1,000,000원");
  assert.equal(p.channel, "card");
  assert.equal(p.kind, undefined);
  assert.deepEqual(
    [p.ok, p.card?.company, p.card?.last4, p.card?.approval, p.card?.amount, p.card?.merchant, p.card?.remaining, p.when],
    [true, "신한카드", "1234", "승인", 12_340, "가나다페이", 1_000_000, "11-10 17:18"],
  );
  const no = parseBankSms("[Web발신]\n신한법인취소 1234 11/10 17:40 12,340원 가나다페이 잔액1,012,340원");
  assert.deepEqual([no.card?.approval, no.card?.amount, no.card?.last4], ["취소", 12_340, "1234"]);
});

test("실제 국민 법인카드 꼴 — 여러 줄 · 「승인」 대신 「사용」 · 끝자리 뒤 (기업)", () => {
  // 2026-11-10 받은 것 — 끝자리 · 금액 · 가맹점만 가짜로 바꿈
  const p = parseBankSms("[Web발신]\nKB국민카드\n1234(기업)\n11/10 17:28\n4,560원\n가나다 사용");
  assert.equal(p.channel, "card");
  assert.deepEqual(
    [p.ok, p.card?.company, p.card?.last4, p.card?.approval, p.card?.amount, p.card?.merchant, p.when],
    [true, "KB국민카드", "1234", "승인", 4_560, "가나다", "11-10 17:28"],
  );
  const no = parseBankSms("[Web발신]\nKB국민카드\n1234(기업)\n11/10 17:40\n4,560원\n가나다 사용취소");
  assert.deepEqual([no.card?.approval, no.card?.amount, no.card?.merchant], ["취소", 4_560, "가나다"]);
});

test("카드사 안내 · 광고 문자는 카드 거래가 아니다", () => {
  const notice = parseBankSms("[Web발신]\nKB국민카드 주식회사 가나(1234)님 카드사용알림서비스 변경 완료. 좋은 하루 되세요");
  assert.equal(notice.ok, false);
  assert.notEqual(notice.channel, "card");
  const ad = parseBankSms("(광고)[KB국민카드] 11/30 23:59까지 5,000원 할인 쿠폰 사용하세요");
  assert.equal(ad.ok, false);
  assert.notEqual(ad.channel, "card");
});

test("가린 카드 끝자리(「3*0*」)는 카드 목록에서 하나만 맞을 때 그 카드", () => {
  const kb = parseBankSms("[Web발신]\nKB국민카드1*3*승인\n가*나님\n8,000원 일시불\n11/10 12:05\n라마바식당\n누적120,000원");
  assert.deepEqual([kb.card?.company, kb.card?.last4, kb.card?.holder, kb.card?.amount, kb.card?.merchant], ["KB국민카드", "1*3*", "가*나", 8_000, "라마바식당"]);
  assert.equal(matchCardLast4("1*3*", ["1234", "5678"]), "1234");
  assert.equal(matchCardLast4("1*3*", ["1234", "1939"]), undefined);
  assert.equal(matchCardLast4("5678", []), "5678");
});

test("카드값 출금(적요 「신한카드」)은 은행 출금으로 읽는다", () => {
  const p = parseBankSms("[Web발신]\n신한11/15 09:00\n140-***-**3456\n출금   3,000,000\n잔액 1,000,000\n 신한카드");
  assert.deepEqual([p.channel, p.kind, p.amount, p.last4], ["bank", "출금", 3_000_000, "3456"]);
});

test("카드 승인 문자 (흔한 꼴 — 실제 법인카드 문자 받기 전) — 은행 입출금으로 읽지 않는다", () => {
  const sh = parseBankSms("[Web발신]\n신한카드(1234)승인\n가*나\n12,000원(일시불)\n11/10 13:22\n가나다상점\n누적1,234,567원");
  assert.equal(sh.channel, "card");
  assert.equal(sh.kind, undefined);
  assert.deepEqual(
    [sh.ok, sh.card?.company, sh.card?.last4, sh.card?.approval, sh.card?.amount, sh.card?.installment, sh.card?.merchant, sh.card?.cumulative, sh.when],
    [true, "신한카드", "1234", "승인", 12_000, "일시불", "가나다상점", 1_234_567, "11-10 13:22"],
  );
  const kb = parseBankSms("[Web발신]\nKB국민카드5678승인취소\n가*나\n9,900원 일시불\n11/10 14:01\n라마바\n누적100,000원");
  assert.deepEqual([kb.card?.company, kb.card?.last4, kb.card?.approval, kb.card?.amount], ["KB국민카드", "5678", "취소", 9_900]);
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
