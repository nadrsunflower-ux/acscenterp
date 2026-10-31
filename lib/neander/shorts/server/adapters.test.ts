// 외부 API 어댑터 검증 — 모든 외부 호출은 모의 응답이다 (실제 게시 · 유료 생성 없음).
//   npm run shorts:test
import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import * as P from "./platforms";
import * as C from "./coupang";
import * as A from "./ai";
import * as Y from "./youtube-data";
import * as S from "./secret";

// 어댑터는 환경변수를 부를 때마다 읽는다 — import 뒤에 넣어도 된다

process.env.NEANDER_SHORTS_TOKEN_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.OPENROUTER_API_KEY = "test-openrouter-key";
process.env.NEANDER_SHORTS_COUPANG_ACCESS_KEY = "test-access";
process.env.NEANDER_SHORTS_COUPANG_SECRET_KEY = "test-secret";
process.env.NEANDER_SHORTS_YOUTUBE_API_KEY = "test-yt-key";
process.env.NEANDER_SHORTS_GOOGLE_CLIENT_ID = "gid";
process.env.NEANDER_SHORTS_GOOGLE_CLIENT_SECRET = "gsecret";
process.env.NEANDER_SHORTS_META_APP_ID = "123";
process.env.NEANDER_SHORTS_META_APP_SECRET = "msecret";


type Call = { url: string; init: RequestInit };
const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", ...headers } });

function mock(handler: (url: string, init: RequestInit, n: number) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const f = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    calls.push({ url: String(input), init });
    return handler(String(input), init, calls.length);
  }) as typeof fetch;
  P.setPlatformFetch(f);
  C.setCoupangFetch(f);
  A.setAiFetch(f);
  Y.setYoutubeDataFetch(f);
  return calls;
}
const restore = () => {
  P.setPlatformFetch(null);
  C.setCoupangFetch(null);
  A.setAiFetch(null);
  Y.setYoutubeDataFetch(null);
};

const ytInput = () => ({
  bytes: new Uint8Array([1, 2, 3, 4, 5]),
  mime: "video/mp4",
  title: "테스트 쇼츠",
  description: "이 포스팅은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.",
  privacy: "private" as const,
  madeForKids: false,
  containsSyntheticMedia: true,
});

test("YouTube: 재개 가능한 세션 → 바이트 전송, 필수 항목(아동용 · 합성 표시)을 그대로 보낸다", async () => {
  const calls = mock((url, init, n) => {
    if (n === 1) {
      assert.match(url, /uploadType=resumable/);
      const body = JSON.parse(String(init.body));
      assert.equal(body.status.privacyStatus, "private");
      assert.equal(body.status.selfDeclaredMadeForKids, false);
      assert.equal(body.status.containsSyntheticMedia, true);
      assert.ok(body.snippet.description.startsWith("이 포스팅은 쿠팡 파트너스"));
      return new Response(null, { status: 200, headers: { Location: "https://www.googleapis.com/upload/youtube/v3/videos?upload_id=s1" } });
    }
    assert.equal(init.method, "PUT");
    assert.equal((init.headers as Record<string, string>)["Content-Range"], "bytes 0-4/5");
    return json({ id: "abcDEF12345", status: { uploadStatus: "uploaded", privacyStatus: "private" } }, 201);
  });
  try {
    const r = await P.uploadYouTube("access-token", ytInput());
    assert.equal(r.id, "abcDEF12345");
    assert.equal(r.url, "https://www.youtube.com/shorts/abcDEF12345");
    assert.equal(calls.length, 2);
  } finally {
    restore();
  }
});

test("YouTube: 전송 중 연결이 끊기면 uncertain — 자동 재시도 없음 · 토큰이 오류에 안 나옴", async () => {
  const calls = mock((_u, _i, n) => {
    if (n === 1) return new Response(null, { headers: { Location: "https://www.googleapis.com/upload/youtube/v3/videos?upload_id=s1" } });
    throw new Error("socket hang up access-token-SECRET");
  });
  try {
    await assert.rejects(P.uploadYouTube("access-token-SECRET", ytInput()), (e: unknown) => {
      assert.ok(e instanceof P.PublishingError);
      assert.equal(e.uncertain, true);
      assert.doesNotMatch(e.message, /SECRET/);
      return true;
    });
    assert.equal(calls.length, 2, "다시 보내지 않았다");
  } finally {
    restore();
  }
});

