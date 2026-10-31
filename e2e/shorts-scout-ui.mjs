// ============================================================
//  바이럴 형식 정찰 화면 — 로그인한 Chrome 으로
// ------------------------------------------------------------
//    node e2e/shorts-scout-ui.mjs <BASE_URL> <토큰파일> <샷 폴더>
//  네 탭을 열고, 더우인 영상 하나를 직접 등록 → 배수 확인 → 형식 카드를 만들어
//  이름을 고치면(저장 버튼 없이) 저장되는지 → 영상을 카드에 묶기 → 둘 다 지운다.
//  YouTube · AI 는 부르지 않는다 (검색 한도 · 비용).
// ============================================================
import { chromium } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

const [BASE_URL, tokenFile, shotDir] = process.argv.slice(2);
if (!BASE_URL || !tokenFile || !shotDir) throw new Error("사용법: node e2e/shorts-scout-ui.mjs <BASE_URL> <토큰파일> <샷 폴더>");
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
const tab = (name) => page.getByRole("tab", { name: new RegExp(`^${name}`) }).click();
const URL_ = "https://www.douyin.com/video/7999999999999999999";
const NAME = "E2E 검증 형식";

try {
  await page.goto(`${BASE_URL}/neander/shorts/scout`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "바이럴 형식", exact: true }).first().waitFor({ timeout: 180_000 });
  await page.waitForFunction(() => !/불러오는 중/.test(document.body.innerText), null, { timeout: 120_000 }).catch(() => undefined);
  ok(await page.getByRole("link", { name: "바이럴 형식" }).first().isVisible(), "사이드바 「기획」 에 바이럴 형식 메뉴");
  await shot("1-report");

  await tab("감시 채널");
  await page.getByText("채널 찾기").first().waitFor();
  ok(await page.getByText("정찰 설정 (회사 공용)").isVisible(), "감시 채널 탭 · 정찰 설정");
  await shot("2-channels");

  // ---- 더우인 영상 직접 등록 ----
  await tab("터진 영상");
  await page.getByRole("button", { name: "영상 등록" }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByPlaceholder("https://…").fill(URL_);
  await dlg.getByRole("combobox", { name: "나라" }).selectOption("CN");
  await dlg.getByLabel("제목 · 내용 한 줄").fill("E2E 더우인 영상");
  await dlg.getByLabel("계정", { exact: true }).fill("e2e계정");
  await dlg.getByLabel("조회수 · 좋아요 (본 숫자)").fill("2000000");
  await dlg.getByLabel("그 계정 평소 조회수 (어림)").fill("100000");
  await shot("3-add-hit");
  await dlg.getByRole("button", { name: "등록", exact: true }).click();
  await page.getByRole("dialog").getByText("20배").first().waitFor({ timeout: 30_000 });
  ok(true, "직접 등록 → 상세가 열리고 배수 20배");
  ok(await page.getByRole("dialog").getByText(/YouTube 영상뿐/).isVisible(), "YouTube 밖 영상은 AI 분석 대신 안내");
  await page.getByRole("dialog").getByRole("button", { name: "닫기" }).last().click();
  await page.getByRole("button", { name: /E2E 더우인 영상/ }).waitFor();
  ok(true, "터진 영상 표에 보인다");
  await shot("4-hits");

  // ---- 형식 카드 직접 만들기 · 자동 저장 ----
  await tab("형식 카드");
  await page.getByRole("button", { name: "카드 직접 만들기" }).click();
  const fd = page.getByRole("dialog");
  await fd.getByLabel("형식 이름").fill(NAME);
  await fd.getByLabel("훅 (첫 2초)").fill("첫 프레임에 거대한 병");
  await fd.getByText("저장됨").waitFor({ timeout: 20_000 });
  ok(true, "저장 버튼 없이 고치는 대로 저장");
  await shot("5-format-dialog");
  await fd.getByRole("button", { name: "닫기" }).last().click();
  await page.getByRole("button", { name: new RegExp(NAME) }).waitFor();
  ok(true, "형식 카드 표에 새 이름으로");

  // ---- 영상을 카드에 묶기 ----
  await tab("터진 영상");
  await page.getByRole("button", { name: /E2E 더우인 영상/ }).click();
  const hd = page.getByRole("dialog");
  await hd.getByRole("combobox").filter({ has: page.locator(`option:text("${NAME}")`) }).selectOption({ label: NAME });
  await hd.getByRole("button", { name: "묶기", exact: true }).click();
  await hd.getByText("묶인 형식:").waitFor({ timeout: 20_000 });
  ok(true, "영상을 형식 카드에 묶음");
  await hd.getByRole("button", { name: "닫기" }).last().click();

  await tab("형식 카드");
  const row = page.getByRole("row", { name: new RegExp(NAME) });
  ok(await row.getByText("중국").isVisible(), "카드에 나라(중국)가 모인다");
  await shot("6-formats");

  // ---- 주간 보고 다시 만들기 ----
  await tab("주간 보고");
  const build = page.getByRole("button", { name: /지금 (새로 )?만들기/ });
  await build.first().click();
  await page.getByText(/감시 채널 .*곳/).first().waitFor({ timeout: 30_000 });
  ok(await page.getByText(NAME).first().isVisible(), "보고에 새 형식이 보인다 (해외에만 · 씨앗)");
  await shot("7-report-built");
} catch (e) {
  ok(false, "흐름", e instanceof Error ? e.message.split("\n")[0] : String(e));
  await shot("error").catch(() => undefined);
} finally {
  // ---- 지우기 (만든 카드 · 영상) ----
  try {
    for (let i = 0; i < 3 && (await page.getByRole("dialog").count()); i++) {
      await page.keyboard.press("Escape");
      await page.waitForTimeout(500);
    }
    await tab("형식 카드");
    const r = page.getByRole("button", { name: new RegExp(NAME) });
    if (await r.count()) {
      await r.first().click();
      await page.getByRole("dialog").getByRole("button", { name: "지우기" }).click();
      await page.getByRole("alertdialog").getByRole("button", { name: "지우기" }).click().catch(async () => page.getByRole("button", { name: "지우기" }).last().click());
      await page.waitForTimeout(1500);
    }
    await tab("터진 영상");
    await page.getByRole("tab", { name: /^전체/ }).click();
    const h = page.getByRole("button", { name: /E2E 더우인 영상/ });
    if (await h.count()) {
      await h.first().click();
      await page.getByRole("dialog").getByRole("button", { name: "지우기" }).click();
      await page.getByRole("alertdialog").getByRole("button", { name: "지우기" }).click().catch(async () => page.getByRole("button", { name: "지우기" }).last().click());
      await page.waitForTimeout(1500);
    }
    ok((await page.getByRole("button", { name: /E2E 더우인 영상/ }).count()) === 0, "검증용 영상 지움");
  } catch (e) {
    ok(false, "정리", e instanceof Error ? e.message.split("\n")[0] : String(e));
  }
  ok(errors.length === 0, "페이지 오류 없음", errors.slice(0, 3).join(" | "));
  await browser.close();
  console.log(fails ? `\n✗ ${fails}건 실패` : "\n✓ 모두 통과");
  process.exit(fails ? 1 : 0);
}
