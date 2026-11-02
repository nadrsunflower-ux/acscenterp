// 바이럴 형식 자동화 규칙 — npm run shorts:test
import test from "node:test";
import assert from "node:assert/strict";
import { AUTO_COUNTRY_SEARCH, DEFAULT_SCOUT_AUTO, koreaStatusFromMatches, needsKoreaCheck, pickAutoQuery, sanitizeScoutAuto } from "./scout-auto";

const DAY = 86_400_000;
const now = Date.parse("2026-11-02T00:00:00Z");

test("나라별 검색어는 날마다 돌고, 같은 날은 같다", () => {
  const qs = AUTO_COUNTRY_SEARCH.JP.queries;
  const days = Array.from({ length: qs.length }, (_, i) => new Date(now + i * DAY).toISOString().slice(0, 10));
  assert.equal(new Set(days.map((d) => pickAutoQuery("JP", d))).size, qs.length, "한 바퀴 동안 검색어가 겹치지 않음");
  assert.equal(pickAutoQuery("US", "2026-11-02"), pickAutoQuery("US", "2026-11-02"));
  assert.equal(AUTO_COUNTRY_SEARCH.CN.region, "HK", "YouTube 에 중국 본토 지역이 없어 간체는 홍콩 지역으로");
});

test("한국 확인: 고른 수 → 상태, 0 은 「표본에 없음」", () => {
  assert.equal(koreaStatusFromMatches(0), "none_in_sample");
  assert.equal(koreaStatusFromMatches(2), "some");
  assert.equal(koreaStatusFromMatches(3), "spread");
});

test("한국 확인 대상: 확인 전 · 자동 확인 7일 지남 · 사람이 확인한 건 30일 동안 그대로", () => {
  assert.ok(needsKoreaCheck({ status: "unchecked", checkedAt: null, by: null }, now));
  assert.ok(!needsKoreaCheck({ status: "some", checkedAt: now - 3 * DAY, by: "company" }, now));
  assert.ok(needsKoreaCheck({ status: "some", checkedAt: now - 8 * DAY, by: "company" }, now));
  assert.ok(!needsKoreaCheck({ status: "spread", checkedAt: now - 20 * DAY, by: "a@x.com" }, now), "사람 표시는 덮지 않음");
  assert.ok(needsKoreaCheck({ status: "spread", checkedAt: now - 31 * DAY, by: "a@x.com" }, now));
});

test("설정 정리: 모르는 나라 · 범위 밖 값을 막는다", () => {
  const s = sanitizeScoutAuto({ countries: ["US", "XX", "US", "JP"], addsPerDay: 99, perCountryCap: -1, minMultiple: 0.5, koreaPerDay: 10 }, DEFAULT_SCOUT_AUTO, "a", now);
  assert.deepEqual(s.countries, ["US", "JP"]);
  assert.equal(s.addsPerDay, 15);
  assert.equal(s.perCountryCap, 0);
  assert.equal(s.minMultiple, 1.5);
  assert.equal(s.koreaPerDay, 6);
});
