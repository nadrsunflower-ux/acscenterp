// AI 레이더 계산 검증 — npm run shorts:test
import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_RADAR_SETTINGS,
  classifyNaverTrend,
  groupRadar,
  krwOf,
  normalizeProductKey,
  radarScore,
  radarVelocity,
  sanitizeRadarSettings,
  type RadarAi,
} from "./radar";

const DAY = 86_400_000;
const now = Date.parse("2026-11-02T00:00:00Z");

test("레이더 점수: 배수 · 속도 · 정보 요청이 각자 상한까지만, 모르면 0점", () => {
  assert.equal(radarScore({ multiple: null, velocityPerDay: null, info: null }), 0);
  assert.equal(radarScore({ multiple: 1, velocityPerDay: 1000, info: { sampled: 50, matched: 0 } }), 0);
  assert.equal(radarScore({ multiple: 20, velocityPerDay: 1_000_000, info: { sampled: 50, matched: 10 } }), 100);
  assert.equal(radarScore({ multiple: 400, velocityPerDay: 1e9, info: { sampled: 10, matched: 10 } }), 100, "상한을 넘지 않음");
  const mid = radarScore({ multiple: Math.sqrt(20), velocityPerDay: 31_623, info: { sampled: 100, matched: 10 } });
  assert.ok(Math.abs(mid - 50) < 0.5, `중간값 ≈ 20 + 20 + 10 = ${mid}`);
});

test("조회 속도: 두 번 본 영상은 실제 증가, 처음 본 영상은 올린 뒤 평균", () => {
  const h = [
    { at: now - 2 * DAY, views: 10_000 },
    { at: now, views: 30_000 },
  ];
  assert.deepEqual(radarVelocity(h, 30_000, "2026-10-01T00:00:00Z", now), { perDay: 10_000, basis: "history" });
  assert.deepEqual(radarVelocity([{ at: now, views: 50_000 }], 50_000, new Date(now - 5 * DAY).toISOString(), now), { perDay: 10_000, basis: "since_publish" });
  assert.deepEqual(radarVelocity([], null, null, now), { perDay: null, basis: null });
});

test("네이버 추세: 최근 2주 ÷ 그 전 6주 — 상승 · 유지 · 하락 · 검색 적음", () => {
  assert.equal(classifyNaverTrend([10, 10, 10, 10, 10, 10, 30, 40]).label, "rising");
  assert.equal(classifyNaverTrend([50, 50, 50, 50, 50, 50, 50, 55]).label, "steady");
  assert.equal(classifyNaverTrend([80, 90, 100, 90, 80, 90, 40, 30]).label, "falling");
  assert.equal(classifyNaverTrend([]).label, "low");
  assert.equal(classifyNaverTrend([0, 0, 0, 0]).label, "low", "전부 0 → 데이터랩 기준 검색 적음");
  const fresh = classifyNaverTrend([0, 0, 0, 0, 0, 0, 0, 20]);
  assert.equal(fresh.label, "rising");
  assert.equal(fresh.change, null, "그 전이 0 이면 배율은 모름");
});

test("상품 묶음: 같은 상품 열쇠끼리 묶고, 상품을 모르면 영상 하나가 한 묶음", () => {
  const ai = (productKey: string) => ({ productKey }) as RadarAi;
  assert.equal(normalizeProductKey(" 자석 양치컵! "), "자석양치컵");
  const g = groupRadar([
    { id: "a", score: 30, ai: ai("자석 양치컵") },
    { id: "b", score: 70, ai: ai("자석양치컵") },
    { id: "c", score: 50, ai: null },
  ]);
  assert.equal(g.length, 2);
  assert.equal(g[0].items.length, 2);
  assert.equal(g[0].items[0].id, "b", "묶음 안은 점수 순");
  assert.equal(g[1].key, "video:c");
});

test("설정 정리: 범위를 넘는 값 · 빈 검색어를 막고, 원화 환산", () => {
  const s = sanitizeRadarSettings({ keywords: ["  주방템 ", "", "주방템", "x".repeat(80)], days: 99, maxSearchesPerRun: 0, aiBudgetKrw: -5 }, DEFAULT_RADAR_SETTINGS, "a@test", now);
  assert.deepEqual(s.keywords, ["주방템", "x".repeat(40)]);
  assert.equal(s.days, 30);
  assert.equal(s.maxSearchesPerRun, 1);
  assert.equal(s.aiBudgetKrw, 0);
  assert.equal(sanitizeRadarSettings({ keywords: [] }, DEFAULT_RADAR_SETTINGS, "a", now).keywords.length, DEFAULT_RADAR_SETTINGS.keywords.length, "빈 목록이면 이전 값");
  assert.equal(krwOf(0.5), 725);
});

