// 매출 비서의 새 상품 · 나누기 제안 — 실제 SalesChat·AssistantChat·저장 client 를 쓴다.
// 제안은 실제 도구(ai-tools.ts)가 fixture 판매 줄로 만든 것이고, 모델·DB 에는 닿지 않는다.
// 모든 요청은 메모리 응답 또는 차단이다.
//
// 확인하는 것: 어느 카드를 먼저 적용해도 새 상품이 먼저 만들어지고(product.upsert),
// 이미 만든 상품은 다시 만들지 않으며, 할인 나누기는 합계 = 결제액인 discount 를 싣는다.
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";

const cwd = process.cwd();
const shots = process.env.SHOTS_DIR;

// ---- 제안 만들기 — 실제 도구로 -----------------------------------
const tools = await build({
  absWorkingDir: cwd, bundle: true, write: false, platform: "node", format: "esm", logLevel: "silent",
  stdin: { resolveDir: cwd, loader: "ts", contents: `export { runSalesTool } from './lib/neander/sales/server/ai-tools';export { SEED_ASSUMPTIONS } from './lib/neander/sales/master-data';` },
});
const toolFile = join(mkdtempSync(join(tmpdir(), "sales-assistant-")), "tools.mjs");
writeFileSync(toolFile, tools.outputFiles[0].text);
const { runSalesTool, SEED_ASSUMPTIONS } = await import(pathToFileURL(toolFile).href);

const product = (p) => ({ store: "id", kind: "regular", option: "기본", material: 0, timeMin: 0, makeMin: 0, bottles: 1, ...p });
const line = (id, amount) => ({
  id, date: "2026-10-22", store: "id", route: "payhere", amount, qty: 1, status: "needs_review",
  reason: "amount_only", raw: "금액 입력", eventId: "ID-036",
});
const products = [
  product({ id: "IDE-002", name: "이벤트향수", option: "50ml", kind: "event", price: 48_000, material: 9_000 }),
  product({ id: "IDE-009", name: "다른 행사 키링", kind: "event", price: 18_000, eventIds: ["ID-027"] }),
];
const ctx = {
  lines: [line("c1", 15_000), line("c2", 15_000), line("c3", 15_000), line("c4", 15_000), line("f1", 10_000), line("mix35", 35_000), line("mix102", 102_000)],
  products,
  events: [{ id: "ID-036", store: "id", name: "비아이", from: "2026-10-21", to: "2026-10-22", hoursPerDay: 7, staff: 1, supplies: 0 }],
  assumptions: SEED_ASSUMPTIONS,
  pending: [],
};
const call = (name, args) => {
  const out = runSalesTool(name, args, ctx);
  assert.equal(out.result.ok, true, `${name}: ${out.result.error ?? ""}`);
  return out;
};
const clicker = call("propose_product", { store: "id", name: "비아이 클리커", price: 15_000, eventId: "ID-036", reason: "비아이 전용 클리커 — 사용자가 15,000원이라고 알려줌" });
const figure = call("propose_product", { store: "id", name: "비아이 피규어", price: 10_000, eventId: "ID-036", reason: "비아이 전용 피규어 — 사용자가 10,000원이라고 알려줌" });
const C = clicker.result.productId, F = figure.result.productId;
const proposals = [
  clicker.proposal,
  figure.proposal,
  call("propose_resolve", { ids: ["c1", "c2", "c3", "c4"], productId: C, reason: "15,000원 4건은 클리커 (사용자 확인)" }).proposal,
  call("propose_resolve", { ids: ["f1"], productId: F, reason: "10,000원은 피규어 (사용자 확인)" }).proposal,
  call("propose_split", { ids: ["mix35"], parts: [{ productId: C, qty: 1 }, { productId: F, qty: 2 }], reason: "클리커 1 + 피규어 2 (사용자 확인)" }).proposal,
  call("propose_split", { ids: ["mix102"], parts: [{ productId: "IDE-002", qty: 2 }, { productId: F, qty: 1 }], discount: true, reason: "50ml 2 + 피규어 1 · 실결제 102,000원 (사용자 확인)" }).proposal,
];

