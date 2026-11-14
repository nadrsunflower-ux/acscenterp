// 돈 나가는 날 — 휴일 밀림 · 회차 펼치기 · 장부 맞추기 · 알림 (`npm run finance:test-money-calendar`)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  alertText,
  buildMoneyRows,
  dueAlerts,
  expandRules,
  nextBusinessDayKr,
  sanitizeMoneySettings,
  type MoneyRule,
} from "./money-calendar";
import type { FinTransaction } from "./types";

const card: MoneyRule = {
  id: "card-a",
  kind: "카드대금",
  label: "A카드 대금",
  day: 15,
  shift: "next",
  account: "출금통장",
  match: { vendor: "A카드", acctMinor: ["카드대금결제"] },
};
const rent: MoneyRule = { id: "rent", kind: "급여·월세", label: "월세", day: 1, shift: "none" };
const vat: MoneyRule = { id: "vat", kind: "세금", label: "부가세", months: [1, 4, 7, 10], day: 25, shift: "next" };

const tx = (date: string, vendor: string, gross: number, extra: Partial<FinTransaction> = {}) =>
  ({ id: `${date}-${vendor}-${gross}`, date, vendor, gross, adjust: 0, txType: "카드대금결제", acctMinor: "카드대금결제", status: "confirmed", ...extra }) as unknown as FinTransaction;

test("휴일이면 다음 영업일 — 주말 · 명절 · 대체공휴일", () => {
  assert.equal(nextBusinessDayKr("2026-11-15"), "2026-11-16"); // 일요일
  assert.equal(nextBusinessDayKr("2026-10-10"), "2026-10-12"); // 토요일
  assert.equal(nextBusinessDayKr("2026-08-15"), "2026-08-18"); // 광복절(토) + 대체공휴일 8/17
  assert.equal(nextBusinessDayKr("2026-02-15"), "2026-02-19"); // 일요일 + 설 연휴
  assert.equal(nextBusinessDayKr("2026-10-03"), "2026-10-06"); // 개천절(토) + 대체 10/5
  assert.equal(nextBusinessDayKr("2027-02-07"), "2027-02-10"); // 설(일) + 대체 2/9
  assert.equal(nextBusinessDayKr("2026-11-10"), "2026-11-10"); // 평일 그대로
});

test("회차 펼치기 — 밀린 날 · 매달 · 분기 · 그날 그대로", () => {
  const occ = expandRules([card, rent, vat], "2026-11-01", "2027-01-31");
  const keys = occ.map((o) => `${o.rule.id} ${o.date}${o.shifted ? "*" : ""}`);
  assert.deepEqual(keys, [
    "rent 2026-11-01", // 일요일이지만 직접 보내는 돈이라 그대로
    "card-a 2026-11-16*",
    "rent 2026-12-01",
    "card-a 2026-12-15",
    "rent 2027-01-01",
    "card-a 2027-01-15",
    "vat 2027-01-25",
  ]);
});

test("말일 규칙 — 짧은 달은 그 달 마지막 날", () => {
  const eom: MoneyRule = { id: "eom", kind: "세금", label: "말일", day: 31, shift: "none" };
  assert.deepEqual(
    expandRules([eom], "2027-02-01", "2027-04-30").map((o) => o.date),
    ["2027-02-28", "2027-03-31", "2027-04-30"],
  );
});

test("장부 맞추기 — 범위 안 여러 건은 합치고, 지난번 금액을 붙인다", () => {
  const txs = [
    tx("2026-10-15", "A카드", 700_000),
    tx("2026-10-16", "A카드", 300_000), // 나눠 빠짐 → 합쳐 100만
    tx("2026-10-02", "A카드", 50_000), // 범위(앞 5일) 밖
    tx("2026-11-16", "B카드", 999_999), // 다른 카드
  ];
  const rows = buildMoneyRows([card], txs, "2026-11-01", "2026-11-30");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].state, "예정");
  assert.equal(rows[0].last?.amount, 1_000_000);
  assert.equal(rows[0].last?.count, 2);
  assert.match(rows[0].basis, /11\/15\(일\)이 쉬는 날이라 11\/16\(월\)로 밀림/);

  const paidRows = buildMoneyRows([card], [...txs, tx("2026-11-16", "A카드", 1_234_000)], "2026-11-01", "2026-11-30");
  assert.equal(paidRows[0].state, "냈음");
  assert.equal(paidRows[0].amount, 1_234_000);
});

