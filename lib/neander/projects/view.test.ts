import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeHiddenSections, pickOps, splitHiddenSections, toProjectView } from "./view";

const MEMO = [
  "■ 지금 상태",
  "견적 보냄",
  "",
  "■ 견적",
  "- 공급가액 1,000,000",
  "",
  "■ 원가 (내부용)",
  "- 실질 이익 500,000 (50%)",
  "- 회사 40% 기준 충족",
  "",
  "■ 파일",
  "- ~/Downloads/x.pdf",
].join("\n");

test("원가 구역을 빼고 보낸다", () => {
  const s = splitHiddenSections(MEMO, undefined);
  assert.equal(s.blocks.length, 1);
  assert.ok(!s.note!.includes("원가"));
  assert.ok(!s.note!.includes("실질 이익"));
  assert.equal(s.note, ["■ 지금 상태", "견적 보냄", "", "■ 견적", "- 공급가액 1,000,000", "", "■ 파일", "- ~/Downloads/x.pdf"].join("\n"));
});

test("원가 구역이 없으면 그대로", () => {
  const s = splitHiddenSections("그냥 메모", undefined);
  assert.equal(s.note, "그냥 메모");
  assert.equal(s.blocks.length, 0);
});

test("가린 구역을 저장할 때 제자리에 다시 넣는다", () => {
  const shown = splitHiddenSections(MEMO, undefined).note!;
  const edited = shown.replace("견적 보냄", "견적 보냄 · 회신 기다림");
  const merged = mergeHiddenSections({ note: edited, noteRich: undefined }, { note: MEMO, noteRich: undefined });
  assert.equal(merged.note, MEMO.replace("견적 보냄", "견적 보냄 · 회신 기다림"));
});

test("다음 제목을 지웠으면 끝에 붙인다", () => {
  const edited = ["■ 지금 상태", "견적 보냄"].join("\n");
  const merged = mergeHiddenSections({ note: edited, noteRich: undefined }, { note: MEMO, noteRich: undefined });
  assert.equal(merged.note, ["■ 지금 상태", "견적 보냄", "", "■ 원가 (내부용)", "- 실질 이익 500,000 (50%)", "- 회사 40% 기준 충족"].join("\n"));
});

test("메모 서식(굵게 · 형광)도 같이 빠지고 같이 돌아온다", () => {
  const lines = MEMO.split("\n");
  const rich = { v: 1 as const, lines: lines.map((l) => (l ? [{ t: l, ...(l.startsWith("■ ") ? { b: true as const } : {}) }] : [])) };
  const s = splitHiddenSections(MEMO, rich);
  assert.equal(s.noteRich!.lines.length, s.note!.split("\n").length);
  const merged = mergeHiddenSections({ note: s.note, noteRich: s.noteRich }, { note: MEMO, noteRich: rich });
  assert.equal(merged.note, MEMO);
  assert.deepEqual(merged.noteRich, rich);
});

test("재무 권한이 있으면 메모를 그대로 · 돈 칸은 누구에게도 싣지 않는다", () => {
  const doc = { id: "a", code: "PJ-1", name: "n", status: "planning", contractAmount: 5_000_000, revenues: [], lines: [{ id: "l", category: "x", item: "y", qty: 1 }], note: MEMO, createdAt: 1 } as never;
  const fin = toProjectView(doc, true);
  assert.equal(fin.note, MEMO);
  assert.equal(fin.hiddenSections, undefined);
  const team = toProjectView(doc, false);
  assert.equal(team.hiddenSections, 1);
  for (const v of [fin, team]) {
    assert.ok(!("contractAmount" in v));
    assert.ok(!("lines" in v));
    assert.ok(!("installments" in v));
  }
});

test("운영 칸만 받는다", () => {
  assert.deepEqual(pickOps({ note: "x", contractAmount: 1, lines: [], equipment: { photobooth: 1 } }), { note: "x", equipment: { photobooth: 1 } });
});
