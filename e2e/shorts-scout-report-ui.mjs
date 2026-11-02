// ============================================================
//  바이럴 형식 — 상태 바 · 주간 보고 화면 검증 (2026-11-02 목업)
// ------------------------------------------------------------
//    node e2e/shorts-scout-report-ui.mjs <BASE_URL> <토큰파일> <출력 폴더> [--real] [--only=a,b]
//
//  토큰: NEANDER_E2E_EMAIL=나@example.com npm run e2e:token -- <스크래치/토큰.json>  (끝나면 지운다)
//  기본(가상 자료) — e2e/shorts-design-fixture.ts 의 정찰 자료를 고쳐 상태별로 브라우저에만 보낸다.
//    populated · stress(긴 이름 · 많은 나라 · 큰 숫자 · 사진 없음) · empty · nokey · error · autoerr · slow(불러오는 중)
//    폭 1440 · 1024 · 390 에서 가로 넘침을 잰다.
//  --real — 실제 자료를 읽기만 한다 (GET 통과). 화면 안 동작(펼치기 · 메뉴 열기 · 탭 옮기기)만 누른다.
//  지키는 것: /api/neander/** 의 GET 아닌 요청과 Firestore 쓰기는 모두 막는다(abort) — 실행 · 수집 · AI 버튼은 누르지 않는다.
//  결과: <출력 폴더>/<이름>.png · summary.json (마지막 줄에도 JSON)
// ============================================================