// ---- 화면 묶기 --------------------------------------------------
const mocks = {
  sales: `import {useSyncExternalStore} from 'react';const listeners=new Set();const subscribe=fn=>{listeners.add(fn);return()=>listeners.delete(fn)};const snap=()=>window.__salesProducts;const apply=({upsert=[]})=>{const ids=new Set(upsert.map(p=>p.id));window.__salesProducts=[...window.__salesProducts.filter(p=>!ids.has(p.id)),...upsert];listeners.forEach(fn=>fn())};export function useSales(){const products=useSyncExternalStore(subscribe,snap,snap);return {products,events:window.__salesEvents,refresh:async()=>{window.__refreshes=(window.__refreshes||0)+1},applyProducts:apply,applyLines(){}}}`,
  auth: `const user={getIdToken:async()=>'fixture-only'};export const getNeanderAuth=()=>({currentUser:user});`,
  shell: `export const ToolbarPortal=({children})=>children;export const useDockReservation=()=>{};export const useShellOptional=()=>null;export const useSidebarBadge=()=>{};export const useCrumbTail=()=>{};`,
  navigation: `export const usePathname=()=>'/neander/sales/review';export const useRouter=()=>({push(){}});export const useSearchParams=()=>new URLSearchParams();`,
  link: `import {forwardRef} from 'react';export default forwardRef(function Link({href,children,prefetch,replace,scroll,...props},ref){return <a ref={ref} href={typeof href==='string'?href:'#'} {...props}>{children}</a>});`,
};
const bundle = await build({
  absWorkingDir: cwd, bundle: true, write: false, outdir: join(tmpdir(), "sales-assistant-fixture"), format: "iife", platform: "browser", jsx: "automatic", logLevel: "silent",
  define: { "process.env.NODE_ENV": '"test"' },
  stdin: { resolveDir: cwd, loader: "tsx", contents: `import {createRoot} from 'react-dom/client';import {SalesChat} from './components/neander/sales/SalesChat';import {ConfirmProvider,ToastProvider} from './components/neander/ui';createRoot(document.getElementById('root')).render(<div data-app="neander" style={{padding:24}}><ConfirmProvider><ToastProvider><SalesChat/></ToastProvider></ConfirmProvider></div>);` },
  plugins: [{ name: "sales-assistant-fixtures", setup(b) {
    b.onResolve({ filter: /(?:^|\/)SalesProvider$/ }, () => ({ path: "sales", namespace: "fixture" }));
    b.onResolve({ filter: /^@\/lib\/neander\/firebase$/ }, () => ({ path: "auth", namespace: "fixture" }));
    b.onResolve({ filter: /^@\/components\/neander\/shell\/context$/ }, () => ({ path: "shell", namespace: "fixture" }));
    b.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: "navigation", namespace: "fixture" }));
    b.onResolve({ filter: /^next\/link$/ }, () => ({ path: "link", namespace: "fixture" }));
    b.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({ contents: mocks[path], loader: "tsx", resolveDir: cwd }));
  } }],
});
const styles = [".next-neander/static/css/app/layout.css", ".next-neander/static/css/app/neander/layout.neander.css"]
  .filter(existsSync).map((file) => readFileSync(file, "utf8").replace(/@import[^;]+;/g, ""));

