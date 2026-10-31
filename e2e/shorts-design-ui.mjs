// ============================================================
//  AI STUDIO 디자인 검증 — 가상 운영 데이터로 27개 화면을 찍는다 (DB · 외부 호출 없음)
// ------------------------------------------------------------
//    node e2e/shorts-design-ui.mjs <BASE_URL> <토큰파일> <출력 폴더> [--only=key1,key2] [--variant=populated|empty|error]
//
//  토큰: NEANDER_E2E_EMAIL=나@example.com npm run e2e:token -- <스크래치/토큰.json>  (끝나면 지운다)
//  하는 일:
//   1) e2e/shorts-design-fixture.ts 로 가상 자료를 <출력 폴더>/fixture/ 에 만든다
//   2) 그 자료의 사진 · 세로 영상(H.264 MP4) · 음성을 브라우저(Chrome)에서 그려 fixture/media/ 에 만든다 (설계도가 같으면 다시 쓰지 않음)
//   3) 로그인 토큰을 일회용 브라우저에 넣고, /api/neander/shorts/* 읽기를 가로채 가상 자료로 답한다
//   4) 화면마다 <NN>-<key>.png (1440×1080 화면) · <NN>-<key>-full.png (전체) · <NN>-<key>.txt (본문 글) 를 남기고
//      summary.json 에 화면별 오류 · 막은 쓰기 요청을 적는다 (같은 내용을 마지막 줄에 JSON 으로도 찍는다)
//  지키는 것: /api/neander/** 의 GET 아닌 요청과 Firestore 쓰기(Write · commit · batchWrite)는 모두 막는다(abort).
//  AI 생성 · 수집 · 게시 · 고객 알림 버튼은 누르지 않는다. 가상 자료는 브라우저에만 간다.
//  여러 개를 동시에 돌려도 된다 — 쓰는 파일은 모두 <출력 폴더> 안.
//  브라우저 시계는 시나리오 시점 2026-10-31 16:00 KST 에서 흐른다 (SHORTS_DESIGN_CLOCK=0 이면 실제 시각).
//
//  화면 (NN-key · 주소 · 준비 동작):
//   01-dashboard        /neander/shorts
//   02-trends           /neander/shorts/trends
//   03-scout-report     /neander/shorts/scout                    (탭 「주간 보고」)
//   04-scout-hits       /neander/shorts/scout                    (탭 「터진 영상」 → 「전체」)
//   05-scout-formats    /neander/shorts/scout                    (탭 「형식 카드」)
//   06-scout-channels   /neander/shorts/scout                    (탭 「감시 채널」)
//   07-templates        /neander/shorts/templates
//   08-projects         /neander/shorts/projects
//   09-clients          /neander/shorts/clients
//   10-publish          /neander/shorts/publish
//   11-analytics        /neander/shorts/analytics
//   12-team             /neander/shorts/team
//   13-accounts         /neander/shorts/accounts
//   14-shop-sources     /neander/shorts/projects/mock-shopping?tab=sources
//   15-shop-coupang     /neander/shorts/projects/mock-shopping?tab=coupang
//   16-shop-script      /neander/shorts/projects/mock-shopping?tab=script
//   17-shop-edit        /neander/shorts/projects/mock-shopping?tab=edit       (9:16 미리보기를 2.5초로 옮김)
//   18-shop-publish     /neander/shorts/projects/mock-shopping?tab=publish
//   19-shop-perf        /neander/shorts/projects/mock-shopping?tab=perf
//   20-brand-client     /neander/shorts/projects/mock-brand?tab=client
//   21-brand-review     /neander/shorts/projects/mock-brand?tab=review
//   22-client-month     /neander/shorts/clients/mock-client           (탭 「월별 영상」)
//   23-client-brief     /neander/shorts/clients/mock-client           (탭 「계약 · 브리프」)
//   24-client-products  /neander/shorts/clients/mock-client           (탭 「제품 · 사진」)
//   25-client-accounts  /neander/shorts/clients/mock-client           (탭 「게시 계정」)
//   26-client-report    /neander/shorts/clients/mock-client/report?month=2026-10
//   27-public-review    /neander/review/mock-review-b003              (로그인 없는 창 · 이름 · 코멘트만 채움, 보내지 않음)
//  --only 는 key(예: shop-edit) · NN(예: 17) · NN-key 어느 것이든 된다.
// ============================================================

import { build } from "esbuild";
import { chromium } from "@playwright/test";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const pos = argv.filter((a) => !a.startsWith("--"));
const flag = (k) => argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const [BASE_URL, tokenFile, outArg] = pos;
if (!BASE_URL || !tokenFile || !outArg) {
  console.error("사용법: node e2e/shorts-design-ui.mjs <BASE_URL> <토큰파일> <출력 폴더> [--only=key1,key2] [--variant=populated|empty|error]");
  process.exit(2);
}
const BASE = BASE_URL.replace(/\/+$/, "");
const OUT = path.resolve(outArg);
const FIX = path.join(OUT, "fixture");
const MEDIA_DIR = path.join(FIX, "media");
const VARIANT = flag("variant") || "populated";
if (!["populated", "empty", "error"].includes(VARIANT)) throw new Error(`--variant 는 populated · empty · error 중 하나: ${VARIANT}`);
const ONLY = (flag("only") || "").split(",").map((s) => s.trim()).filter(Boolean);
const SCENARIO_NOW = new Date("2026-10-31T16:00:00+09:00");
const FAKE_HOST = "shorts-fixture.invalid";
const PART = 768 * 1024;
const GEN_VERSION = "gen-4"; // 그림 설계가 바뀌면 올려서 다시 만든다
mkdirSync(MEDIA_DIR, { recursive: true });

const token = JSON.parse(readFileSync(tokenFile, "utf8"));
const t0 = Date.now();
const log = (...a) => console.error(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);

// ---- 화면 목록 ------------------------------------------------------------

