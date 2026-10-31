// ============================================================
//  AI STUDIO 사람별 관리 · 관리자 몰아보기 — 로그인한 Chrome 으로
// ------------------------------------------------------------
//    node e2e/shorts-people-ui.mjs <BASE_URL> <토큰파일> <샷 폴더> <다른 사람 영상 제목>
//  (다른 사람의 비공개 프로젝트는 미리 만들어 둔다 — 관리자 읽기 전용을 보려고)
//  로그인한 사람이 쇼츠 관리자(NEANDER_SHORTS_ADMIN_EMAILS)여야 몰아보기 단계가 통과한다.
//  쿠팡 키는 가짜 값을 넣었다가 지운다. 「키 확인」 은 누르지 않는다 (실제 쿠팡 호출).
// ============================================================
import { chromium } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

const [BASE_URL, tokenFile, shotDir, otherTitle] = process.argv.slice(2);
if (!BASE_URL || !tokenFile || !shotDir || !otherTitle) throw new Error("사용법: node e2e/shorts-people-ui.mjs <BASE_URL> <토큰파일> <샷 폴더> <다른 사람 영상 제목>");
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
const shot = (n) => page.screenshot({ path: path.join(shotDir, `${n}.png`), fullPage: true });
const go = async (p, heading) => {
  await page.goto(`${BASE_URL}${p}`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: heading, exact: true }).first().waitFor({ timeout: 180_000 });
  await page.waitForFunction(() => !/불러오는 중/.test(document.body.innerText), null, { timeout: 120_000 }).catch(() => undefined);
};
const viewer = () => page.getByRole("combobox", { name: "누구의 것을 볼지" });

try {
  // ---- 내 채널 세트 ----
  await page.evaluate(() => localStorage.setItem("neander.shorts.viewer", "mine"));
  await go("/neander/shorts/accounts", "내 채널 · 연결");
  ok(await page.getByText(/내 채널 세트 — 이동주/).isVisible(), "내 채널 세트 (이름으로)");
  await page.getByLabel("파트너스 아이디 (AF…)").fill("AF9999999");
  await page.getByLabel("Access Key").fill("e2eAccessKey1234");
  await page.getByLabel("Secret Key").fill("e2eSecretKey5678");
  await page.getByRole("button", { name: "저장", exact: true }).first().click();
  await page.getByText("Access Key …1234").waitFor({ timeout: 30_000 });
  ok(await page.getByText("넣음 · 확인 전").first().isVisible(), "쿠팡 키 저장 → 끝 4자리 · 「확인 전」 (키 값은 화면에 안 돌아옴)");
  ok(!(await page.content()).includes("e2eSecretKey5678"), "시크릿 키가 화면 어디에도 없음");
  await page.getByLabel("채널 아이디", { exact: true }).fill("e2eShorts01");
  await page.getByLabel("이름", { exact: true }).fill("E2E 쇼츠");
  await page.getByRole("button", { name: "더하기" }).click();
  await page.getByRole("button", { name: "목록 저장" }).click();
  await page.getByText("채널 아이디를 저장했습니다.").waitFor({ timeout: 30_000 });
  ok(true, "채널 아이디 등록");
  ok(await page.getByRole("cell", { name: /회사 공용 쿠팡 키/ }).isVisible(), "서버 키는 「회사 공용 쿠팡 키(검색만)」 로 표시");
  await shot("p1-channel-set");

  // ---- 사용자별 현황 (관리자) ----
  await go("/neander/shorts/team", "사용자별 현황");
  const admin = await page.getByText(/관리자 몰아보기/).isVisible();
  ok(admin, "관리자로 들어오면 몰아보기 안내");
  await page.waitForTimeout(2500);
  const rowsText = await page.locator("tbody").innerText();
  ok(/이동주[\s\S]*\(나\)/.test(rowsText), "내 줄이 맨 위 (이름 · (나))");
  ok(/확인 전/.test(rowsText) && /AF9999999/.test(rowsText), "내 쿠팡 키 상태 · AF 코드가 현황에 보임");
  for (const name of ["김주연", "유재영"]) ok(rowsText.includes(name), `ERP 팀원 「${name}」 줄`);
  ok(rowsText.includes("shorts-e2e-other@test.invalid"), "다른 사람(검증용)의 줄");
  await shot("p2-team");

  // 그 사람 이름을 누르면 「보기」 가 그 사람으로
  await page.getByRole("button", { name: /shorts-e2e-other/ }).click();
  await page.waitForURL(/\/neander\/shorts\/projects$/, { timeout: 60_000 });
  await page.getByText(otherTitle).first().waitFor({ timeout: 60_000 });
  ok((await viewer().inputValue()) === "shorts-e2e-other@test.invalid", "이름을 누르면 「보기」 가 그 사람으로 바뀜");
  ok(await page.getByText(/읽기 전용/).first().isVisible(), "남의 비공개 영상에 「읽기 전용」 표시");
  await page.getByRole("link", { name: otherTitle }).click();
  await page.getByText(/관리자 몰아보기 — .* 비공개 영상을/).waitFor({ timeout: 60_000 });
  ok((await page.locator("fieldset[disabled]").count()) === 1, "탭 내용이 통째로 잠김 (fieldset disabled)");
  ok(await page.getByRole("button", { name: "추가", exact: true }).isDisabled(), "버튼이 눌리지 않음");
  ok(!(await page.getByRole("button", { name: "영상 지우기" }).isVisible().catch(() => false)), "지우기 버튼 없음");
  await shot("p3-readonly");

  // 「내 것」 으로 돌아오면 남의 것이 안 보인다
  await go("/neander/shorts/projects", "영상");
  await viewer().selectOption("mine");
  await page.waitForTimeout(1500);
  ok(!(await page.getByText(otherTitle).isVisible().catch(() => false)), "「내 것」 보기에서는 남의 영상이 안 보임");

  // ---- 모바일 ----
  await page.setViewportSize({ width: 390, height: 844 });
  for (const [p, h] of [["/neander/shorts/team", "사용자별 현황"], ["/neander/shorts/accounts", "내 채널 · 연결"]]) {
    await go(p, h);
    await page.waitForTimeout(1200);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    ok(over <= 1, `390px 가로 넘침 없음 ${p}`, `${over}px`);
  }
  await page.setViewportSize({ width: 1440, height: 900 });

  // ---- 지우기 ----
  await go("/neander/shorts/accounts", "내 채널 · 연결");
  await page.getByRole("button", { name: "키 지우기" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "지우기" }).click();
  await page.getByText("키 없음").first().waitFor({ timeout: 30_000 });
  await page.getByRole("button", { name: "e2eShorts01 지우기" }).click();
  await page.getByRole("button", { name: "목록 저장" }).click();
  await page.getByText("채널 아이디를 저장했습니다.").last().waitFor({ timeout: 30_000 });
  ok(true, "쿠팡 키 · 채널 아이디 지움");
} catch (e) {
  ok(false, "흐름 중단", e instanceof Error ? e.message.split("\n")[0] : String(e));
  await shot("pz-failure").catch(() => undefined);
} finally {
  ok(errors.length === 0, "화면 오류 없음", errors.slice(0, 3).join(" | "));
  await browser.close();
}
console.log(fails ? `\n실패 ${fails}건` : "\n모두 통과");
process.exit(fails ? 1 : 0);
