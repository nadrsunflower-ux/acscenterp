// 조사 키워드 — 순수 함수 검증 · npm run shorts:test
import test from "node:test";
import assert from "node:assert/strict";
import { keywordGroupsOf, MAX_PROJECT_KEYWORDS, NAVER_KEYWORDS, sanitizeProjectKeywords } from "./keywords";
import { DEFAULT_KEYWORD_GROUPS } from "./market";

test("키워드 다듬기 — 빈칸 정리 · 겹침(띄어쓰기 · 대소문자 무시) 빼기 · 쉼표 · 줄바꿈 · 20개까지", () => {
  assert.deepEqual(sanitizeProjectKeywords(["  수능 도시락 ", "수능도시락", "보온 도시락", ""]), ["수능 도시락", "보온 도시락"]);
  assert.deepEqual(sanitizeProjectKeywords("다이소꿀템, Daiso\n다이소 꿀템,daiso"), ["다이소꿀템", "Daiso"]);
  assert.equal(sanitizeProjectKeywords(Array.from({ length: 30 }, (_, i) => `k${i}`)).length, MAX_PROJECT_KEYWORDS);
  assert.equal(sanitizeProjectKeywords(["가".repeat(60)])[0].length, 40);
  assert.deepEqual(sanitizeProjectKeywords(null), []);
});

test("키워드 → 네이버 묶음 — 앞 12개만 · 키워드 하나가 한 줄 · 이름이 같은 옛 묶음은 비슷한 말을 그대로", () => {
  const g = keywordGroupsOf(["다이소", "수능 도시락"], DEFAULT_KEYWORD_GROUPS);
  assert.equal(g.length, 2);
  // 살림 기본 묶음 「다이소」 — 네 검색어와 id 를 그대로 둔다
  assert.equal(g[0].id, "daiso");
  assert.deepEqual(g[0].keywords, DEFAULT_KEYWORD_GROUPS.find((x) => x.id === "daiso")!.keywords);
  // 새 키워드 — 자기 하나만
  assert.deepEqual(g[1].keywords, ["수능 도시락"]);
  assert.match(g[1].id, /^k[0-9a-z]+$/);
  // 같은 키워드는 늘 같은 id (네이버 추이 기록이 같은 자리에 쌓인다) · 띄어쓰기가 달라도 같다
  assert.equal(keywordGroupsOf(["수능도시락"], [])[0].id, g[1].id);
  assert.equal(keywordGroupsOf(Array.from({ length: 15 }, (_, i) => `k${i}`), []).length, NAVER_KEYWORDS);
});
