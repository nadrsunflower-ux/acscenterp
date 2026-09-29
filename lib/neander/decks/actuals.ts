// ============================================================
//  실측값 — ERP 원자료에서 장표에 쓰는 숫자를 만든다 (순수 함수)
// ------------------------------------------------------------
//  서버(server/load.ts)가 Firestore 에서 읽은 원자료를 그대로 넘긴다.
//  규칙에 들어가는 이름·환산표·기간은 장표 내용(DeckActualRules)에서 온다.
//  이 파일에는 **방법**만 있다 — 학원 이름이나 금액은 없다.
//
//  스모트
//    · 내부·테스트 결제(이름 목록, MANUAL_GRANT 수기 지급)는 뺀다.
//    · 학원 이름이 「-」 이거나 빈 결제는 「이름 없는 입금」으로 따로 센다.
//      매출에는 넣고, 학원 통계(학원 수·월 지출·재구매)에는 넣지 않는다.
//    · 크레딧은 결제액을 환산표로 바꾼 값이다. 사이트 기록의 크레딧에는
//      보너스가 섞여 있어(150 → 225C) 구매량으로 쓰면 필요량이 부푼다.
//  재무
//    · B2B 는 거래유형 수입 · 계정중분류 B2B매출, 장부 마지막 달까지 12개월.
//    · 지원금은 지원금 · 인건비환급(차감) · 환불수입 중 인건비환급.
//    · 월 지출은 최근 6개월 지출 − 환급에서 부가세 납부와 카드대금결제를 뺀다.
//      카드대금결제 지출은 카드 명세 줄과 겹치는 중복 의심이다 (9/21 집계 기준).
// ============================================================

import { addMonth } from "@/lib/neander/months";
import type {
  AcademyActual,
  DeckActualRules,
  FinanceActuals,
  ProjectActual,
  SmoatActuals,
  SmoatMonthActual,
} from "./types";

/** 두 달 사이 개월 수 (양 끝 포함) — "2026-06" ~ "2026-09" → 4 */
export function monthsInclusive(from: string, to: string): number {
  const [y1, m1] = from.split("-").map(Number);
  const [y2, m2] = to.split("-").map(Number);
  return (y2 - y1) * 12 + (m2 - m1) + 1;
}

export function monthRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let m = from; m <= to; m = addMonth(m, 1)) out.push(m);
  return out;
}

// ============================================================
//  스모트
// ============================================================

/** 동기화된 결제 한 줄 — lib/neander/smoat/types.ts 의 SmoatSale 과 같은 모양 */
export interface RawSmoatSale {
  id: string;
  date: string;
  gross: number;
  amount: number;
  status: string;
  accountId: string;
  accountName: string;
  credits?: number;
  syncedAt?: number;
}

export interface RawSmoatCost {
  id: string;
  aiKrw: number;
  creditsSold: number;
  creditsUsed: number;
  syncedAt?: number;
}

type SaleClass = "internal" | "unnamed" | "academy";

export function classifySale(s: RawSmoatSale, rules: DeckActualRules["smoat"]): SaleClass {
  const name = (s.accountName ?? "").trim();
  if (rules.excludeStatuses.includes(s.status)) return "internal";
  if (rules.excludeNames.includes(name)) return "internal";
  if (!name || rules.unnamedNames.includes(name)) return "unnamed";
  return "academy";
}

/** 결제액 → 크레딧. 환산표에 없는 금액은 사이트 기록의 크레딧을 쓴다 */
export function creditsOf(s: RawSmoatSale, table: DeckActualRules["smoat"]["creditTable"]): number {
  const hit = table.find((t) => t.price === s.gross);
  return hit ? hit.credits : s.credits ?? 0;
}

