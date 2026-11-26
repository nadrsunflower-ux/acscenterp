// 「급여 지급」 화면을 실제 React 화면으로 검증한다.
// 사람 · 금액 · 계좌 · 거래는 전부 가상 fixture이며 모든 네트워크 요청은 가로채거나 차단한다 — 운영 DB에 닿지 않는다.
//
//   npx tsx e2e/payroll-ui.mjs                 (Chromium)
//   BROWSER=webkit npx tsx e2e/payroll-ui.mjs  (사파리 엔진 — 설치돼 있을 때)
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { build } from "esbuild";
import { chromium, webkit, expect } from "@playwright/test";

const engine = process.env.BROWSER === "webkit" ? webkit : chromium;
const cwd = process.cwd();
const out = path.join(cwd, "output", `payroll-ui-${engine.name()}`);
const temp = await mkdtemp(path.join(os.tmpdir(), "erp-payroll-"));
await mkdir(out, { recursive: true });

// 오늘 = 12/1 지급일. 11월 표가 있고 12월 표는 아직 없다
let plans = [
  {
    id: "2026-11",
    payDate: "2026-11-01",
    lines: [
      { id: "a", name: "가상일", entity: "네안데르", kind: "직원", amount: 2_000_000, bank: "가상은행", account: "111-222-333333" },
      { id: "b", name: "가상일", entity: "안다르", kind: "직원", amount: 700_000, bank: "가상은행", account: "111-222-333333" },
      { id: "c", name: "가상이", entity: "네안데르", kind: "임원", amount: 1_500_000 },
      { id: "d", name: "가상삼", entity: "네안데르", kind: "알바", amount: 900_000, sent: "2026-11-01" },
    ],
    updatedAt: 1,
    updatedBy: "fixture@example.com",
  },
];
const pay = (id, date, vendor, gross, site) => ({ id, date, vendor, gross, adjust: 0, txType: "지출", acctMajor: "인건비", acctMid: "급여", acctMinor: "직원급여", site, status: "confirmed", createdAt: 1 });
const fixture = {
  projects: [], docs: [], accounts: [], paymentMethods: [], vendorRules: [], loading: false,
  transactions: [
    pay("t1", "2026-12-01", "가상일", 2_000_000, "네안데르"),
    pay("t2", "2026-12-01", "12월 가상이 인건비", 1_800_000, "네안데르"),
  ],
};
const taxDocs = [
  {
    id: "x1", kind: "payroll-ledger", period: "2026-11", entity: "네안데르", name: "가상 급여대장.pdf", type: "application/pdf", size: 1, uploadedBy: "fixture", createdAt: 1,
    data: { payDate: "2026-11-30", people: [{ name: "가상일", gross: 2_200_000, deduct: 200_000, net: 2_000_000 }, { name: "가상이(대표)", gross: 1_700_000, deduct: 150_000, net: 1_550_000 }] },
  },
];
const mocks = {
  finance: `export const useFinance=()=>({...window.__projectFixture,refresh:async()=>{}});export const useFinanceOptional=useFinance;`,
  auth: `const user={getIdToken:async()=>'fixture-only',email:'fixture@example.com'};export const getNeanderAuth=()=>({currentUser:user,onAuthStateChanged(callback){queueMicrotask(()=>callback(user));return()=>{}}});export const getNeanderDb=()=>({});export const getNeanderApp=()=>({});export const getNeanderStorage=()=>({});export const NEANDER_COL=new Proxy({},{get:(_,k)=>String(k)});`,
  shell: `export const ToolbarPortal=({children})=>children;export const useCrumbTail=()=>{};export const useShellContext=()=>({});export const useDockReservation=()=>{};`,
  navigation: `export const useParams=()=>({});export const usePathname=()=>'/neander/finance/payroll';export const useSearchParams=()=>new URLSearchParams();export const useRouter=()=>({push(){},replace(){},prefetch(){},back(){}});`,
  link: `import {forwardRef} from 'react';export default forwardRef(function Link({href,children,prefetch,replace,scroll,...props},ref){return <a ref={ref} href={typeof href==='string'?href:'#'} {...props}>{children}</a>});`,
};

