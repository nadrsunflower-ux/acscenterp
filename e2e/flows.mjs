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
  // 「불러오는 중」이 **나타나기 전에** 이 검사가 먼저 지나갈 수 있다 (React 가
  // 아직 안 그린 순간). 그러면 빈 화면에 키를 눌러 놓고 실패로 읽는다.
  // 그래서 한 박자 준 뒤에 보고, 두 번 연달아 조용할 때까지 기다린다.
  const quiet = () =>
    page.waitForFunction(() => !/(불러오는|만드는|여는|확인) 중/.test(document.body.innerText), null, { timeout: 60000 });
  await page.waitForTimeout(400);
  await quiet().catch(() => {});
  await page.waitForTimeout(400);
  await quiet().catch(() => {});
  await page.waitForTimeout(300);
};

/** 목록이 실제로 그려질 때까지 — 건수가 많은 화면은 셸보다 한참 늦게 온다 */
const waitRows = async (selector, least = 1) => {
  await page
    .waitForFunction(([sel, n]) => document.querySelectorAll(sel).length >= n, [selector, least], { timeout: 60000 })
    .catch(() => {
      throw new Error(`${selector} 가 ${least}개 이상 그려지지 않음`);
    });
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
// 접힘 상태는 localStorage 에 남는다 — 지난 실행이 접어 두고 끝났을 수 있으니
// 「지금이 어느 쪽이든」 눌러서 반대로 갔다가 되돌아오는지를 본다.
await step("shell: 사이드바 접기/펼치기", async () => {
  const label = async () =>
    (await page.locator('button[aria-label^="사이드바"]').first().getAttribute("aria-label")) ?? "";
  const first = await label();
  const other = first.includes("접기") ? "사이드바 펼치기" : "사이드바 접기";
  await page.locator('button[aria-label^="사이드바"]').first().click();
  await page.waitForTimeout(350);
  if (!(await label()).includes(other.replace("사이드바 ", "")))
    throw new Error(`토글 후 라벨이 그대로: ${await label()}`);
  await shot("shell-sidebar-toggled");
  await page.locator('button[aria-label^="사이드바"]').first().click();
  await page.waitForTimeout(350);
  if ((await label()) !== first) throw new Error(`원래 상태로 안 돌아옴: ${first} → ${await label()}`);
});
await step("shell: 워크스페이스 메뉴 열기 → Esc 닫기 → 포커스 복귀", async () => {
  const ws = page.locator('button[aria-haspopup="menu"][aria-label^="워크스페이스"]').first();
  // 접혀 있으면 아이콘만이라 글자가 없다 — 「연 그 버튼으로 돌아왔는가」를 요소로 본다
  await ws.evaluate((el) => el.setAttribute("data-opener", "1"));
  await ws.click();
  const menu = page.getByRole("menu", { name: "워크스페이스 선택" });
  await expectVisible(menu, "워크스페이스 메뉴");
  await shot("shell-workspace-menu");
  await page.keyboard.press("Escape");
  await expectHidden(menu, "워크스페이스 메뉴");
  await page.waitForFunction(() => document.activeElement?.getAttribute("data-opener") === "1", null, { timeout: 3000 })
    .catch(async () => {
      const a = await page.evaluate(() => document.activeElement?.tagName + " " + (document.activeElement?.getAttribute("aria-label") ?? ""));
      throw new Error(`포커스가 부른 버튼으로 안 돌아옴: ${a}`);
    });
  await ws.evaluate((el) => el.removeAttribute("data-opener"));
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
  // 대기함은 장부 전체를 받은 뒤에야 행이 생긴다 — 행이 오기 전에 키를 누르면
  // 커서가 없어 아무 일도 안 일어난다
  await waitRows("main li", 3);
  for (const k of ["j", "j", "k"]) {
    await page.keyboard.press(k);
    await page.waitForTimeout(200);
  }
  await page.keyboard.press("e");
  const dlg = page.getByRole("dialog").first();
  await dlg.waitFor({ state: "visible", timeout: 8000 });
  await shot("review-editor");
  await page.waitForFunction(() => !!document.activeElement?.closest('[role="dialog"]'), null, { timeout: 5000 })
    .catch(() => { throw new Error("포커스가 대화상자 안에 없음"); });
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

// ---- 재무 대시보드: 집계 기준 도움말 · 월별 수치 표 · 금액 드릴다운 ----
await page.goto(`${BASE_URL}/neander/finance`, { waitUntil: "load" });
await settle();
await step("finance: 집계 기준 도움말 열기 → Esc → 포커스 복귀", async () => {
  const btn = page.getByRole("button", { name: "집계 기준" }).first();
  await btn.click();
  const dlg = page.getByRole("dialog", { name: /집계 기준/ });
  await expectVisible(dlg, "집계 기준 판");
  await shot("finance-basis-help");
  await page.keyboard.press("Escape");
  await expectHidden(dlg, "집계 기준 판");
  const focused = await page.evaluate(() => document.activeElement?.textContent?.trim());
  if (!focused?.includes("집계 기준")) throw new Error(`포커스가 돌아오지 않음: ${focused}`);
});
await step("finance: 월별 수치 보기 펼침 → 표에 순손익 열", async () => {
  await page.getByRole("button", { name: "월별 수치 보기" }).first().click();
  await page.waitForTimeout(250);
  await expectVisible(page.getByRole("columnheader", { name: /순손익/ }).first(), "월별 수치 표");
  await shot("finance-trend-values");
  await page.getByRole("button", { name: "월별 수치 닫기" }).first().click();
});
await step("finance: 사업부 손익 금액 → 내역 창 → Esc → 포커스 복귀", async () => {
  const cell = page.getByRole("button", { name: /세부 내역 열기/ }).first();
  await cell.focus();
  await page.keyboard.press("Enter");
  const dlg = page.getByRole("dialog").first();
  await expectVisible(dlg, "내역 창");
  // 포커스 덫은 그리고 나서 다음 프레임에 옮긴다 — 바로 물으면 아직 body 다
  await page.waitForFunction(() => !!document.activeElement?.closest('[role="dialog"]'), null, { timeout: 5000 })
    .catch(() => { throw new Error("포커스가 창 안으로 안 들어감"); });
  await shot("finance-breakdown-dialog");
  await page.keyboard.press("Escape");
  await expectHidden(dlg, "내역 창");
  const back = await page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? "");
  if (!back.includes("세부 내역 열기")) throw new Error(`포커스가 금액으로 돌아오지 않음: ${back}`);
});

// ---- 매출 대시보드: 계산 기준 · 지표 셀렉트 · 월별 수치 · 390px 넘침 ----
await page.goto(`${BASE_URL}/neander/sales`, { waitUntil: "load" });
await settle();
await step("sales: 계산 기준 도움말 열기 → Esc", async () => {
  await page.getByRole("button", { name: "계산 기준" }).first().click();
  const dlg = page.getByRole("dialog", { name: /계산 기준/ });
  await expectVisible(dlg, "계산 기준 판");
  await shot("sales-basis-help");
  await page.keyboard.press("Escape");
  await expectHidden(dlg, "계산 기준 판");
});
await step("sales: 추이 지표 셀렉트 → 공헌이익", async () => {
  await page.getByRole("combobox", { name: "추이 지표" }).selectOption("contribution");
  await page.waitForTimeout(300);
  await expectVisible(page.locator("text=확정 매출 기준").first(), "지표 힌트");
  await shot("sales-trend-contribution");
  await page.getByRole("combobox", { name: "추이 지표" }).selectOption("revenue");
});
await step("sales: 월별 수치 보기 펼침", async () => {
  await page.getByRole("button", { name: "월별 수치 보기" }).first().click();
  await page.waitForTimeout(250);
  await expectVisible(page.getByRole("columnheader", { name: /합계/ }).first(), "월별 수치 표");
  await shot("sales-trend-values");
});
await step("sales: 390px 에서 페이지 가로 넘침 없음", async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  await shot("sales-390");
  if (o.sw > o.cw + 1) throw new Error(`가로 넘침 ${o.sw} > ${o.cw}`);
  await page.setViewportSize({ width: 1440, height: 900 });
});
await page.goto(`${BASE_URL}/neander/sales/catalog`, { waitUntil: "load" });
await settle();
// 상품 관리는 열 11개짜리 1,460px 표에서 **목록 + 상세**로 바뀌었다.
// 좁은 화면에서는 한 판씩 보여야 하고, 사진이 붙은 목록에서 고르면
// 오른쪽(좁으면 그 자리)에서 고친다.
await step("catalog: 390px 목록만 보이고 가로로 안 넘친다", async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  if (o.sw > o.cw + 1) throw new Error(`가로 넘침 ${o.sw} > ${o.cw}`);
  await expectVisible(page.getByRole("heading", { name: /상품 목록/ }), "상품 목록");
  await shot("catalog-390");
  await page.setViewportSize({ width: 1440, height: 900 });
});
await step("catalog: 목록에서 상품 고르기 → 상세에 사진·판매가", async () => {
  await page.locator("li button").first().click();
  await page.waitForTimeout(300);
  await expectVisible(page.getByRole("heading", { name: "상품 정보" }), "상품 상세");
  const img = await page.evaluate(() => {
    const el = document.querySelector('[class*="aspect-square"] img');
    return el ? { src: el.getAttribute("src"), w: el.naturalWidth } : null;
  });
  // 사진이 없는 유형(사쉐·뿌디)은 중립 아이콘이라 img 가 없는 것이 정상이다
  if (img && !img.w) throw new Error(`상세 사진이 안 불러와짐: ${img.src}`);
  await expectVisible(page.getByLabel(/판매가$/).first(), "판매가 입력칸");
  await shot("catalog-detail");
});
await step("catalog: 고친 값은 저장 전까지 남고 「변경 취소」로 되돌린다", async () => {
  const price = page.getByLabel(/판매가$/).first();
  const before = await price.inputValue();
  await price.fill(String(Number(before || "0") + 1000));
  await page.waitForTimeout(200);
  await expectVisible(page.locator("text=변경된 내용이 있습니다"), "미저장 표시");
  await page.getByRole("button", { name: "변경 취소" }).first().click();
  await page.waitForTimeout(200);
  const after = await price.inputValue();
  if (after !== before) throw new Error(`되돌리기 실패: ${before} → ${after}`);
});