import { chromium } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const pos = argv.filter((a) => !a.startsWith("--"));
const flag = (k) => argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const REAL = argv.includes("--real");
const ONLY = (flag("only") || "").split(",").map((s) => s.trim()).filter(Boolean);
const [BASE_URL, tokenFile, outArg] = pos;
if (!BASE_URL || !tokenFile || !outArg) {
  console.error("사용법: node e2e/shorts-scout-report-ui.mjs <BASE_URL> <토큰파일> <출력 폴더> [--real] [--only=a,b]");
  process.exit(2);
}
const BASE = BASE_URL.replace(/\/+$/, "");
const OUT = path.resolve(outArg);
mkdirSync(OUT, { recursive: true });
const token = JSON.parse(readFileSync(tokenFile, "utf8"));
const t0 = Date.now();
const log = (...a) => console.error(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
const FAKE_HOST = "shorts-fixture.invalid";
const DAY = 86_400_000;

// ---- 가상 자료 -------------------------------------------------------------

let fx = null;
if (!REAL) {
  const dir = path.join(OUT, "fixture");
  execFileSync(path.join(ROOT, "node_modules/.bin/tsx"), [path.join(ROOT, "e2e/shorts-design-fixture.ts"), dir, `--me=${token.email}`, "--variant=populated"], { cwd: ROOT, stdio: ["ignore", "ignore", "inherit"] });
  fx = { data: JSON.parse(readFileSync(path.join(dir, "data.json"), "utf8")), scout: JSON.parse(readFileSync(path.join(dir, "scout.json"), "utf8")) };
}
const NOW = Date.parse("2026-10-31T16:00:00+09:00");
const clone = (x) => JSON.parse(JSON.stringify(x));

/** 실제 실행 요약과 같은 모양 (2026-11-02 첫 실행과 비슷한 숫자 — 가상) */
const autoLast = {
  at: NOW - 6 * 3600_000,
  by: token.email,
  added: [
    ...["KR", "KR", "US", "US", "JP", "JP", "TW", "CN"].map((c, i) => ({ country: c, title: `가상 채널 ${i + 1}`, why: "평소의 4.2배 (가상)" })),
  ],
  searches: 6,
  scanned: 19,
  newHits: 87,
  analyzed: 10,
  assigned: 4,
  cardsCreated: ["접기 전후 공간반전"],
  korea: [{ name: "문제공감 → 사용시연", status: "some" }],
  narrated: true,
  aiUsd: 0.1021, // 148원 (1달러 1,450원 어림)
  notes: [],
  ms: 142_000,
};
const autoSettings = { enabled: true, fillKorea: true, countries: ["US", "JP", "TW", "CN"], perCountryCap: 20, addsPerDay: 5, minMultiple: 3, minViewsAbroad: 30000, group: true, koreaCheck: true, koreaPerDay: 2, narrate: true, updatedAt: 1, updatedBy: "" };

function variant(name) {
  if (REAL) return null;
  const s = clone(fx.scout);
  s.companyKey = true;
  s.quotas.youtubeSearch.source = "company";
  // 자동 확인(AI) 으로 「조금 있음」 이 된 카드 하나 — 「AI 판단」 표시 확인용
  const f1 = s.formats.find((f) => f.id === "fmt-01");
  f1.korea.by = "company";
  let auto = { admin: true, settings: autoSettings, last: autoLast };
  let scoutStatus = 200;
  let autoStatus = 200;
  let delay = 0;
  if (name === "stress") {
    const long = "아주 긴 형식 이름 — 접이식 실리콘 싱크대 물막이를 처음 써 보는 사람의 솔직한 일주일 사용기 브이로그 형식 (줄바꿈 확인용)";
    s.formats.forEach((f, i) => {
      f.name = i === 0 ? long : `${f.name} · 긴 이름 확인용 ${"가나다라마바사".repeat(3)}`;
      f.summary = `${f.summary} — 요약이 길어질 때 두 줄에서 잘리는지 보려고 덧붙인 문장입니다. ${"이어지는 설명 ".repeat(8)}`;
      f.structure = ["불편 장면을 아주 길게 설명하는 단계 0~4초 (줄임표 확인)", "공감", "사용 시연 8~15초", "치수 확인", "고정 댓글 안내", "마무리 자막", "다음 영상 예고"];
      f.hook = `${f.hook} ${"훅 설명이 길어지는 경우 ".repeat(6)}`;
    });
    const r = s.reports[0];
    r.counts = { channels: 1234, scanned: 987, newHits: 1234567, analyzed: 765432, unassigned: 2345678, formats: 345, byCountry: ["US", "JP", "TW", "CN", "KR", "GB", "ID", "TH", "VN", "PH", "IN", "BR", "MX", ""].map((c, i) => ({ country: c, hits: 123456 - i * 9000 })) };
    const L = (id) => ({ ...r.rising[0], formatId: id, name: s.formats.find((f) => f.id === id).name });
    r.rising = [L("fmt-01"), L("fmt-02"), L("fmt-03")];
    r.abroadOnly = [L("fmt-02"), { ...L("fmt-04"), top: null }];
    r.saturating = [{ ...L("fmt-03"), stage: "saturating" }, { ...L("fmt-01"), stage: "saturating", top: { url: "https://example.com/not-in-hits", title: "목록에 없는 대표 영상", multiple: null, country: "" } }];
    r.narrative.text = Array.from({ length: 8 }, (_, i) => `• ${i + 1}번째 요약 줄 — ${"아주 길게 이어지는 AI 요약 문장 ".repeat(6)}`).join("\n");
    r.narrative.at = r.createdAt - 3600_000; // 요약 뒤에 보고가 고쳐짐
    auto = { ...auto, last: { ...autoLast, aiUsd: 12.3456, searches: 88, notes: ["미국 「kitchen gadgets」: quotaExceeded — 오늘 YouTube 검색 한도를 다 써서 해외 채널 찾기를 멈춤", "시간이 모자라 해외 채널 찾기 일부를 건너뜀"], cardsCreated: ["아주 긴 새 카드 이름 하나", "또 다른 새 카드 이름"] } };
  }
  if (name === "empty") {
    Object.assign(s, { channels: [], hits: [], formats: [], reports: [] });
    auto = { ...auto, last: null };
  }
  if (name === "nokey") {
    s.companyKey = false;
    s.quotas.youtubeSearch.source = null;
    auto = { ...auto, admin: false };
  }
  if (name === "error") scoutStatus = 500;
  if (name === "autoerr") autoStatus = 500;
  if (name === "slow") delay = 6000;
  return { scout: s, auto, scoutStatus, autoStatus, delay };
}

// ---- 브라우저 ---------------------------------------------------------------

const browser = await chromium.launch({ channel: "chrome", headless: true });
const results = [];
let png = null; // 가상 썸네일 (한 장을 돌려 쓴다)

async function makeThumb(page) {
  const b64 = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 360;
    c.height = 640;
    const g = c.getContext("2d");
    const grd = g.createLinearGradient(0, 0, 360, 640);
    grd.addColorStop(0, "#c7d7ee");
    grd.addColorStop(1, "#6f8fb8");
    g.fillStyle = grd;
    g.fillRect(0, 0, 360, 640);
    g.fillStyle = "rgba(255,255,255,.85)";
    g.fillRect(70, 220, 220, 200);
    g.fillStyle = "#1f2f46";
    g.font = "bold 34px sans-serif";
    g.fillText("가상 썸네일", 85, 330);
    return c.toDataURL("image/png").split(",")[1];
  });
  return Buffer.from(b64, "base64");
}

