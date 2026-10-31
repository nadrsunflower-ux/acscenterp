// 바이럴 형식 정찰 계산 검증 — npm run shorts:test
import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_SCOUT_SETTINGS,
  buildReport,
  computeBaseline,
  formatStats,
  isShortLike,
  isoWeekKey,
  koreanCommentCount,
  lifecycleOf,
  median,
  multipleOf,
  parseYoutubeRef,
  pickHits,
  type FormatDoc,
  type HitDoc,
  type KoreaCheck,
  type WatchChannelDoc,
} from "./scout";

const NOW = Date.parse("2026-10-31T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

test("중앙값 — 짝수 · 홀수 · 빈 값", () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([]), null);
});

test("쇼츠 추정은 3분 이하 · 0초는 아님", () => {
  assert.equal(isShortLike(59), true);
  assert.equal(isShortLike(180), true);
  assert.equal(isShortLike(181), false);
  assert.equal(isShortLike(0), false);
  assert.equal(isShortLike(null), false);
});

test("평소 조회수 — 7일 넘은 쇼츠 중앙값, 모자라면 전부, 그래도 모자라면 모름", () => {
  const mature = [10, 20, 30, 40, 50].map((v, i) => ({ views: v * 1000, publishedAt: daysAgo(8 + i) }));
  const young = [{ views: 900_000, publishedAt: daysAgo(1) }];
  const b = computeBaseline([...young, ...mature], NOW);
  assert.deepEqual(b, { value: 30_000, n: 5, basis: "mature" });

  const fresh = [1, 2, 3, 4, 5].map((v) => ({ views: v * 100, publishedAt: daysAgo(v) }));
  assert.equal(computeBaseline(fresh, NOW).basis, "young");
  assert.equal(computeBaseline(fresh, NOW).value, 300);

  assert.deepEqual(computeBaseline(fresh.slice(0, 3), NOW), { value: null, n: 3, basis: "none" });
  // 숨긴 조회수(null)는 세지 않는다
  assert.equal(computeBaseline([...mature, { views: null, publishedAt: daysAgo(9) }], NOW).n, 5);
});

test("배수와 터짐 — 평소의 3배 · 1만 회 이상 · 30일 안", () => {
  assert.equal(multipleOf(90_000, 30_000), 3);
  assert.equal(multipleOf(10, 0), null);
  const vids = [
    { id: "a", views: 300_000, publishedAt: daysAgo(3) }, // 10배
    { id: "b", views: 60_000, publishedAt: daysAgo(3) }, // 2배 — 모자람
    { id: "c", views: 300_000, publishedAt: daysAgo(40) }, // 오래됨
  ];
  const hits = pickHits(vids, 30_000, DEFAULT_SCOUT_SETTINGS, NOW);
  assert.deepEqual(hits.map((h) => [h.id, h.multiple]), [["a", 10]]);
  // 작은 채널: 평소 200회, 3천 회는 15배지만 1만 회 미만이라 뺀다
  assert.equal(pickHits([{ views: 3000, publishedAt: daysAgo(2) }], 200, DEFAULT_SCOUT_SETTINGS, NOW).length, 0);
  assert.equal(pickHits(vids, null, DEFAULT_SCOUT_SETTINGS, NOW).length, 0);
});

test("한글 댓글 세기", () => {
  assert.deepEqual(koreanCommentCount(["wow", "이거 뭐예요", "すごい", "ㅋㅋㅋ"]), { sampled: 4, korean: 2 });
});

test("형식 수명 — 씨앗 · 떠오름 · 포화 조짐 · 식음 · 유지", () => {
  const h = (age: number, channel: string, multiple: number) => ({ publishedAt: daysAgo(age), channel, multiple });
  assert.equal(lifecycleOf([], NOW).stage, "unknown");
  assert.equal(lifecycleOf([h(3, "a", 5)], NOW).stage, "seed");
  assert.equal(lifecycleOf([h(60, "a", 5)], NOW).stage, "faded");
  assert.equal(lifecycleOf([h(2, "a", 5), h(5, "b", 4)], NOW).stage, "rising");
  // 최근 2주 채널 하나뿐 → 유지
  assert.equal(lifecycleOf([h(2, "a", 5), h(5, "a", 4)], NOW).stage, "steady");
  // 6편 이상 · 최근 배수가 그 전의 60% 밑
  const sat = [h(20, "a", 10), h(25, "b", 12), h(30, "c", 9), h(3, "d", 3), h(5, "e", 3.5), h(8, "f", 3)];
  assert.equal(lifecycleOf(sat, NOW).stage, "saturating");
  assert.equal(lifecycleOf([h(50, "a", 5), h(70, "b", 4)], NOW).stage, "faded");
});

