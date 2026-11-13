// 프로젝트 메모 서식(굵게 · 형광펜 · 글자색 · 글꼴 · 크기)을 실제 React 화면으로 검증한다.
// 금융 데이터는 전부 가상 fixture이며 모든 네트워크 요청은 가로채거나 차단한다 — 운영 DB에 닿지 않는다.
//
//   npx tsx e2e/project-note-rich-ui.mjs            (Chromium)
//   BROWSER=webkit npx tsx e2e/project-note-rich-ui.mjs   (사파리 엔진 — 설치돼 있을 때)
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { build } from "esbuild";
import { chromium, webkit, expect } from "@playwright/test";
import { sanitizeProject } from "../lib/neander/finance/project.ts";
import { richText } from "../lib/neander/finance/rich-note.ts";

const engine = process.env.BROWSER === "webkit" ? webkit : chromium;
const cwd = process.cwd();
const out = path.join(cwd, "output", `project-note-rich-ui-${engine.name()}`);
const temp = await mkdtemp(path.join(os.tmpdir(), "erp-project-note-"));
await mkdir(out, { recursive: true });

// 서식은 옛 메모 기준 — 셋째 줄은 그 뒤 스크립트가 평문만 고쳤다(기울임은 떨어져야 한다)
const NOTE = "확정 일정 12/9~12/12\n견적 26-214 · 합계 9,999,000\n남은 일: 장비 보관 확인";
const project = {
  id: "fixture", code: "T-1", name: "가상 프로젝트", status: "planning", entities: ["네안데르"],
  contractAmount: 9_090_000, vatMode: "excluded", revenues: [], lines: [], createdAt: 0,
  note: NOTE,
  noteRich: { v: 1, lines: [
    [{ t: "확정 일정 12/9~12/12", b: true, h: "yellow" }],
    [{ t: "견적 26-214 · 합계 " }, { t: "9,999,000", c: "red" }],
    [{ t: "남은 일: 차량 확인", i: true }],
  ] },
};
const fixture = { projects: [project], transactions: [], accounts: [], paymentMethods: [], vendorRules: [], loading: false };
const mocks = {
  finance: `export const useFinance=()=>({...window.__projectFixture,refresh:async()=>{}});export const useFinanceOptional=useFinance;`,
  auth: `const user={getIdToken:async()=>'fixture-only',email:'fixture@example.com'};export const getNeanderAuth=()=>({currentUser:user,onAuthStateChanged(callback){queueMicrotask(()=>callback(user));return()=>{}}});export const getNeanderDb=()=>({});export const getNeanderApp=()=>({});export const getNeanderStorage=()=>({});export const NEANDER_COL=new Proxy({},{get:(_,k)=>String(k)});`,
  shell: `export const ToolbarPortal=({children})=>children;export const useCrumbTail=()=>{};export const useShellContext=()=>({});export const useDockReservation=()=>{};`,
  navigation: `export const useParams=()=>({id:'fixture'});export const usePathname=()=>'/neander/finance/projects/fixture';export const useSearchParams=()=>new URLSearchParams();export const useRouter=()=>({push(){},replace(){},prefetch(){},back(){}});`,
  link: `import {forwardRef} from 'react';export default forwardRef(function Link({href,children,prefetch,replace,scroll,...props},ref){return <a ref={ref} href={typeof href==='string'?href:'#'} {...props}>{children}</a>});`,
};