const mutations = [], forbidden = [], errors = [];
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1400 }, timezoneId: "Asia/Seoul" });
  page.setDefaultTimeout(8000);
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/*", async (route) => {
    const req = route.request(), url = new URL(req.url());
    if (url.host !== "localhost:43171") return route.abort("blockedbyclient");
    if (url.pathname === "/fixture") {
      return route.fulfill({ contentType: "text/html; charset=utf-8", body: `<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script>window.__salesProducts=${JSON.stringify(products)};window.__salesEvents=${JSON.stringify(ctx.events)};window.process={env:{NODE_ENV:'test'},browser:true};</script></body></html>` });
    }
    if (url.pathname === "/api/neander/sales/ai/chats") return route.fulfill({ json: { chats: [] } });
    if (url.pathname === "/api/neander/sales/ai/chat" && req.method() === "POST") {
      return route.fulfill({ json: {
        reply: "비아이(ID-036) 미확정 7건 — 전용 상품 2개를 만들고 확정·나누기를 제안했습니다. 화면에서 보고 승인해 주세요.",
        toolCalls: [], proposals, model: "fixture", conversationId: "fixture-chat",
        usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 },
      } });
    }
    if (url.pathname === "/api/neander/sales/mutate" && req.method() === "POST") {
      const body = req.postDataJSON();
      mutations.push(body);
      return route.fulfill({ json: { ok: true, count: 1, created: [], lines: [] } });
    }
    forbidden.push(`${req.method()} ${url.pathname}`);
    return route.abort("blockedbyclient");
  });

  await page.goto("http://localhost:43171/fixture");
  for (const css of styles) await page.addStyleTag({ content: css });
  for (const out of bundle.outputFiles.filter((f) => f.path.endsWith(".css"))) await page.addStyleTag({ content: out.text });
  await page.addScriptTag({ content: bundle.outputFiles.find((f) => f.path.endsWith(".js")).text });

  await page.getByRole("button", { name: "매출 비서 열기" }).click();
  const box = page.getByPlaceholder(/판매·상품·이벤트에 대해 물어보세요/);
  await box.fill("비아이 미확정 정리해줘");
  await box.press("Enter");
  await expect(page.getByText("새 상품 만들기").first()).toBeVisible();
  await expect(page.getByText(/나눠서 확정/).first()).toBeVisible();
  const card = (text) => page.locator("div.rounded-nd-lg.border.p-3").filter({ hasText: text });
  await expect(card("IDE-011 비아이 피규어").first()).toContainText("비아이 (ID-036) 전용");
  if (shots) {
    await page.screenshot({ path: join(shots, "sales-assistant-cards.png") });
    await card("50ml 2 + 피규어 1").screenshot({ path: join(shots, "sales-assistant-split-discount.png") });
    await card("클리커 1 + 피규어 2").screenshot({ path: join(shots, "sales-assistant-split.png") });
  }

  const applyOn = async (text) => {
    const before = mutations.length;
    await card(text).getByRole("button", { name: "적용", exact: true }).click();
    await expect(card(text).getByText("처리됨")).toBeVisible();
    return mutations.slice(before);
  };

  // ① 할인 나누기를 먼저 — 피규어(F)가 아직 없으니 먼저 만들고 나눈다
  let got = await applyOn("50ml 2 + 피규어 1");
  assert.deepEqual(got.map((m) => m.action), ["product.upsert", "line.split"]);
  assert.equal(got[0].payload.product.id, F);
  assert.deepEqual(got[0].payload.product.eventIds, ["ID-036"]);
  const parts = got[1].payload.parts;
  assert.equal(parts.reduce((s, p) => s + p.amount, 0), 102_000, "합계 = 결제액");
  assert.deepEqual(parts.map((p) => [p.productId, p.qty, p.discount?.list]), [["IDE-002", 2, 96_000], [F, 1, 10_000]]);
  assert.ok(parts.every((p) => Math.abs(p.discount.rate - 4_000 / 106_000) < 1e-9));

  // ② 피규어 상품 카드 — 이미 만들었으니 저장 없이 처리됨
  got = await applyOn("비아이 전용 피규어");
  assert.deepEqual(got, []);

  // ③ 35,000 나누기 — 클리커만 새로 만든다
  got = await applyOn("클리커 1 + 피규어 2");
  assert.deepEqual(got.map((m) => [m.action, m.payload.product?.id]), [["product.upsert", C], ["line.split", undefined]]);
  assert.deepEqual(got[1].payload.parts, [{ productId: C, qty: 1, amount: 15_000 }, { productId: F, qty: 2, amount: 20_000 }]);

  // ④ 단일 확정 — 상품은 이미 있다
  got = await applyOn("15,000원 4건은 클리커");
  assert.deepEqual(got.map((m) => m.action), ["line.bulkResolve"]);
  assert.deepEqual(got[0].payload.ids, ["c1", "c2", "c3", "c4"]);
  assert.equal(got[0].payload.productId, C);
  got = await applyOn("10,000원은 피규어");
  assert.deepEqual(got.map((m) => [m.action, m.payload.productId]), [["line.bulkResolve", F]]);
  got = await applyOn("비아이 전용 클리커");
  assert.deepEqual(got, []);

  if (shots) await card("50ml 2 + 피규어 1").screenshot({ path: join(shots, "sales-assistant-applied.png") });
  assert.deepEqual(forbidden, []);
  assert.deepEqual(errors, []);
  console.log(`ok — 제안 ${proposals.length}개 · 저장 요청 ${mutations.length}건 (${mutations.map((m) => m.action).join(", ")})`);
} finally {
  await browser?.close();
}
