// 완성 파일 게시 — YouTube 나눠 보내기 · Instagram 주소로 가져가기 · 게시 뒤 지우기 규칙.
// 모든 외부 호출은 모의 응답이다 (실제 게시 없음).   npm run shorts:test
import test from "node:test";
import assert from "node:assert/strict";
import * as P from "./platforms";
import { INSTAGRAM_MAX_BYTES, PUBLISHED_GRACE_MS, RENDER_KEEP_MS, canExpireRender, canPurgeAfterPublish, shouldPurgeRender } from "../model";

type Call = { url: string; init: RequestInit };
const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", ...headers } });
const resume = (lastByte: number | null) => new Response(null, { status: 308, headers: lastByte === null ? {} : { Range: `bytes=0-${lastByte}` } });

function mock(handler: (url: string, init: RequestInit, n: number) => Response | Promise<Response>) {
  const calls: Call[] = [];
  P.setPlatformFetch((async (input: RequestInfo | URL, init: RequestInit = {}) => {
    calls.push({ url: String(input), init });
    return handler(String(input), init, calls.length);
  }) as typeof fetch);
  return calls;
}
const restore = () => P.setPlatformFetch(null);
const header = (init: RequestInit, name: string) => (init.headers as Record<string, string>)[name];

const SESSION = "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&upload_id=abc";
const KB256 = 256 * 1024;
const meta = { mime: "video/mp4", title: "다이소 정리템", description: "설명", privacy: "private" as const, madeForKids: false, containsSyntheticMedia: false };

test("YouTube 나눠 보내기: 세션 → 물어보기 → 조각 → 물어보기 → 마지막 조각 → 영상 id", async () => {
  const size = KB256 + 10;
  const calls = mock((url, init, n) => {
    if (n === 1) {
      assert.match(url, /uploadType=resumable/);
      assert.equal(header(init, "X-Upload-Content-Length"), String(size));
      return new Response(null, { headers: { Location: SESSION } });
    }
    if (n === 2) {
      assert.equal(header(init, "Content-Range"), `bytes */${size}`);
      return resume(null); // 아직 아무것도 안 받음
    }
    if (n === 3) {
      assert.equal(header(init, "Content-Range"), `bytes 0-${KB256 - 1}/${size}`);
      return resume(KB256 - 1);
    }
    if (n === 4) return resume(KB256 - 1);
    assert.equal(header(init, "Content-Range"), `bytes ${KB256}-${size - 1}/${size}`);
    return json({ id: "vidABC12345", status: { uploadStatus: "uploaded", privacyStatus: "private" } }, 201);
  });
  try {
    const session = await P.youtubeStartSession("tok", { ...meta, size });
    assert.equal(session, SESSION);
    let st = await P.youtubeUploadStatus("tok", session, size);
    assert.deepEqual(st, { done: false, offset: 0 });
    st = await P.youtubePutChunk("tok", session, 0, new Uint8Array(KB256), size, "video/mp4");
    assert.deepEqual(st, { done: false, offset: KB256 });
    st = await P.youtubeUploadStatus("tok", session, size);
    assert.equal(st.done, false);
    st = await P.youtubePutChunk("tok", session, KB256, new Uint8Array(10), size, "video/mp4");
    assert.equal(st.done, true);
    assert.equal(st.done && st.id, "vidABC12345");
    assert.equal(st.done && st.url, "https://www.youtube.com/shorts/vidABC12345");
    assert.equal(calls.length, 5);
  } finally {
    restore();
  }
});

test("YouTube: 마지막 응답을 놓쳐도 다음 물음에 영상 id 가 온다 — 다시 보내지 않는다", async () => {
  const calls = mock(() => json({ id: "vidLOST1234", status: { uploadStatus: "uploaded", privacyStatus: "private" } }, 200));
  try {
    const st = await P.youtubeUploadStatus("tok", SESSION, 1000);
    assert.equal(st.done, true);
    assert.equal(st.done && st.id, "vidLOST1234");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].init.body ?? null, null, "상태 확인은 바이트를 보내지 않는다");
  } finally {
    restore();
  }
});

