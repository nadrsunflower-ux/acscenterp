// 장표 계산식 단위 테스트 — `npm run deck:test`
//
// 이 저장소는 public 이라 실제 가정값·학원 결제를 여기 두지 않는다. 숫자는
// 전부 손으로 검산할 수 있는 가상 값이다. 실제 기본값으로 완료 기준(회수
// 개월·손익분기 등)을 재현하는 검사는 scripts/neander/verify-deck.ts 가
// 비공개 내용을 읽어서 한다.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as calc from "./calc";

const close = (a: number | null, b: number, eps = 1e-6) => {
  assert.ok(a !== null, `null 이 아니어야 한다 (기대 ${b})`);
  assert.ok(Math.abs((a as number) - b) < eps, `${a} ≈ ${b}`);
};

test("회수 개월 = 비용 ÷ 월 이익 개선, 개선이 0 이하이면 null", () => {
  close(calc.paybackMonths(1200, 100), 12);
  assert.equal(calc.paybackMonths(1200, 0), null);
  assert.equal(calc.paybackMonths(1200, -5), null);
});

test("이전 회수 조합표: 가장 싼 비용 ÷ 가장 큰 개선 ~ 가장 비싼 비용 ÷ 가장 작은 개선", () => {
  const p = calc.relocPayback([1000, 2000, 3000], [50, 100]);
  assert.equal(p.rows.length, 3);
  assert.equal(p.rows[0].cells.length, 2);
  close(p.rows[1].cells[0].months, 40);
  close(p.min, 10);
  close(p.max, 60);
  const none = calc.relocPayback([1000], [0]);
  assert.equal(none.min, null);
  assert.equal(none.max, null);
});

test("합친 뒤 이벤트 매출 = 현재 × 유지율", () => {
  close(calc.mergedEventRevenue(1000, 65), 650);
});

test("런웨이: 분모가 0 이하이면 흑자, 지원금은 켤 때만 뺀다", () => {
  const off = calc.runway({ cash: 3000, cost: 500, revenue: 300, subsidy: 100, includeSubsidy: false });
  assert.equal(off.surplus, false);
  close(off.burn, 200);
  close(off.months, 15);
  const on = calc.runway({ cash: 3000, cost: 500, revenue: 300, subsidy: 100, includeSubsidy: true });
  close(on.months, 30);
  const black = calc.runway({ cash: 3000, cost: 500, revenue: 450, subsidy: 100, includeSubsidy: true });
  assert.equal(black.surplus, true);
  assert.equal(black.months, null);
  const zero = calc.runway({ cash: 0, cost: 500, revenue: 300, subsidy: 0, includeSubsidy: false });
  close(zero.months, 0);
});

const P: calc.SmoatParams = { vatRate: 10, pgFeeRate: 2, aiCostPerCredit: 10, usageRate: 50, creditsPerQuestion: 2 };

test("요금제 이익: 공급가 = 가격 ÷ 1.1, 수수료 = 가격 × 수수료율, AI 원가 = 크레딧 × 사용률 × 원가", () => {
  const e = calc.tierEconomics({ name: "가", price: 11000, credits: 400 }, P);
  close(e.supply, 10000);
  close(e.fee, 220);
  close(e.aiFull, 4000);
  close(e.aiSet, 2000);
  close(e.profitFull, 10000 - 220 - 4000);
  close(e.profitSet, 10000 - 220 - 2000);
  close(e.marginFull, 0.578);
  close(e.marginSet, 0.778);
  close(e.perCredit, 27.5);
  close(e.questions, 200);
  close(e.perQuestion, 55);
});

const TIERS: calc.Tier[] = [
  { name: "작음", price: 10000, credits: 100 },
  { name: "중간", price: 20000, credits: 300 },
  { name: "큼", price: 50000, credits: 1000 },
];

test("추천 요금제: 필요량 × (1 + 여유율) 이상인 가장 싼 요금제", () => {
  assert.deepEqual(calc.recommendTier(100, TIERS, 0), { index: 0, over: false });
  assert.deepEqual(calc.recommendTier(100, TIERS, 20), { index: 1, over: false });
  assert.deepEqual(calc.recommendTier(250, TIERS, 20), { index: 1, over: false });
  assert.deepEqual(calc.recommendTier(251, TIERS, 20), { index: 2, over: false });
  // 가장 큰 요금제로도 모자라면 가장 큰 요금제 + over
  assert.deepEqual(calc.recommendTier(900, TIERS, 20), { index: 2, over: true });
  // 요금제 순서가 뒤섞여 있어도 가격 순으로 고른다
  const shuffled = [TIERS[2], TIERS[0], TIERS[1]];
  assert.deepEqual(calc.recommendTier(100, shuffled, 0), { index: 1, over: false });
});

