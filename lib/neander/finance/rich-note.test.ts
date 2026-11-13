import assert from "node:assert/strict";
import { test } from "node:test";
import {
  colorKeyOf,
  fontKeyOf,
  hiliteKeyOf,
  plainToRich,
  reconcileNoteRich,
  richText,
  richToHtml,
  sanitizeNoteRich,
  sizeKeyOf,
  type NoteRich,
} from "./rich-note";
import { emptyProject, sanitizeProject } from "./project";

const rich = (lines: NoteRich["lines"]): NoteRich => ({ v: 1, lines });

test("sanitize keeps only known styles and splits nothing across lines", () => {
  const out = sanitizeNoteRich({
    v: 1,
    lines: [
      [{ t: "굵게", b: true, c: "red", h: "yellow", f: "serif", z: "l", x: "evil" }, { t: "<b>", c: "hotpink", h: "url(x)", b: "yes" }],
      "not-a-line",
      [{ t: "a\nb" }, { t: "" }, null],
    ],
  });
  assert.deepEqual(out, rich([[{ t: "굵게", b: true, c: "red", h: "yellow", f: "serif", z: "l" }, { t: "<b>" }], [], [{ t: "a b" }]]));
  assert.equal(sanitizeNoteRich({ v: 2, lines: [] }), undefined);
  assert.equal(sanitizeNoteRich("x"), undefined);
});

test("reconcile keeps formatting of unchanged lines when only the plain note changed", () => {
  const r = rich([[{ t: "제목", b: true }], [{ t: "그대로 " }, { t: "빨강", c: "red" }], [{ t: "지울 줄", h: "yellow" }], [{ t: "고칠 줄", i: true }]]);
  assert.equal(richText(r), "제목\n그대로 빨강\n지울 줄\n고칠 줄");
  const note = "새 첫 줄\n제목\n그대로 빨강\n고친 줄\n끝";
  const out = reconcileNoteRich(note, r)!;
  assert.equal(richText(out), note, "글자는 언제나 note 와 같다");
  assert.deepEqual(out.lines, [[{ t: "새 첫 줄" }], [{ t: "제목", b: true }], [{ t: "그대로 " }, { t: "빨강", c: "red" }], [{ t: "고친 줄" }], [{ t: "끝" }]]);
});

test("reconcile drops rich when nothing is formatted or the note is empty", () => {
  const r = rich([[{ t: "a", b: true }]]);
  assert.equal(reconcileNoteRich("b", r), undefined, "서식이 남는 줄이 없으면 버린다");
  assert.equal(reconcileNoteRich(undefined, r), undefined);
  assert.equal(reconcileNoteRich("a", rich([[{ t: "a" }]])), undefined);
  assert.deepEqual(reconcileNoteRich("a", r), r);
});

test("html escapes text and maps every style to css the editor can read back", () => {
  const html = richToHtml(rich([[{ t: "<script>alert(1)</script>", b: true, u: true, s: true, c: "blue", h: "pink", f: "mono", z: "xl" }], []]));
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes("&lt;script&gt;"));
  assert.match(html, /font-weight:700/);
  assert.match(html, /text-decoration-line:underline line-through/);
  assert.match(html, /font-size:21px/);
  assert.ok(html.endsWith("<div><br></div>"), "빈 줄은 <br> 한 줄");
  assert.equal(richToHtml(plainToRich("a\n\nb")), "<div>a</div><div><br></div><div>b</div>");
});

test("css values from the browser map back to style names", () => {
  assert.equal(colorKeyOf("rgb(217, 48, 37)"), "red");
  assert.equal(colorKeyOf("#1A73E8"), "blue");
  assert.equal(colorKeyOf("rgb(29, 29, 31)"), undefined, "기본 글자색은 서식이 아니다");
  assert.equal(hiliteKeyOf("rgb(255, 241, 118)"), "yellow");
  assert.equal(hiliteKeyOf("transparent"), undefined);
  assert.equal(hiliteKeyOf("rgba(0, 0, 0, 0)"), undefined);
  assert.equal(fontKeyOf('"Nanum Myeongjo", AppleMyungjo, Batang, serif'), "serif");
  assert.equal(fontKeyOf("Pretendard Variable, sans-serif"), undefined);
  assert.equal(sizeKeyOf("17px"), "l");
  assert.equal(sizeKeyOf("xxx-large"), undefined);
});

test("sanitizeProject keeps noteRich in step with note", () => {
  const base = { ...emptyProject(), code: "T-1", name: "t" };
  const r = rich([[{ t: "확정", b: true, h: "yellow" }], [{ t: "보통 줄" }]]);
  const same = sanitizeProject({ ...base, note: "확정\n보통 줄", noteRich: r });
  assert.ok(same.ok);
  assert.deepEqual(same.value.noteRich, r);

  // 스크립트가 평문만 고쳐도 — 그대로인 줄의 서식은 남는다
  const edited = sanitizeProject({ ...base, note: "확정\n보통 줄\n덧붙인 줄", noteRich: r });
  assert.ok(edited.ok);
  assert.deepEqual(edited.value.noteRich?.lines, [[{ t: "확정", b: true, h: "yellow" }], [{ t: "보통 줄" }], [{ t: "덧붙인 줄" }]]);

  const cleared = sanitizeProject({ ...base, note: "", noteRich: r });
  assert.ok(cleared.ok);
  assert.equal("noteRich" in cleared.value, false, "메모를 비우면 서식도 없다");

  const plain = sanitizeProject({ ...base, note: "그냥 글" });
  assert.ok(plain.ok);
  assert.equal("noteRich" in plain.value, false);
});
