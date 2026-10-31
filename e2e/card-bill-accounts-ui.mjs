// 계정 선택기·실제 원장 그리드·검토 페이지를 검증한다. 모든 요청은 모의 응답/차단한다.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";

const cwd = process.cwd();
const base = { example: "검증용", code: "FIXTURE", vat: "해당없음", asset: "비자산", pay: "계좌이체", branch: "HQ" };
const bill = { ...base, id: "bill", txType: "지출", major: "재무비용", mid: "금융비용", minor: "카드대금결제", active: true };
const ordinary = { ...base, id: "ordinary", txType: "지출", major: "운영비", mid: "일반운영비", minor: "일반소모품비", active: true };
const fee = { ...base, id: "fee", txType: "지출", major: "재무비용", mid: "금융비용", minor: "일반수수료", active: true };
const pickedBill = { acctMajor: bill.major, acctMid: bill.mid, acctMinor: bill.minor };
const pickedOrdinary = { acctMajor: ordinary.major, acctMid: ordinary.mid, acctMinor: ordinary.minor };
const fixture = {
  accounts: [bill, ordinary, fee], retiredAccounts: [{ ...bill, active: false }, ordinary, fee],
  paymentMethods: [{ id: "4248", last4: "4248", alias: "신한입금", site: "네안데르", personal: false, kind: "account" }],
  transactions: [
    { id: "review-card-bill", date: "2026-10-31", last4: "4248", vendor: "카드대금 확인용", txType: "카드대금결제", gross: 120000, adjust: 0, site: "네안데르", status: "needs_review", ...pickedBill },
    { id: "review-expense", date: "2026-10-31", last4: "4248", vendor: "일반 지출 확인용", txType: "지출", gross: 5000, adjust: 0, site: "네안데르", status: "needs_review", ...pickedOrdinary },
  ],
};
const mocks = {
  finance: `import {buildVendorIndex} from '@/lib/neander/finance/classify';const vendorIndex=buildVendorIndex([]);export const useFinance=()=>({...window.__cardFixture,projects:[],vendorRules:[],classRules:[],subscriptions:[],allocations:[],budgets:[],imports:[],closes:[],suspense:[],ledgerColumns:[],anomalyIgnores:[],trust:null,trustGate:undefined,vendorIndex,loading:false,masterEmpty:false,syncing:false,error:null,refresh:async()=>{},applyTransactions(){throw new Error('검토 fixture에서는 거래 쓰기를 허용하지 않습니다')}});`,
  auth: `const user={getIdToken:async()=>"fixture-only"};export const getNeanderAuth=()=>({currentUser:user,onAuthStateChanged(callback){queueMicrotask(()=>callback(user));return()=>{}}});`,
  calendar: `export const useDayEvents=()=>({meta:null,error:null,eventsOn:()=>[],ensure(){},reset(){}});export const DayEventsLine=()=>null;`,
  appData: `export const useAppData=()=>({members:[],currentMember:null,requests:[],sales:[],loading:false});`,
  link: `import {forwardRef} from 'react';export default forwardRef(function Link({href,children,prefetch,replace,scroll,...props},ref){return <a ref={ref} href={typeof href==='string'?href:'#'} {...props}>{children}</a>});`,
};
const entry = `import {useState,useEffect} from 'react';import {createRoot} from 'react-dom/client';
import {AccountPicker} from './components/neander/finance/AccountPicker';import {LedgerSheet} from './components/neander/finance/LedgerSheet';import {useSheetLayout} from './components/neander/finance/useSheetLayout';
import ReviewPage from './app/neander/finance/review/page.neander.tsx';import {ConfirmProvider,ToastProvider} from './components/neander/ui';
const fixture=window.__cardFixture;
function Picker({id,type,value={},retired=false}){const [row,setRow]=useState({txType:type,...value});return <section id={id}><h2>{id}</h2><AccountPicker accounts={retired?fixture.retiredAccounts:fixture.accounts} txType={row.txType} value={row} onChange={patch=>setRow(r=>({...r,...patch}))}/><output>{JSON.stringify(row)}</output></section>}
function AccountApp(){const [rows,setRows]=useState([{...fixture.transactions[1],id:'ledger-row'}]);const sheet=useSheetLayout('fixture.card-bill.layout');useEffect(()=>{window.__cardLedgerRows=rows},[rows]);return <>
<Picker id="bill-picker" type="카드대금결제"/><Picker id="refund-picker" type="환급"/>
<Picker id="retired-picker" type="카드대금결제" retired value={${JSON.stringify(pickedBill)}}/><Picker id="retired-empty-picker" type="카드대금결제" retired/>
<Picker id="wrong-picked-picker" type="카드대금결제" value={${JSON.stringify(pickedOrdinary)}}/>
<section id="ledger-grid"><h2>실제 원장 유형 변경 검증</h2><LedgerSheet rows={rows} onChange={setRows} accounts={fixture.accounts} paymentMethods={fixture.paymentMethods} sites={['네안데르']} issues={new Map()} dirtyIds={new Set()} createRow={()=>({...fixture.transactions[1],id:'new:fixture'})} onDetail={()=>{}} sort={null} onSort={()=>{}} filters={{}} onFilterChange={()=>{}} optionsFor={()=>[]} height={250} sheet={sheet}/></section></>}
createRoot(document.getElementById('root')).render(<div data-app="neander" style={{padding:24}}><ConfirmProvider><ToastProvider>{location.hash==='#review'?<ReviewPage/>:<AccountApp/>}</ToastProvider></ConfirmProvider></div>);`;
const bundle = await build({
  absWorkingDir: cwd, bundle: true, write: false, outdir: "/tmp/card-bill-account-fixture", format: "iife", platform: "browser", jsx: "automatic", logLevel: "silent",
  stdin: { resolveDir: cwd, loader: "tsx", contents: entry },
  plugins: [{ name: "card-bill-fixtures", setup(builder) {
    builder.onResolve({ filter: /(?:^|\/)FinanceProvider$/ }, () => ({ path: "finance", namespace: "fixture" }));
    builder.onResolve({ filter: /^@\/lib\/neander\/firebase$/ }, () => ({ path: "auth", namespace: "fixture" }));
    builder.onResolve({ filter: /(?:^|\/)DayEvents$/ }, () => ({ path: "calendar", namespace: "fixture" }));
    builder.onResolve({ filter: /^@\/components\/neander\/app-data$/ }, () => ({ path: "appData", namespace: "fixture" }));
    builder.onResolve({ filter: /^next\/link$/ }, () => ({ path: "link", namespace: "fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({ contents: mocks[path], loader: "tsx", resolveDir: cwd }));
  } }],
});
const styles = [".next-neander/static/css/app/layout.css", ".next-neander/static/css/app/neander/layout.neander.css"]
  .filter(existsSync).map((file) => readFileSync(file, "utf8").replace(/@import[^;]+;/g, ""));
const requests = [];
const pageErrors = [];
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.addInitScript((data) => {
    window.__cardFixture = data;
    window.process = { env: { NODE_ENV: "test" }, browser: true };
    localStorage.setItem("fixture.card-bill.layout", JSON.stringify({ widths: {}, rowHeight: 34, zoom: 1,
      hidden: ["date", "last4", "vendor", "bizMajor", "bizMinor", "gross", "adjust", "net", "site", "note", "status"] }));
  }, fixture);
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    requests.push({ method: request.method(), path: url.pathname, host: url.host });
    if (url.host === "localhost:43161" && url.pathname === "/fixture") return route.fulfill({ contentType: "text/html", body: '<!doctype html><html><body><div id="root"></div></body></html>' });
    return route.abort("blockedbyclient");
  });
  async function boot(hash = "") {
    pageErrors.length = 0;
    await page.goto(`http://localhost:43161/fixture${hash}`);
    for (const css of styles) await page.addStyleTag({ content: css });
    for (const output of bundle.outputFiles.filter((file) => file.path.endsWith(".css"))) await page.addStyleTag({ content: output.text });
    await page.addScriptTag({ content: bundle.outputFiles.find((file) => file.path.endsWith(".js")).text });
  }
  const values = (select) => select.locator("option").evaluateAll((options) => options.map((option) => option.value).filter(Boolean));
  async function pick(scope, major, mid, minor) {
    await scope.getByLabel("계정대분류", { exact: true }).selectOption(major);
    await scope.getByLabel("계정중분류", { exact: true }).selectOption(mid);
    await scope.getByLabel("계정소분류", { exact: true }).selectOption(minor);
  }

  await boot();
  const billPicker = page.locator("#bill-picker");
  await expect(billPicker.getByLabel("계정대분류", { exact: true })).toBeVisible();
  assert.deepEqual(await values(billPicker.getByLabel("계정대분류", { exact: true })), ["재무비용"]);
  await pick(billPicker, bill.major, bill.mid, bill.minor);
  assert.deepEqual(JSON.parse(await billPicker.locator("output").textContent()), { txType: "카드대금결제", ...pickedBill });
  assert.deepEqual(await values(billPicker.getByLabel("계정소분류", { exact: true })), ["카드대금결제"], "일반 금융 수수료는 카드대금 후보에 섞이지 않는다");
  const refund = page.locator("#refund-picker");
  await pick(refund, ordinary.major, ordinary.mid, ordinary.minor);
  assert.equal(JSON.parse(await refund.locator("output").textContent()).txType, "환급");
  await expect(page.locator("#retired-picker").getByLabel("계정소분류", { exact: true })).toHaveValue("카드대금결제");
  assert.deepEqual(await values(page.locator("#retired-empty-picker").getByLabel("계정대분류", { exact: true })), []);
  assert.deepEqual(await values(page.locator("#wrong-picked-picker").getByLabel("계정대분류", { exact: true })), ["재무비용"]);
  await expect(page.locator("#wrong-picked-picker").getByLabel("계정대분류", { exact: true })).toHaveValue("");

  const row = page.locator("#ledger-grid .dsg-row:not(.dsg-row-header)").first();
  const selects = row.locator("select.dsg-select");
  await expect(selects).toHaveCount(4);
  await selects.nth(0).locator("..").click();
  await selects.nth(0).selectOption("카드대금결제");
  await expect.poll(() => page.evaluate(() => window.__cardLedgerRows[0].txType)).toBe("카드대금결제");
  const reset = await page.evaluate(() => window.__cardLedgerRows[0]);
  assert.equal(reset.acctMajor, undefined); assert.equal(reset.acctMid, undefined); assert.equal(reset.acctMinor, undefined);
  assert.deepEqual(await values(selects.nth(1)), ["재무비용"]);
  await selects.nth(1).selectOption(bill.major);
  await selects.nth(2).selectOption(bill.mid);
  assert.deepEqual(await values(selects.nth(3)), ["카드대금결제"]);
  await selects.nth(3).selectOption(bill.minor);
  const assigned = await page.evaluate(() => window.__cardLedgerRows[0]);
  assert.equal(assigned.txType, "카드대금결제");
  assert.equal(assigned.acctMinor, "카드대금결제");
  assert.equal(assigned.gross, 5000);
  await selects.nth(0).selectOption("환급");
  await selects.nth(1).selectOption(ordinary.major);
  await selects.nth(2).selectOption(ordinary.mid);
  await selects.nth(3).selectOption(ordinary.minor);
  assert.equal((await page.evaluate(() => window.__cardLedgerRows[0])).txType, "환급");
  assert.deepEqual(pageErrors, []);

  await boot("#review");
  const active = page.locator('li[aria-current="true"]');
  await expect(active).toContainText("카드대금 확인용");
  await expect(active.getByText(/사업구분이 비어 있습니다/)).toHaveCount(0);
  await expect(active.getByLabel("계정소분류", { exact: true })).toHaveValue("카드대금결제");
  await page.getByText("일반 지출 확인용", { exact: true }).click();
  await expect(active).toContainText("일반 지출 확인용");
  await expect(active.getByText(/사업구분이 비어 있습니다/)).toBeVisible();
  await expect(page.locator("li").filter({ has: page.getByText("카드대금 확인용", { exact: true }) }).getByText("손익 분류 불필요", { exact: true })).toBeVisible();
  assert.deepEqual(pageErrors, []);
  assert.equal(requests.filter((request) => request.method !== "GET").length, 0, "선택·조회 중 금융 쓰기 요청 없음");
  console.log("PASS card bill account UI: exact expense-master billing path, no ordinary expense candidates, type preserved, retired/current compatibility, refund paths, real DSG type-reset/account selection, review PL-only missing-business warning. All network requests mocked/aborted.");
} finally {
  await browser?.close();
}
