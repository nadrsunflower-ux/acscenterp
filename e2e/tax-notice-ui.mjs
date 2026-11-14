// 세금 고지서 화면(목록 · 넣기 창 · 폰 한 장 화면)을 실제 React 화면으로 검증한다.
// 고지서는 전부 가상 fixture 이고 모든 네트워크 요청은 가로채거나 막는다 — 운영 DB 에 닿지 않는다.
//
//   npx tsx e2e/tax-notice-ui.mjs
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";

const cwd = process.cwd();
const out = path.join(cwd, "output", "tax-notice-ui");
const temp = await mkdtemp(path.join(os.tmpdir(), "erp-tax-notice-"));
await mkdir(out, { recursive: true });

const now = Date.parse("2026-11-14T12:00:00+09:00");
const NOTICES = [
  { id: "n1", level: "국세", item: "부가가치세", tags: ["예정고지"], site: "네안데르", amount: 790130, dueDate: "2026-11-27", source: "push", receivedAt: now, createdAt: now, state: "open", from: "push:카카오톡", raw: "[국세청] 국세 고지서가 도착했습니다.\n세목: 부가가치세(예정고지)\n납부할 세액: 790,130원\n납부기한: 2026.11.27" },
  { id: "n2", level: "국세", source: "sms", receivedAt: now - 3600_000, createdAt: now, state: "open", raw: "[국세청] 전자고지서가 도착하였습니다. 손택스에서 확인하세요." },
  { id: "n3", level: "국세", item: "부가가치세", tags: ["체납"], site: "일해라컴퍼니", amount: 811640, dueDate: "2026-11-30", source: "manual", receivedAt: now - 86_400_000, createdAt: now, state: "paid", paidDate: "2026-11-14" },
];

const mocks = {
  auth: `const user={getIdToken:async()=>'fixture-only',email:'fixture@example.com'};export const getNeanderAuth=()=>({currentUser:user});export const getNeanderDb=()=>({});`,
  useauth: `const state={user:{email:'fixture@example.com'},loading:false};export const useAuth=()=>state;`,
  navigation: `export const useParams=()=>({id:window.__noticeId||'n2'});export const usePathname=()=>'/neander/tax';export const useSearchParams=()=>new URLSearchParams();export const useRouter=()=>({push(h){window.__pushed=h},replace(){},prefetch(){},back(){}});`,
  link: `import {forwardRef} from 'react';export default forwardRef(function Link({href,children,prefetch,replace,scroll,...props},ref){return <a ref={ref} href={typeof href==='string'?href:'#'} {...props}>{children}</a>});`,
};

async function bundleOf(entry) {
  const b = await build({
    absWorkingDir: cwd, bundle: true, write: false, outfile: path.join(temp, "fixture.js"),
    format: "iife", platform: "browser", jsx: "automatic", logLevel: "silent",
    define: { "process.env.NODE_ENV": '"test"' },
    stdin: { resolveDir: cwd, loader: "tsx", contents: `
import {createRoot} from 'react-dom/client';
import Page from '${entry}';
import {ConfirmProvider,ToastProvider} from './components/neander/ui';
createRoot(document.getElementById('root')).render(<div data-app="neander" id="fixture-app"><ConfirmProvider><ToastProvider><Page/></ToastProvider></ConfirmProvider></div>);` },
    plugins: [{ name: "tax-fixtures", setup(builder) {
      builder.onResolve({ filter: /^@\/lib\/neander\/firebase$/ }, () => ({ path: "auth", namespace: "fixture" }));
      builder.onResolve({ filter: /^@\/components\/neander\/auth$/ }, () => ({ path: "useauth", namespace: "fixture" }));
      builder.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: "navigation", namespace: "fixture" }));
      builder.onResolve({ filter: /^next\/link$/ }, () => ({ path: "link", namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path: name }) => ({ contents: mocks[name], loader: "tsx", resolveDir: cwd }));
    } }],
  });
  return b.outputFiles;
}

