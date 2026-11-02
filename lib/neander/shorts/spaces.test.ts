// AI STUDIO 프로젝트(채널 단위) — 순수 함수 검증 · npm run shorts:test
import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SPACE, DEFAULT_SPACE_ID, isSpaceId, newSpaceDefaults, sanitizeSpace, sortSpaces, spaceOf } from "./spaces";

test("프로젝트 소속 — spaceId 가 없으면 처음부터 있던 「살림설계사무소」", () => {
  assert.equal(spaceOf({}), DEFAULT_SPACE_ID);
  assert.equal(spaceOf({ spaceId: null }), DEFAULT_SPACE_ID);
  assert.equal(spaceOf({ spaceId: "" }), DEFAULT_SPACE_ID);
  assert.equal(spaceOf({ spaceId: "spabc123xy" }), "spabc123xy");
  assert.equal(spaceOf(null), DEFAULT_SPACE_ID);
  assert.ok(isSpaceId("salim") && isSpaceId("spabc123xy"));
  assert.ok(!isSpaceId("SP123") && !isSpaceId("sp12") && !isSpaceId("../x") && !isSpaceId("salim_x") && !isSpaceId(3));
});

test("프로젝트 다듬기 — 이름 필수 · 길이 · 고를 수 있는 값만 · 만든 사람은 그대로", () => {
  assert.throws(() => sanitizeSpace({ name: "   " }, null, "a@x", 1), /이름/);
  const a = sanitizeSpace({ name: "  뭉치의 쇼핑인생 ", description: "AI 스토리 광고", production: "ai", defaultKind: "brand", writerStyle: "story" }, null, "a@x", 100);
  assert.equal(a.name, "뭉치의 쇼핑인생"); // 앞뒤 빈칸만 떼고 가운데 빈칸은 그대로
  assert.equal(a.production, "ai");
  assert.equal(a.defaultKind, "coupang"); // brand 는 기본 종류가 될 수 없다
  assert.equal(a.writerStyle, "story");
  assert.equal(a.createdBy, "a@x");
  assert.equal(a.archived, false);
  const b = sanitizeSpace({ description: "x".repeat(2000), production: "weird", archived: true }, a, "b@x", 200);
  assert.equal(b.name, "뭉치의 쇼핑인생"); // 이름을 안 보내면 그대로
  assert.equal(b.description.length, 1000);
  assert.equal(b.production, "ai");
  assert.equal(b.archived, true);
  assert.equal(b.createdBy, "a@x");
  assert.equal(b.updatedBy, "b@x");
  assert.equal(sanitizeSpace({ name: "가".repeat(80) }, null, "a@x").name.length, 40);
});

test("새 프로젝트 기본값 · 목록 순서 — AI 생성이면 스토리 광고, 기본 프로젝트가 늘 맨 위", () => {
  assert.deepEqual(newSpaceDefaults("ai"), { production: "ai", writerStyle: "story" });
  assert.deepEqual(newSpaceDefaults("shoot"), { production: "shoot", writerStyle: "intro" });
  const list = sortSpaces([
    { ...DEFAULT_SPACE, id: "spbbbbbbbb", name: "B", order: 2, createdAt: 2 },
    { ...DEFAULT_SPACE, id: "spaaaaaaaa", name: "A", order: 1, createdAt: 5 },
    { ...DEFAULT_SPACE, id: DEFAULT_SPACE_ID, order: 9 },
  ]);
  assert.deepEqual(list.map((x) => x.id), [DEFAULT_SPACE_ID, "spaaaaaaaa", "spbbbbbbbb"]);
});