test("거래처 이름이 여럿이면 | 로 — 둘 다 잡는다", () => {
  const elec: MoneyRule = { id: "elec", kind: "대출이자·공과금", label: "전기", day: 5, shift: "next", match: { vendor: "한국전력공사|한전" } };
  const rows = buildMoneyRows([elec], [tx("2026-10-06", "한국전력공사", 100), tx("2026-10-07", "한전 （주）네", 200)], "2026-10-01", "2026-10-31");
  assert.equal(rows[0].paid?.amount, 300);
});

test("알림 — 3일 전 · 당일만, 낸 회차는 뺀다", () => {
  const rows = buildMoneyRows([card, rent], [tx("2026-12-01", "월세집", 1, { acctMinor: "임차료" })], "2026-11-09", "2026-12-31");
  const on13 = dueAlerts(rows, "2026-11-13", [3, 0]);
  assert.deepEqual(on13.map((a) => [a.row.rule.id, a.lead, a.sentKey]), [["card-a", 3, "card-a¦2026-11-15¦3"]]);
  assert.equal(dueAlerts(rows, "2026-11-16", [3, 0])[0].lead, 0);
  assert.equal(dueAlerts(rows, "2026-11-14", [3, 0]).length, 0);
  assert.match(alertText(on13[0].row, 3), /^3일 뒤 11\/16\(월\) · (약 [\d.,]+만 원 · )?출금통장$/);
  assert.match(alertText(on13[0].row, 0), /^오늘 · /);
});

test("설정 다듬기 — 잘못된 규칙은 버리고 기본 알림은 3일 전 · 당일", () => {
  const s = sanitizeMoneySettings({
    recipients: ["a@b.c", "not-mail"],
    rules: [card, { ...card, id: "Bad Id" }, { ...card, id: "x", day: 40 }, { ...card, id: "k", kind: "없는종류" }],
  });
  assert.deepEqual(s.recipients, ["a@b.c"]);
  assert.deepEqual(s.leadDays, [3, 0]);
  assert.deepEqual(s.rules.map((r) => r.id), ["card-a"]);
});

test("한 번만 오는 날(고지서) — 그날 하루 · 휴일 밀림 · 금액이 같으면 계정이 달라도 냈음", () => {
  const notice: MoneyRule = {
    id: "tax-abc",
    kind: "세금",
    label: "부가가치세 고지 (네안데르)",
    day: 28,
    once: "2026-11-28", // 토요일 → 11/30(월)
    amount: 811_640,
    shift: "next",
    match: { amount: 811_640, site: "네안데르" },
    window: { before: 20, after: 7 },
  };
  const occ = expandRules([notice], "2026-11-01", "2027-12-31");
  assert.equal(occ.length, 1);
  assert.equal(occ[0].date, "2026-11-30");
  assert.equal(occ[0].key, "tax-abc¦2026-11-28");

  // 원천세로 잘못 분류된 출금도 금액 · 사업장이 같으면 찾는다
  const paid = tx("2026-11-14", "국세납부", 811_640, { txType: "지출", acctMid: "국세", acctMinor: "원천징수소득세(근로)", site: "네안데르" } as Partial<FinTransaction>);
  const other = tx("2026-11-14", "국세납부", 811_640, { txType: "지출", acctMid: "국세", site: "일해라컴퍼니" } as Partial<FinTransaction>);
  assert.equal(buildMoneyRows([notice], [other], "2026-11-01", "2026-12-31")[0].state, "예정");
  const row = buildMoneyRows([notice], [paid], "2026-11-01", "2026-12-31")[0];
  assert.equal(row.state, "냈음");
  assert.equal(row.amount, 811_640);

  // 알림 글 — 정해진 금액은 원 단위 그대로
  const open = buildMoneyRows([notice], [], "2026-11-01", "2026-12-31")[0];
  assert.equal(alertText(open, 3), "3일 뒤 11/30(월) · 811,640원");
  const noAmount = buildMoneyRows([{ ...notice, amount: undefined, match: undefined }], [], "2026-11-01", "2026-12-31")[0];
  assert.equal(alertText(noAmount, 0), "오늘 · 금액 모름");

  // 사람이 냈음으로 표시하면 장부에 없어도 냈음 — 알림이 안 간다
  const settled = buildMoneyRows([{ ...notice, settled: { date: "2026-11-20" } }], [], "2026-11-01", "2026-12-31");
  assert.equal(settled[0].state, "냈음");
  assert.equal(dueAlerts(settled, "2026-11-27", [3, 0]).length, 0);

  // 설정 문서에서도 한 번만 오는 날을 받는다
  const s = sanitizeMoneySettings({ rules: [{ id: "one", kind: "세금", label: "한 번", once: "2026-11-27", amount: 1000, shift: "next" }] });
  assert.equal(s.rules[0].once, "2026-11-27");
  assert.equal(s.rules[0].day, 27);
  assert.equal(s.rules[0].amount, 1000);
});
