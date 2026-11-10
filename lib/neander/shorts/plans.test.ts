// GL AI 스튜디오 구독 플랜 — 가격표 · 1편 금액 · 약정 · 계약 칸 다듬기
// 실행: npx tsx --test lib/neander/shorts/plans.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { CLIENT_PLANS, CLIENT_PLAN_IDS, addMonths, applyPlan, cleanClientContract, commitmentEndMonth, extraRevisionKrw, planDiff, planFee, planText, planVideos, revisionText, videoUnitKrw } from "./plans";
import { autoItems } from "./calendar";

test("가격표 — 계약서 제3조 ① 표 그대로 (부가세 별도)", () => {
  const table = CLIENT_PLAN_IDS.filter((id) => id !== "enterprise").map((id) => [CLIENT_PLANS[id].label, planFee(id, "monthly"), planFee(id, "m3"), planFee(id, "m12"), planVideos(id)]);
  assert.deepEqual(table, [
    ["주 1회 연재", 990_000, 940_000, 890_000, 4],
    ["스타트", 1_500_000, 1_420_000, 1_350_000, 8],
    ["그로스", 2_700_000, 2_560_000, 2_430_000, 8],
    ["풀 그로스", 3_500_000, 3_320_000, 3_150_000, 8],
  ]);
  assert.equal(planFee("enterprise", "m12"), null);
  assert.equal(planVideos("enterprise"), null);
  assert.equal(planFee(null), null);
});

test("1편 금액 — 주 1회는 그 이용료의 1/4, 그 밖은 같은 약정 스타트의 1/8 (제7조 ①)", () => {
  assert.equal(videoUnitKrw("weekly", "monthly"), 247_500);
  assert.equal(videoUnitKrw("weekly", "m12"), 222_500);
  assert.equal(videoUnitKrw("start", "monthly"), 187_500);
  assert.equal(videoUnitKrw("growth", "m3"), 177_500); // 그로스도 스타트 기준
  assert.equal(videoUnitKrw("fullGrowth", "m12"), 168_750);
  assert.equal(videoUnitKrw("enterprise", "monthly"), null);
  assert.equal(videoUnitKrw(null), null);
});

test("약정 끝 달 — 시작 월부터 3 · 12 달, 해를 넘긴다", () => {
  assert.equal(addMonths("2026-11", 2), "2027-01");
  assert.equal(addMonths("2026-12", 0), "2026-12");
  assert.equal(commitmentEndMonth("2026-11", "m3"), "2027-01");
  assert.equal(commitmentEndMonth("2026-11", "m12"), "2027-10");
  assert.equal(commitmentEndMonth("2026-11", "monthly"), null);
  assert.equal(commitmentEndMonth("2026-11", undefined), null);
  assert.equal(commitmentEndMonth("엉터리", "m3"), null);
});

test("플랜 고르기 — 가격표대로 금액 · 편수 · 부가세 별도, 엔터프라이즈는 금액을 비운다, 직접은 그대로", () => {
  const base = { plan: null, term: "monthly" as const, monthlyFeeKrw: 2_000_000, vat: "included" as const, videosPerMonth: 6 };
  assert.deepEqual(applyPlan(base, "start", "m3"), { plan: "start", term: "m3", monthlyFeeKrw: 1_420_000, vat: "excluded", videosPerMonth: 8 });
  assert.deepEqual(applyPlan(base, "weekly", "monthly"), { plan: "weekly", term: "monthly", monthlyFeeKrw: 990_000, vat: "excluded", videosPerMonth: 4 });
  assert.deepEqual(applyPlan(base, "enterprise", "m12"), { plan: "enterprise", term: "m12", monthlyFeeKrw: null, vat: "excluded", videosPerMonth: 6 });
  assert.deepEqual(applyPlan(base, null, "m3"), { ...base, term: "m3" });
});

test("가격표와 다른 칸 — 협의 금액은 알리기만", () => {
  assert.equal(planDiff({ plan: "start", term: "m3", monthlyFeeKrw: 1_420_000, vat: "excluded", videosPerMonth: 8 }), null);
  assert.deepEqual(planDiff({ plan: "start", term: "m3", monthlyFeeKrw: 1_300_000, vat: "excluded", videosPerMonth: 8 }), { fee: 1_420_000, videos: null, vat: false });
  assert.deepEqual(planDiff({ plan: "growth", term: "monthly", monthlyFeeKrw: 2_700_000, vat: "included", videosPerMonth: 10 }), { fee: null, videos: 8, vat: true });
  assert.equal(planDiff({ plan: "enterprise", term: "monthly", monthlyFeeKrw: 9_000_000, vat: "excluded", videosPerMonth: 20 }), null);
  assert.equal(planDiff({ plan: null, term: "monthly", monthlyFeeKrw: 1, vat: "included", videosPerMonth: 1 }), null);
});

