// API 비용 단위 테스트 — 구간 자르기 · 날 고르기 · 붙여 보기 · 원가 줄 (`npm run finance:test-api-cost`)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  API_COST_LINE_ID,
  apiCostLine,
  cleanModel,
  costRows,
  cutRange,
  dateRuns,
  dayFromAnalytics,
  isManualApiLine,
  isSlot,
  addHours,
  keyDay,
  kstDate,
  kstDayRange,
  lastCompletedDay,
  parseTargetKey,
  projectApiCost,
  rangeLabel,
  replaceApiCostLine,
  setRange,
  spansFromSlots,
  sumByKey,
  sumByTarget,
  targetKey,
  targetOn,
  usdText,
  type ApiDayDoc,
  type ApiKeyAlloc,
  type ApiRange,
  type ApiTarget,
} from "./api-cost";

const P1: ApiTarget = { kind: "fin", id: "p1" };
const P2: ApiTarget = { kind: "fin", id: "p2" };
const CH: ApiTarget = { kind: "studio", id: "salim" };
const COMMON: ApiTarget = { kind: "common", id: "" };
let n = 0;
const newId = () => `r${++n}`;
const meta = { at: 1 };
const spans = (rs: ApiRange[]) => rs.map((r) => `${r.from}~${r.to ?? "…"}=${targetKey(r.target)}`);

test("붙일 곳 열쇠 — 오가기", () => {
  for (const t of [P1, CH, COMMON]) assert.deepEqual(parseTargetKey(targetKey(t)), t);
  assert.equal(parseTargetKey(""), null);
  assert.equal(parseTargetKey("fin:"), null);
  assert.equal(parseTargetKey("x:1"), null);
});

test("cutRange — 가운데를 빼면 둘, 끝을 빼면 하나, 안 겹치면 그대로 (시간 칸으로)", () => {
  const r = { from: "2026-11-01T00", to: "2026-11-10T23" };
  assert.deepEqual(cutRange(r, "2026-11-04", "2026-11-05"), [
    { from: "2026-11-01T00", to: "2026-11-03T23" },
    { from: "2026-11-06T00", to: "2026-11-10T23" },
  ]);
  assert.deepEqual(cutRange(r, "2026-11-04T14", "2026-11-04T19"), [
    { from: "2026-11-01T00", to: "2026-11-04T13" },
    { from: "2026-11-04T20", to: "2026-11-10T23" },
  ]);
  assert.deepEqual(cutRange(r, "2026-10-01", "2026-11-03"), [{ from: "2026-11-04T00", to: "2026-11-10T23" }]);
  assert.deepEqual(cutRange(r, "2026-11-08", undefined), [{ from: "2026-11-01T00", to: "2026-11-07T23" }]);
  assert.deepEqual(cutRange(r, "2026-11-11", "2026-11-12"), [r]);
  assert.deepEqual(cutRange(r, "2026-10-01", undefined), []);
  // 끝이 없는 구간의 가운데를 빼면 오른쪽 조각도 끝이 없다
  const open = { from: "2026-11-01T00" };
  assert.deepEqual(cutRange(open, "2026-11-03T05", "2026-11-03T06"), [
    { from: "2026-11-01T00", to: "2026-11-03T04" },
    { from: "2026-11-03T07" },
  ]);
  // 예전 모양(날짜만)도 같은 뜻으로 읽는다
  assert.deepEqual(cutRange({ from: "2026-11-01", to: "2026-11-02" }, "2026-11-02T00", "2026-11-02T00"), [
    { from: "2026-11-01T00", to: "2026-11-01T23" },
    { from: "2026-11-02T01", to: "2026-11-02T23" },
  ]);
});

test("시간 칸 — 자정 · 달 넘김", () => {
  assert.equal(addHours("2026-11-05T23", 1), "2026-11-06T00");
  assert.equal(addHours("2026-11-01T00", -1), "2026-10-31T23");
  assert.equal(isSlot("2026-11-05T23"), true);
  assert.equal(isSlot("2026-11-05T24"), false);
  assert.equal(isSlot("2026-11-05"), false);
  assert.equal(isSlot("2026-13-05T01"), false);
});