test("YouTube: 끊김 · 5xx · 429 는 다시 물으면 되는 오류 (uncertain 아님) · 토큰이 오류에 안 나온다", async () => {
  mock(() => {
    throw new Error("socket hang up tok-SECRET");
  });
  try {
    await assert.rejects(P.youtubePutChunk("tok-SECRET", SESSION, 0, new Uint8Array(10), 10, "video/mp4"), (e: unknown) => {
      assert.ok(e instanceof P.PublishingError);
      assert.equal(e.code, P.YT_RETRY);
      assert.equal(e.uncertain, false);
      assert.doesNotMatch(e.message, /SECRET/);
      return true;
    });
  } finally {
    restore();
  }
  for (const status of [500, 503, 429]) {
    mock(() => json({ error: { code: status } }, status));
    try {
      await assert.rejects(P.youtubeUploadStatus("t", SESSION, 10), (e: unknown) => e instanceof P.PublishingError && e.code === P.YT_RETRY);
    } finally {
      restore();
    }
  }
});

test("YouTube: 세션 만료(404)는 확실한 실패 · 401 은 다시 연결", async () => {
  mock(() => json({ error: { code: 404 } }, 404));
  try {
    await assert.rejects(P.youtubeUploadStatus("t", SESSION, 10), (e: unknown) => e instanceof P.PublishingError && e.code === "YOUTUBE_SESSION_EXPIRED" && !e.uncertain);
  } finally {
    restore();
  }
  mock(() => json({ error: { code: 401 } }, 401));
  try {
    await assert.rejects(P.youtubePutChunk("t", SESSION, 0, new Uint8Array(10), 10, "video/mp4"), (e: unknown) => e instanceof P.PublishingError && e.status === 401 && e.code !== P.YT_RETRY);
  } finally {
    restore();
  }
});

test("YouTube: 다 받았다는데 영상 id 가 없으면 결과 불명(uncertain) · 거절은 확실한 실패", async () => {
  mock(() => json({ status: {} }, 201));
  try {
    await assert.rejects(P.youtubeUploadStatus("t", SESSION, 10), (e: unknown) => e instanceof P.PublishingError && e.uncertain === true);
  } finally {
    restore();
  }
  mock(() => json({ id: "vidREJ12345", status: { uploadStatus: "rejected" } }, 200));
  try {
    await assert.rejects(P.youtubeUploadStatus("t", SESSION, 10), (e: unknown) => e instanceof P.PublishingError && e.status === 422 && !e.uncertain);
  } finally {
    restore();
  }
});

test("YouTube: 세션 주소가 googleapis 가 아니거나 조각 크기가 규칙에 안 맞으면 보내지 않는다", async () => {
  const calls = mock(() => json({}));
  try {
    await assert.rejects(P.youtubeUploadStatus("t", "https://evil.example/upload/youtube/x", 10), /업로드 주소/);
    // 마지막 조각이 아닌데 256KiB 의 배수가 아님
    await assert.rejects(P.youtubePutChunk("t", SESSION, 0, new Uint8Array(1000), 5000, "video/mp4"), /조각 크기/);
    // 파일 끝을 넘음
    await assert.rejects(P.youtubePutChunk("t", SESSION, 4990, new Uint8Array(20), 5000, "video/mp4"), /조각 크기/);
    assert.equal(calls.length, 0);
  } finally {
    restore();
  }
  assert.equal(P.YT_CHUNK_BYTES % KB256, 0, "조각 크기는 256KiB 의 배수");
  assert.equal(P.YT_CHUNK_BYTES % (768 * 1024), 0, "Firestore 조각(768KiB)의 배수");
});

test("Instagram: 저장소 파일은 video_url 로 컨테이너를 만든다 (rupload 없음)", async () => {
  const calls = mock((url, init) => {
    assert.match(url, /\/17841400000000000\/media$/);
    const b = JSON.parse(String(init.body));
    assert.equal(b.media_type, "REELS");
    assert.equal(b.video_url, "https://storage.googleapis.com/b/neander_shorts/media/x?X-Goog-Signature=s");
    assert.equal(b.upload_type, undefined);
    assert.equal(b.is_ai_generated, false);
    return json({ id: "9002" });
  });
  try {
    const c = await P.instagramCreateContainer("page-token", "17841400000000000", {
      caption: "캡션",
      isAiGenerated: false,
      videoUrl: "https://storage.googleapis.com/b/neander_shorts/media/x?X-Goog-Signature=s",
    });
    assert.deepEqual(c, { containerId: "9002", uploadUri: "" });
    assert.equal(calls.length, 1);
    await assert.rejects(P.instagramCreateContainer("t", "1234567", { caption: "c", isAiGenerated: false, videoUrl: "http://plain.example/v.mp4" }), /영상 주소/);
    assert.equal(calls.length, 1, "https 가 아니면 보내지 않는다");
  } finally {
    restore();
  }
});