async function scenario({ id, v, width = 1440, height = 1000, steps }) {
  if (ONLY.length && !ONLY.some((o) => id.startsWith(o))) return;
  const rec = { id, width, ok: true, checks: [], pageErrors: [], blocked: [], unhandled: [], overflow: null };
  const check = (c, label, detail = "") => {
    rec.checks.push(`${c ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
    if (!c) rec.ok = false;
  };
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, locale: "ko-KR", timezoneId: "Asia/Seoul" });
  if (!REAL) await ctx.clock.install({ time: new Date(NOW) });
  await ctx.route("**/*", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const p = url.pathname;
    const m = req.method();
    if (url.hostname === FAKE_HOST) return route.fulfill({ status: 200, contentType: "image/png", body: png ?? Buffer.alloc(0) });
    const fsWrite = /firestore\.googleapis\.com/.test(url.host) && (/Firestore\/Write\//.test(p) || /:commit|:batchWrite/.test(p));
    if ((p.startsWith("/api/neander/") && !["GET", "HEAD", "OPTIONS"].includes(m)) || fsWrite) {
      let action = null;
      try {
        action = req.postDataJSON()?.action ?? null;
      } catch {
        /* 본문 없음 */
      }
      rec.blocked.push(`${m} ${p}${action ? `#${action}` : ""}`);
      return route.abort("blockedbyclient");
    }
    if (REAL || !p.startsWith("/api/neander/shorts/")) return route.continue();
    const what = p.slice("/api/neander/shorts/".length);
    const send = (status, body) => route.fulfill({ status, contentType: "application/json; charset=utf-8", body: JSON.stringify(body) });
    if (v.delay && (what === "scout" || what === "scout-auto")) await new Promise((r) => setTimeout(r, v.delay));
    if (what === "data") return send(200, fx.data);
    if (what === "scout") return v.scoutStatus === 200 ? send(200, v.scout) : send(500, { error: "가상 서버 오류 (검증)" });
    if (what === "scout-auto") return v.autoStatus === 200 ? send(200, v.auto) : send(500, { error: "가상 서버 오류 (검증)" });
    rec.unhandled.push(`${m} ${p}`);
    return send(404, { error: "가상 자료가 답하지 않는 요청입니다." });
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => rec.pageErrors.push(String(e?.message ?? e).slice(0, 300)));
  try {
    await page.goto(`${BASE}/neander/login`, { waitUntil: "domcontentloaded", timeout: 120_000 });
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
    }, token);
    if (!png) png = await makeThumb(page);
    await page.goto(`${BASE}/neander/shorts/scout`, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await page.getByRole("heading", { name: "바이럴 형식", exact: true }).first().waitFor({ timeout: 180_000 });
    await steps(page, check, rec);
  } catch (e) {
    check(false, "진행", String(e?.message ?? e).split("\n")[0].slice(0, 300));
    await page.screenshot({ path: path.join(OUT, `${id}-fail.png`) }).catch(() => undefined);
  }
  check(rec.pageErrors.length === 0, "페이지 오류 없음", rec.pageErrors.join(" / "));
  // 셸이 스스로 보내는 요청(메일 동기화 · 실행기 tick 등)도 막지만, 이 화면의 쓰기(scout · scout-auto)가 없어야 통과
  const mine = rec.blocked.filter((b) => /\/api\/neander\/shorts\/scout(-auto)?(#|$)/.test(b));
  check(mine.length === 0, "정찰 쓰기 요청 없음 (실행 · 수집 · AI 안 누름)", mine.join(", "));
  rec.blockedShell = [...new Set(rec.blocked.filter((b) => !mine.includes(b)))];
  await ctx.close();
  results.push(rec);
  log(`${rec.ok ? "✓" : "✗"} ${id}`, rec.checks.filter((c) => c.startsWith("✗")).join(" | "));
}

const ready = (page) => page.waitForFunction(() => !/정찰 자료를 불러오는 중/.test(document.body.innerText), null, { timeout: 120_000 });
const settle = async (page) => {
  await page.waitForTimeout(600);
  await page.evaluate(async () => {
    for (let y = 0; y < document.documentElement.scrollHeight; y += 600) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 40));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForFunction(() => [...document.querySelectorAll("img")].every((i) => !i.src || i.complete), null, { timeout: 30_000 }).catch(() => undefined);
  await page.waitForTimeout(300);
};

/** 가로 넘침 — 문서 폭 · 가로 스크롤 상자(표 · 탭) 밖으로 삐져나온 요소 · 잘린 글자 */
async function measure(page) {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const main = document.querySelector("main") ?? document.body;
    const scrollers = (el) => {
      for (let p = el.parentElement; p; p = p.parentElement) {
        const ox = getComputedStyle(p).overflowX;
        if (ox === "auto" || ox === "scroll") return true;
      }
      return false;
    };
    const out = [];
    for (const el of main.querySelectorAll("*")) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      if (r.right > vw + 1 && !scrollers(el)) out.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)} right=${Math.round(r.right)}`);
    }
    // 글자가 상자 밖으로 (truncate · line-clamp 는 의도 — 제목 속성이 있으면 뺀다)
    const clipped = [];
    for (const el of main.querySelectorAll("[data-scout-status] *, [data-scout-format] *, dl *")) {
      const cs = getComputedStyle(el);
      if (el.children.length || !el.textContent.trim()) continue;
      if ((cs.overflow === "hidden" || cs.textOverflow === "ellipsis" || cs.webkitLineClamp !== "none") && !el.closest("[title]")) {
        if (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1) clipped.push(el.textContent.trim().slice(0, 40));
      }
    }
    return { docOver: document.documentElement.scrollWidth - vw, outside: out.slice(0, 8), clippedNoTitle: clipped.slice(0, 8) };
  });
}

