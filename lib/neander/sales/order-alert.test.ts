// 생일 이벤트 발주 알림 (`npm run sales:test-order-alert`) — 이름은 실제 이벤트 모양을 본떴다
import { test } from "node:test";
import assert from "node:assert/strict";
import { alertKey, inWindow, nameScore, orderAlertText, orderedFromNote, orderStage, pairEvents, type CalendarBirthday } from "./order-alert";
import type { SalesEvent } from "./types";

const S = (id: string, name: string, from: string, to: string, extra: Partial<SalesEvent> = {}) =>
  ({ id, store: id.startsWith("ID") ? "id" : "wow", name, from, to, hoursPerDay: 0, staff: 0, supplies: 0, ...extra }) as SalesEvent;
const C = (id: string, store: CalendarBirthday["store"], title: string, startDate: string, endDate: string): CalendarBirthday => ({ id, store, title, startDate, endDate });

test("메모의 발주한 날", () => {
  assert.equal(orderedFromNote("10/13 발주 (레드 24026716416, 애즈 함께배송)", "2026-10-21"), "2026-10-13");
  assert.equal(orderedFromNote("10/21~22 발주 (레드 …)", "2026-10-29"), "2026-10-21");
  assert.equal(orderedFromNote("9/22 발주분 + 10/3 배너 (발주처 실결제 기준)", "2026-10-23"), "2026-09-22");
  // 해 넘김 — 12월 발주, 1월 행사
  assert.equal(orderedFromNote("12/20 발주", "2027-01-05"), "2026-12-20");
  // 예정은 발주가 아니다
  assert.equal(orderedFromNote("11/20 발주 예정", "2026-12-03"), null);
  assert.equal(orderedFromNote("배너만 따로", "2026-12-03"), null);
});

test("이름 맞추기 — 표기가 조금 달라도", () => {
  assert.ok(nameScore("B.I (비아이)", "비아이") >= 3);
  assert.ok(nameScore("NCTWISH 사쿠야", "NCT WISH 사쿠야") >= 6);
  assert.ok(nameScore("소디엑 웨인 (포도알)", "소디엑 웨인") >= 5);
  assert.equal(nameScore("에스파 지젤", "변우석"), 0);
});

test("짝 — 같은 그룹 두 이벤트는 기간으로 가른다 · ERP 에만 있는 것도 남는다", () => {
  const cal = [
    C("a", "id", "보이넥스트도어 운학", "2026-11-28", "2026-11-29"),
    C("b", "id", "보이넥스트도어 명재현", "2026-12-03", "2026-12-05"),
    C("c", "id", "라이즈 소희", "2026-11-20", "2026-11-21"),
  ];
  const sales = [
    S("ID-041", "보이넥스트도어 운학", "2026-11-28", "2026-11-29", { note: "11/13 발주 (레드 …)" }),
    S("WE-090", "라이즈 소희", "2026-11-20", "2026-11-21", { orderedAt: "2026-11-03" }),
    S("ID-039", "아일", "2026-11-11", "2026-11-13"),
  ];
  const out = pairEvents(cal, sales);
  const by = Object.fromEntries(out.map((e) => [e.key, e]));
  assert.equal(by["cal:a"].erpId, "ID-041");
  assert.deepEqual(by["cal:a"].ordered, { date: "2026-11-13", from: "note" });
  assert.equal(by["cal:b"].erpId, undefined);
  assert.equal(by["cal:c"].storeMismatch, true);
  assert.deepEqual(by["cal:c"].ordered, { date: "2026-11-03", from: "field" });
  assert.equal(by["erp:ID-039"].name, "아일");
});

test("단계와 알림 열쇠 — D-15 · D-10 한 번씩, D-8 부터 매일, 행사 날부터는 끝", () => {
  const e = { key: "cal:b", name: "보이넥스트도어 명재현", store: "id" as const, from: "2026-12-03", to: "2026-12-05" };
  assert.equal(orderStage(e, "2026-11-15"), "early"); // D-18
  assert.equal(alertKey(e, "2026-11-15"), null);
  assert.equal(alertKey(e, "2026-11-18"), "cal:b¦due"); // D-15
  assert.equal(alertKey(e, "2026-11-20"), "cal:b¦due"); // D-13 — 이미 보냈으면 서버가 거른다
  assert.equal(alertKey(e, "2026-11-23"), "cal:b¦late"); // D-10
  assert.equal(alertKey(e, "2026-11-25"), "cal:b¦day-2026-11-25"); // D-8
  assert.equal(alertKey(e, "2026-12-02"), "cal:b¦day-2026-12-02"); // D-1
  assert.equal(alertKey(e, "2026-12-03"), null); // 행사 날
  assert.equal(alertKey({ ...e, ordered: { date: "2026-11-20", from: "field" } }, "2026-11-25"), null);
  assert.match(orderAlertText(e, "2026-11-25"), /^🎂 발주 늦음 — 보이넥스트도어 명재현 \(아이디 12\/3~12\/5\) D-8\. ERP 이벤트 입력에 아직 없습니다/);
});

test("표 범위 — 끝난 것 · 45일 넘는 것 · 온라인은 빠진다", () => {
  const base = { key: "k", name: "x", store: "id" as const };
  assert.equal(inWindow({ ...base, from: "2026-11-14", to: "2026-11-15" }, "2026-11-15"), true);
  assert.equal(inWindow({ ...base, from: "2026-11-10", to: "2026-11-14" }, "2026-11-15"), false);
  assert.equal(inWindow({ ...base, from: "2026-12-31", to: "2026-12-31" }, "2026-11-15"), false);
  assert.equal(inWindow({ ...base, store: "online", from: "2026-11-20", to: "2026-11-20" } as never, "2026-11-15"), false);
});
