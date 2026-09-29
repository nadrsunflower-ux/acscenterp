// 실측 규칙 단위 테스트 — 가상의 결제·거래로 방법만 검사한다 (`npm run deck:test`)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeFinanceActuals,
  computeSmoatActuals,
  monthsInclusive,
  normalizeVendor,
  type RawFinTx,
  type RawSmoatSale,
} from "./actuals";
import type { DeckActualRules } from "./types";

const RULES: DeckActualRules["smoat"] = {
  excludeNames: ["테스트계정"],
  excludeStatuses: ["MANUAL_GRANT"],
  unnamedNames: ["-"],
  creditTable: [
    { price: 10000, credits: 100 },
    { price: 30000, credits: 400 },
  ],
  aiCostFrom: "2026-02",
  repurchaseFrom: "2026-01",
  repurchaseTo: "2026-02",
};

let seq = 0;
const sale = (date: string, name: string, gross: number, extra: Partial<RawSmoatSale> = {}): RawSmoatSale => ({
  id: `s${++seq}`,
  date,
  gross,
  amount: gross,
  status: "COMPLETED",
  accountId: name === "-" ? "unnamed1" : `acc-${name}`,
  accountName: name,
  // 사이트 기록의 크레딧에는 보너스가 붙어 있다 — 환산표가 이긴다
  credits: 999,
  ...extra,
});

test("개월 수는 양 끝을 포함한다", () => {
  assert.equal(monthsInclusive("2026-06", "2026-09"), 4);
  assert.equal(monthsInclusive("2025-11", "2026-02"), 4);
  assert.equal(monthsInclusive("2026-03", "2026-03"), 1);
});

test("스모트: 내부·수기 지급은 빼고, 이름 없는 입금은 매출에만 넣는다", () => {
  const sales = [
    sale("2026-01-05", "가학원", 10000),
    sale("2026-01-20", "테스트계정", 10000),
    sale("2026-02-03", "가학원", 30000),
    sale("2026-02-10", "나학원", 10000),
    sale("2026-02-11", "우리", 10000, { status: "MANUAL_GRANT" }),
    sale("2026-03-02", "나학원", 10000),
    sale("2026-03-05", "-", 30000),
    sale("2026-03-09", "다학원", 30000),
    sale("2026-03-09", "다학원", 0),
  ];
  const costs = [
    { id: "2026-01", aiKrw: 999, creditsSold: 0, creditsUsed: 1 },
    { id: "2026-02", aiKrw: 1000, creditsSold: 100, creditsUsed: 400 },
    { id: "2026-03", aiKrw: 3000, creditsSold: 300, creditsUsed: 600 },
  ];
  const a = computeSmoatActuals(sales, costs, RULES, "2026-03-10");

  assert.equal(a.baseMonth, "2026-03");
  assert.deepEqual(
    a.months.map((m) => [m.month, m.dashboard, m.internal, m.unnamed, m.academies]),
    [
      ["2026-01", 20000, 10000, 0, 10000],
      ["2026-02", 50000, 10000, 0, 40000],
      ["2026-03", 70000, 0, 30000, 40000],
    ],
  );
  assert.equal(a.totals.academies, 3);
  assert.equal(a.totals.payments, 5);
  assert.equal(a.totals.total, 90000);
  assert.deepEqual(a.unnamed, { payments: 1, total: 30000 });

  // 가학원: 1~3월 3개월, 40,000원 → 월 13,333원, 크레딧 100+400 = 500 → 월 166.7C
  const ga = a.academies.find((x) => x.name === "가학원")!;
  assert.equal(ga.months, 3);
  assert.equal(ga.total, 40000);
  assert.equal(ga.credits, 500);
  assert.ok(Math.abs(ga.monthlySpend - 40000 / 3) < 1e-9);
  assert.equal(ga.repeat, true);
  assert.equal(ga.upgraded, true);
  // 나학원: 2월 첫 결제, 3월 재결제, 같은 묶음
  const na = a.academies.find((x) => x.name === "나학원")!;
  assert.equal(na.repeat, true);
  assert.equal(na.upgraded, false);
  // 다학원: 기준 달에 처음 → 1개월
  assert.equal(a.academies.find((x) => x.name === "다학원")!.months, 1);

  // 재구매 cohort(1~2월 첫 결제): 가·나 둘 다 재결제, 그중 상향 1곳
  assert.deepEqual(a.repurchase, { from: "2026-01", to: "2026-02", cohort: 2, repeat: 2, upgraded: 1 });

  // AI 원가: 2월부터 — (1000+3000) ÷ (400+600) = 4원/C, 무료 몫 = 1 − 400/1000
  assert.equal(a.aiCost.krw, 4000);
  assert.equal(a.aiCost.perCredit, 4);
  assert.ok(Math.abs(a.aiCost.freeShare - 0.6) < 1e-9);

  // 기준 달 매출은 이름 없는 입금 포함
  assert.equal(a.revMonth, 70000);
  // 월평균·최고 월은 실제 학원 결제만
  assert.equal(a.avgMonthly, 30000);
  assert.deepEqual(a.peak, { month: "2026-02", amount: 40000 });
  assert.ok(Math.abs(a.topShare - 40000 / 90000) < 1e-9);
  assert.deepEqual(a.packMix, [
    { price: 10000, count: 3 },
    { price: 30000, count: 2 },
  ]);
});

