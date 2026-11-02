// 프로젝트 목록의 금액 기준·보기 전환을 실제 React UI로 검증한다.
// 금융 데이터는 전부 가상 fixture이며 모든 네트워크 요청은 가로채거나 차단한다.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";

const cwd = process.cwd();
const out = path.join(cwd, "output", "project-amounts-ui");
const temp = await mkdtemp(path.join(os.tmpdir(), "erp-project-amounts-"));
await mkdir(out, { recursive: true });

const baseProject = {
  status: "active", entities: ["네안데르"], revenues: [], lines: [], installments: [],
  createdAt: 0, startDate: "2026-10-01", endDate: "2026-11-15", deliveryDate: "2026-11-15",
};
const fixture = {
  projects: [
    {
      ...baseProject, id: "mixed-vat", code: "VAT-MIX", name: "혼합 세액 검증", client: "가상 거래처",
      contractAmount: 1_000_000, vatMode: "excluded",
      revenues: [{ id: "exempt-extra", label: "면세 추가 수입", amount: 200_000, vatMode: "exempt" }],
      deductions: [{ id: "keep-invoice", label: "세금계산서 유지 차감", amount: 100_000, taxMode: "none" }],
      installments: [
        { id: "paid", kind: "선금", amount: 500_000, dueDate: "2026-10-01", paidDate: "2026-10-01" },
        { id: "late", kind: "잔금", amount: 500_000, dueDate: "2026-10-15" },
      ],
      lines: [
        { id: "actual", category: "물품", item: "실제 원가", qty: 1, unitPrice: 200_000, actual: 220_000 },
        { id: "estimate", category: "식대", item: "남은 견적", qty: 1, unitPrice: 30_000 },
      ],
    },
    {
      ...baseProject, id: "exempt", code: "VAT-NONE", name: "면세 및 확정 영원 검증", status: "done",
      contractAmount: 1_150_000, vatMode: "exempt",
      installments: [{ id: "paid", kind: "전액", amount: 1_150_000, paidDate: "2026-10-20" }],
      lines: [{ id: "owned", category: "장비", item: "기존 보유 장비", qty: 1, unitPrice: 0, actual: 0 }],
    },
    {
      ...baseProject, id: "included", code: "VAT-IN", name: "포함 금액 및 원가 미입력 검증", status: "planning",
      contractAmount: 1_100_000, vatMode: "included",
      installments: [{ id: "future", kind: "전액", amount: 1_100_000, dueDate: "2026-11-15" }],
    },
    {
      ...baseProject, id: "cancelled", code: "CANCEL", name: "취소 합계 제외 검증", status: "cancelled",
      contractAmount: 999_000_000, vatMode: "excluded",
    },
  ],
  transactions: [], docs: [], accounts: [], paymentMethods: [], loading: false,
};
const mocks = {
  finance: `export const useFinance=()=>({...window.__projectFixture,refresh:async()=>{}});`,
  auth: `const user={getIdToken:async()=>'fixture-only'};export const getNeanderAuth=()=>({currentUser:user,onAuthStateChanged(callback){queueMicrotask(()=>callback(user));return()=>{}}});`,
  grants: `export const useGrants=()=>({grants:[],loading:false,error:null,refresh:async()=>{}});`,
  shell: `export const ToolbarPortal=({children})=>children;export const useCrumbTail=()=>{};`,
  navigation: `export const usePathname=()=>'/neander/finance/projects';export const useRouter=()=>({push(url){window.__navigations.push(url)}});`,
  link: `import {forwardRef} from 'react';export default forwardRef(function Link({href,children,prefetch,replace,scroll,...props},ref){return <a ref={ref} href={typeof href==='string'?href:'#'} {...props}>{children}</a>});`,
};