test("setRange — 겹치던 구간을 잘라 내고 넣는다 · 한 시간의 답은 하나", () => {
  let rs = setRange([], { from: "2026-11-01", to: "2026-11-10" }, P1, meta, newId);
  assert.deepEqual(spans(rs), ["2026-11-01T00~2026-11-10T23=fin:p1"]);
  rs = setRange(rs, { from: "2026-11-05T19", to: "2026-11-06T04" }, P2, meta, newId);
  assert.deepEqual(spans(rs), ["2026-11-01T00~2026-11-05T18=fin:p1", "2026-11-05T19~2026-11-06T04=fin:p2", "2026-11-06T05~2026-11-10T23=fin:p1"]);
  // 갈라진 두 조각은 id 가 다르다
  assert.equal(new Set(rs.map((r) => r.id)).size, 3);
  // 되돌리기(null) — 잘라 내기만
  rs = setRange(rs, { from: "2026-11-05T19", to: "2026-11-05T19" }, null, meta, newId);
  assert.deepEqual(spans(rs), ["2026-11-01T00~2026-11-05T18=fin:p1", "2026-11-05T20~2026-11-06T04=fin:p2", "2026-11-06T05~2026-11-10T23=fin:p1"]);
  const alloc: ApiKeyAlloc = { hash: "h", name: "k", default: COMMON, ranges: rs };
  assert.equal(targetOn(alloc, "2026-11-05T19").via, "default");
  assert.deepEqual(targetOn(alloc, "2026-11-05T20").target, P2);
  assert.deepEqual(targetOn(alloc, "2026-11-06T04").target, P2);
  assert.deepEqual(targetOn(alloc, "2026-11-06T05").target, P1);
  assert.deepEqual(targetOn(alloc, "2026-11-30").target, COMMON);
  assert.equal(targetOn({ hash: "h", name: "k", ranges: [] }, "2026-11-30").target, null);
});

test("setRange — 시간을 하나씩 붙여도 이어진 같은 곳은 한 구간으로", () => {
  let rs: ApiRange[] = [];
  for (const h of ["2026-11-05T22", "2026-11-05T23", "2026-11-06T00"]) rs = setRange(rs, { from: h, to: h }, CH, meta, newId);
  assert.deepEqual(spans(rs), ["2026-11-05T22~2026-11-06T00=studio:salim"]);
  // 메모가 다르면 합치지 않는다
  rs = setRange(rs, { from: "2026-11-06T01", to: "2026-11-06T01" }, CH, { ...meta, note: "다른 일" }, newId);
  assert.equal(rs.length, 2);
  // 끝이 없는 구간 뒤에 같은 곳을 이으면 끝이 없는 하나
  const open = setRange(setRange([], { from: "2026-11-01", to: "2026-11-02" }, P1, meta, newId), { from: "2026-11-03" }, P1, meta, newId);
  assert.deepEqual(spans(open), ["2026-11-01T00~…=fin:p1"]);
});

test("spansFromSlots — 고른 시간 → 넣을 구간", () => {
  const used = { "2026-11-05": ["14", "16", "17", "19"], "2026-11-06": ["00", "03"], "2026-09-15": [] };
  // 하나만
  assert.deepEqual(spansFromSlots(["2026-11-05T16"], used), [{ from: "2026-11-05T16", to: "2026-11-05T16" }]);
  // 사이에 「안 쓴 시간」(15시)이 끼면 이어 본다
  assert.deepEqual(spansFromSlots(["2026-11-05T14", "2026-11-05T16"], used), [{ from: "2026-11-05T14", to: "2026-11-05T16" }]);
  // 「쓴 시간」(17시)을 안 골랐으면 끊는다
  assert.deepEqual(spansFromSlots(["2026-11-05T16", "2026-11-05T19"], used), [
    { from: "2026-11-05T16", to: "2026-11-05T16" },
    { from: "2026-11-05T19", to: "2026-11-05T19" },
  ]);
  // 쓴 시간을 다 고르면 하루 통째 · 이어진 날은 하나로
  const allDay = ["14", "16", "17", "19"].map((h) => `2026-11-05T${h}`);
  assert.deepEqual(spansFromSlots([...allDay, "2026-11-06T00", "2026-11-06T03"], used), [{ from: "2026-11-05T00", to: "2026-11-06T23" }]);
  // 시간별 금액이 없는 날은 하루 통째
  assert.deepEqual(spansFromSlots(["2026-09-15T00"], used), [{ from: "2026-09-15T00", to: "2026-09-15T23" }]);
  assert.deepEqual(spansFromSlots([], used), []);
});

