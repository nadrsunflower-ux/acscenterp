// 바이럴 형식 정찰 계산 검증 — npm run shorts:test
import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_SCOUT_SETTINGS,
  buildReport,
  compareBlockReason,
  compareCalcOf,
  compareGroupStats,
  compareLimits,
  computeBaseline,
  kstSlot,
  pickCompareSets,
  titleFeatures,
  formatStats,
  hitNoteState,
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

test("터진 영상 메모 — 분석이 지금 메모를 반영했는지", () => {
  const a = (note?: string) => ({ note });
  assert.equal(hitNoteState({ note: "", analysis: null }), "none");
  assert.equal(hitNoteState({ note: "  ", analysis: a() }), "none");
  assert.equal(hitNoteState({ note: "훅만 보면 됨", analysis: null }), "pending");
  assert.equal(hitNoteState({ note: "훅만 보면 됨 ", analysis: a("훅만 보면 됨") }), "applied");
  assert.equal(hitNoteState({ note: "손 클로즈업이 핵심", analysis: a("훅만 보면 됨") }), "stale");
  assert.equal(hitNoteState({ note: "훅만 보면 됨", analysis: a() }), "stale"); // 메모 없이 분석했던 것 (예전 분석)
  assert.equal(hitNoteState({ note: "", analysis: a("지운 메모") }), "stale");
});

// ---- 터진 영상 vs 평소 (같은 감시 채널 안) ----

const short = (id: string, views: number | null, age: number, extra: Partial<{ title: string; duration: number }> = {}) => ({
  id,
  url: `https://www.youtube.com/watch?v=${id}`,
  title: extra.title ?? `영상 ${id}`,
  thumbnail: `https://i.ytimg.com/vi/${id}/mqdefault.jpg`,
  views,
  publishedAt: daysAgo(age),
  duration: extra.duration ?? 30,
});

test("터진 vs 평소 고르기 — 평소를 낸 표본(7일 넘은 것)에서 · 배수 큰 순 · 1배 가까운 순", () => {
  const vids = [
    short("a1", 1000, 8),
    short("a2", 1000, 9),
    short("a3", 1000, 10),
    short("a4", 1100, 11),
    short("a5", 900, 12),
    short("a6", 1200, 13),
    short("a7", 800, 14),
    short("a8", 1000, 15),
    short("h1", 5000, 16),
    short("h2", 30000, 20),
    short("y1", 100000, 2), // 올린 지 이틀 — 어느 쪽에도 안 넣는다
    short("nv", null, 9), // 조회수 비공개
  ];
  const r = pickCompareSets(vids, { threshold: 3, minViews: 1000 }, NOW);
  assert.equal(r.baseline.value, 1000);
  assert.equal(r.pool, 10);
  assert.equal(r.young, 1);
  assert.deepEqual(r.hits.map((h) => [h.id, h.multiple]), [["h2", 30], ["h1", 5]]);
  // 1배 넷(최근 순) → 1.1 → 0.9 → 1.2 → 0.8
  assert.deepEqual(r.usual.map((u) => u.id), ["a1", "a2", "a3", "a8", "a4", "a5", "a6", "a7"]);
  // 조회 하한 — 배수가 커도 minViews 밑이면 터진 쪽에서 뺀다
  assert.deepEqual(pickCompareSets(vids, { threshold: 3, minViews: 10_000 }, NOW).hits.map((h) => h.id), ["h2"]);
  // 평소를 모르면 둘 다 비운다
  const few = pickCompareSets(vids.slice(0, 3), { threshold: 3, minViews: 0 }, NOW);
  assert.equal(few.baseline.value, null);
  assert.equal(few.hits.length + few.usual.length, 0);
});

test("터진 쪽 최대 6편 · 평소 쪽 최대 8편", () => {
  const vids = [...Array.from({ length: 20 }, (_, i) => short(`u${i}`, 1000, 8 + i)), ...Array.from({ length: 9 }, (_, i) => short(`h${i}`, 10_000 + i * 1000, 8 + i))];
  const r = pickCompareSets(vids, { threshold: 3, minViews: 0 }, NOW);
  assert.equal(r.hits.length, 6);
  assert.equal(r.usual.length, 8);
  assert.equal(r.hits[0].id, "h8");
});

test("제목 특징 — 숫자 · 물음표 · 해시태그 · 이모지 (™ 는 이모지 아님)", () => {
  assert.deepEqual(titleFeatures("다이소 3천원 꿀템 #shorts"), { len: 18, number: true, question: false, hashtag: true, emoji: false });
  assert.deepEqual(titleFeatures("이거 진짜 돼? 🤯"), { len: 10, number: false, question: true, hashtag: false, emoji: true });
  assert.equal(titleFeatures("Brand™ review").emoji, false);
  assert.equal(titleFeatures("Top#1 hack").hashtag, false); // 낱말 가운데 # 는 해시태그가 아니다
});

