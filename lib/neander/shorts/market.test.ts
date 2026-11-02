// 시장 트렌드 순수 함수 검증 — npm run shorts:test
import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_MARKET_SETTINGS,
  channelDelta,
  channelTrackedDays,
  groupTrend,
  pushChannelPoint,
  sanitizeKeywordGroups,
  sanitizeMarketSettings,
  sanitizeNote,
  trendDates,
  type ChannelStatPoint,
} from "./market";

test("검색어 묶음 다듬기 — 이름 · 검색어 필수 · 겹친 id · 20개 · 쉼표 글", () => {
  const g = sanitizeKeywordGroups([
    { id: "a", name: "  살림 ", keywords: ["살림템", "살림템", " ", "살림꿀템"] },
    { id: "a", name: "주방", keywords: "주방템, 주방용품" },
    { id: "", name: "빈 묶음", keywords: [] },
    { name: "", keywords: ["x"] },
    { id: "많음", name: "많음", keywords: Array.from({ length: 30 }, (_, i) => `k${i}`) },
  ]);
  assert.deepEqual(g.map((x) => [x.id, x.name, x.keywords.length]), [["a", "살림", 2], ["a_", "주방", 2], ["g3", "많음", 20]]);
  const s = sanitizeMarketSettings({ groups: [], briefBudgetKrw: 99999, enabled: false }, DEFAULT_MARKET_SETTINGS, "me", 5);
  assert.equal(s.groups.length, DEFAULT_MARKET_SETTINGS.groups.length); // 다 지우면 앞 설정 그대로
  assert.equal(s.briefBudgetKrw, 2000);
  assert.equal(s.enabled, false);
  assert.equal(s.updatedBy, "me");
});

test("채널 기록 — 같은 날은 바꿔 끼움 · 7일 · 30일 변화 · 기록 일수", () => {
  let h: ChannelStatPoint[] = [];
  const p = (day: string, subs: number | null, posts: number | null = 10) => ({ day, subs, views: null, posts });
  h = pushChannelPoint(h, p("2026-10-01", 100));
  h = pushChannelPoint(h, p("2026-10-25", 140));
  h = pushChannelPoint(h, p("2026-11-01", 150, 12));
  h = pushChannelPoint(h, p("2026-11-01", 155, 13)); // 같은 날 → 바꿔 끼움
  assert.equal(h.length, 3);
  assert.equal(channelDelta(h, 7, "subs"), 15); // 10-25 기준
  assert.equal(channelDelta(h, 30, "subs"), 55); // 10-01 기준 (10-02 보다 앞선 가장 가까운 기록)
  assert.equal(channelDelta(h, 60, "subs"), null); // 그만큼 앞선 기록이 없다
  assert.equal(channelDelta(h, 7, "posts"), 3);
  assert.equal(channelDelta([p("2026-11-01", 1)], 7, "subs"), null);
  assert.equal(channelDelta([p("2026-10-01", null), p("2026-11-01", 5)], 7, "subs"), null); // 숨긴 값은 건너뜀
  assert.equal(channelTrackedDays(h), 32);
  assert.equal(channelTrackedDays([]), 0);
});

test("검색어 추세 · 기간 — 최근 2주 ÷ 그 전 6주 · 끝은 어제", () => {
  const pts = (vals: number[]) => vals.map((ratio, i) => ({ period: `2026-0${1 + Math.floor(i / 4)}-${String(1 + (i % 4) * 7).padStart(2, "0")}`, ratio }));
  assert.equal(groupTrend(pts([10, 10, 10, 10, 10, 10, 20, 20])).label, "rising");
  assert.equal(groupTrend(pts([10, 10, 10, 10, 10, 10, 10, 10])).label, "steady");
  assert.equal(groupTrend([]).label, "low");
  const d = trendDates("3m", Date.parse("2026-11-02T03:00:00Z"));
  assert.equal(d.endDate, "2026-11-01");
  assert.equal(d.startDate, "2026-08-02");
});

test("트렌드 노트 — 새로 · 고치기(주인 · 출처는 그대로) · 태그 · 상태", () => {
  const a = sanitizeNote({ title: "  뜨는 물막이 ", tags: "#주방 다이소, 주방", status: "nope", source: { kind: "radar", id: "yt_abc", url: "javascript:alert(1)", label: "레이더" }, snapshot: "×1.8" }, "a@x", 100);
  assert.equal(a.title, "뜨는 물막이");
  assert.deepEqual(a.tags, ["주방", "다이소"]);
  assert.equal(a.status, "inbox");
  assert.equal(a.source.kind, "radar");
  assert.equal(a.source.url, null); // http(s) 만
  const b = sanitizeNote({ status: "script", memo: "대본으로", source: { kind: "manual" }, owner: "b@x" }, "b@x", 200, a);
  assert.equal(b.owner, "a@x");
  assert.equal(b.createdAt, 100);
  assert.equal(b.source.kind, "radar");
  assert.equal(b.status, "script");
  assert.equal(b.title, "뜨는 물막이");
  assert.equal(b.snapshot, "×1.8");
  assert.equal(sanitizeNote({}, "a@x", 1).title, "제목 없음");
});