test("keyDay — 시간에 따라 나눠도 그날 금액이 그대로", () => {
  const day: ApiDayDoc = {
    date: "2026-11-05",
    at: 0,
    keys: [
      {
        hash: "ldj",
        name: "LDJ",
        usd: 10,
        requests: 6,
        models: [],
        hours: {
          "14": { usd: 3.333333, requests: 1, models: ["a"] },
          "19": { usd: 3.333333, requests: 2, models: ["b"] },
          "23": { usd: 3.333333, requests: 3, models: ["c"] },
        },
      },
    ],
  };
  const k = day.keys[0];
  // 정한 게 없으면 한 몫
  let kd = keyDay(day, k, undefined);
  assert.equal(kd.splits.length, 1);
  assert.equal(kd.splits[0].target, null);
  assert.equal(kd.splits[0].usd, 10);
  // 19~23시만 다른 곳 — 기본과 나뉜다
  const alloc: ApiKeyAlloc = { hash: "ldj", name: "LDJ", default: COMMON, ranges: [{ id: "r", from: "2026-11-05T19", to: "2026-11-05T23", target: CH, at: 0 }] };
  kd = keyDay(day, k, alloc);
  assert.deepEqual(kd.splits.map((g) => [g.key, g.requests, g.hourFrom, g.hourTo]), [["studio:salim", 5, "19", "23"], ["common:", 1, "14", "14"]]);
  assert.equal(Math.round(kd.splits.reduce((n, g) => n + g.usd, 0) * 1e6) / 1e6, 10);
  assert.deepEqual(kd.hours.map((h) => [h.slot, targetKey(h.target), h.via]), [
    ["2026-11-05T14", "common:", "default"],
    ["2026-11-05T19", "studio:salim", "range"],
    ["2026-11-05T23", "studio:salim", "range"],
  ]);
  // 시간별 금액이 없는 날은 0시 칸의 답이 하루 전체
  const legacy: ApiDayDoc = { date: "2026-09-15", at: 0, legacy: true, keys: [{ hash: "ldj", name: "LDJ", usd: 7, requests: 2, models: [] }] };
  const whole = keyDay(legacy, legacy.keys[0], { hash: "ldj", name: "LDJ", ranges: [{ id: "r", from: "2026-09-15T00", to: "2026-09-15T23", target: P1, at: 0 }] });
  assert.deepEqual(whole.splits.map((g) => [g.key, g.usd]), [["fin:p1", 7]]);
  assert.equal(whole.hours.length, 0);
  assert.equal(whole.legacy, true);
});

test("dateRuns — 이어진 날 덩어리", () => {
  assert.deepEqual(dateRuns(["2026-11-06", "2026-11-05", "2026-11-08", "2026-11-05", "bad"]), [
    { from: "2026-11-05", to: "2026-11-06" },
    { from: "2026-11-08", to: "2026-11-08" },
  ]);
  // 달이 바뀌어도 이어진다
  assert.deepEqual(dateRuns(["2026-10-31", "2026-11-01"]), [{ from: "2026-10-31", to: "2026-11-01" }]);
});

const day = (date: string, keys: [string, number][], partial = false): ApiDayDoc => ({
  date,
  at: 0,
  keys: keys.map(([hash, usd]) => ({ hash, name: hash.toUpperCase(), usd, requests: 1, models: [{ model: "a/m", requests: 1, usd }] })),
  ...(partial ? { partial: true } : {}),
});

