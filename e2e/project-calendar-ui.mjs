// 프로젝트 목록 맨 위 달력(진행 기간 막대 · 납기 깃발)을 실제 React 화면으로 검증한다.
// 프로젝트는 전부 가상 fixture이며 모든 네트워크 요청은 가로채거나 차단한다 — 운영 DB에 닿지 않는다.
//
//   npx tsx e2e/project-calendar-ui.mjs                 (Chromium)
//   BROWSER=webkit npx tsx e2e/project-calendar-ui.mjs  (사파리 엔진 — 설치돼 있을 때)
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { build } from "esbuild";
import { chromium, webkit, expect } from "@playwright/test";
import { emptyProject } from "../lib/neander/finance/project.ts";

const engine = process.env.BROWSER === "webkit" ? webkit : chromium;
const cwd = process.cwd();
const out = path.join(cwd, "output", `project-calendar-ui-${engine.name()}`);
const temp = await mkdtemp(path.join(os.tmpdir(), "erp-project-cal-"));
await mkdir(out, { recursive: true });

let n = 0;
const proj = (name, status, dates = {}) => ({ ...emptyProject(), id: `p${++n}`, code: `T-${n}`, name, status, createdAt: n, contractAmount: 1_000_000, ...dates });
const projects = [
  proj("2026 가상 체험 A (12/9~12)", "planning", { startDate: "2026-12-09", endDate: "2026-12-12", deliveryDate: "2026-12-09", equipment: { photobooth: 1, kiosk: 1 } }),
  proj("2026 가상 교육 B", "planning", { startDate: "2026-12-12", endDate: "2026-12-12", deliveryDate: "2026-12-11", equipment: { photobooth: 3 } }),
  proj("2026 가상 시상식 C", "planning", { startDate: "2026-12-15", endDate: "2026-12-15", deliveryDate: "2026-12-15", equipment: { photobooth: 2, kiosk: 2 } }),
  proj("2026 가상 대행 E", "active", { startDate: "2026-11-01" }),
  proj("2026 가상 행사 F", "done", { startDate: "2026-11-12", endDate: "2026-11-12", deliveryDate: "2026-11-12" }),
  proj("2026 가상 장기 G", "active", { startDate: "2026-11-25", endDate: "2026-12-08", deliveryDate: "2026-12-07" }),
  proj("2026 가상 취소 H", "cancelled", { startDate: "2026-12-15", endDate: "2026-12-15", equipment: { photobooth: 3 } }),
  proj("2026 가상 미정 I", "planning", {}),
  proj("2026 가상 설치 J", "planning", { startDate: "2026-12-07", endDate: "2026-12-11", deliveryDate: "2026-12-07", equipment: { kiosk: 3 } }),
];
const fixture = { projects, docs: [], transactions: [], accounts: [], paymentMethods: [], vendorRules: [], loading: false };
const mocks = {
  // refresh 를 부르면 fixture 를 다시 읽어 그린다 — 실제 FinanceProvider 가 목록을 다시 받는 것과 같게
  finance: `import {useEffect,useState} from 'react';export const useFinance=()=>{const [,bump]=useState(0);useEffect(()=>{const h=()=>bump((n)=>n+1);window.addEventListener('fixture-change',h);return()=>window.removeEventListener('fixture-change',h)},[]);return {...window.__projectFixture,refresh:async()=>{window.dispatchEvent(new Event('fixture-change'))}}};export const useFinanceOptional=useFinance;`,
  auth: `const user={getIdToken:async()=>'fixture-only',email:'fixture@example.com'};export const getNeanderAuth=()=>({currentUser:user,onAuthStateChanged(callback){queueMicrotask(()=>callback(user));return()=>{}}});export const getNeanderDb=()=>({});export const getNeanderApp=()=>({});export const getNeanderStorage=()=>({});export const NEANDER_COL=new Proxy({},{get:(_,k)=>String(k)});`,
  shell: `export const ToolbarPortal=({children})=>children;export const useCrumbTail=()=>{};export const useShellContext=()=>({});export const useDockReservation=()=>{};`,
  navigation: `export const useParams=()=>({});export const usePathname=()=>'/neander/finance/projects';export const useSearchParams=()=>new URLSearchParams();export const useRouter=()=>({push(){},replace(){},prefetch(){},back(){}});`,
  link: `import {forwardRef} from 'react';export default forwardRef(function Link({href,children,prefetch,replace,scroll,...props},ref){return <a ref={ref} href={typeof href==='string'?href:'#'} onClick={(e)=>{e.preventDefault();window.__navigated=href;}} {...props}>{children}</a>});`,
};

