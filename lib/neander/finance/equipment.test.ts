import assert from "node:assert/strict";
import { test } from "node:test";
import {
  conflictsBetween,
  equipmentByDay,
  equipmentConflicts,
  equipmentRange,
  equipmentText,
  sanitizeEquipment,
  type EquipmentProject,
} from "./equipment";
import { emptyProject, sanitizeProject } from "./project";

const p = (id: string, extra: Partial<EquipmentProject>): EquipmentProject => ({ id, name: id, status: "planning", ...extra });

test("sanitize keeps positive whole counts of known kinds only", () => {
  assert.deepEqual(sanitizeEquipment({ photobooth: 2.4, kiosk: 0, drone: 3 }), { photobooth: 2 });
  assert.deepEqual(sanitizeEquipment({ photobooth: 99, kiosk: "1" }), { photobooth: 20, kiosk: 1 });
  assert.equal(sanitizeEquipment({ photobooth: -1 }), undefined);
  assert.equal(sanitizeEquipment(null), undefined);
  assert.equal(equipmentText({ photobooth: 2, kiosk: 1 }), "포토부스 2 · 키오스크 1");
});

test("range runs from install day (delivery) to the last event day", () => {
  assert.deepEqual(equipmentRange({ startDate: "2026-12-01", endDate: "2026-12-02", deliveryDate: "2026-11-30" }), { from: "2026-11-30", to: "2026-12-02" });
  assert.deepEqual(equipmentRange({ deliveryDate: "2026-12-15" }), { from: "2026-12-15", to: "2026-12-15" });
  assert.equal(equipmentRange({}), null);
  // 시작일이 문의 받은 날이어도 납기(설치 첫날)부터
  assert.deepEqual(equipmentRange({ startDate: "2026-11-09", endDate: "2026-12-02", deliveryDate: "2026-11-30" }), { from: "2026-11-30", to: "2026-12-02" });
  // 납기가 없으면 시작일 ~ 종료일, 시작일만 있으면 그날
  assert.deepEqual(equipmentRange({ startDate: "2026-12-09", endDate: "2026-12-12" }), { from: "2026-12-09", to: "2026-12-12" });
  assert.deepEqual(equipmentRange({ startDate: "2026-11-12" }), { from: "2026-11-12", to: "2026-11-12" });
  // 종료일 없이 시작일 · 납기만 — 납기 하루
  assert.deepEqual(equipmentRange({ startDate: "2026-11-09", deliveryDate: "2026-11-30" }), { from: "2026-11-30", to: "2026-11-30" });
});

test("conflicts: days over the owned count, grouped while the same projects overlap", () => {
  const byDay = equipmentByDay([
    p("suwon", { startDate: "2026-12-09", endDate: "2026-12-12", deliveryDate: "2026-12-09", equipment: { photobooth: 1, kiosk: 1 } }),
    p("eduax", { startDate: "2026-12-12", endDate: "2026-12-12", deliveryDate: "2026-12-11", equipment: { photobooth: 3 } }),
    p("nh", { startDate: "2026-12-15", endDate: "2026-12-15", equipment: { photobooth: 2, kiosk: 2 } }),
    p("gone", { status: "cancelled", startDate: "2026-12-15", endDate: "2026-12-15", equipment: { photobooth: 3 } }),
    p("plain", { startDate: "2026-12-11", endDate: "2026-12-11" }),
  ]);
  assert.deepEqual(byDay.get("2026-12-11")?.used, { photobooth: 4, sajuBooth: 0, kiosk: 1 });
  assert.deepEqual(byDay.get("2026-12-15")?.used, { photobooth: 2, sajuBooth: 0, kiosk: 2 }, "취소는 세지 않는다");
  const list = equipmentConflicts(byDay);
  assert.equal(list.length, 1);
  assert.deepEqual(
    { kind: list[0].kind, from: list[0].from, to: list[0].to, need: list[0].need, owned: list[0].owned, users: list[0].users.map((u) => `${u.id}:${u.count}`) },
    { kind: "photobooth", from: "2026-12-11", to: "2026-12-12", need: 4, owned: 3, users: ["suwon:1", "eduax:3"] },
  );
  assert.equal(conflictsBetween(list, "2026-12-13", "2026-12-31").length, 0);
  assert.equal(conflictsBetween(list, "2026-12-01", "2026-12-11").length, 1);
});

test("saju booth is its own kind — not one of the 3 photobooths", () => {
  assert.deepEqual(sanitizeEquipment({ photobooth: 3, sajuBooth: 1 }), { photobooth: 3, sajuBooth: 1 });
  assert.equal(equipmentText({ kiosk: 1, sajuBooth: 1, photobooth: 2 }), "포토부스 2 · 사주 포토부스 1 · 키오스크 1");
  const byDay = equipmentByDay([
    p("a", { startDate: "2026-12-15", endDate: "2026-12-15", equipment: { photobooth: 3, sajuBooth: 1 } }),
  ]);
  assert.deepEqual(byDay.get("2026-12-15")?.used, { photobooth: 3, sajuBooth: 1, kiosk: 0 });
  assert.equal(equipmentConflicts(byDay).length, 0, "포토부스 3 + 사주 1 은 모자라지 않다");
  const two = equipmentByDay([
    p("a", { startDate: "2026-12-15", endDate: "2026-12-15", equipment: { sajuBooth: 1 } }),
    p("b", { startDate: "2026-12-15", endDate: "2026-12-15", equipment: { sajuBooth: 1 } }),
  ]);
  assert.deepEqual(equipmentConflicts(two).map((c) => [c.kind, c.need, c.owned]), [["sajuBooth", 2, 1]]);
});

test("a change of who overlaps splits the warning", () => {
  const byDay = equipmentByDay([
    p("a", { startDate: "2026-12-01", endDate: "2026-12-03", equipment: { kiosk: 2 } }),
    p("b", { startDate: "2026-12-01", endDate: "2026-12-01", equipment: { kiosk: 2 } }),
    p("c", { startDate: "2026-12-03", endDate: "2026-12-03", equipment: { kiosk: 2 } }),
  ]);
  const list = equipmentConflicts(byDay);
  assert.deepEqual(list.map((c) => [c.from, c.to, c.users.map((u) => u.id).join("+")]), [
    ["2026-12-01", "2026-12-01", "a+b"],
    ["2026-12-03", "2026-12-03", "a+c"],
  ]);
});

test("sanitizeProject keeps equipment", () => {
  const base = { ...emptyProject(), code: "T-1", name: "t" };
  const r = sanitizeProject({ ...base, equipment: { photobooth: 2, kiosk: 0 } });
  assert.ok(r.ok);
  assert.deepEqual(r.value.equipment, { photobooth: 2 });
  const none = sanitizeProject({ ...base, equipment: { photobooth: 0 } });
  assert.ok(none.ok);
  assert.equal("equipment" in none.value, false);
});
