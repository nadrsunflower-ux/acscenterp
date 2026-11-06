// AI 사용료 순수 함수 검증 — npm run shorts:test
import test from "node:test";
import assert from "node:assert/strict";
import {
  OWNER_ERP,
  OWNER_SERVICE,
  buildUsageView,
  cleanOwner,
  keySnapFromApi,
  monthlyByKey,
  shiftMonth,
  snapshotId,
  utcMonth,
  type UsageKeySnap,
  type UsageSnapshot,
} from "./ai-usage";

const T = (iso: string) => Date.parse(iso);
const key = (hash: string, o: Partial<UsageKeySnap> = {}): UsageKeySnap => ({
  hash,
  name: hash.toUpperCase(),
  usage: 0,
  usageMonthly: 0,
  usageWeekly: 0,
  usageDaily: 0,
  limit: null,
  limitReset: null,
  limitRemaining: null,
  disabled: false,
  expiresAt: null,
  lastUsedAt: null,
  createdAt: "2026-01-01T00:00:00Z",
  ...o,
});
const snap = (iso: string, keys: UsageKeySnap[], credits = 1000, used?: number): UsageSnapshot => ({
  at: T(iso),
  totalCredits: credits,
  totalUsage: used ?? keys.reduce((n, k) => n + k.usage, 0),
  keys,
});

test("달 · 날짜 계산", () => {
  assert.equal(shiftMonth("2026-12", 1), "2027-01");
  assert.equal(shiftMonth("2026-01", -1), "2025-12");
  assert.equal(utcMonth(T("2026-11-30T23:59:00Z")), "2026-11");
  // 한국 날짜 — 12/1 08:00 KST 는 아직 UTC 11월이지만 문서 id 는 12-01
  assert.equal(snapshotId(T("2026-11-30T23:00:00Z")), "2026-12-01");
});

test("오픈라우터 키 한 줄을 기록 모양으로", () => {
  const k = keySnapFromApi({ hash: "abc", name: "LDJ", usage: 200.5, usage_monthly: 73.19, usage_weekly: 73.19, usage_daily: 0.83, limit: 250, limit_reset: null, limit_remaining: 49.5, disabled: false, created_at: "2026-10-17T00:00:00Z" });
  assert.equal(k?.name, "LDJ");
  assert.equal(k?.limitReset, null);
  assert.equal(k?.limitRemaining, 49.5);
  assert.equal(keySnapFromApi({ name: "해시 없음" }), null);
  assert.equal(keySnapFromApi({ hash: "x", limit_reset: "monthly" })?.limitReset, "monthly");
});

test("달 경계 — 앞뒤 기록의 누적 차이로 지난달 끝자락을 메운다", () => {
  const a = snap("2026-11-30T21:30:00Z", [key("k", { usage: 100, usageMonthly: 40 })]);
  const b = snap("2026-12-01T21:30:00Z", [key("k", { usage: 130, usageMonthly: 20 })]);
  const m = monthlyByKey([b, a]);
  assert.equal(m.get("k")?.get("2026-11"), 50); // 40 + (130 − 100 − 20)
  assert.equal(m.get("k")?.get("2026-12"), 20);
});

test("달 경계 — a 뒤에 만든 키는 0 에서 시작, 모르는 키는 건너뜀", () => {
  const a = snap("2026-11-30T12:00:00Z", [key("old", { usage: 10, usageMonthly: 10 })]);
  const b = snap("2026-12-01T12:00:00Z", [
    key("old", { usage: 10, usageMonthly: 0 }),
    key("new", { usage: 15, usageMonthly: 5, createdAt: "2026-11-30T20:00:00Z" }),
    key("unknown", { usage: 99, usageMonthly: 1, createdAt: "2026-06-01T00:00:00Z" }),
  ]);
  const m = monthlyByKey([a, b]);
  assert.equal(m.get("new")?.get("2026-11"), 10);
  assert.equal(m.get("new")?.get("2026-12"), 5);
  assert.equal(m.get("unknown")?.get("2026-11"), undefined);
  assert.equal(m.get("old")?.get("2026-11"), 10);
});

test("기록이 두 달 넘게 비면 그 사이를 나누지 않는다", () => {
  const a = snap("2026-10-15T00:00:00Z", [key("k", { usage: 10, usageMonthly: 10 })]);
  const b = snap("2026-12-02T00:00:00Z", [key("k", { usage: 100, usageMonthly: 5 })]);
  const m = monthlyByKey([a, b]);
  assert.equal(m.get("k")?.get("2026-10"), 10);
  assert.equal(m.get("k")?.get("2026-11"), undefined);
  assert.equal(m.get("k")?.get("2026-12"), 5);
});