const tab = (name) => async (page) => {
  await page.getByRole("tab", { name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`) }).first().click({ timeout: 20_000 });
  await page.waitForTimeout(500);
};
const SCREENS = [
  { nn: "01", key: "dashboard", route: "/neander/shorts" },
  { nn: "02", key: "trends", route: "/neander/shorts/trends" },
  { nn: "03", key: "scout-report", route: "/neander/shorts/scout", wait: /감시 채널|주간 보고/ },
  { nn: "04", key: "scout-hits", route: "/neander/shorts/scout", prepare: async (p) => { await tab("터진 영상")(p); await tab("전체")(p).catch(() => undefined); } },
  { nn: "05", key: "scout-formats", route: "/neander/shorts/scout", prepare: tab("형식 카드") },
  { nn: "06", key: "scout-channels", route: "/neander/shorts/scout", prepare: tab("감시 채널") },
  { nn: "07", key: "templates", route: "/neander/shorts/templates" },
  { nn: "08", key: "projects", route: "/neander/shorts/projects" },
  { nn: "09", key: "clients", route: "/neander/shorts/clients" },
  { nn: "10", key: "publish", route: "/neander/shorts/publish" },
  { nn: "11", key: "analytics", route: "/neander/shorts/analytics" },
  { nn: "12", key: "team", route: "/neander/shorts/team" },
  { nn: "13", key: "accounts", route: "/neander/shorts/accounts" },
  { nn: "14", key: "shop-sources", route: "/neander/shorts/projects/mock-shopping?tab=sources" },
  { nn: "15", key: "shop-coupang", route: "/neander/shorts/projects/mock-shopping?tab=coupang" },
  { nn: "16", key: "shop-script", route: "/neander/shorts/projects/mock-shopping?tab=script" },
  { nn: "17", key: "shop-edit", route: "/neander/shorts/projects/mock-shopping?tab=edit", after: (p) => seekPreview(p, 2.5) },
  { nn: "18", key: "shop-publish", route: "/neander/shorts/projects/mock-shopping?tab=publish" },
  { nn: "19", key: "shop-perf", route: "/neander/shorts/projects/mock-shopping?tab=perf" },
  { nn: "20", key: "brand-client", route: "/neander/shorts/projects/mock-brand?tab=client" },
  { nn: "21", key: "brand-review", route: "/neander/shorts/projects/mock-brand?tab=review" },
  { nn: "22", key: "client-month", route: "/neander/shorts/clients/mock-client" },
  { nn: "23", key: "client-brief", route: "/neander/shorts/clients/mock-client", prepare: tab("계약") },
  { nn: "24", key: "client-products", route: "/neander/shorts/clients/mock-client", prepare: tab("제품") },
  { nn: "25", key: "client-accounts", route: "/neander/shorts/clients/mock-client", prepare: tab("게시 계정") },
  { nn: "26", key: "client-report", route: "/neander/shorts/clients/mock-client/report?month=2026-10" },
  { nn: "27", key: "public-review", route: "/neander/review/mock-review-b003", public: true, after: fillReview },
];
const chosen = SCREENS.filter((s) => !ONLY.length || ONLY.some((o) => o === s.key || o === s.nn || o === `${s.nn}-${s.key}`));
if (!chosen.length) throw new Error(`--only 에 맞는 화면이 없습니다: ${ONLY.join(",")}`);

// ---- 1) 가상 자료 -----------------------------------------------------------

log("fixture", VARIANT);
execFileSync(path.join(ROOT, "node_modules/.bin/tsx"), [path.join(ROOT, "e2e/shorts-design-fixture.ts"), FIX, `--me=${token.email}`, `--variant=${VARIANT}`], { cwd: ROOT, stdio: ["ignore", "ignore", "inherit"] });
const fx = (n) => JSON.parse(readFileSync(path.join(FIX, n), "utf8"));
const data = fx("data.json");
const scoutData = fx("scout.json");
const mediaPlan = fx("media.json");
const jobsAll = fx("jobs.json").jobs;
const reviewFx = fx("review.json");

// ---- 2) 사진 · 영상 · 음성 만들기 -----------------------------------------------

const extOf = (draw) => (draw.type === "video" ? "mp4" : draw.type === "image" ? "jpg" : "wav");
const hashOf = (draw) => createHash("sha1").update(JSON.stringify(draw)).update(GEN_VERSION).digest("hex").slice(0, 16);
const indexFile = path.join(MEDIA_DIR, "index.json");
const index = existsSync(indexFile) ? JSON.parse(readFileSync(indexFile, "utf8")) : {};
const assets = [
  ...mediaPlan.items.map((x) => ({ id: x.view.id, draw: x.draw, audio: x.view.kind === "render" })),
  ...mediaPlan.thumbs.map((x) => ({ id: `thumb-${x.name}`, draw: x.draw, audio: false })),
];
const todo = assets.filter((a) => {
  const f = path.join(MEDIA_DIR, `${a.id}.${extOf(a.draw)}`);
  return !(existsSync(f) && index[a.id] === hashOf(a.draw) + (a.audio ? "a" : ""));
});
if (todo.length) await generate(todo);
const fileOf = (id) => {
  const a = assets.find((x) => x.id === id);
  return a ? path.join(MEDIA_DIR, `${id}.${extOf(a.draw)}`) : null;
};
const views = new Map(mediaPlan.items.map((x) => [x.view.id, { ...x.view, size: statSync(fileOf(x.view.id)).size }]));
// 실제 크기를 적은 목록을 남긴다 (사람이 볼 때 · 다른 도구용)
writeFileSync(path.join(FIX, "media-views.json"), JSON.stringify([...views.values()], null, 1));
const reviewInfo = (() => {
  if (!reviewFx) return null;
  const v = views.get(reviewFx.renderId);
  return { ...reviewFx.review, media: { size: v.size, type: v.type, duration: v.duration, parts: Math.ceil(v.size / PART) } };
})();

// ---- 3) 브라우저 · 가로채기 ---------------------------------------------------

const browser = await chromium.launch({ channel: "chrome", headless: true });
const results = [];
let current = null; // 지금 찍는 화면 (막은 요청 · 오류를 이 화면에 붙인다)
const blockedAll = [];
const unhandledAll = [];

const json = (route, status, body) => route.fulfill({ status, contentType: "application/json; charset=utf-8", body: JSON.stringify(body) });
const bytes = (route, buf, type = "application/octet-stream") => route.fulfill({ status: 200, contentType: type, body: buf, headers: { "Cache-Control": "no-store" } });
const sliceParts = (file, from, count) => {
  const buf = readFileSync(file);
  return buf.subarray(from * PART, Math.min(buf.length, (from + count) * PART));
};

async function handle(route) {
  const req = route.request();
  const url = new URL(req.url());
  const method = req.method();
  const p = url.pathname;
  if (url.hostname === FAKE_HOST) {
    const m = /^\/thumb\/([\w-]+)\.jpg$/.exec(p);
    const f = m && fileOf(`thumb-${m[1]}`);
    return f && existsSync(f) ? bytes(route, readFileSync(f), "image/jpeg") : route.fulfill({ status: 404, body: "" });
  }
  const firestoreWrite = /firestore\.googleapis\.com/.test(url.host) && (/Firestore\/Write\//.test(p) || /:commit|:batchWrite/.test(p));
  if ((p.startsWith("/api/neander/") && !["GET", "HEAD", "OPTIONS"].includes(method)) || firestoreWrite) {
    let action = null;
    try {
      action = req.postDataJSON()?.action ?? null;
    } catch {
      /* 본문 없음 · JSON 아님 */
    }
    const b = { screen: current?.id ?? "(준비)", method, path: p, action };
    blockedAll.push(b);
    current?.blocked.push(b);
    return route.abort("blockedbyclient");
  }
  if (!p.startsWith("/api/neander/shorts/")) return route.continue();
  const q = url.searchParams;
  const what = p.slice("/api/neander/shorts/".length);
  if (what === "data") return VARIANT === "error" ? json(route, 500, { error: "가상 서버 오류 (variant=error)" }) : json(route, 200, data);
  if (what === "scout") return VARIANT === "error" ? json(route, 500, { error: "가상 서버 오류 (variant=error)" }) : json(route, 200, scoutData);
  if (what === "jobs") return json(route, 200, { jobs: jobsAll.filter((j) => !q.get("projectId") || j.projectId === q.get("projectId")) });
  if (what === "media") {
    const all = [...views.values()];
    if (q.get("projectId")) return json(route, 200, { media: all.filter((m) => m.projectId === q.get("projectId")) });
    if (q.get("clientId")) return json(route, 200, { media: all.filter((m) => m.clientId === q.get("clientId")) });
    const v = views.get(q.get("id") ?? "");
    if (!v) return json(route, 404, { error: "파일을 찾지 못했습니다 (가상 자료에 없음)." });
    if (q.get("meta") === "1") return json(route, 200, { media: v });
    return bytes(route, sliceParts(fileOf(v.id), Number(q.get("from")) || 0, Math.min(5, Number(q.get("count")) || 1)));
  }
  if (what === "review") {
    if (!reviewInfo) return json(route, 404, { error: "검토 링크를 찾지 못했습니다." });
    if (q.has("from")) return bytes(route, sliceParts(fileOf(reviewFx.renderId), Number(q.get("from")) || 0, Math.min(5, Number(q.get("count")) || 1)));
    return json(route, 200, { review: reviewInfo });
  }
  const u = { screen: current?.id ?? "(준비)", method, path: p, query: url.search };
  unhandledAll.push(u);
  current?.unhandled.push(u);
  return json(route, 404, { error: "가상 자료가 답하지 않는 요청입니다 (shorts-design-ui)." });
}

async function newContext({ login }) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1080 }, deviceScaleFactor: 1, locale: "ko-KR", timezoneId: "Asia/Seoul" });
  if (process.env.SHORTS_DESIGN_CLOCK !== "0") await ctx.clock.install({ time: SCENARIO_NOW });
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem("neander.shorts.viewer", "mine");
    } catch {
      /* noop */
    }
  });
  await ctx.route("**/*", handle);
  if (login) {
    const page = await ctx.newPage();
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
    await page.close();
  }
  return ctx;
}

// ---- 4) 화면 찍기 -------------------------------------------------------------

const LOADING = /(불러오는|로그인 확인|정찰 자료를 불러오는) 중|영상 받는 중/;

async function settle(page, extra) {
  await page.waitForFunction((src) => !new RegExp(src).test(document.body?.innerText ?? "불러오는 중"), LOADING.source, { timeout: 90_000 }).catch(() => undefined);
  if (extra) await page.waitForFunction((src) => new RegExp(src).test(document.body?.innerText ?? ""), extra.source, { timeout: 30_000 }).catch(() => undefined);
  await page.waitForTimeout(700);
}

/** 영상 · 사진이 다 뜰 때까지 (lazy 사진은 한 번 내려 보고 올라온다) */
async function settleMedia(page) {
  await page.evaluate(async () => {
    const h = document.documentElement.scrollHeight;
    for (let y = 0; y < h; y += 700) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 60));
    }
    window.scrollTo(0, 0);
  });
  await page
    .waitForFunction(
      () =>
        [...document.querySelectorAll("video")].every((v) => !v.src || v.readyState >= 2 || v.error) &&
        [...document.querySelectorAll("img")].every((i) => !i.src || i.complete),
      null,
      { timeout: 45_000, polling: 300 },
    )
    .catch(() => undefined);
  await page.waitForTimeout(600);
}

/** 편집 탭의 9:16 미리보기를 그 시각으로 옮긴다 (그려 둔 첫 장면이 「불러오는 중」 이 아니게) */
async function seekPreview(page, sec) {
  const range = page.getByRole("slider", { name: "재생 위치" }).first();
  if (!(await range.count())) return;
  for (let i = 0; i < 2; i++) {
    await range.evaluate((el, v) => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      set.call(el, String(v));
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }, sec);
    await page.waitForTimeout(900);
  }
}

/** 공개 검토 — 임시로 적는 중인 모습 (보내지 않는다) · 영상은 8초 장면 */
async function fillReview(page) {
  const name = page.getByLabel("검토하신 분 이름");
  if (await name.count()) await name.fill("김민아(가상)");
  const fb = page.getByLabel(/수정할 점/);
  if (await fb.count()) await fb.fill("마지막 제품명 자막을 1초만 더 보여주세요.");
  await page.evaluate(async () => {
    const v = document.querySelector("video");
    if (!v) return;
    v.currentTime = 8;
    await new Promise((r) => {
      v.addEventListener("seeked", r, { once: true });
      setTimeout(r, 3000);
    });
  });
  await page.waitForTimeout(400);
}

let appCtx = null;
let publicCtx = null;
for (const s of chosen) {
  const id = `${s.nn}-${s.key}`;
  const rec = { id, nn: s.nn, key: s.key, route: s.route, ok: false, ms: 0, pageErrors: [], consoleErrors: [], failedRequests: [], blocked: [], unhandled: [], notes: [] };
  current = rec;
  const started = Date.now();
  let page = null;
  try {
    if (s.public) publicCtx ??= await newContext({ login: false });
    else appCtx ??= await newContext({ login: true });
    page = await (s.public ? publicCtx : appCtx).newPage();
    page.on("pageerror", (e) => rec.pageErrors.push(String(e?.message ?? e).slice(0, 500)));
    page.on("console", (m) => {
      if (m.type() !== "error" || rec.consoleErrors.length >= 20) return;
      if (/ERR_BLOCKED_BY_CLIENT/.test(m.text())) return; // 하네스가 막은 쓰기 요청 — blocked 에 따로 남는다
      rec.consoleErrors.push(m.text().slice(0, 300));
    });
    page.on("requestfailed", (r) => {
      const f = r.failure()?.errorText ?? "";
      if (f.includes("BLOCKED_BY_CLIENT") || r.url().startsWith("blob:")) return; // 막은 요청 · 영상 미리 읽기 중단
      if (/firestore\.googleapis\.com/.test(r.url()) && /ABORTED/.test(f)) return; // 화면을 떠날 때 끊긴 Firestore 연결
      rec.failedRequests.push(`${r.method()} ${r.url().slice(0, 160)} · ${f}`);
    });
    await page.goto(`${BASE}${s.route}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
    if (!s.public) await page.waitForSelector("[data-nd-topbar]", { timeout: 90_000 }).catch(() => rec.notes.push("셸 상단바([data-nd-topbar])를 못 찾음"));
    await settle(page, VARIANT === "populated" ? s.wait : undefined);
    if (s.prepare) await s.prepare(page);
    await settle(page);
    await settleMedia(page);
    if (s.after) await s.after(page);
    if (page.url().includes("/neander/login") && !s.route.includes("/login")) rec.notes.push("로그인 화면으로 보내짐 — 토큰이 만료됐을 수 있음");
    const overlay = await page.locator("nextjs-portal").count().catch(() => 0);
    if (overlay) rec.notes.push("Next.js 오류 오버레이가 떠 있음 (다른 사람이 고치는 중인 코드일 수 있음)");
    const text = await page.locator("body").innerText();
    if (/불러오는 중/.test(text)) rec.notes.push("아직 「불러오는 중」 글자가 남아 있음");
    if (/AI STUDIO 자료를 불러오지 못했습니다|정찰 자료를 불러오지 못했습니다/.test(text)) rec.notes.push("오류 화면 (자료를 불러오지 못함)");
    rec.textChars = text.length;
    // 빈 상태 문구 — 채워져야 할 곳이 비었는지 훑어보기용 (연결 필요 · 미확인 같은 정상 문구도 섞인다)
    rec.emptyHints = [...new Set(text.split("\n").map((l) => l.trim()).filter((l) => l.length < 120 && /없습니다|찾지 못했습니다/.test(l)))].slice(0, 10);
    rec.media = await page.evaluate(() => ({
      videos: [...document.querySelectorAll("video")].map((v) => v.readyState),
      images: [...document.querySelectorAll("img")].filter((i) => i.src && !i.naturalWidth).length,
    }));
    writeFileSync(path.join(OUT, `${id}.txt`), text);
    await page.screenshot({ path: path.join(OUT, `${id}.png`), fullPage: false });
    await page.screenshot({ path: path.join(OUT, `${id}-full.png`), fullPage: true });
    // variant=error 에서는 오류 화면이 기대한 결과다
    const bad = VARIANT === "error" ? /오류 오버레이|로그인 화면|불러오는 중/ : /오류|로그인 화면|불러오는 중/;
    rec.ok = rec.pageErrors.length === 0 && !rec.notes.some((n) => bad.test(n));
  } catch (e) {
    rec.notes.push(`찍지 못함: ${String(e?.message ?? e).split("\n")[0].slice(0, 300)}`);
    if (page) await page.screenshot({ path: path.join(OUT, `${id}.png`) }).catch(() => undefined);
  } finally {
    rec.ms = Date.now() - started;
    await page?.close().catch(() => undefined);
  }
  // 같은 요청이 여러 번 막혔으면 한 줄로 (실행기 tick 등)
  rec.blocked = Object.values(
    rec.blocked.reduce((acc, b) => {
      const k = `${b.method} ${b.path} ${b.action ?? ""}`;
      acc[k] = acc[k] ? { ...acc[k], count: acc[k].count + 1 } : { method: b.method, path: b.path, action: b.action, count: 1 };
      return acc;
    }, {}),
  );
  results.push(rec);
  log(`${rec.ok ? "✓" : "✗"} ${id} ${rec.ms}ms${rec.pageErrors.length ? ` · 페이지 오류 ${rec.pageErrors.length}` : ""}${rec.blocked.length ? ` · 막음 ${rec.blocked.map((b) => `${b.path}${b.action ? `#${b.action}` : ""}×${b.count}`).join(", ")}` : ""}${rec.notes.length ? ` · ${rec.notes.join(" / ")}` : ""}`);
}
current = null;
await browser.close();

const summary = {
  baseUrl: BASE,
  outDir: OUT,
  variant: VARIANT,
  me: token.email,
  clock: process.env.SHORTS_DESIGN_CLOCK === "0" ? "real" : SCENARIO_NOW.toISOString(),
  generatedMedia: todo.length,
  screens: results.map(({ textChars, ...r }) => ({ ...r, textChars })),
  ok: results.filter((r) => r.ok).length,
  failed: results.filter((r) => !r.ok).map((r) => r.id),
  blockedWrites: results.flatMap((r) => r.blocked.map((b) => ({ screen: r.id, ...b }))),
  unhandledGets: unhandledAll,
  seconds: Math.round((Date.now() - t0) / 1000),
};
writeFileSync(path.join(OUT, "summary.json"), JSON.stringify(summary, null, 1));
console.log(JSON.stringify(summary));

// ============================================================
//  가상 사진 · 영상 생성기 (Chrome 의 WebCodecs + mediabunny 로 H.264 MP4)
// ============================================================

async function generate(list) {
  log(`media 만들기 ${list.length}개`);
  const genDir = path.join(FIX, "gen");
  mkdirSync(genDir, { recursive: true });
  await build({
    stdin: { contents: generatorSource(), resolveDir: ROOT, sourcefile: "shorts-design-generator.js", loader: "js" },
    bundle: true,
    format: "esm",
    outfile: path.join(genDir, "gen.js"),
    platform: "browser",
    target: "chrome110",
    logLevel: "error",
  });
  const genJs = readFileSync(path.join(genDir, "gen.js"));
  const b = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await b.newPage();
    page.on("pageerror", (e) => log("생성기 오류:", e.message));
    await page.route(`https://${FAKE_HOST}/**`, (route) => {
      const u = new URL(route.request().url());
      if (u.pathname === "/gen/gen.js") return route.fulfill({ status: 200, contentType: "text/javascript", body: genJs });
      return route.fulfill({ status: 200, contentType: "text/html", body: `<!doctype html><meta charset="utf-8"><body style="margin:0"><script type="module" src="/gen/gen.js"></script></body>` });
    });
    await page.goto(`https://${FAKE_HOST}/gen/`);
    await page.waitForFunction(() => typeof window.makeAsset === "function", null, { timeout: 30_000 });
    for (const a of list) {
      const f = path.join(MEDIA_DIR, `${a.id}.${extOf(a.draw)}`);
      if (a.draw.type === "audio") writeFileSync(f, wav(a.draw.seconds));
      else {
        const b64 = await page.evaluate(([draw, audio]) => window.makeAsset(draw, audio), [a.draw, a.audio]);
        writeFileSync(f, Buffer.from(b64, "base64"));
      }
      index[a.id] = hashOf(a.draw) + (a.audio ? "a" : "");
      writeFileSync(indexFile, JSON.stringify(index, null, 1));
    }
  } finally {
    await b.close();
  }
  log("media 끝");
}

/** 내레이션 자리 — 말소리처럼 끊어지는 낮은 소리 (16kHz 모노 WAV) */
function wav(seconds) {
  const sr = 16_000;
  const n = sr * seconds;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write("WAVEfmt ", 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sr, 24);
  buf.writeUInt32LE(sr * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const syl = Math.max(0, Math.sin(Math.PI * ((t * 3.3) % 1))) * (Math.sin(t * 0.7) > -0.6 ? 1 : 0.15);
    const v = syl * 0.18 * (Math.sin(2 * Math.PI * 180 * t) + 0.5 * Math.sin(2 * Math.PI * 360 * t + 1) + 0.25 * Math.sin(2 * Math.PI * 720 * t));
    buf.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(v * 32767 * 0.6))), 44 + i * 2);
  }
  return buf;
}

