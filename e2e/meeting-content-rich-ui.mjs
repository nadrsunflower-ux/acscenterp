// 회의록 본문 서식 — 프로젝트 메모와 같은 편집기(RichNoteEditor, 글만큼 자라기)로 칠하고,
// 읽기 화면(MinutesText)이 글머리 기호를 뗀 자리에서 같은 서식을 그리는지 본다.
// 회의 화면과 같은 연결(content + contentRich, 저장 직전 reconcile)을 작은 판에 올린다.
// 네트워크는 전부 막는다 — 운영 DB 에 닿지 않는다.
//
//   npx tsx e2e/meeting-content-rich-ui.mjs            (Chromium)
//   BROWSER=webkit npx tsx e2e/meeting-content-rich-ui.mjs
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { build } from "esbuild";
import { chromium, webkit, expect } from "@playwright/test";

const engine = process.env.BROWSER === "webkit" ? webkit : chromium;
const cwd = process.cwd();
const out = path.join(cwd, "output", `meeting-content-rich-ui-${engine.name()}`);
const temp = await mkdtemp(path.join(os.tmpdir(), "erp-meeting-rich-"));
await mkdir(out, { recursive: true });

const CONTENT = "■ 결정 사항\n- 12/9 설치 확정\n1) 견적 26-214 다시 보내기\n[다음 회의]\n평문 줄";

