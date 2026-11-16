// 매출 › 이벤트 입력의 「발주일」 칸 · 「발주 전」 표시 · 노션 알림 링크(?event= · ?new=1)를 실제 React 화면으로 검증한다.
// 이벤트는 전부 가상 fixture이며 모든 네트워크 요청은 가로채거나 차단한다 — 운영 DB에 닿지 않는다.
//
//   npx tsx e2e/sales-order-alert-ui.mjs
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";

const cwd = process.cwd();
const out = path.join(cwd, "output", "sales-order-alert-ui");
const temp = await mkdtemp(path.join(os.tmpdir(), "erp-order-alert-"));
await mkdir(out, { recursive: true });

const ev = (id, name, from, to, extra = {}) => ({ id, store: id.startsWith("ID") ? "id" : "wow", name, from, to, hoursPerDay: 0, staff: 0, supplies: 0, ...extra });
const fixture = {
  lines: [], products: [], imports: [], labor: null, loading: false, syncing: false, masterEmpty: false, error: null, assumptionsSeeded: true,
  events: [
    ev("ID-041", "가상그룹 가람", "2026-11-28", "2026-11-29", { note: "11/13 발주 (가상업체 123)" }),
    ev("WE-090", "가상그룹 나래", "2026-11-20", "2026-11-21"),
    ev("WE-091", "가상그룹 다온", "2026-11-27", "2026-11-28"),
  ],
};
const mocks = {
  sales: `import {SEED_ASSUMPTIONS} from '@/lib/neander/sales/master-data';const v={...window.__salesFixture,assumptions:SEED_ASSUMPTIONS,refresh:async()=>{},applyLines(){},applyProducts(){}};export const useSales=()=>v;export const useSalesOptional=()=>v;`,
  auth: `const user={getIdToken:async()=>'fixture-only',email:'fixture@example.com'};export const getNeanderAuth=()=>({currentUser:user,onAuthStateChanged(callback){queueMicrotask(()=>callback(user));return()=>{}}});export const getNeanderDb=()=>({});export const getNeanderApp=()=>({});export const getNeanderStorage=()=>({});export const NEANDER_COL=new Proxy({},{get:(_,k)=>String(k)});`,
  shell: `export const ToolbarPortal=({children})=>children;export const useCrumbTail=()=>{};export const useShellContext=()=>({});export const useDockReservation=()=>{};`,
  navigation: `export const useParams=()=>({});export const usePathname=()=>'/neander/sales/event-entry';export const useSearchParams=()=>new URLSearchParams(location.search);export const useRouter=()=>({push(){},replace(){},prefetch(){},back(){}});`,
  link: `import {forwardRef} from 'react';export default forwardRef(function Link({href,children,prefetch,replace,scroll,...props},ref){return <a ref={ref} href={typeof href==='string'?href:'#'} {...props}>{children}</a>});`,
};

