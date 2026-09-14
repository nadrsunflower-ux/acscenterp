// ============================================================
//  화면 캡처 + 기본 점검 — `node e2e/capture.mjs [태그] [경로...]`
// ------------------------------------------------------------
//  저장된 프로필로 각 경로를 5개 너비에서 열어 PNG 를 남기고,
//  콘솔 오류와 가로 넘침(document 폭 > viewport)을 함께 기록한다.
//  읽기만 한다 — 어떤 버튼도 누르지 않는다.
// ============================================================
import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";
import { PROFILE_DIR, BASE_URL } from "./profile.mjs";

const tag = process.argv[2] || "shot";
const routes = process.argv.slice(3).length
  ? process.argv.slice(3)
  : [
      "/neander",
      "/neander/dev",
      "/neander/dev/board",
      "/neander/tasks",
      "/neander/requests",
      "/neander/messenger",
      "/neander/shortcuts",
      "/neander/schedule",
      "/neander/meetings",
      "/neander/sales",
      "/neander/sales/event-entry",
      "/neander/sales/review",
      "/neander/sales/products",
      "/neander/sales/catalog",
      "/neander/sales/reconcile",
      "/neander/sales/import",
      "/neander/sales/master",
      "/neander/finance",
      "/neander/finance/ledger",
      "/neander/finance/review",
      "/neander/finance/card",
      "/neander/finance/reports",
      "/neander/finance/projects",
      "/neander/finance/close",
      "/neander/finance/import",
      "/neander/finance/master",
      "/neander/members",
    ];
const widths = (process.env.WIDTHS || "1440,1280,1024,768,390").split(",").map(Number);
const outDir = path.join(process.env.SHOT_DIR || "e2e/shots", tag);
fs.mkdirSync(outDir, { recursive: true });

const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
  headless: true,
  viewport: { width: 1440, height: 900 },
});
const page = await ctx.newPage();
const report = [];
page.on("console", (m) => {
  if (m.type() === "error") report.push({ kind: "console", route: page.url(), text: m.text().slice(0, 300) });
});
page.on("pageerror", (e) => report.push({ kind: "pageerror", route: page.url(), text: String(e).slice(0, 300) }));

for (const route of routes) {
  for (const w of widths) {
    await page.setViewportSize({ width: w, height: w < 500 ? 844 : 900 });
    // Firestore 가 웹소켓을 계속 열어 두므로 networkidle 은 끝나지 않는다 — load + 고정 대기
    await page.goto(`${BASE_URL}${route}`, { waitUntil: "load", timeout: 45000 }).catch((e) => report.push({ kind: "nav", route, text: String(e) }));
    await page.waitForSelector("[data-nd-topbar], [data-nd-status]", { timeout: 45000 }).catch(() => {});
    // ⚠️ "불러오는 중…" 은 셸이 붙고 **한 박자 뒤에** 나타난다. 바로 물으면
    //    아직 없어서 통과해 버리고, 로딩 화면을 찍는다 (실제로 그랬다).
    //    그래서 한 박자 주고 → 조용해질 때까지 → 다시 한 박자 → 또 확인한다.
    const quiet = () =>
      page.waitForFunction(() => !/(불러오는|만드는|여는|확인) 중/.test(document.body.innerText), null, { timeout: 60000 });
    await page.waitForTimeout(500);
    await quiet().catch(() => report.push({ kind: "stuck-loading", route, width: w }));
    await page.waitForTimeout(500);
    await quiet().catch(() => {});
    await page.waitForTimeout(Number(process.env.SETTLE_MS || 900));
    const overflow = await page.evaluate(() => {
      const d = document.documentElement;
      return { scrollW: d.scrollWidth, clientW: d.clientWidth };
    });
    if (overflow.scrollW > overflow.clientW + 1) report.push({ kind: "overflow", route, width: w, ...overflow });
    const name = `${route.replace(/^\/neander\/?/, "") || "home"}`.replace(/\//g, "_") + `@${w}.png`;
    await page.screenshot({ path: path.join(outDir, name), fullPage: process.env.FULLPAGE === "0" ? false : w >= 1024 });
  }
}
fs.writeFileSync(path.join(outDir, "report.json"), JSON.stringify(report, null, 2));
console.log(`저장: ${outDir} (${routes.length}경로 × ${widths.length}폭), 문제 ${report.length}건`);
for (const r of report) console.log(" -", r.kind, r.route, r.width ?? "", r.text ?? `${r.scrollW}>${r.clientW}`);
await ctx.close();