let browser;
const errors = [];
try {
  const bundle = await build({
    absWorkingDir: cwd, bundle: true, write: false, outfile: path.join(temp, "fixture.js"),
    format: "iife", platform: "browser", jsx: "automatic", logLevel: "silent",
    define: { "process.env.NODE_ENV": '"test"' },
    stdin: { resolveDir: cwd, loader: "tsx", contents: `
import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {RichNoteEditor} from './components/neander/finance/RichNoteEditor';
import {MinutesText} from './components/neander/meetings/MinutesText';
import {reconcileNoteRich, sanitizeNoteRich} from './lib/neander/finance/rich-note';
function Harness(){
  const [content,setContent]=useState(${JSON.stringify(CONTENT)});
  const [rich,setRich]=useState(undefined);
  const saved=reconcileNoteRich(content.trim(), sanitizeNoteRich(rich));
  window.__saved={content:content.trim(),contentRich:saved};
  return <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:24}}>
    <RichNoteEditor label="회의 내용" hideLabel grow note={content||undefined} rich={rich}
      onChange={(n,r)=>{setContent(n??'');setRich(r);}}
      textClassName="text-[15px] leading-[1.7]" toolbarClassName="sticky top-0 z-[4]"/>
    <div data-testid="reader"><MinutesText text={content} rich={saved}/></div>
  </div>;
}
createRoot(document.getElementById('root')).render(<div data-app="neander" id="fixture-app"><Harness/></div>);` },
  });
  await writeFile(path.join(temp, "tw.css"), "@tailwind base;\n@tailwind components;\n@tailwind utilities;\n");
  execFileSync(process.execPath, [path.join(cwd, "node_modules/tailwindcss/lib/cli.js"), "-c", path.join(cwd, "tailwind.config.ts"), "-i", path.join(temp, "tw.css"), "-o", path.join(temp, "out.css"), "--minify"], { cwd, stdio: "pipe" });
  const css = await readFile(path.join(temp, "out.css"), "utf8")
    + await readFile(path.join(cwd, "app/neander/neander.css"), "utf8")
    + "\nbody{margin:0;font-family:system-ui,sans-serif}#fixture-app{min-height:100vh;padding:24px;background:rgb(var(--nd-bg-page))}\n";
  const js = bundle.outputFiles.find((f) => f.path.endsWith(".js")).text;

  browser = await engine.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 800 } });
  page.setDefaultTimeout(7_000);
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() => { window.process = { env: { NODE_ENV: "test" }, browser: true }; });
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.host === "localhost:43167") return route.fulfill({ contentType: "text/html; charset=utf-8", body: '<!doctype html><html lang="ko"><head><meta charset="utf-8"></head><body><div id="root"></div></body></html>' });
    return route.abort("blockedbyclient");
  });
  await page.goto("http://localhost:43167/");
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: js });

  const editor = page.getByRole("textbox", { name: "회의 내용", exact: true });
  const toolbar = page.getByRole("toolbar", { name: "회의 내용 서식" });
  const reader = page.getByTestId("reader");
  await expect(editor).toContainText("12/9 설치 확정");

  async function select(needle) {
    await editor.evaluate((el, needle) => {
      const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let n;
      while ((n = w.nextNode())) {
        const at = n.nodeValue.indexOf(needle);
        if (at >= 0) {
          el.focus();
          const r = document.createRange();
          r.setStart(n, at);
          r.setEnd(n, at + needle.length);
          const s = document.getSelection();
          s.removeAllRanges();
          s.addRange(r);
          return;
        }
      }
      throw new Error(needle);
    }, needle);
  }
  const readerStyle = (needle, prop) => reader.evaluate((el, [needle, p]) => {
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) if (n.nodeValue.includes(needle)) return getComputedStyle(n.parentElement)[p];
    return null;
  }, [needle, prop]);

  // 1) 글머리 줄 안의 날짜를 굵게 + 노랑 형광
  await select("12/9");
  await toolbar.getByRole("button", { name: /^굵게/ }).click();
  await toolbar.getByRole("button", { name: "형광펜" }).click();
  await page.getByRole("menuitem", { name: "형광펜 노랑" }).click();
  await expect.poll(() => readerStyle("12/9", "fontWeight")).toBe("700");
  assert.equal(await readerStyle("12/9", "backgroundColor"), "rgb(255, 241, 118)");
  assert.notEqual(await readerStyle("설치 확정", "fontWeight"), "700", "서식은 고른 글자에만");
  // 글머리 기호는 서식 조각과 상관없이 그대로 목록으로 그린다
  await expect(reader.getByText("- 12/9")).toHaveCount(0);

  // 2) 번호 줄의 견적번호를 빨강
  await select("26-214");
  await toolbar.getByRole("button", { name: "글자색" }).click();
  await page.getByRole("menuitem", { name: "글자색 빨강" }).click();
  await expect.poll(() => readerStyle("26-214", "color")).toBe("rgb(217, 48, 37)");

  // 3) 대괄호 소제목 — 「[」 를 뗀 자리가 맞는지
  await select("다음");
  await toolbar.getByRole("button", { name: /^밑줄/ }).click();
  await expect.poll(() => readerStyle("다음", "textDecorationLine")).toContain("underline");
  assert.equal(await reader.locator("h3", { hasText: "다음 회의" }).count(), 1);

  // 4) 저장될 값: 글자는 평문 content 그대로, 서식은 contentRich
  const saved = await page.evaluate(() => window.__saved);
  assert.equal(saved.content, CONTENT);
  const runs = saved.contentRich.lines.flat();
  assert.deepEqual(runs.find((r) => r.t === "12/9"), { t: "12/9", b: true, h: "yellow" });
  assert.deepEqual(runs.find((r) => r.t === "26-214"), { t: "26-214", c: "red" });

  // 5) 글만큼 자라기 — 편집 칸 안에서 따로 스크롤하지 않는다
  await editor.click();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+ArrowDown" : "Control+End");
  for (let k = 0; k < 30; k++) await page.keyboard.press("Enter");
  await page.keyboard.type("맨 끝 줄");
  const box = await editor.evaluate((el) => ({ sh: el.scrollHeight, ch: el.clientHeight }));
  assert.ok(box.sh <= box.ch + 1, `편집 칸이 자라야 한다 ${JSON.stringify(box)}`);
  await expect(reader).toContainText("맨 끝 줄");

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: path.join(out, "회의록-서식.png"), fullPage: false });
  assert.deepEqual(errors, []);
  console.log(`✓ ${engine.name()} — 회의록 본문 서식 5가지 통과 · 캡처 ${out}`);
} finally {
  await browser?.close();
  await rm(temp, { recursive: true, force: true });
}