test("YouTube: 세션 단계 400 은 확실한 실패 (uncertain=false · 다시 시도 가능)", async () => {
  mock(() => json({ error: { code: 400, errors: [{ reason: "invalidTitle" }] } }, 400));
  try {
    await assert.rejects(P.uploadYouTube("t", ytInput()), (e: unknown) => e instanceof P.PublishingError && e.uncertain === false && e.providerCode === "400");
  } finally {
    restore();
  }
});

test("YouTube: 업로드 주소가 googleapis 가 아니면 바이트를 보내지 않는다", async () => {
  const calls = mock(() => new Response(null, { headers: { Location: "https://evil.example/upload" } }));
  try {
    await assert.rejects(P.uploadYouTube("t", ytInput()), /업로드 주소/);
    assert.equal(calls.length, 1);
  } finally {
    restore();
  }
});

test("Instagram: 컨테이너(resumable · is_ai_generated) → rupload 헤더 → 상태 → 게시", async () => {
  const calls = mock((url, init, n) => {
    if (n === 1) {
      assert.match(url, /graph\.facebook\.com\/v26\.0\/17841400000000000\/media$/);
      const b = JSON.parse(String(init.body));
      assert.equal(b.media_type, "REELS");
      assert.equal(b.upload_type, "resumable");
      assert.equal(b.is_ai_generated, true);
      return json({ id: "9001", uri: "https://rupload.facebook.com/ig-api-upload/v26.0/9001" });
    }
    if (n === 2) {
      const h = init.headers as Record<string, string>;
      assert.equal(h.Authorization, "OAuth page-token");
      assert.equal(h.offset, "0");
      assert.equal(h.file_size, "5");
      return json({ success: true });
    }
    if (n === 3) return json({ status_code: "FINISHED" });
    if (n === 4) {
      assert.match(url, /media_publish$/);
      return json({ id: "1800001" });
    }
    return json({ permalink: "https://www.instagram.com/reel/XYZ/" });
  });
  try {
    const c = await P.instagramCreateContainer("page-token", "17841400000000000", { caption: "고지", isAiGenerated: true });
    await P.instagramUploadBytes("page-token", c.uploadUri, new Uint8Array(5), "video/mp4");
    assert.equal(await P.instagramContainerStatus("page-token", c.containerId), "FINISHED");
    const r = await P.instagramPublish("page-token", "17841400000000000", c.containerId);
    assert.equal(r.id, "1800001");
    assert.equal(await P.instagramPermalink("page-token", r.id), "https://www.instagram.com/reel/XYZ/");
    assert.equal(calls.length, 5);
  } finally {
    restore();
  }
});

test("Instagram: 게시 요청 응답이 5xx 면 uncertain, WebM 은 보내지 않는다", async () => {
  mock(() => json({ error: { code: 1, message: "x" } }, 500));
  try {
    await assert.rejects(P.instagramPublish("t", "1234567", "7654321"), (e: unknown) => e instanceof P.PublishingError && e.uncertain === true);
    await assert.rejects(P.instagramUploadBytes("t", "https://rupload.facebook.com/ig-api-upload/v26.0/1", new Uint8Array(3), "video/webm"), /MP4/);
  } finally {
    restore();
  }
});

test("Google · Meta 동의 화면 주소: 범위 · offline · state", () => {
  const g = new URL(P.googleAuthUrl("https://x.example/cb", "state123"));
  assert.equal(g.searchParams.get("access_type"), "offline");
  assert.equal(g.searchParams.get("state"), "state123");
  assert.match(g.searchParams.get("scope")!, /youtube\.upload/);
  const m = new URL(P.metaAuthUrl("https://x.example/cb", "s2"));
  assert.match(m.pathname, /v26\.0\/dialog\/oauth/);
  assert.match(m.searchParams.get("scope")!, /instagram_content_publish/);
});

