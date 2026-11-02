// 시장 트렌드 서버 조각 검증 (외부 호출은 모의) — npm run shorts:test
import test from "node:test";
import assert from "node:assert/strict";
import * as A from "./ai";
import * as N from "./naver";
import { buildBriefInput, radarProductTrends, resolveBriefRef } from "./market";
import type { RadarDoc } from "../radar";
import type { ChannelStatDoc } from "../market";

process.env.OPENROUTER_API_KEY = "test-openrouter-key";
process.env.NEANDER_SHORTS_NAVER_CLIENT_ID = "nid";
process.env.NEANDER_SHORTS_NAVER_CLIENT_SECRET = "nsecret";

const NOW = Date.parse("2026-11-02T00:00:00Z");
const DAY = 86_400_000;
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

const radar = (id: string, o: Partial<RadarDoc>): RadarDoc & { id: string } =>
  ({
    id,
    platform: "youtube",
    videoId: id.slice(3),
    url: `https://www.youtube.com/shorts/${id.slice(3)}`,
    title: `영상 ${id}`,
    channel: "c",
    channelId: "",
    thumbnail: "",
    publishedAt: null,
    duration: 30,
    views: 1000,
    likes: null,
    comments: null,
    viewsAt: NOW,
    viewHistory: [],
    baseline: 100,
    multiple: 10,
    velocityPerDay: 500,
    velocityBasis: "since_publish",
    info: { sampled: 10, matched: 2 },
    keywords: [],
    score: 50,
    ai: { relevant: true, product: "물막이", productKey: "물막이", category: "주방", confidence: "likely", evidence: "", why: "", hook: "", naverKeywords: ["물막이"], coupangQuery: "", caution: "", model: "", costUsd: 0, at: NOW },
    naver: { keywords: ["물막이"], label: "rising", recent: 30, before: 10, change: 3, weeks: 8, at: NOW },
    dismissed: null,
    saved: [],
    firstSeenAt: NOW - DAY,
    lastSeenAt: NOW,
    ...o,
  }) as RadarDoc & { id: string };

test("레이더 상품 추이 — 같은 상품은 한 줄(점수 큰 영상이 대표) · 변화 큰 순 · 제외 · 무관 · 추세 없음 빼기", () => {
  const items = [
    radar("yt_aaaaaaaaaaa", { score: 40 }),
    radar("yt_bbbbbbbbbbb", { score: 80 }), // 같은 상품 — 대표
    radar("yt_ccccccccccc", { ai: { ...radar("x", {}).ai!, product: "자석 컵", productKey: "자석컵" }, naver: { keywords: ["자석컵"], label: "steady", recent: 10, before: 10, change: 1, weeks: 8, at: NOW } }),
    radar("yt_ddddddddddd", { dismissed: { by: "a", at: NOW } }),
    radar("yt_eeeeeeeeeee", { naver: null }),
  ];
  const t = radarProductTrends(items);
  // 물막이 = aaa · bbb (ddd 는 제외됨 · eee 는 추세 없음이라 빠진다)
  assert.deepEqual(t.map((x) => [x.product, x.id, x.candidates, x.change]), [["물막이", "yt_bbbbbbbbbbb", 2, 3], ["자석 컵", "yt_ccccccccccc", 1, 1]]);
});

test("브리핑 자료 — 최근 3일 레이더 · 터진 영상, 7일 형식, 채널 변화 · 내 채널 먼저", () => {
  const ch = (id: string, mine: boolean, subs: number[]): ChannelStatDoc & { id: string } => ({
    id,
    platform: "youtube",
    externalId: "UC" + id,
    name: id,
    handle: "",
    thumbnail: "",
    mine,
    watchId: null,
    country: "",
    history: subs.map((s, i) => ({ day: new Date(Date.parse("2026-10-20T00:00:00Z") + i * 6 * DAY).toISOString().slice(0, 10), subs: s, views: null, posts: null })),
    updatedAt: NOW,
  });
  const input = buildBriefInput({
    day: "2026-11-02",
    now: NOW,
    radar: [radar("yt_new00000000", {}), radar("yt_old00000000", { firstSeenAt: NOW - 10 * DAY })],
    hits: [
      { id: "h1", title: "새 영상", channel: "c", country: "US", multiple: 20, formatId: "f1", createdAt: NOW - DAY, status: "new" },
      { id: "h2", title: "옛 영상", channel: "c", country: "US", multiple: 50, formatId: "f1", createdAt: NOW - 9 * DAY, status: "new" },
    ],
    formats: [
      { id: "f1", name: "문제공감", summary: "s", archived: false, updatedAt: NOW - DAY, korea: { status: "some" } },
      { id: "f2", name: "옛 형식", summary: "s", archived: false, updatedAt: NOW - 30 * DAY, korea: { status: "none_in_sample" } },
    ],
    groupSeries: { salim: { groupId: "salim", name: "살림", keywords: ["살림템"], points: [10, 10, 10, 10, 10, 10, 20, 20].map((ratio, i) => ({ period: `2026-09-${String(1 + i).padStart(2, "0")}`, ratio })), at: NOW } },
    channels: [ch("watch1", false, [100, 150, 200]), ch("mine1", true, [10, 11, 12])],
  });
  assert.deepEqual(input.radar.map((r) => r.id), ["yt_new00000000"]);
  assert.equal(input.radar[0].infoRate, 0.2);
  assert.deepEqual(input.hits.map((h) => [h.id, h.format]), [["h1", "문제공감"]]);
  assert.deepEqual(input.formats.map((f) => [f.id, f.examples]), [["f1", 2]]);
  assert.equal(input.groups[0].label, "국내 검색 상승");
  assert.equal(input.channels[0].id, "mine1"); // 내 채널 먼저
  assert.equal(input.channels[1].subs7, 100); // 7일 전(10-25)보다 앞선 가장 가까운 기록 10-20 기준
  assert.equal(input.productTrends[0].product, "물막이");

  // 근거 되짚기 — 자료에 있는 id 만
  const rd = [radar("yt_new00000000", {})];
  assert.equal(resolveBriefRef("radar", "yt_new00000000", input, [], rd, new Map())?.url, "https://www.youtube.com/shorts/new00000000");
  assert.equal(resolveBriefRef("radar", "yt_made_up_id", input, [], rd, new Map()), null);
  assert.equal(resolveBriefRef("hit", "h1", input, [], rd, new Map([["h1", "https://x/h1"]]))?.url, "https://x/h1");
  assert.equal(resolveBriefRef("hit", "h2", input, [], rd, new Map()), null); // 3일 밖이라 자료에 없음
  assert.equal(resolveBriefRef("group", "salim", input, [], rd, new Map())?.label, "살림");
  assert.equal(resolveBriefRef("format", "", input, [], rd, new Map()), null);
});

