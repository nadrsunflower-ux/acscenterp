// 지원금 지급 내역 UI 전용. 가상 localhost의 모든 요청을 모의 응답하거나 차단한다.
// 실제 인증 프로필, 운영 API, Firestore를 사용하지 않는다.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";

const cwd = process.cwd();
const grantId = "fixture-grant";
const makeGrant = (patch = {}) => ({
  id: grantId, code: "UI-GRANT", name: "지급 내역 검증용 지원사업", kind: "정부지원금", status: "active",
  entity: "네안데르", total: 2100000, createdAt: 1, budget: [],
  installments: [
    { id: "manual-one", label: "원장 밖 수령 회차", amount: 100000, dueDate: "2025-12-31", received: true, note: "이전 장부 수령" },
    { id: "complete-one", label: "전액 수령 회차", amount: 500000, dueDate: "2026-01-01" },
    { id: "partial-one", label: "부분 수령 회차", amount: 1000000, dueDate: "2026-01-02", note: "잔액 구분 검증" },
    { id: "future-one", label: "앞으로 지급될 회차", amount: 500000, dueDate: "2099-12-31", note: "미래 지급 메모" },
  ],
  alloc: { "income-one": "in" },
  ...patch,
});
const finance = {
  loading: false,
  transactions: [
    { id: "income-one", date: "2026-10-29", datetime: "2026-10-29 10:00:00", last4: "4248", vendor: "검증용 지급기관", gross: 900000, adjust: 0, txType: "수입", acctMajor: "기타수입", acctMid: "지원금", acctMinor: "정부지원금", projectCode: "UI-GRANT", note: "실제 입금 내역 fixture", status: "confirmed" },
    { id: "refund-one", date: "2026-10-30", last4: "4248", vendor: "검증용 지급기관 반환", gross: 100000, adjust: 0, txType: "지출", acctMajor: "환불·반환", acctMid: "환불지출", acctMinor: "지원금환불", projectCode: "UI-GRANT", note: "실제 반납 fixture", status: "confirmed" },
  ],
  paymentMethods: [{ id: "4248", last4: "4248", alias: "실제입금통장", site: "네안데르", personal: false, kind: "account" }],
};

const mocks = {
  navigation: `export const useParams=()=>({id:${JSON.stringify(grantId)}});export const useRouter=()=>({push(){},replace(){},refresh(){}});export const usePathname=()=>"/neander/finance/grants/${grantId}";export const useSearchParams=()=>new URLSearchParams();`,
  finance: `export const useFinance=()=>window.__grantPaymentFinance;`,
  shell: `export const useCrumbTail=()=>{};export const ToolbarPortal=({children})=>children;`,
  auth: `const user={getIdToken:async()=>"fixture-only"};export const getNeanderAuth=()=>({currentUser:user,onAuthStateChanged(callback){queueMicrotask(()=>callback(user));return()=>{}}});`,
  link: `import {forwardRef} from 'react';export default forwardRef(function Link({href,children,prefetch,replace,scroll,...props},ref){return <a ref={ref} href={typeof href==='string'?href:'#'} {...props}>{children}</a>});`,
};
const bundle = await build({
  absWorkingDir: cwd, bundle: true, write: false, outdir: "/tmp/grant-payment-ui-fixture", format: "iife", platform: "browser", jsx: "automatic", logLevel: "silent",
  stdin: { resolveDir: cwd, loader: "tsx", contents: `import {createRoot} from 'react-dom/client';import Page from './app/neander/finance/grants/[id]/page.neander.tsx';import {ConfirmProvider,ToastProvider} from './components/neander/ui';createRoot(document.getElementById('root')).render(<div data-app="neander" style={{padding:24,minHeight:'100vh'}}><ConfirmProvider><ToastProvider><Page/></ToastProvider></ConfirmProvider></div>);` },
  plugins: [{ name: "grant-payment-fixtures", setup(builder) {
    builder.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: "navigation", namespace: "fixture" }));
    builder.onResolve({ filter: /^next\/link$/ }, () => ({ path: "link", namespace: "fixture" }));
    builder.onResolve({ filter: /(?:^|\/)FinanceProvider$/ }, () => ({ path: "finance", namespace: "fixture" }));
    builder.onResolve({ filter: /^@\/components\/neander\/shell\/context$/ }, () => ({ path: "shell", namespace: "fixture" }));
    builder.onResolve({ filter: /^@\/lib\/neander\/firebase$/ }, () => ({ path: "auth", namespace: "fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({ contents: mocks[path], loader: "tsx", resolveDir: cwd }));
  } }],
});

