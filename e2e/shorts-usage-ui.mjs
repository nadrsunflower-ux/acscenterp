// ============================================================
//  AI STUDIO 「AI 사용료」 — 로그인한 일회용 Chrome 으로 화면 확인
// ------------------------------------------------------------
//    node e2e/shorts-usage-ui.mjs <BASE_URL> <토큰파일> <샷 폴더> [용도 시험할 키 이름]
//  (토큰파일 = npm run e2e:token · 로그인한 사람이 AI STUDIO 관리자여야 한다)
//  열 때마다 서버가 오픈라우터를 다시 읽어 그날 기록을 덮어쓴다 — 다른 것은 바꾸지 않는다.
//  키 이름을 주면 그 키의 「용도」 에 글을 넣었다가 원래대로 되돌린다 (저장 확인).
// ============================================================
import { chromium } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

const [BASE_URL, tokenFile, shotDir, trialKey] = process.argv.slice(2);
if (!BASE_URL || !tokenFile || !shotDir) throw new Error("사용법: node e2e/shorts-usage-ui.mjs <BASE_URL> <토큰파일> <샷 폴더> [키 이름]");
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

await page.goto(`${BASE_URL}/neander/shorts/usage`, { waitUntil: "domcontentloaded" });
await page.getByRole("heading", { name: "AI 사용료", exact: true }).first().waitFor({ timeout: 180_000 });
await page.getByText("충전 잔액", { exact: true }).first().waitFor({ timeout: 60_000 });
ok(true, "화면 열림 · 충전 잔액 카드");
ok(await page.getByRole("link", { name: "AI 사용료" }).count(), "사이드바 「AI 사용료」 메뉴");
const owners = page.getByRole("table", { name: "사람별 AI 사용료" });
ok((await owners.locator("tbody tr").count()) > 0, "사람별 표", `${await owners.locator("tbody tr").count()}줄`);
const keys = page.getByRole("table", { name: "키별 AI 사용료" });
const monthRows = await keys.locator("tbody tr").count();
await page.screenshot({ path: path.join(shotDir, "usage-desktop.png"), fullPage: true });

await page.getByRole("radio", { name: /모든 키/ }).or(page.getByRole("button", { name: /모든 키/ })).first().click();
const allRows = await keys.locator("tbody tr").count();
ok(allRows >= monthRows, "「모든 키」 로 넓히기", `${monthRows} → ${allRows}줄`);

if (trialKey) {
  const input = page.getByRole("textbox", { name: `${trialKey} 용도` });
  const before = await input.inputValue();
  const wait = () => page.waitForResponse((r) => r.url().includes("/api/neander/shorts/usage") && r.request().method() === "GET", { timeout: 60_000 });
  await input.fill("화면 확인");
  let reload = wait();
  await input.press("Enter");
  await reload;
  await page.getByRole("textbox", { name: `${trialKey} 용도` }).waitFor();
  ok((await page.getByRole("textbox", { name: `${trialKey} 용도` }).inputValue()) === "화면 확인", "용도 저장 → 다시 읽어도 남음");
  const again = page.getByRole("textbox", { name: `${trialKey} 용도` });
  await again.fill(before);
  reload = wait();
  await again.press("Enter");
  await reload;
  ok((await page.getByRole("textbox", { name: `${trialKey} 용도` }).inputValue()) === before, "용도 되돌림");
}

await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(500);
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
ok(overflow <= 1, "모바일 가로 밀림 없음", `${overflow}px`);
await page.screenshot({ path: path.join(shotDir, "usage-mobile.png"), fullPage: true });

ok(errors.length === 0, "페이지 오류 없음", errors.join(" | ").slice(0, 300));
await browser.close();
console.log(fails ? `\n✗ ${fails}개 실패` : "\n✓ 모두 통과");
process.exit(fails ? 1 : 0);
