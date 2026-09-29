// ============================================================
//  발표 장표 글자 넘침·겹침 검사 — 세 해상도 × 모든 장
// ------------------------------------------------------------
//    node e2e/deck-overflow.mjs <slug> [--token 토큰파일] [--shots 폴더]
//
//  해상도: 1600×900 · 1280×800 · 390×844(모바일)
//  장마다 본다
//    1) 본문(.sd-body)이 제 칸을 넘치는가 (세로로 잘림)
//    2) 상자(data-box)·표 칸·숫자 타일이 가로로 넘치는가
//    3) 글자 조각끼리 겹치는가 (지도 핀은 제외)
//    4) 글자가 캔버스 밖으로 나가는가, 본문이 가정 칩 줄을 덮는가
//    5) 최소 글씨 크기 — 화면에 실제로 그려진 크기(계산된 font-size × 캔버스 배율)가
//       역할별 최소값 이상인가. 1600×900 은 100%, 1280×800·휴대폰은 85% 이상.
//         제목 44 · 핵심 숫자 56 · 본문·카드 제목 26 · 표 본문 22 · 차트 라벨 18 · 각주·칩 15
//       역할은 가장 가까운 역할 클래스로 정한다 (styles.ts 머리말). SVG 글자는 라벨(18).
//  그리고 해상도마다 가정 패널(A)·발표자 노트(N)가 화면 밖으로 넘치지 않는가.
//  휴대폰은 캔버스를 줄이지 않고 세로로 흘린다(.dk-flow) — 가로로 미는 칸(.sd-scroll-x ·
//  표 · 지도)은 캔버스 밖 검사에서 빼고, 문서 전체의 가로 스크롤을 본다.
//
//  로그인: e2e 프로필(npm run ui:login)을 쓰고, 세션이 없으면 --token 파일
//  (scripts/neander/e2e-token.ts)을 일회용 브라우저의 IndexedDB 에 넣는다.
// ============================================================
import { chromium } from "@playwright/test";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { BASE_URL, PROFILE_DIR } from "./profile.mjs";

const args = process.argv.slice(2);
const slug = args.find((a) => !a.startsWith("--")) ?? "2026-09-29-exec";
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const tokenFile = opt("--token");
const shotsDir = opt("--shots");
const only = opt("--only"); // 예: 7,8
// need = 최소 글씨 크기 비율 (1600×900 은 100%, 나머지는 85%)
const VIEWPORTS = [
  { name: "1600x900", width: 1600, height: 900, need: 1 },
  { name: "1280x800", width: 1280, height: 800, need: 0.85 },
  { name: "mobile-390x844", width: 390, height: 844, need: 0.85 },
];
const route = `/neander/meetings/prep/${slug}`;

