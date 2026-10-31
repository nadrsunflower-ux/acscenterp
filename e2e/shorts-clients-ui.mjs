// ============================================================
//  AI STUDIO 고객사(브랜드 대행) 흐름 — 로그인한 Chrome 으로 처음부터 끝까지
// ------------------------------------------------------------
//    node e2e/shorts-clients-ui.mjs <BASE_URL> <토큰파일> <샘플 mp4> <샷 폴더>
//  고객사 만들기 → 브리프 · 금지 표현 → 제품 · 실사진 → 영상 추가 → 소스 · 출력 →
//  검토 링크 → (로그인 없는 창) 수정 요청 → 다시 보내기 → 승인 → 게시 점검 → 월간 보고
//  → 영상 · 고객사 지우기. 게시는 누르지 않는다 (실제 SNS). 검토 링크는 끝에 지워진다.
// ============================================================
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { readFileSync } from "node:fs";
import path from "node:path";

const [BASE_URL, tokenFile, sampleMp4, shotDir] = process.argv.slice(2);
if (!BASE_URL || !tokenFile || !sampleMp4 || !shotDir) throw new Error("사용법: node e2e/shorts-clients-ui.mjs <BASE_URL> <토큰파일> <샘플 mp4> <샷 폴더>");
mkdirSync(shotDir, { recursive: true });
const t = JSON.parse(readFileSync(tokenFile, "utf8"));
const TAG = `E2E 고객사 ${Date.now().toString().slice(-6)}`;
let fails = 0;
const ok = (c, label, detail = "") => {
  console.log(`${c ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!c) fails++;
};

// 1×1 PNG (제품 사진 자리)
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const pngPath = path.join(shotDir, "product.png");
writeFileSync(pngPath, png);

const browser = await chromium.launch({ channel: "chrome", headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
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
await page.evaluate(() => localStorage.setItem("neander.shorts.viewer", "mine"));
const shot = (n, p = page) => p.screenshot({ path: path.join(shotDir, `${n}.png`), fullPage: true });
const go = async (p, heading) => {
  await page.goto(`${BASE_URL}${p}`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: heading, exact: true }).first().waitFor({ timeout: 180_000 });
  await page.waitForFunction(() => !/불러오는 중/.test(document.body.innerText), null, { timeout: 120_000 }).catch(() => undefined);
};
const tab = async (name) => {
  await page.getByRole("tab", { name: new RegExp(`^${name}`) }).click();
  await page.waitForTimeout(400);
};
const clientSaved = () => page.waitForFunction(() => /· 저장됨/.test(document.body.innerText), null, { timeout: 30_000 });
const projectSaved = () => page.waitForFunction(() => /저장됨/.test(document.body.innerText), null, { timeout: 30_000 }).catch(() => undefined);
/** 라벨 글자 옆의 입력칸 (목록 편집기는 라벨이 칸에 묶이지 않는다) */
const inputNear = (label) => page.getByText(label, { exact: true }).first().locator("xpath=ancestor::*[.//input][1]").locator("input").first();

let clientUrl = "";
let projectUrl = "";
const review = await browser.newContext({ viewport: { width: 420, height: 900 } }); // 고객사 — 로그인 없음
const openReview = async (url, n) => {
  const rp = await review.newPage();
  await rp.goto(url, { waitUntil: "domcontentloaded" });
  await rp.getByRole("heading", { name: new RegExp(TAG) }).waitFor({ timeout: 120_000 });
  await rp.locator("video").waitFor({ timeout: 120_000 });
  ok(!rp.url().includes("/neander/login"), `${n}: 로그인 없이 검토 화면이 열림 (로그인 화면으로 안 보냄)`);
  return rp;
};

try {
  // ---- 고객사 만들기 ----
  await go("/neander/shorts/clients", "고객사");
  ok(await page.getByText("AI STUDIO 워크스페이스").first().isVisible().catch(() => false), "AI STUDIO 워크스페이스 · 고객사 메뉴");
  await page.getByRole("button", { name: "새 고객사" }).first().click();
  const dlg = page.getByRole("dialog");
  await dlg.getByLabel("고객사(브랜드) 이름").fill(TAG);
  await dlg.getByRole("button", { name: "만들기" }).click();
  await page.waitForURL(/\/neander\/shorts\/clients\/[\w-]+$/, { timeout: 60_000 });
  clientUrl = page.url();
  await page.getByRole("tab", { name: /^월별 영상/ }).waitFor({ timeout: 60_000 });
  ok(true, "새 고객사 → 고객사 화면", clientUrl.split("/").pop());

  // ---- 계약 · 브리프 ----
  await tab("계약 · 브리프");
  ok(await page.getByText("조회수는 약속하지 않습니다 — 계약은 제작 편수 · 수정 횟수까지").isVisible(), "계약에 조회수 약속 칸 없음 (안내)");
  await page.getByLabel("브랜드 · 캠페인 요약").fill("E2E 검증용 크림 브랜드 — 담백하게");
  await inputNear("금지 표현").fill("최저가");
  await inputNear("금지 표현").press("Enter");
  ok(await page.getByRole("button", { name: "최저가 지우기" }).isVisible(), "금지 표현 「최저가」 등록");
  await clientSaved();
  await shot("c1-brief");

  // ---- 제품 · 사진 ----
  await tab("제품 · 사진");
  await page.getByRole("button", { name: "제품 추가" }).click();
  await page.getByLabel("제품 이름").fill("E2E 크림");
  await inputNear("확인된 사실").fill("용량 50ml");
  await inputNear("확인된 사실").press("Enter");
  await page.locator('input[type=file][accept="image/*"]').first().setInputFiles(pngPath);
  await page.getByRole("button", { name: "사진 지우기" }).first().waitFor({ timeout: 60_000 });
  ok(true, "제품 실사진 올림 (고객사 자료)");
  await clientSaved();
  await shot("c2-products");

  // ---- 영상 추가 ----
  await tab("월별 영상");
  await page.getByRole("button", { name: "영상 추가" }).first().click();
  const add = page.getByRole("dialog");
  const prodOpt = await add.getByLabel("제품").locator("option", { hasText: "E2E 크림" }).getAttribute("value");
  await add.getByLabel("제품").selectOption(prodOpt);
  ok(/사실 1개 · 사진 1장/.test(await add.getByLabel("제품").locator("option:checked").innerText()), "영상 추가: 제품의 사실 · 사진 수가 보임");
  await add.getByLabel("올릴 곳").selectOption("own");
  await add.getByRole("button", { name: "만들기" }).click();
  await page.waitForURL(/\/neander\/shorts\/projects\/[\w-]+/, { timeout: 60_000 });
  projectUrl = page.url().split("?")[0];
  await page.getByRole("tab", { name: /^고객 승인/ }).waitFor({ timeout: 60_000 });
  ok(await page.getByText("최저가").first().isVisible(), "영상의 「고객사」 탭에 브리프 · 금지 표현");
  await shot("c3-video-client-tab");

  // 소스 → 장면 → 출력
  await tab("소스");
  ok(!(await page.getByText("중국어 검색어").isVisible().catch(() => false)), "고객사 영상에는 중국어 검색어 칸이 없음");
  await page.getByRole("button", { name: "소스 추가" }).first().click();
  await page.locator('input[type=file][accept="video/*"]').first().setInputFiles(sampleMp4);
  await page.getByRole("button", { name: "구간 추가" }).first().waitFor({ timeout: 60_000 });
  await page.getByRole("button", { name: "구간 추가" }).first().click();
  await page.getByRole("button", { name: "장면으로" }).first().click();
  await projectSaved();
  await tab("편집·출력");
  await page.getByRole("button", { name: "MP4 출력" }).click();
  await page.getByText(/출력 완료 —/).waitFor({ timeout: 180_000 });
  await page.getByText("avc/aac").first().waitFor({ timeout: 30_000 });
  ok(true, "고객사 영상 MP4 출력");
  await shot("c4-rendered");

  // ---- 검토 보내기 (1차) ----
  await tab("고객 승인");
  const sel = page.getByLabel("보낼 완성 파일");
  ok(/고지 띠 「광고 · E2E 고객사 \d+ 유료 광고」/.test(await sel.locator("option:checked").innerText()), "우리 채널용 → 완성 파일에 「광고 · 고객사 유료 광고」 띠");
  await page.getByRole("button", { name: "검토 보내기" }).click();
  const link1 = await page.locator("code").filter({ hasText: "/neander/review/" }).first().innerText({ timeout: 30_000 });
  ok(/\/neander\/review\/[\w-]{30,}$/.test(link1), "검토 링크 1차 (한 번만 보임)");
  await shot("c5-review-sent");

  const rp1 = await openReview(link1, "1차");
  await rp1.getByLabel("검토하신 분 이름").fill("김검토");
  await rp1.getByLabel("수정할 점 (수정 요청 때 필수)").fill("로고를 더 크게");
  await shot("c6-public-review", rp1);
  await rp1.getByRole("button", { name: "수정 요청" }).click();
  await rp1.getByText("수정 요청을 받았습니다.").waitFor({ timeout: 30_000 });
  ok(true, "고객이 링크에서 수정 요청");
  ok(!(await rp1.getByRole("button", { name: "승인" }).isVisible().catch(() => false)), "답한 회차에는 다시 답할 수 없음");
  await rp1.close();

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("tab", { name: /^고객 승인/ }).click({ timeout: 120_000 });
  await page.getByText("로고를 더 크게").first().waitFor({ timeout: 30_000 });
  ok(await page.getByText(/수정 1 \/ 2회 사용/).isVisible(), "ERP 에 수정 요청 · 사용 횟수 (1/2)");

  // ---- 2차 보내기 → 승인 ----
  await page.getByRole("button", { name: "검토 보내기" }).click();
  const link2 = await page.locator("code").filter({ hasText: "/neander/review/" }).first().innerText({ timeout: 30_000 });
  ok(link2 !== link1, "2차는 새 링크");
  const old = await review.newPage();
  await old.goto(link1, { waitUntil: "domcontentloaded" });
  await old.getByText(/이 링크보다 새 검토 영상이 있습니다|수정 요청을 받았습니다/).first().waitFor({ timeout: 60_000 });
  ok(true, "지난 링크로는 새로 답할 수 없음");
  await old.close();
  const rp2 = await openReview(link2, "2차");
  ok(await rp2.getByText(/1차 · 수정 요청 — 「로고를 더 크게」/).isVisible(), "2차 화면에 앞선 검토 기록");
  await rp2.getByLabel("검토하신 분 이름").fill("김검토");
  await rp2.getByRole("button", { name: "승인" }).click();
  await rp2.getByText("승인해 주셔서 감사합니다.").first().waitFor({ timeout: 30_000 });
  ok(true, "고객이 링크에서 승인");
  await rp2.close();

  // ---- 게시 점검 ----
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("tab", { name: /^게시/ }).click({ timeout: 120_000 });
  await page.waitForTimeout(1500);
  const caption = await page.locator("pre").first().innerText();
  ok(caption.startsWith(`광고 · ${TAG} 유료 광고`), "게시 문구 첫 줄 = 「광고 · 고객사 유료 광고」", caption.split("\n")[0]);
  ok(!caption.includes("쿠팡 파트너스"), "브랜드 영상에는 쿠팡 파트너스 문구 없음");
  ok(await page.getByText("고객사가 이 완성 파일을 승인함").first().isVisible(), "점검 항목에 「고객사가 이 완성 파일을 승인함」");
  ok(!(await page.getByText(/쿠팡 동일 상품/).first().isVisible().catch(() => false)), "쿠팡 점검 항목 없음");
  await shot("c7-publish");

  // ---- 영상 목록 · 고객사 · 월간 보고 ----
  await go("/neander/shorts/projects", "영상");
  const row = page.getByRole("row", { name: new RegExp(TAG) }).first();
  ok(/승인/.test(await row.innerText()), "영상 목록에 고객사 이름 · 승인 상태");
  await page.goto(clientUrl, { waitUntil: "domcontentloaded" });
  await page.getByRole("tab", { name: /^월별 영상/ }).waitFor({ timeout: 120_000 });
  await page.waitForTimeout(1200);
  ok(/고객 승인\s*1\s*편/.test(await page.locator("main").innerText()), "고객사 월별: 고객 승인 1편");
  await shot("c8-client-month");
  await page.getByRole("link", { name: /\d+월 보고/ }).first().click();
  const rpage = page;
  await rpage.getByRole("heading", { name: new RegExp(`${TAG} · \\d{4}년`) }).waitFor({ timeout: 120_000 });
  const repText = await rpage.locator("article").innerText();
  ok(/고객 승인\s*1편/.test(repText) && /수정 요청\s*1회/.test(repText), "월간 보고: 승인 1편 · 수정 1회");
  ok(/조회수 등 성과는 계약상 약속 사항이 아닙니다/.test(repText), "월간 보고: 조회수는 약속이 아니라고 적음");
  await shot("c9-report", rpage);

  // ---- 정리: 영상 → 고객사 ----
  await page.goto(projectUrl, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "영상 지우기" }).click({ timeout: 120_000 });
  await page.getByRole("dialog").getByRole("button", { name: /지우기/ }).click();
  await page.waitForURL(/\/neander\/shorts\/projects$/, { timeout: 60_000 });
  ok(true, "영상 지우기");
  const gone = await review.newPage();
  await gone.goto(link2, { waitUntil: "domcontentloaded" });
  // Next.js 의 경로 안내(next-route-announcer)도 role=alert 라서 본문 안의 것만 본다
  const alert = gone.locator("main [role=alert]");
  await alert.waitFor({ timeout: 60_000 });
  ok(/찾지 못했습니다/.test(await alert.innerText()), "지운 영상의 검토 링크는 열리지 않음", await alert.innerText());
  await gone.close();
  await page.goto(clientUrl, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "고객사 지우기" }).click({ timeout: 120_000 });
  await page.getByRole("dialog").getByRole("button", { name: /지우기/ }).click();
  await page.waitForURL(/\/neander\/shorts\/clients$/, { timeout: 60_000 });
  ok(!(await page.getByText(TAG).isVisible().catch(() => false)), "고객사 지우기 (제품 사진 함께)");
  clientUrl = "";
  projectUrl = "";
} catch (e) {
  ok(false, "진행 중 오류", e instanceof Error ? e.message.split("\n")[0] : String(e));
  await shot("zz-error").catch(() => undefined);
} finally {
  ok(errors.length === 0, "화면 스크립트 오류 없음", errors.slice(0, 3).join(" | "));
  if (clientUrl || projectUrl) console.log(`남은 자료 — 영상 ${projectUrl || "-"} · 고객사 ${clientUrl || "-"} (정리 스크립트로 지울 것)`);
  await browser.close();
  console.log(fails ? `\n실패 ${fails}건` : "\n모두 통과");
  process.exit(fails ? 1 : 0);
}
