// 제목 키워드 계산 검증 — npm run shorts:test
import test from "node:test";
import assert from "node:assert/strict";
import {
  baseWeeksOf,
  buildTitleIndex,
  defaultTitleWeek,
  normalizeQuery,
  onePerChannel,
  stripJosa,
  titleTrendRows,
  titleWords,
  titleWordSeries,
  videosWithWords,
  weekRange,
  weekStartDate,
  wordScore,
  type TitleVideo,
} from "./title-trends";

const DAY = 86_400_000;
// 2026-11-04(수) 12:00 KST — 이번 주 2026-W45 (11/2 월 ~ 11/8 일)
const NOW = Date.parse("2026-11-04T03:00:00Z");

test("낱말 나누기 — 대표 제목들", () => {
  // 조사 꼬리 · 해시태그 · 숫자 + 단위 · 흔한 말
  assert.deepEqual(titleWords("다이소에서 꼭 챙겨야할 주방 꿀템 3가지"), ["다이소", "챙겨야할", "주방"]);
  assert.deepEqual(titleWords("진작 살걸 후회하는 맞벌이부부의 주방 추천템3 #살림 #살림브이로그"), ["살림", "살림브이로그", "진작", "살걸", "맞벌이부부", "주방"]);
  // 이모지 · 홀로 쓴 자모 · 문장부호
  assert.deepEqual(titleWords("이것 때문에 지금 다이소 품귀현상임ㄷㄷ 🔥🔥"), ["때문", "지금", "다이소", "품귀현상임"]);
  // 해시태그는 # 없이 한 낱말 (조사를 떼지 않는다) · 영어는 소문자 · 쇼츠 · shorts 는 버린다
  assert.deepEqual(titleWords("Clean & Organize with me #Shorts #수납정리함 #정리수납꿀팁"), ["수납정리함", "정리수납꿀팁", "clean", "organize"]);
  // 따옴표 · 쉼표 · 마침표
  assert.deepEqual(titleWords("'다이소'에 없는 신기한 주방꿀템으로, 엄마표 간식."), ["다이소", "신기한", "주방꿀템", "엄마표", "간식"]);
  // 풀이말 꼬리(했는데 · 마세요 · 붙였더니)는 버린다
  assert.deepEqual(titleWords("욕실 타일에 붙였더니 대박 났는데 절대 사지 마세요"), ["욕실", "타일", "대박", "절대", "사지"]);
  // 한 제목 안에서는 한 번씩
  assert.deepEqual(titleWords("다이소 다이소 #다이소"), ["다이소"]);
  // 일본어 — 가타카나 · 한자 덩어리만 (히라가나는 조사 · 어미) · 해시태그의 숫자 + 단위는 남긴다
  assert.deepEqual(titleWords("発想が天才すぎるセリア行ったら絶対に買うべき神商品8選(1~4) #セリア #100均"), ["セリア", "100均", "発想", "天才", "絶対", "神商品"]);
  // 중국어 — 띄어쓰기가 없는 긴 한자 줄은 문장이라 버리고 해시태그만
  assert.deepEqual(titleWords("本来还以为吐槽老妈，万万没想到还另有深意 #搞笑 #熱門"), ["搞笑", "熱門"]);
  // 영어 — 숫자가 붙은 말은 그대로 (top10 · 4k)
  assert.deepEqual(titleWords("Top10 kitchen hacks YOU need 4K"), ["top10", "kitchen", "hacks", "need", "4k"]);
  // 영문 뒤 조사는 따로 떨어져 한 글자라 버려진다
  assert.deepEqual(titleWords("iPhone은 이렇게 쓰세요"), ["iphone"]);
  // 숫자만 · 한 글자는 버린다
  assert.deepEqual(titleWords("2026 꼭 1위 해 봐"), []);
});

test("조사 꼬리 — 받침이 맞을 때만 · 헷갈리는 조사는 앞부분이 자료에 있을 때만", () => {
  assert.equal(stripJosa("주방은"), "주방");
  assert.equal(stripJosa("싱크대는"), "싱크대");
  assert.equal(stripJosa("싱크대은"), "싱크대은"); // 받침 없는 말 뒤에 「은」 은 조사가 아니다
  assert.equal(stripJosa("프라이팬으로"), "프라이팬");
  assert.equal(stripJosa("다이소에서도"), "다이소");
  // 헷갈리는 조사 — 자료 증거가 없으면 그대로 (고양이 · 옷걸이 · 전문가)
  assert.equal(stripJosa("고양이"), "고양이");
  assert.equal(stripJosa("옷걸이"), "옷걸이");
  assert.equal(stripJosa("전문가"), "전문가"); // 받침 있는 말 뒤 「가」 는 조사가 아니다
  assert.equal(stripJosa("주방이"), "주방이");
  assert.equal(stripJosa("주방이", (s) => s === "주방"), "주방");
  assert.equal(stripJosa("고양이", (s) => s === "주방"), "고양이");
  // 앞부분이 한 글자면 떼지 않는다 (가을 · 사랑 · 효과)
  assert.equal(stripJosa("가을"), "가을");
  assert.equal(stripJosa("사랑"), "사랑");
  // 「…하는」 은 풀이말 — 떼지 않는다
  assert.equal(stripJosa("정리하는"), "정리하는");
  assert.equal(normalizeQuery("#다이소에서"), "다이소");
  assert.equal(normalizeQuery("  ShortS "), "shorts");
});