test("글 — 플랜 · 수정 횟수 · 넘는 수정 금액", () => {
  assert.equal(planText({ plan: "fullGrowth", term: "m12" }), "풀 그로스 · 12개월 약정");
  assert.equal(planText({ plan: "start" }), "스타트 · 월 단위");
  assert.equal(planText({ plan: null }), "");
  assert.equal(revisionText({ revisionLimit: 2 }), "대본 2회 · 완성본 2회"); // 예전 업체 — 대본 칸 없음 → 2
  assert.equal(revisionText({ scriptRevisionLimit: 3, revisionLimit: 1 }), "대본 3회 · 완성본 1회");
  assert.equal(extraRevisionKrw({ plan: "weekly" }), 50_000);
  assert.equal(extraRevisionKrw({ plan: null }), null);
  assert.equal(extraRevisionKrw({}), null);
});

test("계약 칸 다듬기 — 예전 업체 문서는 그대로 읽힌다", () => {
  const prev = { monthlyFeeKrw: 1_500_000, vat: "excluded" as const, videosPerMonth: 8, revisionLimit: 1, startMonth: "2026-10", endMonth: null, financeCode: "", note: "" };
  const c = cleanClientContract({ ...prev, startMonth: "" }, prev, "2026-11");
  assert.equal(c.plan, null);
  assert.equal(c.term, "monthly");
  assert.equal(c.monthlyFeeKrw, 1_500_000);
  assert.equal(c.revisionLimit, 1);
  assert.equal(c.scriptRevisionLimit, 2);
  assert.equal(c.startMonth, "2026-10"); // 빈 시작 월은 예전 값
});

test("계약 칸 다듬기 — 플랜만 보내면 가격표 금액 · 편수, 엉터리 플랜은 버린다, 0회는 0회", () => {
  const a = cleanClientContract({ plan: "growth", term: "m12" }, null, "2026-11");
  assert.deepEqual([a.plan, a.term, a.monthlyFeeKrw, a.videosPerMonth, a.vat, a.scriptRevisionLimit, a.revisionLimit, a.startMonth], ["growth", "m12", 2_430_000, 8, "excluded", 2, 2, "2026-11"]);
  const b = cleanClientContract({ plan: "gold", term: "m24", monthlyFeeKrw: 1_000_000, videosPerMonth: 0, revisionLimit: 0, scriptRevisionLimit: 99 }, null, "2026-11");
  assert.deepEqual([b.plan, b.term, b.monthlyFeeKrw, b.videosPerMonth, b.revisionLimit, b.scriptRevisionLimit], [null, "monthly", 1_000_000, 1, 0, 10]);
  const e = cleanClientContract({ plan: "enterprise", monthlyFeeKrw: null }, null, "2026-11");
  assert.deepEqual([e.monthlyFeeKrw, e.videosPerMonth], [null, 8]);
  const f = cleanClientContract({ financeCodes: ["pj-2611-01", "bad code!"], financeCode: "PJ-2610-02" }, null, "2026-11");
  assert.deepEqual(f.financeCodes, ["PJ-2611-01", "PJ-2610-02"]);
});

test("일정 — 약정 끝 30일 전 알림과 약정 끝 날 (월 단위는 없음)", () => {
  const contract = (term: "monthly" | "m3" | "m12") => ({ plan: "start" as const, term, monthlyFeeKrw: 1_420_000, vat: "excluded" as const, videosPerMonth: 8, revisionLimit: 2, startMonth: "2026-11", endMonth: null, financeCode: "", note: "" });
  const items = autoItems({
    projects: [],
    publications: [],
    clients: [
      { id: "a", name: "가 업체", contract: contract("m3") },
      { id: "b", name: "나 업체", contract: contract("m12") },
      { id: "c", name: "다 업체", contract: contract("monthly") },
    ],
    clientFinance: {},
    today: "2026-11-10",
  });
  const commit = items.filter((x) => x.key.startsWith("cn-") || x.key.startsWith("cm-")).map((x) => [x.key, x.date]);
  assert.deepEqual(commit, [
    ["cn-a", "2027-01-01"],
    ["cm-a", "2027-01-31"],
    ["cn-b", "2027-10-01"], // 10월 31일에서 30일 앞
    ["cm-b", "2027-10-31"],
  ]);
  assert.match(items.find((x) => x.key === "cn-a")!.detail, /3개월 약정 2027-01-31 끝 — 오늘까지 고객사에 알립니다/);
});
