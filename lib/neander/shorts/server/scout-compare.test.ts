// 감시 채널 「터진 영상 vs 평소」 AI — 요청 모양 · 받은 답 다듬기 (모의 응답 · 실제 호출 없음)
//   npx tsx --conditions react-server --test lib/neander/shorts/server/scout-compare.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import * as SA from "./scout-ai";
import type { CompareVideo } from "../scout";

process.env.OPENROUTER_API_KEY = "test-openrouter-key";

const vid = (id: string, multiple: number, extra: Partial<CompareVideo> = {}): CompareVideo => ({
  id,
  title: `제목 ${id}`,
  url: `https://www.youtube.com/watch?v=${id}`,
  thumbnail: `https://i.ytimg.com/vi/${id}/mqdefault.jpg`,
  views: 1000 * multiple,
  multiple,
  duration: 31,
  publishedAt: "2026-10-30T12:30:00Z",
  analyzed: false,
  ...extra,
});

test("터진 vs 평소: 썸네일은 i.ytimg 만 image_url(큰 것) · 분석 글 · 짧은 id · 숫자 되풀이 금지 규칙", async () => {
  let body = "";
  SA.setScoutAiFetch((async (_u: RequestInfo | URL, init: RequestInit = {}) => {
    body = String(init.body);
    const content = JSON.stringify({
      differences: [
        { aspect: "title", hit: "  제목 첫머리에 결과를 먼저 말한다  ", usual: "제품 이름으로 시작", strength: "clear", hitIds: ["h1", "[h2]", "zzz", "h1"], usualIds: ["u1", "h1", "AAAAAAAAAA3"] },
        { aspect: "nonsense", hit: "기타 차이", usual: "", strength: "clear", hitIds: ["h9"], usualIds: [] }, // 근거 없음 → 약함 · 모르는 aspect → 기타
        { aspect: "thumbnail", hit: "", usual: "빈 차이", strength: "weak", hitIds: [], usualIds: [] }, // 터진 쪽 글이 없으면 버린다
      ],
      tryNext: ["첫 1초에 결과 화면", "제목에 숫자", "썸네일 글자 크게", "넷째는 버린다"],
      caveat: "영상을 보지 않았다",
    });
    return new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: "stop" }], usage: { cost: 0.0123 } }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch);
  try {
    const r = await SA.compareChannelVideos({
      channel: { title: "살림 채널", country: "KR", topics: ["살림"] },
      threshold: 3,
      hits: [
        { ...vid("AAAAAAAAAA1", 9), analysis: { formatName: "결과 먼저", hook: "완성된 서랍을 먼저 보여 준다", structure: ["결과", "과정", "가격"] } },
        vid("AAAAAAAAAA2", 4, { thumbnail: "https://evil.example.com/x.jpg" }),
      ],
      usual: [vid("AAAAAAAAAA3", 1), vid("AAAAAAAAAA4", 0.9)],
    });
    const b = JSON.parse(body);
    assert.equal(b.model, "google/gemini-3.7-flash");
    assert.equal(b.response_format.json_schema.strict, true);
    assert.match(b.messages[0].content, /숫자를 글에 다시 쓰지 않는다/);
    const parts = b.messages[1].content as { type: string; text?: string; image_url?: { url: string } }[];
    const imgs = parts.filter((p) => p.type === "image_url").map((p) => p.image_url!.url);
    assert.deepEqual(imgs, ["https://i.ytimg.com/vi/AAAAAAAAAA1/hqdefault.jpg", "https://i.ytimg.com/vi/AAAAAAAAAA3/hqdefault.jpg", "https://i.ytimg.com/vi/AAAAAAAAAA4/hqdefault.jpg"]);
    const text = parts.filter((p) => p.type === "text").map((p) => p.text).join("\n");
    assert.match(text, /\[h1\] 터진 · 평소의 9배 · 길이 31초 · 올린 때 금 21시\(한국\)/);
    assert.match(text, /형식 분석\(AI 가 영상을 보고 쓴 글\): 결과 먼저 · 훅 완성된 서랍을 먼저 보여 준다 · 흐름 결과 → 과정 → 가격/);
    assert.match(text, /\[u2\] 평소 · 평소의 0\.9배/);

    assert.equal(r.costUsd, 0.0123);
    assert.equal(r.ai.differences.length, 2);
    const [d1, d2] = r.ai.differences;
    assert.equal(d1.hit, "제목 첫머리에 결과를 먼저 말한다");
    assert.deepEqual(d1.hitIds, ["AAAAAAAAAA1", "AAAAAAAAAA2"]); // 짧은 id → 영상 id · 지어낸 것 · 겹친 것 버림
    assert.deepEqual(d1.usualIds, ["AAAAAAAAAA3"]); // 평소 쪽에 터진 id 를 넣으면 버린다 · 영상 id 그대로도 받는다
    assert.equal(d1.strength, "clear");
    assert.equal(d2.aspect, "other");
    assert.equal(d2.strength, "weak");
    assert.deepEqual(r.ai.tryNext, ["첫 1초에 결과 화면", "제목에 숫자", "썸네일 글자 크게"]);
    assert.equal(r.ai.caveat, "영상을 보지 않았다");
  } finally {
    SA.setScoutAiFetch(null);
  }
});

test("터진 vs 평소: 한쪽이 비면 AI 를 부르지 않는다", async () => {
  let called = false;
  SA.setScoutAiFetch((async () => {
    called = true;
    return new Response("{}");
  }) as typeof fetch);
  try {
    await assert.rejects(SA.compareChannelVideos({ channel: { title: "c", country: "", topics: [] }, threshold: 3, hits: [vid("AAAAAAAAAA1", 5)], usual: [] }), /모두 있어야/);
    assert.equal(called, false);
  } finally {
    SA.setScoutAiFetch(null);
  }
});