const korea = (over: Partial<KoreaCheck> = {}): KoreaCheck => ({
  status: "unchecked",
  query: "",
  checkedAt: null,
  by: null,
  sampleSize: null,
  matches: [],
  lastSearch: null,
  note: "",
  ...over,
});

const hit = (id: string, over: Partial<HitDoc>): HitDoc & { id: string } => ({
  id,
  owner: "company",
  createdAt: NOW - 86_400_000,
  updatedAt: NOW,
  updatedBy: "company",
  platform: "youtube",
  url: `https://www.youtube.com/watch?v=${id.padEnd(11, "x")}`,
  externalId: null,
  watchId: null,
  channel: "ch",
  country: "US",
  language: "en",
  title: id,
  thumbnail: "",
  publishedAt: daysAgo(3),
  duration: 30,
  views: { v: 100_000, src: "api" },
  likes: { v: null, src: "api" },
  comments: { v: null, src: "api" },
  baseline: { v: 10_000, src: "api" },
  multiple: 10,
  viewHistory: [],
  found: "scan",
  analysis: null,
  formatId: null,
  status: "new",
  koreanComments: null,
  note: "",
  ...over,
});

test("형식 집계 — 나라별 처음 본 날 · 국내 터짐이 있으면 「조금 있음」 · 시차", () => {
  const hits = [
    hit("us1", { country: "US", publishedAt: daysAgo(30), channel: "a" }),
    hit("jp1", { country: "JP", publishedAt: daysAgo(20), channel: "b" }),
    hit("kr1", { country: "KR", publishedAt: daysAgo(9), channel: "c" }),
    hit("gone", { country: "CN", publishedAt: daysAgo(60), status: "dismissed" }),
  ];
  const s = formatStats({ korea: korea({ status: "none_in_sample" }) }, hits, NOW);
  assert.equal(s.examples, 3);
  assert.deepEqual(s.countries.map((c) => c.code), ["US", "JP", "KR"]);
  assert.equal(s.korea, "some");
  assert.equal(s.foreignFirst?.code, "US");
  assert.equal(s.lagDays, 21);
  // 사람이 고른 국내 표본 영상의 게시일도 「한국에 나타난 날」 이다
  const s2 = formatStats({ korea: korea({ status: "spread", matches: [{ url: "u", title: "t", views: 1, publishedAt: daysAgo(25) }] }) }, hits.slice(0, 2), NOW);
  assert.equal(s2.korea, "spread");
  assert.equal(s2.lagDays, 5);
});

const format = (id: string, name: string, over: Partial<FormatDoc> = {}): FormatDoc & { id: string } => ({
  id,
  owner: "a@x",
  createdAt: NOW,
  updatedAt: NOW,
  updatedBy: "a@x",
  name,
  summary: "",
  hook: "",
  structure: [],
  editing: "",
  sound: "",
  textOverlay: "",
  whyItWorks: "",
  languageDependence: "visual",
  aiFeasibility: { level: "easy", easyParts: "", hardParts: "" },
  risks: [],
  riskNote: "",
  brandIdeas: [],
  koreanQueries: [],
  korea: korea(),
  archived: false,
  note: "",
  ...over,
});

