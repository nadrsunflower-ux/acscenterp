// 실제 임포트 UI/어댑터를 사용하되 모든 HTTP 요청을 fixture로 가로챈다.
// 금융 거래는 이 파일의 메모리 객체에만 기록하며 undo/delete는 항상 거부한다.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";
import * as XLSX from "xlsx";

const cwd = process.cwd();
const rawRows = [
  ["2026-10-10 10:00:00", "확정입금", 0, 1100000, 2100000, "타행입금", "은행 원본 메모"],
  ["2026-10-11 10:00:00", "나눔원거래", 100000, 0, 2000000, "인터넷출금", "원래 한 건의 출금"],
  ["2026-10-12 10:00:00", "추가출금", 20000, 0, 1980000, "인터넷출금", "새로 생긴 출금"],
  ["2026-10-13 10:00:00", "재시도출금", 30000, 0, 1950000, "인터넷출금", "실패 후 재시도할 출금"],
];
function bankFile(name, rows, last4 = "4248") {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ["계좌번호", `012-345-${last4}`], ["조회 파일", name],
    ["거래일시", "보낸분/받는분", "출금액", "입금액", "잔액", "적요", "메모"], ...rows,
  ]), "Sheet1");
  return { name, mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: XLSX.write(workbook, { bookType: "xlsx", type: "buffer" }) };
}
const hash = (date, vendor, gross, type) => `${date}¦4248¦${vendor}¦${gross}¦${type}`;
const incomeHash = hash("2026-10-10", "확정입금", 1100000, "수입");
const splitHash = hash("2026-10-11", "나눔원거래", 100000, "지출");
const oldRows = [
  { id: "kept-confirmed", date: "2026-10-10", datetime: "2026-10-10 10:00:00", last4: "4248", vendor: "확정입금", txType: "수입", gross: 1100000, adjust: 0, site: "네안데르", status: "confirmed", bizMajor: "B2B", bizMinor: "조향", acctMajor: "매출", acctMid: "B2B매출", acctMinor: "납품계약", note: "사람이 확정한 메모", projectCode: "PJ-FIXTURE", receiptOf: ["project-fixture:installment-one"], dedupHash: incomeHash, importBatchId: "original-batch", engineSig: "hold", createdAt: 1, updatedAt: 2 },
  ...[60000, 40000].map((gross, i) => ({ id: `kept-split-${i + 1}`, date: "2026-10-11", datetime: "2026-10-11 10:00:00", last4: "4248", vendor: "나눔원거래", txType: "지출", gross, adjust: 0, site: "네안데르", status: "confirmed", bizMajor: "공용", bizMinor: "공용", acctMajor: "운영비", acctMid: "일반운영비", acctMinor: "일반소모품비", note: `확정한 분할 메모 ${i + 1}`, splitGroup: "original-split-parent", splitNo: i + 1, splitCount: 2, splitTotal: 100000, dedupHash: `${splitHash}#split${i + 1}`, importBatchId: "original-batch", createdAt: 1, updatedAt: 2 })),
];
const oldImport = { id: "original-batch", fileName: "원본_4248.xlsx", inserted: 2, skipped: 0, month: "2026-10", slotKey: "account:4248", adapterId: "kb-bank", from: "2026-10-10", to: "2026-10-11", last4s: ["4248"], income: 1100000, expense: 100000, createdAt: 1 };
let state = {
  transactions: structuredClone(oldRows), imports: [oldImport], loading: false, masterEmpty: false,
  paymentMethods: [{ id: "4248", last4: "4248", alias: "국민검증계좌", site: "네안데르", kind: "account", bank: "kb", personal: false }, { id: "7773", last4: "7773", alias: "국민다른계좌", site: "와작홈즈", kind: "account", bank: "kb", personal: false }],
  accounts: [{ id: "expense", txType: "지출", major: "운영비", mid: "일반운영비", minor: "일반소모품비", active: true, code: "FIXTURE", vat: "해당없음", asset: "비자산", pay: "계좌이체", branch: "HQ" }],
  projects: [], vendorRules: [], classRules: [], trustGate: undefined,
};
function counts() {
  const sources = new Map();
  for (const row of state.transactions) {
    const key = row.dedupHash.replace(/(?:#split\d+)+$/, "");
    const group = sources.get(key) ?? new Set();
    group.add(row.splitGroup ?? row.id); sources.set(key, group);
  }
  return Object.fromEntries([...sources].map(([key, ids]) => [key, ids.size]));
}
const mockFinance = `import {useMemo,useSyncExternalStore} from 'react';import {buildVendorIndex} from '@/lib/neander/finance/classify';
const listeners=new Set();const subscribe=fn=>{listeners.add(fn);return()=>listeners.delete(fn)};const snapshot=()=>window.__importFixture;
const publish=next=>{window.__importFixture=next;listeners.forEach(fn=>fn())};export function useFinance(){const data=useSyncExternalStore(subscribe,snapshot,snapshot);const vendorIndex=useMemo(()=>buildVendorIndex(data.transactions),[data.transactions]);return {...data,vendorIndex,refresh:async()=>{const response=await fetch('/fixture-state');publish(await response.json())},applyTransactions(change){const up=new Map((change.upsert||[]).map(x=>[x.id,x]));const removed=new Set(change.remove||[]);publish({...snapshot(),transactions:[...snapshot().transactions.filter(x=>!up.has(x.id)&&!removed.has(x.id)),...up.values()]})}}}`;
const mocks = {
  finance: mockFinance,
  auth: `const user={getIdToken:async()=>"fixture-only"};export const getNeanderAuth=()=>({currentUser:user,onAuthStateChanged(fn){queueMicrotask(()=>fn(user));return()=>{}}});`,
  appData: `export const useAppData=()=>({currentMember:{id:'fixture-member',name:'검증자'},members:[],loading:false});`,
  shell: `export const ToolbarPortal=({children})=>children;export const useCrumbTail=()=>{};`,
  link: `import {forwardRef} from 'react';export default forwardRef(function Link({href,children,prefetch,replace,scroll,...props},ref){return <a ref={ref} href={typeof href==='string'?href:'#'} {...props}>{children}</a>});`,
};
const bundle = await build({
  absWorkingDir: cwd, bundle: true, write: false, outdir: "/tmp/import-refresh-fixture", format: "iife", platform: "browser", jsx: "automatic", logLevel: "silent",
  stdin: { resolveDir: cwd, loader: "tsx", contents: `import {createRoot} from 'react-dom/client';import Page from './app/neander/finance/import/page.neander.tsx';import {ConfirmProvider,ToastProvider} from './components/neander/ui';createRoot(document.getElementById('root')).render(<div data-app="neander" style={{padding:24}}><ConfirmProvider><ToastProvider><Page/></ToastProvider></ConfirmProvider></div>);` },
  plugins: [{ name: "import-refresh-fixtures", setup(builder) {
    builder.onResolve({ filter: /(?:^|\/)FinanceProvider$/ }, () => ({ path: "finance", namespace: "fixture" }));
    builder.onResolve({ filter: /^@\/lib\/neander\/firebase$/ }, () => ({ path: "auth", namespace: "fixture" }));
    builder.onResolve({ filter: /^@\/components\/neander\/app-data$/ }, () => ({ path: "appData", namespace: "fixture" }));
    builder.onResolve({ filter: /^@\/components\/neander\/shell\/context$/ }, () => ({ path: "shell", namespace: "fixture" }));
    builder.onResolve({ filter: /^next\/link$/ }, () => ({ path: "link", namespace: "fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({ contents: mocks[path], loader: "tsx", resolveDir: cwd }));
  } }],
});
const styles = [".next-neander/static/css/app/layout.css", ".next-neander/static/css/app/neander/layout.neander.css"].filter(existsSync).map((file) => readFileSync(file, "utf8").replace(/@import[^;]+;/g, ""));
const requests = [], appends = [], forbidden = [], errors = [];
let failNext = false, serial = 0, browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript((data) => { window.__importFixture = data; window.process = { env: { NODE_ENV: "test" }, browser: true }; }, state);
  await page.route("**/*", async (route) => {
    const request = route.request(), url = new URL(request.url());
    requests.push({ path: url.pathname, method: request.method(), body: request.postData() });
    if (url.host !== "localhost:43162") return route.abort("blockedbyclient");
    if (url.pathname === "/fixture") return route.fulfill({ contentType: "text/html", body: '<!doctype html><html><body><div id="root"></div></body></html>' });
    if (url.pathname === "/fixture-state") return route.fulfill({ json: state });
    if (url.pathname === "/api/neander/finance/dedup" && request.method() === "GET") return route.fulfill({ json: { counts: counts() } });
    if (url.pathname === "/api/neander/finance/expense-claims" && request.method() === "GET") return route.fulfill({ json: { claims: [] } });
    if (url.pathname !== "/api/neander/finance/import-append" || request.method() !== "POST") {
      if (request.method() !== "GET") forbidden.push(request.postData());
      return route.abort("blockedbyclient");
    }
    const input = request.postDataJSON(); appends.push(input);
    assert.equal(input.slotKey, "account:4248", input.fileName); assert.equal(input.month, "2026-10"); assert.equal(input.adapterId, "kb-bank");
    assert.match(input.fileHash, /^[a-f0-9]{64}$/);
    assert.ok(input.rows.every((row) => row.last4 === "4248"));
    if (failNext) { failNext = false; return route.fulfill({ status: 503, json: { error: "fixture 저장 실패" } }); }
    const existing = counts(), seen = new Map(), fresh = [];
    for (const row of input.rows) {
      const nth = seen.get(row.dedupHash) ?? 0; seen.set(row.dedupHash, nth + 1);
      if (nth >= (existing[row.dedupHash] ?? 0)) fresh.push(row);
    }
    const id = `refresh-batch-${++serial}`;
    const added = fresh.map((row, i) => ({ ...row, id: `added-${serial}-${i}`, importBatchId: id, createdAt: serial + 10 }));
    const income = added.filter((row) => row.txType === "수입").reduce((sum, row) => sum + row.gross - (row.adjust || 0), 0);
    const expense = added.filter((row) => row.txType === "지출").reduce((sum, row) => sum + row.gross - (row.adjust || 0), 0);
    state = { ...state, transactions: [...state.transactions, ...added], imports: [{ ...input, rows: undefined, id, inserted: added.length, skipped: input.rows.length - added.length, income, expense, createdAt: serial + 10 }, ...state.imports] };
    return route.fulfill({ json: { id, inserted: added.length, skipped: input.rows.length - added.length, income, expense,
      confirmed: added.filter((r) => r.status === "confirmed").length, suggested: added.filter((r) => r.status === "suggested").length, needsReview: added.filter((r) => r.status === "needs_review").length } });
  });
  await page.goto("http://localhost:43162/fixture");
  for (const css of styles) await page.addStyleTag({ content: css });
  for (const output of bundle.outputFiles.filter((file) => file.path.endsWith(".css"))) await page.addStyleTag({ content: output.text });
  await page.addScriptTag({ content: bundle.outputFiles.find((file) => file.path.endsWith(".js")).text });
  const slot = page.locator(".nd-puzzle-piece").filter({ hasText: "국민검증계좌" });
  await expect(slot).toHaveCount(1);
  await expect(slot.getByRole("button", { name: "파일 갱신", exact: true })).toBeVisible();
  function preserved() {
    for (const old of oldRows) assert.deepEqual(state.transactions.find((row) => row.id === old.id), old, "확정 분류·메모·회차·분할 원본 보존");
    assert.deepEqual(state.imports.find((batch) => batch.id === oldImport.id), oldImport);
    assert.equal(forbidden.length, 0, "undo/bulkAdd/delete 경로를 호출하지 않음");
  }
  async function upload(file, shouldFail = false) {
    const before = appends.length;
    await slot.locator('input[type="file"]').setInputFiles(file);
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("기존 거래를 유지하고");
    await dialog.getByRole("button", { name: "신규 거래만 추가", exact: true }).click();
    await expect.poll(() => appends.length).toBe(before + 1);
    if (shouldFail) await expect(slot).toContainText("fixture 저장 실패");
    else await expect(slot.getByText(file.name, { exact: true })).toBeVisible();
    preserved();
  }

  await slot.locator('input[type="file"]').setInputFiles(bankFile("취소_4248.xlsx", rawRows));
  await page.getByRole("dialog").getByRole("button", { name: "취소", exact: true }).click();
  assert.equal(appends.length, 0, "사용자가 갱신을 취소하면 원장 요청도 보내지 않는다");
  assert.deepEqual(state.transactions, oldRows); assert.deepEqual(state.imports, [oldImport]);

  await upload(bankFile("신규포함_4248.xlsx", rawRows.slice(0, 3)));
  assert.equal(appends[0].rows.length, 3, "클라이언트는 중복을 버리지 않고 파일 전체를 보낸다");
  assert.equal(state.transactions.length, 4); assert.equal(state.imports[0].inserted, 1); assert.equal(state.imports[0].skipped, 2);
  const afterFirst = structuredClone(state.transactions);
  await upload(bankFile("더짧은조회_4248.xlsx", rawRows.slice(0, 1)));
  assert.deepEqual(state.transactions, afterFirst); assert.equal(state.imports[0].inserted, 0);
  await upload(bankFile("모두중복최신_4248.xlsx", rawRows.slice(0, 3)));
  assert.deepEqual(state.transactions, afterFirst); assert.equal(state.imports[0].fileName, "모두중복최신_4248.xlsx"); assert.equal(state.imports[0].skipped, 3);
  const beforeFailure = structuredClone(state);
  const retry = bankFile("실패후재시도_4248.xlsx", rawRows);
  failNext = true; await upload(retry, true);
  assert.deepEqual(state, beforeFailure, "실패한 새 파일은 기존 거래·이력에 영향을 주지 않는다");
  await upload(retry);
  assert.equal(state.transactions.length, 5); assert.equal(state.imports[0].inserted, 1);

  let count = appends.length;
  const beforeInvalid = structuredClone(state);
  await slot.locator('input[type="file"]').setInputFiles(bankFile("다른달.xlsx", [["2026-11-01 10:00:00", "다른달출금", 1000, 0, 1000, "출금", ""]]));
  await expect(slot).toContainText(/지금 고른 달|기간|달마다/);
  assert.equal(appends.length, count); assert.deepEqual(state, beforeInvalid);
  // 칸 input도 계좌번호에 따라 자동 배치한다. 등록된 다른 계좌는 정상 배치
  // 대상이므로, 마스터에 없는 계좌가 실제 적재 전에 거부되는지 확인한다.
  await slot.locator('input[type="file"]').setInputFiles(bankFile("미등록계좌.xlsx", rawRows.slice(0, 1), "9999"));
  await expect(page.getByText(/9999 계좌는 월별 적재 칸이 아닙니다/)).toBeVisible();
  assert.equal(appends.length, count); assert.deepEqual(state, beforeInvalid);

  const personal = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(personal, XLSX.utils.aoa_to_sheet([["사용일", "사용처", "금액", "계정", "프로젝트", "메모"], ["2026-10-20", "개인 경비", 3000, "공용 일반소모품비", "", "먼저 회사 비용인지 확인"]]), "개인경비");
  await slot.locator('input[type="file"]').setInputFiles({ name: "개인경비.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: XLSX.write(personal, { bookType: "xlsx", type: "buffer" }) });
  await expect(page.locator("#personal-expenses").getByRole("heading", { name: "개인경비.xlsx" })).toBeVisible();
  await expect(page.locator("#personal-expenses").getByRole("button", { name: "선택 1건 비용 등록" })).toBeDisabled();
  assert.equal(appends.length, count); assert.deepEqual(state, beforeInvalid); preserved();
  assert.deepEqual(errors, []);
  assert.equal(requests.some((r) => r.method === "DELETE" || /import\.undo|transaction\.bulkAdd/.test(r.body ?? "")), false);
  console.log("PASS import refresh UI: full-file atomic append request; existing confirmed IDs/classifications/memos/receipt links/splits preserved; shorter/all-duplicate files update metadata without deletion; failed retry preserves old data; month/account rejects before mutation; personal file remains preview-only. All API responses mocked.");
} finally {
  await browser?.close();
}