let browser;
let page;
const errors = [];
const requests = [];
const saves = [];
const checks = [];
try {
  const bundle = await build({
    absWorkingDir: cwd, bundle: true, write: false, outfile: path.join(temp, "fixture.js"),
    format: "iife", platform: "browser", jsx: "automatic", logLevel: "silent",
    define: { "process.env.NODE_ENV": '"test"' },
    stdin: { resolveDir: cwd, loader: "tsx", contents: `
import {createRoot} from 'react-dom/client';
import Page from './app/neander/finance/projects/[id]/page.neander.tsx';
import {ConfirmProvider,ToastProvider} from './components/neander/ui';
createRoot(document.getElementById('root')).render(<div data-app="neander" id="fixture-app"><ConfirmProvider><ToastProvider><Page/></ToastProvider></ConfirmProvider></div>);` },
    plugins: [{ name: "project-note-fixtures", setup(builder) {
      builder.onResolve({ filter: /(?:^|\/)FinanceProvider$/ }, () => ({ path: "finance", namespace: "fixture" }));
      builder.onResolve({ filter: /^@\/lib\/neander\/firebase$/ }, () => ({ path: "auth", namespace: "fixture" }));
      builder.onResolve({ filter: /^@\/components\/neander\/shell\/context$/ }, () => ({ path: "shell", namespace: "fixture" }));
      builder.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: "navigation", namespace: "fixture" }));
      builder.onResolve({ filter: /^next\/link$/ }, () => ({ path: "link", namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path: name }) => ({ contents: mocks[name], loader: "tsx", resolveDir: cwd }));
    } }],
  });
  await writeFile(path.join(temp, "tailwind-input.css"), "@tailwind base;\n@tailwind components;\n@tailwind utilities;\n");
  execFileSync(process.execPath, [path.join(cwd, "node_modules/tailwindcss/lib/cli.js"), "-c", path.join(cwd, "tailwind.config.ts"), "-i", path.join(temp, "tailwind-input.css"), "-o", path.join(temp, "tailwind.css"), "--minify"], { cwd, stdio: "pipe" });
  const css = await readFile(path.join(temp, "tailwind.css"), "utf8")
    + await readFile(path.join(cwd, "app/neander/neander.css"), "utf8")
    + "\nbody{margin:0;font-family:system-ui,sans-serif}#fixture-app{min-height:100vh;padding:24px;background:rgb(var(--nd-bg-page))}\n"
    + bundle.outputFiles.filter((file) => file.path.endsWith(".css")).map((file) => file.text).join("\n");
  const js = bundle.outputFiles.find((file) => file.path.endsWith(".js")).text;

  browser = await engine.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1500, height: 1100 }, timezoneId: "Asia/Seoul" });
  page.setDefaultTimeout(7_000);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript((data) => {
    window.__projectFixture = data;
    window.process = { env: { NODE_ENV: "test" }, browser: true };
  }, fixture);
  await page.route("**/*", async (route) => {
    const request = route.request(), url = new URL(request.url());
    requests.push({ method: request.method(), host: url.host, path: url.pathname });
    if (url.host === "localhost:43166" && url.pathname === "/fixture" && request.method() === "GET") {
      return route.fulfill({ contentType: "text/html; charset=utf-8", body: '<!doctype html><html lang="ko"><head><meta charset="utf-8"></head><body><div id="root"></div></body></html>' });
    }
    // 저장은 받은 내용만 적어 두고, 서버처럼 다듬은 값을 fixture 에 넣는다 — 운영 DB 로 가지 않는다
    if (url.pathname === "/api/neander/finance/mutate" && request.method() === "POST") {
      const body = request.postDataJSON();
      saves.push(body);
      const checked = sanitizeProject(body.payload.project);
      await page.evaluate((saved) => {
        const f = window.__projectFixture;
        window.__projectFixture = { ...f, projects: [{ ...saved, id: "fixture", createdAt: 0 }] };
      }, checked.ok ? checked.value : body.payload.project);
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, id: "fixture" }) });
    }
    return route.abort("blockedbyclient");
  });
  await page.goto("http://localhost:43166/fixture");
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: js });

  const editor = page.getByRole("textbox", { name: "메모", exact: true });
  const toolbar = page.getByRole("toolbar", { name: "메모 서식" });
  const lastProject = () => saves.at(-1).payload.project;
  const lastLines = () => lastProject().noteRich?.lines;
  async function waitSave(before) {
    await expect.poll(() => saves.length, { timeout: 5_000 }).toBeGreaterThan(before);
  }
  /** 편집 칸 안의 글자를 골라 둔다 (마우스로 끌어 고른 것과 같다) */
  async function select(text) {
    await editor.evaluate((el, needle) => {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let n;
      while ((n = walker.nextNode())) {
        const at = n.nodeValue.indexOf(needle);
        if (at >= 0) {
          el.focus();
          const r = document.createRange();
          r.setStart(n, at);
          r.setEnd(n, at + needle.length);
          const sel = document.getSelection();
          sel.removeAllRanges();
          sel.addRange(r);
          return;
        }
      }
      throw new Error(`메모에 「${needle}」 이 없습니다`);
    }, text);
  }
  const runOf = (lines, text) => lines.flat().find((r) => r.t === text);
  const styleOf = (text, prop) => editor.evaluate((el, [needle, p]) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) if (n.nodeValue.includes(needle)) return getComputedStyle(n.parentElement)[p];
    return null;
  }, [text, prop]);

  // ① 처음 모습 — 저장된 서식이 보이고, 평문만 바뀐 셋째 줄은 서식 없이
  await expect(editor).toBeVisible();
  await expect(toolbar).toBeVisible();
  assert.equal(await editor.innerText(), NOTE);
  assert.equal(await styleOf("확정 일정", "fontWeight"), "700");
  assert.equal(await styleOf("확정 일정", "backgroundColor"), "rgb(255, 241, 118)");
  assert.equal(await styleOf("9,999,000", "color"), "rgb(217, 48, 37)");
  assert.equal(await styleOf("장비 보관", "fontStyle"), "normal", "바뀐 줄은 옛 기울임을 물려받지 않는다");
  assert.equal(saves.length, 0, "열기만 해서는 저장하지 않는다");
  checks.push("저장된 서식이 그대로 보이고, 평문만 바뀐 줄은 서식 없이 이어 붙는다");
  await page.locator("#fixture-app").screenshot({ path: path.join(out, "1-open.png"), animations: "disabled" });

  // ② 글자를 누르기만 해서는 아무 서식도 칠해지지 않는다 (label 이 첫 버튼을 누르던 함정)
  await editor.getByText("견적 26-214").click();
  await page.waitForTimeout(1_100);
  assert.equal(saves.length, 0, "글자를 눌러도 저장(서식 변경)이 없다");
  checks.push("메모 글자를 눌러도 도구 버튼이 눌리지 않는다");

  // ③ 굵게
  let before = saves.length;
  await select("장비 보관");
  await toolbar.getByRole("button", { name: "굵게 (⌘B)" }).click();
  await waitSave(before);
  assert.equal(lastProject().note, NOTE, "글자는 그대로");
  assert.deepEqual(runOf(lastLines(), "장비 보관"), { t: "장비 보관", b: true });
  checks.push("굵게 → 그 글자만 b");

  // ④ 형광펜 · 글자색 · 글꼴 · 크기
  before = saves.length;
  await select("남은 일");
  await toolbar.getByRole("button", { name: "형광펜" }).click();
  await page.getByRole("menuitem", { name: "형광펜 연두" }).click();
  await select("확인");
  await toolbar.getByRole("button", { name: "글자색" }).click();
  await page.getByRole("menuitem", { name: "글자색 파랑" }).click();
  await select("견적 26-214");
  await toolbar.getByRole("button", { name: "글꼴" }).click();
  await page.getByRole("menuitem", { name: "명조" }).click();
  await select("합계");
  await toolbar.getByRole("button", { name: "글자 크기" }).click();
  await page.getByRole("menuitem", { name: "크게", exact: true }).click();
  await waitSave(before);
  await expect.poll(() => JSON.stringify(lastLines())).toContain('"z":"l"');
  const lines = lastLines();
  assert.deepEqual(runOf(lines, "남은 일"), { t: "남은 일", h: "green" });
  assert.deepEqual(runOf(lines, "확인"), { t: "확인", c: "blue" });
  assert.deepEqual(runOf(lines, "견적 26-214"), { t: "견적 26-214", f: "serif" });
  assert.equal(runOf(lines, "합계")?.z, "l");
  assert.equal(await styleOf("합계", "fontSize"), "17px");
  assert.equal(lastProject().note, NOTE);
  checks.push("형광펜 연두 · 글자색 파랑 · 명조 · 크게(17px)가 그 글자에만");

  // ⑤ 이어 쓰기 · 줄바꿈 — 글자는 평문 note 로, 서식은 그대로
  before = saves.length;
  await editor.evaluate((el) => {
    el.focus();
    const r = document.createRange();
    r.selectNodeContents(el);
    r.collapse(false);
    const sel = document.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
  });
  await page.keyboard.type(" 끝");
  await page.keyboard.press("Enter");
  await page.keyboard.type("새 줄");
  await waitSave(before);
  await expect.poll(() => lastProject().note).toBe(`${NOTE} 끝\n새 줄`);
  assert.deepEqual(runOf(lastLines(), "장비 보관"), { t: "장비 보관", b: true }, "앞 서식은 남는다");
  checks.push("이어 쓰고 줄을 바꿔도 note 가 줄 그대로 · 앞 서식 유지");

  // ⑥ 붙여넣기는 글자만
  before = saves.length;
  await editor.evaluate((el) => {
    el.focus();
    const dt = new DataTransfer();
    dt.setData("text/html", '<b style="color:red;font-size:40px">굵은 빨강</b><img src=x onerror="window.__xss=1">');
    dt.setData("text/plain", "붙인 글");
    el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await waitSave(before);
  await expect.poll(() => lastProject().note).toContain("붙인 글");
  assert.ok(!lastProject().note.includes("굵은 빨강"));
  assert.equal(await page.evaluate(() => window.__xss), undefined);
  assert.equal(await editor.locator("img").count(), 0);
  checks.push("붙여넣기는 글자만 — 서식 · 이미지 · 스크립트 없음");

  // ⑦ 형광펜 없음 · 서식 지우기
  before = saves.length;
  await select("확정 일정");
  await toolbar.getByRole("button", { name: "형광펜" }).click();
  await page.getByRole("menuitem", { name: "형광펜 없음" }).click();
  await select("9,999,000");
  await toolbar.getByRole("button", { name: "서식 지우기" }).click();
  await waitSave(before);
  await expect.poll(() => JSON.stringify(runOf(lastLines(), "9,999,000") ?? null)).not.toContain("red");
  assert.deepEqual(lastLines()[0], [{ t: "확정 일정", b: true }, { t: " 12/9~12/12", b: true, h: "yellow" }], "고른 「확정 일정」 만 형광펜이 빠지고 굵게는 남는다");
  assert.deepEqual(runOf(lastLines(), " 9,999,000"), { t: " 9,999,000" }, "서식 지우기 — 빨강이 빠진다");
  assert.equal(await styleOf("확정 일정", "backgroundColor"), "rgba(0, 0, 0, 0)");
  checks.push("형광펜 없음 · 서식 지우기가 그 글자에서만 빠진다");

  // ⑧ 서버가 다듬어도 그대로 — 내보낸 서식은 sanitizeProject 를 거쳐도 같다
  const p = lastProject();
  const checked = sanitizeProject(p);
  assert.ok(checked.ok);
  assert.equal(richText(checked.value.noteRich), checked.value.note);
  assert.deepEqual(checked.value.noteRich, p.noteRich, "서버 저장본 = 화면이 보낸 서식");
  checks.push("저장 직전 정리(sanitizeProject)를 거쳐도 서식이 그대로");
  await page.locator("#fixture-app").screenshot({ path: path.join(out, "2-formatted.png"), animations: "disabled" });

  // ⑨ 펼침 화면 캡처 (형광펜)
  await select("새 줄");
  await toolbar.getByRole("button", { name: "형광펜" }).click();
  await page.locator("#fixture-app").screenshot({ path: path.join(out, "3-palette.png"), animations: "disabled" });
  await page.keyboard.press("Escape");

  assert.deepEqual(errors, [], "브라우저 런타임 오류 없음");
  const stray = requests.filter((r) => r.method !== "GET" && r.path !== "/api/neander/finance/mutate");
  assert.deepEqual(stray, [], "다른 쓰기 요청 없음");
  await writeFile(path.join(out, "report.json"), JSON.stringify({ passed: true, engine: engine.name(), checks, errors, saves: saves.length, last: lastProject().noteRich }, null, 2));
  console.log(`PASS 메모 서식 (${engine.name()}): ${checks.join(" / ")} · 저장 ${saves.length}번 전부 가로챔 · 캡처 ${out}`);
} catch (error) {
  await page?.screenshot({ path: path.join(out, "failure.png"), fullPage: true }).catch(() => {});
  console.error("errors:", errors, "\nlast save:", JSON.stringify(saves.at(-1)?.payload?.project?.noteRich)?.slice(0, 1200));
  throw error;
} finally {
  await browser?.close();
  await rm(temp, { recursive: true, force: true });
}