test("costRows · sumByKey · sumByTarget", () => {
  const days = [day("2026-11-04", [["ldj", 1], ["kjy", 2]]), day("2026-11-05", [["ldj", 72.4], ["kjy", 0]]), day("2026-11-06", [["ldj", 0.8]], true)];
  const allocs: Record<string, ApiKeyAlloc> = {
    ldj: { hash: "ldj", name: "LDJ", default: COMMON, ranges: [{ id: "x", from: "2026-11-05", to: "2026-11-06", target: CH, at: 0 }] },
  };
  const rows = costRows(days, allocs);
  // 0 달러 줄은 없다
  assert.equal(rows.length, 4);
  const keys = sumByKey(rows);
  assert.deepEqual(keys.map((k) => [k.hash, k.usd, k.assigned, k.unassigned]), [["ldj", 74.2, 74.2, 0], ["kjy", 2, 0, 2]]);
  const targets = sumByTarget(rows);
  assert.deepEqual(targets.map((t) => [t.key, t.usd, t.partialUsd]), [["studio:salim", 73.2, 0.8], ["common:", 1, 0], ["", 2, 0]]);
  assert.deepEqual(targets[0].keys[0], { hash: "ldj", name: "LDJ", usd: 73.2, from: "2026-11-05", to: "2026-11-06" });
});

test("projectApiCost — 끝난 날만 · 키별 이어진 날 덩어리", () => {
  const days = [
    day("2026-11-02", [["booth", 3]]),
    day("2026-11-03", [["booth", 4]]),
    day("2026-11-07", [["booth", 75.76], ["ldj", 1]]),
    day("2026-11-08", [["booth", 68.4]]),
    day("2026-11-09", [["booth", 5]], true),
  ];
  const allocs: Record<string, ApiKeyAlloc> = {
    booth: { hash: "booth", name: "부스", default: P1, ranges: [] },
    ldj: { hash: "ldj", name: "LDJ", default: P2, ranges: [] },
  };
  const c = projectApiCost(costRows(days, allocs), "p1");
  assert.equal(c.usd, 151.16);
  assert.equal(c.through, "2026-11-08");
  assert.deepEqual(c.parts.map((p) => [p.from, p.to, p.usd]), [["2026-11-02", "2026-11-03", 7], ["2026-11-07", "2026-11-08", 144.16]]);
  const line = apiCostLine(c, 1430, "2026-11-09");
  assert.equal(line.id, API_COST_LINE_ID);
  assert.equal(line.actual, Math.round(151.16 * 1430));
  assert.equal(line.unitPrice, line.actual);
  assert.match(line.note ?? "", /BOOTH 11\/2 ~ 11\/3 \$7\.00 · BOOTH 11\/7 ~ 11\/8 \$144\.16 = \$151\.16 × 1,430원/);
  assert.equal(projectApiCost(costRows(days, allocs), "none").usd, 0);
});

test("나뉜 날 — 줄은 여럿 · 쓴 날은 하루 · 원가에는 그 시간 몫만", () => {
  const days: ApiDayDoc[] = [
    {
      date: "2026-11-05",
      at: 0,
      keys: [{ hash: "ldj", name: "LDJ", usd: 30, requests: 3, models: [], hours: { "14": { usd: 10, requests: 1, models: [] }, "19": { usd: 15, requests: 1, models: [] }, "20": { usd: 5, requests: 1, models: [] } } }],
    },
    { date: "2026-11-06", at: 0, keys: [{ hash: "ldj", name: "LDJ", usd: 4, requests: 1, models: [], hours: { "01": { usd: 4, requests: 1, models: [] } } }] },
  ];
  const allocs: Record<string, ApiKeyAlloc> = {
    ldj: { hash: "ldj", name: "LDJ", default: COMMON, ranges: [{ id: "r", from: "2026-11-05T19", to: "2026-11-06T23", target: P1, at: 0 }] },
  };
  const rows = costRows(days, allocs);
  assert.deepEqual(rows.map((r) => [r.date, targetKey(r.target), r.usd, r.hourFrom ?? null]), [
    ["2026-11-05", "fin:p1", 20, "19"],
    ["2026-11-05", "common:", 10, "14"],
    ["2026-11-06", "fin:p1", 4, null],
  ]);
  const k = sumByKey(rows)[0];
  assert.deepEqual([k.usd, k.days], [34, 2]);
  const c = projectApiCost(rows, "p1");
  assert.equal(c.usd, 24);
  assert.deepEqual(c.parts.map((p) => [p.from, p.to, p.usd]), [["2026-11-05T19", "2026-11-05T20", 20], ["2026-11-06", "2026-11-06", 4]]);
  assert.match(apiCostLine(c, 1000, "2026-11-09").note ?? "", /LDJ 11\/5 19~20시 \$20\.00 · LDJ 11\/6 \$4\.00 = \$24\.00/);
});

