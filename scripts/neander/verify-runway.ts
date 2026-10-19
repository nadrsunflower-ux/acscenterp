// ============================================================
//  런웨이 계산 검증 — lib/neander/finance/runway.ts
// ------------------------------------------------------------
//  1부: 손으로 셀 수 있는 작은 장부로 계산 규칙을 하나씩 확인한다.
//  2부(--real): Firestore 실데이터로 굴려 숫자를 찍는다 — 리포트 지출상세의
//       같은 달 순수지출과 맞는지 함께 본다.
//
//    npm run finance:verify-runway
//    npm run finance:verify-runway -- --real
// ============================================================

import { config } from "dotenv";
config({ path: ".env.local" });
import type { FinPaymentMethodDoc } from "@/lib/neander/finance/db-types";
import type { FinProjectDoc } from "@/lib/neander/finance/project";
import { approxDueDate, dueLabel, partOfDate, sanitizeInstallment } from "@/lib/neander/finance/project";
import type { FinTransaction } from "@/lib/neander/finance/types";
import {
  buildRunway,
  defaultAsOf,
  DEFAULT_RUNWAY,
  defaultCutFrom,
  requiredSaving,
  sanitizeRunway,
  simulateRunway,
  type RunwaySettings,
} from "@/lib/neander/finance/runway";

