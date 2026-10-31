// ============================================================
//  AI STUDIO 화면 흐름 검증 — 로그인한 Chrome 으로 처음부터 끝까지
// ------------------------------------------------------------
//    node e2e/shorts-ui.mjs <BASE_URL> <토큰파일> <샘플 mp4> <샤ot 폴더>
//  토큰: NEANDER_E2E_EMAIL=… npm run e2e:token -- <파일>  (본인 계정 · 끝나면 지울 것)
//
//  유료 AI · 외부 게시는 누르지 않는다. 만든 소재 · 프로젝트 · 공식은 끝에 화면에서 지운다.
//  흐름: 소재 직접 등록 → 프로젝트로 → 사실 · 중국어 검색어 · 소스 파일 · 구간 → 장면
//        → 쿠팡 후보 · 동일 상품 확인 · 제휴 링크 → 장면 시각 → 구성 표 → 성공 공식
//        → 대본 두 줄 → 내레이션 파일 → MP4 출력(H.264/AAC) → SRT · 대본 · MP4 내려받기
//        → 브라우저 사본 지우고 서버에서 다시 받기 → 게시 탭(계정 없음 · 고지 첫 줄)
//        → 성과 직접 입력 → 성과 비교 → 계정·연결 → 390px 가로 넘침 → 지우기
// ============================================================
import { chromium } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const [BASE_URL, tokenFile, sampleMp4, shotDir] = process.argv.slice(2);
if (!BASE_URL || !tokenFile || !sampleMp4 || !shotDir) throw new Error("사용법: node e2e/shorts-ui.mjs <BASE_URL> <토큰파일> <샘플 mp4> <샷 폴더>");
mkdirSync(shotDir, { recursive: true });
const t = JSON.parse(readFileSync(tokenFile, "utf8"));
const TAG = `E2E 검증 ${new Date().toISOString().slice(5, 16).replace(/[-:T]/g, "")}`;
let fails = 0;
const ok = (c, label, detail = "") => {
  console.log(`${c ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!c) fails++;
};

// 내레이션용 사인파 WAV (3초)
function wav(seconds, hz) {
  const sr = 22050;
  const n = sr * seconds;
  const b = Buffer.alloc(44 + n * 2);
  b.write("RIFF", 0);
  b.writeUInt32LE(36 + n * 2, 4);
  b.write("WAVEfmt ", 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(sr, 24);
  b.writeUInt32LE(sr * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36);
  b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(8000 * Math.sin((2 * Math.PI * hz * i) / sr)), 44 + i * 2);
  return b;
}
const wavPath = path.join(shotDir, "narration.wav");
writeFileSync(wavPath, wav(3, 330));

const browser = await chromium.launch({ channel: "chrome", headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && !/favicon|Failed to load resource.*(404|401)/.test(m.text()) && errors.push(m.text().slice(0, 200)));

await page.goto(`${BASE_URL}/neander/login`, { waitUntil: "domcontentloaded" });
await page.evaluate(async (t) => {
  const user = {
    uid: t.uid,
    email: t.email,
    emailVerified: true,
    displayName: t.displayName,
    photoURL: t.photoURL,
    isAnonymous: false,
    providerData: [],
    stsTokenManager: { refreshToken: t.refreshToken, accessToken: t.idToken, expirationTime: t.expirationTime },
    createdAt: String(Date.now()),
    lastLoginAt: String(Date.now()),
    apiKey: t.apiKey,
    appName: "[DEFAULT]",
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

const shot = (name) => page.screenshot({ path: path.join(shotDir, `${name}.png`), fullPage: true });
const go = async (p, heading) => {
  await page.goto(`${BASE_URL}${p}`, { waitUntil: "domcontentloaded" });
  // 개발 서버는 처음 여는 화면을 그때 컴파일한다 — 그 화면의 제목이 보일 때까지
  if (heading) await page.getByRole("heading", { name: heading, exact: true }).first().waitFor({ timeout: 180_000 });
  await page.waitForFunction(() => !/불러오는 중/.test(document.body.innerText), null, { timeout: 120_000 }).catch(() => undefined);
};
const tab = async (name) => {
  await page.getByRole("tab", { name: new RegExp(`^${name}`) }).click();
  await page.waitForTimeout(400);
};
const settle = () => page.waitForFunction(() => /저장됨/.test(document.body.innerText), null, { timeout: 30_000 }).catch(() => undefined);

try {
  // ---- 대시보드 ----
  await go("/neander/shorts", "AI STUDIO");
  ok(await page.getByText("확인할 일", { exact: true }).isVisible(), "대시보드 열림 (로그인 · 권한 · 자료)");
  ok(await page.getByText("AI STUDIO 워크스페이스").first().isVisible().catch(() => false), "사이드바에 AI STUDIO 워크스페이스");
  await shot("01-dashboard");

  // ---- 소재 직접 등록 ----
  await go("/neander/shorts/trends", "소재 발굴");
  ok(await page.getByText(/YouTube 검색 키\(NEANDER_SHORTS_YOUTUBE_API_KEY\)가 서버에 없어/).isVisible(), "검색 키가 없으면 자동 검색 대신 안내");
  await page.getByRole("button", { name: "직접 등록" }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByLabel("원본 URL").fill("https://www.xiaohongshu.com/explore/e2e-sample");
  await dlg.getByLabel("상품", { exact: true }).fill(`${TAG} 접이식 선반`);
  await dlg.getByRole("textbox", { name: "조회", exact: true }).fill("120000");
  await dlg.getByRole("textbox", { name: "좋아요", exact: true }).fill("3400");
  await dlg.getByRole("textbox", { name: "댓글", exact: true }).fill("210");
  await dlg.getByRole("textbox", { name: "읽은 댓글", exact: true }).fill("100");
  await dlg.getByRole("textbox", { name: "정보 요청 댓글", exact: true }).fill("18");
  ok((await dlg.getByLabel("플랫폼").inputValue()) === "xiaohongshu", "주소로 플랫폼을 샤오홍슈로 알아봄");
  await shot("02-trend-editor");
  await dlg.getByRole("button", { name: "저장" }).click();
  const row = page.getByRole("row", { name: new RegExp(TAG) });
  await row.waitFor({ timeout: 30_000 });
  const rowText = await row.innerText();
  ok(/직접 입력/.test(rowText), "조회수 옆에 출처 「직접 입력」", rowText.replace(/\s+/g, " ").slice(0, 120));
  ok(/18%/.test(rowText), "정보 요청률 18% (표본 100개 중 18개)");
  ok(/찾아본|미확인/.test(rowText), "국내 확인 전은 「미확인」 (미확산 단정 없음)");
  await shot("03-trends");

  // ---- 프로젝트로 ----
  await row.getByRole("button", { name: "영상 만들기" }).click();
  await page.waitForURL(/\/neander\/shorts\/projects\/[\w-]+/, { timeout: 60_000 });
  const projectUrl = page.url().split("?")[0];
  await page.getByRole("tab", { name: /^소스/ }).waitFor({ timeout: 60_000 });
  ok(true, "소재 → 영상 만들기", projectUrl.split("/").pop());

  // 사실 · 중국어 검색어
  await page.getByPlaceholder(/접으면 두께/).fill("접으면 두께 3cm (쿠팡 상세 확인)");
  await page.getByRole("button", { name: "추가", exact: true }).click();
  await page.getByLabel("검색어 (간체)").fill("折叠置物架");
  await page.getByLabel("뜻", { exact: true }).fill("접이식 선반");
  await page.getByRole("button", { name: "더하기" }).click();
  ok(await page.getByRole("link", { name: /샤오홍슈/ }).first().isVisible(), "중국어 검색어 → 샤오홍슈 검색 링크");
  const xhs = await page.getByRole("link", { name: /샤오홍슈/ }).first().getAttribute("href");
  ok(xhs?.includes("xiaohongshu.com/search_result?keyword=%E6%8A%98"), "샤오홍슈 검색 주소에 간체 검색어", xhs ?? "");

  // 소스 파일 올리기 → 구간 → 장면
  await page.locator('input[type=file][accept="video/*"]').first().setInputFiles(sampleMp4);
  await page.getByRole("button", { name: "구간 추가" }).first().waitFor({ timeout: 60_000 });
  ok(true, "소스 영상 올림 (조각 업로드)");
  await page.getByRole("button", { name: "구간 추가" }).first().click();
  await page.getByRole("button", { name: "장면으로" }).first().click();
  await settle();
  await shot("04-sources");

  // ---- 쿠팡 ----
  await tab("쿠팡 확인");
  ok(await page.getByText(/쿠팡 파트너스 Open API 는 최종 승인된 회원만/).isVisible(), "파트너스 API 없음 → 직접 검색 안내");
  await page.getByRole("button", { name: "직접 추가" }).click();
  await page.getByLabel("쿠팡 상품 URL").fill("https://www.coupang.com/vp/products/1234567890");
  await page.getByLabel("상품명").fill("E2E 접이식 주방 선반");
  for (const k of ["브랜드", "모델", "크기", "외형"]) await page.getByRole("combobox", { name: k }).selectOption("same");
  const verdict = page.getByLabel("판정");
  await verdict.selectOption("identical");
  await settle();
  ok(await page.getByText("동일 상품 · 사람이 확인함").isVisible(), "동일 상품 = 「사람이 확인함」 (자동 검증으로 표시 안 함)");
  await page.getByLabel("파트너스 링크").fill("https://link.coupang.com/a/e2eTest1");
  await page.getByRole("button", { name: "확인한 상품에 연결" }).click();
  await settle();
  await page.waitForTimeout(1500);
  ok(await page.getByText(/현재: https:\/\/link\.coupang\.com\/a\/e2eTest1/).isVisible({ timeout: 10_000 }).catch(() => false), "제휴 링크 연결");
  await shot("05-coupang");

  // ---- 공식 · 대본 ----
  await tab("공식·대본");
  await page.getByLabel("장면 시각 메모").fill("0:00-0:02 후킹 컷 2\n0:02-0:05 문제 제기\n0:05-0:10 제품 등장 사용 장면\n0:10-0:12 댓글 CTA");
  await page.getByRole("button", { name: /시각 메모로 표 만들기/ }).click();
  ok(await page.getByText("URL 미열람 — 영상을 직접 보지 않았습니다").isVisible(), "분석 근거 표시: 장면 시각 · URL 미열람");
  await settle();
  await page.getByLabel("공식 이름").fill(`${TAG} 공식`);
  await page.getByRole("button", { name: "성공 공식으로 저장" }).click();
  await page.getByText("성공 공식으로 저장했습니다.").waitFor({ timeout: 30_000 });
  ok(true, "구성 분석 → 성공 공식 저장");
  await page.getByRole("button", { name: "줄 추가" }).click();
  await page.getByRole("button", { name: "줄 추가" }).click();
  const lines = page.getByRole("textbox", { name: "읽을 말", exact: true });
  await lines.nth(0).fill("좁은 주방, 이거 하나로 정리 끝");
  await lines.nth(1).fill("제품 정보는 댓글에 선반 남겨 주세요");
  const linkSel = page.getByRole("combobox", { name: "연결 장면" });
  const opt = await linkSel.nth(0).locator("option").nth(1).getAttribute("value");
  await linkSel.nth(0).selectOption(opt);
  await linkSel.nth(1).selectOption(opt);
  await settle();
  await shot("06-script");

  // ---- 편집 · 출력 ----
  await tab("편집·출력");
  await page.locator('input[type=file][accept="audio/*"]').first().setInputFiles(wavPath);
  await page.getByRole("button", { name: "내레이션 빼기" }).waitFor({ timeout: 60_000 });
  ok(true, "내레이션 파일 올림");
  await settle();
  ok(await page.getByLabel("9:16 미리보기").isVisible(), "9:16 미리보기 캔버스");
  await page.getByRole("button", { name: "재생" }).click();
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: "멈춤" }).click();
  await shot("07-editor");
  await page.getByRole("button", { name: "MP4 출력" }).click();
  await page.getByText(/출력 완료 —/).waitFor({ timeout: 180_000 });
  const toastText = await page.getByText(/출력 완료 —/).innerText();
  ok(/H\.264\/AAC/.test(toastText), "MP4 출력 완료 · H.264/AAC", toastText);
  await page.getByText("avc/aac").first().waitFor({ timeout: 30_000 });
  ok(await page.getByText("영상 안 고지 있음").first().isVisible(), "완성 파일에 영상 안 고지 기록");
  await shot("08-rendered");

  const dl = async (name) => {
    const [d] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name, exact: true }).first().click()]);
    const p = path.join(shotDir, d.suggestedFilename());
    await d.saveAs(p);
    return p;
  };
  const srt = readFileSync(await dl("자막 (.srt)"), "utf8");
  ok(/^1\n00:00:00,000 --> /.test(srt) && srt.includes("좁은 주방"), "SRT 내려받기 (시각 · 자막)", srt.split("\n").slice(0, 3).join(" | "));
  const txt = readFileSync(await dl("대본 (.txt)"), "utf8");
  ok(txt.includes("[후킹]") || txt.includes("장면:"), "대본 내려받기 (구간 · 연결 장면)");
  // 브라우저 사본을 지우고 서버에서 다시 받는다 — 서버 저장 · 복원
  await page.evaluate(() => new Promise((r) => { const q = indexedDB.deleteDatabase("neander-shorts-media"); q.onsuccess = q.onerror = q.onblocked = () => r(null); }));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "MP4", exact: true }).first().waitFor({ timeout: 120_000 });
  const mp4 = readFileSync(await dl("MP4"));
  ok(mp4.length > 10_000 && mp4.subarray(4, 8).toString() === "ftyp", "브라우저 사본 없이 서버 조각에서 MP4 복원", `${(mp4.length / 1024).toFixed(0)}KB`);
  writeFileSync(path.join(shotDir, "rendered.mp4"), mp4);

  // ---- 게시 ----
  await tab("게시");
  ok(await page.getByText("게시할 수 있는 계정이 없습니다").isVisible(), "계정 없음 → 미연결 안내");
  const caption = await page.locator("pre").first().innerText();
  ok(caption.startsWith("이 포스팅은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다."), "게시 문구 첫 줄 = 표준 고지");
  ok(await page.getByText(/해외 소스 출처·이용 조건 기록/).isVisible() && (await page.getByText("선택", { exact: true }).first().isVisible()), "출처 · 이용 조건은 「선택」 항목");
  await shot("09-publish");

  // ---- 성과 ----
  await tab("성과");
  const perf = page.locator("section", { hasText: "직접 입력" });
  await perf.getByRole("textbox", { name: "조회", exact: true }).fill("1000");
  await perf.getByRole("textbox", { name: "정보 요청", exact: true }).fill("12");
  await perf.getByRole("textbox", { name: "제휴 클릭", exact: true }).fill("30");
  await perf.getByRole("button", { name: "기록" }).click();
  await page.getByText("기록했습니다.").waitFor({ timeout: 30_000 });
  await page.waitForTimeout(800);
  ok(await page.getByText("요청률 1.2%").isVisible(), "정보 요청률 = 12 ÷ 1,000 = 1.2%");
  ok(await page.getByText("클릭률 3%").isVisible(), "클릭률 = 30 ÷ 1,000 = 3%");
  await shot("10-perf");

  // ---- 성과 비교 · 계정 ----
  await go("/neander/shorts/analytics", "성과 비교");
  ok(await page.getByText(new RegExp(TAG)).first().isVisible({ timeout: 30_000 }), "성과 비교에 영상");
  await shot("11-analytics");
  await go("/neander/shorts/accounts", "내 채널 · 연결");
  ok(await page.getByText("NEANDER_SHORTS_GOOGLE_CLIENT_ID, NEANDER_SHORTS_GOOGLE_CLIENT_SECRET").isVisible(), "빠진 환경변수 이름 표시 (값은 안 보임)");
  ok(await page.getByRole("button", { name: "YouTube 연결" }).isDisabled(), "OAuth 미설정이면 연결 버튼 꺼짐");
  await shot("12-accounts");

  // ---- 모바일 ----
  await page.setViewportSize({ width: 390, height: 844 });
  for (const p of ["/neander/shorts", "/neander/shorts/trends", "/neander/shorts/projects", `${projectUrl.replace(BASE_URL, "")}?tab=edit`, `${projectUrl.replace(BASE_URL, "")}?tab=publish`, `${projectUrl.replace(BASE_URL, "")}?tab=script`, `${projectUrl.replace(BASE_URL, "")}?tab=perf`, `${projectUrl.replace(BASE_URL, "")}?tab=coupang`, "/neander/shorts/accounts", "/neander/shorts/analytics", "/neander/shorts/templates"]) {
    await go(p);
    await page.waitForTimeout(1500);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    ok(over <= 1, `390px 가로 넘침 없음 ${p.replace(/projects\/[\w-]+/, "projects/:id")}`, `${over}px`);
  }
  await shot("13-mobile-project");
  await page.setViewportSize({ width: 1440, height: 900 });

  // ---- 지우기 ----
  await page.goto(projectUrl, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "영상 지우기" }).click({ timeout: 60_000 });
  await page.getByRole("dialog").getByRole("button", { name: "지우기" }).click();
  await page.waitForURL(/\/neander\/shorts\/projects$/, { timeout: 60_000 });
  ok(true, "영상 지우기 (파일 · 버전 · 성과 함께)");
  await go("/neander/shorts/templates", "성공 공식");
  const card = page.locator("div", { hasText: `${TAG} 공식` }).getByRole("button", { name: "지우기" }).first();
  await card.click();
  await page.getByRole("dialog").getByRole("button", { name: "지우기" }).click();
  await page.waitForTimeout(1500);
  await go("/neander/shorts/trends", "소재 발굴");
  await page.getByRole("row", { name: new RegExp(TAG) }).getByRole("button").first().click();
  await page.getByRole("dialog").getByRole("button", { name: "지우기" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "지우기" }).click().catch(async () => page.getByRole("dialog").last().getByRole("button", { name: "지우기" }).click());
  await page.waitForTimeout(1500);
  ok(!(await page.getByText(new RegExp(TAG)).first().isVisible().catch(() => false)), "검증용 소재 · 공식 지움");
} catch (e) {
  ok(false, "흐름 중단", e instanceof Error ? e.message.split("\n")[0] : String(e));
  await shot("zz-failure").catch(() => undefined);
} finally {
  const real = errors.filter((e) => !/Download the React DevTools|hydration|ResizeObserver/.test(e));
  ok(real.length === 0, "화면 오류 없음", real.slice(0, 3).join(" | "));
  await browser.close();
}
console.log(fails ? `\n실패 ${fails}건` : "\n모두 통과");
process.exit(fails ? 1 : 0);
