// ============================================================
//  발표 장표 누르기 검사 — 매물 링크 · 장 넘김 · 인쇄본 · 가정을 바꾸면 차트가 바뀌나
// ------------------------------------------------------------
//    node e2e/deck-links.mjs <slug> [--token 토큰파일]
//
//  1) 한 장 지도(매물 장): 핀 16개가 fin.land.naver.com/articles/{번호} 로 새 탭
//     (target=_blank · rel=noopener noreferrer). 누르면 새 탭이 열리고 장은 그대로.
//     키보드 Enter 로 열어도 장이 넘어가지 않는다. 지역 카드는 상세 부록 장으로 간다.
//  2) 지역 상세: 카드 전체 = 첫 번호, 층 칩 = 그 층 번호, 광고 종료 배지.
//  3) 매물 표: 행 링크와 층 칩.
//  4) 인쇄본: 링크 대신 매물번호 글자.
//  5) 가정 하나를 바꾸면 그 장의 차트·숫자가 바뀐다 (공유 링크 ?a= 로 넣는다).
//  네이버 쪽으로는 요청을 보내지 않는다 — 새 탭 주소만 확인하고 가짜 응답을 준다.
// ============================================================
import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";
import { BASE_URL, PROFILE_DIR } from "./profile.mjs";

const args = process.argv.slice(2);
const slug = args.find((a) => !a.startsWith("--")) ?? "2026-09-29-exec";
const tokenFile = args.includes("--token") ? args[args.indexOf("--token") + 1] : undefined;
const route = `/neander/meetings/prep/${slug}`;
const NAVER = "https://fin.land.naver.com/articles/";