test("화면 — 사람별 묶음 · 사라진 키 · 키에 안 잡힌 돈 · 알림", () => {
  const me = "me@x.com";
  const you = "you@x.com";
  const prev = snap("2026-10-31T21:30:00Z", [
    key("a", { usage: 100, usageMonthly: 60 }),
    key("gone", { usage: 30, usageMonthly: 30 }),
  ]);
  const mid = snap("2026-11-03T21:30:00Z", [
    key("a", { usage: 120, usageMonthly: 15 }),
    key("gone", { usage: 34, usageMonthly: 4 }),
  ]);
  const live = snap(
    "2026-11-06T03:00:00Z",
    [
      key("a", { usage: 150, usageMonthly: 45, usageWeekly: 40, usageDaily: 2, limit: 250, limitRemaining: 100 }),
      key("b", { usage: 260, usageMonthly: 10, limit: 250, limitRemaining: -10 }),
      key("c", { usage: 50, usageMonthly: 50, usageWeekly: 50 }),
      key("erp", { usage: 5, usageMonthly: 5 }),
      key("orphan", { usage: 3, usageMonthly: 1 }),
    ],
    600,
    // 아는 키 합 468 + 사라진 키 34 = 502 → 안 잡힌 돈 50
    552,
  );
  const v = buildUsageView({
    live,
    snaps: [prev, mid, live],
    assign: { a: { owner: me }, b: { owner: you }, c: { owner: you }, gone: { owner: me }, erp: { owner: OWNER_ERP } },
  });
  assert.equal(v.month, "2026-11");
  assert.equal(v.credits.balance, 48);
  assert.equal(v.untracked, 50);

  const gone = v.keys.find((k) => k.hash === "gone");
  assert.ok(gone?.gone);
  assert.equal(gone?.month, 4);

  const mine = v.owners.find((o) => o.owner === me);
  // a: 이번 달 45 + 사라진 키 4
  assert.equal(mine?.month, 49);
  // 지난달 — a 는 10/31 기록 60 + 경계 메움 (120 − 100 − 15) = 65 · 사라진 키 30 + (34 − 30 − 4) = 30
  assert.equal(mine?.prevMonth, 95);
  assert.equal(mine?.keys, 1);
  // 사람이 먼저, 그다음 ERP 서버, 주인 없음은 맨 뒤
  assert.deepEqual(
    v.owners.map((o) => o.owner),
    [you, me, OWNER_ERP, ""],
  );

  // 3일 넘은 기록(11/3)이 있으니 기록으로 속도를 잰다
  assert.equal(v.pace.basis, "history");
  const texts = v.warnings.map((w) => w.text).join("\n");
  assert.match(texts, /B — 한도 \$250\.00 를 다 써서 막혔습니다/);
  assert.match(texts, /C — 사람 키인데 한도가 없습니다/);
  assert.match(texts, /주인을 정하지 않은 키가 1개/);
  assert.doesNotMatch(texts, /ERP — 사람 키인데/);
  assert.equal(v.warnings[0].tone, "danger");

  const nov = v.months.find((m) => m.month === "2026-11");
  assert.equal(nov?.byOwner[me], 49);
  assert.equal(v.months[0].month, "2026-11");
});

test("첫 기록 — 지난달은 모름(null) · 속도는 이번 주나 이번 달 값으로", () => {
  const live = snap("2026-11-06T03:00:00Z", [key("a", { usage: 700, usageMonthly: 635, usageWeekly: 630, usageDaily: 2 })], 4650, 4598.28);
  const v = buildUsageView({ live, snaps: [live], assign: { a: { owner: OWNER_SERVICE } } });
  assert.equal(v.owners[0].prevMonth, null);
  assert.equal(v.keys[0].prevMonth, null);
  // 11/6 03:00 UTC — 이번 달은 5.1일, 이번 주(11/2 월요일부터)는 4.1일 → 더 긴 달로 잰다
  assert.equal(v.pace.basis, "month");
  assert.ok(Math.abs(v.pace.perDay - 635 / 5.125) < 0.01);
  assert.ok(v.daysLeft !== null && v.daysLeft < 1);
  assert.match(v.warnings[0].text, /하루 안에 바닥납니다/);
});

test("주인 값 확인", () => {
  assert.equal(cleanOwner("ME@x.com", ["me@x.com"]), "me@x.com");
  assert.equal(cleanOwner("erp", []), OWNER_ERP);
  assert.equal(cleanOwner("", []), "");
  assert.equal(cleanOwner("stranger@x.com", ["me@x.com"]), null);
  assert.equal(cleanOwner(3, []), null);
});
