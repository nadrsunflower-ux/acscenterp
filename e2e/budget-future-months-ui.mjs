// 실제 예산 페이지·MonthStepper·TreeTable·저장 client를 사용한다.
// 모든 요청은 메모리 fixture 응답 또는 차단이며 실제 금융 API에 연결하지 않는다.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";

const cwd = process.cwd();
const path = "운영비|일반운영비|소모품비";
const accounts = ["소모품비", "구독료"].map((minor, i) => ({
  id: `expense-${i}`, txType: "지출", major: "운영비", mid: "일반운영비", minor, active: true,
  code: `FIXTURE-${i}`, vat: "해당없음", asset: "비자산", pay: "계좌이체", branch: "HQ",
}));
const baseState = {
  loading: false, masterEmpty: false, accounts,
  paymentMethods: [{ id: "4248", last4: "4248", alias: "검증 계좌", site: "네안데르", kind: "account" }],
  transactions: ["2026-08-05", "2026-10-10"].map((date, i) => ({
    id: `fixture-expense-${i}`, date, last4: "4248", vendor: "예산 검증 비용", txType: "지출", gross: 1000 + i * 1000,
    adjust: 0, status: "confirmed", site: "네안데르", bizMajor: "공용", bizMinor: "공용",
    acctMajor: "운영비", acctMid: "일반운영비", acctMinor: "소모품비", note: "검증용 원장 보존",
  })),
  budgets: [
    { id: "2026-08", month: "2026-08", lines: { [path]: 80000 } },
    { id: "2026-10", month: "2026-10", lines: { [path]: 100000 } },
  ], projects: [], anomalyIgnores: [],
};
const mocks = {
  finance: `import {useSyncExternalStore} from 'react';const listeners=new Set();const subscribe=fn=>{listeners.add(fn);return()=>listeners.delete(fn)};const snapshot=()=>window.__budgetFixture;export function useFinance(){const data=useSyncExternalStore(subscribe,snapshot,snapshot);return {...data,refresh:async()=>{const response=await fetch('/fixture-state');window.__budgetFixture=await response.json();listeners.forEach(fn=>fn())}}}`,
  auth: `const user={getIdToken:async()=>'fixture-only'};export const getNeanderAuth=()=>({currentUser:user});`,
  shell: `export const ToolbarPortal=({children})=>children;export const useCrumbTail=()=>{};`,
  navigation: `export const usePathname=()=>'/neander/finance/reports/budget';export const useRouter=()=>({push(){throw new Error('Unexpected navigation in budget fixture')}});`,
  link: `import {forwardRef} from 'react';export default forwardRef(function Link({href,children,prefetch,replace,scroll,...props},ref){return <a ref={ref} href={typeof href==='string'?href:'#'} {...props}>{children}</a>});`,
};
const bundle = await build({
  absWorkingDir: cwd, bundle: true, write: false, outdir: "/tmp/budget-future-fixture", format: "iife", platform: "browser", jsx: "automatic", logLevel: "silent",
  stdin: { resolveDir: cwd, loader: "tsx", contents: `import {createRoot} from 'react-dom/client';import Page from './app/neander/finance/reports/budget/page.neander.tsx';import {ConfirmProvider,ToastProvider} from './components/neander/ui';createRoot(document.getElementById('root')).render(<div data-app="neander" style={{padding:24}}><ConfirmProvider><ToastProvider><Page/></ToastProvider></ConfirmProvider></div>);` },
  plugins: [{ name: "budget-fixtures", setup(builder) {
    builder.onResolve({ filter: /(?:^|\/)FinanceProvider$/ }, () => ({ path: "finance", namespace: "fixture" }));
    builder.onResolve({ filter: /^@\/lib\/neander\/firebase$/ }, () => ({ path: "auth", namespace: "fixture" }));
    builder.onResolve({ filter: /^@\/components\/neander\/shell\/context$/ }, () => ({ path: "shell", namespace: "fixture" }));
    builder.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: "navigation", namespace: "fixture" }));
    builder.onResolve({ filter: /^next\/link$/ }, () => ({ path: "link", namespace: "fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({ contents: mocks[path], loader: "tsx", resolveDir: cwd }));
  } }],
});
const styles = [".next-neander/static/css/app/layout.css", ".next-neander/static/css/app/neander/layout.neander.css"]
  .filter(existsSync).map((file) => readFileSync(file, "utf8").replace(/@import[^;]+;/g, ""));