/** Field 칸 — 라벨 글자로 찾는다 (select 는 고른 값이 이름에 붙어 getByLabel 로는 안 잡힌다) */
const field = (scope, label) =>
  scope.locator("label").filter({ has: (typeof scope.page === "function" ? scope.page() : scope).locator("span.nd-field-label", { hasText: new RegExp(`^${label.replace(/[()]/g, "\\$&")}\\s*\\*?$`) }) }).locator("input,select").first();

let browser;
const errors = [];
const patches = [];
const posts = [];
const checks = [];
try {
  await writeFile(path.join(temp, "tailwind-input.css"), "@tailwind base;\n@tailwind components;\n@tailwind utilities;\n");
  execFileSync(process.execPath, [path.join(cwd, "node_modules/tailwindcss/lib/cli.js"), "-c", path.join(cwd, "tailwind.config.ts"), "-i", path.join(temp, "tailwind-input.css"), "-o", path.join(temp, "tailwind.css"), "--minify"], { cwd, stdio: "pipe" });
  const baseCss = await readFile(path.join(temp, "tailwind.css"), "utf8")
    + await readFile(path.join(cwd, "app/neander/neander.css"), "utf8")
    + "\nbody{margin:0;font-family:system-ui,sans-serif}#fixture-app{min-height:100vh;padding:24px;background:rgb(var(--nd-bg-page))}\n";

  browser = await chromium.launch({ headless: true });
  async function open(entry, viewport, noticeId) {
    const files = await bundleOf(entry);
    const css = baseCss + files.filter((f) => f.path.endsWith(".css")).map((f) => f.text).join("\n");
    const js = files.find((f) => f.path.endsWith(".js")).text;
    const page = await browser.newPage({ viewport, timezoneId: "Asia/Seoul" });
    page.setDefaultTimeout(7_000);
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript((id) => {
      window.__noticeId = id;
      window.process = { env: { NODE_ENV: "test" }, browser: true };
      Date.now = () => Date.parse("2026-11-14T12:00:00+09:00");
    }, noticeId);
    await page.route("**/*", async (route) => {
      const req = route.request(), url = new URL(req.url());
      if (url.host === "localhost:43167" && url.pathname === "/fixture") {
        return route.fulfill({ contentType: "text/html; charset=utf-8", body: '<!doctype html><html lang="ko"><head><meta charset="utf-8"></head><body><div id="root"></div></body></html>' });
      }
      if (url.pathname === "/api/neander/finance/tax-notices") {
        const id = url.searchParams.get("id");
        if (req.method() === "GET" && id) return route.fulfill({ contentType: "application/json", body: JSON.stringify({ notice: NOTICES.find((n) => n.id === id) }) });
        if (req.method() === "GET") return route.fulfill({ contentType: "application/json", body: JSON.stringify({ notices: NOTICES.map(({ raw: _r, ...n }) => n) }) });
        if (req.method() === "PATCH") {
          const body = req.postDataJSON();
          patches.push(body);
          const n = NOTICES.find((x) => x.id === id);
          Object.assign(n, Object.fromEntries(Object.entries(body).map(([k, v]) => [k, v ?? undefined])));
          return route.fulfill({ contentType: "application/json", body: JSON.stringify({ notice: n }) });
        }
        if (req.method() === "POST") {
          posts.push(req.postDataJSON());
          return route.fulfill({ contentType: "application/json", body: JSON.stringify({ id: "new1" }) });
        }
      }
      return route.abort("blockedbyclient");
    });
    await page.goto("http://localhost:43167/fixture");
    await page.addStyleTag({ content: css });
    await page.addScriptTag({ content: js });
    return page;
  }

  // ① 목록 — 넓은 화면
  const list = await open("./app/neander/finance/tax/page.neander.tsx", { width: 1500, height: 900 });
  await expect(list.getByRole("heading", { name: "세금 고지서" })).toBeVisible();
  await expect(list.getByText("낼 고지서 2장 · 790,130원")).toBeVisible();
  await expect(list.getByText("2026. 11/27(금)")).toBeVisible();
  await expect(list.getByText("13일 남음")).toBeVisible();
  await expect(list.getByText("납기 · 금액 · 사업자 · 세목 채우기")).toBeVisible();
  await list.screenshot({ path: path.join(out, "1-list.png"), fullPage: true });
  checks.push("목록: 낼 고지서 합계 · 납기 남은 날 · 못 읽은 칸 안내");

  // ② 넣기 창 — 칸이 한 줄로 맞는다
  await list.getByRole("button", { name: "고지서 넣기" }).click();
  const dlg = list.getByRole("dialog");
  await expect(dlg).toBeVisible();
  const top = async (label) => (await field(dlg, label).boundingBox()).y;
  assert.equal(Math.round(await top("사업자")), Math.round(await top("세목")), "사업자 · 세목 칸 높이가 같다");
  assert.equal(Math.round(await top("낼 돈 (원)")), Math.round(await top("납부기한")), "금액 · 납기 칸 높이가 같다");
  await field(dlg, "사업자").selectOption("네안데르");
  await field(dlg, "세목").selectOption("부가가치세");
  await field(dlg, "낼 돈 (원)").fill("790130");
  await expect(field(dlg, "낼 돈 (원)")).toHaveValue("790,130");
  await field(dlg, "납부기한").fill("2026-11-27");
  await list.screenshot({ path: path.join(out, "2-add.png") });
  await dlg.getByRole("button", { name: "넣기" }).click();
  await expect.poll(() => posts.length).toBe(1);
  assert.deepEqual(posts[0], { site: "네안데르", item: "부가가치세", level: "국세", amount: 790130, dueDate: "2026-11-27" });
  await expect.poll(() => list.evaluate(() => window.__pushed)).toBe("/neander/tax/new1");
  checks.push("넣기: 칸 높이 맞음 · 숫자 쉼표 · 세목 고르면 국세 따라옴 · 넣은 뒤 한 장 화면으로");

  // ③ 폰 한 장 화면 — 못 읽은 고지서를 채운다 (저장 버튼 없이 칸을 벗어나면 저장)
  const phone = await open("./app/neander/tax/[id]/page.neander.tsx", { width: 390, height: 844 }, "n2");
  await expect(phone.getByText("국세 고지 (사업자 모름)")).toBeVisible();
  await expect(phone.getByText("납기 모름 — 아래에서 넣어 주세요")).toBeVisible();
  await phone.screenshot({ path: path.join(out, "3-phone-blank.png"), fullPage: true });
  await field(phone, "낼 돈 (원)").fill("790130");
  await field(phone, "납부기한").fill("2026-11-27");
  await expect.poll(() => patches.length).toBe(2);
  assert.deepEqual(patches, [{ amount: 790130 }, { dueDate: "2026-11-27" }], "금액은 칸을 벗어날 때 · 날짜는 고르는 즉시");
  await field(phone, "사업자").selectOption("네안데르");
  await expect.poll(() => patches.length).toBeGreaterThanOrEqual(3);
  assert.ok(patches.some((p) => p.dueDate === "2026-11-27"), "납기 저장");
  assert.ok(patches.some((p) => p.site === "네안데르"), "사업자 저장");
  await expect(phone.getByText("13일 남음")).toBeVisible();
  await phone.getByRole("button", { name: "냈음" }).click();
  await expect.poll(() => patches.at(-1)?.state).toBe("paid");
  await expect(phone.getByRole("button", { name: "다시 낼 것으로" })).toBeVisible();
  await phone.screenshot({ path: path.join(out, "4-phone-paid.png"), fullPage: true });
  const overflow = await phone.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(overflow <= 0, `폰 화면 가로 밀림 ${overflow}px`);
  checks.push("폰: 금액 · 납기 · 사업자를 칸 벗어나면 저장 · 냈음 · 가로 밀림 없음");

  assert.deepEqual(errors, [], `화면 오류: ${errors.join(" | ")}`);
  console.log(checks.map((c) => `ok  ${c}`).join("\n"));
  console.log(`\n화면: ${out}`);
} finally {
  await browser?.close();
  await rm(temp, { recursive: true, force: true });
}
