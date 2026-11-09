// 프로젝트 입금 일정을 청구액(통장에 찍히는 돈)으로 적는 화면을 실제 React UI로 검증한다.
// 금융 데이터는 전부 가상 fixture이며 모든 네트워크 요청은 가로채거나 차단한다 — 운영 DB에 닿지 않는다.
//
//   node e2e/project-billed-ui.mjs
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";

const cwd = process.cwd();
const out = path.join(cwd, "output", "project-billed-ui");
const temp = await mkdtemp(path.join(os.tmpdir(), "erp-project-billed-"));
await mkdir(out, { recursive: true });

// 익선재와 같은 모양 — 계약 1,300만 별도 · 통장에 1,000만 · 300만 · 130만
const project = {
  id: "fixture", code: "T-1", name: "가상 프로젝트", status: "active", entities: ["네안데르"],
  contractAmount: 13_000_000, vatMode: "excluded", revenues: [], lines: [], createdAt: 0,
  startDate: "2026-10-01", endDate: "2026-11-15",
  installments: [
    { id: "a", kind: "중도금", amount: 9_090_909, paidDate: "2026-10-30", note: "신한4248" },
    { id: "b", kind: "중도금", amount: 2_727_273, paidDate: "2026-10-30" },
    { id: "c", kind: "잔금", amount: 1_181_818, dueDate: "2026-10-31", paidDate: "2026-10-31" },
  ],
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
    plugins: [{ name: "project-billed-fixtures", setup(builder) {
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

  browser = await chromium.launch({ headless: true });
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
    if (url.host === "localhost:43165" && url.pathname === "/fixture" && request.method() === "GET") {
      return route.fulfill({ contentType: "text/html; charset=utf-8", body: '<!doctype html><html lang="ko"><head><meta charset="utf-8"></head><body><div id="root"></div></body></html>' });
    }
    // 저장은 받은 내용만 적어 두고 그대로 돌려준다 — 서버(운영 DB)로 가지 않는다
    if (url.pathname === "/api/neander/finance/mutate" && request.method() === "POST") {
      const body = request.postDataJSON();
      saves.push(body);
      // 저장 뒤 refresh 가 새 문서를 읽는 것과 같게 — 서버 저장 다듬기는 verify-installment-received 가 본다
      await page.evaluate((saved) => {
        const f = window.__projectFixture;
        window.__projectFixture = { ...f, projects: [{ ...f.projects[0], ...saved }] };
      }, body.payload.project);
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, id: "fixture", code: "T-1", project: { ...project, ...body.payload } }) });
    }
    return route.abort("blockedbyclient");
  });
  await page.goto("http://localhost:43165/fixture#revenue");
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: js });

  const money = (n) => n.toLocaleString("ko-KR");
  const billedInputs = page.getByRole("textbox", { name: "청구액", exact: true });
  const rows = page.locator("tr").filter({ has: billedInputs });
  const lastSave = () => {
    const p = saves.at(-1).payload;
    return (p.installments ?? p.input?.installments ?? p.project?.installments ?? p.data?.installments);
  };
  async function waitSave(before) {
    await expect.poll(() => saves.length, { timeout: 5_000 }).toBeGreaterThan(before);
  }

  await expect(page.getByText("통장에 찍히는 금액 그대로 적으세요")).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "청구액 (부가세 포함)" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "공급가액", exact: true })).toBeVisible();

  // ① 예전 회차 — 칸에는 청구액이, 옆에는 공급가액이 보인다
  await expect(billedInputs).toHaveCount(3);
  assert.deepEqual(await billedInputs.evaluateAll((els) => els.map((e) => e.value)), [money(10_000_000), money(3_000_000), money(1_300_000)]);
  await expect(rows.nth(0)).toContainText(money(9_090_909));
  await expect(rows.nth(1)).toContainText(money(2_727_273));
  await expect(rows.nth(2)).toContainText(money(1_181_818));
  await expect(page.getByText("회차 합계가 계약 청구액과")).toHaveCount(0);
  checks.push("예전 회차가 청구액 칸 + 공급가액 표시로 보인다 · 일정 차이 없음");
  await page.screenshot({ path: path.join(out, "billed-desktop.png"), fullPage: true, animations: "disabled" });

  // ② 공급가액 정수로 안 되는 500만원 — 쳐도 그대로, 저장도 그대로
  let before = saves.length;
  await billedInputs.nth(0).fill("5000000");
  await expect(billedInputs.nth(0)).toHaveValue(money(5_000_000));
  await expect(rows.nth(0)).toContainText(money(4_545_455));
  await waitSave(before);
  const a = lastSave().find((i) => i.id === "a");
  assert.equal(a.amount, 4_545_455);
  assert.equal(a.billed, 5_000_000);
  assert.equal(a.note, "신한4248", "다른 칸은 그대로");
  await expect(page.getByText("회차 합계가 계약 청구액과")).toContainText(money(5_000_000));
  checks.push("500만원을 치면 500만원 그대로 보이고 billed 로 저장 · 일정 차이가 정확히 500만원");

  // ③ 저절로 되돌아오는 금액은 칸을 남기지 않는다
  before = saves.length;
  await billedInputs.nth(0).fill("10000000");
  await expect(rows.nth(0)).toContainText(money(9_090_909));
  await waitSave(before);
  assert.equal(lastSave().find((i) => i.id === "a").amount, 9_090_909);
  assert.equal("billed" in lastSave().find((i) => i.id === "a"), false, "1,000만원은 billed 없이");
  await expect(page.getByText("회차 합계가 계약 청구액과")).toHaveCount(0);
  checks.push("1,000만원으로 되돌리면 billed 가 사라지고 일정 차이도 사라진다");

  // ④ 부가세 기준을 바꿔도 적어 둔 청구액은 그대로
  before = saves.length;
  await page.getByRole("combobox", { name: "부가세", exact: true }).first().selectOption("included").catch(async () => {
    await page.locator("select").filter({ hasText: "부가세 별도" }).first().selectOption("included");
  });
  assert.deepEqual(await billedInputs.evaluateAll((els) => els.map((e) => e.value)), [money(10_000_000), money(3_000_000), money(1_300_000)]);
  await expect(rows.nth(0)).toContainText(money(9_090_909));
  await waitSave(before);
  assert.deepEqual(lastSave().map((i) => i.amount), [10_000_000, 3_000_000, 1_300_000]);
  checks.push("부가세 포함으로 바꿔도 청구액 유지 · 저장값은 금액 = 청구액");

  // ⑤ 회차 추가는 남은 청구액을 채운다 — 포함 계약 1,300만, 이미 1,430만이면 0
  await page.locator("select").filter({ hasText: "부가세 포함" }).first().selectOption("excluded");
  await billedInputs.nth(2).fill("0");
  await page.getByRole("button", { name: "회차 추가" }).click();
  await expect(billedInputs).toHaveCount(4);
  await expect(billedInputs.nth(3)).toHaveValue(money(1_300_000));
  await expect(page.getByText("회차 합계가 계약 청구액과")).toHaveCount(0);
  checks.push("회차 추가가 남은 청구액 130만원을 채운다");

  assert.deepEqual(errors, [], "브라우저 런타임 오류 없음");
  const stray = requests.filter((r) => r.method !== "GET" && r.path !== "/api/neander/finance/mutate");
  assert.deepEqual(stray, [], "다른 쓰기 요청 없음");
  await writeFile(path.join(out, "report.json"), JSON.stringify({ passed: true, checks, errors, saves: saves.length }, null, 2));
  console.log(`PASS 청구액 입력 화면: ${checks.join(" / ")} · 저장 ${saves.length}번 전부 가로챔 · 캡처 ${out}`);
} catch (error) {
  await page?.screenshot({ path: path.join(out, "failure.png"), fullPage: true }).catch(() => {});
  console.error("errors:", errors, "\nsaves:", JSON.stringify(saves.at(-1))?.slice(0, 600));
  throw error;
} finally {
  await browser?.close();
  await rm(temp, { recursive: true, force: true });
}
