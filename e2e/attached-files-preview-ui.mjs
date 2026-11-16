// 프로젝트 「자료」 줄을 펼치면 그 자리에서 미리보기가 나오는지 실제 React 화면으로 검증한다.
// 파일은 전부 이 스크립트가 만든 가상 파일이고, 첨부 라우트는 가로채 응답한다 — 운영 DB에 닿지 않는다.
//
//   npx tsx e2e/attached-files-preview-ui.mjs                 (Chromium)
//   BROWSER=webkit npx tsx e2e/attached-files-preview-ui.mjs  (사파리 엔진 — 설치돼 있을 때)
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { build } from "esbuild";
import { chromium, webkit, expect } from "@playwright/test";
import JSZip from "jszip";
import * as XLSX from "xlsx";
import { ATTACHED_FILE_PART_BYTES, validateAttachedFileMeta } from "../lib/neander/finance/attached-files.ts";

const engine = process.env.BROWSER === "webkit" ? webkit : chromium;
const cwd = process.cwd();
const out = path.join(cwd, "output", `attached-files-preview-ui-${engine.name()}`);
const temp = await mkdtemp(path.join(os.tmpdir(), "erp-attached-preview-"));
await mkdir(out, { recursive: true });

// ---- 가상 파일 ------------------------------------------------
function makePdf(text) {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    null,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  const stream = `BT /F1 28 Tf 72 760 Td (${text}) Tj ET`;
  objects[3] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  let body = "%PDF-1.4\n";
  const offsets = [];
  objects.forEach((obj, i) => { offsets.push(body.length); body += `${i + 1} 0 obj\n${obj}\nendobj\n`; });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}
async function makeDocx() {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file("_rels/.rels", '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file("word/document.xml", '<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>가상 제안서 워드 본문</w:t></w:r></w:p><w:p><w:r><w:t>두 번째 문단</w:t></w:r></w:p></w:body></w:document>');
  return zip.generateAsync({ type: "nodebuffer" });
}
async function makeHwpx() {
  const zip = new JSZip();
  const section = (text) => `<?xml version="1.0" encoding="UTF-8"?><hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph"><hp:p><hp:run><hp:t>${text}</hp:t></hp:run></hp:p></hs:sec>`;
  zip.file("Contents/section0.xml", section("가상 한글 첫 구역"));
  zip.file("Contents/section1.xml", section("가상 한글 둘째 구역"));
  return zip.generateAsync({ type: "nodebuffer" });
}
async function makePptx() {
  const zip = new JSZip();
  const slide = (text) => `<?xml version="1.0" encoding="UTF-8"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`;
  zip.file("ppt/slides/slide1.xml", slide("첫 슬라이드 제목"));
  zip.file("ppt/slides/slide2.xml", slide("둘째 슬라이드 내용"));
  zip.file("ppt/slides/slide10.xml", slide("열째 슬라이드"));
  return zip.generateAsync({ type: "nodebuffer" });
}
function makeXlsx() {
  const book = XLSX.utils.book_new();
  const quote = XLSX.utils.aoa_to_sheet([["품목", "수량", "금액"], ["AI 포토부스", 1, 17_600_000], ["설치", 1, 1_760_000]]);
  quote.C2.z = "#,##0"; quote.C3.z = "#,##0"; // 실제 견적 엑셀처럼 쉼표 서식 — 화면도 엑셀이 보여 주는 대로
  XLSX.utils.book_append_sheet(book, quote, "견적");
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["메모"], ["둘째 시트 글자"]]), "메모");
  return XLSX.write(book, { type: "buffer", bookType: "xlsx" });
}
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==", "base64");

const raw = [
  ["견적서_발송용.pdf", makePdf("Fixture PDF 26-224")],
  ["설치할방_현장사진.png", PNG],
  ["견적_계산.xlsx", makeXlsx()],
  ["제안서.docx", await makeDocx()],
  ["계획서.hwpx", await makeHwpx()],
  ["발표.pptx", await makePptx()],
  ["메모.txt", Buffer.from("가상 메모 첫 줄\n둘째 줄", "utf8")],
  ["옛 공문.hwp", Buffer.from("not really hwp")],
];
const blobs = new Map();
const files = raw.map(([name, bytes], i) => {
  const meta = validateAttachedFileMeta({ name, type: "", size: bytes.length, sha256: "a".repeat(63) + i.toString(16) });
  assert.ok(meta.ok, name);
  const file = { id: `f${i}`, ...meta.value, uploadedAt: Date.UTC(2026, 10, 16) };
  blobs.set(file.id, bytes);
  return file;
});