let browser;
let page;
const errors = [];
const requests = [];
const checks = [];
const saves = [];
try {
  const bundle = await build({
    absWorkingDir: cwd, bundle: true, write: false, outfile: path.join(temp, "fixture.js"),
    format: "iife", platform: "browser", jsx: "automatic", logLevel: "silent",
    define: { "process.env.NODE_ENV": '"test"' },
    stdin: { resolveDir: cwd, loader: "tsx", contents: `
import {createRoot} from 'react-dom/client';
import Page from './app/neander/finance/projects/page.neander.tsx';
import {ConfirmProvider,ToastProvider} from './components/neander/ui';
createRoot(document.getElementById('root')).render(<div data-app="neander" id="fixture-app"><ConfirmProvider><ToastProvider><Page/></ToastProvider></ConfirmProvider></div>);` },
    plugins: [{ name: "project-calendar-fixtures", setup(builder) {
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
      if (url.host === "localhost:43168" && url.pathname === "/fixture" && request.method() === "GET") {
        return route.fulfill({ contentType: "text/html; charset=utf-8", body: '<!doctype html><html lang="ko"><head><meta charset="utf-8"></head><body><div id="root"></div></body></html>' });
      }
      // 장비 저장은 받은 내용만 적어 두고 fixture 에 넣는다 — 운영 DB 로 가지 않는다
      if (url.pathname === "/api/neander/finance/mutate" && request.method() === "POST") {
        const body = request.postDataJSON();
        saves.push(body);
        await p.evaluate(({ id, equipment }) => {
          const f = window.__projectFixture;
          window.__projectFixture = { ...f, projects: f.projects.map((x) => (x.id === id ? { ...x, equipment: Object.keys(equipment).length ? equipment : undefined } : x)) };
        }, body.payload);
        return route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, equipment: body.payload.equipment }) });
      }
      return route.abort("blockedbyclient");
    });
    await p.goto("http://localhost:43168/fixture");
    await p.addStyleTag({ content: css });
    await p.addScriptTag({ content: js });
    return p;
  }

  page = await open(1600);
  const cal = page.getByRole("region", { name: "프로젝트 달력" });
  await expect(cal).toBeVisible();
  const bar = (text) => cal.locator("[data-cal-item]").filter({ hasText: text });

  // 1. 달력이 지표 · 표보다 위
  const calTop = (await cal.boundingBox()).y;
  const headTop = (await page.getByRole("region", { name: "프로젝트 손익" }).boundingBox()).y;
  assert.ok(calTop < headTop, "달력이 지표 위");
  await expect(cal).toContainText("2026년 11월");
  await expect(cal.locator('[aria-current="date"]')).toContainText("13");
  checks.push("맨 위 · 오늘 11/13");

  // 2. 11월 — 시작만 있는 건은 「시작」 한 칸, 완료는 초록, 주를 넘는 막대
  await expect(bar("시작 · 가상 대행 E")).toHaveCount(1);
  await expect(bar("가상 행사 F")).toHaveCount(1);
  await expect(bar("가상 장기 G")).toHaveCount(2); // 11/25~28 주 + 다음 주(11/29~12/5, 달력 끝줄)로 이어짐
  // 11월엔 겹침이 없다 — 머리에 「장비 겹침 2건」, 다른 달 안내에 12월
  await expect(cal.getByText("장비 겹침 2건")).toBeVisible();
  await expect(cal.locator('[role="alert"]')).toHaveCount(0);
  await page.locator("#fixture-app").screenshot({ path: path.join(out, "1-november.png"), animations: "disabled" });

  // 3. 12월 — 다른 달 안내의 「2026년 12월」 을 눌러 간다. 막대 폭 = 기간, 깃발, 기간 밖 납기는 따로, 취소 · 날짜 없는 건은 없음
  await cal.getByRole("button", { name: "2026년 12월" }).click();
  await expect(cal).toContainText("2026년 12월");
  const dayW = (await cal.locator("[data-cal-day]").first().boundingBox()).width;
  const a = await bar("가상 체험 A").boundingBox();
  assert.ok(Math.abs(a.width - dayW * 4) < 12, `A 막대 = 나흘 (${Math.round(a.width)} ≈ ${Math.round(dayW * 4)})`);
  assert.equal(await bar("가상 체험 A").locator('[aria-label="납기"]').count(), 1, "A 첫날 납기 깃발");
  await expect(bar("납기 · 가상 교육 B")).toHaveCount(1);
  await expect(bar(/^가상 교육 B/)).toHaveCount(1);
  await expect(cal.locator("[data-cal-item]").filter({ hasText: "취소 H" })).toHaveCount(0);
  await expect(cal).toContainText("진행 기간 · 납기가 비어 있는 1건은 달력에 없습니다 — 가상 미정 I");
  // G 는 지난달에서 이어지고 그 주 화요일 깃발(12/7)
  const g = bar("← 가상 장기 G").first();
  await expect(g).toBeVisible();
  // 같은 주 겹치는 A · J · G 는 서로 다른 줄
  const ys = await Promise.all(["가상 체험 A", "가상 설치 J", "← 가상 장기 G"].map(async (t) => Math.round((await bar(t).first().boundingBox()).y)));
  assert.equal(new Set(ys).size, 3, `겹치면 다른 줄 ${ys}`);
  checks.push("막대 폭 · 깃발 · 기간 밖 납기 · 취소 제외 · 겹침 줄");

  // 3-1. 장비 겹침 — 키오스크 12/9~11 (A1 + J3) · 포토부스 12/11~12 (A1 + B3). 취소 H 는 세지 않는다
  const alertBox = cal.locator('[role="alert"]');
  await expect(alertBox).toContainText("장비가 모자라는 날 2건");
  const lines = await alertBox.locator("li").allInnerTexts();
  assert.ok(lines[0].includes("12/9(수) ~ 12/11(금) 키오스크 4대 필요 · 보유 3대"), lines[0]);
  assert.ok(lines[1].includes("12/11(금) ~ 12/12(토) 포토부스 4대 필요 · 보유 3대") && lines[1].includes("가상 교육 B 3(심사 중)"), lines[1]);
  assert.equal(await cal.locator('[data-cal-day="2026-12-11"]').getAttribute("data-equip-over"), "true");
  assert.equal(await cal.locator('[data-cal-day="2026-12-15"]').getAttribute("data-equip-over"), null, "12/15 는 2/3 · 2/3 — 취소 H 제외");
  await expect(cal.locator('[data-cal-day="2026-12-11"] [data-equip-load="over"]')).toHaveCount(2);
  await expect(cal.locator('[data-cal-day="2026-12-15"] [data-equip-load="ok"]').first()).toContainText("2/3");
  await expect(bar("가상 체험 A").locator('[aria-label="장비 포토부스 1 · 키오스크 1"]')).toHaveCount(1);
  checks.push("장비 겹침 2건 · 날짜 칸 표시 · 취소 제외");
  await page.locator("#fixture-app").screenshot({ path: path.join(out, "2-december.png"), animations: "disabled" });

  // 3-2. 막대를 누르면 장비 배정 창 — 대수를 줄이면 미리 보기에서 겹침이 사라지고, 저장은 장비 칸만 보낸다
  await bar(/^가상 교육 B/).click();
  const dlg = page.getByRole("dialog");
  await expect(dlg).toBeVisible();
  await expect(dlg).toContainText("포토부스 4대 필요");
  assert.equal(await dlg.getByRole("link", { name: /프로젝트 열기/ }).getAttribute("href"), "/neander/finance/projects/p2");
  await dlg.getByRole("button", { name: "포토부스 한 대 빼기" }).click();
  await expect(dlg).toContainText("겹쳐서 모자라는 날이 없습니다");
  await page.locator("#fixture-app").screenshot({ path: path.join(out, "2b-dialog.png"), animations: "disabled" });
  await dlg.getByRole("button", { name: "저장" }).click();
  await expect(dlg).toHaveCount(0);
  assert.deepEqual(saves.at(-1), { action: "project.setEquipment", payload: { id: "p2", equipment: { photobooth: 2 } } });
  await expect(alertBox).toContainText("장비가 모자라는 날 1건");
  await expect(alertBox).toContainText("키오스크");
  checks.push("창에서 배정 · 미리 보기 · 장비 칸만 저장");

  // 4. 상태 탭을 따른다 — 진행 중만
  await page.getByRole("tab", { name: /진행 중/ }).click();
  await expect(bar("가상 체험 A")).toHaveCount(0);
  await expect(bar("가상 장기 G").first()).toBeVisible();
  await expect(alertBox).toContainText("키오스크 4대 필요", { timeout: 2000 });
  checks.push("상태 탭을 따름 · 겹침은 전체로");

  // 5. 접기
  await cal.getByRole("button", { name: "접기" }).click();
  await expect(cal.locator("[data-cal-item]")).toHaveCount(0);
  await cal.getByRole("button", { name: "펼치기" }).click();
  await expect(cal.locator("[data-cal-item]").first()).toBeVisible();
  checks.push("접기 · 펼치기");
  await page.close();

  // 6. 좁은 화면 — 날짜 순 목록, 가로 밀림 없음
  page = await open(760);
  const calN = page.getByRole("region", { name: "프로젝트 달력" });
  await calN.getByRole("button", { name: "다음 달" }).click();
  const list = calN.locator("ul li button");
  await expect(list.first()).toBeVisible();
  const texts = await list.allInnerTexts();
  assert.ok(texts[0].includes("가상 장기 G"), `첫 줄은 지난달에서 이어진 G (${texts[0]})`);
  assert.ok(texts.some((t) => t.includes("가상 체험 A") && t.includes("납기 12/9(수)")), "기간 안 납기 표시");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(overflow <= 0, `가로 밀림 없음 (${overflow}px)`);
  checks.push("좁은 화면 목록");
  await page.screenshot({ path: path.join(out, "3-narrow.png"), fullPage: true });

  assert.deepEqual(errors, [], "브라우저 런타임 오류 없음");
  assert.deepEqual(requests.filter((r) => r.method !== "GET" && r.path !== "/api/neander/finance/mutate"), [], "다른 쓰기 요청 없음");
  assert.ok(saves.every((b) => b.action === "project.setEquipment"), "통째 저장 없음");
  await writeFile(path.join(out, "report.json"), JSON.stringify({ passed: true, engine: engine.name(), checks, errors }, null, 2));
  console.log(`PASS 프로젝트 달력 (${engine.name()}): ${checks.join(" / ")} · 캡처 ${out}`);
} catch (error) {
  await page?.screenshot({ path: path.join(out, "failure.png"), fullPage: true }).catch(() => {});
  console.error("errors:", errors);
  throw error;
} finally {
  await browser?.close();
  await rm(temp, { recursive: true, force: true });
}