test("학원 비교: 절감액·절감률·크레딧 배수", () => {
  const c = calc.compareAcademy({ monthlySpend: 25000, monthlyCredits: 150 }, TIERS, 0);
  assert.equal(c.index, 1);
  assert.equal(c.price, 20000);
  assert.equal(c.saving, 5000);
  close(c.savingRate, 0.2);
  close(c.multiple, 2);
  const zero = calc.compareAcademy({ monthlySpend: 0, monthlyCredits: 0 }, TIERS, 0);
  assert.equal(zero.savingRate, null);
  assert.equal(zero.multiple, null);
});

test("매출 시뮬레이션: Σ추천 가격 × 전환 비율 + 추가 전환 × 첫 요금제 가격", () => {
  const academies = [{ monthlyCredits: 50 }, { monthlyCredits: 90 }, { monthlyCredits: 200 }, { monthlyCredits: 700 }];
  const s = calc.simulateSubscriptions(academies, TIERS, 0, 100, 3);
  assert.deepEqual(s.counts, [2, 1, 1]);
  assert.equal(s.base, 10000 * 2 + 20000 + 50000);
  assert.equal(s.extra, 30000);
  assert.equal(s.monthly, 120000);
  const half = calc.simulateSubscriptions(academies, TIERS, 0, 50, 0);
  assert.equal(half.monthly, 45000);
});

test("12개월 누적: 매달 해지율만큼 줄어든다", () => {
  const c = calc.churnCumulative(1000, 10, 3);
  assert.deepEqual(c.series.map((x) => Math.round(x)), [1000, 900, 810]);
  close(c.total, 2710);
  const none = calc.churnCumulative(1000, 0, 12);
  close(none.total, 12000);
});

test("학원당 평균 공헌이익 = 요금제 구성 비율로 가중평균", () => {
  close(calc.weightedContribution([2, 1, 1], [100, 200, 500]), (200 + 200 + 500) / 4);
  assert.equal(calc.weightedContribution([0, 0], [1, 2]), null);
});

test("손익분기 학원 수 = (고정비 + 공통비 부담) ÷ 학원당 공헌이익", () => {
  close(calc.breakevenAcademies(900, 100, 10), 100);
  assert.equal(calc.breakevenAcademies(900, 0, 0), null);
  assert.equal(calc.breakevenAcademies(900, 0, null), null);
});

test("선결제: 학기 = 가격 × (6 − 무료), 연간 = 가격 × (12 − 무료)", () => {
  const p = calc.prepay(10000, 1, 2);
  assert.equal(p.semester, 50000);
  assert.equal(p.annual, 100000);
  close(p.semesterDiscount, 1 / 6);
  close(p.annualDiscount, 2 / 12);
});

test("B2B 기대 효과: 연 매출 = 건수 × 건당 × 12, 공헌이익 = × 공헌이익률", () => {
  const s = calc.b2bScenario(2, 500, 50);
  assert.equal(s.annualRevenue, 12000);
  assert.equal(s.annualContrib, 6000);
  assert.equal(calc.b2bContribRate(30, 15), 55);
});

test("상품별 예상 이익 = 시작가 × (1 − 직접비율 − 현장 인건비율)", () => {
  const p = calc.productProfit(100, 30, 10);
  close(p.profit, 60);
  close(p.rate, 0.6);
});

test("T1 면제 기대 비용 = 건수 × 확률 × 미달액 × 일수 + 건수 × 특전", () => {
  const c = calc.t1WaiverCost({ t1Count: 2, shortfallProbPct: 50, avgShortfallPerDay: 10, eventDays: 3, perkCost: 5 });
  close(c.waiver, 30);
  close(c.perk, 10);
  close(c.total, 40);
});

test("DM 깔때기 = DM × 응답률 × 예약 전환율", () => {
  const f = calc.dmFunnel(100, 20, 50);
  close(f.replies, 20);
  close(f.bookings, 10);
});

test("외부 주최 증가분 × 1건 공헌이익 — 1건 공헌이익을 모르면 null", () => {
  assert.equal(calc.externalGain(2, 5, 40), 120);
  assert.equal(calc.externalGain(2, 5, null), null);
});

test("월 크레딧 구간: 경계 포함 여부와 1C당 가격 범위", () => {
  const bands = calc.creditBands(
    [
      { monthlySpend: 20000, monthlyCredits: 100 },
      { monthlySpend: 30000, monthlyCredits: 300 },
      { monthlySpend: 50000, monthlyCredits: 301 },
      { monthlySpend: 90000, monthlyCredits: 2500 },
    ],
    [300, 800],
  );
  assert.deepEqual(bands.map((b) => b.label), ["300C 이하", "301~800C", "800C 초과"]);
  assert.deepEqual(bands.map((b) => b.count), [2, 1, 1]);
  close(bands[0].spendAvg, 25000);
  close(bands[0].perCreditMin, 100);
  close(bands[0].perCreditMax, 200);
  assert.equal(bands[2].spendMin, 90000);
});