let browser;
const apiCalls = [];
const saves = [];
const pageErrors = [];
const styleFiles = [".next-neander/static/css/app/layout.css", ".next-neander/static/css/app/neander/layout.neander.css"];
const sharedStyles = styleFiles.filter(existsSync).map((file) => readFileSync(file, "utf8").replace(/@import[^;]+;/g, ""));
if (!sharedStyles.length) sharedStyles.push(readFileSync("app/neander/neander.css", "utf8"));
let grant = makeGrant();
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.addInitScript((data) => {
    window.__grantPaymentFinance = data;
    window.process = { env: { NODE_ENV: "test" }, browser: true };
  }, finance);
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const call = { method: request.method(), host: url.host, pathname: url.pathname, blocked: false };
    apiCalls.push(call);
    if (url.host !== "localhost:43160") { call.blocked = true; return route.abort("blockedbyclient"); }
    if (url.pathname === "/fixture") return route.fulfill({ contentType: "text/html", body: '<!doctype html><html><body><div id="root"></div></body></html>' });
    if (url.pathname !== "/api/neander/finance/grants") { call.blocked = true; return route.abort("blockedbyclient"); }
    if (request.method() === "GET") return route.fulfill({ json: { grants: [grant] } });
    if (request.method() === "POST") {
      const body = request.postDataJSON();
      assert.equal(body.id, grantId);
      saves.push(body);
      grant = { ...body.grant, id: grantId, createdAt: 1 };
      return route.fulfill({ json: { id: grantId } });
    }
    return route.fulfill({ status: 405, json: { error: "fixture에서는 이 요청을 허용하지 않습니다." } });
  });
  async function boot(hash, patch = {}) {
    grant = makeGrant(patch);
    saves.length = 0;
    pageErrors.length = 0;
    await page.goto(`http://localhost:43160/fixture${hash}`);
    for (const css of sharedStyles) await page.addStyleTag({ content: css });
    for (const output of bundle.outputFiles.filter((file) => file.path.endsWith(".css"))) await page.addStyleTag({ content: output.text });
    await page.addScriptTag({ content: bundle.outputFiles.find((file) => file.path.endsWith(".js")).text });
    await expect(page.getByRole("heading", { name: "지급 내역 검증용 지원사업" })).toBeVisible();
  }

  const received = page.locator('[data-grant-payment-sheet="받은 내역"]');
  const planned = page.locator('[data-grant-payment-sheet="지급 예정 내역"]');
  const amounts = (sheet) => sheet.locator('[data-payment-field="amount"]').allTextContents();
  async function installmentRow(sheet, label) {
    const rows = sheet.locator('.grant-payment-row-manual, .grant-payment-row-planned');
    for (let i = 0; i < await rows.count(); i++) {
      if (await rows.nth(i).locator("input").evaluateAll((inputs, expected) => inputs.some((input) => input.value === expected), label)) return rows.nth(i);
    }
    throw new Error(`지급 회차 행을 찾지 못했습니다: ${label}`);
  }

  for (const hash of ["#received", "#receive", "#receivable"]) {
    await boot(hash);
    await expect.poll(() => new URL(page.url()).hash).toBe("#receivable");
    await expect(page.getByRole("tab", { name: /^지급\(예정\)내역/ })).toHaveCount(1);
    await expect(page.getByRole("tab", { name: /^받은 돈/ })).toHaveCount(0);
    await expect(page.getByRole("tab")).toHaveCount(4);
    await expect(received).toBeVisible();
    await expect(planned).toBeVisible();
    assert.ok((await received.boundingBox()).y < (await planned.boundingBox()).y, "수령 표가 예정 표 위에 있다");
    assert.equal(saves.length, 0, "탭·이전 주소 조회만으로 저장하지 않는다");
    assert.deepEqual(pageErrors, []);
  }
  await expect(received.locator(".grant-payment-row-ledger")).toHaveCount(2);
  await expect(received.locator(".grant-payment-row-manual")).toHaveCount(1);
  await expect(planned.locator(".grant-payment-row-planned")).toHaveCount(2);
  assert.deepEqual(await amounts(received), ["900,000", "-100,000", "100,000"]);
  assert.deepEqual(await amounts(planned), ["700,000", "500,000"]);
  await expect(received.locator(".grant-payment-row-ledger input")).toHaveCount(0);
  await expect(received.locator('.grant-payment-row-manual [data-payment-field="date"]')).toHaveText("일자 미기록");
  await expect(page.locator("[data-nd-kpi]").first()).toContainText("900,000");
  await expect(page.locator("[data-nd-kpi]").first()).toContainText("1,200,000");
  const manualBadge = received.locator(".grant-payment-row-manual").getByText("원장 밖 수령", { exact: true });
  const badgeBox = await manualBadge.boundingBox();
  const statusBox = await manualBadge.locator('xpath=ancestor::*[contains(concat(" ",normalize-space(@class)," ")," dsg-cell ")][1]').boundingBox();
  assert.ok(badgeBox.x + badgeBox.width <= statusBox.x + statusBox.width + 1, "수동 수령 상태가 열 안에 맞는다");

  // 부분 회차의 수정 창에는 잔액이 아닌 약정 전체 금액을 보여준다.
  await planned.getByRole("button", { name: "수정: 부분 수령 회차", exact: true }).click();
  let dialog = page.getByRole("dialog", { name: "회차 수정" });
  await expect(dialog.getByLabel("회차 전체 금액", { exact: true })).toHaveValue("1,000,000");
  await dialog.getByLabel("회차 이름", { exact: true }).fill("취소할 임시 이름");
  await dialog.getByRole("button", { name: "취소", exact: true }).click();
  assert.equal(saves.length, 0, "회차 수정 취소는 저장하지 않는다");
  assert.deepEqual(await amounts(planned), ["700,000", "500,000"]);

  // 키보드로 값을 확정한 다음 다른 셀을 편집하는 동안 자동 저장이 끝나도 초점을 유지한다.
  const future = await installmentRow(planned, "앞으로 지급될 회차");
  const labelInput = future.locator("input.dsg-input").first();
  await labelInput.locator("..").click();
  await expect(labelInput).toBeFocused();
  await page.keyboard.press("Enter");
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type("키보드로 바꾼 회차");
  await page.keyboard.press("Tab");
  const noteInput = future.locator("input.dsg-input").last();
  await noteInput.locator("..").click();
  await expect(noteInput).toBeFocused();
  await page.keyboard.press("Enter");
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type("저장 중에도 유지할 메모");
  const noteHandle = await noteInput.elementHandle();
  await expect.poll(() => saves.at(-1)?.grant.installments.find((inst) => inst.id === "future-one")?.label).toBe("키보드로 바꾼 회차");
  assert.equal(await noteHandle.evaluate((input) => document.activeElement === input), true, "자동 저장·목록 재수신 중 입력 초점 유지");
  await expect(noteInput).toHaveValue("저장 중에도 유지할 메모");
  await page.keyboard.press("Tab");
  await expect.poll(() => saves.at(-1)?.grant.installments.find((inst) => inst.id === "future-one")?.note).toBe("저장 중에도 유지할 메모");
  assert.deepEqual(await amounts(planned), ["700,000", "500,000"]);

  // 관리 버튼의 적용과 저장은 동일한 회차를 수정하며 실제 은행 거래는 변하지 않는다.
  await planned.getByRole("button", { name: "수정: 부분 수령 회차", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "회차 수정" });
  await dialog.getByLabel("회차 메모", { exact: true }).fill("대화상자로 적용한 메모");
  await dialog.getByRole("button", { name: "적용", exact: true }).click();
  await expect.poll(() => saves.at(-1)?.grant.installments.find((inst) => inst.id === "partial-one")?.note).toBe("대화상자로 적용한 메모");
  assert.deepEqual(await amounts(received), ["900,000", "-100,000", "100,000"]);
  assert.deepEqual(await amounts(planned), ["700,000", "500,000"]);
  assert.ok(apiCalls.filter((call) => call.method === "POST").every((call) => call.pathname === "/api/neander/finance/grants"));
  await expect(page.getByRole("button", { name: "전체 회차 설정" })).toBeVisible();
  await expect(page.getByRole("button", { name: "이 사업의 입금 연결 관리" })).toBeVisible();
  await page.screenshot({ path: "/tmp/grant-payments-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(received).toBeVisible();
  await expect(planned).toBeVisible();
  const mobileBounds = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  assert.ok(mobileBounds.scroll <= mobileBounds.width + 1, "모바일 페이지 자체는 가로로 넘치지 않는다");
  for (const sheet of [received, planned]) {
    const bounds = await sheet.locator(".dsg-container").evaluate((node) => ({ x: node.scrollWidth > node.clientWidth, y: node.scrollHeight > node.clientHeight + 1 }));
    assert.equal(bounds.x, true, "좁은 표에서 가로 스크롤을 제공한다");
    assert.equal(bounds.y, false, "받은/예정 표의 행을 세로 스크롤 없이 표시한다");
  }
  await page.screenshot({ path: "/tmp/grant-payments-mobile.png", fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });

  await boot("#receivable", { total: 0 });
  await expect(page.getByText("총 지원금액 미확인.", { exact: true })).toBeVisible();
  await expect(page.locator("[data-nd-kpi]").first()).toContainText("미확인");
  assert.equal(saves.length, 0);
  assert.deepEqual(pageErrors, []);
  assert.ok(apiCalls.every((call) => call.blocked || call.host === "localhost:43160"));
  console.log("PASS grant-payment UI: single tab/legacy aliases, received above planned, actual/manual/refund once, partial remaining, readonly ledger, keyboard editing/focus across autosave, dialog cancel/apply, unknown total, mobile containment. All requests mocked. Screenshots: /tmp/grant-payments-desktop.png and /tmp/grant-payments-mobile.png");
} finally {
  await browser?.close();
}
