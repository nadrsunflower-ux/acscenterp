// 트렌드 노트 영상 · 사진 순수 함수 검증 — npm run shorts:test
import test from "node:test";
import assert from "node:assert/strict";
import {
  NOTE_IMAGES_MAX,
  aspectOf,
  captionTitle,
  editNoteImages,
  editNoteVideos,
  instagramMeasure,
  isTiktokShortUrl,
  noteVideoEmbedUrl,
  parseInstagramEmbed,
  parseNoteVideoUrl,
  sniffImageType,
  videoStatsLine,
  type NoteImage,
  type NoteVideo,
} from "./note-media";

test("영상 주소 — 유튜브 watch · shorts · youtu.be / 인스타 p · reel · 계정/p / 틱톡", () => {
  assert.deepEqual(parseNoteVideoUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=3"), { platform: "youtube", id: "dQw4w9WgXcQ", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", aspect: "16:9" });
  assert.equal(parseNoteVideoUrl("youtube.com/shorts/dQw4w9WgXcQ")?.aspect, "9:16");
  assert.equal(parseNoteVideoUrl("https://youtu.be/dQw4w9WgXcQ")?.id, "dQw4w9WgXcQ");
  assert.deepEqual(parseNoteVideoUrl("https://www.instagram.com/p/DeOxg-opuO0/?utm_source=ig_web_copy_link"), { platform: "instagram", id: "DeOxg-opuO0", url: "https://www.instagram.com/p/DeOxg-opuO0/", aspect: "4:5" });
  assert.deepEqual(parseNoteVideoUrl("https://instagram.com/reels/DfRtuwxpDTw"), { platform: "instagram", id: "DfRtuwxpDTw", url: "https://www.instagram.com/reel/DfRtuwxpDTw/", aspect: "9:16" });
  assert.equal(parseNoteVideoUrl("https://www.instagram.com/swayroom_studio/p/DdfkfFsJGGB/")?.id, "DdfkfFsJGGB");
  assert.deepEqual(parseNoteVideoUrl("https://www.tiktok.com/@some.one/video/7301234567890123456?lang=ko"), { platform: "tiktok", id: "7301234567890123456", url: "https://www.tiktok.com/@some.one/video/7301234567890123456", aspect: "9:16" });
  assert.equal(parseNoteVideoUrl("https://www.tiktok.com/embed/v2/7301234567890123456")?.url, "https://www.tiktok.com/embed/v2/7301234567890123456");
});

test("영상 주소 — 계정 · 채널 · 다른 사이트 · 이상한 글은 받지 않는다", () => {
  for (const bad of ["https://www.instagram.com/swayroom_studio/", "https://www.instagram.com/a/b/p/DeOxg-opuO0/", "https://www.youtube.com/@channel", "https://www.youtube.com/watch?v=short", "https://www.tiktok.com/@a", "https://example.com/p/abcdef", "javascript:alert(1)", "https://user:pw@www.instagram.com/p/DeOxg-opuO0/", "", 42, null]) {
    assert.equal(parseNoteVideoUrl(bad), null, String(bad));
  }
  assert.equal(isTiktokShortUrl("https://vt.tiktok.com/ZSabc123/"), true);
  assert.equal(isTiktokShortUrl("https://www.tiktok.com/@a/video/7301234567890123456"), false);
});

test("재생기 주소 — 공식 삽입 주소", () => {
  assert.equal(noteVideoEmbedUrl({ platform: "instagram", id: "DeOxg-opuO0" }), "https://www.instagram.com/p/DeOxg-opuO0/embed/");
  assert.match(noteVideoEmbedUrl({ platform: "youtube", id: "dQw4w9WgXcQ" }), /^https:\/\/www\.youtube-nocookie\.com\/embed\/dQw4w9WgXcQ\?/);
  assert.match(noteVideoEmbedUrl({ platform: "tiktok", id: "7301234567890123456" }), /^https:\/\/www\.tiktok\.com\/player\/v1\/7301234567890123456/);
});

test("인스타 재생기 높이 알림 — MEASURE 만 · 범위 밖은 무시", () => {
  assert.equal(instagramMeasure('{"details":{"height":708},"type":"MEASURE"}'), 708);
  assert.equal(instagramMeasure({ type: "MEASURE", details: { height: 433.4 } }), 433);
  assert.equal(instagramMeasure('{"details":{},"type":"LOADING"}'), null);
  assert.equal(instagramMeasure('{"details":{"height":99999},"type":"MEASURE"}'), null);
  assert.equal(instagramMeasure("not json"), null);
});

test("가로세로 — 가장 가까운 비율", () => {
  assert.equal(aspectOf(1920, 1080), "16:9");
  assert.equal(aspectOf(1080, 1920), "9:16");
  assert.equal(aspectOf(1080, 1350), "4:5");
  assert.equal(aspectOf(1000, 1000), "1:1");
  assert.equal(aspectOf(0, 10), null);
});

