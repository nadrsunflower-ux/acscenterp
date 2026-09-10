// 특정 경로의 좁은 화면에서 어떤 요소가 가로로 넘치는지 찾는다: node e2e/overflow.mjs /neander 390
import { chromium } from "@playwright/test";
import { PROFILE_DIR, BASE_URL } from "./profile.mjs";
const route = process.argv[2] || "/neander";
const width = Number(process.argv[3] || 390);
const ctx = await chromium.launchPersistentContext(PROFILE_DIR, { headless: true, viewport: { width, height: 844 } });
const page = await ctx.newPage();
await page.goto(`${BASE_URL}${route}`, { waitUntil: "load" });
await page.waitForSelector("[data-nd-topbar], [data-nd-status]", { timeout: 40000 }).catch(() => {});
await page.waitForFunction(() => !/(불러오는|만드는|여는|확인) 중/.test(document.body.innerText), null, { timeout: 40000 }).catch(() => {});
await page.waitForTimeout(800);
const out = await page.evaluate((w) => {
  const rows = [`doc scrollW=${document.documentElement.scrollWidth} body scrollW=${document.body.scrollWidth} clientW=${document.documentElement.clientWidth}`];
  for (const el of document.querySelectorAll("body *")) {
    if (el.scrollWidth > el.clientWidth + 2 && getComputedStyle(el).overflowX === "visible") {
      const r = el.getBoundingClientRect();
      const cls = typeof el.className === "string" ? el.className.slice(0, 80) : "";
      rows.push(`OVERFLOWING-CONTENT ${el.tagName.toLowerCase()} sw=${el.scrollWidth} cw=${el.clientWidth} right=${Math.round(r.right)} ${cls}`);
      if (rows.length > 12) break;
    }
  }
  for (const el of document.querySelectorAll("body *")) {
    const r = el.getBoundingClientRect();
    if (r.right > w + 1 && r.width > 0) {
      const cls = (el.className && typeof el.className === "string") ? el.className.slice(0, 90) : "";
      rows.push(`${el.tagName.toLowerCase()} right=${Math.round(r.right)} w=${Math.round(r.width)} ${cls}`);
    }
    if (rows.length > 25) break;
  }
  return rows;
}, width);
console.log(out.join("\n"));
await ctx.close();