export function computeSmoatActuals(
  sales: RawSmoatSale[],
  costs: RawSmoatCost[],
  rules: DeckActualRules["smoat"],
  asOf: string,
): SmoatActuals {
  const paid = sales.filter((s) => s.amount > 0 && /^\d{4}-\d{2}-\d{2}$/.test(s.date));
  if (paid.length === 0) throw new Error("스모트 결제가 없습니다.");
  const cls = new Map(paid.map((s) => [s.id, classifySale(s, rules)] as const));
  const lastMonth = paid.map((s) => s.date.slice(0, 7)).sort().at(-1)!;
  const baseMonth = rules.baseMonth ?? lastMonth;
  const firstMonth = paid.map((s) => s.date.slice(0, 7)).sort()[0];

  // ---- 월별 ----
  const months: SmoatMonthActual[] = monthRange(firstMonth, baseMonth).map((month) => {
    const rows = paid.filter((s) => s.date.startsWith(month));
    const sum = (c?: SaleClass) => rows.filter((s) => !c || cls.get(s.id) === c).reduce((t, s) => t + s.amount, 0);
    return {
      month,
      dashboard: sum(),
      internal: sum("internal"),
      unnamed: sum("unnamed"),
      academies: sum("academy"),
      payments: rows.filter((s) => cls.get(s.id) === "academy").length,
    };
  });

  // ---- 학원별 ----
  const academyRows = paid
    .filter((s) => cls.get(s.id) === "academy" && s.date.slice(0, 7) <= baseMonth)
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const byAcademy = new Map<string, RawSmoatSale[]>();
  for (const s of academyRows) {
    const key = s.accountId || `name:${s.accountName.trim()}`;
    byAcademy.set(key, [...(byAcademy.get(key) ?? []), s]);
  }
  const academies: AcademyActual[] = [...byAcademy.entries()].map(([id, rows]) => {
    const first = rows[0];
    const fm = first.date.slice(0, 7);
    const n = monthsInclusive(fm, baseMonth);
    const total = rows.reduce((t, s) => t + s.amount, 0);
    const credits = rows.reduce((t, s) => t + creditsOf(s, rules.creditTable), 0);
    const distinctMonths = new Set(rows.map((s) => s.date.slice(0, 7)));
    return {
      id,
      name: rows.map((s) => s.accountName.trim()).find(Boolean) ?? "",
      payments: rows.length,
      total,
      firstMonth: fm,
      lastDate: rows[rows.length - 1].date,
      months: n,
      monthlySpend: total / n,
      credits,
      monthlyCredits: credits / n,
      repeat: distinctMonths.size > 1,
      upgraded: rows.slice(1).some((s) => s.gross > first.gross),
    };
  });
  academies.sort((a, b) => b.monthlySpend - a.monthlySpend || b.total - a.total);

  const totalAcademy = academies.reduce((t, a) => t + a.total, 0);
  const unnamedRows = paid.filter((s) => cls.get(s.id) === "unnamed" && s.date.slice(0, 7) <= baseMonth);

  // ---- 재구매 ----
  const cohort = academies.filter((a) => a.firstMonth >= rules.repurchaseFrom && a.firstMonth <= rules.repurchaseTo);
  const repeaters = cohort.filter((a) => a.repeat);

  // ---- AI 원가 ----
  const costRows = costs.filter((c) => c.id >= rules.aiCostFrom && c.id <= baseMonth);
  const krw = costRows.reduce((t, c) => t + (c.aiKrw || 0), 0);
  const used = costRows.reduce((t, c) => t + (c.creditsUsed || 0), 0);
  const sold = costRows.reduce((t, c) => t + (c.creditsSold || 0), 0);

  // ---- 월평균·최고 월 (실제 학원 결제) ----
  // 첫 학원 결제가 있던 달부터 기준 달까지 — 그 사이 결제 없는 달도 0 으로 센다
  const avgFrom = months.find((m) => m.academies > 0)?.month ?? baseMonth;
  const span = months.filter((m) => m.month >= avgFrom);
  const avgMonthly = span.length ? span.reduce((t, m) => t + m.academies, 0) / span.length : 0;
  const peak = span.reduce((a, b) => (b.academies > a.academies ? b : a), span[0] ?? months[months.length - 1]);
  const base = months.find((m) => m.month === baseMonth);

  return {
    asOf,
    baseMonth,
    months,
    academies,
    unnamed: { payments: unnamedRows.length, total: unnamedRows.reduce((t, s) => t + s.amount, 0) },
    totals: {
      academies: academies.length,
      payments: academies.reduce((t, a) => t + a.payments, 0),
      total: totalAcademy,
    },
    repurchase: {
      from: rules.repurchaseFrom,
      to: rules.repurchaseTo,
      cohort: cohort.length,
      repeat: repeaters.length,
      upgraded: repeaters.filter((a) => a.upgraded).length,
    },
    aiCost: {
      from: costRows.map((c) => c.id).sort()[0] ?? rules.aiCostFrom,
      to: costRows.map((c) => c.id).sort().at(-1) ?? baseMonth,
      krw,
      creditsUsed: used,
      creditsSold: sold,
      perCredit: used > 0 ? krw / used : 0,
      freeShare: used > 0 ? Math.max(0, 1 - sold / used) : 0,
    },
    revMonth: base ? base.academies + base.unnamed : 0,
    baseAiKrw: costs.find((c) => c.id === baseMonth)?.aiKrw ?? null,
    avgMonthly,
    avgFrom,
    peak: { month: peak?.month ?? baseMonth, amount: peak?.academies ?? 0 },
    topShare: totalAcademy > 0 ? Math.max(...academies.map((a) => a.total)) / totalAcademy : 0,
    packMix: [...new Set(academyRows.map((s) => s.gross))]
      .sort((a, b) => a - b)
      .map((price) => ({ price, count: academyRows.filter((s) => s.gross === price).length })),
  };
}