test("쿠팡: HMAC 서명은 문서 형식 (CEA · signed-date yyMMddTHHmmssZ · dt+METHOD+path+query)", () => {
  const now = new Date(Date.UTC(2026, 9, 31, 4, 5, 6));
  assert.equal(C.signedDate(now), "261031T040506Z");
  const path = "/v2/providers/affiliate_open_api/apis/openapi/v1/products/search";
  const query = "keyword=%EC%84%A0%EB%B0%98&limit=10";
  const h = C.authorization("GET", path, query, "AK", "SK", now);
  const expect = createHmac("sha256", "SK").update(`261031T040506ZGET${path}${query}`).digest("hex");
  assert.equal(h, `CEA algorithm=HmacSHA256, access-key=AK, signed-date=261031T040506Z, signature=${expect}`);
});

test("쿠팡: 검색 요청 경로 · 응답 매핑, 429 는 하루 차단 안내", async () => {
  mock((url, init, n) => {
    if (n === 1) {
      const u = new URL(url);
      assert.equal(u.host, "api-gateway.coupang.com");
      assert.equal(u.pathname, "/v2/providers/affiliate_open_api/apis/openapi/v1/products/search");
      assert.equal(u.searchParams.get("keyword"), "선반");
      assert.match((init.headers as Record<string, string>).Authorization, /^CEA algorithm=HmacSHA256, access-key=test-access/);
      return json({ rCode: "0", data: { landingUrl: "https://link.coupang.com/re/x", productData: [{ productId: 77, productName: "접이식 선반", productPrice: 12900, productImage: "https://img", productUrl: "https://link.coupang.com/re/p", isRocket: true }] } });
    }
    return json({ rCode: "429" }, 429);
  });
  try {
    const creds = { accessKey: "test-access", secretKey: "test-secret" };
    const r = await C.coupangSearch(creds, "선반");
    assert.equal(r.items[0].productId, "77");
    assert.equal(r.items[0].productPrice, 12900);
    await assert.rejects(C.coupangSearch(creds, "선반"), /24시간/);
  } finally {
    restore();
  }
});

test("OpenRouter 영상: 응답을 못 받은 생성 요청은 uncertain, 거절(400)은 확실한 실패", async () => {
  mock((url, init, n) => {
    if (n === 1) throw new Error("timeout");
    if (n === 2) return json({ error: { message: "bad prompt" } }, 400);
    if (n === 3) {
      const b = JSON.parse(String(init.body));
      assert.equal(b.aspect_ratio, "9:16");
      assert.equal(b.generate_audio, false);
      return json({ id: "vid_1", status: "pending" }, 202);
    }
    if (n === 4) return json({ status: "completed", usage: { cost: 0.4 } });
    return new Response(new Uint8Array([0, 0, 0, 24]), { headers: { "Content-Type": "video/mp4" } });
  });
  try {
    const input = { model: "google/veo-3.1-lite", prompt: "a rack", duration: 8, resolution: "720p" };
    await assert.rejects(A.submitVideo(input), (e: unknown) => e instanceof A.ProviderWriteError && e.uncertain === true);
    await assert.rejects(A.submitVideo(input), (e: unknown) => e instanceof A.ProviderWriteError && e.uncertain === false);
    const s = await A.submitVideo(input);
    assert.equal(s.id, "vid_1");
    const p = await A.pollVideo("vid_1");
    assert.equal(p.status, "completed");
    assert.equal(p.costUsd, 0.4);
    const d = await A.downloadVideo("vid_1");
    assert.equal(d.mime, "video/mp4");
    await assert.rejects(A.submitVideo({ ...input, duration: 7 }), /4 · 6 · 8초/);
  } finally {
    restore();
  }
});