test("게시일을 모르는 직접 등록 영상은 찾은 날로 센다", () => {
  const hits = [
    hit("m1", { country: "CN", publishedAt: null, createdAt: NOW - 2 * 86_400_000, found: "manual", channel: "a" }),
    hit("m2", { country: "CN", publishedAt: null, createdAt: NOW - 3 * 86_400_000, found: "manual", channel: "b" }),
  ];
  const s = formatStats({ korea: korea() }, hits, NOW);
  assert.equal(s.countries[0].firstSeen, new Date(NOW - 3 * 86_400_000).toISOString());
  assert.equal(s.life.stage, "rising");
  assert.equal(s.foreignFirst?.code, "CN");
});

test("주간 보고 — 떠오름 · 해외에만 · 새로 터진 영상 · 시차", () => {
  const formats = [format("f1", "거대 제품 옥외광고"), format("f2", "유리 과일 자르기 ASMR", { korea: korea({ status: "spread" }) }), format("f3", "보관함", { archived: true })];
  const hits = [
    hit("a", { formatId: "f1", country: "US", channel: "a", publishedAt: daysAgo(4), multiple: 12 }),
    hit("b", { formatId: "f1", country: "JP", channel: "b", publishedAt: daysAgo(6), multiple: 8 }),
    hit("c", { formatId: "f2", country: "US", channel: "c", publishedAt: daysAgo(40), multiple: 5, createdAt: NOW - 30 * 86_400_000 }),
    hit("d", { formatId: "f2", country: "KR", channel: "d", publishedAt: daysAgo(10), multiple: 4, createdAt: NOW - 20 * 86_400_000 }),
    hit("e", { formatId: "f3", country: "US", channel: "e" }),
    hit("f", { country: "BR", channel: "f", multiple: 30 }),
  ];
  const ch: (WatchChannelDoc & { id: string })[] = [];
  const r = buildReport({ formats, hits, channels: ch, now: NOW });
  assert.equal(r.week, "2026-W44");
  assert.deepEqual(r.rising.map((l) => l.formatId), ["f1"]);
  assert.deepEqual(r.abroadOnly.map((l) => l.formatId), ["f1"]);
  assert.equal(r.counts.newHits, 4); // a b e f — c d 는 지난주 전에 찾음
  assert.equal(r.newHits[0].hitId, "f"); // 배수 큰 순
  assert.equal(r.counts.unassigned, 6);
  assert.deepEqual(r.lags.map((l) => [l.formatId, l.from, l.days]), [["f2", "US", 30]]);
  assert.equal(r.counts.formats, 2); // 보관한 형식은 빠진다
});

test("주 번호는 한국 시각 기준 (일요일 밤 11시 KST 는 아직 그 주)", () => {
  assert.equal(isoWeekKey(Date.parse("2026-11-01T14:00:00Z")), "2026-W44"); // KST 11/1(일) 23:00
  assert.equal(isoWeekKey(Date.parse("2026-11-01T15:00:00Z")), "2026-W45"); // KST 11/2(월) 00:00
  assert.equal(isoWeekKey(Date.parse("2027-01-01T03:00:00Z")), "2026-W53");
});

test("채널 · 영상 주소 해석", () => {
  assert.deepEqual(parseYoutubeRef("@MrBeast"), { kind: "handle", value: "@MrBeast" });
  assert.deepEqual(parseYoutubeRef("https://www.youtube.com/@쇼츠채널/shorts"), { kind: "handle", value: "@쇼츠채널" });
  assert.deepEqual(parseYoutubeRef("youtube.com/channel/UCX6OQ3DkcsbYNE6H8uQQuVA"), { kind: "channel", value: "UCX6OQ3DkcsbYNE6H8uQQuVA" });
  assert.deepEqual(parseYoutubeRef("https://youtube.com/shorts/jNQXAC9IVRw?feature=share"), { kind: "video", value: "jNQXAC9IVRw" });
  assert.deepEqual(parseYoutubeRef("https://m.youtube.com/watch?v=jNQXAC9IVRw"), { kind: "video", value: "jNQXAC9IVRw" });
  assert.deepEqual(parseYoutubeRef("https://youtu.be/jNQXAC9IVRw"), { kind: "video", value: "jNQXAC9IVRw" });
  assert.equal(parseYoutubeRef("https://www.tiktok.com/@a/video/1"), null);
  assert.equal(parseYoutubeRef(""), null);
});