test("네이버 검색어 트렌드 — 묶음 5개까지 · 묶음마다 20개 · 나이 · 성별 · 오류 메시지", async () => {
  let body: Record<string, unknown> = {};
  N.setNaverFetch((async (_u: RequestInfo | URL, init: RequestInit = {}) => {
    body = JSON.parse(String(init.body));
    const groups = body.keywordGroups as { groupName: string }[];
    return json({ results: groups.map((g, i) => ({ title: g.groupName, data: [{ period: "2026-10-27", ratio: 50 + i }, { period: "2026-10-20", ratio: 10 }] })) });
  }) as typeof fetch);
  try {
    const r = await N.naverTrend({
      groups: Array.from({ length: 7 }, (_, i) => ({ name: `g${i}`, keywords: Array.from({ length: 25 }, (_, k) => `k${k}`) })),
      startDate: "2026-01-01",
      endDate: "2026-11-01",
      timeUnit: "week",
      gender: "f",
      ages: ["3", "4", "99"],
    });
    assert.equal((body.keywordGroups as unknown[]).length, 5);
    assert.equal(((body.keywordGroups as { keywords: string[] }[])[0].keywords).length, 20);
    assert.equal(body.gender, "f");
    assert.deepEqual(body.ages, ["3", "4"]); // 없는 구간 코드는 뺀다
    assert.deepEqual(r[0].points.map((p) => p.period), ["2026-10-20", "2026-10-27"]); // 날짜 순
    assert.equal(r[1].points[1].ratio, 51);
    N.setNaverFetch((async () => json({ error: { errorCode: "429", message: "Too Many Requests" } }, 429)) as typeof fetch);
    await assert.rejects(N.naverTrend({ groups: [{ name: "a", keywords: ["a"] }], startDate: "2026-01-01", endDate: "2026-02-01", timeUnit: "month" }), /Too Many Requests/);
    await assert.rejects(N.naverTrend({ groups: [{ name: "a", keywords: [" "] }], startDate: "2026-01-01", endDate: "2026-02-01", timeUnit: "month" }), /검색어가 없습니다/);
  } finally {
    N.setNaverFetch(null);
  }
});

test("브리핑 AI — 규칙 · 스키마 · 자료가 요청에 들어가고 글자를 다듬는다", async () => {
  let body: Record<string, any> = {};
  A.setAiFetch((async (_u: RequestInfo | URL, init: RequestInit = {}) => {
    body = JSON.parse(String(init.body));
    return json({
      choices: [{ message: { content: JSON.stringify({ headline: "  물막이가 뜬다 ", summary: ["a", ""], items: [{ kind: "product", title: "물막이", why: "w", numbers: "평소의 10배", action: "대본", refKind: "radar", refId: "yt_x" }] }) } }],
      usage: { cost: 0.004 },
    });
  }) as typeof fetch);
  try {
    const r = await A.marketBriefAI({ day: "2026-11-02", radar: [], productTrends: [], hits: [], formats: [], groups: [], channels: [] });
    assert.equal(body.response_format.json_schema.name, "market_brief");
    assert.match(body.messages[0].content, /자료에 없는 숫자/);
    assert.match(body.messages[0].content, /상대값/);
    assert.match(body.messages[1].content, /"day":"2026-11-02"/);
    assert.equal(r.headline, "물막이가 뜬다");
    assert.deepEqual(r.summary, ["a"]);
    assert.equal(r.items[0].refId, "yt_x");
    assert.equal(r.costUsd, 0.004);
  } finally {
    A.setAiFetch(null);
  }
});
