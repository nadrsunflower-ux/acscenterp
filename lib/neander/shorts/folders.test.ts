// 영상 폴더 나무 · 개수 · 이름 규칙 — npm run shorts:test
import test from "node:test";
import assert from "node:assert/strict";
import { FOLDER_NAME_MAX, cleanFolderName, folderCounts, folderLabel, folderTree, inFolder } from "./folders";
import type { FolderView } from "./types";

const f = (id: string, name: string, parentId: string | null = null, createdAt = 1): FolderView => ({ id, name, parentId, createdBy: "a@x.com", createdAt, updatedAt: createdAt });

// 살림 ├ 주방 ┬ 2화 (10) / 1화 (2) — 이름순은 숫자를 숫자로
//      │      └ …
//      └ 욕실
// 다이소
const folders = [f("salim", "살림"), f("kitchen", "주방", "salim"), f("ep10", "10화", "kitchen"), f("ep2", "2화", "kitchen"), f("bath", "욕실", "salim"), f("daiso", "다이소")];

test("폴더 나무: 부모 아래 이름순(숫자는 숫자로) · 경로 · 하위 · 깊이", () => {
  const t = folderTree(folders);
  assert.deepEqual((t.children.get(null) ?? []).map((x) => x.name), ["다이소", "살림"]);
  assert.deepEqual((t.children.get("kitchen") ?? []).map((x) => x.name), ["2화", "10화"]);
  assert.deepEqual(t.pathTo("ep2").map((x) => x.name), ["살림", "주방", "2화"]);
  assert.deepEqual([...t.subtree("salim")].sort(), ["bath", "ep10", "ep2", "kitchen", "salim"]);
  assert.equal(t.depthOf("ep2"), 3);
  assert.equal(t.depthOf("daiso"), 1);
});

test("폴더 나무: 부모가 없거나 고리가 생긴 폴더도 맨 위로 올려 빠지지 않는다", () => {
  const t = folderTree([f("a", "A", "b"), f("b", "B", "a"), f("lost", "고아", "gone")]);
  const top = (t.children.get(null) ?? []).map((x) => x.id).sort();
  assert.ok(top.includes("lost"), "부모가 지워진 폴더");
  assert.ok(top.includes("a") || top.includes("b"), "고리는 끊어서 맨 위로");
  assert.equal([...t.byId.keys()].length, 3);
  assert.ok(t.pathTo("a").length <= 2, "경로가 끝없이 돌지 않는다");
});

test("폴더 개수: 바로 안 · 하위 포함 · 폴더 밖 (없는 폴더를 가리키면 밖으로)", () => {
  const t = folderTree(folders);
  const c = folderCounts(t, [{ folderId: "ep2" }, { folderId: "ep2" }, { folderId: "kitchen" }, { folderId: "bath" }, { folderId: null }, { folderId: "deleted" }, {}]);
  assert.equal(c.direct.get("ep2"), 2);
  assert.equal(c.total.get("kitchen"), 3);
  assert.equal(c.total.get("salim"), 4);
  assert.equal(c.total.get("daiso"), 0);
  assert.equal(c.outside, 3);
  assert.equal(c.all, 7);
});

test("이 폴더의 영상인가 (하위 포함) · 보기 경로", () => {
  const t = folderTree(folders);
  assert.equal(inFolder(t, "ep2", "salim"), true);
  assert.equal(inFolder(t, "ep2", "bath"), false);
  assert.equal(inFolder(t, null, "salim"), false);
  assert.equal(inFolder(t, null, null), true, "전체 보기");
  assert.equal(folderLabel(t, "ep2"), "살림 › 주방 › 2화");
  assert.equal(folderLabel(t, "ep2", "salim"), "주방 › 2화", "지금 폴더 아래만");
  assert.equal(folderLabel(t, "ep2", "ep2"), "", "지금 폴더 바로 안이면 빈 칸");
  assert.equal(folderLabel(t, "gone"), "");
});

test("폴더 이름: 앞뒤 공백 · 줄바꿈 정리, 빈 이름 · 너무 긴 이름 · 슬래시 거절", () => {
  assert.equal(cleanFolderName("  다이소\n 1화  "), "다이소 1화");
  assert.throws(() => cleanFolderName("   "), /적어 주세요/);
  assert.throws(() => cleanFolderName("가".repeat(FOLDER_NAME_MAX + 1)), /이하/);
  assert.throws(() => cleanFolderName("a/b"), /쓸 수 없습니다/);
  assert.equal(cleanFolderName("가".repeat(FOLDER_NAME_MAX)).length, FOLDER_NAME_MAX);
});