const shot = async (page, name, full = false) => {
  // 메뉴는 자리를 잡은 뒤에 흐려졌다 나타난다 — 다 나타난 뒤에 찍는다
  if (await page.locator('[role="menu"]').count()) await page.waitForFunction(() => getComputedStyle(document.querySelector('[role="menu"]')).opacity === "1", null, { timeout: 5000 }).catch(() => undefined);
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: full });
};
const text = (page) => page.locator("main").innerText();

/** 기본 화면 — 상태 바 · 탭 · 주간 보고가 다 있는가 */
async function basic(page, check, rec, { name, full = true }) {
  await ready(page);
  await page.locator("[data-scout-status]").waitFor({ timeout: 30_000 });
  await page.waitForFunction(() => /마지막|아직 실행 기록이 없습니다|불러오지 못했습니다/.test(document.querySelector("[data-scout-status]")?.textContent ?? ""), null, { timeout: 30_000 }).catch(() => undefined);
  await settle(page);
  const t = await text(page);
  check(/회사 공용/.test(t), "제목 옆 「회사 공용」");
  check(/자동 수집/.test(t), "상태 바 「자동 수집」");
  for (const tab of ["주간 보고", "터진 영상", "형식 카드", "감시 채널"]) check((await page.getByRole("tab", { name: new RegExp(`^${tab}`) }).count()) === 1, `탭 「${tab}」`);
  rec.overflow = await measure(page);
  check(rec.overflow.docOver <= 0 && rec.overflow.outside.length === 0, "가로 넘침 없음", JSON.stringify(rec.overflow.outside));
  await shot(page, name);
  if (full) await shot(page, `${name}-full`, true);
  return t;
}

