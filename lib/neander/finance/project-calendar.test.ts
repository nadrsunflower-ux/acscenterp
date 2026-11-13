import assert from "node:assert/strict";
import { test } from "node:test";
import { calName, itemsBetween, layoutWeek, monthWeeks, projectCalItems, weekdayOf, type CalProject } from "./project-calendar";

const p = (id: string, extra: Partial<CalProject>): CalProject => ({ id, code: id, name: `2026 ${id}`, status: "planning", ...extra });

test("month weeks start on Sunday and cover the whole month", () => {
  const weeks = monthWeeks("2026-12");
  assert.equal(weeks[0][0], "2026-11-29", "12/1 은 화요일 — 그 주 일요일부터");
  assert.equal(weeks.at(-1)!.at(-1), "2027-01-02");
  assert.equal(weeks.length, 5);
  assert.ok(weeks.every((w) => w.length === 7 && weekdayOf(w[0]) === 0));
  assert.equal(monthWeeks("2026-02").length, 4, "2026-02 는 일요일에 시작해 네 주에 꼭 맞는다");
  assert.deepEqual(monthWeeks("x"), []);
});

test("items: period bar, delivery inside becomes a flag, outside its own cell", () => {
  const { items, undated } = projectCalItems([
    p("suwon", { startDate: "2026-12-09", endDate: "2026-12-12", deliveryDate: "2026-12-09" }),
    p("kit", { startDate: "2026-12-01", endDate: "2026-12-02", deliveryDate: "2026-11-30" }),
    p("open", { startDate: "2026-11-01" }),
    p("only-delivery", { deliveryDate: "2026-12-15" }),
    p("none", {}),
    p("swapped", { startDate: "2026-12-20", endDate: "2026-12-18", deliveryDate: "nope" }),
  ]);
  const of = (id: string) => items.filter((i) => i.project.id === id).map((i) => [i.kind, i.from, i.to, i.delivery ?? ""]);
  assert.deepEqual(of("suwon"), [["period", "2026-12-09", "2026-12-12", "2026-12-09"]]);
  assert.deepEqual(of("kit"), [["period", "2026-12-01", "2026-12-02", ""], ["delivery", "2026-11-30", "2026-11-30", ""]], "전날 설치 — 납기가 기간 앞");
  assert.deepEqual(of("open"), [["start", "2026-11-01", "2026-11-01", ""]]);
  assert.deepEqual(of("only-delivery"), [["delivery", "2026-12-15", "2026-12-15", ""]]);
  assert.deepEqual(of("swapped"), [["period", "2026-12-18", "2026-12-20", ""]], "뒤바뀐 날짜는 바로잡고 잘못된 납기는 버린다");
  assert.deepEqual(undated.map((u) => u.id), ["none"]);
  assert.deepEqual(itemsBetween(items, "2026-12-03", "2026-12-08").map((i) => i.project.id), []);
});

test("week layout: overlaps go to lower lanes, cut bars know they continue", () => {
  const { items } = projectCalItems([
    p("a", { startDate: "2026-12-07", endDate: "2026-12-11", deliveryDate: "2026-12-07" }),
    p("b", { startDate: "2026-12-09", endDate: "2026-12-14", deliveryDate: "2026-12-09" }),
    p("c", { deliveryDate: "2026-12-12" }),
    p("d", { startDate: "2026-12-05", endDate: "2026-12-06" }),
  ]);
  const week = monthWeeks("2026-12")[1]; // 12/6(일) ~ 12/12(토)
  assert.equal(week[0], "2026-12-06");
  const { segments, lanes } = layoutWeek(week, items);
  const seg = (id: string) => segments.find((s) => s.item.project.id === id)!;
  assert.deepEqual([seg("d").startCol, seg("d").endCol, seg("d").contLeft, seg("d").contRight], [0, 0, true, false]);
  assert.deepEqual([seg("a").startCol, seg("a").endCol, seg("a").deliveryCol], [1, 5, 1]);
  assert.deepEqual([seg("b").startCol, seg("b").endCol, seg("b").contRight, seg("b").deliveryCol], [3, 6, true, 3]);
  assert.notEqual(seg("a").lane, seg("b").lane, "겹치면 다른 줄");
  assert.equal(seg("d").lane, seg("a").lane, "안 겹치면 같은 줄을 다시 쓴다");
  assert.equal(seg("c").startCol, 6);
  assert.ok(lanes >= 2 && lanes <= 3);
  // 다음 주 — b 의 남은 이틀만, 깃발은 없다
  const next = layoutWeek(monthWeeks("2026-12")[2], items).segments;
  assert.deepEqual(next.map((s) => [s.item.project.id, s.startCol, s.endCol, s.contLeft, s.deliveryCol]), [["b", 0, 1, true, undefined]]);
});

test("calendar name drops the leading year only", () => {
  assert.equal(calName("2026 수원시미디어센터 체험 (12/9~12)"), "수원시미디어센터 체험 (12/9~12)");
  assert.equal(calName("뷰클린 2026"), "뷰클린 2026");
});
