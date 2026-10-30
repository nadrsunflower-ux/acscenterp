// 개인 대납 UI 전용: 브라우저의 모든 요청을 fixture로 가로채 실제 API를 사용하지 않는다.
import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";
import * as XLSX from "xlsx";

const cwd = process.cwd();
const account = { id: "fixture-account", lookupKey: "지출|운영비|일반운영비|소모품비", txType: "지출", major: "운영비", mid: "일반운영비", minor: "소모품비", active: true };
const gasu = { date: "2026-10-30", txType: "자금거래", gross: 20000, adjust: 0, acctMajor: "가수금", acctMid: "가수금관리", acctMinor: "가수금지급", vendor: "테스트 결제자", status: "confirmed" };
const fixture = {
  accounts: [account], projects: [], loading: false,
  paymentMethods: [{ id: "0429", last4: "0429", alias: "토스모임", kind: "account", site: "안다르" }, { id: "4248", last4: "4248", alias: "신한입금", kind: "account", site: "네안데르" }, { id: "9999", last4: "9999", alias: "법인카드", kind: "card", site: "네안데르" }],
  transactions: [
    { id: "existing-cost", date: "2026-10-30", vendor: "기존상점", txType: "지출", gross: 9900, adjust: 0, acctMajor: "운영비", acctMid: "일반운영비", acctMinor: "소모품비", status: "confirmed" },
    { ...gasu, id: "bank-good", last4: "0429" },
    { ...gasu, id: "card-not-bank", last4: "9999" },
    { ...gasu, id: "bank-too-large", last4: "0429", gross: 30000 },
    { ...gasu, id: "bank-other-claim", last4: "4248", expenseReimbursement: { claimId: "other", payer: "다른 사람" } },
    { ...gasu, id: "ordinary-transfer", last4: "4248", acctMajor: "계좌간이동", acctMid: "이체출금", acctMinor: "운영자금이동" },
  ],
};
const financeMock = `import {useState} from 'react';
export function useFinance(){const [data,setData]=useState(window.__expenseFixture);
window.__setExpenseFixture=(next)=>{window.__expenseFixture=next;setData(next)};
return {...data,applyTransactions(change){const data=window.__expenseFixture;const removed=new Set(change.remove||[]);const updated=new Map((change.upsert||[]).map(x=>[x.id,x]));window.__setExpenseFixture({...data,transactions:[...data.transactions.filter(x=>!removed.has(x.id)&&!updated.has(x.id)),...updated.values()]})}}}`;
const bundle = await build({
  absWorkingDir: cwd, bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic", logLevel: "silent",
  stdin: { resolveDir: cwd, loader: "tsx", contents: `import {createRoot} from 'react-dom/client';import {PersonalExpenseImport} from './components/neander/finance/PersonalExpenseImport';import {ConfirmProvider,ToastProvider} from './components/neander/ui';createRoot(document.getElementById('root')).render(<ConfirmProvider><ToastProvider><PersonalExpenseImport/></ToastProvider></ConfirmProvider>);` },
  plugins: [{ name: "personal-expense-fixtures", setup(builder) {
    builder.onResolve({ filter: /(?:^|\/)FinanceProvider$/ }, () => ({ path: "finance", namespace: "fixture" }));
    builder.onResolve({ filter: /^@\/lib\/neander\/firebase$/ }, () => ({ path: "auth", namespace: "fixture" }));
    builder.onResolve({ filter: /^@\/lib\/neander\/finance\/client$/ }, () => ({ path: "decrypt", namespace: "fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({ loader: "js", resolveDir: cwd,
      contents: args.path === "finance" ? financeMock : args.path === "auth" ? `export const getNeanderAuth=()=>({currentUser:{getIdToken:async()=>"fixture-only"}})` : `export async function decryptFinanceFile(){throw new Error("암호 fixture 없음")}` }));
  } }],
});

