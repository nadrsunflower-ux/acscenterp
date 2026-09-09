// 사람이 Google 로그인을 한 번 해 두는 창. `node e2e/login.mjs`
// 로그인이 끝나 /neander 로 들어오면 자동으로 닫힌다.
import { chromium } from "@playwright/test";
import { PROFILE_DIR, BASE_URL } from "./profile.mjs";

const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
  headless: false,
  viewport: { width: 1280, height: 800 },
  args: ["--disable-blink-features=AutomationControlled"],
});
const page = ctx.pages()[0] ?? (await ctx.newPage());
await page.goto(`${BASE_URL}/neander/login`);
console.log("브라우저 창에서 Google 로그인을 해 주세요. 로그인되면 창이 자동으로 닫힙니다.");
await page.waitForURL((u) => u.pathname === "/neander" || u.pathname.startsWith("/neander/") && !u.pathname.startsWith("/neander/login"), { timeout: 10 * 60 * 1000 });
await page.waitForTimeout(1500);
console.log("로그인 확인:", page.url());
await ctx.close();
