// ============================================================
//  재무 「API 비용」 — 로그인한 일회용 Chrome 으로 화면 · 저장 확인
// ------------------------------------------------------------
//    node e2e/finance-api-costs-ui.mjs <BASE_URL> <토큰파일> <샷 폴더> [시험할 키 이름] [재무 프로젝트 코드]
//  (토큰파일 = npm run e2e:token · 로그인한 사람이 재무 권한이 있어야 한다)
//  키 이름을 주면 그 키에 기본 붙일 곳 · 날짜 구간을 넣었다가 원래대로 되돌린다
//  (neander_fin_api_alloc 만 쓴다). 그 키에 이미 정해 둔 것이 있으면 시험하지 않는다.
//  「원가로 보내기」 는 실제 프로젝트를 고치므로 창을 열어 보기만 하고 보내지 않는다.
// ============================================================
import { chromium } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

const [BASE_URL, tokenFile, shotDir, trialKey, projectCode] = process.argv.slice(2);
if (!BASE_URL || !tokenFile || !shotDir) throw new Error("사용법: node e2e/finance-api-costs-ui.mjs <BASE_URL> <토큰파일> <샷 폴더> [키 이름]");
mkdirSync(shotDir, { recursive: true });
const t = JSON.parse(readFileSync(tokenFile, "utf8"));
let fails = 0;
const ok = (c, label, detail = "") => {
  console.log(`${c ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!c) fails++;
};

const browser = await chromium.launch({ channel: "chrome", headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(`${BASE_URL}/neander/login`, { waitUntil: "domcontentloaded" });
await page.evaluate(async (t) => {
  const user = {
    uid: t.uid, email: t.email, emailVerified: true, displayName: t.displayName, photoURL: t.photoURL, isAnonymous: false, providerData: [],
    stsTokenManager: { refreshToken: t.refreshToken, accessToken: t.idToken, expirationTime: t.expirationTime },
    createdAt: String(Date.now()), lastLoginAt: String(Date.now()), apiKey: t.apiKey, appName: "[DEFAULT]",
  };
  await new Promise((resolve, reject) => {
    const req = indexedDB.open("firebaseLocalStorageDb", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("firebaseLocalStorage", { keyPath: "fbase_key" });
    req.onsuccess = () => {
      const tx = req.result.transaction("firebaseLocalStorage", "readwrite");
      tx.objectStore("firebaseLocalStorage").put({ fbase_key: `firebase:authUser:${t.apiKey}:[DEFAULT]`, value: user });
      tx.oncomplete = () => resolve(null);
      tx.onerror = () => reject(tx.error);
    };
    req.onerror = () => reject(req.error);
  });
}, t);

const open = async () => {
  await page.goto(`${BASE_URL}/neander/finance/api-costs`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "API 비용", exact: true }).first().waitFor({ timeout: 180_000 });
  await page.getByText("이 기간 쓴 돈", { exact: true }).first().waitFor({ timeout: 120_000 });
};
const shot = (name) => page.screenshot({ path: path.join(shotDir, `${name}.png`), fullPage: true });
const hOverflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

await open();
await page.waitForTimeout(800);
await shot("01-page");
ok(await page.getByRole("link", { name: "API 비용" }).first().isVisible(), "사이드바에 API 비용 메뉴");
ok((await hOverflow()) <= 1, "넓은 화면 — 가로로 밀리지 않음");
for (const label of ["이 기간 쓴 돈", "안 정한 돈", "충전 잔액 (지금)"]) ok(await page.getByText(label, { exact: true }).first().isVisible(), `지표 ${label}`);
ok(await page.getByRole("heading", { name: "키별" }).isVisible(), "키별 표");
ok(await page.getByRole("heading", { name: "붙일 곳별" }).isVisible(), "붙일 곳별 표");

if (trialKey) {
  const select = () => page.getByRole("combobox", { name: `${trialKey} 기본으로 붙일 곳` });
  await select().scrollIntoViewIfNeeded();
  if ((await select().inputValue()) !== "") {
    console.log(`  (건너뜀) ${trialKey} 에 이미 기본이 정해져 있어 저장 시험을 하지 않습니다.`);
  } else {
    // ① 기본 — 고르면 바로 저장
    await select().selectOption("common:");
    await page.getByText(`${trialKey} → 공통 · 내부`).first().waitFor({ timeout: 30_000 });
    await open();
    ok((await select().inputValue()) === "common:", "기본 붙일 곳 — 새로 열어도 남아 있음");

    // ② 키를 펼쳐 시간 고르기 → 그 시간만 다른 곳에 — 하루가 나뉜다
    await page.getByRole("button", { name: trialKey, exact: true }).click();
    await page.locator('input[aria-label$=" 고르기"]:not([aria-label="모든 날 고르기"])').first().waitFor({ timeout: 10_000 });
    await shot("02-key-open");
    // 쓴 시간이 둘 이상인 날을 찾는다 — 끝난 날에서 (오늘은 줄이 바뀔 수 있다)
    const hourBoxes = () => page.locator('input[aria-label$="시 고르기"]');
    const openers = page.getByRole("button", { name: /시간별 보기$/ });
    let dayName = null;
    for (let i = (await openers.count()) - 1; i >= 0; i--) {
      const label = await openers.nth(i).getAttribute("aria-label");
      await openers.nth(i).click();
      await page.waitForTimeout(150);
      if ((await hourBoxes().count()) >= 2) {
        dayName = label.replace(" 시간별 보기", "");
        break;
      }
      await openers.nth(i).click();
      await page.waitForTimeout(100);
    }
    ok(dayName, "시간별로 펼칠 수 있는 날", dayName ?? "");
    const hourLabel = (await hourBoxes().first().getAttribute("aria-label")).replace(" 고르기", "");
    await hourBoxes().first().locator("xpath=ancestor::tr[1]").click();
    await page.waitForTimeout(200);
    ok(await page.getByText("1시간 고름").first().isVisible(), "날 줄에 고른 시간 수", hourLabel);
    await shot("03-hours");
    const pickSelect = page.getByRole("combobox", { name: "고른 시간을 붙일 곳" });
    const studioValue = await pickSelect.locator('optgroup[label="AI STUDIO 채널"] option').first().getAttribute("value");
    await pickSelect.selectOption(studioValue);
    await page.getByText(/에 붙였습니다\./).first().waitFor({ timeout: 30_000 });
    const trashes = page.getByRole("button", { name: "이 구간 지우기" });
    ok((await trashes.count()) === 1, "고른 시간이 구간 하나로");
    // 사이드바에도 li 가 있다 — 지우기 버튼이 달린 줄만 본다
    const rangeText = await page.locator("li").filter({ has: page.getByRole("button", { name: "이 구간 지우기" }) }).first().textContent();
    const hourNo = /(\d+)시$/.exec(hourLabel)?.[1];
    ok(rangeText.includes(`${hourNo}시`), "구간에 고른 시각이 보임", rangeText.slice(0, 50));
    ok(await page.locator("tr", { hasText: dayName }).filter({ hasText: "나뉨" }).first().isVisible(), "그 날이 「나뉨」 으로 표시");
    await shot("04-split");

    // ③ 구간 지우기 — 원래대로
    await trashes.first().click();
    await page.getByText("구간을 지웠습니다").first().waitFor({ timeout: 30_000 });
    ok((await page.getByRole("button", { name: "이 구간 지우기" }).count()) === 0, "구간을 지움");
    ok((await page.locator("tr", { hasText: dayName }).filter({ hasText: "나뉨" }).count()) === 0, "지우면 다시 안 나뉨");

    // ③′ 칸에 직접 적어 넣기 — 시작 · 끝 시각
    await page.getByLabel("시작일").fill("2026-11-05");
    await page.getByLabel("시작 시각").selectOption("19");
    await page.getByLabel("끝날 (비우면 계속)").fill("2026-11-06");
    await page.getByLabel("끝 시각").selectOption("04");
    await page.getByRole("combobox", { name: "구간을 붙일 곳" }).selectOption(studioValue);
    await page.getByRole("button", { name: "구간 넣기" }).click();
    await page.getByText(/11\/5 19시 ~ 11\/6 4시 →/).first().waitFor({ timeout: 30_000 });
    ok(await page.locator("li", { hasText: "11/5 19시 ~ 11/6 4시" }).first().isVisible(), "직접 적은 구간 — 11/5 19시 ~ 11/6 4시");
    await page.getByRole("button", { name: "이 구간 지우기" }).first().click();
    await page.waitForFunction(() => document.querySelectorAll('button[aria-label="이 구간 지우기"]').length === 0, null, { timeout: 30_000 });

    // ④ 원가로 보내기 — 창만 열어 본다 (보내지 않는다). 손으로 적은 API 줄이 있는 프로젝트가 좋은 시험감이다
    if (projectCode) {
      // 재무 데이터(거래 포함)는 화면보다 늦게 도착한다 — 프로젝트가 칸에 들어올 때까지 기다린다
      await page.waitForFunction(
        ([name, code]) => [...document.querySelectorAll(`select[aria-label="${name} 기본으로 붙일 곳"] option`)].some((o) => o.textContent.includes(code)),
        [trialKey, projectCode],
        { timeout: 180_000 },
      );
      const value = await select().evaluate((el, code) => [...el.options].find((o) => o.textContent.includes(code))?.value ?? "", projectCode);
      ok(value.startsWith("fin:"), `재무 프로젝트 ${projectCode} 를 고를 수 있음`);
      await select().selectOption(value);
      await page.getByRole("button", { name: "원가로 보내기" }).first().waitFor({ timeout: 30_000 });
      await page.getByRole("button", { name: "원가로 보내기" }).first().click();
      const dialog = page.getByRole("dialog");
      await dialog.waitFor({ timeout: 10_000 });
      ok(await dialog.getByText(/× 1,430원|× [\d,]+원/).first().isVisible(), "창 — 달러 × 환율 = 원화");
      console.log(`  손으로 적은 줄 경고: ${(await dialog.getByText("손으로 적은 API 비용 줄").count()) > 0 ? "있음" : "없음"}`);
      await page.waitForTimeout(300);
      await shot("06-push-dialog");
      await dialog.getByRole("button", { name: "취소" }).click();
      await dialog.waitFor({ state: "hidden", timeout: 10_000 });
    }

    await select().selectOption("");
    await page.getByText(`${trialKey} 의 기본을 지웠습니다.`).first().waitFor({ timeout: 30_000 });
    await open();
    ok((await select().inputValue()) === "", "시험 뒤 원래대로 — 기본 비어 있음");
    await page.getByRole("button", { name: trialKey, exact: true }).click();
    await page.waitForTimeout(200);
    ok(await page.getByText("없습니다 — 모든 시간이 키의 기본을 따릅니다.").first().isVisible(), "시험 뒤 원래대로 — 구간 없음");
    await page.getByRole("button", { name: trialKey, exact: true }).click();
  }
}

// 좁은 화면
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(500);
ok((await hOverflow()) <= 1, "모바일 폭 — 가로로 밀리지 않음", `${await hOverflow()}px`);
await shot("05-mobile");

ok(errors.length === 0, "화면 오류 없음", errors.slice(0, 3).join(" / "));
await browser.close();
console.log(fails ? `\n✗ ${fails}개 실패` : "\n✓ 모두 통과");
process.exit(fails ? 1 : 0);
