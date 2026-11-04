// AI STUDIO 프로젝트(채널 단위) — 순수 함수 검증 · npm run shorts:test
import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SPACE, DEFAULT_SPACE_ID, isSpaceId, isSpaceRunning, newSpaceDefaults, sanitizeSpace, sortSpaces, spaceAccounts, spaceOf } from "./spaces";

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

test("자체 운영 · 대행 — 대행은 업체가 있어야 하고, 만든 뒤엔 종류 · 업체를 바꾸지 않는다 · 관리자와 담당자만 본다", async () => {
  const { canSeeSpace, spaceKind } = await import("./spaces");
  assert.throws(() => sanitizeSpace({ name: "브랜드 A", kind: "agency" }, null, "a@x", 1), /업체/);
  const ag = sanitizeSpace({ name: "브랜드 A", kind: "agency", clientId: "client_abc1" }, null, "a@x", 1);
  assert.equal(spaceKind(ag), "agency");
  assert.equal(ag.clientId, "client_abc1");
  const own = sanitizeSpace({ name: "우리 채널", kind: "own", clientId: "client_abc1" }, null, "a@x", 1);
  assert.equal(spaceKind(own), "own");
  assert.equal(own.clientId, null); // 자체 운영엔 업체가 붙지 않는다
  const moved = sanitizeSpace({ kind: "own", clientId: "other_xyz9" }, ag, "b@x", 2);
  assert.equal(spaceKind(moved), "agency");
  assert.equal(moved.clientId, "client_abc1");
  assert.equal(spaceKind({}), "own"); // 예전 문서
  const members = (id: string) => (id === "client_abc1" ? ["m@x"] : undefined);
  assert.equal(canSeeSpace(own, "anyone@x", false, members), true);
  assert.equal(canSeeSpace(ag, "m@x", false, members), true);
  assert.equal(canSeeSpace(ag, "anyone@x", false, members), false);
  assert.equal(canSeeSpace(ag, "boss@x", true, members), true);
});

test("업체 재무 계약 코드 · 계약 기간", async () => {
  const { clientFinanceCodes, inContract } = await import("./agency");
  const base = { monthlyFeeKrw: null, vat: "excluded" as const, videosPerMonth: 8, revisionLimit: 2, startMonth: "2026-11", endMonth: "2027-04", note: "" };
  assert.deepEqual(clientFinanceCodes({ contract: { ...base, financeCode: "pj-2611-01", financeCodes: ["PJ-2611-01", "PJ-2612-03"] } }), ["PJ-2611-01", "PJ-2612-03"]);
  assert.deepEqual(clientFinanceCodes({ contract: { ...base, financeCode: "" } }), []);
  assert.equal(inContract({ contract: { ...base, financeCode: "" } }, "2026-12"), true);
  assert.equal(inContract({ contract: { ...base, financeCode: "" } }, "2027-05"), false);
  assert.equal(inContract({ contract: { ...base, financeCode: "", endMonth: null } }, "2030-01"), true);
});

test("운영 중 · 준비 중 — 이 프로젝트에 붙은 게시 계정이 있으면 운영 중", () => {
  const own = { id: "spabc123xy", kind: "own" as const };
  const agency = { id: "spagency12", kind: "agency" as const };
  const accounts = [
    { spaceId: "spabc123xy", clientId: null },
    { spaceId: "spagency12", clientId: "c1" },
    { spaceId: "spabc123xy", clientId: "c1" }, // 자체 운영 프로젝트에 잘못 붙은 고객사 계정 — 세지 않는다
    {}, // spaceId 없음 — 살림 것
  ];
  assert.equal(spaceAccounts(own, accounts).length, 1);
  assert.equal(spaceAccounts(agency, accounts).length, 1); // 대행은 고객사 계정까지
  assert.equal(isSpaceRunning({ id: DEFAULT_SPACE_ID, kind: "own" }, accounts), true);
  assert.equal(isSpaceRunning({ id: "spnochannel", kind: "own" }, accounts), false);
});