test("자료 전체에서 앞부분이 나오면 헷갈리는 조사도 뗀다", () => {
  const ix = buildTitleIndex([vid("a", "주방이 깔끔", "c1", "2026-11-03"), vid("b", "주방 정리", "c2", "2026-11-03"), vid("c", "고양이 간식", "c3", "2026-11-03")], NOW);
  assert.deepEqual(ix.wordsOf.get("a"), ["주방", "깔끔"]);
  assert.deepEqual(ix.wordsOf.get("c"), ["고양이", "간식"]);
});

test("주 — KST 월요일 · 빠짐없이", () => {
  assert.equal(weekStartDate(Date.parse("2026-11-01T14:00:00Z")), "2026-10-26"); // KST 11/1(일) 23:00
  assert.equal(weekStartDate(Date.parse("2026-11-01T15:00:00Z")), "2026-11-02"); // KST 11/2(월) 00:00
  const r = weekRange(Date.parse("2026-10-14T00:00:00Z"), NOW);
  assert.deepEqual(r.map((w) => w.key), ["2026-W42", "2026-W43", "2026-W44", "2026-W45"]);
  assert.deepEqual(r.map((w) => w.start), ["2026-10-12", "2026-10-19", "2026-10-26", "2026-11-02"]);
  // 해를 넘는 주
  assert.deepEqual(weekRange(Date.parse("2026-12-28T00:00:00Z"), Date.parse("2027-01-05T00:00:00Z")).map((w) => w.key), ["2026-W53", "2027-W01"]);
});

test("점수 — cur 2 이상 · 평소 0 이면 100 · 평소 모르면 null", () => {
  assert.equal(wordScore(1, 0), null);
  assert.equal(wordScore(2, null), null);
  assert.equal(wordScore(2, 0), 100);
  assert.equal(wordScore(6, 2), 50);
  assert.equal(wordScore(3, 3), 0);
  assert.equal(wordScore(2, 6), -50);
  assert.equal(wordScore(4, 1.25), 52);
});

// ---- 계산 ----

function vid(key: string, title: string, channel: string, day: string, o: Partial<TitleVideo> = {}): TitleVideo {
  return {
    key,
    sources: ["radar"],
    title,
    channelKey: `yt_${channel}`,
    channel,
    country: "KR",
    at: Date.parse(`${day}T03:00:00Z`),
    atBasis: "published",
    url: `https://www.youtube.com/shorts/${key}`,
    thumbnail: "",
    multiple: null,
    views: null,
    ...o,
  };
}

