// AI STUDIO 일정 — 순수 함수 검증 · npm run shorts:test
import test from "node:test";
import assert from "node:assert/strict";
import { autoItems, eventItem, itemsByDate, sanitizeEvent, type ShortsEventView } from "./calendar";
import type { ClientFinanceSummary } from "./agency";

test("일정 다듬기 — 제목 · 날짜 필수 · 끝 날은 뒤에만 · 90일까지 · 시각 꼴 · 만든 사람은 그대로", () => {
  assert.throws(() => sanitizeEvent({ date: "2026-11-05" }, null, "a@x", "salim", null), /제목/);
  assert.throws(() => sanitizeEvent({ title: "촬영", date: "2026-13-01" }, null, "a@x", "salim", null), /날짜/);
  const e = sanitizeEvent({ title: " 3화 촬영 ", date: "2026-11-05", endDate: "2026-11-04", time: "25:00", kind: "shoot" }, null, "a@x", "salim", null, 1);
  assert.equal(e.title, "3화 촬영");
  assert.equal(e.endDate, null); // 앞 날은 버린다
  assert.equal(e.time, null);
  assert.equal(e.kind, "shoot");
  const long = sanitizeEvent({ title: "긴 일", date: "2026-01-01", endDate: "2026-06-01" }, null, "a@x", "salim", null);
  assert.equal(long.endDate, null);
  const b = sanitizeEvent({ title: "업체 미팅", time: "14:30", kind: "weird" }, e, "b@x", "spabcdefg1", "c1", 2);
  assert.equal(b.date, "2026-11-05");
  assert.equal(b.time, "14:30");
  assert.equal(b.kind, "shoot");
  assert.equal(b.createdBy, "a@x");
  assert.equal(b.updatedBy, "b@x");
  assert.equal(b.clientId, "c1");
});

test("저절로 모이는 일정 — 게시 예약 · 게시됨 · 검토 · 계약 · 받을 돈(연체) · 받은 돈 · 계약서", () => {
  const T = Date.parse("2026-11-10T03:00:00Z"); // 한국 12시
  const fin: ClientFinanceSummary = {
    code: "PJ-2611-01", projectId: "fp1", name: "브랜드 대행", status: "active", startDate: null, endDate: null, contractAmount: 3_000_000, vatMode: "excluded", received: 1_000_000, remaining: 2_000_000, next: null, overdue: 1,
    contracts: [{ id: "k1", title: "대행 계약", status: "signed", signedDate: "2026-11-01", startDate: null, endDate: null, amount: 3_000_000, vatMode: "excluded" }],
    installments: [
      { id: "i1", kind: "선금", amount: 1_000_000, dueDate: "2026-11-03", dueLabel: "2026-11-03", paidDate: "2026-11-02", received: true },
      { id: "i2", kind: "중도금", amount: 1_000_000, dueDate: "2026-11-08", dueLabel: "2026-11-08", paidDate: null, received: false },
      { id: "i3", kind: "잔금", amount: 1_000_000, dueDate: "2026-11-30", dueLabel: "2026년 11월 말", paidDate: null, received: false },
    ],
  };
  const items = autoItems({
    projects: [{ id: "v1", title: "브랜드 1편", kind: "brand", clientId: "c1", clientName: "업체", spaceId: "spx", review: { state: "approved", revisionsUsed: 0, rounds: [{ n: 1, renderId: "r", sentAt: T, sentBy: "a", decision: "approved", feedback: "", decidedBy: "고객", decidedVia: "link", decidedAt: T + 86_400_000, extra: false }] } }],
    publications: [
      { id: "p1", projectId: "v1", platform: "youtube", status: "scheduled", scheduledAt: T, result: null },
      { id: "p2", projectId: "v1", platform: "instagram", status: "published", scheduledAt: null, result: { externalId: "x", url: null, at: T, by: "api" } },
      { id: "p3", projectId: "남의영상", platform: "youtube", status: "scheduled", scheduledAt: T, result: null },
    ],
    clients: [{ id: "c1", name: "업체", contract: { monthlyFeeKrw: null, vat: "excluded", videosPerMonth: 4, revisionLimit: 2, startMonth: "2026-11", endMonth: "2027-02", financeCode: "", note: "" } }],
    clientFinance: { c1: [fin] },
    today: "2026-11-10",
  });
  const by = (s: string) => items.filter((x) => x.source === s);
  assert.equal(by("publish")[0].date, "2026-11-10");
  assert.equal(by("publish")[0].time, "12:00");
  assert.equal(by("publish").length, 1); // 볼 수 없는 영상의 게시는 빠진다
  assert.equal(by("published").length, 1);
  assert.equal(by("review")[0].date, "2026-11-10");
  assert.equal(by("approved")[0].date, "2026-11-11");
  assert.deepEqual(by("contract").map((x) => x.date), ["2026-11-01", "2027-02-28"]);
  assert.equal(by("finance-paid")[0].date, "2026-11-02");
  assert.equal(by("finance-overdue")[0].date, "2026-11-08"); // 오늘보다 앞 · 안 받음
  assert.match(by("finance-due")[0].detail, /잔금 받을 날 1,000,000원 \(2026년 11월 말\)/);
  assert.equal(by("finance-contract")[0].date, "2026-11-01");
});

test("날짜마다 — 여러 날 일정은 걸친 날마다 · 달 밖은 잘라 · 시각 순", () => {
  const ev = (id: string, date: string, endDate: string | null, time: string | null): ShortsEventView => ({ id, title: id, date, endDate, time, kind: "etc", spaceId: "salim", clientId: null, note: "", createdBy: "a", createdAt: 0, updatedAt: 0, updatedBy: "a" });
  const m = itemsByDate([eventItem(ev("촬영3일", "2026-10-30", "2026-11-02", null)), eventItem(ev("오후", "2026-11-01", null, "15:00")), eventItem(ev("오전", "2026-11-01", null, "09:00"))], "2026-11-01", "2026-11-30");
  assert.deepEqual([...m.keys()].sort(), ["2026-11-01", "2026-11-02"]);
  assert.deepEqual(m.get("2026-11-01")!.map((x) => x.title), ["촬영3일", "오전", "오후"]);
});
