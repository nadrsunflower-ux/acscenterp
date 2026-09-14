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
  "/neander/sales/event-entry",
  "/neander/sales/review",
  "/neander/sales/products",
  "/neander/sales/catalog",
  "/neander/sales/reconcile",
  "/neander/sales/import",
  "/neander/sales/master",
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

/**
 * 화면이 자료를 다 받을 때까지. 재무는 장부 11,000건을 한 번에 받아오고
 * dev 서버는 라우트를 그때그때 컴파일한다 — 넉넉히 기다린다.
 */
async function settle(page: Page) {
  await page.waitForSelector("[data-nd-topbar], [data-nd-status]", { timeout: 60_000 }).catch(() => {});
  await page.waitForFunction(() => !/(불러오는|만드는|여는|확인) 중/.test(document.body.innerText), null, { timeout: 60_000 });
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
  const strip = page.locator("[data-nd-kpi]").first();
  await expect(strip).toContainText("41,656,602");
  await expect(strip).toContainText("58,896,728");
  await expect(strip).toContainText("143,700");
  await expect(strip).toContainText("△17,096,426");
  // 요약 링크가 실제 표를 펼친다
  await page.getByRole("button", { name: /사업장별 손익/ }).click();
  await expect(page.getByRole("columnheader", { name: "사업장" })).toBeVisible();
});

test("matrix numbers open a breakdown: hover previews, click pins a dialog", async () => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${BASE}/neander/finance`, { waitUntil: "load" });
  await settle(page);
  await page.getByRole("button", { name: /사업부 지출 매트릭스/ }).click();

  // 합계 숫자는 눌러서 내역을 볼 수 있는 버튼이다
  const cell = page.getByRole("button", { name: /×.*원, \d+건\. 세부 내역 열기$/ }).first();
  await expect(cell).toBeVisible();

  // 올리면 미리보기 — 마우스를 받지 않아야 깜빡이지 않는다
  await cell.hover();
  const preview = page.locator("[data-nd-breakdown]");
  await expect(preview).toBeVisible();
  await expect(preview).toContainText("모두");
  expect(await preview.evaluate((el) => getComputedStyle(el).pointerEvents)).toBe("none");
  await page.mouse.move(10, 500);
  await expect(preview).toBeHidden();

  // 누르면 창 — 내역·합계·원장 링크, Esc 로 닫히고 포커스 복귀
  await cell.click();
  const dlg = page.getByRole("dialog").first();
  await expect(dlg).toBeVisible();
  await expect(dlg.getByRole("columnheader", { name: "금액" })).toBeVisible();
  expect(await dlg.locator("tbody tr").count()).toBeGreaterThan(0);
  await expect(dlg.getByRole("link", { name: "원장에서 보기" })).toHaveAttribute("href", /\/neander\/finance\/ledger\?/);
  // 잘못 분류된 계정을 그 자리에서 고칠 수 있다 (여는 것까지만 — 실데이터는 건드리지 않는다)
  const acctCell = dlg.getByRole("button", { name: /^계정 고치기/ }).first();
  await acctCell.click();
  // 편집 컨트롤이 창 안에 펼쳐지든 창 위 팝오버로 뜨든 상관없이 보이면 된다
  const acctMajor = page.getByRole("combobox", { name: "계정대분류" });
  await expect(acctMajor).toBeVisible();
  await expect(page.getByRole("combobox", { name: "계정소분류" })).toBeVisible();
  // Esc 는 편집만 닫고 창은 남는다
  await page.keyboard.press("Escape");
  await expect(acctMajor).toBeHidden();
  await expect(dlg).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(dlg).toBeHidden();
  await expect(cell).toBeFocused();
});

test("ledger: rows can be selected and deleted, columns can be hidden and restored", async () => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.goto(`${BASE}/neander/finance/ledger`, { waitUntil: "load" });
  await settle(page);

  const del = page.getByRole("button", { name: /^행 삭제/ });
  await expect(del).toBeDisabled();

  // 행 번호를 눌러 한 행 고르면 버튼이 살아나고 고른 수가 나온다
  const gutter = page.locator(".dsg-cell-gutter").nth(3);
  const gb = await gutter.boundingBox();
  expect(gb).not.toBeNull();
  await page.mouse.click(gb!.x + 10, gb!.y + 10);
  await expect(del).toBeEnabled();
  await expect(del).toContainText("(1)");

  // 삭제는 초안이다 — 저장 전에는 「변경 취소」 로 되돌아간다 (실데이터는 그대로)
  const countBefore = await page.locator("text=검색 결과").first().innerText();
  await del.click();
  const confirmDlg = page.getByRole("dialog").first();
  await expect(confirmDlg).toContainText("삭제할까요");
  await confirmDlg.getByRole("button", { name: "삭제" }).click();
  await expect(page.getByRole("button", { name: /^저장/ })).toContainText("(1)");
  await page.getByRole("button", { name: "변경 취소" }).click();
  await page.getByRole("dialog").first().getByRole("button", { name: "모두 버리기" }).click();
  await expect(page.getByRole("button", { name: /^저장/ })).not.toContainText("(");
  await expect(page.locator("text=검색 결과").first()).toHaveText(countBefore);

  // 새 열은 고른 열 바로 왼쪽에 들어간다 (창만 열어 확인 — 실데이터는 건드리지 않는다)
  const vendorHead = page.locator(".dsg-cell-header", { hasText: "거래처" }).first();
  const vb = await vendorHead.boundingBox();
  expect(vb).not.toBeNull();
  await page.mouse.click(vb!.x + 15, vb!.y + 60);
  await page.getByRole("button", { name: "열 추가" }).click();
  const colDlg = page.getByRole("dialog").first();
  await expect(colDlg).toContainText("바로 왼쪽에 들어갑니다");
  await colDlg.getByRole("button", { name: "취소" }).click();
  await expect(colDlg).toBeHidden();

  // 열은 감추고 되살릴 수 있다 (값은 그대로)
  await page.locator('button[title="볼 열 고르기"]').click();
  const cols = page.getByRole("dialog", { name: "열 관리" });
  await expect(cols).toBeVisible();
  await cols.getByText("사업대분류", { exact: true }).click();
  await expect(page.locator(".dsg-cell-header", { hasText: "사업대분류" })).toHaveCount(0);
  await page.getByRole("button", { name: "모두 보이기" }).click();
  await expect(page.locator(".dsg-cell-header", { hasText: "사업대분류" })).toHaveCount(1);
  await page.keyboard.press("Escape");
});