test("isManualApiLine — 손으로 적은 AI API 줄만", () => {
  assert.equal(isManualApiLine({ id: "a", category: "AI API", item: "AI 생성 호출" }), true);
  assert.equal(isManualApiLine({ id: "b", category: "툴", item: "API", vendor: "OpenRouter (부스 전용 키)" }), true);
  assert.equal(isManualApiLine({ id: API_COST_LINE_ID, category: "AI API", item: "x" }), false);
  assert.equal(isManualApiLine({ id: "c", category: "포토부스", item: "용지롤" }), false);
});

test("표시 — 달러 · 구간", () => {
  assert.equal(usdText(0), "$0");
  assert.equal(usdText(0.0079), "<$0.01");
  assert.equal(usdText(1234.5), "$1,234.50");
  assert.equal(rangeLabel({ from: "2026-11-05", to: "2026-11-05" }), "11/5");
  assert.equal(rangeLabel({ from: "2026-11-05" }), "11/5 ~ 계속");
  assert.equal(rangeLabel({ from: "2025-12-30", to: "2026-01-02" }, "2026"), "2025/12/30 ~ 1/2");
  assert.equal(rangeLabel({ from: "2026-11-05T00", to: "2026-11-06T23" }), "11/5 ~ 11/6");
  assert.equal(rangeLabel({ from: "2026-11-05T19", to: "2026-11-05T19" }), "11/5 19시");
  assert.equal(rangeLabel({ from: "2026-11-05T19", to: "2026-11-05T23" }), "11/5 19~23시");
  assert.equal(rangeLabel({ from: "2026-11-05T19", to: "2026-11-06T04" }), "11/5 19시 ~ 11/6 4시");
  assert.equal(rangeLabel({ from: "2026-11-05T19" }), "11/5 19시 ~ 계속");
  assert.equal(rangeLabel({ from: "2026-11-05T00", to: "2026-11-05T05" }), "11/5 0~5시");
});

test("replaceApiCostLine — 있던 자리에 · 다른 줄은 그대로 · 고른 손줄만 지움", () => {
  const a = { id: "a", category: "포토부스", item: "용지", qty: 1 };
  const m = { id: "m", category: "AI API", item: "손으로 적음", qty: 1, actual: 100 };
  const old = { id: API_COST_LINE_ID, category: "AI API", item: "옛 줄", qty: 1, actual: 1 };
  const b = { id: "b", category: "인건비", item: "상주", qty: 1 };
  const line = { id: API_COST_LINE_ID, category: "AI API", item: "새 줄", qty: 1, actual: 2 };
  const ids = (x: { lines: { id: string }[] }) => x.lines.map((l) => l.id);

  // 있던 자리를 지킨다
  let r = replaceApiCostLine([a, old, b], line, new Set());
  assert.deepEqual(ids(r), ["a", API_COST_LINE_ID, "b"]);
  assert.equal(r.lines[1].item, "새 줄");
  // 없으면 맨 끝
  assert.deepEqual(ids(replaceApiCostLine([a, b], line, new Set())), ["a", "b", API_COST_LINE_ID]);
  // 0 달러 — 예전 줄만 지운다
  assert.deepEqual(ids(replaceApiCostLine([a, old, b], null, new Set())), ["a", "b"]);
  // 손으로 적은 줄은 고른 것만 · API 줄이 아닌 것은 골라도 안 지운다
  r = replaceApiCostLine([a, m, b], line, new Set(["m", "b"]));
  assert.deepEqual(ids(r), ["a", "b", API_COST_LINE_ID]);
  assert.equal(r.removed, 1);
  assert.deepEqual(ids(replaceApiCostLine([a, m], line, new Set())), ["a", "m", API_COST_LINE_ID]);
});