let browser;
let page;
const errors = [];
const requests = [];
const checks = [];
try {
  const bundle = await build({
    absWorkingDir: cwd, bundle: true, write: false, outfile: path.join(temp, "fixture.js"),
    format: "iife", platform: "browser", jsx: "automatic", logLevel: "silent",
    stdin: { resolveDir: cwd, loader: "tsx", contents: `
import {createRoot} from 'react-dom/client';
import Page from './app/neander/finance/projects/page.neander.tsx';
import {ConfirmProvider,ToastProvider} from './components/neander/ui';
createRoot(document.getElementById('root')).render(<div data-app="neander" id="fixture-app"><ConfirmProvider><ToastProvider><Page/></ToastProvider></ConfirmProvider></div>);` },
    plugins: [{ name: "project-amount-fixtures", setup(builder) {
      builder.onResolve({ filter: /(?:^|\/)FinanceProvider$/ }, () => ({ path: "finance", namespace: "fixture" }));
      builder.onResolve({ filter: /^@\/lib\/neander\/firebase$/ }, () => ({ path: "auth", namespace: "fixture" }));
      builder.onResolve({ filter: /^@\/lib\/neander\/finance\/grant-client$/ }, () => ({ path: "grants", namespace: "fixture" }));
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
    + "\nbody{margin:0;font-family:system-ui,sans-serif}#fixture-app{min-height:100vh;padding:24px;background:rgb(var(--nd-bg-page))}@media(max-width:600px){#fixture-app{padding:12px}}\n"
    + bundle.outputFiles.filter((file) => file.path.endsWith(".css")).map((file) => file.text).join("\n");
  const js = bundle.outputFiles.find((file) => file.path.endsWith(".js")).text;
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1440, height: 1080 }, timezoneId: "Asia/Seoul" });
  page.setDefaultTimeout(7_000);
  await page.clock.setFixedTime(new Date("2026-10-31T03:00:00.000Z"));
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript((data) => {
    window.__projectFixture = data;
    window.__navigations = [];
    window.process = { env: { NODE_ENV: "test" }, browser: true };
  }, fixture);
  await page.route("**/*", async (route) => {
    const request = route.request(), url = new URL(request.url());
    requests.push({ method: request.method(), host: url.host, path: url.pathname });
    if (url.host === "localhost:43164" && url.pathname === "/fixture" && request.method() === "GET") {
      return route.fulfill({ contentType: "text/html; charset=utf-8", body: '<!doctype html><html lang="ko"><head><meta charset="utf-8"></head><body><div id="root"></div></body></html>' });
    }
    return route.abort("blockedbyclient");
  });
  await page.goto("http://localhost:43164/fixture");
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: js });

  const profit = page.locator('section[aria-label="프로젝트 손익"]');
  const collection = page.locator('section[aria-label="수금 현황"]');
  const table = page.locator("table");
  const row = (name) => table.getByRole("link", { name: `${name} 상세`, exact: true });
  const mixed = row("혼합 세액 검증");
  const view = page.getByRole("radiogroup", { name: "프로젝트 금액 보기" });
  const search = page.getByLabel("프로젝트 검색", { exact: true });
  const normalized = (text) => text.replace(/\s+/g, " ").trim();
  async function hasAmount(scope, value) {
    await expect.poll(async () => (await scope.locator(".nd-num").allTextContents()).map((text) => text.replace(/[\s원]/g, "")))
      .toContain(value.toLocaleString("ko-KR"));
  }
  async function noPageOverflow(label) {
    const width = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
    assert.ok(width.scroll <= width.client + 1, `${label}: 문서 가로 넘침 ${width.scroll}>${width.client}`);
    checks.push(`${label}: no document overflow`);
  }

  await expect(profit).toBeVisible();
  await expect(collection).toBeVisible();
  // 면세 추가 수입과 세금계산서를 유지한 차감 때문에 총액 ≠ 공급가액 × 1.1.
  await hasAmount(profit, 3_250_000);
  await hasAmount(profit, 3_450_000);
  await hasAmount(profit, 250_000);
  await hasAmount(profit, 3_000_000);
  await hasAmount(collection, 1_750_000);
  await expect(profit).not.toContainText("3,575,000");
  await expect(profit).toContainText(/공급가액\s*미확인/);
  await expect(profit).toContainText("잠정 이익");
  await expect(profit).toContainText("원가 부가세 미조정");
  const mixedText = normalized(await mixed.innerText());
  assert.match(mixedText, /공급가액 1,100,000.*부가세 포함 1,200,000/);
  assert.match(mixedText, /공급가액 미확인.*입력액 250,000/);
  assert.ok(!mixedText.includes("227,273"), "원가를 임의로 1.1로 나누지 않는다");
  await expect(row("면세 및 확정 영원 검증")).not.toContainText("원가 미입력");
  await expect(row("포함 금액 및 원가 미입력 검증")).toContainText("원가 미입력");
  checks.push("Mixed VAT/deduction totals, cancelled exclusion, cost unknown VAT, known zero and missing cost");
  await noPageOverflow("desktop profitability");
  await page.screenshot({ path: path.join(out, "profit-desktop.png"), fullPage: true, animations: "disabled" });

  // 검색은 목록뿐 아니라 두 KPI 구역에도 동일하게 적용된다.
  await search.fill("혼합 세액");
  await expect(table.locator("tbody tr")).toHaveCount(1);
  await hasAmount(profit, 1_100_000);
  await hasAmount(profit, 1_200_000);
  await hasAmount(profit, 850_000);
  await hasAmount(collection, 650_000);
  await search.fill("없는 프로젝트 검색");
  await expect(page.getByText("조건에 맞는 프로젝트가 없습니다", { exact: true })).toBeVisible();
  await hasAmount(profit, 0);
  await search.fill("");
  await expect(table.locator("tbody tr")).toHaveCount(4);
  checks.push("Search and empty state use matching filtered KPI totals");

  // 같은 매출 열이라도 손익에서는 공급가액, 수금에서는 총액을 정렬한다.
  await table.getByRole("button", { name: /매출액.*정렬/ }).click();
  await page.getByRole("button", { name: "큰 값부터", exact: true }).click();
  const profitOrder = await table.locator("tbody tr").allTextContents();
  assert.ok(profitOrder.findIndex((text) => text.includes("면세 및 확정 영원 검증")) < profitOrder.findIndex((text) => text.includes("혼합 세액 검증")), "손익은 공급가액 115만 > 110만 순서로 정렬한다");
  await view.getByRole("radio", { name: "수금·정산", exact: true }).click();
  await expect(view.getByRole("radio", { name: "수금·정산", exact: true })).toHaveAttribute("aria-checked", "true");
  await expect(table).toContainText("청구액");
  await expect(table).toContainText("입금액");
  await expect(table).toContainText("미수금");
  const settlement = normalized(await mixed.innerText());
  assert.match(settlement, /공급가액 1,100,000.*부가세 포함 1,200,000/);
  assert.ok(settlement.includes("550,000") && settlement.includes("650,000"), "입금액·미수금은 실제 총액을 유지한다");
  await expect(table.getByRole("columnheader", { name: /청구액/ })).toHaveAttribute("aria-sort", "descending");
  const switchedOrder = await table.locator("tbody tr").allTextContents();
  assert.ok(switchedOrder.findIndex((text) => text.includes("혼합 세액 검증")) < switchedOrder.findIndex((text) => text.includes("면세 및 확정 영원 검증")), "수금으로 전환하면 같은 내림차순도 총액 120만 > 115만으로 바뀐다");
  const grossHeader = table.getByRole("button", { name: /청구액.*정렬/ });
  await grossHeader.click();
  await page.getByRole("button", { name: "작은 값부터", exact: true }).click();
  await page.getByRole("button", { name: "큰 값부터", exact: true }).click();
  const order = await table.locator("tbody tr").allTextContents();
  const mixedIndex = order.findIndex((value) => value.includes("혼합 세액 검증"));
  const exemptIndex = order.findIndex((value) => value.includes("면세 및 확정 영원 검증"));
  assert.ok(mixedIndex < exemptIndex, "청구액 정렬은 공급가액 대신 실제 총액 120만 > 115만을 사용한다");
  await noPageOverflow("desktop settlement");
  await page.screenshot({ path: path.join(out, "settlement-desktop.png"), fullPage: true, animations: "disabled" });
  checks.push("Settlement tab shows actual total amounts and sorts by gross instead of supply");

  // 보조 열은 숨겨도 데이터와 정렬·필터 동작을 잃지 않는다.
  await page.getByRole("button", { name: /표시 항목/ }).click();
  const display = page.getByRole("dialog");
  await expect(display).toBeVisible();
  await display.getByRole("checkbox", { name: "사업체", exact: true }).check();
  await page.keyboard.press("Escape");
  await expect(table.getByRole("columnheader", { name: /사업체/ })).toBeVisible();
  checks.push("Optional business column remains available");

  // 캡처는 검증용 정렬과 보조 열을 지워 목업과 같은 기본 보기로 남긴다.
  await page.getByRole("button", { name: "정렬 해제", exact: true }).click();
  await page.getByRole("button", { name: /표시 항목/ }).click();
  await display.getByRole("checkbox", { name: "사업체", exact: true }).uncheck();
  await page.keyboard.press("Escape");
  await page.screenshot({ path: path.join(out, "settlement-desktop-clean.png"), fullPage: true, animations: "disabled" });
  await page.setViewportSize({ width: 390, height: 844 });
  const searchBox = await search.boundingBox();
  assert.ok(searchBox && searchBox.width >= 180, "모바일에서도 프로젝트 검색어를 읽고 입력할 폭을 확보한다");
  checks.push("Mobile search remains usable beside amount-display labels");
  await noPageOverflow("mobile settlement");
  await page.screenshot({ path: path.join(out, "settlement-mobile.png"), fullPage: true, animations: "disabled" });
  await view.getByRole("radio", { name: "손익", exact: true }).click();
  await expect(view.getByRole("radio", { name: "손익", exact: true })).toHaveAttribute("aria-checked", "true");
  await expect(table.getByRole("columnheader", { name: /매출액/ })).toBeVisible();
  await noPageOverflow("mobile profitability");
  await page.screenshot({ path: path.join(out, "profit-mobile.png"), fullPage: true, animations: "disabled" });
  assert.deepEqual(errors, [], "브라우저 런타임 오류 없음");
  assert.deepEqual(requests.filter((request) => request.method !== "GET"), [], "금융 쓰기 요청 없음");
  assert.deepEqual(await page.evaluate(() => window.__projectFixture), fixture, "UI 보기 전환은 원본 금융 데이터를 변경하지 않는다");
  const report = { passed: true, checks, errors, requests, screenshots: ["profit-desktop.png", "settlement-desktop.png", "settlement-desktop-clean.png", "profit-mobile.png", "settlement-mobile.png"] };
  await writeFile(path.join(out, "report.json"), JSON.stringify(report, null, 2));
  console.log(`PASS project amount UI: ${checks.join("; ")}. All requests mocked/blocked. Screenshots: ${out}`);
} catch (error) {
  await page?.screenshot({ path: path.join(out, "failure.png"), fullPage: true }).catch(() => {});
  await writeFile(path.join(out, "report.json"), JSON.stringify({ passed: false, checks, errors, requests, failure: error.stack }, null, 2));
  throw error;
} finally {
  await browser?.close();
  await rm(temp, { recursive: true, force: true });
}