// ---- 매출 검토 대기함: 상품 후보가 사진 붙은 카드인가 ----
await page.goto(`${BASE_URL}/neander/sales/review`, { waitUntil: "load" });
await settle();
await step("review: 상품 후보가 라디오 카드 (네이티브 option 아님)", async () => {
  const group = page.getByRole("radiogroup", { name: "상품 후보" }).first();
  if (!(await group.isVisible().catch(() => false))) {
    console.log("   (이 달에 미확정 묶음이 없어 건너뜀)");
    return;
  }
  const radios = group.getByRole("radio");
  if ((await radios.count()) === 0) throw new Error("후보 카드가 없음");
  // 입력칸은 sr-only 라 사람도 자동화도 **카드(라벨)** 를 누른다
  await group.locator("label").first().click();
  await page.waitForTimeout(250);
  const picked = await page.evaluate(
    () => !!document.querySelector('[role="radiogroup"] input:checked'),
  );
  if (!picked) throw new Error("카드를 눌러도 골라지지 않음");
  // 키보드만으로도 후보 사이를 옮길 수 있어야 한다
  await page.evaluate(() => document.querySelector('[role="radiogroup"] input')?.focus());
  if (!(await page.evaluate(() => document.activeElement?.getAttribute("type") === "radio")))
    throw new Error("라디오에 포커스가 오지 않음");
  await shot("review-candidates");
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