async function openContext() {
  if (tokenFile) {
    const t = JSON.parse(readFileSync(tokenFile, "utf8"));
    const browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
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
          const db = req.result;
          const tx = db.transaction("firebaseLocalStorage", "readwrite");
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
  const ctx = await chromium.launchPersistentContext(PROFILE_DIR, { headless: true });
  return { ctx, close: () => ctx.close() };
}

/** 캔버스 안 검사 — 브라우저에서 돈다 */
function inspectSlide(need) {
  const stage = document.querySelector(".dk-stage");
  const slide = document.querySelector(".dk-slide .sd-slide");
  if (!stage || !slide) return { error: "장표가 없다" };
  const issues = [];
  const sr = stage.getBoundingClientRect();
  const scale = sr.width / stage.offsetWidth;
  const px = (v) => Math.round(v / scale);
  const label = (el) => {
    const t = (el.innerText || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 40);
    const cls = typeof el.className === "string" ? el.className.split(" ").filter(Boolean)[0] : el.tagName;
    return `${el.tagName.toLowerCase()}.${cls ?? ""} 「${t}」`;
  };
  const tol = 1.5;
  const flow = !!document.querySelector(".dk-flow");
  const inScroll = (el) => flow && !!el.closest(".sd-scroll-x, .sd-table-wrap, .sd-mapwrap");

  // 1) 본문 세로 넘침
  const body = slide.querySelector(".sd-body");
  if (body && body.scrollHeight > body.clientHeight + tol) {
    issues.push(`본문이 넘침: ${body.scrollHeight - body.clientHeight}px 잘림`);
  }
  // 2) 상자·칸·타일 가로/세로 넘침
  for (const el of slide.querySelectorAll("[data-box], .sd-table td, .sd-table th, .sd-kpi-value, .sd-kpi, .sd-step, .sd-pcard-body, .sd-chip, .sd-card")) {
    // 지도는 타일을 일부러 넘치게 깔고 잘라낸다 — 넘침 검사 대상이 아니다
    if (el.matches(".sd-map")) continue;
    const over = el.scrollWidth - el.clientWidth;
    const overY = el.scrollHeight - el.clientHeight;
    const style = getComputedStyle(el);
    if (over > tol && style.overflowX !== "auto" && style.overflowX !== "scroll") issues.push(`가로 넘침 ${over}px: ${label(el)}`);
    if (overY > tol && (style.overflowY === "hidden" || el.matches(".sd-card, .sd-step, .sd-pcard-body"))) issues.push(`세로 넘침 ${overY}px: ${label(el)}`);
  }
  // 글자 조각 — 글자를 직접 가진 요소
  const leaves = [];
  const walker = document.createTreeWalker(slide, NodeFilter.SHOW_TEXT);
  const seen = new Set();
  while (walker.nextNode()) {
    const n = walker.currentNode;
    if (!n.textContent.trim()) continue;
    const el = n.parentElement;
    if (!el || seen.has(el) || el.closest(".sd-map")) continue;
    seen.add(el);
    const range = document.createRange();
    range.selectNodeContents(n);
    for (const r of range.getClientRects()) if (r.width > 1 && r.height > 1) leaves.push({ el, r });
  }
  // 4) 캔버스 밖
  for (const { el, r } of leaves) {
    if (inScroll(el)) continue;
    if (r.right > sr.right + tol || r.bottom > sr.bottom + tol || r.left < sr.left - tol || r.top < sr.top - tol) {
      issues.push(`캔버스 밖 글자: ${label(el)}`);
    }
  }
  // 3) 겹침
  for (let i = 0; i < leaves.length; i++) {
    for (let j = i + 1; j < leaves.length; j++) {
      const a = leaves[i];
      const b = leaves[j];
      if (a.el === b.el || a.el.contains(b.el) || b.el.contains(a.el)) continue;
      const w = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
      const h = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
      if (w > 2 * scale && h > 3 * scale) issues.push(`글자 겹침: ${label(a.el)} ↔ ${label(b.el)}`);
    }
  }
  // 5) 최소 글씨 크기
  const ROLES = [
    ["제목", ".sd-title", 44],
    ["핵심 숫자", ".sd-kpi-value", 56],
    ["각주·칩", ".sd-foot, .sd-note, .sd-table-note, .sd-chip, .sd-chips-label, .sd-head, .sd-fn, .sd-circ, .sd-badge, .sd-map-attr, .sd-amark, .sd-src-row, .sd-link-chip", 15],
    ["차트 라벨", ".sd-lbl, .sd-lbl-s, .sd-kpi-label, .sd-kpi-sub, .sd-legend, .sd-map-key, .sd-pin, .sd-bar-label, .sd-bar-val, .sd-callout-label, .sd-icard-tag, .sd-icard-no, .sd-step-n, .sd-stair-n, .sd-pill, .sd-agroup, .sd-pcard-no, th", 18],
    ["표 본문", "td, .sd-arow, .sd-pcard-meta, .sd-pcard-money, .sd-pcard-feat, .sd-rcard-brief, .sd-rcard-fixed, .sd-chart-title", 22],
  ];
  const roleOf = (el) => {
    if (el.closest("svg")) return ["차트 라벨", 18];
    for (let e = el; e && e !== slide.parentElement; e = e.parentElement) {
      for (const [name, sel, min] of ROLES) if (e.matches(sel)) return [name, min];
    }
    return ["본문", 26];
  };
  const small = [];
  const fontSeen = new Set();
  for (const { el } of leaves) {
    if (fontSeen.has(el)) continue;
    fontSeen.add(el);
    const [role, min] = roleOf(el);
    let px = parseFloat(getComputedStyle(el).fontSize);
    const svg = el.closest("svg");
    if (svg) {
      const vb = svg.viewBox?.baseVal;
      const k = vb && vb.width ? svg.getBoundingClientRect().width / vb.width : scale;
      px = px * k;
    } else {
      px = px * scale;
    }
    if (px + 0.05 < min * need) small.push(`글씨 작음 ${px.toFixed(1)}px < ${(min * need).toFixed(1)} (${role} ${min}): ${label(el)}`);
  }
  issues.push(...small.slice(0, 8));
  if (small.length > 8) issues.push(`글씨 작음 ${small.length - 8}건 더`);
  // 휴대폰: 문서가 가로로 밀리면 안 된다
  if (flow) {
    const root = document.querySelector(".dk-root");
    const over = Math.max(document.documentElement.scrollWidth, root?.scrollWidth ?? 0) - window.innerWidth;
    if (over > 1) issues.push(`가로 스크롤 ${over}px`);
  }
  // 본문과 칩 줄
  const chips = document.querySelector(".sd-chips");
  if (chips && body) {
    const cr = chips.getBoundingClientRect();
    const lastBottom = Math.max(...[...body.children].map((c) => c.getBoundingClientRect().bottom));
    if (lastBottom > cr.top + tol) issues.push(`본문이 칩 줄을 덮음 ${px(lastBottom - cr.top)}px`);
  }
  return { issues: [...new Set(issues)].slice(0, 20), count: document.querySelector(".dk-counter")?.textContent ?? "" };
}

function inspectOverlay(sel) {
  const el = document.querySelector(sel);
  if (!el) return [`${sel} 없음`];
  const r = el.getBoundingClientRect();
  const out = [];
  if (r.right > window.innerWidth + 1) out.push(`${sel} 가 화면 오른쪽으로 ${Math.round(r.right - window.innerWidth)}px 넘침`);
  if (document.documentElement.scrollWidth > window.innerWidth + 1) out.push(`문서 가로 스크롤 ${document.documentElement.scrollWidth - window.innerWidth}px`);
  for (const c of el.querySelectorAll("*")) {
    const cr = c.getBoundingClientRect();
    if (cr.width > 0 && cr.right > r.right + 1) {
      out.push(`${sel} 안에서 넘침: ${(c.className || c.tagName).toString().slice(0, 40)} ${Math.round(cr.right - r.right)}px`);
      break;
    }
  }
  return out;
}

const { ctx, close } = await openContext();
const report = [];
let total = 0;
try {
  for (const vp of VIEWPORTS) {
    const page = await ctx.newPage();
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto(`${BASE_URL}${route}#slide-1`, { waitUntil: "domcontentloaded" });
    try {
      await page.waitForSelector(".dk-stage .sd-slide", { timeout: 90000 });
    } catch {
      const txt = (await page.textContent("body").catch(() => "")) ?? "";
      throw new Error(`장표가 뜨지 않았다 (${vp.name}): ${txt.slice(0, 200)}`);
    }
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(800);
    const n = await page.evaluate(() => document.querySelectorAll(".dk-dot").length);
    const pick = only ? only.split(",").map((x) => Number(x) - 1) : [...Array(n).keys()];
    for (const i of pick) {
      await page.evaluate((k) => {
        window.location.hash = `slide-${k + 1}`;
      }, i);
      await page.waitForTimeout(950); // 등장 움직임(.dk-rise)이 끝날 때까지
      // 사진·지도 타일이 다 그려질 때까지 (로그인 fetch → blob)
      await page
        .waitForFunction(() => [...document.querySelectorAll(".dk-slide img")].every((im) => im.complete && im.naturalWidth > 0), null, { timeout: 15000 })
        .catch(() => {});
      const res = await page.evaluate(inspectSlide, vp.need);
      const issues = res.error ? [res.error] : res.issues;
      total += issues.length;
      report.push({ viewport: vp.name, slide: i + 1, issues });
      if (shotsDir) {
        mkdirSync(path.join(shotsDir, vp.name), { recursive: true });
        await page.screenshot({ path: path.join(shotsDir, vp.name, `slide-${String(i + 1).padStart(2, "0")}.png`) });
      }
      if (issues.length) console.log(`[${vp.name}] ${i + 1}장: ${issues.length}건\n  - ${issues.join("\n  - ")}`);
    }
    // 가정 패널 · 노트
    await page.evaluate(() => (window.location.hash = "slide-23"));
    await page.waitForTimeout(600);
    await page.keyboard.press("a");
    await page.waitForTimeout(500);
    const panel = await page.evaluate(inspectOverlay, ".sd-panel");
    if (shotsDir) await page.screenshot({ path: path.join(shotsDir, vp.name, "panel.png") });
    await page.keyboard.press("a");
    await page.keyboard.press("n");
    await page.waitForTimeout(400);
    const notes = await page.evaluate(inspectOverlay, ".sd-notes");
    if (shotsDir) await page.screenshot({ path: path.join(shotsDir, vp.name, "notes.png") });
    await page.keyboard.press("n");
    const overlay = [...panel.map((x) => `가정 패널: ${x}`), ...notes.map((x) => `노트: ${x}`)];
    total += overlay.length;
    report.push({ viewport: vp.name, slide: "overlay", issues: overlay });
    if (overlay.length) console.log(`[${vp.name}] 패널·노트: ${overlay.join(" / ")}`);
    console.log(`[${vp.name}] ${pick.length}장 검사 끝`);
    await page.close();
  }
} finally {
  await close();
}
const out = shotsDir ? path.join(shotsDir, "overflow-report.json") : null;
if (out) writeFileSync(out, JSON.stringify(report, null, 1));
console.log(`\n합계 문제 ${total}건${out ? ` · 보고서 ${out}` : ""}`);
process.exit(total ? 1 : 0);