test("화면 필터: 분류 · 상품 상태 · 네이버 · 배수 · 기간 · 검색어 · 낱말, 정렬은 대표 영상 값", async () => {
  const { DEFAULT_RADAR_FILTER, filterRadarGroups, isDefaultRadarFilter } = await import("./radar");
  const base = {
    platform: "youtube" as const, url: "", channel: "채널", channelId: "", thumbnail: "", duration: 30, likes: null, comments: null, viewsAt: now,
    viewHistory: [], baseline: null, velocityBasis: null, info: null, dismissed: null, saved: [], firstSeenAt: now, lastSeenAt: now,
  };
  const ai = (product: string, category: RadarAi["category"]) => ({ relevant: true, product, productKey: product, category, confidence: "likely", evidence: "", why: "", hook: "", naverKeywords: [product], coupangQuery: "", caution: "", model: "m", costUsd: 0, at: now }) as RadarAi;
  const docs = [
    { ...base, id: "a", videoId: "a", title: "토스트백 이거", views: 100, multiple: 12, velocityPerDay: 500, score: 40, publishedAt: new Date(now - 2 * DAY).toISOString(), keywords: ["주방꿀템"], ai: ai("토스트백", "주방"), naver: { keywords: [], label: "rising" as const, recent: 1, before: 1, change: 2, weeks: 8, at: now } },
    { ...base, id: "b", videoId: "b", title: "다이소 꿀템 12가지", views: 100, multiple: 3, velocityPerDay: 9000, score: 60, publishedAt: new Date(now - 9 * DAY).toISOString(), keywords: ["다이소꿀템"], ai: ai("", "다이소"), naver: null },
    { ...base, id: "c", videoId: "c", title: "수납함", views: 100, multiple: null, velocityPerDay: null, score: 10, publishedAt: null, keywords: ["수납꿀템"], ai: null, naver: null },
  ];
  const f = DEFAULT_RADAR_FILTER;
  assert.ok(isDefaultRadarFilter(f));
  assert.deepEqual(filterRadarGroups(docs, f, now).map((g) => g.items[0].id), ["b", "a", "c"], "기본은 점수 순");
  assert.deepEqual(filterRadarGroups(docs, { ...f, category: "주방" }, now).map((g) => g.items[0].id), ["a"]);
  assert.deepEqual(filterRadarGroups(docs, { ...f, product: "unknown" }, now).map((g) => g.items[0].id), ["b"], "글로는 모름 = AI 가 봤지만 상품 없음");
  assert.deepEqual(filterRadarGroups(docs, { ...f, product: "pending" }, now).map((g) => g.items[0].id), ["c"]);
  assert.deepEqual(filterRadarGroups(docs, { ...f, naver: "rising" }, now).map((g) => g.items[0].id), ["a"]);
  assert.deepEqual(filterRadarGroups(docs, { ...f, naver: "none" }, now).map((g) => g.items[0].id), ["b", "c"]);
  assert.deepEqual(filterRadarGroups(docs, { ...f, minMultiple: 10 }, now).map((g) => g.items[0].id), ["a"], "배수를 모르면 빠짐");
  assert.deepEqual(filterRadarGroups(docs, { ...f, maxAgeDays: 7 }, now).map((g) => g.items[0].id), ["a"], "게시일을 모르면 빠짐");
  assert.deepEqual(filterRadarGroups(docs, { ...f, keyword: "수납꿀템" }, now).map((g) => g.items[0].id), ["c"]);
  assert.deepEqual(filterRadarGroups(docs, { ...f, q: "토스트" }, now).map((g) => g.items[0].id), ["a"]);
  assert.deepEqual(filterRadarGroups(docs, { ...f, sort: "velocity" }, now).map((g) => g.items[0].id), ["b", "a", "c"], "모르는 값은 맨 뒤");
  assert.deepEqual(filterRadarGroups(docs, { ...f, sort: "recent" }, now).map((g) => g.items[0].id), ["a", "b", "c"]);
});