const workbook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
  ["사용일", "사용처", "금액", "계정", "프로젝트", "메모"],
  ["2026-10-30", "새상점", 12000, "공용 소모품비", "", "원본 메모 유지"],
  ["2026-10-30", "새상점", 12000, "공용 소모품비", "", "같은 날 실제 두 번째 결제"],
  ["2026-10-30", "기존상점", 9900, "공용 소모품비", "", "기존 원장 중복 후보"],
  ["2026-10-30", "미분류상점", 5000, "", "미정 프로젝트", "회사 비용인지 확인"],
  ["합계 6건", "", 48900],
]), "명세서");
const file = { name: "대납-fixture.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) };
const mutations = [];
let claims = [];
let releaseImport;
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on("pageerror", (error) => console.error("UI fixture error:", error.message));
  await page.addInitScript((data) => { window.__expenseFixture = data; window.process = { env: { NODE_ENV: "test" }, browser: true }; }, fixture);
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === "/fixture") return route.fulfill({ contentType: "text/html", body: '<!doctype html><html><body><div id="root"></div></body></html>' });
    if (url.pathname !== "/api/neander/finance/expense-claims") return route.abort("blockedbyclient");
    if (request.method() === "GET") return route.fulfill({ json: { claims } });
    const body = request.postDataJSON();
    mutations.push({ method: request.method(), body, id: url.searchParams.get("id") });
    if (body?.action === "import") {
      await new Promise((resolve) => { releaseImport = resolve; });
      const claim = { id: "fixture-claim", ...body.input, payerKey: "테스트결제자", createdAt: 1 };
      claims = [claim];
      const transactions = body.input.rows.map((row, i) => ({ ...row, id: `fixture-cost-${i}`, adjust: 0, site: body.input.site, status: "confirmed", expenseClaim: { claimId: claim.id, payer: claim.payer, payerKey: claim.payerKey, fileName: claim.fileName, rowNo: row.rowNo } }));
      return route.fulfill({ json: { claim, transactions, inserted: transactions.length, skipped: 0 } });
    }
    if (body?.action === "linkSettlement" || body?.action === "unlinkSettlement") {
      const tx = { ...fixture.transactions.find((tx) => tx.id === body.txId) };
      if (body.action === "linkSettlement") tx.expenseReimbursement = { claimId: body.claimId, payer: "테스트 결제자" };
      else delete tx.expenseReimbursement;
      return route.fulfill({ json: { ok: true, transactions: [tx] } });
    }
    if (request.method() === "DELETE") {
      claims = [];
      return route.fulfill({ json: { ok: true, removed: 2, removedIds: ["fixture-cost-0", "fixture-cost-1"], transactions: [] } });
    }
    return route.fulfill({ status: 400, json: { error: "fixture action unsupported" } });
  });
  await page.goto("http://localhost:43159/fixture");
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const section = page.locator("#personal-expenses");
  await expect(section.getByPlaceholder("이름 입력")).toHaveValue("");
  await section.locator('input[type="file"]').setInputFiles(file);
  await expect(section.getByText(/명세서에는 6건/)).toBeVisible();
  await expect(section.getByText(/10,000원 다릅니다/)).toBeVisible();
  await expect(section.getByRole("checkbox", { name: "4행 회사 비용 선택" })).not.toBeChecked();
  await expect(section.getByRole("checkbox", { name: "2행 회사 비용 선택" })).toBeChecked();
  await expect(section.getByRole("checkbox", { name: "3행 회사 비용 선택" })).toBeChecked();
  await expect(section.getByRole("button", { name: /비용 등록$/ })).toBeDisabled();
  await section.getByPlaceholder("이름 입력").fill("테스트 결제자");
  await section.getByLabel("비용을 부담할 사업체").selectOption("네안데르");
  await expect(section.getByRole("button", { name: /비용 등록$/ })).toBeDisabled();
  await section.getByRole("checkbox", { name: "5행 회사 비용 선택" }).uncheck();
  await expect(section.getByRole("button", { name: "선택 2건 비용 등록" })).toBeEnabled();
  assert.equal(mutations.length, 0, "파일 선택·미리보기·분류 중 쓰기 없음");
  await expect(section.getByLabel("2행 프로젝트")).toHaveValue("");
  await section.getByRole("button", { name: "선택 2건 비용 등록" }).click();
  await expect(section.getByPlaceholder("이름 입력")).toBeDisabled();
  await expect(section.locator('input[type="file"]')).toBeDisabled();
  await expect(section.getByRole("checkbox", { name: "2행 회사 비용 선택" })).toBeDisabled();
  await expect.poll(() => typeof releaseImport).toBe("function");
  releaseImport();
  await expect(section.getByRole("button", { name: "비용 등록 취소" })).toBeVisible();
  assert.equal(mutations.length, 1);
  assert.equal(mutations[0].body.input.rows.length, 2);
  assert.equal(mutations[0].body.input.rows[0].last4, undefined);
  assert.equal(mutations[0].body.input.rows[0].projectCode, undefined);
  assert.match(mutations[0].body.input.rows[0].note, /원본 메모 유지/);
  const selector = section.getByLabel("실제 상환 출금 선택");
  assert.deepEqual(await selector.locator("option").evaluateAll((options) => options.map((o) => o.value)), ["", "bank-good"]);
  await selector.selectOption("bank-good");
  await section.getByRole("button", { name: "선택한 실제 출금을 상환으로 연결" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  assert.equal(mutations.length, 1, "확인 전 상환 쓰기 없음");
  await page.getByRole("dialog").getByRole("button", { name: "취소", exact: true }).click();
  assert.equal(mutations.length, 1);
  await section.getByRole("button", { name: "선택한 실제 출금을 상환으로 연결" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "상환 연결", exact: true }).click();
  await expect(section.getByRole("button", { name: "비용 등록 취소" })).toBeDisabled();
  await expect(section.locator("[data-nd-kpi]").last()).toContainText("4,000");
  await section.getByRole("button", { name: "연결 해제", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "연결 해제", exact: true }).click();
  await expect(section.getByRole("button", { name: "비용 등록 취소" })).toBeEnabled();
  await section.getByRole("button", { name: "비용 등록 취소" }).click();
  assert.equal(mutations.length, 3, "확인 전 등록 취소 쓰기 없음");
  await page.getByRole("dialog").getByRole("button", { name: "등록 취소", exact: true }).click();
  await expect(section.getByText("등록한 개인 대납 비용이 없습니다")).toBeVisible();
  assert.equal(mutations.length, 4);
  const preservedBank = await page.evaluate(() => window.__expenseFixture.transactions.find((tx) => tx.id === "bank-good"));
  assert.equal(preservedBank.gross, 20000);
  assert.equal(preservedBank.txType, "자금거래");
  assert.equal(preservedBank.expenseReimbursement, undefined);
  const many = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(many, XLSX.utils.aoa_to_sheet([
    ["사용일", "사용처", "금액", "계정", "프로젝트"],
    ...Array.from({ length: 151 }, (_, i) => ["2026-10-30", `다른상점${i}`, 1000, "공용 소모품비", ""]),
  ]), "명세서");
  await section.locator('input[type="file"]').setInputFiles({ ...file, name: "151건.xlsx", buffer: XLSX.write(many, { type: "buffer", bookType: "xlsx" }) });
  await expect(section.getByText(/한 번에 150건까지 등록/)).toBeVisible();
  await expect(section.getByRole("button", { name: "선택 151건 비용 등록" })).toBeDisabled();
  assert.equal(mutations.length, 4);
  const refund = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(refund, XLSX.utils.aoa_to_sheet([
    ["사용일", "사용처", "금액", "계정", "프로젝트"],
    ["2026-10-30", "환급상점", 12000, "공용 소모품비", ""],
    ["2026-10-30", "환급상점", -2000, "공용 소모품비", ""],
  ]), "명세서");
  await section.locator('input[type="file"]').setInputFiles({ ...file, name: "부분환급.xlsx", buffer: XLSX.write(refund, { type: "buffer", bookType: "xlsx" }) });
  await expect(section.getByRole("button", { name: "선택 2건 비용 등록" })).toBeEnabled();
  await expect(section.getByText("10,000").first()).toBeVisible();
  assert.equal(mutations.length, 4);
  const invalidClaim = { id: "invalid-claim", ...mutations[0].body.input, payerKey: "테스트결제자", createdAt: 1 };
  claims = [invalidClaim];
  const invalidData = { ...fixture, transactions: [
    ...mutations[0].body.input.rows.map((row, i) => ({ ...row, id: `fixture-cost-${i}`, adjust: 0, expenseClaim: { claimId: invalidClaim.id, rowNo: row.rowNo } })),
    { ...gasu, id: "bank-edited-to-card", last4: "9999", expenseReimbursement: { claimId: invalidClaim.id, payer: invalidClaim.payer } },
  ] };
  await page.goto("http://localhost:43159/fixture");
  await page.evaluate((data) => { window.__expenseFixture = data; }, invalidData);
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await section.getByRole("button", { name: "내역 보기" }).click();
  await expect(section.getByText(/출금 1건의 계정·거래유형 또는 계좌 정보/)).toBeVisible();
  await expect(section.locator("[data-nd-kpi]").last()).toContainText("24,000");
  await expect(section.getByRole("button", { name: "연결 해제", exact: true })).toBeVisible();
  assert.equal(mutations.length, 4);
  console.log("PASS personal-expense UI: preview/classification, unchecked duplicate, preserved same-day rows/memo, import lock, explicit settlement/unlink/cancel, invalid bank exclusion, 150-row cap, refund expense-path reuse; all requests mocked.");
} finally {
  await browser?.close();
}
