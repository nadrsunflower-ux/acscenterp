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
  NOTE_MEMO_MAX,
  normalizeNote,
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

test("트렌드 노트 — 공유 범위 · 긴 메모 · 영상 · 사진 (새 노트는 비어서 시작 · 예전 노트도 읽힌다)", () => {
  const a = sanitizeNote({ title: "스웨이룸", visibility: "public", memo: "가".repeat(NOTE_MEMO_MAX + 50), videos: [{ platform: "youtube", id: "dQw4w9WgXcQ" }], images: [{ id: "x" }] }, "a@x", 1);
  assert.equal(a.visibility, "private"); // 모르는 값은 나만 보기
  assert.equal(a.memo.length, NOTE_MEMO_MAX);
  assert.deepEqual(a.videos, []); // 넣기는 서버 동작으로만
  assert.deepEqual(a.images, []);
  const withMedia = { ...a, videos: [{ platform: "instagram" as const, id: "DeOxg-opuO0", url: "https://www.instagram.com/p/DeOxg-opuO0/", label: "화해", aspect: "4:5" as const, stats: "조회 2,382,125", addedAt: 2 }], images: [{ id: "img1", name: "a.jpg", type: "image/jpeg" as const, w: 1, h: 1, size: 1, caption: "", at: 2, by: "a@x" }] };
  const b = sanitizeNote({ visibility: "team", images: [{ id: "img1", caption: "장면 모음" }] }, "a@x", 3, withMedia);
  assert.equal(b.visibility, "team");
  assert.equal(b.videos.length, 1); // 안 보낸 칸은 그대로
  assert.equal(b.images[0].caption, "장면 모음");
  const c = sanitizeNote({ videos: [] }, "a@x", 4, b);
  assert.deepEqual(c.videos, []);
  assert.equal(c.visibility, "team");
  // 예전 노트(칸 없음)
  const old = { title: "옛 노트", owner: "a@x", createdAt: 1, updatedAt: 1, memo: "", tags: [], status: "inbox", pinned: false, source: { kind: "manual", id: null, url: null, label: "" }, snapshot: "", product: "" } as unknown as Parameters<typeof normalizeNote>[0];
  const n = normalizeNote(old);
  assert.equal(n.visibility, "private");
  assert.deepEqual([n.videos, n.images], [[], []]);
  assert.equal(sanitizeNote({ memo: "고침" }, "a@x", 5, old as never).videos.length, 0);
});