/** 인스타 삽입 화면 모양 — 스크립트 안에 「JSON 을 담은 글」 이 한 겹 더 감싸여 있다 */
function igPage(media: Record<string, unknown>) {
  const inner = JSON.stringify({ require: [["x", { gql_data: { shortcode_media: media } }]] });
  return `<html><script>requireLazy([],function(){s.handle({"define":[["cr:1",[],{"__rc":["A",null]},-1]],"require":[["X","y",null,[${JSON.stringify(inner)}]]]});});</script></html>`;
}

test("인스타 삽입 화면에서 숫자 읽기 — 두 번 풀어 shortcode_media", () => {
  const html = igPage({
    shortcode: "DeOxg-opuO0",
    video_view_count: 2382125,
    video_duration: 91.972,
    taken_at_timestamp: 1759900000,
    dimensions: { height: 1920, width: 1080 },
    owner: { id: "1", username: "swayroom_studio" },
    edge_liked_by: { count: 90788 },
    edge_media_to_comment: { count: 310 },
    edge_media_to_caption: { edges: [{ node: { text: '화해 #제작지원 #광고\n\n(W)Bag: @erialcarob "MUMU"' } }] },
  });
  const m = parseInstagramEmbed(html);
  assert.ok(m);
  assert.equal(m.views, 2382125);
  assert.equal(m.likes, 90788);
  assert.equal(m.comments, 310);
  assert.equal(m.durationSec, 91.972);
  assert.equal(m.publishedAt, 1759900000 * 1000);
  assert.equal(m.username, "swayroom_studio");
  assert.match(m.caption, /"MUMU"/);
  assert.equal(captionTitle(m.caption), "화해");
  assert.equal(videoStatsLine({ ...m, by: "@swayroom_studio" }), "조회 2,382,125 · 좋아요 90,788 · 댓글 310 · 1분 32초 · 2025-10-08 올림 · @swayroom_studio");
});

test("인스타 — 로그인 화면 · 모양이 다르면 null (지어내지 않는다)", () => {
  assert.equal(parseInstagramEmbed("<html><title>Login • Instagram</title></html>"), null);
  assert.equal(parseInstagramEmbed('<script>x("shortcode_media" broken</script>'), null);
  assert.equal(parseInstagramEmbed(igPage({ shortcode: "abcde" })), null);
});

test("숫자 한 줄 — 모르는 칸은 뺀다 (0 은 남긴다)", () => {
  assert.equal(videoStatsLine({ views: 0, likes: null, durationSec: 18.2 }), "조회 0 · 18초");
  assert.equal(videoStatsLine({}), "");
  assert.equal(captionTitle("#광고 #협찬\n\n  첫 만남 #제작지원"), "첫 만남");
});

const vid = (id: string, label = ""): NoteVideo => ({ platform: "instagram", id, url: `https://www.instagram.com/p/${id}/`, label, aspect: "4:5", stats: "조회 1", addedAt: 1 });

test("영상 목록 고치기 — 순서 · 설명 · 비율만, 빠진 것은 지움, 새 영상 · 겹침은 무시", () => {
  const prev = [vid("aaaaa", "가"), vid("bbbbb", "나")];
  const next = editNoteVideos(
    [
      { platform: "instagram", id: "bbbbb", label: "  나 고침  ", aspect: "16:9", stats: "조작", url: "https://evil" },
      { platform: "instagram", id: "zzzzz", label: "새 것" },
      { platform: "instagram", id: "bbbbb", label: "겹침" },
    ],
    prev,
  );
  assert.deepEqual(next, [{ ...prev[1], label: "나 고침", aspect: "16:9" }]);
  assert.equal(editNoteVideos("x", prev), prev);
});

const img = (id: string, caption = ""): NoteImage => ({ id, name: `${id}.jpg`, type: "image/jpeg", w: 10, h: 10, size: 100, caption, at: 1, by: "a@x" });

test("사진 목록 고치기 — 순서 · 설명만, 빠진 사진은 뒤에 남긴다 (원본 지우기는 따로)", () => {
  const prev = [img("p1", "하나"), img("p2"), img("p3")];
  const next = editNoteImages([{ id: "p3", caption: "셋 " }, { id: "nope" }, { id: "p1" }], prev);
  assert.deepEqual(
    next.map((x) => [x.id, x.caption]),
    [
      ["p3", "셋"],
      ["p1", "하나"],
      ["p2", ""],
    ],
  );
  assert.ok(NOTE_IMAGES_MAX >= 10);
});

test("그림 형식 — 바이트 첫머리로", () => {
  assert.equal(sniffImageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), "image/jpeg");
  assert.equal(sniffImageType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), "image/png");
  assert.equal(sniffImageType(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])), "image/webp");
  assert.equal(sniffImageType(new Uint8Array([0x3c, 0x73, 0x76, 0x67])), null);
});
