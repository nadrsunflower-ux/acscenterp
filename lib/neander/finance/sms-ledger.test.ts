// 문자 거래 → 장부 한 줄 · 월말 엑셀과 짝 맞추기 (`npm run finance:test-sms-ledger`) — 이름 · 금액은 가짜
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseBankSms } from "./bank-sms";
import { smsNotice } from "./sms-notify";
import { matchSmsRow, smsDedupHash, smsLedgerInput, type SmsOpenRow } from "./sms-ledger";
import type { ClassifySuggestion } from "./classify";

const at = Date.parse("2026-11-10T16:00:00+09:00");
const notice = (text: string) => smsNotice({ id: "in1", receivedAt: at, parsed: parseBankSms(text) }, () => undefined)!;
const sug: ClassifySuggestion = { status: "confirmed", txType: "수입", acctMajor: "매출", acctMid: "B2C매출", acctMinor: "와우판매", bizMajor: "B2C", bizMinor: "와우", classReason: "근거", basis: undefined };

test("통장 입금 → 장부 한 줄 · 잠정 표시 · 임시 중복 키 · 잔액", () => {
  const r = smsLedgerInput({ inboxId: "in1", notice: notice("[Web발신]\n신한11/10 07:01\n140-***-**3456\n입금      95,220\n잔액 29,563,551\n KB12345678"), sug, site: "네안데르" });
  assert.deepEqual(
    [r.date, r.datetime, r.last4, r.txType, r.gross, r.vendor, r.balanceAfter, r.status, r.acctMinor, r.site, r.smsOpen, r.smsId, r.dedupHash],
    ["2026-11-10", "2026-11-10 07:01:00", "3456", "수입", 95_220, "KB12345678", 29_563_551, "confirmed", "와우판매", "네안데르", true, "in1", smsDedupHash("in1")],
  );
  assert.ok(r.engineSig);
});

test("분류를 못 하면 검토 대기 · 카드 취소는 지출 음수", () => {
  const r = smsLedgerInput({ inboxId: "c1", notice: notice("[Web발신]\nKB국민카드\n1234(기업)\n11/10 17:40\n4,560원\n가나다 사용취소"), sug: null });
  assert.deepEqual([r.txType, r.gross, r.status, r.balanceAfter], ["지출", -4_560, "needs_review", undefined]);
});

const open: SmsOpenRow[] = [
  { id: "a", date: "2026-11-10", datetime: "2026-11-10 02:38:00", last4: "3456", gross: 1, balanceAfter: 29_145_804, txType: "자금거래" },
  { id: "b", date: "2026-11-10", datetime: "2026-11-10 02:49:00", last4: "3456", gross: 1, balanceAfter: 29_145_802, txType: "자금거래" },
  { id: "c", date: "2026-11-10", datetime: "2026-11-10 17:18:00", last4: "1234", gross: 16_830, txType: "지출" },
  { id: "d", date: "2026-11-11", datetime: "2026-11-11 00:05:00", last4: "1234", gross: 9_000, txType: "지출" },
];

test("통장은 잔액까지 같아야 짝 — 같은 날 같은 금액이 둘이어도 잔액이 가른다", () => {
  assert.equal(matchSmsRow({ date: "2026-11-10", last4: "3456", gross: 1, adjust: 0, balanceAfter: 29_145_802, txType: "지출" }, open, new Set()), "b");
  assert.equal(matchSmsRow({ date: "2026-11-10", last4: "3456", gross: 1, adjust: 0, balanceAfter: 1, txType: "지출" }, open, new Set()), undefined);
});

test("카드는 같은 날 · 같은 금액 · 하루 차이는 후보가 하나일 때만 · 짝지은 줄은 다시 안 쓴다", () => {
  const used = new Set<string>();
  assert.equal(matchSmsRow({ date: "2026-11-10", datetime: "2026-11-10 17:18:00", last4: "1234", gross: 16_830, adjust: 0, txType: "지출" }, open, used), "c");
  used.add("c");
  assert.equal(matchSmsRow({ date: "2026-11-10", last4: "1234", gross: 16_830, adjust: 0, txType: "지출" }, open, used), undefined);
  assert.equal(matchSmsRow({ date: "2026-11-10", last4: "1234", gross: 9_000, adjust: 0, txType: "지출" }, open, new Set()), "d");
  assert.equal(matchSmsRow({ date: "2026-11-10", last4: "1234", gross: 9_000, adjust: 0, txType: "수입" }, open, new Set()), undefined);
});