test("올린 때는 한국 시각 — 날짜가 넘어가는 시각", () => {
  assert.deepEqual(kstSlot("2026-10-30T12:30:00Z"), { weekday: 5, hour: 21, band: 3 }); // KST 10/30(금) 21:30 저녁
  assert.deepEqual(kstSlot("2026-10-29T16:00:00Z"), { weekday: 5, hour: 1, band: 0 }); // KST 10/30(금) 01:00 새벽
  assert.equal(kstSlot(""), null);
});

test("묶음 계산 — 중앙값 · 제목 특징 편수 · 요일 · 시간대", () => {
  const s = compareGroupStats([
    { title: "다이소 3천원 꿀템 #shorts", duration: 30, publishedAt: "2026-10-30T12:30:00Z", views: 5000 },
    { title: "이거 진짜 돼? 🤯", duration: 50, publishedAt: "2026-10-29T16:00:00Z", views: 9000 },
    { title: "그냥 정리", duration: 40, publishedAt: "2026-10-27T03:00:00Z", views: 7000 }, // KST 10/27(화) 12:00 오후
  ]);
  assert.equal(s.n, 3);
  assert.equal(s.medianViews, 7000);
  assert.equal(s.medianSec, 40);
  assert.equal(s.medianTitleLen, 10);
  assert.deepEqual([s.withNumber, s.withQuestion, s.withHashtag, s.withEmoji], [1, 1, 1, 1]);
  assert.deepEqual(s.weekdays, [0, 0, 1, 0, 0, 2, 0]);
  assert.deepEqual(s.bands, [1, 0, 1, 1]);
  const empty = compareGroupStats([]);
  assert.equal(empty.n, 0);
  assert.equal(empty.medianViews, null);
});

test("한계 · 막는 이유 — 터진 1편이면 「일반화하기 어려움」", () => {
  assert.deepEqual(compareLimits(1, 8, "mature"), ["터진 영상이 1편뿐 — 일반화하기 어려움"]);
  assert.deepEqual(compareLimits(4, 2, "young"), ["평소 수준 영상이 2편뿐 — 견줄 쪽이 얇음", "올린 지 7일 넘은 쇼츠가 5편이 안 돼 평소 조회수가 어림"]);
  assert.deepEqual(compareLimits(3, 5, "mature"), []);
  const base = { baseline: 1000, pool: 20, young: 0, threshold: 3, minViews: 10_000, hits: [{}], usual: [{}] } as unknown as Parameters<typeof compareBlockReason>[0];
  assert.equal(compareBlockReason(base), null);
  assert.match(compareBlockReason({ ...base, baseline: null }) ?? "", /평소 조회수를 낼 수 없습니다/);
  assert.match(compareBlockReason({ ...base, pool: 1, young: 49 }) ?? "", /쇼츠가 1편뿐이라 아직 견줄 수 없습니다 — 7일 안 49편은 조회수가 차는 중/);
  assert.match(compareBlockReason({ ...base, hits: [] }) ?? "", /쇼츠 20편 중 평소의 3배 · 조회 10,000회를 넘은 영상이 없습니다/);
  assert.match(compareBlockReason({ ...base, usual: [] }) ?? "", /견줄 쪽이 없습니다/);
});

test("저장용 계산 — 분석 있는 영상 표시 · 한계 함께", () => {
  const vids = [...Array.from({ length: 8 }, (_, i) => short(`u${i}`, 1000, 8 + i)), short("h1", 9000, 9, { title: "3초 만에 끝 #shorts", duration: 21 })];
  const sets = pickCompareSets(vids, { threshold: 3, minViews: 0 }, NOW);
  const c = compareCalcOf(sets, { threshold: 3, minViews: 0 }, new Set(["h1"]));
  assert.equal(c.baseline, 1000);
  assert.equal(c.hits.length, 1);
  assert.deepEqual({ id: c.hits[0].id, analyzed: c.hits[0].analyzed, multiple: c.hits[0].multiple, duration: c.hits[0].duration }, { id: "h1", analyzed: true, multiple: 9, duration: 21 });
  assert.equal(c.usual.every((u) => !u.analyzed), true);
  assert.equal(c.stats.hits.withNumber, 1);
  assert.deepEqual(c.stats.limits, ["터진 영상이 1편뿐 — 일반화하기 어려움"]);
});