test("거래처 이름 합치기: (주)·주식회사·띄어쓰기를 걷고 별칭표를 따른다", () => {
  const aliases = { 가나다런칭: "가나다" };
  assert.equal(normalizeVendor("(주)가나다", aliases), "가나다");
  assert.equal(normalizeVendor("주식회사 가나다", aliases), "가나다");
  assert.equal(normalizeVendor("가나다 런칭", aliases), "가나다");
  assert.equal(normalizeVendor("", aliases), "(거래처 없음)");
});

const tx = (date: string, txType: string, gross: number, extra: Partial<RawFinTx> = {}): RawFinTx => ({
  date,
  txType,
  gross,
  adjust: 0,
  ...extra,
});

test("재무: B2B 12개월 · 지원금 · 월 지출(부가세·카드대금 제외) · 프로젝트 직접비율", () => {
  const txs: RawFinTx[] = [
    // 12개월 창 밖 (2025-02)
    tx("2025-02-10", "수입", 999, { acctMid: "B2B매출", vendor: "가" }),
    // B2B — 9월·1월(대목) + 5월
    tx("2025-09-10", "수입", 600, { acctMid: "B2B매출", vendor: "(주)가" }),
    tx("2026-01-10", "수입", 200, { acctMid: "B2B매출", vendor: "가 " }),
    tx("2026-05-10", "수입", 200, { acctMid: "B2B매출", vendor: "나", adjust: 0 }),
    // 지원금 세 갈래
    tx("2025-10-01", "수입", 120, { acctMid: "지원금" }),
    tx("2026-03-01", "수입", 60, { acctMid: "인건비환급(차감)" }),
    tx("2026-04-01", "수입", 60, { acctMid: "환불수입", acctMinor: "인건비환급" }),
    tx("2026-04-02", "수입", 999, { acctMid: "환불수입", acctMinor: "보증금환급" }),
    // 12개월 창 안, 6개월 창 밖 지출 (2025-11)
    tx("2025-11-05", "지출", 120, { bizMajor: "공용" }),
    // 최근 6개월(2026-03~08) 지출
    tx("2026-03-05", "지출", 600, { bizMajor: "공용" }),
    tx("2026-04-05", "지출", 60, { acctMinor: "부가가치세(VAT)", bizMajor: "공용" }),
    tx("2026-05-05", "지출", 120, { acctMinor: "카드대금결제" }),
    tx("2026-06-05", "환급", 30),
    tx("2026-08-31", "지출", 30, { projectCode: "P1", acctMajor: "재료" }),
    tx("2026-08-31", "지출", 999, { projectCode: "P1", acctMajor: "인건비" }),
    tx("2026-08-20", "수입", 300, { projectCode: "P1", acctMid: "B2B매출", vendor: "나" }),
  ];
  const projects = [
    { code: "P1", name: "장부 프로젝트" },
    { code: "P2", name: "체크리스트 프로젝트", contractAmount: 1000, lines: [{ qty: 2, unitPrice: 50 }, { actual: 100 }] },
    { code: "P3", name: "비용 없음", contractAmount: 500 },
  ];
  const f = computeFinanceActuals(txs, projects, { vendorAliases: {} });

  assert.equal(f.ledgerEnd, "2026-08");
  assert.equal(f.b2b.from, "2025-09");
  assert.equal(f.b2b.total, 600 + 200 + 200 + 300);
  assert.equal(f.b2b.clients, 2);
  assert.equal(f.b2b.maxSingle, 600);
  assert.ok(Math.abs(f.b2b.peakShare - 800 / 1300) < 1e-9);
  assert.ok(Math.abs(f.b2b.dealsPerMonth - 2 / 12) < 1e-9);
  // 최근 6개월 B2B = 5월 200 + 8월 300
  assert.ok(Math.abs(f.b2b.recentAvg - 500 / 6) < 1e-9);

  assert.equal(f.subsidy.total, 240);
  assert.equal(f.subsidy.monthlyAvg, 20);

  // 지출 600+60+120+30+999 − 환급 30 − 부가세 60 − 카드대금 120 = 1,599 → ÷ 6
  assert.ok(Math.abs(f.cost.monthlyAvg - 1599 / 6) < 1e-9);
  assert.equal(f.cost.excludedVat, 10);
  assert.equal(f.cost.excludedCardPay, 20);
  assert.equal(f.cost.commonMonthlyAvg, 100);
  // 12개월: 6개월 창 지출 1,599 + 2025-11 공용 120 = 1,719 → ÷ 12, 공용 600 + 120 → ÷ 12
  assert.equal(f.cost.from12, "2025-09");
  assert.ok(Math.abs((f.cost.monthlyAvg12 ?? 0) - 1719 / 12) < 1e-9);
  assert.ok(Math.abs((f.cost.commonMonthlyAvg12 ?? 0) - 720 / 12) < 1e-9);

  // P1: 장부 매출 300, 직접비 30(인건비 제외) → 10%. P2: 계약 1000, 체크리스트 200 → 20%. P3 제외
  assert.deepEqual(
    f.projects.map((p) => [p.code, p.revenue, p.direct, p.basis]),
    [
      ["P1", 300, 30, "장부"],
      ["P2", 1000, 200, "체크리스트"],
    ],
  );
  assert.ok(Math.abs(f.projectsRate - 230 / 1300) < 1e-9);
});
