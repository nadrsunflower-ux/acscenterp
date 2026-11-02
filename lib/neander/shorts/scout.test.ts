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
  koreaEvidence,
  koreanCommentCount,
  lifecycleOf,
  median,
  multipleOf,
  parseYoutubeRef,
  pickHits,
  reportDays,
  reportFormatCards,
  reportFormatList,
  type FormatDoc,
  type HitDoc,
  type KoreaCheck,
  type ReportFormatLine,
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

test("보고 화면 — 겹친 형식은 한 번만 · 구간 순서 · 기간은 저장된 from/to", () => {
  const l = (formatId: string): ReportFormatLine => ({ formatId, name: formatId, stage: "rising", basis: "", countries: ["US"], examples: 2, medianMultiple: 5, korea: "unchecked", ai: "easy", lang: "visual", top: null });
  const list = reportFormatList({ abroadOnly: [l("b")], rising: [l("a"), l("b")], saturating: [l("c"), l("a")] });
  assert.deepEqual(list.map((x) => [x.formatId, x.sections]), [["b", ["abroadOnly", "rising"]], ["a", ["rising", "saturating"]], ["c", ["saturating"]]]);
  assert.deepEqual(reportFormatList({ abroadOnly: [], rising: [], saturating: [] }), []);
  // 주 이름이 아니라 저장된 기간 — 7일 · 반올림 · 최소 1일
  assert.equal(reportDays({ from: NOW - 7 * 86_400_000, to: NOW }), 7);
  assert.equal(reportDays({ from: NOW - 7 * 86_400_000 - 3_600_000, to: NOW }), 7);
  assert.equal(reportDays({ from: NOW, to: NOW }), 1);
});

test("보고 화면 카드 — 구간 형식 먼저(저장된 줄) · 구간 밖 형식도 · 보고 뒤 영상 · 보관 · 예시 없음은 빼고", () => {
  const formats = [
    format("f1", "떠오름"),
    format("f2", "국내에 퍼진 유지", { korea: korea({ status: "spread", by: "company", checkedAt: NOW }) }),
    format("f3", "보관함", { archived: true }),
    format("f4", "예시 없음"),
    format("f5", "보고 뒤에 묶임"),
  ];
  const hits = [
    hit("a", { formatId: "f1", country: "US", channel: "a", publishedAt: daysAgo(4), multiple: 12 }),
    hit("b", { formatId: "f1", country: "JP", channel: "b", publishedAt: daysAgo(6), multiple: 8 }),
    hit("c", { formatId: "f2", country: "KR", channel: "c", publishedAt: daysAgo(26), multiple: 5 }),
    hit("d", { formatId: "f2", country: "KR", channel: "c", publishedAt: daysAgo(9), multiple: 7 }),
    hit("e", { formatId: "f3", country: "US", channel: "e" }),
    hit("f", { formatId: "f5", country: "US", channel: "f", createdAt: NOW + 3_600_000 }),
    hit("g", { formatId: "f2", country: "KR", channel: "g", status: "dismissed" }),
  ];
  // 보고는 f 를 찾기 전에 만들었다 — 화면에는 지금 자료(f 포함)가 온다
  const r = buildReport({ formats, hits: hits.filter((h) => h.id !== "f"), channels: [], now: NOW });
  const cards = reportFormatCards(r, formats, hits);
  assert.deepEqual(cards.map((c) => [c.formatId, c.sections]), [["f1", ["abroadOnly", "rising"]], ["f2", []]]);
  assert.equal(cards.length, r.counts.formats); // 보고의 「형식 카드 N장」 과 같은 형식들
  const f2 = cards[1];
  assert.equal(f2.examples, 2); // 지운 영상(g)은 빼고
  assert.equal(f2.korea, "spread");
  assert.notEqual(f2.stage, "rising");
  // 구간 형식은 보고에 저장된 줄 그대로 (지금 자료로 다시 세지 않는다)
  const stored = { ...r, rising: [{ ...r.rising[0], examples: 99 }], abroadOnly: [] };
  assert.equal(reportFormatCards(stored, formats, hits)[0].examples, 99);
});

test("국내 근거 — AI 판단 표시는 자동 확인일 때만 · 표본에 없음은 단정이 아님", () => {
  const k = (o: Partial<KoreaCheck>): KoreaCheck => ({ status: "unchecked", query: "", checkedAt: null, by: null, sampleSize: null, matches: [], lastSearch: null, note: "", ...o });
  const m = (n: number) => Array.from({ length: n }, (_, i) => ({ url: `u${i}`, title: "", views: null, publishedAt: null }));
  assert.deepEqual(koreaEvidence("unchecked", k({})), { text: "아직 국내 검색 전", ai: false });
  const auto = koreaEvidence("spread", k({ status: "spread", checkedAt: NOW, by: "company", sampleSize: 25, matches: m(4) }));
  assert.equal(auto.ai, true);
  assert.equal(auto.text, "국내 검색 표본 25편 중 4편이 같은 형식 · 제목·설명 기반 AI 판단");
  const human = koreaEvidence("some", k({ status: "some", checkedAt: NOW, by: "a@b.c", sampleSize: 20, matches: m(1) }));
  assert.equal(human.ai, false);
  assert.match(human.text, /사람이 확인$/);
  const none = koreaEvidence("none_in_sample", k({ status: "none_in_sample", checkedAt: NOW, by: "company", sampleSize: 25 }));
  assert.equal(none.text, "국내 검색 표본 25편에서 같은 형식을 못 찾음 · 제목·설명 기반 AI 판단");
  // 카드 기록은 「확인 전」 인데 국내 영상이 묶여 보고가 「조금 있음」 — AI 판단이 아니다
  assert.deepEqual(koreaEvidence("some", k({ status: "unchecked" })), { text: "국내 영상이 이 형식에 묶여 있음", ai: false });
  assert.equal(koreaEvidence("some", null).ai, false);
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