let browser;
let page;
const errors = [];
const requests = [];
const checksDone = [];
const saves = [];
try {
  const bundle = await build({
    absWorkingDir: cwd, bundle: true, write: false, outfile: path.join(temp, "fixture.js"),
    format: "iife", platform: "browser", jsx: "automatic", logLevel: "silent",
    define: { "process.env.NODE_ENV": '"test"' },
    stdin: { resolveDir: cwd, loader: "tsx", contents: `
import {createRoot} from 'react-dom/client';
import Page from './app/neander/finance/payroll/page.neander.tsx';
import {ConfirmProvider,ToastProvider} from './components/neander/ui';
createRoot(document.getElementById('root')).render(<div data-app="neander" id="fixture-app"><ConfirmProvider><ToastProvider><Page/></ToastProvider></ConfirmProvider></div>);` },
    plugins: [{ name: "payroll-fixtures", setup(builder) {
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
  async function open(width) {
    const p = await browser.newPage({ viewport: { width, height: 1200 }, timezoneId: "Asia/Seoul", permissions: engine === chromium ? ["clipboard-read", "clipboard-write"] : [] });
    p.setDefaultTimeout(7_000);
    await p.clock.install({ time: new Date("2026-12-01T10:00:00+09:00") });
    p.on("pageerror", (error) => errors.push(error.message));
    await p.addInitScript((data) => {
      window.__projectFixture = data;
      window.process = { env: { NODE_ENV: "test" }, browser: true };
      try { localStorage.clear(); } catch {}
    }, fixture);
    await p.route("**/*", async (route) => {
      const request = route.request(), url = new URL(request.url());
      requests.push({ method: request.method(), host: url.host, path: url.pathname });
      if (url.host === "localhost:43170" && url.pathname === "/fixture" && request.method() === "GET") {
        return route.fulfill({ contentType: "text/html; charset=utf-8", body: '<!doctype html><html lang="ko"><head><meta charset="utf-8"></head><body><div id="root"></div></body></html>' });
      }
      if (url.pathname === "/api/neander/finance/payroll") {
        if (request.method() === "GET") return route.fulfill({ contentType: "application/json", body: JSON.stringify({ plans }) });
        // 저장은 받은 내용만 적어 두고 fixture 에 넣는다 — 운영 DB 로 가지 않는다
        if (request.method() === "POST") {
          const b = request.postDataJSON();
          saves.push(b.plan);
          plans = [...plans.filter((x) => x.id !== b.plan.id), b.plan];
          return route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, plan: b.plan }) });
        }
      }
      if (url.pathname === "/api/neander/finance/tax-docs" && request.method() === "GET") {
        return route.fulfill({ contentType: "application/json", body: JSON.stringify({ docs: taxDocs }) });
      }
      return route.abort("blockedbyclient");
    });
    await p.goto("http://localhost:43170/fixture");
    await p.addStyleTag({ content: css });
    await p.addScriptTag({ content: js });
    return p;
  }

  page = await open(1500);
  const app = page.locator("#fixture-app");

  // 1. 12월 표가 없다 — 11월 표 그대로 가져오기
  await expect(app).toContainText("2026년 12월 지급 표가 아직 없습니다");
  await page.screenshot({ path: path.join(out, "1-empty.png"), animations: "disabled" });
  await page.getByRole("button", { name: "2026년 11월 표 그대로 가져오기" }).click();
  await expect(page.getByRole("table").first()).toBeVisible();
  // 자동 저장 — 0.8초 뒤 한 번
  await page.clock.runFor(1_500);
  await expect.poll(() => saves.length).toBe(1);
  assert.equal(saves[0].id, "2026-12");
  assert.equal(saves[0].payDate, "2026-12-01");
  assert.equal(saves[0].lines.length, 4);
  assert.equal(saves[0].lines.find((l) => l.id === "d").sent, undefined, "지난달 보냄 표시는 가져오지 않는다");
  assert.equal(saves[0].lines[0].account, "111-222-333333", "계좌는 그대로");
  checksDone.push("지난달 표 가져오기 · 자동 저장");

  // 2. 장부 대조 — 가상일(네안데르) 보냄 · 가상이 금액 다름 · 가상일(안다르) · 가상삼 남음
  const rows = page.getByRole("table").first().locator("tbody tr");
  const rowAt = (i) => rows.nth(i);
  await expect(rowAt(0)).toContainText("보냄 · 12/1");
  await expect(rowAt(2)).toContainText("금액 다름 · 12/1");
  await expect(rowAt(2)).toContainText("장부 1,800,000원 (+300,000)");
  await expect(rowAt(1).getByRole("checkbox")).not.toBeChecked();
  await expect(app).toContainText("오늘이 지급일입니다 — 보낼 사람 2명 · 1,600,000원");
  checksDone.push("장부 대조 · 지급일 알림");

  // 3. 금액에 쉼표 · 직접 「보냄」 표시
  const amount = page.getByRole("textbox", { name: "가상삼 보낼 돈" });
  await expect(amount).toHaveValue("900,000");
  await amount.fill("950000");
  await expect(amount).toHaveValue("950,000");
  await rowAt(3).getByRole("checkbox").check();
  await page.clock.runFor(1_500);
  await expect.poll(() => saves.at(-1)?.lines.find((l) => l.id === "d")?.amount).toBe(950_000);
  assert.equal(saves.at(-1).lines.find((l) => l.id === "d").sent, "2026-12-01");
  await expect(rowAt(3)).toContainText("보냄 (직접 표시 · 12/1)");
  await expect(rowAt(3)).toContainText("+50,000");
  checksDone.push("쉼표 입력 · 직접 보냄 · 지난번과 차이");

  // 4. 회사 탭 — 안다르만
  await page.getByRole("tab", { name: /안다르/ }).click();
  await expect(rows).toHaveCount(1);
  await expect(rowAt(0)).toContainText("안다르");
  // 계좌 복사
  await page.getByRole("button", { name: "가상일 계좌 복사" }).click();
  await expect(page.locator("body")).toContainText("계좌를 복사했습니다");
  if (engine === chromium) assert.equal(await page.evaluate(() => navigator.clipboard.readText()), "가상은행 111-222-333333");
  // 안다르 탭에서 사람을 더하면 안다르 줄
  await page.getByRole("button", { name: "사람 더하기" }).click();
  await expect(rows).toHaveCount(2);
  await expect(rowAt(1).getByRole("combobox").nth(1)).toHaveValue("안다르");
  await page.getByRole("tab", { name: /전체/ }).click();
  await expect(rows).toHaveCount(5);
  checksDone.push("회사 탭 · 계좌 복사 · 탭에서 사람 더하기");
  await page.locator("#fixture-app").screenshot({ path: path.join(out, "2-table.png"), animations: "disabled" });

  // 5. 세무사 대장과 견주기 — 11월 귀속 대장(지급일 11/30) · 이 표는 12/1
  await page.getByRole("button", { name: /세무사 급여대장과 견주기/ }).click();
  await expect(app).toContainText("2026년 11월 귀속 · 네안데르 대장");
  const cmp = page.getByRole("table").nth(1);
  await expect(cmp.locator("tr").filter({ hasText: "가상일" })).toContainText("같음");
  await expect(cmp.locator("tr").filter({ hasText: "가상이(대표)" })).toContainText("-50,000");
  await expect(app).toContainText("대장에 없는 줄: 가상삼 950,000");
  checksDone.push("세무사 대장 견주기");
  await page.locator("#fixture-app").screenshot({ path: path.join(out, "3-compare.png"), animations: "disabled" });

  // 6. 좁은 화면 — 가로로 넘치지 않는다 (표는 제 안에서 스크롤)
  const narrow = await open(390);
  await narrow.getByRole("button", { name: "2026년 11월 표 그대로 가져오기" }).or(narrow.getByRole("table").first()).first().waitFor();
  const overflow = await narrow.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(overflow <= 0, `모바일 가로 넘침 ${overflow}px`);
  await narrow.screenshot({ path: path.join(out, "4-mobile.png"), fullPage: true, animations: "disabled" });
  checksDone.push("모바일 가로 넘침 없음");

  assert.deepEqual(errors, [], "브라우저 런타임 오류 없음");
  assert.deepEqual(requests.filter((r) => r.method !== "GET" && r.path !== "/api/neander/finance/payroll"), [], "다른 쓰기 요청 없음");
  await writeFile(path.join(out, "report.json"), JSON.stringify({ passed: true, engine: engine.name(), checks: checksDone, errors }, null, 2));
  console.log(`PASS 급여 지급 (${engine.name()}): ${checksDone.join(" / ")} · 캡처 ${out}`);
} catch (error) {
  await page?.screenshot({ path: path.join(out, "failure.png"), fullPage: true }).catch(() => {});
  console.error("errors:", errors);
  throw error;
} finally {
  await browser?.close();
  await rm(temp, { recursive: true, force: true });
}
