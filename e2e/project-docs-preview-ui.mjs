// 프로젝트 「견적 · 계약 · 자료」 탭의 최신 견적서 · 계약서 종이 미리보기를 실제 React 화면으로 검증한다.
// 문서 · 프로젝트는 전부 가상 fixture이며 모든 네트워크 요청은 가로채거나 차단한다 — 운영 DB에 닿지 않는다.
//
//   npx tsx e2e/project-docs-preview-ui.mjs                 (Chromium)
//   BROWSER=webkit npx tsx e2e/project-docs-preview-ui.mjs  (사파리 엔진 — 설치돼 있을 때)
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { build } from "esbuild";
import { chromium, webkit, expect } from "@playwright/test";
import { emptyContract, emptyQuote } from "../lib/neander/finance/docs.ts";
import { newContract } from "../lib/neander/finance/contract.ts";

const engine = process.env.BROWSER === "webkit" ? webkit : chromium;
const cwd = process.cwd();
const out = path.join(cwd, "output", `project-docs-preview-ui-${engine.name()}`);
const temp = await mkdtemp(path.join(os.tmpdir(), "erp-project-docs-"));
await mkdir(out, { recursive: true });

const project = {
  id: "fixture", code: "T-2", name: "가상 행사 체험 부스", client: "가상 고객사", status: "planning", entities: ["네안데르"],
  contractAmount: 3_000_000, vatMode: "excluded", startDate: "2026-12-01", endDate: "2026-12-02",
  revenues: [], lines: [], createdAt: 0, note: "",
};
const line = (name, qty, unitPrice) => ({ id: `l-${name}`, name, spec: "", qty, unit: "식", unitPrice, note: "" });
const quote = (id, no, date, createdAt, updatedAt, extra = {}) => ({
  ...emptyQuote("fixture", { title: `가상 행사 견적 ${no}`, recipient: "가상 고객사" }),
  quoteNo: no, date, ...extra, id, createdAt, updatedAt, files: [],
});
// 최신 = 견적일. 목록 맨 위(나중에 고친 것)나 나중에 만든 것이 아니다
const docs = [
  quote("q-old", "26-901", "2026-11-01", 300, 300, { lines: [line("옛 견적 품목", 1, 500_000)] }),
  quote("q-new", "26-903", "2026-11-13", 200, 200, { design: undefined, lines: [line("AI 포토부스 운영", 2, 1_000_000), line("최신 견적 품목", 1, 1_000_000)] }),
  quote("q-mid", "26-902", "2026-11-11", 100, 999, { lines: [line("중간 견적 품목", 1, 700_000)] }),
  { ...emptyContract("fixture", { title: "받은 옛 계약서", counterparty: "가상 고객사", amount: 1_000_000 }), id: "c-old", createdAt: 50, files: [] },
  { ...newContract("service", project, []), id: "c-new", createdAt: 400, files: [] },
];
const fixture = { projects: [project], docs, transactions: [], accounts: [], paymentMethods: [], vendorRules: [], loading: false };
const mocks = {
  finance: `export const useFinance=()=>({...window.__projectFixture,refresh:async()=>{}});export const useFinanceOptional=useFinance;`,
  auth: `const user={getIdToken:async()=>'fixture-only',email:'fixture@example.com'};export const getNeanderAuth=()=>({currentUser:user,onAuthStateChanged(callback){queueMicrotask(()=>callback(user));return()=>{}}});export const getNeanderDb=()=>({});export const getNeanderApp=()=>({});export const getNeanderStorage=()=>({});export const NEANDER_COL=new Proxy({},{get:(_,k)=>String(k)});`,
  shell: `export const ToolbarPortal=({children})=>children;export const useCrumbTail=()=>{};export const useShellContext=()=>({});export const useDockReservation=()=>{};`,
  navigation: `export const useParams=()=>({id:'fixture'});export const usePathname=()=>'/neander/finance/projects/fixture';export const useSearchParams=()=>new URLSearchParams();export const useRouter=()=>({push(){},replace(){},prefetch(){},back(){}});`,
  link: `import {forwardRef} from 'react';export default forwardRef(function Link({href,children,prefetch,replace,scroll,...props},ref){return <a ref={ref} href={typeof href==='string'?href:'#'} {...props}>{children}</a>});`,
};
// 가상 도장 — 빨간 점 하나(1×1 PNG)
const SEAL_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==", "base64");

