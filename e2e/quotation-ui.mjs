// 견적 팝업 전용 fixture: 원본 React UI를 실행하되 저장·인감·AI·네트워크는 모두 격리한다.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";
import * as XLSX from "xlsx";
import { extractText } from "unpdf";

const cwd = process.cwd();
const out = path.join(cwd, "output", "quotation-integration");
const temp = await mkdtemp(path.join(os.tmpdir(), "erp-quotation-ui-"));
await mkdir(out, { recursive: true });
await writeFile(path.join(temp, "tailwind-input.css"), "@tailwind base;\n@tailwind components;\n@tailwind utilities;\n");
execFileSync(process.execPath, [path.join(cwd, "node_modules/tailwindcss/lib/cli.js"), "-c", path.join(cwd, "tailwind.config.ts"), "-i", path.join(temp, "tailwind-input.css"), "-o", path.join(temp, "tailwind.css"), "--minify"], { cwd, stdio: "pipe" });

const safeSeal = `data:image/svg+xml;charset=utf-8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="90" height="90"><rect x="5" y="5" width="80" height="80" rx="8" fill="none" stroke="#b91c1c" stroke-width="4"/><text x="45" y="51" text-anchor="middle" fill="#b91c1c" font-size="18">TEST</text></svg>')}`;
const financeMock = `
const copy=(value)=>JSON.parse(JSON.stringify(value));
export async function saveFinDoc(doc,id){
  window.__calls.push({op:'save',doc:copy(doc),id});
  if(window.__pauseSave)await new Promise(resolve=>{window.__releaseSave=resolve});
  if(window.__failSave)throw new Error('fixture 저장 실패');
  const saved={id:id||'fixture-quote',doc:copy(doc)};window.__saved=saved;return {id:saved.id};
}
export async function deleteFinDoc(id){window.__calls.push({op:'delete',id});window.__saved=null}
export async function uploadFinDocFiles(id,files){window.__calls.push({op:'upload',id,names:files.map(file=>file.name)});if(window.__failUpload)throw new Error('fixture 업로드 실패');return files.map((file,index)=>({path:'fixture/'+index,name:file.name,type:file.type,size:file.size,uploadedAt:1}))}
export async function removeFinDocFile(){throw new Error('fixture 파일 삭제 미사용')}
export async function finDocFileUrl(){throw new Error('fixture 파일 URL 미사용')}
`;
const aiMock = `export async function requestQuoteAssist(input){
window.__aiCalls.push({mode:input.mode,projectId:input.projectId,text:input.text,file:input.file?.name});
return input.mode==='items'?{mode:'items',title:'AI 제안 견적명',lines:[{id:'ai-source',name:'AI 추가 키트',spec:'10ml',qty:3,unitPrice:5000,note:'제안 비고'}],note:'AI 제안 메모',warnings:['확인되지 않은 단가는 검토해 주세요.']}:{mode:'receiver',recipient:'OCR 고객사',receiver:{ceo:'OCR 대표',bizNo:'123-45-67890'}};
}`;
const bundle = await build({
  absWorkingDir: cwd, bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic", logLevel: "silent", outfile: path.join(temp, "fixture.js"),
  stdin: { resolveDir: cwd, loader: "tsx", contents: `
import {useState} from 'react';import {createRoot} from 'react-dom/client';
import {QuoteEditor} from './components/neander/finance/QuoteEditor';
import {ConfirmProvider,ToastProvider} from './components/neander/ui';
import {emptyQuote} from './lib/neander/finance/docs';
const initial={...emptyQuote('fixture-project',{title:'프로젝트 견적',recipient:'프로젝트 고객사'}),date:'2026-10-30'};
window.__initial=initial;
function Fixture(){const [current,setCurrent]=useState({key:0,initial});
window.__mountQuote=(next)=>setCurrent({...next,key:Date.now()+Math.random()});
return <ConfirmProvider><ToastProvider><div data-app="neander"><h1>Quotation fixture</h1></div>{current&&<QuoteEditor key={current.key} initial={current.initial} id={current.id} initialFiles={current.files||[]} onClose={()=>{window.__closed++;setCurrent(null)}} onSaved={async id=>window.__savedCallbacks.push(id)} onDeleted={async()=>{}} onApplyAmount={(amount,vatMode)=>window.__applied.push({amount,vatMode})}/>}</ToastProvider></ConfirmProvider>}
createRoot(document.getElementById('root')).render(<Fixture/>);` },
  plugins: [{ name: "quotation-fixtures", setup(builder) {
    builder.onResolve({ filter: /^@\/lib\/neander\/firebase$/ }, () => ({ path: "auth", namespace: "fixture" }));
    builder.onResolve({ filter: /^@\/lib\/neander\/finance\/client$/ }, () => ({ path: "finance", namespace: "fixture" }));
    builder.onResolve({ filter: /(?:^|\/)seal-image$/ }, () => ({ path: "seals", namespace: "fixture" }));
    builder.onResolve({ filter: /(?:^|\/)quote-assist-client$/ }, () => ({ path: "ai", namespace: "fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path: name }) => ({ loader: "js", resolveDir: cwd, contents:
      name === "finance" ? financeMock : name === "ai" ? aiMock : name === "auth" ? `export const getNeanderAuth=()=>({currentUser:{getIdToken:async()=>"fixture-only"}})` :
      `const image=${JSON.stringify(safeSeal)};export function useSealImage(id){return {src:id?image:undefined,state:id?'ready':'missing'}}export async function loadSealImage(){return image}export function preloadSeals(){}`,
    }));
  } }],
});
const js = bundle.outputFiles.find((file) => file.path.endsWith(".js")).text;
const css = await readFile(path.join(temp, "tailwind.css"), "utf8") + await readFile(path.join(cwd, "app/neander/neander.css"), "utf8") + bundle.outputFiles.filter((file) => file.path.endsWith(".css")).map((file) => file.text).join("\n");
let browser;
let page;
const errors = [];
const blocked = [];
try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  await context.route("**/*", (route) => {
    if (new URL(route.request().url()).pathname === "/fixture") return route.fulfill({ contentType: "text/html", body: '<!doctype html><html lang="ko"><head><meta charset="utf-8"></head><body><div id="root"></div></body></html>' });
    blocked.push(route.request().url());
    return route.abort("blockedbyclient");
  });
  page = await context.newPage();
  page.setDefaultTimeout(10_000);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    window.process = { env: { NODE_ENV: "test" }, browser: true };
    window.__calls = []; window.__aiCalls = []; window.__savedCallbacks = []; window.__applied = []; window.__printed = []; window.__closed = 0;
    window.open = () => ({ document: { write: (html) => window.__printed.push(html), close() {} }, close() {} });
  });
  await page.goto("http://localhost:43159/fixture");
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: js });
  const dialog = page.getByRole("dialog", { name: /^(새 견적서|견적서)$/ });
  const label = (name) => /^\d+번 /.test(name)
    ? dialog.locator(`[aria-label=${JSON.stringify(name)}]`)
    : dialog.locator("label").filter({ has: page.locator("span", { hasText: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`) }) }).locator("input,select,textarea");
  const save = () => dialog.getByRole("button", { name: "저장", exact: true });
  const calls = () => page.evaluate(() => window.__calls);
  const saved = () => page.evaluate(() => window.__saved);
  const reopen = async (initial) => {
    await page.evaluate((value) => { const record = window.__saved; window.__mountQuote(value ? { initial: value } : { initial: record.doc, id: record.id }); }, initial);
    await expect(dialog).toBeVisible();
  };
  const closeButton = () => dialog.getByRole("button", { name: "닫기", exact: true }).last();

  // 새 문서는 편집하지 않았어도 저장 가능하고 프로젝트 연결을 보존한다.
  await expect(save()).toBeEnabled();
  await save().click();
  await expect(save()).toBeDisabled();
  assert.equal((await saved()).doc.projectId, "fixture-project");
  assert.equal((await saved()).doc.design, 1);
  await label("견적명").fill("통합 검증 견적");
  await label("분류").selectOption("행사");
  await label("수신자 대표자").fill("고객 대표");
  await label("수신자 사업자등록번호").fill("234-56-78901");
  await label("수신자 주소").fill("서울 테스트 주소");
  await label("출력 디자인").selectOption("3");
  await dialog.getByRole("button", { name: "품목 추가", exact: true }).click();
  await label("1번 품명").fill("체험 키트");
  await label("1번 규격 / 사양").fill("10ml / 소수 수량");
  await label("1번 수량").fill("2.5");
  await label("1번 단가").fill("1100");
  await label("1번 품목 비고").fill("줄 비고 보존");
  await dialog.getByRole("button", { name: "1번 품목 복제", exact: true }).click();
  await expect(label("2번 수량")).toHaveValue("2.5");
  await expect(label("2번 품명")).toHaveValue("체험 키트");
  await dialog.getByRole("button", { name: "2번 품목 삭제", exact: true }).click();
  await expect(dialog.locator('[aria-label="견적 금액 요약"]')).toContainText("공급가액 2,500원 + 부가세 250원");
  await expect(dialog.locator('[aria-label="견적 금액 요약"]')).toContainText("합계 2,750원");
  const beforeApply = (await calls()).length;
  await dialog.getByRole("button", { name: "계약금액으로 반영", exact: true }).click();
  await label("단가 기준").selectOption("excluded");
  await expect(dialog.locator('[aria-label="견적 금액 요약"]')).toContainText("합계 3,025원");
  await dialog.getByRole("button", { name: "계약금액으로 반영", exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.__applied), [{ amount: 2750, vatMode: "included" }, { amount: 2750, vatMode: "excluded" }]);
  assert.equal((await calls()).length, beforeApply, "계약금액 반영은 문서를 저장하지 않는다");
  await save().click();
  await expect(save()).toBeDisabled();
  await closeButton().click();
  await expect(dialog).toBeHidden();
  await reopen();
  await expect(label("견적명")).toHaveValue("통합 검증 견적");
  await expect(label("분류")).toHaveValue("행사");
  await expect(label("출력 디자인")).toHaveValue("3");
  await expect(label("수신자 대표자")).toHaveValue("고객 대표");
  await expect(label("수신자 사업자등록번호")).toHaveValue("234-56-78901");
  await expect(label("1번 수량")).toHaveValue("2.5");
  assert.equal((await saved()).doc.lines.length, 1);
  console.log("PASS quotation fixture metadata/VAT/save/reopen");

  // 공급자 전환은 ERP의 인감 주인·연락처를 함께 반영하고 직접 수정한 값은 재열기에도 보존한다.
  await label("공급자 선택").selectOption("ilhaera");
  await expect(label("공급자 대표자")).toHaveValue("김주연");
  await expect(label("인감")).toHaveValue("ilhaera");
  await label("공급자 선택").selectOption("wajakhomes");
  await expect(label("공급자 대표자")).toHaveValue("유선화");
  await expect(label("인감")).toHaveValue("wajakhomes");
  await label("공급자 선택").selectOption("neander");
  await label("인감").selectOption("lee-dongju");
  await expect(label("공급자 대표자")).toHaveValue("이동주");
  await expect(label("담당자")).toHaveValue("이동주");
  await label("공급자 선택").selectOption("custom");
  await label("공급자 상호").fill("직접 공급자");
  await label("공급자 사업자등록번호").fill("999-88-77777");
  await label("공급자 대표자").fill("직접 대표");
  await label("인감").selectOption("none");
  await label("업태").fill("사업시설 관리, 사업지원 및 임대 서비스업, 서비스업");
  await save().click();
  await expect(save()).toBeDisabled();
  await reopen();
  await expect(label("공급자 선택")).toHaveValue("custom");
  await expect(label("공급자 상호")).toHaveValue("직접 공급자");
  await expect(label("공급자 대표자")).toHaveValue("직접 대표");
  await expect(label("업태")).toHaveValue("사업시설 관리, 사업지원 및 임대 서비스업, 서비스업");
  console.log("PASS quotation fixture supplier/seal/custom values");

  // 다섯 디자인 모두 동일한 문서 정보를 미리보기와 인쇄 HTML에 전달한다.
  for (const design of [1, 2, 3, 4, 5]) {
    await label("출력 디자인").selectOption(String(design));
    const paper = dialog.locator(`.quotation-design[data-design="${design}"]`);
    await expect(paper).toBeVisible();
    await expect(paper).toContainText("234-56-78901");
    await expect(paper).toContainText("줄 비고 보존");
    await dialog.getByRole("button", { name: "인쇄 / PDF", exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.__printed.length)).toBe(design);
    const html = await page.evaluate(() => window.__printed.at(-1));
    assert.match(html, new RegExp(`data-design="${design}"`));
    assert.match(html, /줄 비고 보존/);
    assert.match(html, /table-header-group/);
    assert.doesNotMatch(html, /<input|<textarea/);
  }

  // AI 결과는 검토 카드이며 명시적으로 적용하기 전에는 문서 내용과 저장 기록이 바뀌지 않는다.
  const writesBeforeAI = (await calls()).length;
  await dialog.getByRole("button", { name: /^AI 작성 도우미/ }).click();
  await label("요청 내용").fill("키트 3개, 단가 5000원");
  await dialog.getByRole("button", { name: "품목 초안 만들기", exact: true }).click();
  await expect(dialog.locator('[aria-label="AI 분석 결과"]')).toContainText("AI 추가 키트");
  await expect(label("1번 품명")).toHaveValue("체험 키트");
  await expect(label("견적명")).toHaveValue("통합 검증 견적");
  assert.equal((await calls()).length, writesBeforeAI);
  await dialog.getByRole("button", { name: "기존 품목에 추가", exact: true }).click();
  await expect(label("2번 품명")).toHaveValue("AI 추가 키트");
  await expect(label("견적명")).toHaveValue("통합 검증 견적");
  await label("도움받을 내용").selectOption("receiver");
  await label("수신자 정보").fill("사업자등록증 내용");
  await dialog.getByRole("button", { name: "사업자 정보 읽기", exact: true }).click();
  await expect(dialog.locator('[aria-label="AI 분석 결과"]')).toContainText("OCR 고객사");
  await expect(label("수신 상호")).toHaveValue("프로젝트 고객사");
  await dialog.getByRole("button", { name: "수신자 정보 적용", exact: true }).click();
  await expect(label("수신 상호")).toHaveValue("OCR 고객사");
  await expect(label("수신자 대표자")).toHaveValue("OCR 대표");
  await expect(label("수신자 주소")).toHaveValue("서울 테스트 주소");
  assert.equal((await calls()).length, writesBeforeAI);
  assert.equal((await page.evaluate(() => window.__aiCalls)).length, 2);
  console.log("PASS quotation fixture five designs/AI review");

  // 저장이 실패하거나 첨부 업로드만 실패해도 입력과 대기 파일을 버리지 않는다.
  await dialog.locator('input[type="file"][multiple]').setInputFiles({ name: "fixture-request.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7\nfixture only") });
  await page.evaluate(() => { window.__pauseSave = true; window.__failSave = true; });
  await save().click();
  await expect(label("견적명")).toBeDisabled();
  await expect(label("출력 디자인")).toBeDisabled();
  await expect(closeButton()).toBeDisabled();
  await expect.poll(() => page.evaluate(() => typeof window.__releaseSave)).toBe("function");
  await page.evaluate(() => { window.__pauseSave = false; window.__releaseSave(); });
  await expect(dialog.getByText("fixture 저장 실패", { exact: true })).toBeVisible();
  await expect(label("2번 품명")).toHaveValue("AI 추가 키트");
  await expect(dialog.getByText(/붙일 예정/)).toBeVisible();
  assert.equal((await saved()).doc.recipient, "프로젝트 고객사");
  await page.evaluate(() => { window.__failSave = false; window.__failUpload = true; });
  await save().click();
  await expect(dialog.getByText(/견적서는 저장했습니다. 파일만 올리지 못했습니다/)).toBeVisible();
  await expect(dialog.getByText(/붙일 예정/)).toBeVisible();
  await expect(save()).toBeEnabled();
  await page.evaluate(() => { window.__failUpload = false; });
  await save().click();
  await expect(save()).toBeDisabled();
  await expect(dialog.getByText(/붙일 예정/)).toHaveCount(0);

  // 저장하지 않은 닫기 확인을 취소하면 현재 입력이 그대로 남는다.
  await label("견적명").fill("닫기 전 수정");
  await closeButton().click();
  const confirm = page.getByRole("dialog", { name: "저장하지 않은 변경이 있습니다", exact: true });
  await expect(confirm).toContainText("저장하지 않은 변경이 있습니다");
  await confirm.getByRole("button", { name: "취소", exact: true }).click();
  await expect(label("견적명")).toHaveValue("닫기 전 수정");
  await closeButton().click();
  await confirm.getByRole("button", { name: "닫기", exact: true }).click();
  await expect(dialog).toBeHidden();
  await reopen();
  await expect(label("견적명")).toHaveValue("통합 검증 견적");
  console.log("PASS quotation fixture save/upload failures/unsaved close");

  // PNG와 엑셀은 실제 생성 함수를 실행해 파일 형식·현재 데이터를 확인한다.
  await label("출력 디자인").selectOption("1");
  const pngEvent = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "이미지", exact: true }).click();
  const png = await pngEvent;
  const pngPath = path.join(out, "quotation.png");
  await png.saveAs(pngPath);
  const pngBytes = await readFile(pngPath);
  assert.deepEqual([...pngBytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.ok(pngBytes.readUInt32BE(16) >= 1500 && pngBytes.readUInt32BE(20) >= 2000);
  const xlsxEvent = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "엑셀", exact: true }).click();
  const xlsx = await xlsxEvent;
  const xlsxPath = path.join(out, "quotation.xlsx");
  await xlsx.saveAs(xlsxPath);
  const workbook = XLSX.read(await readFile(xlsxPath), { type: "buffer" });
  const cells = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1 }).flat().map(String);
  assert.ok(cells.some((cell) => cell.includes("OCR 고객사")));
  assert.ok(cells.includes("AI 추가 키트"));
  assert.ok(cells.includes("2.5"));

  await dialog.locator(":scope > .nd-scroll").evaluate((el) => { el.scrollTop = 0; });
  await page.screenshot({ path: path.join(out, "desktop.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(dialog.getByRole("button", { name: "미리보기", exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "미리보기", exact: true }).click();
  const mobilePreview = dialog.getByRole("region", { name: "견적서 미리보기", exact: true });
  await expect(mobilePreview).toBeVisible();
  const viewport = mobilePreview.locator("[data-quote-preview-viewport]");
  const paper = mobilePreview.locator(".quotation-design");
  const viewportBox = await viewport.boundingBox();
  assert.ok(viewportBox);
  await expect.poll(async () => (await paper.boundingBox())?.width ?? Infinity).toBeLessThanOrEqual(viewportBox.width + 1);
  for (const target of [paper.locator("h1"), paper.locator("p").filter({ hasText: /^₩\s*17,750$/ })]) {
    const box = await target.boundingBox();
    assert.ok(box && box.x >= viewportBox.x - 1 && box.x + box.width <= viewportBox.x + viewportBox.width + 1, "모바일 기본 미리보기의 제목과 오른쪽 견적 금액이 용지 뷰포트 안에 들어온다");
  }
  await mobilePreview.getByRole("button", { name: "원본 크기로 보기", exact: true }).click();
  await expect.poll(async () => (await paper.boundingBox())?.width ?? 0).toBeGreaterThan(viewportBox.width);
  assert.ok(await viewport.evaluate((el) => el.scrollWidth > el.clientWidth), "원본 크기는 용지 뷰포트 안에서 가로 스크롤된다");
  await mobilePreview.getByRole("button", { name: "화면에 맞추기", exact: true }).click();
  await expect.poll(async () => (await paper.boundingBox())?.width ?? Infinity).toBeLessThanOrEqual(viewportBox.width + 1);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), "390px 모바일에서 페이지 가로 넘침 없음");
  await dialog.locator(":scope > .nd-scroll").evaluate((el) => { el.scrollTop = 0; });
  await page.screenshot({ path: path.join(out, "mobile-preview.png") });
  await dialog.getByRole("button", { name: "내용 편집", exact: true }).click();
  await expect(label("견적명")).toBeVisible();

  // 40개 품목 인쇄 HTML을 실제 PDF로 만들어 마지막 품목과 여러 페이지를 검증한다.
  await page.setViewportSize({ width: 1440, height: 1000 });
  const longDoc = await page.evaluate(() => ({ ...window.__saved.doc, design: 4, lines: Array.from({ length: 40 }, (_, i) => ({ id: 'long-' + i, name: 'Pagination item ' + (i + 1), qty: 1, unitPrice: 1000, spec: 'Specification ' + (i + 1) })) }));
  await reopen(longDoc);
  const priorPrints = await page.evaluate(() => window.__printed.length);
  await dialog.getByRole("button", { name: "인쇄 / PDF", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__printed.length)).toBe(priorPrints + 1);
  const longHtml = await page.evaluate(() => window.__printed.at(-1));
  assert.match(longHtml, /Pagination item 40/);
  assert.match(longHtml, /table-header-group/);
  const printPage = await context.newPage();
  await printPage.evaluate(() => { window.print = () => {}; });
  await printPage.setContent(longHtml);
  const pdf = await printPage.pdf({ path: path.join(out, "quotation-long.pdf"), format: "A4", printBackground: true });
  const extracted = await extractText(new Uint8Array(pdf), { mergePages: true });
  assert.ok(extracted.totalPages > 1, "40개 품목은 여러 PDF 페이지로 출력");
  assert.match(extracted.text, /Pagination item 40/);
  await printPage.close();
  assert.deepEqual(errors, [], "React 렌더 중 오류 없음");
  assert.deepEqual(blocked, [], "fixture 외 네트워크 요청 없음");
  await Promise.all(["failure.png", "failure.html"].map((name) => rm(path.join(out, name), { force: true })));
  console.log("PASS quotation UI: metadata save/reopen, VAT/apply amount, supplier/seal/custom data, five designs/print output, AI explicit review/apply, decimal/duplicate/delete lines, save/upload failures, unsaved close, mobile fit-to-width/title/total/original-size scrolling, actual PNG/XLSX downloads and 40-line multipage PDF; all services mocked.");
  console.log(`Artifacts: ${out}`);
} catch (error) {
  if (page) {
    await page.screenshot({ path: path.join(out, "failure.png") }).catch(() => {});
    await writeFile(path.join(out, "failure.html"), await page.content()).catch(() => {});
  }
  if (errors.length) console.error("Fixture browser errors:", errors);
  throw error;
} finally {
  await browser?.close();
  await rm(temp, { recursive: true, force: true });
}