/** 화면 안 동작만 — 실행 상세 · 설정 · 실행 메뉴 · 요약 자세히 · 묶기로 · 형식 자세히 */
async function interact(page, check, rec, { name, formats }) {
  const bar = page.locator("[data-scout-status]");
  await bar.getByRole("button", { name: "실행 상세" }).click();
  await page.waitForTimeout(250);
  check(/실행 시각|아직 돈 적이 없습니다/.test(await bar.innerText()), "실행 상세 펼침");
  await shot(page, `${name}-detail`);
  await bar.getByRole("button", { name: "설정", exact: true }).click();
  await page.waitForTimeout(250);
  check(/매일 아침 자동으로 돌기/.test(await bar.innerText()), "설정 펼침 (실행 상세는 닫힘)", "");
  check(!/실행 시각/.test(await bar.innerText()), "두 칸이 겹쳐 열리지 않음");
  await bar.getByRole("button", { name: "설정", exact: true }).click();
  await bar.getByRole("button", { name: /^실행 고르기/ }).click();
  const menu = page.getByRole("menu", { name: "실행 고르기" });
  await menu.waitFor({ timeout: 5000 });
  const items = await menu.getByRole("menuitem").allInnerTexts();
  check(items.length === 4, "실행 메뉴 네 가지", items.map((x) => x.split("\n")[0]).join(" / "));
  for (const k of ["전체 자동화", "채널만 훑기", "보고 새로 만들기", /AI 요약/]) check(items.some((x) => (typeof k === "string" ? x.includes(k) : k.test(x))), `메뉴 「${k}」`);
  await shot(page, `${name}-menu`);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);

  if (formats !== undefined) {
    const n = await page.locator("[data-scout-format]").count();
    check(n === formats, "형식 카드 수 = 겹치지 않은 형식 수", `화면 ${n} · 기대 ${formats}`);
  }
  const more = page.getByRole("button", { name: "요약 자세히" });
  if (await more.count()) {
    await more.click();
    await page.waitForTimeout(200);
    check(/보고서 숫자만 근거로/.test(await text(page)), "요약 자세히 — 생성 정보");
  }
  const bind = page.getByRole("button", { name: "터진 영상에서 묶기" });
  if (await bind.count()) {
    await bind.click();
    await page.waitForTimeout(400);
    check((await page.getByRole("tab", { name: /^터진 영상/ }).getAttribute("aria-selected")) === "true", "「터진 영상에서 묶기」 → 터진 영상 탭");
    await page.getByRole("tab", { name: /^주간 보고/ }).click();
    await page.waitForTimeout(400);
  }
  const detail = page.locator("[data-scout-format]").first();
  if (await detail.count()) {
    const fname = (await detail.locator("h3").innerText()).trim();
    await detail.getByRole("button", { name: "형식 자세히" }).click();
    await page.waitForTimeout(600);
    check((await page.getByRole("tab", { name: /^형식 카드/ }).getAttribute("aria-selected")) === "true", "「형식 자세히」 → 형식 카드 탭", fname.slice(0, 30));
    await shot(page, `${name}-format-open`);
    const link = await page.evaluate(() => [...document.querySelectorAll("a")].filter((a) => /대표 영상 보기/.test(a.textContent)).length);
    check(link === 0, "형식 탭으로 옮김 (보고 카드 사라짐)");
  }
}

// ---- 시나리오 ---------------------------------------------------------------