let browser;
let page;
const errors = [];
const requests = [];
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
    plugins: [{ name: "project-docs-fixtures", setup(builder) {
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

  /** 화면 폭마다 새 페이지로 띄운다 */
  async function open(width) {
    const p = await browser.newPage({ viewport: { width, height: 1100 }, timezoneId: "Asia/Seoul" });
    p.setDefaultTimeout(7_000);
    p.on("pageerror", (error) => errors.push(error.message));
    await p.addInitScript((data) => {
      window.__projectFixture = data;
      window.process = { env: { NODE_ENV: "test" }, browser: true };
    }, fixture);
    await p.route("**/*", async (route) => {
      const request = route.request(), url = new URL(request.url());
      requests.push({ method: request.method(), host: url.host, path: url.pathname });
      if (url.host === "localhost:43167" && url.pathname === "/fixture" && request.method() === "GET") {
        return route.fulfill({ contentType: "text/html; charset=utf-8", body: '<!doctype html><html lang="ko"><head><meta charset="utf-8"></head><body><div id="root"></div></body></html>' });
      }
      if (url.pathname.startsWith("/api/neander/finance/seals/")) return route.fulfill({ contentType: "image/png", body: SEAL_PNG });
      return route.abort("blockedbyclient");
    });
    await p.goto("http://localhost:43167/fixture#docs");
    await p.addStyleTag({ content: css });
    await p.addScriptTag({ content: js });
    return p;
  }

  page = await open(1600);
  const quoteFrame = page.locator('iframe[title^="최신 견적서"]');
  const contractFrame = page.locator('iframe[title^="최신 계약서"]');
  await expect(quoteFrame).toHaveCount(1);
  await expect(contractFrame).toHaveCount(1);

  // 1. 최신 견적서 = 견적일이 가장 늦은 26-903 (목록 맨 위 26-902 · 나중에 만든 26-901 이 아니다)
  const q = quoteFrame.contentFrame();
  await expect(q.locator("body")).toContainText("26-903");
  await expect(q.locator("body")).toContainText("최신 견적 품목");
  assert.equal(await q.locator("body").innerText().then((t) => /26-90[12]/.test(t)), false, "다른 견적서가 섞이지 않음");
  checks.push("최신 견적 = 견적일 기준");

  // 2. 종이는 보기 전용 — 입력칸 · 단추가 없다(인쇄본 그대로)
  assert.equal(await q.locator("input, textarea, button, select").count(), 0, "견적 종이에 입력칸 없음");
  const c = contractFrame.contentFrame();
  assert.equal(await c.locator("input, textarea, button, select").count(), 0, "계약 종이에 입력칸 없음");
  checks.push("입력칸 없는 인쇄본");

  // 3. 최신 계약서 = 만든 계약서(c-new) — 받은 옛 계약서가 아니다. 양식 본문이 보인다
  await expect(c.locator("body")).toContainText("가상 고객사");
  assert.ok((await c.locator(".csheet .clause").count()) > 3, "조항이 그려짐");
  assert.equal(await c.locator("body").innerText().then((t) => t.includes("받은 옛 계약서")), false);
  checks.push("최신 계약 = 만든 때 기준");

  // 4. 도장 — 미리 받아 둔 data: URL 로 찍힌다
  const sealSrc = await q.locator("img.seal").first().getAttribute("src").catch(() => null);
  assert.ok(sealSrc?.startsWith("data:image/png"), `견적 도장 찍힘 (${String(sealSrc).slice(0, 30)})`);
  checks.push("도장");

  // 5. 넓은 화면: 좌우 나란히 · 같은 높이에서 시작 · 칸 폭에 맞춰 줄임
  const qb = await quoteFrame.locator("xpath=..").boundingBox();
  const cb = await contractFrame.locator("xpath=..").boundingBox();
  assert.ok(qb.x + qb.width <= cb.x, "견적 종이가 왼쪽");
  assert.ok(Math.abs(qb.y - cb.y) < 2, `두 종이가 같은 높이에서 시작 (${qb.y} · ${cb.y})`);
  assert.ok(qb.height > qb.width * 1.0 && cb.height > cb.width * 1.0, "종이 높이를 재서 잘리지 않음");
  checks.push(`좌우 (${Math.round(qb.width)}px · ${Math.round(cb.width)}px)`);
  await page.locator("#fixture-app").screenshot({ path: path.join(out, "1-wide.png"), animations: "disabled" });

  // 6. 종이를 누르면 그 문서 편집창이 열린다
  await page.getByRole("button", { name: /최신 견적서 제 26-903호 미리보기/ }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('input[value="26-903"], [data-quote-preview-paper]').first()).toBeVisible();
  await page.locator("#fixture-app").screenshot({ path: path.join(out, "2-open.png"), animations: "disabled" });
  checks.push("눌러서 편집창");
  await page.close();

  // 7. 좁은 화면: 견적서 목록 → 견적 종이 → 계약서 목록 → 계약 종이 순서
  page = await open(820);
  await expect(page.locator('iframe[title^="최신 계약서"]')).toHaveCount(1);
  const order = await page.evaluate(() => {
    const y = (sel) => document.querySelector(sel)?.getBoundingClientRect().top ?? -1;
    const head = (text) => [...document.querySelectorAll("h2, h3, p, span")].find((el) => el.textContent?.trim().startsWith(text))?.getBoundingClientRect().top ?? -1;
    return { quoteList: head("견적서"), quotePaper: y('iframe[title^="최신 견적서"]'), contractList: head("계약서"), contractPaper: y('iframe[title^="최신 계약서"]') };
  });
  assert.ok(order.quoteList < order.quotePaper && order.quotePaper < order.contractList && order.contractList < order.contractPaper, `좁은 화면 순서 ${JSON.stringify(order)}`);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(overflow <= 0, `가로 밀림 없음 (${overflow}px)`);
  checks.push("좁은 화면 순서 · 가로 밀림 없음");
  await page.screenshot({ path: path.join(out, "3-narrow.png"), fullPage: true });

  assert.deepEqual(errors, [], "브라우저 런타임 오류 없음");
  const stray = requests.filter((r) => r.method !== "GET");
  assert.deepEqual(stray, [], "쓰기 요청 없음");
  await writeFile(path.join(out, "report.json"), JSON.stringify({ passed: true, engine: engine.name(), checks, errors }, null, 2));
  console.log(`PASS 문서 미리보기 (${engine.name()}): ${checks.join(" / ")} · 캡처 ${out}`);
} catch (error) {
  await page?.screenshot({ path: path.join(out, "failure.png"), fullPage: true }).catch(() => {});
  console.error("errors:", errors);
  throw error;
} finally {
  await browser?.close();
  await rm(temp, { recursive: true, force: true });
}