let browser;
const errors = [];
const saves = [];
const checks = [];
try {
  const bundle = await build({
    absWorkingDir: cwd, bundle: true, write: false, outfile: path.join(temp, "fixture.js"),
    format: "iife", platform: "browser", jsx: "automatic", logLevel: "silent",
    define: { "process.env.NODE_ENV": '"test"' },
    stdin: { resolveDir: cwd, loader: "tsx", contents: `
import {createRoot} from 'react-dom/client';
import Page from './app/neander/sales/event-entry/page.neander.tsx';
import {ConfirmProvider,ToastProvider} from './components/neander/ui';
createRoot(document.getElementById('root')).render(<div data-app="neander" id="fixture-app"><ConfirmProvider><ToastProvider><Page/></ToastProvider></ConfirmProvider></div>);` },
    plugins: [{ name: "order-alert-fixtures", setup(builder) {
      builder.onResolve({ filter: /(?:^|\/)SalesProvider$/ }, () => ({ path: "sales", namespace: "fixture" }));
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

  browser = await chromium.launch({ headless: true });
  async function open(query) {
    const p = await browser.newPage({ viewport: { width: 1500, height: 1100 }, timezoneId: "Asia/Seoul" });
    p.setDefaultTimeout(7_000);
    await p.clock.setFixedTime(new Date("2026-11-15T10:00:00+09:00"));
    p.on("pageerror", (error) => errors.push(error.message));
    await p.addInitScript((data) => {
      window.__salesFixture = data;
      window.process = { env: { NODE_ENV: "test" }, browser: true };
      try { localStorage.clear(); } catch {}
    }, fixture);
    await p.route("**/*", async (route) => {
      const request = route.request(), url = new URL(request.url());
      if (url.host === "localhost:43171" && url.pathname === "/neander/sales/event-entry" && request.method() === "GET") {
        return route.fulfill({ contentType: "text/html; charset=utf-8", body: '<!doctype html><html lang="ko"><head><meta charset="utf-8"></head><body><div id="root"></div></body></html>' });
      }
      if (url.pathname === "/api/neander/sales/mutate" && request.method() === "POST") {
        saves.push(request.postDataJSON());
        return route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, lines: { attached: 0, detached: 0, resolved: 0 } }) });
      }
      return route.abort("blockedbyclient");
    });
    await p.goto(`http://localhost:43171/neander/sales/event-entry${query}`);
    await p.addStyleTag({ content: css });
    await p.addScriptTag({ content: js });
    return p;
  }

  // 1. ?event=ID-041 — 그 이벤트가 열리고, 메모의 발주일을 읽었다고 알려 준다. 주소의 물음표는 지운다
  let page = await open("?event=ID-041");
  await expect(page.locator("input[value='가상그룹 가람']")).toBeVisible();
  await expect(page.locator("#fixture-app")).toContainText("메모에서 11/13 로 읽음");
  assert.equal(new URL(page.url()).search, "", "알림 링크 주소는 한 번 읽고 지운다");
  checks.push("?event= 로 그 이벤트 열기 · 메모 발주일");

  // 2. 목록 — 발주 기록 없는 이벤트에 「발주 전」 (D-5 나래), 발주한 가람에는 없음
  const item = (n) => page.getByRole("button").filter({ hasText: n }).first();
  await expect(item("가상그룹 나래")).toContainText("발주 전");
  await expect(item("가상그룹 다온")).toContainText("발주 전");
  await expect(item("가상그룹 가람")).not.toContainText("발주 전");
  checks.push("목록 「발주 전」 표시");
  await page.locator("#fixture-app").screenshot({ path: path.join(out, "1-event.png"), animations: "disabled" });
  await page.close();

  // 3. ?new=1 — 캘린더 내용으로 새 이벤트(12월)를 채워 연다. 발주일을 적고 저장하면 orderedAt 이 간다
  page = await open(`?new=1&store=id&name=${encodeURIComponent("가상그룹 라온")}&from=2026-12-03&to=2026-12-05`);
  await expect(page.locator("input[value='가상그룹 라온']")).toBeVisible();
  await expect(page.locator("input[value='ID-042']")).toBeVisible();
  await expect(page.locator("input[type=date][value='2026-12-03']")).toBeVisible();
  await expect(page.locator("#fixture-app")).toContainText("비어 있으면 D-15부터 노션 알림");
  const orderInput = page.locator("label, div").filter({ hasText: /^발주일/ }).locator("input[type=date]").first();
  await orderInput.fill("2026-11-16");
  await page.locator("#fixture-app").screenshot({ path: path.join(out, "2-new.png"), animations: "disabled" });
  await page.getByRole("button", { name: "추가" }).last().click();
  await expect.poll(() => saves.length).toBe(1);
  const ev0 = saves[0].payload.event;
  assert.equal(saves[0].action, "event.upsert");
  assert.equal(ev0.id, "ID-042");
  assert.equal(ev0.store, "id");
  assert.equal(ev0.orderedAt, "2026-11-16");
  assert.equal(ev0.from, "2026-12-03");
  assert.equal(ev0.to, "2026-12-05");
  checks.push("?new=1 로 새 이벤트 채우기 · 발주일 저장");

  assert.deepEqual(errors, [], "브라우저 런타임 오류 없음");
  await writeFile(path.join(out, "report.json"), JSON.stringify({ passed: true, checks, errors }, null, 2));
  console.log(`PASS 이벤트 발주일 (${checks.join(" / ")}) · 캡처 ${out}`);
} finally {
  await browser?.close();
}
