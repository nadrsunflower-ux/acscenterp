// 레퍼런스 영상 컷 표 — 주소 정규화 · 컷 다듬기 · 복사 글 · 대본 참고 글 검증 (npx tsx --test lib/neander/shorts/cuts.test.ts)
import test from "node:test";
import assert from "node:assert/strict";
import { BEAT_LABEL } from "./model";
import {
  CUTS_MAX,
  CUT_TEXT_MAX,
  avgCutSec,
  cutEmbedUrl,
  cutEstimateUsd,
  cutIdOf,
  cutReferenceText,
  cutSheetLength,
  cutSheetText,
  isCutId,
  normalizeYoutubeVideoUrl,
  sanitizeCutResult,
  sanitizeCuts,
  videoIdOfCut,
  type CutSheet,
} from "./cuts";

const ID = "dQw4w9WgXcQ";
const WATCH = `https://www.youtube.com/watch?v=${ID}`;

test("주소 — watch · shorts · youtu.be · m. · embed → 정식 watch 주소", () => {
  for (const u of [
    WATCH,
    `https://youtube.com/watch?v=${ID}&t=12s`,
    `http://m.youtube.com/watch?v=${ID}&feature=share`,
    `https://www.youtube.com/shorts/${ID}`,
    `https://youtube.com/shorts/${ID}?si=abc`,
    `https://m.youtube.com/shorts/${ID}`,
    `https://youtu.be/${ID}`,
    `https://youtu.be/${ID}?si=xyz`,
    `youtu.be/${ID}`,
    `www.youtube.com/shorts/${ID}`,
    `https://www.youtube-nocookie.com/embed/${ID}?start=3`,
    `  ${WATCH}  `,
  ])
    assert.deepEqual(normalizeYoutubeVideoUrl(u), { videoId: ID, url: WATCH }, u);
});

test("주소 — 영상이 아니면 null", () => {
  for (const u of [
    "",
    ID, // 맨 id 만 — 주소를 넣게 한다
    "https://www.youtube.com/@channel",
    "https://www.youtube.com/channel/UCxxxxxxxxxxxxxxxxxxxxxx",
    "https://www.youtube.com/playlist?list=PL123",
    "https://www.youtube.com/watch?v=short",
    "https://www.youtube.com/watch",
    "https://www.tiktok.com/@a/video/123",
    "https://evil.com/watch?v=dQw4w9WgXcQ",
    "https://youtube.com.evil.com/shorts/dQw4w9WgXcQ",
    "javascript:alert(1)",
    "ftp://youtube.com/watch?v=dQw4w9WgXcQ",
    "https://youtu.be/",
    `${WATCH} 다른 글`,
    null,
    42,
  ])
    assert.equal(normalizeYoutubeVideoUrl(u), null, String(u));
});

test("id · 재생기 주소", () => {
  assert.equal(cutIdOf(ID), `yt_${ID}`);
  assert.ok(isCutId(`yt_${ID}`));
  assert.ok(!isCutId(`yt_short`));
  assert.ok(!isCutId(ID));
  assert.equal(videoIdOfCut(`yt_${ID}`), ID);
  assert.equal(cutEmbedUrl(ID, 12.7, true), `https://www.youtube-nocookie.com/embed/${ID}?start=12&autoplay=1&rel=0&playsinline=1`);
  assert.equal(cutEmbedUrl(ID, -3, false), `https://www.youtube-nocookie.com/embed/${ID}?start=0&autoplay=0&rel=0&playsinline=1`);
});

const c = (from: unknown, to: unknown, shot = "장면", extra: Record<string, unknown> = {}) => ({ from, to, shot, speech: "", caption: "", sound: "", beat: "demo", ...extra });

test("다듬기 — 거꾸로 된 초 · 음수 · 순서", () => {
  const out = sanitizeCuts([c(5, 3, "셋째"), c(-2, 1.04, "첫째"), c(1.04, 3, "둘째")]);
  assert.deepEqual(
    out.map((x) => [x.from, x.to, x.shot]),
    [
      [0, 1, "첫째"],
      [1, 3, "둘째"],
      [3, 5, "셋째"],
    ],
  );
});

