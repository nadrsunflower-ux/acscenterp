// 자금 일보의 「잔액 직접 확인」(문자 · 장부가 없는 통장의 잔액)을 실제 React 화면으로 검증한다.
// 통장 · 거래는 전부 가상 fixture이며 모든 네트워크 요청은 가로채거나 차단한다 — 운영 DB에 닿지 않는다.
//
//   npx tsx e2e/daily-cash-check-ui.mjs                 (Chromium)
//   BROWSER=webkit npx tsx e2e/daily-cash-check-ui.mjs  (사파리 엔진 — 설치돼 있을 때)
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { build } from "esbuild";
import { chromium, webkit, expect } from "@playwright/test";

const engine = process.env.BROWSER === "webkit" ? webkit : chromium;
const cwd = process.cwd();
const out = path.join(cwd, "output", `daily-cash-check-ui-${engine.name()}`);
const temp = await mkdtemp(path.join(os.tmpdir(), "erp-daily-check-"));
await mkdir(out, { recursive: true });

const TODAY = "2026-11-13";
// 문자 통장 하나(가상 A) · 문자도 장부 잔액도 없는 대출 통장(가상 대출) · 장부가 오래된 지원 통장(가상 지원)
let checks = [
  { last4: "1111", date: TODAY, balance: 925_119, note: "은행 앱", createdBy: "fixture@example.com" },
  { last4: "2222", date: TODAY, balance: 0 },
];
const ct = (id, date, time, last4, approval, amount, merchant) => ({ id, date, time, order: `${date} ${time} ${id}`, last4, approval, amount, merchant });
const daily = () => ({
  txs: [{ id: "s1", date: TODAY, time: "10:00", order: `${TODAY} 10:00 1`, last4: "3333", kind: "입금", amount: 50_000, balance: 1_050_000 }],
  lastSeen: { "3333": `${TODAY} 10:00` },
  accounts: [{ last4: "1111", label: "가상대출", site: "네안데르" }, { last4: "2222", label: "가상지원", site: "네안데르" }, { last4: "3333", label: "가상입금", site: "네안데르" }],
  // 카드 — 문자 수신 둘(가상카드A · 가상카드B) + 카드 기록만 있는 하나. 카드 문자는 11/10부터
  cards: [{ last4: "4528", label: "가상카드A" }, { last4: "1804", label: "가상카드B" }, { last4: "9999", label: "가상장부카드" }],
  cardTxs: [
    ct("c1", "2026-11-10", "09:00", "4528", "승인", 10_000, "가상문구"),
    ct("c2", "2026-11-12", "12:00", "1804", "승인", 5_000, "가상식당"),
    ct("c3", TODAY, "14:26", "4528", "승인", 16_200, "가상배달"),
    ct("c4", TODAY, "19:25", "4528", "승인", 14_900, "가상배달"),
    ct("c5", TODAY, "20:00", "1804", "취소", 5_000, "가상식당"),
  ],
  cardLastSeen: { "4528": `${TODAY} 19:25`, "1804": `${TODAY} 20:00` },
  cardSmsSince: "2026-11-10",
  linked: { accounts: ["1111", "2222", "3333"], cards: ["4528", "1804"] },
  checks, total: 1,
});
const fixture = {
  projects: [], docs: [], accounts: [], paymentMethods: [], vendorRules: [], loading: false,
  transactions: [{ id: "t1", date: "2025-06-21", last4: "2222", txType: "수입", vendor: "이자", gross: 1298, adjust: 0, site: "네안데르", status: "confirmed", createdAt: 1 }],
};
const mocks = {
  finance: `export const useFinance=()=>({...window.__projectFixture,refresh:async()=>{}});export const useFinanceOptional=useFinance;`,
  auth: `const user={getIdToken:async()=>'fixture-only',email:'fixture@example.com'};export const getNeanderAuth=()=>({currentUser:user,onAuthStateChanged(callback){queueMicrotask(()=>callback(user));return()=>{}}});export const getNeanderDb=()=>({});export const getNeanderApp=()=>({});export const getNeanderStorage=()=>({});export const NEANDER_COL=new Proxy({},{get:(_,k)=>String(k)});`,
  shell: `export const ToolbarPortal=({children})=>children;export const useCrumbTail=()=>{};export const useShellContext=()=>({});export const useDockReservation=()=>{};`,
  navigation: `export const useParams=()=>({});export const usePathname=()=>'/neander/finance/daily';export const useSearchParams=()=>new URLSearchParams();export const useRouter=()=>({push(){},replace(){},prefetch(){},back(){}});`,
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
import Page from './app/neander/finance/daily/page.neander.tsx';
import {ConfirmProvider,ToastProvider} from './components/neander/ui';
createRoot(document.getElementById('root')).render(<div data-app="neander" id="fixture-app"><ConfirmProvider><ToastProvider><Page/></ToastProvider></ConfirmProvider></div>);` },
    plugins: [{ name: "daily-check-fixtures", setup(builder) {
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
    const p = await browser.newPage({ viewport: { width, height: 1200 }, timezoneId: "Asia/Seoul" });
    p.setDefaultTimeout(7_000);
    // 오늘을 2026-11-13 로 못 박는다 — 달력 첫 화면이 11월
    await p.clock.setFixedTime(new Date("2026-11-13T10:00:00+09:00"));
    p.on("pageerror", (error) => errors.push(error.message));
    await p.addInitScript((data) => {
      window.__projectFixture = data;
      window.process = { env: { NODE_ENV: "test" }, browser: true };
      try { localStorage.clear(); } catch {}
    }, fixture);
    await p.route("**/*", async (route) => {
      const request = route.request(), url = new URL(request.url());
      requests.push({ method: request.method(), host: url.host, path: url.pathname });
      if (url.host === "localhost:43169" && url.pathname === "/fixture" && request.method() === "GET") {
        return route.fulfill({ contentType: "text/html; charset=utf-8", body: '<!doctype html><html lang="ko"><head><meta charset="utf-8"></head><body><div id="root"></div></body></html>' });
      }
      if (url.pathname === "/api/neander/finance/daily-cash") {
        return route.fulfill({ contentType: "application/json", body: JSON.stringify(daily()) });
      }
      // 잔액 저장은 받은 내용만 적어 두고 fixture 에 넣는다 — 운영 DB 로 가지 않는다
      if (url.pathname === "/api/neander/finance/mutate" && request.method() === "POST") {
        const b = request.postDataJSON();
        saves.push(b);
        const { last4, date } = b.payload;
        checks = checks.filter((c) => !(c.last4 === last4 && c.date === date));
        if (b.action === "cashCheck.save") checks.push({ ...b.payload });
        return route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true }) });
      }
      return route.abort("blockedbyclient");
    });
    await p.goto("http://localhost:43169/fixture");
    await p.addStyleTag({ content: css });
    await p.addScriptTag({ content: js });
    return p;
  }

  page = await open(1500);
  const table = page.getByRole("table").first();
  const rowOf = (label) => table.locator("tr").filter({ hasText: label });
  await expect(rowOf("가상대출")).toBeVisible();

  // 1. 문자도 장부 잔액도 없는 통장 — 직접 확인한 잔액이 금일 잔액, 전일도 모르므로 같은 값
  await expect(rowOf("가상대출")).toContainText("925,119");
  await expect(rowOf("가상대출")).toContainText("직접 확인 · 11/13");
  // 2. 장부가 오래된 통장 — 0원도 잔액
  await expect(rowOf("가상지원")).toContainText("직접 확인 · 11/13");
  const zeroCell = await rowOf("가상지원").locator("td").nth(5).innerText();
  assert.equal(zeroCell.trim(), "0", `0원 (${zeroCell})`);
  // 3. 문자 통장은 그대로, 모든 통장 합계에 확인 값이 더해진다
  await expect(rowOf("가상입금")).toContainText("1,050,000");
  await expect(rowOf("모든 통장 합계")).toContainText("1,975,119");
  const totalOpening = await rowOf("모든 통장 합계").locator("td").nth(2).innerText();
  assert.equal(totalOpening.trim(), "1,925,119", `합계 전일 잔액에도 확인 값 — 들어온 돈처럼 보이지 않게 (${totalOpening})`);
  checksDone.push("직접 확인 = 금일 잔액 · 0원 · 합계");
  await page.locator("#fixture-app").screenshot({ path: path.join(out, "1-today.png"), animations: "disabled" });

  // 4. 잔액 입력 — 같은 날은 덮어쓴다
  await page.getByRole("button", { name: "가상대출 1111 잔액 입력" }).click();
  const dlg = page.getByRole("dialog");
  await expect(dlg).toBeVisible();
  await expect(dlg.getByRole("textbox").nth(1)).toHaveValue("925,119");
  await dlg.getByRole("textbox").nth(1).fill("900000");
  await dlg.getByRole("button", { name: "저장" }).click();
  await expect(dlg).toHaveCount(0);
  assert.deepEqual(saves.at(-1), { action: "cashCheck.save", payload: { last4: "1111", date: TODAY, balance: 900_000, note: "은행 앱" } });
  await expect(rowOf("가상대출")).toContainText("900,000");
  checksDone.push("잔액 입력 · 덮어쓰기");

  // 4-1. 법인카드 탭 — 통장처럼 네 칸: 전일까지 사용 · 승인 · 취소 · 금일까지 사용 (문자 수신 카드만, 11/10 첫 문자부터)
  await page.getByRole("tab", { name: /법인카드/ }).click();
  const kpi = page.locator("dl, [class*='grid']").filter({ hasText: "전일까지 사용" }).first();
  await expect(kpi).toContainText("금일까지 사용");
  const cellText = async (label) => (await page.getByText(label, { exact: true }).locator("xpath=ancestor::*[self::div or self::dd or self::li][2]").first().innerText()).replace(/\s+/g, " ");
  const before = await cellText("전일까지 사용");
  assert.ok(before.includes("15,000") && before.includes("11/10 ~ 11/12 · 문자 수신 카드"), before);
  const approve = await cellText("승인");
  assert.ok(approve.includes("31,100") && approve.includes("2건"), approve);
  const cancel = await cellText("취소");
  assert.ok(cancel.includes("5,000") && cancel.includes("1건"), cancel);
  const through = await cellText("금일까지 사용");
  assert.ok(through.includes("41,100") && through.includes("11/10 ~ 11/13 · 문자 수신 카드"), through);
  await expect(page.locator("#fixture-app")).toContainText("카드 문자는 11/10부터 받아 그 앞은 빠져 있어요");
  // 숫자를 누르면 내역 — 승인 두 건(최근 것이 위), 금일까지는 카드별
  await page.getByRole("button", { name: "31,100" }).first().click();
  const pop = page.getByRole("dialog", { name: "문자 수신 카드 · 승인 내역" });
  await expect(pop).toBeVisible();
  await expect(pop).toContainText("가상카드A 4528");
  await expect(pop).toContainText("14,900");
  await expect(pop).toContainText("16,200");
  await page.locator("#fixture-app").screenshot({ path: path.join(out, "2-card.png"), animations: "disabled" });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "41,100" }).first().click();
  const pop2 = page.getByRole("dialog", { name: "금일까지 사용 · 문자 수신 카드 내역" });
  await expect(pop2).toContainText("가상카드A 4528");
  await expect(pop2).toContainText("41,100");
  await expect(pop2).not.toContainText("가상장부카드");
  await page.keyboard.press("Escape");
  checksDone.push("법인카드 요약 네 칸 · 내역");
  await page.getByRole("tab", { name: /통장/ }).click();

  // 5. 전날 — 확인 전이라 비어 있다
  await page.getByRole("button", { name: "전날" }).click();
  await expect(rowOf("가상대출")).not.toContainText("직접 확인");
  checksDone.push("확인 전 날짜는 그대로");

  assert.deepEqual(errors, [], "브라우저 런타임 오류 없음");
  assert.deepEqual(requests.filter((r) => r.method !== "GET" && r.path !== "/api/neander/finance/mutate"), [], "다른 쓰기 요청 없음");
  await writeFile(path.join(out, "report.json"), JSON.stringify({ passed: true, engine: engine.name(), checks: checksDone, errors }, null, 2));
  console.log(`PASS 자금 일보 잔액 확인 (${engine.name()}): ${checksDone.join(" / ")} · 캡처 ${out}`);
} catch (error) {
  await page?.screenshot({ path: path.join(out, "failure.png"), fullPage: true }).catch(() => {});
  console.error("errors:", errors);
  throw error;
} finally {
  await browser?.close();
  await rm(temp, { recursive: true, force: true });
}
