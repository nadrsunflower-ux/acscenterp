// ============================================================
//  상호작용 점검 — 메뉴·대화상자·패널이 열리고 닫히는지 (읽기 전용)
// ------------------------------------------------------------
//  `node e2e/flows.mjs` → e2e/shots/flows/*.png + 콘솔 요약.
//  저장·확정·삭제 버튼은 절대 누르지 않는다. 대화상자는 Esc 로만 닫는다.
// ============================================================
import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";
import { PROFILE_DIR, BASE_URL } from "./profile.mjs";

const out = "e2e/shots/flows";
fs.mkdirSync(out, { recursive: true });
const ctx = await chromium.launchPersistentContext(PROFILE_DIR, { headless: true, viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const results = [];
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 200)));

const settle = async () => {
  await page.waitForSelector("[data-nd-topbar], [data-nd-status]", { timeout: 45000 }).catch(() => {});
  await page.waitForFunction(() => !/(불러오는|만드는|여는|확인) 중/.test(document.body.innerText), null, { timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(500);
};
const shot = (name) => page.screenshot({ path: path.join(out, `${name}.png`) });
const step = async (name, fn) => {
  try {
    await fn();
    results.push(`OK   ${name}`);
  } catch (e) {
    results.push(`FAIL ${name}: ${String(e).split("\n")[0].slice(0, 160)}`);
    await shot(`${name}-FAIL`).catch(() => {});
  }
};
const expectVisible = async (loc, what) => {
  if (!(await loc.first().isVisible().catch(() => false))) throw new Error(`${what} 이(가) 보이지 않음`);
};
const expectHidden = async (loc, what) => {
  await page.waitForTimeout(250);
  if (await loc.first().isVisible().catch(() => false)) throw new Error(`${what} 이(가) 닫히지 않음`);
};

// ---- 셸 -------------------------------------------------------
await page.goto(`${BASE_URL}/neander`, { waitUntil: "load" });
await settle();
await step("shell: 사이드바 접기/펼치기", async () => {
  const btn = page.getByRole("button", { name: /사이드바 접기/ }).first();
  await btn.click();
  await page.waitForTimeout(300);
  await shot("shell-collapsed");
  await expectVisible(page.getByRole("button", { name: /사이드바 펼치기/ }), "펼치기 버튼");
  await page.getByRole("button", { name: /사이드바 펼치기/ }).first().click();
  await page.waitForTimeout(300);
});
await step("shell: 워크스페이스 메뉴 열기 → Esc 닫기 → 포커스 복귀", async () => {
  const ws = page.getByRole("button", { name: /전체 ERP/ }).first();
  await ws.click();
  const menu = page.getByRole("menu", { name: "워크스페이스 선택" });
  await expectVisible(menu, "워크스페이스 메뉴");
  await shot("shell-workspace-menu");
  await page.keyboard.press("Escape");
  await expectHidden(menu, "워크스페이스 메뉴");
  const focused = await page.evaluate(() => document.activeElement?.textContent?.trim());
  if (!focused?.includes("전체 ERP")) throw new Error(`포커스가 돌아오지 않음: ${focused}`);
});
await step("shell: 사용자 메뉴", async () => {
  await page.getByRole("button", { name: /메뉴$/ }).last().click().catch(async () => {
    // aria-label 이 없는 펼침 상태: 이름 버튼
    await page.locator('[data-nd-sidebar] button[aria-haspopup="menu"]').last().click();
  });
  const menu = page.getByRole("menu", { name: "사용자 메뉴" });
  await expectVisible(menu, "사용자 메뉴");
  await expectVisible(menu.getByRole("menuitem", { name: "로그아웃" }), "로그아웃 항목");
  await shot("shell-user-menu");
  await page.keyboard.press("Escape");
  await expectHidden(menu, "사용자 메뉴");
});

// ---- 재무 원장 -------------------------------------------------
await page.goto(`${BASE_URL}/neander/finance/ledger`, { waitUntil: "load" });
await settle();
await step("ledger: 머리글 정렬·필터 팝오버", async () => {
  const btn = page.getByRole("button", { name: /거래처 정렬·필터/ }).first();
  await btn.click();
  const pop = page.getByRole("dialog").first();
  await expectVisible(pop, "열 메뉴");
  await shot("ledger-column-menu");
  await page.keyboard.press("Escape");
  await expectHidden(pop, "열 메뉴");
});
await step("ledger: 결제수단 탭 전환", async () => {
  await page.getByRole("tab", { name: /^계좌/ }).click();
  await page.waitForTimeout(400);
  const sel = await page.getByRole("tab", { selected: true }).textContent();
  if (!sel?.includes("계좌")) throw new Error(`선택 탭: ${sel}`);
  await shot("ledger-tab-account");
  await page.getByRole("tab", { name: /^전체/ }).click();
});
await step("ledger: 검색 입력 → 건수 변화", async () => {
  const before = await page.locator("text=검색 결과").first().textContent();
  await page.getByRole("searchbox", { name: "거래 검색" }).fill("쿠팡");
  await page.waitForTimeout(600);
  const after = await page.locator("text=검색 결과").first().textContent();
  if (before === after) throw new Error("검색 결과가 바뀌지 않음");
  await shot("ledger-search");
  await page.getByRole("searchbox", { name: "거래 검색" }).fill("");
});

// ---- 검토 대기함 -----------------------------------------------
await page.goto(`${BASE_URL}/neander/finance/review`, { waitUntil: "load" });
await settle();
await step("review: j/k 이동 후 E 로 상세 대화상자 → Esc", async () => {
  for (const k of ["j", "j", "k", "e"]) {
    await page.keyboard.press(k);
    await page.waitForTimeout(150);
  }
  await page.waitForTimeout(400);
  const dlg = page.getByRole("dialog").first();
  await expectVisible(dlg, "거래 편집 대화상자");
  await shot("review-editor");
  const inside = await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'));
  if (!inside) throw new Error("포커스가 대화상자 안에 없음");
  await page.keyboard.press("Escape");
  await expectHidden(dlg, "거래 편집 대화상자");
});
await step("review: 체크 → 일괄 바 표시", async () => {
  await page.getByRole("checkbox", { name: "선택" }).first().check();
  await page.waitForTimeout(300);
  await expectVisible(page.locator("text=건 선택됨"), "일괄 처리 바");
  await shot("review-bulk-bar");
  await page.getByRole("checkbox", { name: "선택" }).first().uncheck();
});

// ---- 재무 비서 -------------------------------------------------
await page.goto(`${BASE_URL}/neander/finance`, { waitUntil: "load" });
await settle();
await step("chat: 열기 → 도킹 패널 → 닫기", async () => {
  await page.getByRole("button", { name: "재무 비서 열기" }).click({ timeout: 8000 }).catch(async (e) => {
    console.log("CHAT CLICK ERR:\n" + String(e).slice(0, 700));
    throw e;
  });
  await page.waitForTimeout(500);
  await expectVisible(page.getByRole("button", { name: "재무 비서 닫기" }), "닫기 토글");
  await shot("chat-docked");
  await page.getByRole("button", { name: "재무 비서 닫기" }).click();
  await page.waitForTimeout(300);
});
await step("chat: 390px 에서 전체 화면", async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: "재무 비서 열기" }).click({ timeout: 8000 });
  await page.waitForTimeout(500);
  const w = await page.evaluate(() => {
    const el = document.querySelector('section[aria-label="재무 비서"]');
    return el ? el.getBoundingClientRect().width : 0;
  });
  if (w < 380) throw new Error(`도킹 패널 폭 ${w}px`);
  await shot("chat-mobile");
  await page.locator('section[aria-label="재무 비서"]').getByRole("button", { name: "닫기" }).click();
  await page.setViewportSize({ width: 1440, height: 900 });
});