test("다듬기 — 겹침은 다음 컷 시작이 경계 · 틈은 그대로", () => {
  const out = sanitizeCuts([c(0, 2.5), c(2, 4), c(6, 8)]);
  assert.deepEqual(
    out.map((x) => [x.from, x.to]),
    [
      [0, 2],
      [2, 4],
      [6, 8],
    ],
  );
});

test("다듬기 — 같은 초에 시작하면 합치고, 한 점 컷은 다음 전환까지", () => {
  const out = sanitizeCuts([c(0, 2, "가", { speech: "안녕" }), c(0, 3, "나", { speech: "하세요" }), c(3, 3, "점"), c(5, 7, "끝")]);
  assert.equal(out.length, 3);
  assert.deepEqual([out[0].from, out[0].to, out[0].shot, out[0].speech], [0, 3, "가 / 나", "안녕 / 하세요"]);
  assert.deepEqual([out[1].from, out[1].to], [3, 5]);
});

test("다듬기 — 길이를 알면 그 안으로 · 끝 뒤 컷은 버림 · 마지막 한 점은 영상 끝까지", () => {
  const out = sanitizeCuts([c(0, 4), c(4, 12), c(15, 18, "넘침")], 10);
  assert.deepEqual(
    out.map((x) => [x.from, x.to]),
    [
      [0, 4],
      [4, 10],
    ],
  );
  const last = sanitizeCuts([c(0, 4), c(8, 8, "마지막")], 9.5);
  assert.deepEqual(last.at(-1), { from: 8, to: 9.5, shot: "마지막", speech: "", caption: "", sound: "", beat: "demo" });
});

test("다듬기 — 숫자 아님 · 빈 컷 · 이상한 역할 · 글자 길이 · 60개", () => {
  const out = sanitizeCuts([
    c("x", "y", "숫자 없음"),
    c(0, 1, ""),
    c(1, 2, "역할 이상", { beat: "intro" }),
    c(2, 3, "가".repeat(999), { speech: "나".repeat(999), caption: "다".repeat(999), sound: "라".repeat(999) }),
    "문자열",
    null,
  ]);
  assert.equal(out.length, 2);
  assert.equal(out[0].beat, null);
  assert.equal(out[1].shot.length, CUT_TEXT_MAX.shot);
  assert.equal(out[1].speech.length, CUT_TEXT_MAX.speech);
  assert.equal(out[1].caption.length, CUT_TEXT_MAX.caption);
  assert.equal(out[1].sound.length, CUT_TEXT_MAX.sound);
  const many = sanitizeCuts(Array.from({ length: 90 }, (_, i) => c(i, i + 1, `컷${i}`)));
  assert.equal(many.length, CUTS_MAX);
  assert.equal(sanitizeCuts("아님").length, 0);
});

test("다듬기 — 한 칸에 몰린 공백 · 줄바꿈은 한 칸으로", () => {
  const [x] = sanitizeCuts([c(0, 1, "  손이\n\n 컵을   집는다 ")]);
  assert.equal(x.shot, "손이 컵을 집는다");
});

test("AI 답 전체 — 길이를 모르면 AI 가 본 길이로 자른다", () => {
  const r = sanitizeCutResult({ hook: " 첫 장면 ", summary: "흐름", totalSec: 9, cuts: [c(0, 5), c(5, 20)] }, null);
  assert.equal(r.hook, "첫 장면");
  assert.equal(r.aiTotalSec, 9);
  assert.deepEqual(r.cuts.at(-1)?.to, 9);
  // YouTube 길이를 알면 그것이 우선
  const api = sanitizeCutResult({ totalSec: 9, cuts: [c(0, 5), c(5, 20)] }, 15);
  assert.equal(api.cuts.at(-1)?.to, 15);
  assert.equal(sanitizeCutResult({ totalSec: -1, cuts: [] }, null).aiTotalSec, null);
  assert.equal(sanitizeCutResult(null, null).cuts.length, 0);
});