const mocks = {
  auth: `const user={getIdToken:async()=>'fixture-only',email:'fixture@example.com'};export const getNeanderAuth=()=>({currentUser:user,onAuthStateChanged(callback){queueMicrotask(()=>callback(user));return()=>{}}});export const getNeanderDb=()=>({});export const getNeanderApp=()=>({});export const getNeanderStorage=()=>({});export const NEANDER_COL=new Proxy({},{get:(_,k)=>String(k)});`,
};

let browser;
let page;
const errors = [];
const reads = [];
const checks = [];
try {
  const bundle = await build({
    absWorkingDir: cwd, bundle: true, write: false, outfile: path.join(temp, "fixture.js"),
    format: "iife", platform: "browser", jsx: "automatic", logLevel: "silent",
    define: { "process.env.NODE_ENV": '"test"' },
    stdin: { resolveDir: cwd, loader: "tsx", contents: `
import {createRoot} from 'react-dom/client';
import {ProjectFilesPanel} from './components/neander/finance/AttachedFiles.tsx';
import {ConfirmProvider,ToastProvider} from './components/neander/ui';
createRoot(document.getElementById('root')).render(<div data-app="neander" id="fixture-app"><ConfirmProvider><ToastProvider><ProjectFilesPanel projectId="fixture"/></ToastProvider></ConfirmProvider></div>);` },
    plugins: [{ name: "attached-preview-fixtures", setup(builder) {
      builder.onResolve({ filter: /^@\/lib\/neander\/firebase$/ }, () => ({ path: "auth", namespace: "fixture" }));
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
  page.setDefaultTimeout(8_000);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => { window.process = { env: { NODE_ENV: "test" }, browser: true }; });
  await page.route("**/*", async (route) => {
    const request = route.request(), url = new URL(request.url());
    if (url.host === "localhost:43168" && url.pathname === "/fixture") {
      return route.fulfill({ contentType: "text/html; charset=utf-8", body: '<!doctype html><html lang="ko"><head><meta charset="utf-8"></head><body><div id="root"></div></body></html>' });
    }
    if (url.pathname === "/api/neander/finance/projects/files" && request.method() === "GET") {
      const id = url.searchParams.get("id");
      if (!id) return route.fulfill({ contentType: "application/json", body: JSON.stringify({ files }) });
      reads.push(id);
      const from = Number(url.searchParams.get("from")), count = Number(url.searchParams.get("count"));
      const bytes = blobs.get(id).subarray(from * ATTACHED_FILE_PART_BYTES, (from + count) * ATTACHED_FILE_PART_BYTES);
      return route.fulfill({ contentType: "application/octet-stream", body: bytes });
    }
    if (url.protocol === "blob:" || url.protocol === "data:") return route.continue();
    return route.abort("blockedbyclient");
  });
  await page.goto("http://localhost:43168/fixture");
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: js });

  const row = (name) => page.locator(`button[aria-controls="attached-preview-${files.find((f) => f.name === name).id}"]`);
  const region = (name) => page.locator(`#attached-preview-${files.find((f) => f.name === name).id}`);
  await expect(row("견적서_발송용.pdf")).toBeVisible();

  // 0. 처음엔 모두 접혀 있고 아무것도 받지 않는다
  assert.equal(await page.locator('[aria-expanded="true"]').count(), 0);
  assert.equal(reads.length, 0, "펼치기 전엔 원본을 받지 않음");
  checks.push("처음엔 접힘 · 안 받음");

  // 1. PDF — iframe 으로 그 자리에서
  await row("견적서_발송용.pdf").click();
  await expect(row("견적서_발송용.pdf")).toHaveAttribute("aria-expanded", "true");
  const pdf = region("견적서_발송용.pdf").locator("iframe");
  await expect(pdf).toBeVisible();
  assert.match(await pdf.getAttribute("src"), /^blob:/);
  const pdfBox = await pdf.boundingBox();
  assert.ok(pdfBox.height > 450 && pdfBox.width > 1000, `PDF 칸 크기 ${Math.round(pdfBox.width)}×${Math.round(pdfBox.height)}`);
  checks.push("PDF");

  // 2. 사진
  await row("설치할방_현장사진.png").click();
  await expect(region("설치할방_현장사진.png").locator("img")).toBeVisible();
  checks.push("사진");

  // 3. 엑셀 — 표 · 시트 바꾸기
  await row("견적_계산.xlsx").click();
  const sheet = region("견적_계산.xlsx");
  await expect(sheet.locator("table")).toContainText("AI 포토부스");
  await expect(sheet.locator("table")).toContainText("17,600,000");
  await sheet.getByRole("radio", { name: "메모" }).or(sheet.getByRole("tab", { name: "메모" })).or(sheet.getByRole("button", { name: "메모" })).first().click();
  await expect(sheet.locator("table")).toContainText("둘째 시트 글자");
  checks.push("엑셀 표 · 시트");

  // 4. 워드 — 스크립트 없는 iframe
  await row("제안서.docx").click();
  const docx = region("제안서.docx").locator("iframe");
  await expect(docx).toBeVisible();
  assert.equal(await docx.getAttribute("sandbox"), "allow-same-origin", "스크립트 없는 iframe");
  await expect(docx.contentFrame().locator("body")).toContainText("가상 제안서 워드 본문");
  const docxBox = await docx.boundingBox();
  assert.ok(docxBox.height < 260, `짧은 워드 문서는 칸도 낮게 (${Math.round(docxBox.height)}px)`);
  checks.push("워드");

  // 5. 한글(hwpx) · 파워포인트(pptx) — 글자, 슬라이드는 번호 순서(10 이 2 앞에 오지 않게)
  await row("계획서.hwpx").click();
  await expect(region("계획서.hwpx")).toContainText("가상 한글 첫 구역");
  await expect(region("계획서.hwpx")).toContainText("가상 한글 둘째 구역");
  await row("발표.pptx").click();
  await expect(region("발표.pptx")).toContainText("열째 슬라이드");
  const pptText = await region("발표.pptx").textContent();
  assert.ok(pptText.indexOf("슬라이드 2") < pptText.indexOf("슬라이드 10"), `슬라이드 번호 순서 ${JSON.stringify(pptText)}`);
  checks.push("hwpx · pptx 글자");

  // 6. 글자 · 못 여는 형식
  await row("메모.txt").click();
  await expect(region("메모.txt")).toContainText("가상 메모 첫 줄");
  await row("옛 공문.hwp").click();
  await expect(region("옛 공문.hwp")).toContainText("구형 한글(.hwp)");
  assert.equal(reads.filter((id) => id === files.find((f) => f.name === "옛 공문.hwp").id).length, 0, "못 여는 형식은 받지 않음");
  checks.push("txt · hwp 안내");
  await page.waitForTimeout(400);
  console.log("열린 줄:", await page.locator('button[aria-expanded="true"]').count(), "/", files.length);
  await page.screenshot({ path: path.join(out, "1-expanded.png"), fullPage: true });

  // 7. 접었다 다시 펼치면 또 받지 않는다
  const before = reads.length;
  await row("견적서_발송용.pdf").click();
  await expect(row("견적서_발송용.pdf")).toHaveAttribute("aria-expanded", "false");
  await expect(region("견적서_발송용.pdf")).toBeHidden();
  await row("견적서_발송용.pdf").click();
  await expect(region("견적서_발송용.pdf").locator("iframe")).toBeVisible();
  assert.equal(reads.length, before, "다시 펼칠 때 원본을 또 받지 않음");
  checks.push("접기 · 다시 펼치기(캐시)");

  // 8. 좁은 화면 가로 밀림 없음
  await page.setViewportSize({ width: 390, height: 900 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(overflow <= 0, `가로 밀림 없음 (${overflow}px)`);
  await page.screenshot({ path: path.join(out, "2-narrow.png"), fullPage: true });
  checks.push("좁은 화면");

  assert.deepEqual(errors, [], "브라우저 런타임 오류 없음");
  await writeFile(path.join(out, "report.json"), JSON.stringify({ passed: true, engine: engine.name(), checks, errors }, null, 2));
  console.log(`PASS 자료 미리보기 (${engine.name()}): ${checks.join(" / ")} · 캡처 ${out}`);
} catch (error) {
  await page?.screenshot({ path: path.join(out, "failure.png"), fullPage: true }).catch(() => {});
  console.error("errors:", errors);
  throw error;
} finally {
  await browser?.close();
  await rm(temp, { recursive: true, force: true });
}