test("게시 뒤 지우기: 하나 이상 게시됐고 나머지는 게시됨 · 취소일 때만", () => {
  assert.equal(canPurgeAfterPublish(["published"]), true);
  assert.equal(canPurgeAfterPublish(["published", "cancelled"]), true);
  assert.equal(canPurgeAfterPublish(["published", "published"]), true);
  assert.equal(canPurgeAfterPublish([]), false, "아무 데도 안 올렸으면 아직");
  assert.equal(canPurgeAfterPublish(["cancelled"]), false);
  assert.equal(canPurgeAfterPublish(["published", "failed"]), false, "실패한 채널은 다시 시도할 수 있어야 한다");
  assert.equal(canPurgeAfterPublish(["published", "uncertain"]), false);
  assert.equal(canPurgeAfterPublish(["published", "scheduled"]), false, "예약이 남았다");
  assert.equal(canPurgeAfterPublish(["published", "uploading"]), false);
});

test("게시 뒤 지울 때: 올릴 수 있는 채널에 다 올리면 바로, 일부만이면 하루 뒤", () => {
  const now = Date.UTC(2026, 10, 10);
  const yt = { status: "published" as const, platform: "youtube" as const, at: now - 60_000 };
  const ig = { status: "published" as const, platform: "instagram" as const, at: now - 30_000 };
  assert.equal(shouldPurgeRender({ pubs: [yt], platforms: ["youtube"], now }), true, "YouTube 만 연결 → 바로");
  assert.equal(shouldPurgeRender({ pubs: [yt], platforms: ["youtube", "instagram"], now }), false, "Instagram 에 마저 올릴 수 있게 남김");
  assert.equal(shouldPurgeRender({ pubs: [yt, ig], platforms: ["youtube", "instagram"], now }), true, "둘 다 올리면 바로");
  assert.equal(shouldPurgeRender({ pubs: [{ ...yt, at: now - PUBLISHED_GRACE_MS }], platforms: ["youtube", "instagram"], now }), true, "하루가 지나면 일부만 올렸어도");
  assert.equal(shouldPurgeRender({ pubs: [yt, { status: "failed", platform: "instagram", at: null }], platforms: ["youtube", "instagram"], now: now + 2 * PUBLISHED_GRACE_MS }), false, "실패가 남으면 다시 시도할 수 있게");
  assert.equal(shouldPurgeRender({ pubs: [], platforms: [], now }), false, "아무 데도 안 올렸으면 게시 뒤 규칙이 아니다");
});

test("7일 정리: 보내는 중 · 예약 · 고객 검토(대기 · 승인) 중이면 남긴다", () => {
  const now = Date.UTC(2026, 10, 10);
  const old = now - RENDER_KEEP_MS - 1;
  assert.equal(canExpireRender({ createdAt: now - RENDER_KEEP_MS + 60_000, statuses: [], inReview: false, now }), false, "7일 안");
  assert.equal(canExpireRender({ createdAt: old, statuses: [], inReview: false, now }), true);
  assert.equal(canExpireRender({ createdAt: old, statuses: ["failed"], inReview: false, now }), true, "실패한 지 오래 — 정리");
  assert.equal(canExpireRender({ createdAt: old, statuses: ["scheduled"], inReview: false, now }), false, "예약은 60일까지");
  assert.equal(canExpireRender({ createdAt: old, statuses: ["processing"], inReview: false, now }), false);
  assert.equal(canExpireRender({ createdAt: old, statuses: [], inReview: true, now }), false, "승인한 그 파일만 게시할 수 있다");
  assert.equal(INSTAGRAM_MAX_BYTES, 300 * 1024 * 1024);
});