const sheet: CutSheet = {
  id: `yt_${ID}`,
  owner: "a@x.com",
  createdAt: 1,
  updatedAt: 1,
  updatedBy: "a@x.com",
  videoId: ID,
  url: WATCH,
  title: "Glass fruit ASMR",
  channel: "Somebody",
  durationSec: 12,
  durationSrc: "api",
  cuts: [
    { from: 0, to: 2, shot: "유리 사과를 칼로 자른다", speech: "Watch this (뜻: 이거 봐)", caption: "", sound: "바삭 효과음", beat: "hook" },
    { from: 2, to: 12, shot: "조각을 손바닥에 올린다", speech: "", caption: "100% real?", sound: "", beat: null },
  ],
  cutCount: 2,
  hook: "칼이 유리 사과에 닿는 클로즈업",
  summary: "자르기 → 보여 주기",
  model: "google/gemini-3.7-flash",
  costUsd: 0.005,
  at: 1,
  by: "a@x.com",
  note: "",
};

test("길이 · 평균 컷", () => {
  assert.equal(cutSheetLength(sheet), 12);
  assert.equal(cutSheetLength({ durationSec: null, cuts: sheet.cuts }), 12);
  assert.equal(cutSheetLength({ durationSec: null, cuts: [] }), null);
  assert.equal(avgCutSec(sheet.cuts), 6);
  assert.equal(avgCutSec([]), null);
});

test("복사 글 — 머리 · 컷마다 화면 · 말 · 자막 · 소리 · 역할", () => {
  const t = cutSheetText(sheet, BEAT_LABEL);
  assert.match(t, /^\[컷 표\] Glass fruit ASMR — Somebody\n/);
  assert.match(t, /길이 약 12초 \(YouTube\) · 컷 2개 · 초는 AI 가 영상을 보고 적은 대략의 값/);
  assert.match(t, /1\. 0\.0~2\.0초 \(2\.0초\) · 후킹\n {3}화면: 유리 사과를 칼로 자른다\n {3}말: Watch this \(뜻: 이거 봐\)\n {3}소리: 바삭 효과음/);
  assert.match(t, /2\. 2\.0~12\.0초 \(10\.0초\)\n {3}화면: 조각을 손바닥에 올린다\n {3}자막: 100% real\?/);
  assert.ok(!t.includes("undefined"));
});

test("대본 참고 글 — 구조는 옮기고 내용은 새로 · 원본 말은 베끼지 말 것", () => {
  const t = cutReferenceText(sheet, BEAT_LABEL);
  assert.match(t, /^\[레퍼런스 영상 컷 표\] id=yt_dQw4w9WgXcQ/);
  assert.match(t, /구조\(컷 순서 · 컷마다의 길이 · 첫 2초 훅의 방식 · 컷마다의 역할\)는 옮기고/);
  assert.match(t, /그대로 베끼지 않는다/);
  assert.match(t, /평균 컷 6초/);
  assert.match(t, /1\. 0\.0~2\.0초\(2\.0초\) \[후킹\] \/ 화면 유리 사과를 칼로 자른다 \/ 원본 말\(베끼지 말 것\) Watch this/);
});

test("비용 어림 — 컷 표 실측(24초 $0.0095)을 길이로 늘린다 (모르면 30초)", () => {
  assert.equal(cutEstimateUsd(24), 0.0095);
  assert.ok(Math.abs(cutEstimateUsd(48) - 0.019) < 1e-9);
  assert.ok(Math.abs(cutEstimateUsd(21) - 0.0084) < 0.0002); // 21초 실측 $0.0084 와 거의 같다
  assert.equal(cutEstimateUsd(5), cutEstimateUsd(10)); // 10초 아래로는 안 내린다
  assert.ok(Math.abs(cutEstimateUsd(null) - (0.0095 * 30) / 24) < 1e-9);
  assert.equal(cutEstimateUsd(9999), (0.0095 * 600) / 24); // 10분에서 멈춘다
});