test("OpenRouter 음성: /audio/speech 에 mp3 · 한국어 목소리, 바이트를 그대로 받는다", async () => {
  mock((url, init) => {
    assert.match(url, /\/api\/v1\/audio\/speech$/);
    const b = JSON.parse(String(init.body));
    assert.equal(b.voice, "ko-KR-Haena");
    assert.equal(b.response_format, "mp3");
    return new Response(new Uint8Array([0xff, 0xfb, 0x90]), { headers: { "Content-Type": "audio/mpeg" } });
  });
  try {
    const r = await A.synthesizeSpeech({ model: "microsoft/mai-voice-2.1", voice: "ko-KR-Haena", text: "안녕하세요" });
    assert.equal(r.mime, "audio/mpeg");
    assert.equal(r.bytes.length, 3);
    assert.ok((r.estUsd ?? 0) > 0);
    await assert.rejects(A.synthesizeSpeech({ model: "microsoft/mai-voice-2.1", voice: "en-US-x", text: "a" }), /목소리/);
  } finally {
    restore();
  }
});

test("OpenRouter 글: 대본만 있으면 AI 가 채운 시각을 버린다 (추측 금지) · URL 미열람", async () => {
  mock(() =>
    json({
      choices: [
        {
          message: {
            content: JSON.stringify({
              totalSec: 30,
              productRevealSec: 5,
              avgShotSec: 1.5,
              cutCount: 20,
              hookPattern: "결과부터",
              narrationSubtitle: "same",
              beats: [{ key: "hook", label: "후킹", startSec: 0, endSec: 2, summary: "s", pattern: "{상품}" }],
              cta: { type: "comment_keyword", keyword: "선반", wording: "댓글", atSec: 28 },
              notes: "",
            }),
          },
        },
      ],
      usage: { cost: 0.0021 },
    }),
  );
  try {
    const r = await A.analyzeReference({ model: null, product: "선반", transcript: "대본 글", timing: "", refs: [{ url: "https://youtube.com/watch?v=x", title: "" }] });
    assert.deepEqual(r.analysis.basis, ["transcript"]);
    assert.equal(r.analysis.urlRead, false);
    assert.equal(r.analysis.totalSec, null);
    assert.equal(r.analysis.beats[0].startSec, null);
    assert.equal(r.costUsd, 0.0021);
    await assert.rejects(A.analyzeReference({ model: null, product: "x", transcript: "", timing: "", refs: [{ url: "https://y", title: "" }] }), /URL 만으로는/);
  } finally {
    restore();
  }
});

test("YouTube 검색: 숨긴 좋아요 · 꺼진 댓글은 0 이 아니라 null", async () => {
  mock((url) => {
    if (url.includes("/search?")) {
      const u = new URL(url);
      assert.equal(u.searchParams.get("videoDuration"), "short");
      assert.equal(u.searchParams.get("regionCode"), "US");
      return json({ items: [{ id: { videoId: "aaaaaaaaaaa" } }] });
    }
    return json({ items: [{ id: "aaaaaaaaaaa", snippet: { title: "t", channelTitle: "c", publishedAt: "2026-10-01T00:00:00Z" }, statistics: { viewCount: "1000" }, contentDetails: { duration: "PT28S" } }] });
  });
  try {
    const r = await Y.youtubeSearch({ query: "rack", regionCode: "US", language: "en", days: 30, max: 10 });
    assert.equal(r[0].views, 1000);
    assert.equal(r[0].likes, null);
    assert.equal(r[0].comments, null);
    assert.equal(r[0].duration, 28);
  } finally {
    restore();
  }
});

test("토큰 암호화: 다른 계정 문서에 옮겨 붙이면 풀리지 않는다", () => {
  const sealed = S.sealTokens({ refreshToken: "rt-secret" }, "youtube_UC1_abc");
  assert.doesNotMatch(sealed, /rt-secret/);
  assert.equal(S.openTokens<{ refreshToken: string }>(sealed, "youtube_UC1_abc").refreshToken, "rt-secret");
  assert.throws(() => S.openTokens(sealed, "youtube_UC1_other"), /다시 연결/);
});