let state = structuredClone(baseState), seedMonth = "2026-10", browser, page;
let holdNextSave = false, releaseSave;
const saves = [], forbidden = [], errors = [];
try {
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, timezoneId: "Asia/Seoul" });
  page.setDefaultTimeout(5000);
  await page.clock.setFixedTime(new Date("2026-10-31T03:00:00.000Z"));
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", async (route) => {
    const request = route.request(), url = new URL(request.url());
    if (url.host !== "localhost:43163") return route.abort("blockedbyclient");
    if (url.pathname === "/fixture" && request.method() === "GET") {
      const initializeStorage = seedMonth === null ? "" : `localStorage.setItem('neander.sticky.finance.reports.budget.month',${JSON.stringify(JSON.stringify(seedMonth))});localStorage.setItem('neander.sticky.finance.reports.month','"2026-08"');localStorage.setItem('neander.sticky.finance.reports.budget.showEmpty','false');`;
      seedMonth = null;
      return route.fulfill({ contentType: "text/html; charset=utf-8", body: `<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script>window.__budgetFixture=${JSON.stringify(state)};window.process={env:{NODE_ENV:'test'},browser:true};${initializeStorage}</script></body></html>` });
    }
    if (url.pathname === "/fixture-state" && request.method() === "GET") return route.fulfill({ json: state });
    if (url.pathname !== "/api/neander/finance/mutate" || request.method() !== "POST") {
      forbidden.push({ method: request.method(), path: url.pathname });
      return route.abort("blockedbyclient");
    }
    const body = request.postDataJSON();
    if (body.action !== "budget.save") { forbidden.push(body); return route.abort("blockedbyclient"); }
    assert.match(body.payload.month, /^\d{4}-(?:0[1-9]|1[0-2])$/);
    assert.ok(Object.values(body.payload.lines).every((value) => Number.isInteger(value)), "실제 NumberInput/client는 숫자를 저장한다");
    saves.push(structuredClone(body.payload));
    if (holdNextSave) {
      holdNextSave = false;
      await new Promise((resolve) => { releaseSave = resolve; });
      releaseSave = undefined;
    }
    const budget = { id: body.payload.month, ...body.payload };
    state = { ...state, budgets: [...state.budgets.filter((item) => item.month !== budget.month), budget] };
    return route.fulfill({ json: { ok: true, saved: Object.keys(budget.lines).length } });
  });
  const label = (month) => { const [year, m] = month.split("-").map(Number); return `${year}년 ${m}월`; };
  async function expectMonth(month) {
    await expect(page.getByRole("button", { name: `월 선택: ${label(month)}`, exact: true })).toBeVisible();
  }
  async function boot(month, nextState) {
    if (nextState) state = structuredClone(nextState);
    if (month !== undefined) seedMonth = month;
    await page.goto("http://localhost:43163/fixture");
    for (const css of styles) await page.addStyleTag({ content: css });
    for (const output of bundle.outputFiles.filter((file) => file.path.endsWith(".css"))) await page.addStyleTag({ content: output.text });
    await page.addScriptTag({ content: bundle.outputFiles.find((file) => file.path.endsWith(".js")).text });
  }
  const copy = () => page.getByRole("button", { name: "지난달 예산 복사", exact: true });
  const amount = () => page.getByRole("textbox", { name: "소모품비 예산", exact: true });
  async function expand() {
    await page.getByRole("button", { name: "모두 펼치기", exact: true }).click();
    await expect(amount()).toBeVisible();
  }
  async function step(direction, month) {
    const button = page.getByRole("button", { name: direction === "next" ? "다음 달" : "이전 달", exact: true });
    await expect(button).toBeEnabled(); await button.click(); await expectMonth(month);
  }
  async function save(month, value) {
    const count = saves.length;
    await amount().fill(String(value));
    assert.equal(saves.length, count, "예산 입력만으로 저장 요청을 보내지 않는다");
    await page.getByRole("button", { name: /^저장 \(\d+\)$/ }).click();
    await expect.poll(() => saves.length).toBe(count + 1);
    assert.equal(saves.at(-1).month, month); assert.equal(saves.at(-1).lines[path], value);
    await expect(page.getByRole("button", { name: /^저장 \(\d+\)$/ })).toHaveCount(0);
    await expect(amount()).toHaveValue(value.toLocaleString("ko-KR"));
  }

  await boot("2026-10", baseState); await expectMonth("2026-10"); await expand();
  await expect(amount()).toHaveValue("100,000");
  await expect(copy()).toHaveAttribute("title", "2026년 9월 예산을 복사");
  await copy().click();
  await expect(page.getByText(/2026년 9월.*저장된 예산이 없습니다/)).toBeVisible();
  await expect(amount()).toHaveValue("100,000"); assert.equal(saves.length, 0);

  // 아직 거래/예산이 없는 다음 달을 실제 월 선택 메뉴에서 고를 수 있다.
  await page.getByRole("button", { name: "월 선택: 2026년 10월", exact: true }).click();
  await page.getByRole("menuitem", { name: "2026년 11월", exact: true }).click();
  await expectMonth("2026-11"); await expect(amount()).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "예산·지출 없는 계정도 보기" })).toBeChecked();
  await expect(copy()).toHaveAttribute("title", "2026년 10월 예산을 복사");
  await copy().click(); await expect(amount()).toHaveValue("100,000");
  await save("2026-11", 125000);

  // 미저장 이동 취소는 초안을 유지하고, 명시적으로 버리면 저장된 값은 남는다.
  const beforeDraftNavigation = saves.length;
  await amount().fill("126000");
  await page.getByRole("button", { name: "다음 달", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("저장하지 않은 예산이 있습니다");
  await dialog.getByRole("button", { name: "취소", exact: true }).click();
  await expectMonth("2026-11"); await expect(amount()).toHaveValue("126,000");
  await page.getByRole("button", { name: "다음 달", exact: true }).click();
  await dialog.getByRole("button", { name: "저장하지 않고 이동", exact: true }).click();
  await expectMonth("2026-12"); await step("prev", "2026-11");
  await expect(amount()).toHaveValue("125,000"); assert.equal(saves.length, beforeDraftNavigation);

  // 응답 대기 중에는 월을 바꾸거나 다른 금액을 입력할 수 없다.
  await amount().fill("130000"); holdNextSave = true;
  await page.getByRole("button", { name: /^저장 \(\d+\)$/ }).click();
  await expect.poll(() => typeof releaseSave).toBe("function");
  await expect(amount()).toBeDisabled();
  await page.getByRole("button", { name: "다음 달", exact: true }).click();
  await expectMonth("2026-11"); await expect(page.getByRole("dialog")).toHaveCount(0);
  assert.equal(state.budgets.find((item) => item.month === "2026-11").lines[path], 125000);
  releaseSave();
  await expect(amount()).toBeEnabled(); await expect(amount()).toHaveValue("130,000");
  await expect(page.getByRole("button", { name: /^저장 \(\d+\)$/ })).toHaveCount(0);
  await step("next", "2026-12"); await step("prev", "2026-11");
  await expect(amount()).toHaveValue("130,000");

  await step("next", "2026-12");
  await copy().click(); await expect(amount()).toHaveValue("130,000");
  await save("2026-12", 150000);
  await step("next", "2027-01");
  await expect(copy()).toHaveAttribute("title", "2026년 12월 예산을 복사");
  await copy().click(); await expect(amount()).toHaveValue("150,000");
  await save("2027-01", 175000);
  await boot(); await expectMonth("2027-01"); await expand();
  await expect(amount()).toHaveValue("175,000");
  assert.deepEqual(state.transactions, baseState.transactions, "예산 저장은 원장 거래에 영향을 주지 않는다");
  assert.equal(await page.evaluate(() => localStorage.getItem("neander.sticky.finance.reports.month")), '"2026-08"', "예산 달을 바꿔도 실적 리포트 월은 유지한다");

  // 기록이 없는 달과 멀리 떨어진 미래의 sticky 선택도 그대로 열리고 달력대로 이동한다.
  await boot("2026-09", baseState); await expectMonth("2026-09"); await expand();
  await expect(amount()).toBeVisible(); await step("next", "2026-10"); await step("prev", "2026-09");
  await step("prev", "2026-08");
  await boot("2028-04", baseState); await expectMonth("2028-04"); await expand();
  await step("next", "2028-05"); await step("prev", "2028-04");
  await boot(); await expectMonth("2028-04");

  // 기본 달은 KST 현재 월이며, 실적 없이 저장한 더 먼 미래 예산도 메뉴에서 연다.
  await boot("", { ...baseState, budgets: [...baseState.budgets, { id: "2031-12", month: "2031-12", lines: { [path]: 440000 } }] });
  await expectMonth("2026-10");
  await page.getByRole("button", { name: "월 선택: 2026년 10월", exact: true }).click();
  await page.getByRole("menuitem", { name: "2031년 12월", exact: true }).click();
  await expectMonth("2031-12"); await expand(); await expect(amount()).toHaveValue("440,000");

  // 계정 마스터가 있으면 거래/예산이 하나도 없어도 미래 예산을 먼저 입력한다.
  await boot("2026-11", { ...baseState, transactions: [], budgets: [] });
  await expectMonth("2026-11"); await expand();
  await save("2026-11", 30000);
  await step("next", "2026-12"); await step("prev", "2026-11");
  await expect(amount()).toHaveValue("30,000"); assert.deepEqual(state.transactions, []);
  assert.equal(forbidden.length, 0); assert.deepEqual(errors, []);
  console.log("PASS budget future months UI: future selection/save/return/sticky; calendar previous-month copy and January rollover; dirty-navigation cancel/discard; saving blocks edits/month changes; unrecorded/far-future/default-KST months; independent report filter; first budget with empty ledger. All HTTP mocked, no financial DB writes.");
} catch (error) {
  if (page) {
    console.error("Budget fixture page:", (await page.locator("body").innerText()).slice(0, 4500));
    console.error("Budget fixture errors:", errors);
    await page.screenshot({ path: "/tmp/budget-future-months-failure.png", fullPage: true });
  }
  throw error;
} finally {
  releaseSave?.();
  await browser?.close();
}