if (REAL) {
  await scenario({
    id: "real-1440",
    v: null,
    steps: async (page, check, rec) => {
      await basic(page, check, rec, { name: "real-1440" });
      const formats = await page.locator("[data-scout-format]").count();
      rec.formatCards = formats;
      await interact(page, check, rec, { name: "real-1440" });
    },
  });
  for (const w of [1024, 390]) {
    await scenario({ id: `real-${w}`, v: null, width: w, height: w < 500 ? 844 : 900, steps: (page, check, rec) => basic(page, check, rec, { name: `real-${w}` }) });
  }
} else {
  // 화면 카드 수 = 보고 구간 형식(겹치면 한 번) + 구간 밖이지만 예시가 묶인 형식 (보관 · 보고 뒤 영상 · 지운 영상 제외) · 앞 6개
  const cardsOf = (v) => {
    const r = v.scout.reports[0];
    const ids = new Set([...r.abroadOnly, ...r.rising, ...r.saturating].map((l) => l.formatId));
    for (const f of v.scout.formats) if (!f.archived && v.scout.hits.some((h) => h.formatId === f.id && h.status !== "dismissed" && h.createdAt <= r.to)) ids.add(f.id);
    return Math.min(6, ids.size);
  };
  const pop = variant("populated");
  await scenario({
    id: "populated-1440",
    v: pop,
    steps: async (page, check, rec) => {
      const t = await basic(page, check, rec, { name: "populated-1440" });
      check(/최근 실행 AI 148원 · 검색 6회/.test(t), "최근 실행 AI 비용 · 검색 수 (오늘 누적 아님)");
      const opt = await page.locator("select[aria-label='보고 주'] option:checked").innerText();
      check(opt.trim() === "2026-W44 · 10/26 ~ 10/31", "주 고르기 — 저장된 from/to 로 기간", opt.trim());
      check(/최근 6일 · 10\/31 16:00 기준/.test(t), "기간 날수도 저장된 from/to 로 (가상 보고는 6일)");
      check(/형식에 아직 안 묶인 영상/.test(t) && /집계 범위가 다릅니다/.test(t), "안 묶은 영상 · 범위 설명");
      check(/AI 판단/.test(t), "자동 확인 카드에 「AI 판단」");
      check(!/국내에 없는 기회/.test(t), "「국내에 없는 기회」 문구 없음");
      await interact(page, check, rec, { name: "populated-1440", formats: cardsOf(pop) });
    },
  });
  const st = variant("stress");
  for (const w of [1440, 1024, 390]) {
    await scenario({
      id: `stress-${w}`,
      v: st,
      width: w,
      height: w < 500 ? 844 : 1000,
      steps: async (page, check, rec) => {
        const t = await basic(page, check, rec, { name: `stress-${w}` });
        check(/1,234,567/.test(t) && /2,345,678/.test(t), "큰 숫자 쉼표");
        check((await page.locator("[data-scout-format]").count()) === cardsOf(st), "겹친 형식 한 번씩", `${await page.locator("[data-scout-format]").count()}`);
        check(/대표 영상 없음/.test(t), "대표 영상 없는 카드");
        check(/요약 뒤에 새로 고쳐졌습니다/.test(t), "요약 뒤 보고 고침 알림");
        if (w === 1440) await interact(page, check, rec, { name: `stress-${w}`, formats: cardsOf(st) });
      },
    });
  }
  await scenario({
    id: "empty-1440",
    v: variant("empty"),
    steps: async (page, check, rec) => {
      const t = await basic(page, check, rec, { name: "empty-1440", full: false });
      check(/아직 주간 보고가 없습니다/.test(t), "보고 없음 안내");
      check(/아직 실행 기록이 없습니다/.test(t), "실행 기록 없음");
      await page.locator("[data-scout-status]").getByRole("button", { name: /^실행 고르기/ }).click();
      const items = page.getByRole("menu", { name: "실행 고르기" }).getByRole("menuitem");
      await items.first().waitFor();
      check(await items.nth(1).isDisabled(), "채널 없음 → 「채널만 훑기」 막힘");
      check(await items.nth(3).isDisabled(), "보고 없음 → 「AI 요약」 막힘");
      await shot(page, "empty-1440-menu");
    },
  });
  await scenario({
    id: "nokey-1440",
    v: variant("nokey"),
    steps: async (page, check, rec) => {
      const t = await basic(page, check, rec, { name: "nokey-1440", full: false });
      check(/YouTube 검색 키가 없어/.test(t), "키 없음 알림");
      check(/회사 키 없음/.test(t), "상태 바 「회사 키 없음」");
      const bar = page.locator("[data-scout-status]");
      await bar.getByRole("button", { name: "설정", exact: true }).click();
      check(/관리자만 바꿉니다/.test(await bar.innerText()), "관리자 아님 → 설정 읽기 전용");
      check(await bar.getByRole("switch").first().isDisabled().catch(() => true), "설정 스위치 막힘");
      await bar.getByRole("button", { name: /^실행 고르기/ }).click();
      const items = page.getByRole("menu", { name: "실행 고르기" }).getByRole("menuitem");
      await items.first().waitFor();
      check(await items.nth(1).isDisabled(), "키 없음 → 「채널만 훑기」 막힘");
      await shot(page, "nokey-1440-menu");
    },
  });
  await scenario({
    id: "error-1440",
    v: variant("error"),
    steps: async (page, check) => {
      await page.waitForFunction(() => /정찰 자료를 불러오지 못했습니다/.test(document.body.innerText), null, { timeout: 60_000 });
      check(true, "정찰 자료 오류 화면");
      check(/회사 공용/.test(await text(page)), "오류 화면에도 「회사 공용」");
      await shot(page, "error-1440");
    },
  });
  await scenario({
    id: "autoerr-1440",
    v: variant("autoerr"),
    steps: async (page, check, rec) => {
      const t = await basic(page, check, rec, { name: "autoerr-1440", full: false });
      check(/자동화 상태를 불러오지 못했습니다/.test(t), "상태 바 오류 · 다시 시도");
      check((await page.locator("[data-scout-format]").count()) > 0, "상태 바 오류에도 보고는 보임");
    },
  });
  await scenario({
    id: "slow-1440",
    v: variant("slow"),
    steps: async (page, check) => {
      await page.waitForTimeout(1500);
      check(/정찰 자료를 불러오는 중/.test(await page.locator("body").innerText()), "불러오는 중 표시");
      await shot(page, "slow-1440-loading");
    },
  });
}

await browser.close();
const summary = { mode: REAL ? "real" : "fixture", base: BASE, ok: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).map((r) => r.id), results, seconds: Math.round((Date.now() - t0) / 1000) };
writeFileSync(path.join(OUT, "summary.json"), JSON.stringify(summary, null, 1));
console.log(JSON.stringify({ mode: summary.mode, ok: summary.ok, failed: summary.failed, seconds: summary.seconds }));
