// 자금 일보 — 기초 · 기말 잔액 · 입출금 합 · 빠진 문자 (`npm run finance:test-daily-cash`)
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDailyCash, ledgerAccountRow, ledgerCardRow, smsCardRow, smsToCardTx, smsToTx, type SmsTx } from "./daily-cash";
import type { FinTransaction } from "./types";

let n = 0;
const tx = (date: string, time: string, last4: string, kind: "입금" | "출금", amount: number, balance?: number): SmsTx => ({
  id: String(++n),
  date,
  time,
  order: `${date} ${time} ${String(n).padStart(14, "0")}`,
  last4,
  kind,
  amount,
  balance,
});
const A = [{ last4: "1111", label: "가통장" }, { last4: "2222", label: "나통장" }];

test("하루 — 기초는 전날 마지막 잔액, 기말은 그날 마지막 잔액", () => {
  const r = buildDailyCash(
    [
      tx("2026-11-09", "18:00", "1111", "입금", 100, 1_000),
      tx("2026-11-10", "09:00", "1111", "입금", 500, 1_500),
      tx("2026-11-10", "13:00", "1111", "출금", 200, 1_300),
    ],
    A,
    "2026-11-10",
    "2026-11-10",
  );
  const row = r.rows.find((x) => x.last4 === "1111")!;
  assert.deepEqual([row.opening, row.inSum, row.outSum, row.closing, row.gap], [1_000, 500, 200, 1_300, 0]);
  assert.equal(r.days.length, 1);
  assert.equal(r.days[0].lines.length, 2);
});

test("앞 문자가 없으면 첫 문자에서 거꾸로 센다 · 거래 없는 날은 기초 = 기말", () => {
  const r = buildDailyCash([tx("2026-11-10", "09:00", "2222", "출금", 1, 999)], A, "2026-11-10", "2026-11-10");
  assert.deepEqual([r.rows[0].opening, r.rows[0].closing], [1_000, 999]);
  const next = buildDailyCash([tx("2026-11-10", "09:00", "2222", "출금", 1, 999)], A, "2026-11-11", "2026-11-11");
  assert.deepEqual([next.rows[0].opening, next.rows[0].closing, next.rows[0].inSum], [999, 999, 0]);
  assert.equal(next.days.length, 0);
});

test("잔액이 안 이어지면 빠진 돈을 그 줄 앞에 표시한다", () => {
  const r = buildDailyCash(
    [
      tx("2026-11-10", "09:00", "1111", "입금", 100, 1_100),
      tx("2026-11-10", "10:00", "1111", "출금", 50, 1_550), // 기대 1,050 → 500 이 빠짐
    ],
    A,
    "2026-11-10",
    "2026-11-10",
  );
  const row = r.rows[0];
  assert.deepEqual([row.gap, row.gapCount], [500, 1]);
  assert.equal(r.days[0].lines[1].gapBefore, 500);
  // 기초 + 입금 − 출금 + 빠진 돈 = 기말
  assert.equal(row.opening! + row.inSum - row.outSum + row.gap, row.closing);
});

test("기간 — 날짜별로 묶고 합계를 낸다", () => {
  const r = buildDailyCash(
    [
      tx("2026-11-08", "09:00", "1111", "입금", 10, 110),
      tx("2026-11-09", "09:00", "1111", "입금", 20, 130),
      tx("2026-11-10", "09:00", "2222", "출금", 5, 95),
    ],
    A,
    "2026-11-09",
    "2026-11-10",
  );
  assert.deepEqual(r.days.map((d) => d.date), ["2026-11-09", "2026-11-10"]);
  assert.deepEqual([r.totals.inSum, r.totals.outSum], [20, 5]);
  assert.equal(r.rows.find((x) => x.last4 === "1111")!.opening, 110);
});

test("문자 → 거래 — 문자 속 날짜 · 연도, 1월에 받은 12월 문자", () => {
  const jan = Date.parse("2027-01-02T00:30:00+09:00");
  const t = smsToTx({ id: "x", receivedAt: jan, parsed: { ok: true, kind: "입금", amount: 1, last4: "1111", balance: 1, when: "12-31 23:59" } });
  assert.deepEqual([t?.date, t?.time], ["2026-12-31", "23:59"]);
  assert.equal(smsToTx({ id: "y", receivedAt: jan, parsed: { ok: false } }), null);
});

const L = (date: string, last4: string, txType: string, gross: number, note = "", acctMid = "") =>
  ({ id: `${date}${last4}${gross}${note}`, date, last4, txType, gross, adjust: 0, note, acctMid, createdAt: ++n }) as unknown as FinTransaction;

test("장부 기준 통장 — 메모의 잔액으로 기초 · 기말, 자금거래 입 · 출금 방향", () => {
  const ledger = [
    L("2026-10-30", "9999", "수입", 100, "입금 · 잔액 1,100"),
    L("2026-10-31", "9999", "자금거래", 300, "출금 · 잔액 800", "이체출금"),
    L("2026-11-02", "9999", "지출", 50, "출금 · 잔액 750"),
  ];
  const row = ledgerAccountRow(ledger, { last4: "9999", label: "다통장" }, "2026-10-31", "2026-11-10");
  assert.deepEqual(
    [row.source, row.opening, row.inSum, row.outSum, row.closing, row.coveredTo],
    ["ledger", 1_100, 0, 350, 750, "2026-11-02"],
  );
});

test("카드 — 문자는 승인 − 취소, 장부는 지출 − 환급", () => {
  const sms = [
    smsToCardTx({ id: "a", receivedAt: Date.parse("2026-11-10T13:00:00+09:00"), parsed: { ok: true, channel: "card", amount: 12_000, when: "11-10 13:00", card: { last4: "1234", approval: "승인", amount: 12_000 } } }),
    smsToCardTx({ id: "b", receivedAt: Date.parse("2026-11-10T14:00:00+09:00"), parsed: { ok: true, channel: "card", amount: 2_000, when: "11-10 14:00", card: { last4: "1234", approval: "취소", amount: 2_000 } } }),
  ].filter((x): x is NonNullable<typeof x> => x !== null);
  const r = smsCardRow(sms, { last4: "1234", label: "가카드" }, "2026-11-10", "2026-11-10");
  assert.deepEqual([r.useSum, r.approveCount, r.cancelCount], [10_000, 1, 1]);
  const lr = ledgerCardRow([L("2026-11-01", "5678", "지출", 9_000), L("2026-11-02", "5678", "환급", 1_000)], { last4: "5678", label: "나카드" }, "2026-11-01", "2026-11-30");
  assert.deepEqual([lr.useSum, lr.approveCount, lr.cancelCount, lr.coveredTo], [8_000, 1, 1, "2026-11-02"]);
});