// 그림 설계 — 화면 쪽에서 esbuild 로 mediabunny 와 묶는다
function generatorSource() {
  return String.raw`
import { Output, Mp4OutputFormat, BufferTarget, CanvasSource, AudioBufferSource } from "mediabunny";

const FONT = '"Apple SD Gothic Neo","Noto Sans KR","Malgun Gothic",sans-serif';
const rng = (seed) => { let s = (seed >>> 0) || 1; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); };
const rr = (c, x, y, w, h, r) => { c.beginPath(); c.roundRect(x, y, w, h, r); };
const lin = (c, x0, y0, x1, y1, stops) => { const g = c.createLinearGradient(x0, y0, x1, y1); stops.forEach(([o, col]) => g.addColorStop(o, col)); return g; };
const hsl = (h, s, l, a = 1) => "hsla(" + h + "," + s + "%," + l + "%," + a + ")";
const SKIN = "#e8c2a4", SKIN_D = "#d4a585";

// ---- 공통 배경 · 물건 -----------------------------------------------------

function kitchen(c, W, H) {
  c.fillStyle = lin(c, 0, 0, 0, H * 0.6, [[0, "#f7f4ef"], [1, "#e9e4dc"]]);
  c.fillRect(0, 0, W, H);
  c.strokeStyle = "rgba(0,0,0,0.045)"; c.lineWidth = 2;
  for (let y = H * 0.05; y < H * 0.58; y += H * 0.045) { c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke(); }
  for (let x = 0; x < W; x += W / 7) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, H * 0.58); c.stroke(); }
  const g = c.createRadialGradient(W * 0.15, H * 0.1, 10, W * 0.15, H * 0.1, W * 0.9); g.addColorStop(0, "rgba(255,255,255,0.7)"); g.addColorStop(1, "rgba(255,255,255,0)");
  c.fillStyle = g; c.fillRect(0, 0, W, H);
  c.fillStyle = lin(c, 0, H * 0.58, 0, H, [[0, "#fbfbfa"], [1, "#e6e6e3"]]); c.fillRect(0, H * 0.58, W, H * 0.42);
  c.fillStyle = "rgba(0,0,0,0.06)"; c.fillRect(0, H * 0.58, W, 4);
  // 스테인리스 개수대
  rr(c, W * 0.1, H * 0.66, W * 0.8, H * 0.27, W * 0.05); c.fillStyle = lin(c, 0, H * 0.66, 0, H * 0.93, [[0, "#c8cdd2"], [1, "#8f979e"]]); c.fill();
  rr(c, W * 0.14, H * 0.685, W * 0.72, H * 0.225, W * 0.04); c.fillStyle = lin(c, 0, H * 0.69, 0, H * 0.91, [[0, "#9aa2a9"], [1, "#c3c9ce"]]); c.fill();
  c.fillStyle = "#6f777e"; c.beginPath(); c.ellipse(W * 0.5, H * 0.86, W * 0.05, H * 0.012, 0, 0, Math.PI * 2); c.fill();
  // 수전
  c.strokeStyle = lin(c, W * 0.7, 0, W * 0.76, 0, [[0, "#d7dbdf"], [1, "#98a0a7"]]); c.lineWidth = W * 0.035; c.lineCap = "round";
  c.beginPath(); c.moveTo(W * 0.73, H * 0.62); c.lineTo(W * 0.73, H * 0.4); c.quadraticCurveTo(W * 0.73, H * 0.33, W * 0.62, H * 0.33); c.lineTo(W * 0.56, H * 0.35); c.stroke();
}

function guard(c, cx, baseY, width, height, fold = 0, wet = 0) {
  const n = 14, w = width * (1 - 0.72 * fold), x0 = cx - w / 2, pw = w / n, skew = height * 0.05;
  c.save();
  c.fillStyle = "rgba(0,0,0,0.12)"; c.beginPath(); c.ellipse(cx, baseY + height * 0.05, w * 0.55, height * 0.08, 0, 0, Math.PI * 2); c.fill();
  for (let i = 0; i < n; i++) {
    const x = x0 + i * pw;
    c.fillStyle = i % 2 ? lin(c, x, 0, x + pw, 0, [[0, "#8a9198"], [1, "#9ea5ac"]]) : lin(c, x, 0, x + pw, 0, [[0, "#b9bfc5"], [1, "#a3aab0"]]);
    c.beginPath(); c.moveTo(x, baseY - height + (i % 2 ? skew : 0)); c.lineTo(x + pw, baseY - height + (i % 2 ? 0 : skew)); c.lineTo(x + pw, baseY); c.lineTo(x, baseY); c.closePath(); c.fill();
  }
  c.fillStyle = "rgba(255,255,255,0.35)"; c.fillRect(x0, baseY - height, w, height * 0.05);
  rr(c, x0 - 4, baseY - height * 0.14, w + 8, height * 0.14, 6); c.fillStyle = "#5f666c"; c.fill();
  c.fillStyle = "#4b5157";
  for (let i = 0; i < 4; i++) { c.beginPath(); c.ellipse(x0 + w * (0.12 + i * 0.25), baseY + 2, w * 0.035, height * 0.035, 0, 0, Math.PI * 2); c.fill(); }
  if (wet) { const r = rng(7); c.fillStyle = "rgba(220,240,255," + (0.6 * wet) + ")"; for (let i = 0; i < 26; i++) { c.beginPath(); c.arc(x0 + r() * w, baseY - height * (0.2 + r() * 0.7), 2 + r() * 4, 0, Math.PI * 2); c.fill(); } }
  c.restore();
}

function water(c, W, H, t, sx, sy, ey, spread = 1) {
  c.save();
  c.strokeStyle = "rgba(170,214,240,0.75)"; c.lineWidth = W * 0.022; c.lineCap = "round";
  c.beginPath(); c.moveTo(sx, sy); for (let y = sy; y <= ey; y += 8) c.lineTo(sx + Math.sin(y * 0.05 + t * 9) * 2.5, y); c.stroke();
  c.strokeStyle = "rgba(255,255,255,0.55)"; c.lineWidth = W * 0.006; c.beginPath(); c.moveTo(sx - 3, sy); c.lineTo(sx - 3, ey); c.stroke();
  const r = rng(11);
  for (let i = 0; i < 46; i++) {
    const ph = (t * (0.9 + r()) + r()) % 1, ang = -Math.PI / 2 + (r() - 0.5) * 2.4 * spread, sp = (0.12 + r() * 0.22) * W;
    const x = sx + Math.cos(ang) * sp * ph, y = ey + Math.sin(ang) * sp * ph + ph * ph * W * 0.25;
    c.fillStyle = "rgba(150,205,236," + (0.9 - ph * 0.6) + ")"; c.beginPath(); c.arc(x, y, 3 + r() * 5, 0, Math.PI * 2); c.fill();
  }
  c.restore();
}

function hand(c, x, y, s, ang = 0) {
  c.save(); c.translate(x, y); c.rotate(ang);
  rr(c, -s * 0.5, -s * 0.35, s * 1.1, s * 0.7, s * 0.3); c.fillStyle = SKIN; c.fill();
  c.fillStyle = SKIN_D; for (let i = 0; i < 4; i++) { rr(c, -s * 0.62, -s * 0.33 + i * s * 0.17, s * 0.3, s * 0.13, s * 0.06); c.fill(); }
  rr(c, s * 0.5, -s * 0.28, s * 1.3, s * 0.56, s * 0.25); c.fillStyle = SKIN; c.fill();
  c.restore();
}

function vanity(c, W, H) {
  c.fillStyle = lin(c, 0, 0, 0, H, [[0, "#f3ebe1"], [0.6, "#e9dccb"], [1, "#e2d2bd"]]); c.fillRect(0, 0, W, H);
  c.strokeStyle = "#c9a96e"; c.lineWidth = W * 0.012; c.fillStyle = "rgba(255,255,255,0.5)";
  c.beginPath(); c.arc(W * 0.78, H * 0.22, W * 0.24, 0, Math.PI * 2); c.fill(); c.stroke();
  c.fillStyle = lin(c, 0, H * 0.62, 0, H, [[0, "#dcc4a3"], [1, "#c7ab86"]]); c.fillRect(0, H * 0.62, W, H * 0.38);
  c.fillStyle = "rgba(255,255,255,0.25)"; c.fillRect(0, H * 0.62, W, 5);
  c.fillStyle = "#b9c9a7"; c.beginPath(); c.ellipse(W * 0.12, H * 0.5, W * 0.06, H * 0.08, 0, 0, Math.PI * 2); c.fill();
  rr(c, W * 0.08, H * 0.55, W * 0.08, H * 0.08, 8); c.fillStyle = "#efe8dd"; c.fill();
}

const LIQUID = { citrus: "rgba(242,215,120,0.55)", greentea: "rgba(196,219,150,0.55)", mini: "rgba(236,200,170,0.55)" };
const LABEL = { citrus: "citrus woody · 30mL", greentea: "green tea musk · 30mL", mini: "mini · 5mL" };

function bottle(c, cx, by, s, product = "citrus") {
  const w = s, h = s * 1.12, x = cx - w / 2, y = by - h;
  c.save();
  c.fillStyle = "rgba(0,0,0,0.12)"; c.beginPath(); c.ellipse(cx, by + 4, w * 0.62, s * 0.07, 0, 0, Math.PI * 2); c.fill();
  rr(c, cx - s * 0.12, y - s * 0.12, s * 0.24, s * 0.14, 3); c.fillStyle = "rgba(230,230,230,0.9)"; c.fill();
  rr(c, cx - s * 0.21, y - s * 0.5, s * 0.42, s * 0.4, s * 0.04); c.fillStyle = lin(c, cx - s * 0.21, 0, cx + s * 0.21, 0, [[0, "#111"], [0.45, "#3a3a3c"], [1, "#121214"]]); c.fill();
  rr(c, x, y, w, h, s * 0.08); c.fillStyle = "rgba(255,255,255,0.38)"; c.fill(); c.strokeStyle = "rgba(110,110,110,0.55)"; c.lineWidth = Math.max(2, s * 0.02); c.stroke();
  rr(c, x + s * 0.06, y + h * 0.28, w - s * 0.12, h * 0.66, s * 0.05); c.fillStyle = LIQUID[product] ?? LIQUID.citrus; c.fill();
  c.fillStyle = "rgba(255,255,255,0.55)"; c.fillRect(x + s * 0.1, y + s * 0.08, s * 0.06, h * 0.8);
  rr(c, cx - s * 0.3, y + h * 0.42, s * 0.6, s * 0.3, 3); c.fillStyle = "#fbfbf8"; c.fill();
  c.fillStyle = "#3b3b3b"; c.textAlign = "center"; c.font = "700 " + Math.round(s * 0.1) + "px " + FONT; c.fillText("ONSCENT", cx, y + h * 0.42 + s * 0.14);
  c.font = Math.round(s * 0.055) + "px " + FONT; c.fillStyle = "#777"; c.fillText(LABEL[product] ?? LABEL.citrus, cx, y + h * 0.42 + s * 0.24);
  c.restore();
}

function box(c, x, y, w, h, lid = 0) {
  c.save();
  c.fillStyle = "rgba(0,0,0,0.1)"; c.fillRect(x + 8, y + 10, w, h);
  c.fillStyle = lin(c, x, 0, x + w, 0, [[0, "#f4ecdf"], [1, "#e7dccb"]]); c.fillRect(x, y, w, h);
  c.fillStyle = "#efe5d4"; c.fillRect(x, y - h * 0.06 - lid * h * 0.25, w, h * 0.08);
  c.fillStyle = "#8b7355"; c.textAlign = "center"; c.font = "600 " + Math.round(w * 0.11) + "px " + FONT; c.fillText("ONSCENT", x + w / 2, y + h * 0.42);
  c.font = Math.round(w * 0.06) + "px " + FONT; c.fillStyle = "#a08a6c"; c.fillText("eau de parfum", x + w / 2, y + h * 0.52);
  c.restore();
}

function mist(c, x, y, t, dir = 1) {
  const r = rng(3);
  for (let i = 0; i < 60; i++) { const ph = (t * 1.4 + r()) % 1; c.fillStyle = "rgba(255,255,255," + (0.7 - ph * 0.7) + ")"; c.beginPath(); c.arc(x + dir * ph * 160 + (r() - 0.5) * 30 * ph, y + (r() - 0.5) * 90 * ph, 2 + r() * 4, 0, Math.PI * 2); c.fill(); }
}

// ---- 물건 (쇼핑 영상 · 고객사 사진) ------------------------------------------

function item(c, W, H, t, opt) {
  const hue = opt.hue ?? 200, kind = opt.item ?? "box", s = Math.min(W, H);
  c.fillStyle = lin(c, 0, 0, 0, H, [[0, hsl(hue, 30, 95)], [1, hsl(hue, 22, 84)]]); c.fillRect(0, 0, W, H);
  c.fillStyle = hsl(hue, 18, 78); c.fillRect(0, H * 0.66, W, H * 0.34);
  c.fillStyle = "rgba(255,255,255,0.35)"; c.fillRect(0, H * 0.66, W, 4);
  const cx = W / 2, by = H * 0.7, wob = Math.sin(t * 2);
  c.save();
  if (kind === "basket") {
    const hh = s * (0.42 - 0.24 * (0.5 - 0.5 * Math.cos(t * 1.2))), ww = s * 0.5;
    for (let i = 0; i < 9; i++) { rr(c, cx - ww / 2, by - hh + (i * hh) / 9, ww, hh / 9 - 3, 8); c.fillStyle = i % 2 ? "#d9dde0" : "#f3f4f5"; c.fill(); }
    c.strokeStyle = "#8a9197"; c.lineWidth = 8; c.beginPath(); c.arc(cx, by - hh, ww * 0.18, Math.PI, 0); c.stroke();
  } else if (kind === "slimbox") {
    c.fillStyle = "#fafafa"; rr(c, -20, by - s * 0.55, W * 0.62, s * 0.5, 30); c.fill();
    c.fillStyle = hsl(hue, 40, 70); rr(c, -20, by - s * 0.6, W * 0.62, s * 0.14, 30); c.fill();
    const off = (0.5 - 0.5 * Math.cos(t * 1.3)) * W * 0.25;
    rr(c, W * 0.6 - off, by - s * 0.42, W * 0.36, s * 0.4, 14); c.fillStyle = "rgba(255,255,255,0.55)"; c.fill(); c.strokeStyle = "rgba(90,110,130,0.6)"; c.lineWidth = 4; c.stroke();
    ["#e98a7a", "#7bb3e0", "#f2d17b"].forEach((col, i) => { c.fillStyle = col; rr(c, W * 0.63 - off + i * W * 0.1, by - s * 0.3, W * 0.08, s * 0.24, 8); c.fill(); });
  } else if (kind === "cable") {
    c.fillStyle = "#c8a77f"; c.fillRect(0, H * 0.55, W, H * 0.45);
    const k = Math.min(1, Math.max(0, (t % 6) / 3 - 0.3));
    ["#222", "#e5533d", "#3d8be5", "#f5f5f5"].forEach((col, i) => { c.strokeStyle = col; c.lineWidth = 12; c.beginPath(); const y = H * 0.62 + i * 26; c.moveTo(W * 0.08, y); c.bezierCurveTo(W * 0.35, y - 160 * (1 - k) * (i % 2 ? 1 : -1), W * 0.6, y + 140 * (1 - k), W * 0.92, y); c.stroke(); });
    rr(c, cx - s * 0.12, H * 0.6, s * 0.24, s * 0.12, 18); c.fillStyle = hsl(hue, 40, 45); c.fill();
  } else if (kind === "organizer") {
    const f = 0.5 - 0.5 * Math.cos(t * 1.1), hh = s * (0.38 - 0.28 * f);
    rr(c, cx - s * 0.3, by - hh, s * 0.6, hh, 16); c.fillStyle = hsl(hue, 42, 62); c.fill();
    c.fillStyle = hsl(hue, 42, 52); c.fillRect(cx - s * 0.3, by - hh, s * 0.6, 14);
    rr(c, cx - s * 0.08, by - hh + hh * 0.3, s * 0.16, 20, 10); c.fillStyle = hsl(hue, 30, 40); c.fill();
  } else if (kind === "asmr") {
    rr(c, cx - s * 0.4, by - s * 0.35, s * 0.8, s * 0.4, 18); c.fillStyle = "#f2efe9"; c.fill();
    for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) { rr(c, cx - s * 0.37 + i * s * 0.25, by - s * 0.32 + j * s * 0.18, s * 0.22, s * 0.15, 10); c.strokeStyle = "#cfc8bc"; c.lineWidth = 4; c.stroke(); c.fillStyle = ["#f0b7a4", "#a9cbe8", "#f3d88f", "#b8dcb0", "#d9c2ef", "#f2c6d9"][i * 2 + j]; rr(c, cx - s * 0.34 + i * s * 0.25, by - s * 0.29 + j * s * 0.18, s * 0.16, s * 0.09, 8); c.fill(); }
    hand(c, cx + s * 0.2 + Math.sin(t * 2.4) * s * 0.12, by - s * 0.45, s * 0.14, 2.6);
  } else if (kind === "tray") {
    c.fillStyle = "#f7fbfc"; c.fillRect(W * 0.06, H * 0.08, W * 0.88, H * 0.8); c.strokeStyle = "#d6e4ea"; c.lineWidth = 6;
    for (let i = 1; i < 4; i++) { c.beginPath(); c.moveTo(W * 0.06, H * 0.08 + i * H * 0.2); c.lineTo(W * 0.94, H * 0.08 + i * H * 0.2); c.stroke(); }
    const off = (0.5 - 0.5 * Math.cos(t * 1.2)) * H * 0.08;
    rr(c, W * 0.14, H * 0.5 + off, W * 0.72, H * 0.12, 16); c.fillStyle = "rgba(200,230,240,0.7)"; c.fill(); c.strokeStyle = "#9cc3d0"; c.stroke();
    ["#f4a259", "#5b8e7d", "#e76f51"].forEach((col, i) => { c.fillStyle = col; rr(c, W * 0.2 + i * W * 0.2, H * 0.52 + off, W * 0.14, H * 0.08, 10); c.fill(); });
  } else if (kind === "spice") {
    c.save(); c.translate(cx, by - s * 0.22); c.rotate(t * 0.6);
    c.fillStyle = "#e9e3d8"; c.beginPath(); c.arc(0, 0, s * 0.26, 0, Math.PI * 2); c.fill();
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; rr(c, Math.cos(a) * s * 0.18 - 22, Math.sin(a) * s * 0.18 - 30, 44, 60, 10); c.fillStyle = ["#c0392b", "#e67e22", "#7f8c8d", "#27ae60"][i % 4]; c.fill(); }
    c.restore();
  } else if (kind === "clip") {
    rr(c, cx - s * 0.16, by - s * 0.18, s * 0.32, s * 0.18, 24); c.fillStyle = hsl(hue, 45, 48); c.fill();
    c.strokeStyle = "#9aa1a7"; c.lineWidth = 14; c.lineCap = "round"; c.beginPath(); c.moveTo(cx - s * 0.05, by - s * 0.15); c.lineTo(cx - s * 0.2, by - s * 0.55 + wob * 8); c.stroke();
    c.strokeStyle = "#333"; c.beginPath(); c.moveTo(cx + s * 0.05, by - s * 0.15); c.lineTo(cx + s * 0.22, by - s * 0.5); c.stroke();
  } else if (kind === "brush") {
    c.fillStyle = "#cfd6dc"; c.fillRect(W * 0.1, by - s * 0.1, W * 0.8, s * 0.06);
    const x = W * 0.2 + ((t * 0.25) % 1) * W * 0.55;
    rr(c, x, by - s * 0.42, s * 0.06, s * 0.28, 12); c.fillStyle = hsl(hue, 70, 55); c.fill();
    c.fillStyle = "#3d3d3d"; c.fillRect(x - 6, by - s * 0.14, s * 0.06 + 12, s * 0.05);
    const r = rng(5); c.fillStyle = "rgba(120,110,100,0.5)"; for (let i = 0; i < 30; i++) c.fillRect(W * 0.1 + r() * W * 0.8, by - s * 0.09 + r() * 10, 4, 4);
  } else if (kind === "pouch") {
    const k = 0.5 - 0.5 * Math.cos(t * 1.3), hh = s * (0.3 - 0.12 * k);
    rr(c, cx - s * 0.3, by - hh, s * 0.6, hh, 28); c.fillStyle = hsl(hue, 40, 55); c.fill();
    c.strokeStyle = "#e8e8e8"; c.lineWidth = 6; c.beginPath(); c.moveTo(cx - s * 0.27, by - hh + 18); c.lineTo(cx + s * 0.27, by - hh + 18); c.stroke();
  } else if (kind === "shoes") {
    for (let j = 0; j < 3; j++) { rr(c, cx - s * 0.3, by - (j + 1) * s * 0.17, s * 0.6, s * 0.15, 10); c.fillStyle = "rgba(255,255,255,0.55)"; c.fill(); c.strokeStyle = "rgba(100,120,140,0.5)"; c.lineWidth = 4; c.stroke();
      c.fillStyle = ["#e76f51", "#264653", "#e9c46a"][j]; c.beginPath(); c.ellipse(cx, by - (j + 0.5) * s * 0.17, s * 0.18, s * 0.045, 0, 0, Math.PI * 2); c.fill(); }
  } else if (kind === "lamp") {
    const g = c.createRadialGradient(cx, by - s * 0.3, 10, cx, by - s * 0.3, s * 0.6); g.addColorStop(0, "rgba(255,214,140,0.8)"); g.addColorStop(1, "rgba(255,214,140,0)"); c.fillStyle = g; c.fillRect(0, 0, W, H);
    c.fillStyle = "#fff4dc"; c.beginPath(); c.arc(cx, by - s * 0.3, s * 0.14, 0, Math.PI * 2); c.fill(); rr(c, cx - s * 0.12, by - s * 0.16, s * 0.24, s * 0.14, 12); c.fillStyle = "#c9b79c"; c.fill();
  } else if (kind === "shelf") {
    c.fillStyle = "#3c3c3c"; c.fillRect(cx - s * 0.32, by - s * 0.6, 10, s * 0.6); c.fillRect(cx + s * 0.32 - 10, by - s * 0.6, 10, s * 0.6);
    for (let j = 0; j < 3; j++) { c.fillStyle = "#d9c7a8"; c.fillRect(cx - s * 0.32, by - (j + 1) * s * 0.2, s * 0.64, 12); c.fillStyle = ["#7fb3d5", "#f5b041", "#82e0aa"][j]; rr(c, cx - s * 0.2 + j * 40, by - (j + 1) * s * 0.2 - s * 0.1, s * 0.14, s * 0.1, 8); c.fill(); }
  } else {
    rr(c, cx - s * 0.2, by - s * 0.3, s * 0.4, s * 0.3, 20); c.fillStyle = hsl(hue, 40, 55); c.fill();
  }
  c.restore();
}

// ---- 장면 ---------------------------------------------------------------

function scene(c, W, H, name, t, sec, opt) {
  const k = sec ? t / sec : 0, product = opt.product ?? "citrus";
  switch (name) {
    case "sink-splash": {
      kitchen(c, W, H); guard(c, W * 0.5, H * 0.67, W * 0.7, H * 0.09, 0, 0.8); water(c, W, H, t, W * 0.55, H * 0.36, H * 0.62, 1.2); break;
    }
    case "sink-apron": {
      kitchen(c, W, H); c.fillStyle = "rgba(255,255,255,0.25)"; c.fillRect(0, 0, W, H);
      rr(c, W * 0.2, H * 0.1, W * 0.6, H * 0.72, W * 0.12); c.fillStyle = "#dcc6a7"; c.fill();
      c.strokeStyle = "#c2a982"; c.lineWidth = 10; c.beginPath(); c.moveTo(W * 0.32, H * 0.1); c.lineTo(W * 0.38, 0); c.moveTo(W * 0.68, H * 0.1); c.lineTo(W * 0.62, 0); c.stroke();
      rr(c, W * 0.36, H * 0.42, W * 0.28, H * 0.12, 16); c.strokeStyle = "#c9b08d"; c.lineWidth = 5; c.stroke();
      const r = rng(9); c.fillStyle = "rgba(125,98,70," + (0.25 + 0.25 * k) + ")";
      for (let i = 0; i < 9; i++) { c.beginPath(); c.ellipse(W * (0.3 + r() * 0.4), H * (0.55 + r() * 0.2), W * (0.03 + r() * 0.05) * (0.6 + k), H * (0.015 + r() * 0.02) * (0.6 + k), r(), 0, Math.PI * 2); c.fill(); }
      c.fillStyle = "#fafafa"; c.beginPath(); c.ellipse(W * 0.5, H * 0.66, W * 0.2, H * 0.03, 0, 0, Math.PI * 2); c.fill();
      hand(c, W * 0.3, H * 0.66, W * 0.1, 0.2); hand(c, W * 0.7, H * 0.66, W * 0.1, Math.PI - 0.2);
      guard(c, W * 0.5, H * 0.99, W * 0.9, H * 0.1, 0, 0.5); break;
    }
    case "sink-fold": {
      kitchen(c, W, H); const f = 0.5 - 0.5 * Math.cos((t / 6) * Math.PI * 2), w = W * 0.7 * (1 - 0.72 * f);
      guard(c, W * 0.5, H * 0.67, W * 0.7, H * 0.09, f, 0.3); hand(c, W * 0.5 + w / 2 + W * 0.04, H * 0.62, W * 0.09, Math.PI); break;
    }
    case "sink-detail": {
      c.fillStyle = lin(c, 0, 0, 0, H, [[0, "#f4f4f2"], [1, "#dcdcd8"]]); c.fillRect(0, 0, W, H);
      rr(c, W * 0.04, H * 0.62, W * 0.92, H * 0.4, 40); c.fillStyle = lin(c, 0, H * 0.62, 0, H, [[0, "#c5cbd0"], [1, "#8d959c"]]); c.fill();
      guard(c, W * 0.5, H * 0.62, W * 0.86, H * 0.3, 0.05 * Math.sin(t), 0.9);
      c.strokeStyle = "#e5533d"; c.lineWidth = 5; c.beginPath(); c.moveTo(W * 0.07, H * 0.27); c.lineTo(W * 0.93, H * 0.27); c.stroke();
      c.beginPath(); c.moveTo(W * 0.95, H * 0.32); c.lineTo(W * 0.95, H * 0.62); c.stroke();
      c.fillStyle = "#e5533d"; c.font = "700 " + Math.round(W * 0.06) + "px " + FONT; c.textAlign = "center"; c.fillText("40cm", W * 0.5, H * 0.25);
      c.save(); c.translate(W * 0.9, H * 0.47); c.rotate(-Math.PI / 2); c.fillText("10cm", 0, 0); c.restore();
      hand(c, W * 0.2, H * 0.72 + Math.sin(t * 2) * 6, W * 0.11, 0.3); break;
    }
    case "perfume-vanity": {
      vanity(c, W, H); box(c, W * 0.12, H * 0.42, W * 0.32, H * 0.2); bottle(c, W * 0.6, H * 0.7, W * 0.26, product);
      const g = c.createLinearGradient(0, 0, W, H); g.addColorStop(Math.max(0, k - 0.2), "rgba(255,250,235,0)"); g.addColorStop(k, "rgba(255,250,235,0.35)"); g.addColorStop(Math.min(1, k + 0.2), "rgba(255,250,235,0)"); c.fillStyle = g; c.fillRect(0, 0, W, H); break;
    }
    case "perfume-wrist": {
      vanity(c, W, H); bottle(c, W * 0.32, H * 0.6, W * 0.24, product); hand(c, W * 0.3, H * 0.55, W * 0.12, -0.3);
      c.save(); c.translate(W * 0.78, H * 0.48); c.rotate(-0.15); rr(c, -W * 0.08, -H * 0.03, W * 0.5, H * 0.07, H * 0.035); c.fillStyle = SKIN; c.fill(); c.restore();
      mist(c, W * 0.38, H * 0.43, t, 1); break;
    }
    case "perfume-box": {
      c.save(); const z = 1 + 0.05 * k; c.translate(W / 2, H / 2); c.scale(z, z); c.translate(-W / 2, -H / 2);
      vanity(c, W, H); box(c, W * 0.1, H * 0.38, W * 0.42, H * 0.26, 0.4); bottle(c, W * 0.66, H * 0.72, W * 0.34, product); c.restore(); break;
    }
    case "perfume-desk": {
      c.fillStyle = lin(c, 0, 0, 0, H, [[0, "#eef0f3"], [1, "#dde1e6"]]); c.fillRect(0, 0, W, H);
      c.fillStyle = "#cfd4da"; c.fillRect(0, H * 0.62, W, H * 0.38);
      c.fillStyle = "#2f3640"; rr(c, W * 0.06, H * 0.36, W * 0.5, H * 0.26, 12); c.fill(); c.fillStyle = "#3e5266"; c.fillRect(W * 0.09, H * 0.38, W * 0.44, H * 0.22);
      c.fillStyle = "#9aa4ae"; c.fillRect(W * 0.02, H * 0.62, W * 0.58, 10);
      rr(c, W * 0.66, H * 0.54, W * 0.12, H * 0.08, 10); c.fillStyle = "#fff"; c.fill();
      bottle(c, W * 0.78 - Math.max(0, 1 - k * 2) * W * 0.1, H * 0.72, W * 0.2, product); break;
    }
    case "perfume-walk": {
      c.fillStyle = lin(c, 0, 0, 0, H, [[0, "#e3f0f8"], [0.55, "#d6ead6"], [1, "#b9d4a8"]]); c.fillRect(0, 0, W, H);
      [[0.15, 0.35, 0.18], [0.85, 0.3, 0.22], [0.5, 0.25, 0.14]].forEach(([x, y, r]) => { c.fillStyle = "#8fbf7a"; c.beginPath(); c.arc(W * x, H * y, W * r, 0, Math.PI * 2); c.fill(); });
      c.fillStyle = "#e9dcc3"; c.beginPath(); c.moveTo(W * 0.42, H * 0.55); c.lineTo(W * 0.58, H * 0.55); c.lineTo(W * 0.9, H); c.lineTo(W * 0.1, H); c.fill();
      bottle(c, W * 0.55, H * 0.8 + Math.sin(t * 3) * 6, W * 0.22, product); hand(c, W * 0.55, H * 0.78, W * 0.12, -1.4); break;
    }
    case "perfume-gift": {
      vanity(c, W, H); rr(c, W * 0.12, H * 0.5, W * 0.76, H * 0.16, 12); c.fillStyle = "#f1e5d1"; c.fill();
      c.fillStyle = "#cfae80"; c.fillRect(W * 0.47, H * 0.5, W * 0.06, H * 0.16);
      ["citrus", "greentea", "mini", "citrus"].forEach((p, i) => bottle(c, W * (0.24 + i * 0.17), H * 0.62, W * 0.1, p));
      c.fillStyle = "#e3c9a1"; c.beginPath(); c.ellipse(W * 0.5, H * 0.48 - 8 * Math.sin(t * 2), W * 0.12, H * 0.025, 0, 0, Math.PI * 2); c.fill(); break;
    }
    case "perfume-trio": {
      vanity(c, W, H); ["citrus", "greentea", "mini"].forEach((p, i) => bottle(c, W * (0.25 + i * 0.25), H * 0.72 - (i === 1 ? 10 : 0), W * 0.18, p)); break;
    }
    case "perfume-product": {
      c.fillStyle = lin(c, 0, 0, 0, H, [[0, "#f8f4ee"], [1, "#e9e0d2"]]); c.fillRect(0, 0, W, H);
      const a = opt.angle ?? 0;
      if (product === "mini") {
        rr(c, W * 0.12, H * 0.45, W * 0.76, H * 0.24, 14); c.fillStyle = "#f1e5d1"; c.fill(); c.fillStyle = "#cfae80"; c.fillRect(W * 0.12, H * 0.54, W * 0.76, H * 0.04);
        ["citrus", "greentea", "mini", "citrus"].forEach((p, i) => bottle(c, W * (0.24 + i * 0.17), H * (a === 2 ? 0.5 : 0.62), W * 0.11, p));
      } else if (a === 1) { box(c, W * 0.12, H * 0.35, W * 0.4, H * 0.42); bottle(c, W * 0.7, H * 0.8, W * 0.3, product); }
      else if (a === 2) { hand(c, W * 0.42, H * 0.8, W * 0.16, -0.25); bottle(c, W * 0.5, H * 0.74, W * 0.32, product); }
      else bottle(c, W * 0.5, H * 0.8, W * 0.42, product);
      break;
    }
    case "item": item(c, W, H, t, opt); break;
    default: c.fillStyle = "#ddd"; c.fillRect(0, 0, W, H);
  }
}

function subtitle(c, W, H, text) {
  c.save(); c.font = "700 " + Math.round(W * 0.048) + "px " + FONT; c.textAlign = "center"; c.textBaseline = "middle";
  const words = text.split(" "), lines = []; let cur = "";
  for (const w of words) { const n = cur ? cur + " " + w : w; if (c.measureText(n).width > W * 0.82 && cur) { lines.push(cur); cur = w; } else cur = n; }
  if (cur) lines.push(cur);
  const lh = W * 0.065, bh = lines.length * lh + W * 0.04, y0 = H * 0.76;
  const bw = Math.min(W * 0.9, Math.max(...lines.map((l) => c.measureText(l).width)) + W * 0.08);
  rr(c, (W - bw) / 2, y0 - bh / 2, bw, bh, 18); c.fillStyle = "rgba(0,0,0,0.62)"; c.fill();
  c.fillStyle = "#fff"; lines.forEach((l, i) => c.fillText(l, W / 2, y0 - bh / 2 + W * 0.02 + lh * (i + 0.5)));
  c.restore();
}

function band(c, W, H, text) {
  c.save(); c.font = "600 " + Math.round(W * 0.028) + "px " + FONT; c.textAlign = "center"; c.textBaseline = "middle";
  const bw = Math.min(W * 0.94, c.measureText(text).width + W * 0.06);
  rr(c, (W - bw) / 2, H * 0.035, bw, W * 0.06, 12); c.fillStyle = "rgba(0,0,0,0.58)"; c.fill(); c.fillStyle = "#fff"; c.fillText(text, W / 2, H * 0.035 + W * 0.03); c.restore();
}

function marks(c, W, H, mark, watermark) {
  c.save(); c.font = "600 " + Math.round(W * 0.026) + "px " + FONT; c.textBaseline = "top"; c.shadowColor = "rgba(0,0,0,0.45)"; c.shadowBlur = 4;
  c.fillStyle = "rgba(255,255,255,0.9)"; c.textAlign = "right"; c.fillText("목업 예시" + (mark ? " · " + mark : ""), W * 0.96, H * 0.105);
  if (watermark) { c.textAlign = "right"; c.textBaseline = "bottom"; c.fillText(watermark, W * 0.95, H * 0.97); }
  c.restore();
}

// ---- 만들기 ----------------------------------------------------------------

async function toB64(blob) {
  const buf = new Uint8Array(await blob.arrayBuffer()); let s = "";
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
}

window.makeAsset = async (d, withAudio) => {
  if (d.type === "image") {
    const cv = new OffscreenCanvas(d.w, d.h), c = cv.getContext("2d");
    if (d.w > d.h * 1.2) { // 가로 썸네일 — 세로 장면의 가운데를 잘라 쓴다
      const pw = d.w, ph = Math.round(d.w * 16 / 9), pc = new OffscreenCanvas(pw, ph), pctx = pc.getContext("2d");
      scene(pctx, pw, ph, d.scene, 1.2, 4, d.opt || {});
      c.drawImage(pc, 0, (ph - d.h) / 2, pw, d.h, 0, 0, d.w, d.h);
    } else scene(c, d.w, d.h, d.scene, 1.2, 4, d.opt || {});
    marks(c, d.w, d.h, "", "");
    return toB64(await cv.convertToBlob({ type: "image/jpeg", quality: 0.86 }));
  }
  const cv = new OffscreenCanvas(d.w, d.h), c = cv.getContext("2d");
  const out = new Output({ format: new Mp4OutputFormat({ fastStart: "in-memory" }), target: new BufferTarget() });
  const vs = new CanvasSource(cv, { codec: "avc", bitrate: withAudio ? 900_000 : 600_000, keyFrameInterval: 1 });
  out.addVideoTrack(vs, { frameRate: d.fps });
  const total = d.parts.reduce((n, p) => n + p.sec, 0);
  let as = null;
  if (withAudio) { as = new AudioBufferSource({ codec: "aac", bitrate: 64_000 }); out.addAudioTrack(as); }
  await out.start();
  if (as) await as.add(new AudioBuffer({ numberOfChannels: 1, length: Math.round(48_000 * total), sampleRate: 48_000 }));
  const frames = Math.round(total * d.fps);
  for (let f = 0; f < frames; f++) {
    const t = f / d.fps; let acc = 0, part = d.parts[d.parts.length - 1];
    for (const p of d.parts) { if (t < acc + p.sec) { part = p; break; } acc += p.sec; }
    if (part === d.parts[d.parts.length - 1] && t >= acc + part.sec) acc = total - part.sec;
    c.save(); scene(c, d.w, d.h, part.scene, t - acc, part.sec, part.opt || {}); c.restore();
    const cue = (d.cues || []).find((x) => t >= x.start && t < x.end);
    if (cue) subtitle(c, d.w, d.h, cue.text);
    if (d.overlay) band(c, d.w, d.h, d.overlay);
    marks(c, d.w, d.h, d.mark || "", (part.opt || {}).watermark || "");
    await vs.add(t, 1 / d.fps);
  }
  await out.finalize();
  return toB64(new Blob([out.target.buffer]));
};
`;
}