let fails = 0;
const ok = (cond: boolean, label: string, detail = "") => {
  if (!cond) fails++;
  console.log(cond ? "ok  " : "FAIL", label, cond ? "" : detail);
};
const eq = (got: unknown, want: unknown, label: string) =>
  ok(JSON.stringify(got) === JSON.stringify(want), label, `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);

let seq = 0;
const tx = (date: string, txType: FinTransaction["txType"], gross: number, o: Partial<FinTransaction> = {}) =>
  ({ id: `t${seq++}`, date, txType, gross, adjust: 0, status: "confirmed", dedupHash: "", createdAt: 0, ...o }) as FinTransaction;

const pm = (last4: string, kind: "account" | "card" | "cash", o: Partial<FinPaymentMethodDoc> = {}) =>
  ({ id: last4, last4, alias: `계좌${last4}`, site: "네안데르", personal: false, kind, ...o }) as FinPaymentMethodDoc;

const settings = (o: Partial<RunwaySettings> = {}): RunwaySettings => ({ ...DEFAULT_RUNWAY, ...o });

function unit() {
  console.log("=== 1부 · 작은 장부 ===");
  const pms = [pm("1111", "account"), pm("2222", "card"), pm("3333", "cash"), pm("9999", "account", { alias: "우리대출", monthly: false })];
  const T: FinTransaction[] = [
    // 7~9월: 와우 매출 300 · 인건비 400(통장) · 운영비 카드 60 · 카드대금 60 · B2B 0/900/0
    ...["2026-07", "2026-08", "2026-09"].flatMap((m) => [
      tx(`${m}-05`, "수입", 300, { acctMajor: "매출", acctMid: "B2C매출", bizMajor: "B2C", bizMinor: "와우", last4: "1111" }),
      tx(`${m}-10`, "지출", 400, { acctMajor: "인건비", last4: "1111" }),
      tx(`${m}-12`, "지출", 60, { acctMajor: "운영비", last4: "2222" }),
      tx(`${m}-15`, "카드대금결제", 60, { last4: "1111" }),
      tx(`${m}-16`, "자금거래", 5_000, { acctMajor: "계좌간이동", last4: "1111" }),
    ]),
    tx("2026-08-20", "수입", 900, { acctMajor: "매출", acctMid: "B2B매출", bizMajor: "B2B", last4: "1111" }),
    // 개인사용 · 환급 · 기타수입
    tx("2026-09-03", "지출", 30, { acctMajor: "운영비", last4: "2222", personalUse: true }),
    tx("2026-09-04", "환급", 15, { acctMajor: "운영비", last4: "2222" }),
    tx("2026-09-06", "수입", 90, { acctMajor: "기타수입", acctMid: "지원금", bizMajor: "공용", last4: "1111" }),
    // 다른 사업장
    tx("2026-09-07", "지출", 300, { acctMajor: "운영비", site: "와작홈즈", last4: "1111" }),
    // 잔액 — 9/30 이 마지막, 10월 거래는 기준 달 밖
    tx("2026-09-29", "수입", 1, { acctMajor: "기타수입", acctMid: "이자수입", last4: "1111", balanceAfter: 1_000 }),
    tx("2026-09-30", "수입", 1, { acctMajor: "기타수입", acctMid: "이자수입", last4: "1111", balanceAfter: 1_200 }),
    tx("2026-10-02", "지출", 1, { acctMajor: "운영비", last4: "1111", balanceAfter: 50 }),
  ];
  const projects = [
    {
      id: "p1", code: "P1", name: "제이진", status: "active", contractAmount: 1_000, vatMode: "excluded",
      installments: [
        { id: "i1", kind: "선금", amount: 400, paidDate: "2026-08-20" },
        { id: "i2", kind: "중도금", amount: 300, dueDate: "2026-12-15" },
        { id: "i3", kind: "잔금", amount: 300 },
      ],
      revenues: [], lines: [], createdAt: 0,
    },
    { id: "p2", code: "P2", name: "FNC", status: "planning", contractAmount: 550, vatMode: "included", revenues: [], lines: [], createdAt: 0 },
    {
      id: "p3", code: "P3", name: "연체", status: "done", contractAmount: 200, vatMode: "exempt",
      installments: [{ id: "i4", kind: "잔금", amount: 200, dueDate: "2026-08-31" }],
      revenues: [], lines: [], createdAt: 0,
    },
    { id: "p4", code: "P4", name: "취소", status: "cancelled", contractAmount: 9_999, revenues: [], lines: [], createdAt: 0 },
  ] as unknown as FinProjectDoc[];

  eq(defaultAsOf(T, "2026-10"), "2026-09", "기준 달 — 이번 달(10월) 거래가 있어도 지난달");
  eq(defaultAsOf(T, "2026-11"), "2026-10", "기준 달 — 끝난 달 중 마지막");

  const r = buildRunway({ transactions: T, paymentMethods: pms, projects, settings: settings({ excludeSites: ["와작홈즈"] }), asOf: "2026-09", today: "2026-10-19" });
  eq(r.baseMonths, ["2026-07", "2026-08", "2026-09"], "평균 낸 달");
  eq(r.months[0], "2026-10", "내다보는 첫 달");
  eq(r.months.length, 12, "내다보는 달 수");

  const line = (k: string) => r.lines.find((l) => l.key === k);
  eq(line("in:biz:와우")?.avg, 300, "와우 매출 평균");
  eq(line("out:인건비")?.avg, 400, "인건비 평균");
  // 운영비: 카드 60×3 − 환급 15 = 165, 개인사용 30 은 빠진다 → 55
  eq(line("out:운영비")?.avg, 55, "운영비 — 카드 사용 포함 · 개인사용 제외 · 환급 차감");
  eq(line("in:etc:지원금")?.on, false, "지원금은 기본으로 안 넣는다");
  ok(!r.lines.some((l) => l.label.includes("B2B")), "B2B 는 평균 줄에 없다");
  ok(!r.lines.some((l) => l.key.includes("계좌간이동")), "자금거래는 세지 않는다");
  eq(r.b2bAvg, 300, "B2B 최근 평균 (900 / 3)");

  eq(r.cash.map((c) => [c.last4, c.used, c.ledgerDate]), [["1111", 1_200, "2026-09-30"], ["3333", 0, null]], "시작 현금 — 9월 말 잔액 · 카드·대출 제외 · 현금은 0");
  eq(r.openingCash, 1_200, "시작 현금 합계");

  const inflow = (id: string) => r.inflows.find((f) => f.id === id);
  eq([inflow("i2")?.amount, inflow("i2")?.month, inflow("i2")?.status], [330, "2026-12", "scheduled"], "회차 — 부가세 별도 300 → 330 이 12월에");
  eq([inflow("i3")?.status, inflow("i3")?.included], ["undated", false], "날짜 없는 회차는 안 넣는다");
  eq([inflow("i4")?.month, inflow("i4")?.status, inflow("i4")?.included], ["2026-10", "overdue", true], "연체는 첫 달에 넣는다");
  eq([inflow("project:p2")?.amount, inflow("project:p2")?.status], [550, "undated"], "회차 없는 계약 — 부가세 포함 그대로 · 날짜 미정");
  ok(!r.inflows.some((f) => f.projectId === "p4"), "취소한 프로젝트는 없다");

  // 월 흐름: 수입 300(와우) + 이자 2/3≈1 → etc 는 기본 off. 지출 400+55 = 455 → 순 −155
  eq([r.baseIncome, r.baseExpense, r.baseNet], [300, 455, -155], "반복 줄만의 월 흐름");
  const oct = r.rows[0];
  eq([oct.opening, oct.b2b, oct.closing], [1_200, 200, 1_200 + 300 + 200 - 455], "10월 — 연체 200 이 들어온다");
  eq(oct.closingAlt, 1_200 + 300 + 300 - 455, "10월 평소 수주 — B2B 가 평균(300)보다 적으면 평균");
  const dec = r.rows[2];
  eq(dec.b2b, 330, "12월 — 중도금");
  eq(dec.b2bAlt, 330, "12월 평소 수주 — 평균보다 크면 그대로");

  // 바닥: 10월 1245 → 11월 1090 → 12월 1265 → 이후 −155/월
  // 1265 / 155 = 8.16… → 12월(3번째 달) 뒤 8.16개월 = 11.16
  const want = 3 + 1265 / 155;
  ok(Math.abs((r.outcome.months ?? 0) - want) < 1e-9, "런웨이 개월 (소수)", `got ${r.outcome.months} want ${want}`);
  eq(r.outcome.zeroMonth, "2027-09", "바닥나는 달");

  // 가정: 12월부터 와우 0 · 11월 권리금 +500 · 사업장을 빼지 않으면 와작 지출도 들어온다
  const r2 = buildRunway({
    transactions: T, paymentMethods: pms, projects, asOf: "2026-09", today: "2026-10-19",
    settings: settings({
      excludeSites: ["와작홈즈"],
      overrides: [{ id: "o1", lineKey: "in:biz:와우", from: "2026-12", amount: 0 }],
      items: [{ id: "x1", label: "권리금", flow: "in", amount: 500, from: "2026-11", to: "2026-11" }],
      skipInflows: ["i4"],
    }),
  });
  eq(r2.lines.find((l) => l.key === "in:biz:와우")?.values.slice(0, 3), [300, 300, 0], "가정 — 12월부터 와우 매출 0");
  eq(r2.lines.find((l) => l.key === "in:biz:와우")?.overridden.slice(0, 3), [false, false, true], "가정이 걸린 달 표시");
  eq(r2.items[0].values.slice(0, 3), [0, 500, 0], "가정 — 11월 한 번 500");
  eq(r2.rows[0].b2b, 0, "뺀 연체 회차는 안 들어온다");

  const r3 = buildRunway({ transactions: T, paymentMethods: pms, projects, settings: settings(), asOf: "2026-09", today: "2026-10-19" });
  eq(r3.lines.find((l) => l.key === "out:운영비")?.avg, 155, "사업장을 빼지 않으면 와작 지출 300 도 평균에 (55 + 100)");

  // 처음부터 빚이면 0개월
  const r4 = buildRunway({ transactions: T, paymentMethods: pms, projects: [], settings: settings({ cash: { "1111": -10 } }), asOf: "2026-09", today: "2026-10-19" });
  eq([r4.outcome.months, r4.outcome.zeroMonth], [0, "2026-10"], "시작 현금이 음수면 0개월");
  eq(r4.cash.find((c) => c.last4 === "1111")?.used, -10, "직접 적은 잔액이 장부보다 먼저");

  // ---- 줄여 보기 ----
  const tree = (path: string) => {
    const find = (list: typeof r.expenseTree): (typeof r.expenseTree)[number] | undefined =>
      list.map((x) => (x.path === path ? x : find(x.children))).find(Boolean);
    return find(r.expenseTree);
  };
  eq(tree("인건비")?.avg, 400, "지출 트리 — 대분류 평균");
  eq(tree("운영비|(미분류)|(미분류)")?.avg, 55, "지출 트리 — 소분류까지 (환급 차감 · 개인사용 제외)");
  const none = simulateRunway(r, null);
  eq(none.rows.map((x) => x.closing), r.rows.map((x) => x.closing), "줄이기 없으면 예측 그대로");
  const s1 = simulateRunway(r, { cuts: [{ path: "인건비", pct: 50, from: "2026-11" }] });
  eq(s1.rows.slice(0, 3).map((x) => x.saving), [0, 200, 200], "인건비 50% 를 11월부터 — 10월은 그대로");
  eq(s1.rows[2].closing, r.rows[2].closing + 400, "아낀 돈이 쌓인다");
  eq(s1.savingByPath.get("인건비"), 200, "계정별 아끼는 돈");
  eq(s1.savingFull, 200, "다 시작된 뒤 월 아끼는 돈");
  ok((s1.outcome.months ?? 99) > (r.outcome.months ?? 0), "줄이면 런웨이가 는다");
  const s2 = simulateRunway(r, {
    cuts: [
      { path: "인건비", pct: 50, from: "2026-10" },
      { path: "인건비|(미분류)", pct: 0, from: "2026-12" },
    ],
  });
  eq(s2.rows.slice(0, 3).map((x) => x.saving), [200, 200, 0], "아래 단계 0% 가 시작되면 그 아래는 안 줄인다");
  const r5 = buildRunway({
    transactions: T, paymentMethods: pms, projects, asOf: "2026-09", today: "2026-10-19",
    settings: settings({ excludeSites: ["와작홈즈"], overrides: [{ id: "o", lineKey: "out:운영비", from: "2026-12", amount: 0 }] }),
  });
  const s3 = simulateRunway(r5, { cuts: [{ path: "운영비", pct: 100, from: "2026-10" }] });
  eq(s3.rows.slice(0, 3).map((x) => x.saving), [55, 55, 0], "가정으로 0원이 된 달은 아낄 것도 없다");
  eq(requiredSaving(r, none, 6, "booked", "2026-10"), 0, "목표 역산 — 이미 버티면 0");
  // 12개월(끝까지) 버티려면: 마지막 달 1265 − 155×9 = −130 → 12달에 나눠 10.8… → 만원 단위로 올림
  eq(requiredSaving(r, none, 12, "booked", "2026-10"), 10_000, "목표 역산 — 끝까지 버티려면");
  const neg = buildRunway({ transactions: T, paymentMethods: pms, projects: [], settings: settings({ cash: { "1111": -10 } }), asOf: "2026-09", today: "2026-10-19" });
  eq(requiredSaving(neg, simulateRunway(neg, null), 3, "booked", "2026-10"), null, "목표 역산 — 시작부터 빚이면 줄이기로는 안 된다");
  eq(defaultCutFrom(r.months, "2026-10"), "2026-11", "줄이기 기본 시작 — 다음 달");

  // ---- 대략 받을 날 (「10월 말」) ----
  eq([approxDueDate("2026-10", "early"), approxDueDate("2026-10", "mid"), approxDueDate("2026-10", "late"), approxDueDate("2027-02", "late")],
    ["2026-10-10", "2026-10-20", "2026-10-31", "2027-02-28"], "대략 → 구간 끝 날 (초 10 · 중 20 · 말 말일)");
  eq(dueLabel({ dueDate: "2026-10-31", dueApprox: "late" }), "2026년 10월 말", "대략 글자");
  eq(dueLabel({ dueDate: "2026-10-31" }), "2026-10-31", "정확한 날은 그대로");
  eq([partOfDate("2026-10-03"), partOfDate("2026-10-15"), partOfDate("2026-10-21")], ["early", "mid", "late"], "날짜 → 초·중·말");
  const si = sanitizeInstallment({ id: "x", kind: "잔금", amount: 1, dueDate: "2026-11-02", dueApprox: "mid" });
  eq([si.dueDate, si.dueApprox], ["2026-11-20", "mid"], "저장할 때 대략이면 날짜를 구간 끝 날로 맞춘다");
  eq(sanitizeInstallment({ id: "x", kind: "잔금", amount: 1, dueApprox: "late" }).dueApprox, undefined, "날짜 없는 대략은 버린다");
  eq(sanitizeInstallment({ id: "x", kind: "잔금", amount: 1, dueDate: "2026-11-02", dueApprox: "soon" as never }).dueApprox, undefined, "모르는 구간은 버린다");
  const rApprox = buildRunway({
    transactions: T, paymentMethods: pms, asOf: "2026-09", today: "2026-10-19", settings: settings(),
    projects: [{ ...projects[0], installments: [{ id: "a1", kind: "잔금", amount: 300, dueDate: "2026-11-30", dueApprox: "late" }] }] as FinProjectDoc[],
  });
  const fa = rApprox.inflows.find((f) => f.id === "a1");
  eq([fa?.month, fa?.status, fa?.dueApprox], ["2026-11", "scheduled", "late"], "대략 받을 날도 그 달에 들어온다");

  // 저장 다듬기
  const s = sanitizeRunway({
    baseMonths: 5, horizon: 18,
    overrides: [{ lineKey: "in:biz:와우", from: "2026-13x", amount: 1 }, { lineKey: "out:인건비", from: "2027-01", amount: -300 }],
    items: [{ label: "x", flow: "in", amount: "1200", from: "2026-11", to: "2026-10" }],
    cash: { "1111": "", "3333": "50000", "4444": null },
    lineToggles: { a: true, b: "yes" },
    hacker: 1,
    scenarios: [{ name: "", cuts: [{ path: "인건비", pct: 130, from: "2026-11" }, { path: "인건비", pct: 10, from: "2026-11" }, { path: "운영비", pct: 10, from: "x" }] }],
  });
  eq([s.baseMonths, s.horizon], [3, 18], "다듬기 — 허용 안 된 평균 기간은 기본값");
  eq(s.overrides.map((o) => [o.from, o.amount]), [["2027-01", 300]], "다듬기 — 틀린 달은 버리고 금액은 양수");
  eq([s.items[0].amount, s.items[0].to], [1200, undefined], "다듬기 — 끝 달이 시작보다 앞이면 끝까지");
  eq(s.cash, { "3333": 50000 }, "다듬기 — 빈 잔액은 버린다");
  eq(s.lineToggles, { a: true }, "다듬기 — 켜고 끄기는 참·거짓만");
  ok(!("hacker" in s), "다듬기 — 모르는 칸은 버린다");
  eq(s.scenarios.map((x) => [x.name, x.cuts]), [["시나리오 1", [{ path: "인건비", pct: 100, from: "2026-11" }]]], "다듬기 — 시나리오 (100% 상한 · 같은 경로는 하나 · 틀린 달 버림)");
}

async function real() {
  console.log("\n=== 2부 · 실데이터 ===");
  const { initializeApp, cert } = await import("firebase-admin/app");
  const { getFirestore } = await import("firebase-admin/firestore");
  const { buildReport, makeIsCard } = await import("@/lib/neander/finance/report");
  const { NEANDER_COL } = await import("@/lib/neander/collections");
  const { runwayFromDoc } = await import("@/lib/neander/finance/runway");
  const sa = JSON.parse(Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_B64!, "base64").toString("utf8"));
  initializeApp({ credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey: sa.private_key }) });
  const db = getFirestore();
  const [txs, pms, prj, rw] = await Promise.all([
    db.collection(NEANDER_COL.finTransactions).get(),
    db.collection(NEANDER_COL.finPaymentMethods).get(),
    db.collection(NEANDER_COL.finProjects).get(),
    db.collection(NEANDER_COL.finRunway).doc("main").get(),
  ]);
  const transactions = txs.docs.map((d) => ({ id: d.id, ...d.data() }) as FinTransaction);
  const paymentMethods = pms.docs.map((d) => ({ id: d.id, ...d.data() }) as FinPaymentMethodDoc);
  const projects = prj.docs.map((d) => ({ id: d.id, ...d.data() }) as FinProjectDoc);
  const saved = rw.exists ? runwayFromDoc(rw.data()) : DEFAULT_RUNWAY;
  const asOf = defaultAsOf(transactions, new Date().toISOString().slice(0, 7));
  const r = buildRunway({ transactions, paymentMethods, projects, settings: saved, asOf, today: new Date().toISOString().slice(0, 10) });
  const man = (v: number) => `${Math.round(v / 10_000).toLocaleString("ko-KR")}만`;

  console.log("기준 달", r.asOf, "· 평균", r.baseMonths.join(","), "· 저장된 가정", rw.exists ? "있음" : "없음");
  console.log("\n시작 현금", man(r.openingCash));
  r.cash.forEach((c) => console.log("  ", c.last4, c.alias.padEnd(10), (c.site ?? "").padEnd(8), man(c.used).padStart(8), c.ledgerDate ?? "(잔액 없음)"));
  console.log("\n줄 (평균/월)");
  r.lines.forEach((l) => console.log("  ", l.flow, l.on ? "on " : "off", l.label.padEnd(14), man(l.avg).padStart(8), l.base.map(man).join(" / ")));
  console.log("   B2B 평균", man(r.b2bAvg), r.b2bBase.map(man).join(" / "));
  console.log("\n반복 수입", man(r.baseIncome), "· 반복 지출", man(r.baseExpense), "· 월 순흐름", man(r.baseNet));
  console.log("\n프로젝트 받을 돈");
  r.inflows.forEach((f) => console.log("  ", f.status.padEnd(9), f.included ? "넣음" : "    ", f.code.padEnd(14), f.kind, man(f.amount).padStart(7), f.dueDate ?? "-"));
  console.log("\n달마다");
  r.rows.forEach((m) => console.log("  ", m.month, "기초", man(m.opening).padStart(8), "수입", man(m.income).padStart(7), "지출", man(m.expense).padStart(7), "기말", man(m.closing).padStart(8), "평소수주", man(m.closingAlt).padStart(8)));
  const f = (o: typeof r.outcome) => (o.months === null ? `${r.months.length}개월 넘게` : `${o.months.toFixed(1)}개월 (${o.zeroMonth} 중 바닥)`);
  console.log("\n런웨이 확정", f(r.outcome), "· 평소 수주", f(r.outcomeAlt));

  const none = simulateRunway(r, null);
  const from = defaultCutFrom(r.months, new Date().toISOString().slice(0, 7));
  for (const target of [3, 6, 12]) {
    const a = requiredSaving(r, none, target, "booked", from);
    const b = requiredSaving(r, none, target, "usual", from);
    console.log(`${target}개월 버티려면 ${from}부터 매달 더 줄일 돈 — 잡힌 돈만 ${a === null ? "불가" : man(a)} · 평소 수주 ${b === null ? "불가" : man(b)}`);
  }
  const demo = simulateRunway(r, {
    cuts: [
      { path: "인건비|급여|임원급여", pct: 50, from },
      { path: "운영비|일반운영비|구독서비스비", pct: 50, from },
      { path: "운영비|차량관리비", pct: 100, from },
    ],
  });
  console.log("예시(임원급여 50 · 구독 50 · 차량 100):", "월", man(demo.savingFull), "· 확정", f(demo.outcome), "· 평소", f(demo.outcomeAlt));

  // 리포트 지출상세(발생주의)의 순수지출과 줄 합계가 맞는가 — 기준 달 하나로
  const isCard = makeIsCard(paymentMethods);
  const rep = buildReport(transactions, { basis: "accrual", isCard, scope: { month: r.asOf } });
  const idx = r.baseMonths.indexOf(r.asOf);
  const lineOut = r.lines.filter((l) => l.flow === "out").reduce((s, l) => s + l.base[idx], 0);
  const lineIn = r.lines.filter((l) => l.flow === "in").reduce((s, l) => s + l.base[idx], 0) + r.b2bBase[idx];
  ok(Math.round(lineOut) === Math.round(rep.total.expensePure), `${r.asOf} 지출 줄 합계 = 리포트 순수지출`, `${lineOut} vs ${rep.total.expensePure}`);
  ok(Math.round(lineIn) === Math.round(rep.total.income), `${r.asOf} 수입 줄 + B2B = 리포트 수입`, `${lineIn} vs ${rep.total.income}`);
}

(async () => {
  unit();
  if (process.argv.includes("--real")) await real();
  console.log(fails ? `\n${fails}건 실패` : "\n전부 통과");
  process.exit(fails ? 1 : 0);
})();
