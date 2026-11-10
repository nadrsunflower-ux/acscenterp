// 자금 일보 말풍선 — 목록의 합이 표의 숫자와 원 단위로 같은가 (`npx tsx --test lib/neander/finance/daily-cash-detail.test.ts`)
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDailyCash, ledgerAccountRow, ledgerCardRow, smsCardRow, type CardTx, type SmsTx } from "./daily-cash";
import { ledgerCardLines, ledgerFlowLines, smsCardLines, smsFlowLines, sumLines } from "./daily-cash-detail";
import { netAmount, type FinTransaction } from "./types";

let n = 0;
const sms = (date: string, time: string, last4: string, kind: "입금" | "출금", amount: number, balance?: number, memo?: string): SmsTx => ({
  id: String(++n),
  date,
  time,
  order: `${date} ${time} ${String(n).padStart(14, "0")}`,
  last4,
  kind,
  amount,
  balance,
  memo,
});
const A = [{ last4: "1111", label: "가통장" }, { last4: "2222", label: "나통장" }];

test("문자 통장 — 통장 · 입출금마다 합이 표의 입금 · 출금과 같다, 최근 것이 위", () => {
  const txs = [
    sms("2026-11-09", "18:00", "1111", "입금", 100, 1_000),
    sms("2026-11-10", "09:00", "1111", "입금", 500, 1_500, "김철수"),
    sms("2026-11-10", "13:00", "1111", "출금", 200, 1_300, "월세"),
    // 앞 문자가 빠져 잔액이 안 이어진다
    sms("2026-11-10", "15:00", "1111", "입금", 50, 2_000, "이영희"),
    sms("2026-11-10", "10:00", "2222", "입금", 70, 570),
    sms("2026-11-11", "09:00", "2222", "출금", 30, 540),
  ];
  const r = buildDailyCash(txs, A, "2026-11-10", "2026-11-10");
  const lines = r.days.flatMap((d) => d.lines);
  for (const row of r.rows) {
    assert.equal(sumLines(smsFlowLines(lines, "입금", { last4: row.last4 })), row.inSum, `${row.label} 입금`);
    assert.equal(sumLines(smsFlowLines(lines, "출금", { last4: row.last4 })), row.outSum, `${row.label} 출금`);
  }
  // 모든 문자 통장 합
  assert.equal(sumLines(smsFlowLines(lines, "입금")), r.totals.inSum);
  assert.equal(sumLines(smsFlowLines(lines, "출금")), r.totals.outSum);

  const ins = smsFlowLines(lines, "입금", { last4: "1111" });
  assert.deepEqual(ins.map((l) => l.when), ["15:00", "09:00"]);
  assert.equal(ins[0].title, "이영희");
  assert.match(ins[0].warn ?? "", /빠진/);
  assert.equal(ins[1].warn, undefined);
  // 여러 통장이 섞이면 둘째 줄에 통장 이름
  assert.match(smsFlowLines(lines, "입금")[0].sub ?? "", /가통장 1111/);
  // 기간 보기는 날짜를 붙인다
  assert.equal(smsFlowLines(lines, "출금", { withDate: true })[0].when, "11/10 13:00");
});

const led = (o: Partial<FinTransaction>): FinTransaction =>
  ({ id: String(++n), date: "2026-10-30", txType: "수입", gross: 0, adjust: 0, status: "confirmed", dedupHash: "", createdAt: n, ...o }) as FinTransaction;

test("장부 통장 — ledgerAccountRow 의 입금 · 출금과 같은 거르기", () => {
  const ledger = [
    led({ last4: "4248", date: "2026-10-29", txType: "수입", gross: 1_000_000, vendor: "익선재", note: "잔액 5,000,000" }),
    led({ last4: "4248", date: "2026-10-30", txType: "지출", gross: 300_000, vendor: "월세", note: "잔액 4,700,000" }),
    led({ last4: "4248", date: "2026-10-30", txType: "자금거래", acctMid: "정산입금", gross: 2_000_000, vendor: "워크온", note: "잔액 6,700,000" }),
    led({ last4: "4248", date: "2026-10-30", txType: "자금거래", acctMid: "정산반환", gross: 500_000, vendor: "배준용", note: "잔액 6,200,000" }),
    led({ last4: "4248", date: "2026-10-30", txType: "카드대금결제", gross: 100_000, adjust: -10_000, vendor: "신한카드", note: "잔액 6,110,000" }),
    // 방향을 모르는 자금거래 · 다른 통장 · 기간 밖은 빠진다
    led({ last4: "4248", date: "2026-10-30", txType: "자금거래", gross: 9_999, vendor: "?" }),
    led({ last4: "4223", date: "2026-10-30", txType: "수입", gross: 7_777 }),
    led({ last4: "4248", date: "2026-11-01", txType: "수입", gross: 8_888 }),
  ];
  const acct = { last4: "4248", label: "신한입금" };
  for (const [from, to] of [["2026-10-30", "2026-10-30"], ["2026-10-01", "2026-10-31"]]) {
    const row = ledgerAccountRow(ledger, acct, from, to);
    assert.equal(sumLines(ledgerFlowLines(ledger, "4248", from, to, "in")), row.inSum, `${from} 입금`);
    assert.equal(sumLines(ledgerFlowLines(ledger, "4248", from, to, "out")), row.outSum, `${from} 출금`);
    assert.equal(ledgerFlowLines(ledger, "4248", from, to, "in").length, row.inCount);
    assert.equal(ledgerFlowLines(ledger, "4248", from, to, "out").length, row.outCount);
  }
  const outs = ledgerFlowLines(ledger, "4248", "2026-10-30", "2026-10-30", "out");
  const cardPay = ledger.find((t) => t.vendor === "신한카드")!;
  assert.equal(outs.find((l) => l.title === "신한카드")?.amount, netAmount(cardPay), "줄 금액은 장부의 순금액(netAmount)");
});

test("카드 — 문자 · 카드 기록 모두 사용액(승인 − 취소)과 같다", () => {
  const card = { last4: "1804", label: "(신법)이동주" };
  const ct = (date: string, time: string, approval: "승인" | "취소", amount: number, merchant?: string): CardTx => ({
    id: String(++n),
    date,
    time,
    order: `${date} ${time} ${String(n).padStart(14, "0")}`,
    last4: "1804",
    approval,
    amount,
    merchant,
  });
  const txs = [ct("2026-11-10", "12:10", "승인", 12_000, "김밥천국"), ct("2026-11-10", "12:30", "취소", 12_000, "김밥천국"), ct("2026-11-10", "18:00", "승인", 45_000, "쿠팡"), ct("2026-11-09", "09:00", "승인", 1_000)];
  const row = smsCardRow(txs, card, "2026-11-10", "2026-11-10");
  const lines = smsCardLines(txs, "1804", "2026-11-10", "2026-11-10");
  assert.equal(sumLines(lines), row.useSum);
  assert.equal(lines.filter((l) => l.tag === "취소").length, row.cancelCount);

  const ledger = [
    led({ last4: "1804", date: "2026-10-12", txType: "지출", gross: 30_000, vendor: "다이소" }),
    led({ last4: "1804", date: "2026-10-13", txType: "환급", gross: 5_000, vendor: "다이소" }),
    led({ last4: "1804", date: "2026-10-14", txType: "수입", gross: 1 }),
  ];
  const lrow = ledgerCardRow(ledger, card, "2026-10-01", "2026-10-31");
  assert.equal(sumLines(ledgerCardLines(ledger, "1804", "2026-10-01", "2026-10-31")), lrow.useSum);
});