test("한국 날짜 — UTC 경계 · 달 · 해 넘김", () => {
  // 11/4 15:00 UTC = 11/5 00:00 KST
  assert.equal(kstDate(Date.UTC(2026, 10, 4, 14, 59, 59)), "2026-11-04");
  assert.equal(kstDate(Date.UTC(2026, 10, 4, 15, 0, 0)), "2026-11-05");
  assert.deepEqual(kstDayRange("2026-11-05"), { start: "2026-11-04T15:00:00Z", end: "2026-11-05T14:59:59Z" });
  assert.deepEqual(kstDayRange("2026-11-01"), { start: "2026-10-31T15:00:00Z", end: "2026-11-01T14:59:59Z" });
  assert.deepEqual(kstDayRange("2027-01-01"), { start: "2026-12-31T15:00:00Z", end: "2027-01-01T14:59:59Z" });
  // 11/9 00:30 KST 에는 어제가 11/8 — UTC 로는 아직 11/8 인 시각
  assert.equal(lastCompletedDay(Date.UTC(2026, 10, 8, 15, 30)), "2026-11-08");
  assert.equal(lastCompletedDay(Date.UTC(2026, 10, 8, 14, 30)), "2026-11-07");
});

test("dayFromAnalytics — 시간 줄을 키 · 모델별로 모은다", () => {
  const rows = [
    { date__hour: "2026-11-04 15:00:00", api_key_id: "LDJ", model: "kwaivgi/kling-v3.0-pro-20260429", total_usage: 1.5, request_count: "2" },
    { date__hour: "2026-11-05 14:00:00", api_key_id: "LDJ", model: "kwaivgi/kling-v3.0-pro-20260429", total_usage: 2.25, request_count: "1" },
    { date__hour: "2026-11-05 03:00:00", api_key_id: "LDJ", model: "openai/gpt-image-2", total_usage: 10, request_count: "5" },
    { date__hour: "2026-11-05 03:00:00", api_key_id: "만료키", model: "a/b", total_usage: 0.1, request_count: "1" },
    { date__hour: "2026-11-05 03:00:00", api_key_id: "빈줄", model: "a/b", total_usage: 0, request_count: "0" },
  ];
  const d = dayFromAnalytics("2026-11-05", rows, (n) => (n === "LDJ" ? "hash-ldj" : `gone-${n}`), 7);
  assert.deepEqual(d.keys.map((k) => [k.hash, k.name, k.usd, k.requests]), [["hash-ldj", "LDJ", 13.75, 8], ["gone-만료키", "만료키", 0.1, 1]]);
  assert.deepEqual(d.keys[0].models, [
    { model: "openai/gpt-image-2", requests: 5, usd: 10 },
    { model: "kwaivgi/kling-v3.0-pro", requests: 3, usd: 3.75 },
  ]);
  // 시간 칸은 한국 시각으로 — 15시 UTC = 0시 KST · 14시 UTC = 23시 KST · 3시 UTC = 12시 KST
  assert.deepEqual(d.keys[0].hours, {
    "00": { usd: 1.5, requests: 2, models: ["kling-v3.0-pro"] },
    "23": { usd: 2.25, requests: 1, models: ["kling-v3.0-pro"] },
    "12": { usd: 10, requests: 5, models: ["gpt-image-2"] },
  });
  // 일 단위로 받은 줄에는 시간 칸이 없다
  assert.equal(dayFromAnalytics("2026-09-15", [{ api_key_id: "LDJ", model: "a/b", total_usage: 1, request_count: 1 }], (n) => n, 0).keys[0].hours, undefined);
  assert.equal(cleanModel("google/gemini-3-flash-preview-20251217"), "google/gemini-3-flash-preview");
  assert.equal(cleanModel("openai/gpt-image-2"), "openai/gpt-image-2");
});