// ============================================================
//  재무
// ============================================================

/** 거래 한 줄 — FinTransaction 에서 여기서 쓰는 필드만 */
export interface RawFinTx {
  date: string;
  txType: string;
  acctMajor?: string;
  acctMid?: string;
  acctMinor?: string;
  bizMajor?: string;
  vendor?: string;
  gross: number;
  adjust?: number;
  projectCode?: string;
}

/** 프로젝트 문서 — FinProjectDoc 에서 여기서 쓰는 필드만 */
export interface RawFinProject {
  code: string;
  name: string;
  contractAmount?: number;
  lines?: { qty?: number; unitPrice?: number; actual?: number | null }[];
}

const net = (t: RawFinTx) => (Number(t.gross) || 0) - (Number(t.adjust) || 0);

/** 거래처 이름 합치기 — (주)·주식회사·띄어쓰기를 걷고, 별칭표로 같은 곳을 묶는다 */
export function normalizeVendor(name: string | undefined, aliases: Record<string, string>): string {
  const raw = (name ?? "").trim();
  const n = raw.replace(/\(주\)|㈜|주식회사/g, "").replace(/\s+/g, "");
  return aliases[n] ?? aliases[raw] ?? (n || "(거래처 없음)");
}

export const isB2bIncome = (t: RawFinTx) => t.txType === "수입" && t.acctMid === "B2B매출";
export const isSubsidy = (t: RawFinTx) =>
  t.txType === "수입" &&
  (t.acctMid === "지원금" ||
    t.acctMid === "인건비환급(차감)" ||
    (t.acctMid === "환불수입" && t.acctMinor === "인건비환급"));
const isVatPayment = (t: RawFinTx) => t.txType === "지출" && t.acctMinor === "부가가치세(VAT)";
const isCardPayExpense = (t: RawFinTx) => t.txType === "지출" && t.acctMinor === "카드대금결제";

/** 9~1월 — B2B 대목 */
const PEAK_MONTHS = new Set(["09", "10", "11", "12", "01"]);