test("채널 수로 센다 — 같은 채널이 여러 번 써도 1", () => {
  const videos = [
    // 지난주(W44) — 다이소 2채널
    vid("a1", "다이소 수납", "c1", "2026-10-27"),
    vid("a2", "다이소 수납", "c1", "2026-10-28"),
    vid("a3", "다이소 주방", "c2", "2026-10-29"),
    // W43 — 다이소 1채널 · 수납 0
    vid("b1", "다이소 정리", "c3", "2026-10-20"),
    // W42 — 자료 없음 (평소에 넣지 않는다)
    // W41 — 다이소 0 · 다른 말만
    vid("d1", "이케아 선반", "c4", "2026-10-06"),
    // W45(이번 주) — 같은 채널이 다이소를 세 번
    vid("e1", "다이소 신상", "c5", "2026-11-02"),
    vid("e2", "다이소 신상 2탄", "c5", "2026-11-03"),
    vid("e3", "다이소 신상 3탄", "c5", "2026-11-03"),
  ];
  const ix = buildTitleIndex(videos, NOW);
  assert.deepEqual(ix.weeks.map((w) => [w.key, w.videos, w.channels]), [
    ["2026-W41", 1, 1],
    ["2026-W42", 0, 0],
    ["2026-W43", 1, 1],
    ["2026-W44", 3, 2],
    ["2026-W45", 3, 1],
  ]);
  // W44 의 평소 = W41 · W43 (W40 은 자료 범위 밖, W42 는 자료 없음)
  assert.deepEqual(baseWeeksOf(ix.weeks, "2026-W44").map((w) => w.key), ["2026-W41", "2026-W43"]);
  const rows = titleTrendRows(ix, "2026-W44");
  const daiso = rows.find((r) => r.word === "다이소")!;
  assert.equal(daiso.cur, 2);
  assert.equal(daiso.base, 0.5); // (0 + 1) ÷ 2
  assert.equal(daiso.score, 60); // 100 × 1.5 ÷ 2.5
  assert.equal(daiso.videos, 3);
  assert.equal(daiso.totalVideos, 7);
  assert.equal(daiso.totalChannels, 4);
  assert.equal(daiso.firstSeen, Date.parse("2026-10-20T03:00:00Z"));
  // 수납은 같은 채널(c1)만 — cur 1 이라 순위에 없다
  assert.equal(rows.find((r) => r.word === "수납"), undefined);
  // 고른 낱말은 순위 밖이어도 넣는다 (점수는 없음)
  const sunap = titleTrendRows(ix, "2026-W44", { include: ["수납"] }).find((r) => r.word === "수납")!;
  assert.equal(sunap.cur, 1);
  assert.equal(sunap.score, null);
  // 이번 주 다이소는 한 채널뿐 — 세 편이어도 cur 1
  assert.equal(titleTrendRows(ix, "2026-W45", { minChannels: 1 }).find((r) => r.word === "다이소")!.cur, 1);
  // 첫 주는 비교할 지난 기록이 없다 — 평소 null · 점수 null
  const first = titleTrendRows(ix, "2026-W41", { minChannels: 1 }).find((r) => r.word === "이케아")!;
  assert.equal(first.base, null);
  assert.equal(first.score, null);
});

test("정렬 — 점수 순 · 많이 쓴 순", () => {
  const videos = [
    vid("p1", "주방 정리", "c1", "2026-10-20"),
    vid("p2", "주방 정리", "c2", "2026-10-21"),
    vid("p3", "주방", "c3", "2026-10-22"),
    vid("q1", "주방 정리 선반", "c1", "2026-10-27"),
    vid("q2", "주방 선반", "c2", "2026-10-27"),
    vid("q3", "주방 선반", "c3", "2026-10-27"),
    vid("q4", "주방 정리", "c4", "2026-10-27"),
  ];
  const ix = buildTitleIndex(videos, NOW);
  const byScore = titleTrendRows(ix, "2026-W44").map((r) => `${r.word}:${r.cur}:${r.score}`);
  assert.deepEqual(byScore, ["선반:3:100", "주방:4:14", "정리:2:0"]);
  const byCount = titleTrendRows(ix, "2026-W44", { sort: "count" }).map((r) => r.word);
  assert.deepEqual(byCount, ["주방", "선반", "정리"]);
});

test("추이 · 영상 목록 · 같은 채널은 하나만", () => {
  const videos = [
    vid("a1", "다이소 수납", "c1", "2026-10-27", { multiple: 3 }),
    vid("a2", "다이소 정리", "c1", "2026-10-29", { multiple: 9 }),
    vid("a3", "이케아 수납", "c2", "2026-10-28"),
    vid("b1", "다이소", "c3", "2026-10-13"),
  ];
  const ix = buildTitleIndex(videos, NOW);
  const s = titleWordSeries(ix, ["다이소"]);
  // W43 은 자료가 없어 null (0 과 다르다) · 이번 주(W45)도 아직 자료 없음
  assert.deepEqual(s[0].points.map((p) => [p.week, p.channels]), [
    ["2026-W42", 1],
    ["2026-W43", null],
    ["2026-W44", 1],
    ["2026-W45", null],
  ]);
  const list = videosWithWords(ix, videos, ["다이소", "수납"]);
  assert.deepEqual(list.map((v) => [v.key, v.matched]), [
    ["a2", ["다이소"]],
    ["a3", ["수납"]],
    ["a1", ["다이소", "수납"]],
    ["b1", ["다이소"]],
  ]);
  assert.deepEqual(onePerChannel(list).map((v) => v.key), ["a2", "a3", "b1"]);
  // 처음 볼 주 — 이번 주(W45)는 진행 중이라 끝난 주 중 가장 최근 (자료 있는 주)
  assert.equal(defaultTitleWeek(ix.weeks, "2026-W45"), "2026-W44");
  assert.equal(defaultTitleWeek(buildTitleIndex([], NOW).weeks, "2026-W45"), "2026-W45");
});