// ---- 개발 보드 -------------------------------------------------
await page.goto(`${BASE_URL}/neander/dev/board`, { waitUntil: "load" });
await settle();
await step("board: 작업 카드 → 상세 대화상자 → Esc", async () => {
  await page.getByRole("button", { name: /^작업 열기:/ }).first().click();
  const dlg = page.getByRole("dialog").first();
  await expectVisible(dlg, "작업 상세");
  await shot("board-task-detail");
  await page.keyboard.press("Escape");
  await expectHidden(dlg, "작업 상세");
});
await step("board: 새 작업 대화상자 → Esc", async () => {
  await page.getByRole("button", { name: /새 작업/ }).first().click();
  const dlg = page.getByRole("dialog").first();
  await expectVisible(dlg, "새 작업");
  await shot("board-new-task");
  await page.keyboard.press("Escape");
  await expectHidden(dlg, "새 작업");
});

// ---- 바로가기 --------------------------------------------------
await page.goto(`${BASE_URL}/neander/shortcuts`, { waitUntil: "load" });
await settle();
await step("shortcuts: 추가 대화상자 열기/닫기", async () => {
  await page.getByRole("button", { name: /바로가기 추가/ }).first().click();
  const dlg = page.getByRole("dialog").first();
  await expectVisible(dlg, "바로가기 추가");
  await shot("shortcuts-add");
  await page.keyboard.press("Escape");
  await expectHidden(dlg, "바로가기 추가");
});

// ---- 일일업무: 빈 폼 제출 → 토스트 --------------------------------
await page.goto(`${BASE_URL}/neander/tasks`, { waitUntil: "load" });
await settle();
await step("tasks: 빈 제목으로 등록 시 안내(토스트 또는 비활성)", async () => {
  const btn = page.getByRole("button", { name: /^업무 등록$/ }).first();
  if (await btn.isDisabled()) return; // 비활성이면 안내 불필요
  await btn.click();
  await page.waitForTimeout(400);
  await expectVisible(page.getByRole("status").filter({ hasText: /입력|선택/ }), "토스트");
  await shot("tasks-toast");
});

// ---- 메신저 ---------------------------------------------------------
await page.goto(`${BASE_URL}/neander/messenger`, { waitUntil: "load" });
await settle();
await step("messenger: 대화 선택 → 말풍선 표시", async () => {
  await page.getByRole("button", { name: /전체 팀 채팅/ }).first().click().catch(async () => {
    await page.locator("text=전체 팀 채팅").first().click();
  });
  await page.waitForTimeout(800);
  await shot("messenger-room");
});

console.log(results.join("\n"));
console.log(`콘솔/페이지 오류 ${errors.length}건`);
for (const e of errors.slice(0, 10)) console.log(" -", e);
await ctx.close();
