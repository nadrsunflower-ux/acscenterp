// 표기·문구 치환·가정값 상태·모델 단위 테스트 (`npm run deck:test`) — 가상 값만 쓴다
import { test } from "node:test";
import assert from "node:assert/strict";
import { eok, man, pct, wonMan, formatAssumption } from "./format";
import { fill, tokenPaths } from "./template";
import {
  decodeOverrides,
  encodeOverrides,
  resetOverrides,
  sanitizeOverrides,
  setOverride,
  type DeckLocalState,
} from "./state";
import { depsOfPath, effectiveActuals, resolveValues, slideDeps } from "./model";
import type { AssumptionDef, DeckContent, SlideSpec } from "./types";

test("한국식 금액 표기", () => {
  assert.equal(man(1450), "1,450만원");
  assert.equal(man(-663), "-663만원");
  assert.equal(eok(16540), "1억 6,540만원");
  assert.equal(eok(10000), "1억원");
  assert.equal(eok(5800), "5,800만원");
  assert.equal(eok(-12345), "-1억 2,345만원");
  assert.equal(wonMan(791000), "79.1만원");
  assert.equal(wonMan(4500000), "450만원");
  assert.equal(wonMan(29093), "2.9만원");
  assert.equal(pct(45.7, 1), "45.7%");
  assert.equal(man(null), "미정");
  assert.equal(formatAssumption(true, ""), "켜기");
  assert.equal(formatAssumption(20000, "만원"), "2억원");
  assert.equal(formatAssumption(18.07, "원/C"), "18.07원/C");
});

test("문구 자리표시: 경로·형식·인자", () => {
  const scope = { v: { a: 1450 }, r: { x: { list: [{ m: 28.7 }] }, p: 0.4567 } };
  assert.equal(fill("그레이존 {{v.a|man}}", scope), "그레이존 1,450만원");
  assert.equal(fill("{{r.x.list[0].m|months}}", scope), "29개월");
  assert.equal(fill("{{r.p|ratio:1}}", scope), "45.7%");
  assert.equal(fill("{{r.none|man}}", scope), "미정");
  assert.deepEqual(tokenPaths("{{v.a|man}} 와 {{ r.p }}"), ["v.a", "r.p"]);
});

const DEFS: AssumptionDef[] = [
  { key: "a", label: "가", unit: "만원", default: 100, min: 0, max: 1000, group: "매장", kind: "가정", source: "" },
  { key: "on", label: "켜기", unit: "", default: false, group: "매출·현금", kind: "가정", source: "", type: "bool" },
  { key: "revB2B", label: "B2B", unit: "만원", default: 700, group: "B2B", kind: "실측", source: "" },
  { key: "b2bDirectCostRate", label: "직접", unit: "%", default: 25, group: "B2B", kind: "실측", source: "" },
  { key: "b2bFieldLaborRate", label: "현장", unit: "%", default: 10, group: "B2B", kind: "가정", source: "" },
  { key: "b2bContribRate", label: "공헌", unit: "%", default: 65, group: "B2B", kind: "계산", source: "" },
];

test("덮어쓴 값 거르기: 모르는 키·틀린 형식은 버리고 범위는 가둔다", () => {
  assert.deepEqual(sanitizeOverrides(DEFS, { a: "2,000", on: true, zz: 1, revB2B: "x" }), { a: 1000, on: true });
});

test("공유 링크 조각은 되돌아온다", () => {
  const o = { a: 250, on: true };
  assert.deepEqual(decodeOverrides(DEFS, encodeOverrides(o)), o);
  assert.equal(decodeOverrides(DEFS, "%%%"), null);
});

test("덮어쓰기 이력과 되돌리기", () => {
  let s: DeckLocalState = { overrides: {}, history: [] };
  s = setOverride(s, "a", 200, 100, 100, "패널", 1);
  assert.deepEqual(s.overrides, { a: 200 });
  assert.equal(s.history[0].from, 100);
  // 기본값으로 다시 맞추면 덮어쓰기가 사라진다
  s = setOverride(s, "a", 100, 100, 200, "칩", 2);
  assert.deepEqual(s.overrides, {});
  assert.equal(s.history.length, 2);
  s = setOverride(s, "a", 300, 100, 100, "칩", 3);
  s = resetOverrides(s, { a: 300 }, { a: 100 }, undefined, 4);
  assert.deepEqual(s.overrides, {});
  assert.equal(s.history[0].via, "되돌리기");
});

