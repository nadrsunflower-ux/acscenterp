import assert from "node:assert/strict";
import { test } from "node:test";
import { applyOp, minuteOf, revertChange, TripOpError } from "./shanghai2026Ops";
import { SHANGHAI_2026_PLAN as BASE } from "./shanghai2026Plan";

let n = 0;
const id = () => "t" + ++n;
const day = (p: typeof BASE, d: string) => p.days.find((x) => x.id === d)!;

test("새벽 시각은 그날 밤 맨 뒤로 정렬된다", () => {
  assert.ok(minuteOf("01:30") > minuteOf("24:00") - 1);
  assert.ok(minuteOf("23:00") < minuteOf("00:10"));
});

test("추가 — 시간순 자리에 들어가고 위험한 값은 걸러진다", () => {
  const { plan, change } = applyOp(BASE, {
    op: "add", day: "day1",
    item: { t: "19:00", k: "hack", title: "  <b>야식</b>  ", pin: "zzz", pts: ["htl", "nope"], img: "https://evil/x.jpg",
      i: [["evil", "¥30"], ["clock", "x".repeat(99)]], go: [{ m: "rocket" }, { m: "taxi", d: "10분", from: "nope", to: "zd" }] },
  }, id);
  const items = day(plan, "day1").items;
  const it = items.find((x) => x.id === change.id)!;
  assert.equal(it.k, "sight");
  assert.equal(it.pin, null);
  assert.deepEqual(it.pts, ["htl"]);
  assert.equal(it.img, undefined);
  assert.equal(it.i![0][0], "info");
  assert.equal(it.i![1][1].length, 40);
  assert.deepEqual(it.go, [{ m: "taxi", d: "10분", to: "zd" }]);
  const times = items.map((x) => minuteOf(x.t));
  assert.deepEqual(times, [...times].sort((a, b) => a - b));
  assert.equal(day(BASE, "day1").items.length + 1, items.length, "원본은 그대로");
});

test("시간 · 제목이 없으면 거절", () => {
  assert.throws(() => applyOp(BASE, { op: "add", day: "day1", item: { t: "25:00", title: "x" } }, id), TripOpError);
  assert.throws(() => applyOp(BASE, { op: "add", day: "day1", item: { t: "10:00", title: " " } }, id), TripOpError);
});

test("수정 — 사진은 원래 것만 유지, 날짜 옮기기", () => {
  const src = day(BASE, "day1").items.find((x) => x.img) ?? day(BASE, "day2").items.find((x) => x.img)!;
  const { plan, change } = applyOp(BASE, { op: "update", id: src.id, day: "day3", item: { ...src, title: "바꿈" } }, id);
  assert.equal(change.beforeDay, BASE.days.find((d) => d.items.includes(src))!.id);
  const it = day(plan, "day3").items.find((x) => x.id === src.id)!;
  assert.equal(it.title, "바꿈");
  assert.equal(it.img, src.img);
  const back = revertChange(plan, change).plan;
  assert.deepEqual(back.days.map((d) => d.items.map((x) => x.id)), BASE.days.map((d) => d.items.map((x) => x.id)));
});

test("삭제 → 되돌리기, 추가 → 되돌리기", () => {
  const target = day(BASE, "day2").items[2];
  const del = applyOp(BASE, { op: "delete", id: target.id }, id);
  assert.ok(!day(del.plan, "day2").items.some((x) => x.id === target.id));
  const back = revertChange(del.plan, del.change);
  assert.deepEqual(day(back.plan, "day2").items.find((x) => x.id === target.id), target);
  const add = applyOp(BASE, { op: "add", day: "day0", item: { t: "12:00", title: "점심" } }, id);
  assert.equal(day(revertChange(add.plan, add.change).plan, "day0").items.length, day(BASE, "day0").items.length);
});

test("새 장소는 좌표 없는 검색어 장소로 들어간다", () => {
  const { plan, change } = applyOp(BASE, { op: "add", day: "day2", item: { t: "13:00", title: "카페" }, place: { name: "카페", zh: "某某咖啡", addr: "武康路1号" } }, id);
  const it = day(plan, "day2").items.find((x) => x.id === change.id)!;
  assert.equal(it.pin, null);
  assert.equal(it.pts.length, 1);
  assert.deepEqual(plan.places[it.pts[0]], ["카페", "某某咖啡", null, null, "武康路1号"]);
});

test("끌어서 순서 바꾸기 — 시간 칸은 그대로, 일정만 이동 · 되돌리기", () => {
  const d0 = day(BASE, "day3");
  const ids = d0.items.map((x) => x.id);
  const moved = [ids[3], ...ids.slice(0, 3), ...ids.slice(4)];
  const { plan, change } = applyOp(BASE, { op: "reorder", day: "day3", ids: moved }, id);
  const after = day(plan, "day3").items;
  assert.deepEqual(after.map((x) => x.id), moved);
  assert.deepEqual(after.map((x) => x.t), d0.items.map((x) => x.t));
  assert.equal(after[0].go?.[0]?.from, undefined, "앞이 바뀐 일정은 출발지를 비운다");
  assert.throws(() => applyOp(BASE, { op: "reorder", day: "day3", ids: moved.slice(1) }, id), TripOpError);
  const back = revertChange(plan, change).plan;
  assert.deepEqual(day(back, "day3").items, d0.items);
});

test("사진은 사이트 사진 이름만", () => {
  const ok = applyOp(BASE, { op: "add", day: "day1", item: { t: "10:30", title: "a", img: "g_dimsum" } }, id);
  assert.equal(day(ok.plan, "day1").items.find((x) => x.id === ok.change.id)!.img, "g_dimsum");
  const bad = applyOp(BASE, { op: "add", day: "day1", item: { t: "10:30", title: "a", img: "../x" } }, id);
  assert.equal(day(bad.plan, "day1").items.find((x) => x.id === bad.change.id)!.img, undefined);
});
