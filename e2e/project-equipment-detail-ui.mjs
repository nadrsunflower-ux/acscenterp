// 프로젝트 상세 화면의 「장비 배정」(포토부스 · 키오스크 대수 · 겹침 알림 · 자동 저장)을 실제 React 화면으로 검증한다.
// 금융 데이터는 전부 가상 fixture이며 모든 네트워크 요청은 가로채거나 차단한다 — 운영 DB에 닿지 않는다.
//
//   npx tsx e2e/project-equipment-detail-ui.mjs                 (Chromium)
//   BROWSER=webkit npx tsx e2e/project-equipment-detail-ui.mjs  (사파리 엔진 — 설치돼 있을 때)
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { build } from "esbuild";
import { chromium, webkit, expect } from "@playwright/test";
import { sanitizeProject } from "../lib/neander/finance/project.ts";

const engine = process.env.BROWSER === "webkit" ? webkit : chromium;
const cwd = process.cwd();
const out = path.join(cwd, "output", `project-equipment-detail-ui-${engine.name()}`);
const temp = await mkdtemp(path.join(os.tmpdir(), "erp-project-equip-"));
await mkdir(out, { recursive: true });

// 이 프로젝트는 12/11~12/12 포토부스 2대. 다른 프로젝트가 12/12 에 1대 — 지금은 3/3 으로 딱 맞는다
const project = {
  id: "fixture", code: "T-1", name: "가상 프로젝트", status: "planning", entities: ["네안데르"],
  contractAmount: 1_000_000, vatMode: "excluded", revenues: [], lines: [], createdAt: 0,
  startDate: "2026-12-11", endDate: "2026-12-12", deliveryDate: "2026-12-11",
  equipment: { photobooth: 2 },
};
const other = {
  id: "other", code: "T-2", name: "2026 다른 행사", status: "active", revenues: [], lines: [], createdAt: 1,
  contractAmount: 0, vatMode: "excluded", startDate: "2026-12-12", endDate: "2026-12-12", equipment: { photobooth: 1 },
};
const fixture = { projects: [project, other], transactions: [], accounts: [], paymentMethods: [], vendorRules: [], loading: false };
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
        window.__projectFixture = { ...f, projects: [{ ...saved, id: "fixture", createdAt: 0 }, ...f.projects.filter((x) => x.id !== "fixture")] };
      }, checked.ok ? checked.value : body.payload.project);
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, id: "fixture" }) });
    }
    return route.abort("blockedbyclient");
  });
  await page.goto("http://localhost:43166/fixture");
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: js });

  const section = page.getByRole("region", { name: "장비 배정" });
  await expect(section).toBeVisible();
  const lastProject = () => saves.at(-1).payload.project;
  async function waitSave(before) {
    await expect.poll(() => saves.length, { timeout: 6_000 }).toBeGreaterThan(before);
  }

  // 1. 저장된 배정이 그대로 보이고, 쓰는 날은 설치 첫날(납기)부터
  await expect(section.getByLabel("포토부스 2대")).toBeVisible();
  await expect(section).toContainText("쓰는 날 12/11(금) ~ 12/12(토)");
  await expect(section).toContainText("겹쳐서 모자라는 날이 없습니다");
  checks.push("배정 · 쓰는 날");

  // 2. 한 대 더하면 12/12 가 4/3 — 겹침이 바로 뜨고 머리에도 알림, 자동 저장에 장비 칸이 실린다
  let before = saves.length;
  await section.getByRole("button", { name: "포토부스 한 대 더하기" }).click();
  await expect(section.getByRole("list", { name: "장비가 모자라는 날" })).toContainText("12/12(토) 포토부스 4대 필요 · 보유 3대");
  await expect(section).toContainText("다른 행사 1");
  await expect(page.getByRole("button", { name: /장비 겹침 1건/ })).toBeVisible();
  await waitSave(before);
  assert.deepEqual(lastProject().equipment, { photobooth: 3 });
  await page.locator("#fixture-app").screenshot({ path: path.join(out, "1-conflict.png"), animations: "disabled" });
  checks.push("겹침 · 머리 알림 · 자동 저장");

  // 3. 키오스크를 더하고 포토부스를 0 까지 빼면 장비 칸에는 키오스크만 남는다
  before = saves.length;
  await section.getByRole("button", { name: "키오스크 한 대 더하기" }).click();
  for (let i = 0; i < 3; i++) await section.getByRole("button", { name: "포토부스 한 대 빼기" }).click();
  await expect(section.getByRole("button", { name: "포토부스 한 대 빼기" })).toBeDisabled();
  await expect(page.getByRole("button", { name: /장비 겹침/ })).toHaveCount(0);
  await expect.poll(() => JSON.stringify(saves.at(-1)?.payload?.project?.equipment), { timeout: 6_000 }).toBe(JSON.stringify({ kiosk: 1 }));
  checks.push("0 이면 그 종류는 지움");

  // 4. 다른 탭에서 저장해도 장비 칸이 빠지지 않는다(toInput)
  before = saves.length;
  await page.getByRole("tab", { name: /지출/ }).click();
  await page.getByRole("tab", { name: "개요" }).click();
  assert.deepEqual(lastProject().equipment, { kiosk: 1 });
  checks.push("저장 경로 유지");

  assert.deepEqual(errors, [], "브라우저 런타임 오류 없음");
  const stray = requests.filter((r) => r.method !== "GET" && r.path !== "/api/neander/finance/mutate");
  assert.deepEqual(stray, [], "다른 쓰기 요청 없음");
  await writeFile(path.join(out, "report.json"), JSON.stringify({ passed: true, engine: engine.name(), checks, errors, saves: saves.length, last: lastProject().equipment }, null, 2));
  console.log(`PASS 장비 배정 상세 (${engine.name()}): ${checks.join(" / ")} · 저장 ${saves.length}번 전부 가로챔 · 캡처 ${out}`);
} catch (error) {
  await page?.screenshot({ path: path.join(out, "failure.png"), fullPage: true }).catch(() => {});
  console.error("errors:", errors, "\nlast save:", JSON.stringify(saves.at(-1)?.payload?.project?.equipment));
  throw error;
} finally {
  await browser?.close();
  await rm(temp, { recursive: true, force: true });
}