test("값 정하기: 실측이 기본값을 대신하고, 계산 값은 재료를 따라간다", () => {
  const eff = {
    smoat: null,
    finance: {
      asOf: "2026-08-31",
      b2b: { recentAvg: 7_300_000, dealsPerMonth: 2, perClient: 5_000_000 },
      projects: [{}],
      projectsRate: 0.2,
      subsidy: { monthlyAvg: 0 },
      cost: { monthlyAvg: 0, commonMonthlyAvg: 0 },
    } as never,
    snapshot: { smoat: true, finance: false },
  };
  const { values, meta } = resolveValues(DEFS, eff, { b2bFieldLaborRate: 15 });
  assert.equal(values.revB2B, 730);
  assert.equal(meta.revB2B.origin, "erp");
  assert.equal(values.b2bDirectCostRate, 20);
  assert.equal(values.b2bContribRate, 65); // 100 − 20 − 15
  assert.equal(meta.b2bContribRate.origin, "derived");
  const over = resolveValues(DEFS, eff, { b2bContribRate: 60 });
  assert.equal(over.values.b2bContribRate, 60);
  assert.equal(over.meta.b2bContribRate.overridden, true);
});

test("장표가 기대는 가정: 명시 + 자리표시 + 계산 블록", () => {
  assert.deepEqual(depsOfPath("v.a"), ["a"]);
  assert.ok(depsOfPath("r.reloc.mergedLow").includes("mergeKeepRateLow"));
  assert.ok(depsOfPath("r.reloc.min").includes("relocCostLow"));
  const slide: SlideSpec = {
    id: "s",
    no: "1",
    chapter: "",
    title: "{{v.a|man}}",
    blocks: [{ type: "text", md: "{{r.b2b.contrib|pct}}" }],
    keys: ["on"],
  };
  // 직접 지정한 것 → 문구의 가정 → 계산 결과의 재료 순
  assert.deepEqual(slideDeps(slide, DEFS), ["on", "a", "b2bDirectCostRate", "b2bFieldLaborRate", "b2bContribRate"]);
});

test("기준 기간을 12개월로 두면 B2B 매출·월 지출·공통비가 12개월 평균을 쓴다", () => {
  const defs: AssumptionDef[] = [
    ...DEFS,
    { key: "revenueBasis", label: "기준", unit: "", default: 12, group: "매출·현금", kind: "가정", source: "", type: "choice", options: [{ value: 6, label: "6" }, { value: 12, label: "12" }] },
    { key: "costMonthly", label: "지출", unit: "만원", default: 0, group: "매출·현금", kind: "실측", source: "" },
    { key: "commonCostMonthly", label: "공통", unit: "만원", default: 0, group: "스모트", kind: "실측", source: "" },
    { key: "b2bHqLaborRate", label: "본사", unit: "%", default: 15, group: "B2B", kind: "가정", source: "" },
  ];
  const eff = {
    smoat: null,
    finance: {
      asOf: "2026-08-31",
      b2b: { total: 120_000_000, recentAvg: 6_000_000, dealsPerMonth: 2, perClient: 5_000_000 },
      projects: [{}],
      projectsRate: 0.2,
      subsidy: { monthlyAvg: 0 },
      cost: { monthlyAvg: 50_000_000, commonMonthlyAvg: 30_000_000, monthlyAvg12: 40_000_000, commonMonthlyAvg12: 25_000_000 },
    } as never,
    snapshot: { smoat: true, finance: false },
  };
  const y12 = resolveValues(defs, eff, {});
  assert.equal(y12.values.revB2B, 1000);
  assert.equal(y12.values.costMonthly, 4000);
  assert.equal(y12.values.commonCostMonthly, 2500);
  assert.equal(y12.values.b2bContribRate, 55); // 100 − 20 − 10 − 15
  const y6 = resolveValues(defs, eff, { revenueBasis: 6 });
  assert.equal(y6.values.revB2B, 600);
  assert.equal(y6.values.costMonthly, 5000);
  assert.equal(y6.values.commonCostMonthly, 3000);
  assert.equal(y6.meta.revB2B.base, 600);
});

test("사람이 확인한 기준 달 매출은 ERP 가 모자랄 때만 쓴다", () => {
  const content = {
    snapshot: { note: "" },
    rules: { smoat: { confirmedRevMonth: { month: "2026-09", amount: 963000, note: "" } } },
  } as unknown as DeckContent;
  const smoat = (rev: number) => ({ smoat: { baseMonth: "2026-09", revMonth: rev } as never });
  const lagging = effectiveActuals(content, smoat(914100));
  assert.equal(lagging.smoat?.revMonth, 963000);
  assert.equal(lagging.smoat?.revMonthErp, 914100);
  const caught = effectiveActuals(content, smoat(990000));
  assert.equal(caught.smoat?.revMonth, 990000);
  assert.equal(caught.smoat?.revMonthErp, undefined);
});