export function computeFinanceActuals(
  txs: RawFinTx[],
  projects: RawFinProject[],
  rules: DeckActualRules["finance"],
): FinanceActuals {
  const dated = txs.filter((t) => /^\d{4}-\d{2}-\d{2}$/.test(t.date ?? ""));
  if (dated.length === 0) throw new Error("장부 거래가 없습니다.");
  const asOf = dated.map((t) => t.date).sort().at(-1)!;
  const ledgerEnd = rules.ledgerEnd ?? asOf.slice(0, 7);
  const from12 = addMonth(ledgerEnd, -11);
  const from6 = addMonth(ledgerEnd, -5);
  const inWin = (t: RawFinTx, from: string) => {
    const m = t.date.slice(0, 7);
    return m >= from && m <= ledgerEnd;
  };

  // ---- B2B ----
  const b2b = dated.filter((t) => isB2bIncome(t) && inWin(t, from12));
  const b2bTotal = b2b.reduce((s, t) => s + net(t), 0);
  const clients = new Set(b2b.map((t) => normalizeVendor(t.vendor, rules.vendorAliases)));
  const monthly = monthRange(from12, ledgerEnd).map((month) => ({
    month,
    amount: b2b.filter((t) => t.date.startsWith(month)).reduce((s, t) => s + net(t), 0),
  }));
  const peakSum = monthly.filter((m) => PEAK_MONTHS.has(m.month.slice(5))).reduce((s, m) => s + m.amount, 0);
  const recent = monthly.filter((m) => m.month >= from6);

  // ---- 지원금 ----
  const subsidyRows = dated.filter((t) => isSubsidy(t) && inWin(t, from12));
  const subsidyTotal = subsidyRows.reduce((s, t) => s + net(t), 0);

  // ---- 월 지출 (최근 6개월 · 12개월) ----
  //  지출 − 환급에서 부가세 납부와 카드대금결제 지출을 뺀다. 기간만 다르고 방법은 같다.
  const spend = (from: string) => {
    const rows = dated.filter((t) => inWin(t, from));
    const sum = (f: (t: RawFinTx) => boolean) => rows.filter(f).reduce((s, t) => s + net(t), 0);
    const vat = sum(isVatPayment);
    const cardPay = sum(isCardPayExpense);
    return {
      total: sum((t) => t.txType === "지출") - sum((t) => t.txType === "환급") - vat - cardPay,
      vat,
      cardPay,
      common: sum((t) => t.txType === "지출" && t.bizMajor === "공용" && !isVatPayment(t) && !isCardPayExpense(t)),
    };
  };
  const s6 = spend(from6);
  const s12 = spend(from12);
  const n6 = monthsInclusive(from6, ledgerEnd);
  const n12 = monthsInclusive(from12, ledgerEnd);

  // ---- 프로젝트 직접비율 ----
  const byCode = new Map<string, RawFinTx[]>();
  for (const t of dated) {
    const c = (t.projectCode ?? "").trim().toLowerCase();
    if (c) byCode.set(c, [...(byCode.get(c) ?? []), t]);
  }
  const projectRows: ProjectActual[] = [];
  for (const p of projects) {
    const rows = byCode.get((p.code ?? "").trim().toLowerCase()) ?? [];
    const ledgerIncome = rows.filter((t) => t.txType === "수입").reduce((s, t) => s + net(t), 0);
    const ledgerDirect =
      rows.filter((t) => t.txType === "지출" && t.acctMajor !== "인건비").reduce((s, t) => s + net(t), 0) -
      rows.filter((t) => t.txType === "환급").reduce((s, t) => s + net(t), 0);
    const checklist = (p.lines ?? []).reduce(
      (s, l) => s + (l.actual ?? (Number(l.qty) || 0) * (Number(l.unitPrice) || 0)),
      0,
    );
    const revenue = ledgerIncome > 0 ? ledgerIncome : Number(p.contractAmount) || 0;
    const direct = ledgerDirect > 0 ? ledgerDirect : checklist;
    if (revenue <= 0 || direct <= 0) continue;
    const items = (p.lines ?? []).length;
    projectRows.push({
      code: p.code,
      name: rules.projectNames?.[p.code] ?? p.name,
      revenue,
      direct,
      rate: direct / revenue,
      basis: ledgerDirect > 0 ? "장부" : "체크리스트",
      ...(items > 0 ? { items } : {}),
      ...(rules.projectKinds?.[p.code] ? { kind: rules.projectKinds[p.code] } : {}),
    });
  }
  projectRows.sort((a, b) => a.rate - b.rate);
  const pr = projectRows.reduce((s, p) => s + p.revenue, 0);
  const pd = projectRows.reduce((s, p) => s + p.direct, 0);

  return {
    asOf,
    ledgerEnd,
    b2b: {
      from: from12,
      to: ledgerEnd,
      total: b2bTotal,
      clients: clients.size,
      perClient: clients.size ? b2bTotal / clients.size : 0,
      dealsPerMonth: clients.size / 12,
      maxSingle: b2b.length ? Math.max(...b2b.map(net)) : 0,
      peakShare: b2bTotal > 0 ? peakSum / b2bTotal : 0,
      monthly,
      recentAvg: recent.reduce((s, m) => s + m.amount, 0) / Math.max(1, recent.length),
      recentFrom: from6,
    },
    subsidy: {
      from: from12,
      to: ledgerEnd,
      total: subsidyTotal,
      months: 12,
      monthlyAvg: subsidyTotal / 12,
    },
    cost: {
      from: from6,
      to: ledgerEnd,
      monthlyAvg: s6.total / n6,
      excludedVat: s6.vat / n6,
      excludedCardPay: s6.cardPay / n6,
      commonMonthlyAvg: s6.common / n6,
      from12,
      monthlyAvg12: s12.total / n12,
      commonMonthlyAvg12: s12.common / n12,
    },
    projects: projectRows,
    projectsRate: pr > 0 ? pd / pr : 0,
  };
}