async function openContext() {
  if (tokenFile) {
    const t = JSON.parse(readFileSync(tokenFile, "utf8"));
    const browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(`${BASE_URL}/neander/login`, { waitUntil: "domcontentloaded" });
    await page.evaluate(async (t) => {
      const user = {
        uid: t.uid, email: t.email, emailVerified: true, displayName: t.displayName, photoURL: t.photoURL, isAnonymous: false,
        providerData: [], stsTokenManager: { refreshToken: t.refreshToken, accessToken: t.idToken, expirationTime: t.expirationTime },
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
    await page.close();
    return { ctx, close: () => browser.close() };
  }
  const ctx = await chromium.launchPersistentContext(PROFILE_DIR, { headless: true, viewport: { width: 1600, height: 900 } });
  return { ctx, close: () => ctx.close() };
}

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "통과" : "실패"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

const { ctx, close } = await openContext();
// 네이버로는 실제 요청을 보내지 않는다
await ctx.route("https://fin.land.naver.com/**", (r) => r.fulfill({ status: 200, contentType: "text/html", body: "<title>stub</title>" }));
const page = await ctx.newPage();
const open = async (hash, query = "") => {
  await page.goto(`${BASE_URL}${route}${query}#${hash}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".dk-stage .sd-slide", { timeout: 90000 });
  await page.waitForTimeout(1200);
};
// 장 번호(머리의 5-1 · A5-1 …) → 몇 번째 장인가. 한 번 훑어 만든다
let INDEX = null;
const buildIndex = async () => {
  await open("slide-1");
  const n = await page.evaluate(() => document.querySelectorAll(".dk-dot").length);
  const map = {};
  for (let k = 1; k <= n; k++) {
    await page.evaluate((k) => (window.location.hash = `slide-${k}`), k);
    await page.waitForTimeout(120);
    const no = await page.evaluate(() => document.querySelector(".dk-slide .sd-head .sd-no")?.textContent?.trim() ?? "");
    map[no.replace(/^0+(?=\d)/, "")] = k;
  }
  INDEX = map;
};
const seek = async (no, query = "") => {
  if (!INDEX) await buildIndex();
  const k = INDEX[no];
  if (!k) throw new Error(`장 ${no} 없음`);
  await open(`slide-${k}`, query);
};
const counter = () => page.evaluate(() => document.querySelector(".dk-counter")?.textContent?.trim() ?? "");
const popupUrl = async (click) => {
  const [popup] = await Promise.all([ctx.waitForEvent("page", { timeout: 8000 }), click()]);
  const url = popup.url();
  await popup.close();
  return url;
};

// 장 번호 — 장표를 다시 배열하면 여기만 고친다 (4차: 매장 7-1 · 지역 상세 A10-1~4 · 매물 표 A11-1)
const MAP_NO = "7-1";
const REGION_NO = (k) => `A10-${k}`;
const TABLE_NO = "A11-1";

try {
  // ---- 1) 한 장 지도 ----
  await seek(MAP_NO);
  const pins = await page.$$eval(".dk-slide a.sd-pin", (as) =>
    as.map((a) => ({ href: a.getAttribute("href"), target: a.getAttribute("target"), rel: a.getAttribute("rel") ?? "" })),
  );
  check("지도 핀 16개가 네이버 광고 링크", pins.length === 16 && pins.every((p) => p.href?.startsWith(NAVER)), `${pins.length}개`);
  check("핀 링크는 새 탭 + noopener noreferrer", pins.every((p) => p.target === "_blank" && /noopener/.test(p.rel) && /noreferrer/.test(p.rel)));
  const before = await counter();
  const url1 = await popupUrl(() => page.click(".dk-slide a.sd-pin >> nth=0"));
  check("핀을 누르면 새 탭에 광고가 열린다", url1.startsWith(NAVER), url1);
  check("핀을 눌러도 장이 넘어가지 않는다", (await counter()) === before, `${before} → ${await counter()}`);
  await page.focus(".dk-slide a.sd-pin >> nth=1");
  const url2 = await popupUrl(() => page.keyboard.press("Enter"));
  check("키보드 Enter 로 핀을 열어도 장은 그대로", url2.startsWith(NAVER) && (await counter()) === before, url2);
  await seek(REGION_NO(3));

  // ---- 2) 지역 상세 (방금 누른 지역) ----
  const cards = await page.$$eval(".dk-slide .sd-pcard", (els) =>
    els.map((el) => ({
      cover: el.querySelector("a.sd-pcard-cover")?.getAttribute("href") ?? null,
      chips: [...el.querySelectorAll("a.sd-link-chip")].map((a) => ({ href: a.getAttribute("href"), text: a.textContent })),
    })),
  );
  check("지역 상세 카드가 모두 링크", cards.length > 0 && cards.every((c) => c.cover?.startsWith(NAVER)), `${cards.length}장`);
  const two = cards.findIndex((c) => c.chips.length >= 2);
  const here = await counter();
  if (two >= 0) {
    const urlCard = await popupUrl(() => page.click(`.dk-slide .sd-pcard >> nth=${two}`, { position: { x: 60, y: 60 } }));
    check("두 번호 매물의 카드는 첫 번호(1층)를 연다", urlCard === cards[two].chips[0].href, urlCard);
    const second = cards[two].chips[1];
    const urlChip = await popupUrl(() => page.click(`.dk-slide .sd-pcard a.sd-link-chip[href="${second.href}"]`));
    check("층 칩은 그 층 광고를 연다", urlChip === second.href, `${second.text} ${urlChip}`);
  } else {
    check("두 번호 매물이 있는 지역", false);
  }
  check("카드·칩을 눌러도 장은 그대로", (await counter()) === here);
  // 지역 상세 네 장을 돌며 광고 종료 배지를 센다
  const badges = [];
  for (let k = 1; k <= 4; k++) {
    await seek(REGION_NO(k));
    badges.push(...(await page.$$eval(".dk-slide .sd-pcard-ended", (xs) => xs.map((x) => x.textContent))));
  }
  check("광고가 끝난 매물에 「광고 종료」 배지", badges.length >= 1 && badges.every((b) => b === "광고 종료"), `${badges.length}개`);

  // ---- 3) 매물 표 ----
  await seek(TABLE_NO);
  const rows = await page.$$eval(".dk-slide tr.sd-link-row", (trs) => trs.length);
  check("A5 표의 행이 링크", rows > 0, `${rows}행`);
  const numbers = await page.$$eval(".dk-slide a.sd-link-chip", (as) => as.map((a) => a.getAttribute("href").split("/").pop()));
  const t0 = await counter();
  const urlRow = await popupUrl(() => page.click(".dk-slide tr.sd-link-row >> nth=1 >> td >> nth=1"));
  check("표의 행을 누르면 첫 광고가 새 탭으로", urlRow.startsWith(NAVER), urlRow);
  check("표를 눌러도 장은 그대로", (await counter()) === t0);

  // ---- 4) 인쇄본 ----
  await page.evaluate(() => window.dispatchEvent(new Event("beforeprint")));
  await page.waitForTimeout(1500);
  const print = await page.evaluate(() => {
    const p = document.querySelector(".sd-print");
    return { links: p?.querySelectorAll('a[href*="fin.land.naver.com"]').length ?? -1, text: p?.textContent ?? "" };
  });
  check("인쇄본에는 광고 링크가 없다", print.links === 0, `${print.links}개`);
  check("인쇄본에 매물번호가 글자로 있다", numbers.length > 0 && numbers.every((n) => print.text.includes(n)), `${numbers.length}개`);
  await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));

  // ---- 5) 가정을 바꾸면 차트가 바뀐다 ----
  const CASES = [
    ["1", { revSmoat: 300 }],
    ["2", { targetSubscribers: 40 }],
    ["3", { revenueBasis: 6 }],
    ["4", { targetRevenue: 200 }],
    ["5", { targetExternalEvents: 6 }],
    ["6", { standardDirectRateTarget: 15 }],
    ["7-1", { relocGainHigh: 250 }],
    ["7-2", { storeContribFloor: 300 }],
    ["8", { targetBrandConversion: 10 }],
    ["9", { brandAvgPrice: 80000 }],
    ["10", { addDeals2: 4 }],
    ["11", { milestoneAcademies: 2000 }],
    ["12", { revSmoat: 150 }],
    ["13", { creditsPerQuestion: 3 }],
    ["14", { tierHeadroom: 0 }],
    ["15", { commitEarlyExitRate: 30 }],
    ["16", { annualFreeMonths: 1 }],
    ["17", { arpuScenario3: 20 }],
    ["18", { milestoneAcademies: 2000 }],
    ["19", { costCutMonthly: 500 }],
    ["20", { targetSubscribers: 40 }],
    ["21", { customMinPrice: 1000 }],
    ["22", { targetSubscribers: 40 }],
    ["A1", { addDeals2: 3 }],
    ["A2", { b2bFieldLaborRate: 20 }],
    ["A3-2", { customMinPrice: 1000 }],
    ["A8", { dmPerMonth: 120 }],
    ["A13-2", { replacementMarketingCost: 200 }],
    ["A16", { tier2CommitPrice: 30000 }],
    ["A17", { refundCapRate: 20 }],
    ["A20", { revGray: 3000 }],
    ["A22", { commonCostShareSmoat: 30 }],
    ["A23", { targetExternalEvents: 3 }],
    ["A24", { smoatFixedCost: 600 }],
  ];
  const snap = () =>
    page.evaluate(() => {
      const s = document.querySelector(".dk-slide .sd-body");
      const svg = [...(s?.querySelectorAll("svg") ?? [])].map((x) => x.innerHTML).join("|");
      const style = [...(s?.querySelectorAll("[style]") ?? [])].map((x) => x.getAttribute("style")).join("|");
      return `${s?.innerText ?? ""}#${svg}#${style}`;
    });
  for (const [n, o] of CASES) {
    await seek(n);
    await page.evaluate(() => localStorage.clear());
    await seek(n);
    const a = await snap();
    const q = `?a=${Buffer.from(JSON.stringify(o)).toString("base64url")}`;
    await seek(n, q);
    const b = await snap();
    check(`${n}장: ${Object.keys(o)[0]} 를 바꾸면 차트·숫자가 바뀐다`, a !== b);
    await page.evaluate(() => localStorage.clear());
  }
} finally {
  await close();
}
const bad = results.filter((r) => !r.ok).length;
console.log(`\n${results.length}건 중 ${results.length - bad}건 통과`);
process.exit(bad ? 1 : 0);
