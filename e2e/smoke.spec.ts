// ============================================================
//  NEANDER ERP 스모크 — 화면이 뜨고, 넘치지 않고, 숫자가 맞는다
// ------------------------------------------------------------
//  1) 모든 주요 라우트가 콘솔 오류 없이 렌더된다 (1440 · 390)
//  2) 390px 에서 페이지가 가로로 넘치지 않는다
//  3) 모바일 드로어가 열리고 Esc 로 닫히며 포커스가 돌아온다
//  4) 재무 대시보드 2026년 7월 손익이 엑셀 검증값과 원 단위로 같다
//     (총수입 41,656,602 / 총지출 58,896,728 / 환급 143,700 / 순손익 △17,096,426)
//
//  Google 로그인은 자동화할 수 없어서 사람이 한 번 로그인한 프로필을
//  재사용한다 (e2e/profile.mjs). 로그인 전이면 전부 skip 된다.
// ============================================================
import { test, expect, chromium, type BrowserContext, type Page } from "@playwright/test";
import os from "node:os";
import path from "node:path";

const PROFILE_DIR = path.join(os.homedir(), "Library", "Application Support", "neander-erp-playwright");
const BASE = process.env.NEANDER_BASE_URL || "http://localhost:3001";

const ROUTES = [
  "/neander",
  "/neander/dev",
  "/neander/dev/board",
  "/neander/dev/timeline",
  "/neander/dev/features",
  "/neander/tasks",
  "/neander/requests",
  "/neander/messenger",
  "/neander/shortcuts",
  "/neander/schedule",
  "/neander/meetings",
  "/neander/sales",
  "/neander/members",
  "/neander/finance",
  "/neander/finance/ledger",
  "/neander/finance/review",
  "/neander/finance/card",
  "/neander/finance/reports",
  "/neander/finance/reports/units",
  "/neander/finance/reports/subscriptions",
  "/neander/finance/reports/budget",
  "/neander/finance/projects",
  "/neander/finance/close",
  "/neander/finance/import",
  "/neander/finance/master",
];

/** 화면이 자료를 다 받을 때까지 */
async function settle(page: Page) {
  await page.waitForFunction(() => !/(불러오는|만드는|여는) 중/.test(document.body.innerText), null, { timeout: 45_000 });
  await page.waitForTimeout(400);
}

let ctx: BrowserContext;
let page: Page;
const errors: { route: string; text: string }[] = [];

test.beforeAll(async () => {
  ctx = await chromium.launchPersistentContext(PROFILE_DIR, { headless: true, viewport: { width: 1440, height: 900 } });
  page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push({ route: page.url(), text: String(e) }));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push({ route: page.url(), text: m.text() });
  });
  await page.goto(`${BASE}/neander`);
  await page.waitForTimeout(3000);
  if (page.url().includes("/neander/login")) {
    test.skip(true, "로그인된 프로필이 없습니다 — `npm run ui:login` 으로 먼저 로그인하세요.");
  }
});

test.afterAll(async () => {
  await ctx?.close();
});

for (const route of ROUTES) {
  test(`renders ${route} at 1440 and 390 without errors or horizontal overflow`, async () => {
    for (const width of [1440, 390]) {
      errors.length = 0;
      await page.setViewportSize({ width, height: width < 500 ? 844 : 900 });
      await page.goto(`${BASE}${route}`, { waitUntil: "load" });
      await settle(page);
      const { scrollW, clientW } = await page.evaluate(() => ({
        scrollW: document.documentElement.scrollWidth,
        clientW: document.documentElement.clientWidth,
      }));
      expect(scrollW, `${route} @${width} 가로 넘침`).toBeLessThanOrEqual(clientW + 1);
      const real = errors.filter((e) => !/favicon|ResizeObserver loop/i.test(e.text));
      expect(real, `${route} @${width} 콘솔 오류: ${real.map((e) => e.text).join(" | ")}`).toHaveLength(0);
      // 셸이 있고 제목이 있다
      await expect(page.locator("[data-nd-topbar]")).toBeVisible();
    }
  });
}

test("mobile drawer opens, closes with Escape, returns focus", async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}/neander`, { waitUntil: "load" });
  await settle(page);
  const open = page.getByRole("button", { name: "메뉴 열기" });
  await open.focus();
  await open.click();
  const drawer = page.getByRole("dialog", { name: "메뉴" });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole("link", { name: "대시보드" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(open).toBeFocused();
});

test("finance dashboard: month picker and 2026-07 P&L match the Excel reference", async () => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${BASE}/neander/finance`, { waitUntil: "load" });
  await settle(page);
  const picker = page.getByRole("button", { name: /^월 선택/ });
  await picker.click();
  await page.getByRole("menuitem", { name: "2026년 7월" }).click();
  await expect(picker).toHaveText("2026년 7월");
  const strip = page.locator("text=총수입").locator("xpath=ancestor::div[contains(@class,'grid')][1]");
  await expect(strip).toContainText("41,656,602");
  await expect(strip).toContainText("58,896,728");
  await expect(strip).toContainText("143,700");
  await expect(strip).toContainText("△17,096,426");
  // 요약 링크가 실제 표를 펼친다
  await page.getByRole("button", { name: /사업장별 손익/ }).click();
  await expect(page.getByRole("columnheader", { name: "사업장" })).toBeVisible();
});
