// ============================================================
//  런웨이 — 지금 가진 현금으로 몇 달을 버티는가
// ------------------------------------------------------------
//  계산은 한 줄이다.
//
//    다음 달 현금 = 이번 달 현금 + 들어올 돈 − 나갈 돈
//
//  이걸 달마다 굴려 현금이 0 아래로 내려가는 달을 찾는다. 숫자를 어디서
//  가져오는지가 이 파일의 전부다.
//
//    시작 현금   통장 내역의 「거래후 잔액」(balanceAfter) 중 기준 달 말일까지의
//                마지막 값. 잔액이 찍히지 않는 계좌(현금·옛 양식)는 사람이 적는다.
//    반복 수입   B2C·SMOAT 매출 — 최근 N개월 평균을 사업소분류별로.
//    반복 지출   계정대분류별 최근 N개월 평균 (발생주의 순수지출).
//    B2B 입금    평균을 내지 않는다. 한 달에 3천만이 들어오고 다음 달 0 인 돈을
//                평균 내면 매달 들어오는 것처럼 보인다. 대신 프로젝트에 적힌
//                「받을 날」 회차를 그 달에 넣는다 (project.ts 의 installments).
//    가정        사람이 넣는다 — 「12월부터 와우 매출 0」 처럼 평균 한 줄을
//                바꾸거나, 「11월 권리금 +500만」 처럼 돈 한 덩이를 더한다.
//
//  B2B 를 일정만으로 세면 런웨이가 짧게 나온다 — 아직 안 따낸 일은 0 이라서.
//  그래서 둘을 나란히 낸다.
//    확정        잡힌 돈만 (위 그대로)
//    평소 수주   B2B 입금이 최근 평균보다 적은 달은 평균만큼 들어온다고 본다
//
//  ⚠️ 발생주의를 쓰는 이유: 계정별로 나눠 보려면 카드 사용분에 계정이 붙어
//     있어야 한다(카드대금결제에는 계정이 없다). 카드값은 거의 같은 달에
//     나간다 — 2026-07~09 카드 사용 4,822만 vs 카드대금 4,880만. 자금거래
//     (계좌 간 이동 · 가수금 · 보증금 · 예수금)는 손익이 아니라 뺀다. 임원이
//     넣어 준 가수금으로 버틴 달은 그만큼 런웨이가 짧게 나오는 게 맞다.
//
//  화면은 app/neander/finance/reports/runway, 저장은 neander_fin_runway
//  (문서 하나 — 팀이 같은 가정을 본다).
// ============================================================

import type { FinPaymentMethodDoc } from "./db-types";
import { installmentStatus, splitVat, type FinProjectDoc } from "./project";
import { netAmount, type FinTransaction } from "./types";
import { shiftMonth } from "../format";

// ---- 저장하는 것 (사람이 정한 가정) ------------------------------------

/** 평균 한 줄을 어느 달부터 다른 금액으로 — 「12월부터 와우 매출 0」 */
export interface RunwayOverride {
  id: string;
  /** 바꿀 줄 (RunwayLine.key) */
  lineKey: string;
  /** `YYYY-MM` 부터 */
  from: string;
  /** 그 달부터의 월 금액 (양수) */
  amount: number;
  note?: string;
}

/** 평균 줄과 상관없는 돈 한 덩이 — 한 번이거나 몇 달 동안 */
export interface RunwayItem {
  id: string;
  label: string;
  /** in = 들어오는 돈 · out = 나가는 돈 */
  flow: "in" | "out";
  /** 달마다 이 금액 (양수) */
  amount: number;
  /** `YYYY-MM` 부터 */
  from: string;
  /** `YYYY-MM` 까지 (그 달 포함). 비우면 내다보는 끝까지. 한 번이면 from 과 같다 */
  to?: string;
  note?: string;
}

export interface RunwaySettings {
  /** 평균을 낼 개월 수 */
  baseMonths: number;
  /** 몇 달 앞까지 굴리나 */
  horizon: number;
  /** 뺄 사업장 — 그 사업장의 거래와 계좌를 함께 뺀다 */
  excludeSites: string[];
  /** 줄을 넣을지 — 기본값과 다를 때만 적힌다 (lineKey → 넣음) */
  lineToggles: Record<string, boolean>;
  overrides: RunwayOverride[];
  items: RunwayItem[];
  /** 사람이 적은 계좌 잔액 (뒷 4자리 → 금액). 장부 잔액보다 먼저 쓴다 */
  cash: Record<string, number>;
  /** 런웨이에 넣지 않을 받을 돈 (회차 id) — 떼일 것 같은 연체 등 */
  skipInflows: string[];
  updatedAt?: number;
  updatedBy?: string;
}

export const BASE_MONTH_OPTIONS = [3, 6] as const;
export const HORIZON_OPTIONS = [12, 18, 24] as const;

export const DEFAULT_RUNWAY: RunwaySettings = {
  baseMonths: 3,
  horizon: 12,
  excludeSites: [],
  lineToggles: {},
  overrides: [],
  items: [],
  cash: {},
  skipInflows: [],
};

// ---- 줄 ---------------------------------------------------------------

export type LineFlow = "in" | "out";

export interface RunwayLine {
  key: string;
  label: string;
  flow: LineFlow;
  /** 무엇을 모은 줄인가 — 표의 작은 설명 */
  hint: string;
  /** 평균 낸 달마다의 실적 (baseMonths 순서) */
  base: number[];
  /** 최근 N개월 평균 (월) */
  avg: number;
  /** 기본으로 넣는가 — 기타수입(지원금·환불수입)은 반복된다고 볼 수 없어 뺀다 */
  defaultOn: boolean;
  on: boolean;
  /** 내다보는 달마다 넣을 금액 (on 이 아니면 전부 0) */
  values: number[];
  /** 가정으로 바뀐 달 (true = 그 달 값은 평균이 아니다) */
  overridden: boolean[];
}

const UNSET = "(미분류)";

/** 기타수입은 매달 반복되는 돈이 아니다 — 지원금 · 환불수입 · 이자 */
const isRecurringIncome = (t: FinTransaction) => t.acctMajor === "매출" || !t.acctMajor;

/** B2B 입금 — 평균 줄이 아니라 프로젝트 일정으로 본다 */
export const isB2BIncome = (t: FinTransaction) => t.bizMajor === "B2B" || t.acctMid === "B2B매출";

/** 들어온 돈 한 건이 어느 줄인가. null = 런웨이 평균에 안 쓴다(B2B) */
function incomeLineOf(t: FinTransaction): { key: string; label: string; hint: string; defaultOn: boolean } | null {
  if (isB2BIncome(t)) return null;
  if (isRecurringIncome(t)) {
    const biz = t.bizMinor || UNSET;
    return { key: `in:biz:${biz}`, label: `${biz} 매출`, hint: "사업소분류", defaultOn: true };
  }
  const mid = t.acctMid || t.acctMajor || UNSET;
  return { key: `in:etc:${mid}`, label: mid, hint: "기타수입 · 반복되지 않는 돈", defaultOn: false };
}

/** 나간 돈 한 건이 어느 줄인가. 환급은 그 계정에서 빠진다 */
function expenseLineOf(t: FinTransaction): { key: string; label: string; hint: string } {
  const major = t.acctMajor || UNSET;
  // 계정을 못 찾은 환급은 「환급수입」 으로 적혀 온다 — 들어온 돈이 아니라 지출을 줄이는 돈이다
  if (major === "환급수입") return { key: `out:${major}`, label: "환급", hint: "지출에서 차감" };
  return { key: `out:${major}`, label: major, hint: "계정대분류" };
}

// ---- 계산 결과 ----------------------------------------------------------

export interface CashRow {
  last4: string;
  alias: string;
  site?: string;
  /** 장부의 마지막 거래후 잔액 */
  ledger: number | null;
  /** 그 잔액의 날짜 */
  ledgerDate: string | null;
  /** 사람이 적은 값 */
  manual: number | null;
  /** 런웨이에 쓰는 값 = 적은 값 ?? 장부 잔액 ?? 0 */
  used: number;
}

export type InflowStatus = "scheduled" | "overdue" | "undated";

/** 프로젝트에서 받을 돈 한 회차 */
export interface ProjectInflow {
  /** 회차 id — 회차가 없는 계약은 `project:<id>` */
  id: string;
  projectId: string;
  projectName: string;
  code: string;
  kind: string;
  /** 통장에 들어올 금액 (부가세 포함 청구 총액) */
  amount: number;
  dueDate?: string;
  /** 넣을 달 — undated 면 null */
  month: string | null;
  status: InflowStatus;
  /** 런웨이에 넣는가 (날짜가 있고, 사람이 빼지 않았으면) */
  included: boolean;
}

export interface RunwayItemRow {
  item: RunwayItem;
  values: number[];
}

export interface RunwayMonth {
  month: string;
  opening: number;
  /** 반복 수입 + 프로젝트 입금 + 가정(들어옴) */
  income: number;
  /** 반복 지출 + 가정(나감) */
  expense: number;
  net: number;
  closing: number;
  /** 평소 수주 — B2B 를 평균만큼 채운 기말 현금 */
  closingAlt: number;
  /** 이 달 B2B 입금 (확정 · 평소 수주) */
  b2b: number;
  b2bAlt: number;
}

export interface RunwayOutcome {
  /** 현금이 0 아래로 내려가기까지 몇 달 (소수). 내다본 기간 안에 안 내려가면 null */
  months: number | null;
  /** 바닥나는 달. 없으면 null */
  zeroMonth: string | null;
  /** 가장 적은 기말 현금과 그 달 */
  lowest: number;
  lowestMonth: string;
}

export interface RunwayResult {
  /** 기준 달 — 이 달 말일까지가 실적이다 */
  asOf: string;
  /** 평균 낸 달 (오래된 달부터) */
  baseMonths: string[];
  /** 내다보는 달 (asOf 다음 달부터) */
  months: string[];
  cash: CashRow[];
  openingCash: number;
  lines: RunwayLine[];
  /** B2B 입금 최근 N개월 (평균 낸 달 순서) · 평균 */
  b2bBase: number[];
  b2bAvg: number;
  inflows: ProjectInflow[];
  items: RunwayItemRow[];
  rows: RunwayMonth[];
  /** 반복 줄만의 월 순현금 (평균 수입 − 평균 지출) — 가정·프로젝트 전 */
  baseNet: number;
  baseIncome: number;
  baseExpense: number;
  outcome: RunwayOutcome;
  outcomeAlt: RunwayOutcome;
}

// ---- 기준 달 ------------------------------------------------------------

/**
 * 기본 기준 달 — 거래가 있는 마지막 달. 그 달이 아직 안 끝난 이번 달이면
 * 한 달 앞으로 (반쯤 올린 달로 평균을 내면 지출이 적게 잡힌다).
 */
export function defaultAsOf(transactions: FinTransaction[], thisMonth: string): string {
  let max = "";
  for (const t of transactions) {
    const m = (t.date ?? "").slice(0, 7);
    if (m > max) max = m;
  }
  if (!max) return shiftMonth(thisMonth, -1);
  return max >= thisMonth ? shiftMonth(thisMonth, -1) : max;
}

const monthsBack = (asOf: string, n: number) =>
  Array.from({ length: n }, (_, i) => shiftMonth(asOf, i - n + 1));

const monthsAhead = (asOf: string, n: number) =>
  Array.from({ length: n }, (_, i) => shiftMonth(asOf, i + 1));

// ---- 시작 현금 ----------------------------------------------------------

function cashRows(
  transactions: FinTransaction[],
  paymentMethods: FinPaymentMethodDoc[],
  asOf: string,
  settings: RunwaySettings,
  excluded: Set<string>,
): CashRow[] {
  const end = `${asOf}-31`;
  const last = new Map<string, FinTransaction>();
  for (const t of transactions) {
    if (t.balanceAfter == null || !t.last4 || (t.date ?? "") > end) continue;
    const cur = last.get(t.last4);
    const key = t.datetime || t.date;
    if (!cur || key >= (cur.datetime || cur.date)) last.set(t.last4, t);
  }
  return paymentMethods
    // 카드는 현금이 아니고, 대출 계좌의 잔액은 빚이다
    .filter((p) => (p.kind === "account" || p.kind === "cash") && !/대출/.test(p.alias ?? ""))
    .filter((p) => !(p.site && excluded.has(p.site)))
    .map((p) => {
      const t = last.get(p.last4);
      const manual = settings.cash[p.last4];
      const ledger = t ? Math.round(t.balanceAfter ?? 0) : null;
      const m = typeof manual === "number" && Number.isFinite(manual) ? manual : null;
      return {
        last4: p.last4,
        alias: p.alias,
        site: p.site,
        ledger,
        ledgerDate: t ? t.date : null,
        manual: m,
        used: m ?? ledger ?? 0,
      };
    })
    .sort((a, b) => b.used - a.used || a.alias.localeCompare(b.alias, "ko"));
}

// ---- 프로젝트 입금 ------------------------------------------------------

export function projectInflows(
  projects: FinProjectDoc[],
  start: string,
  skip: Set<string>,
  today: string,
): ProjectInflow[] {
  const out: ProjectInflow[] = [];
  for (const p of projects) {
    if (p.status === "cancelled") continue;
    const base = p.vatMode ?? "excluded";
    const open = (p.installments ?? []).filter((i) => !i.paidDate && Math.round(Number(i.amount) || 0) > 0);
    if (open.length > 0) {
      for (const i of open) {
        const amount = splitVat(i.amount, base).total;
        const due = i.dueDate;
        let status: InflowStatus = "undated";
        let month: string | null = null;
        if (due) {
          month = due.slice(0, 7);
          status = installmentStatus(i, today) === "overdue" ? "overdue" : "scheduled";
          // 이미 지난 달에 받기로 한 돈은 첫 달에 들어온다고 본다 — 받을 돈이니까
          if (month < start) month = start;
        }
        out.push({
          id: i.id,
          projectId: p.id,
          projectName: p.name,
          code: p.code,
          kind: i.kind,
          amount,
          dueDate: due,
          month,
          status,
          included: month !== null && !skip.has(i.id),
        });
      }
      continue;
    }
    // 회차를 안 나눈 계약 — 끝나지 않았고 받은 게 없으면 「날짜 미정」 으로 보인다
    const hasPaid = (p.installments ?? []).some((i) => i.paidDate);
    const contract = Math.round(Number(p.contractAmount) || 0);
    if (!hasPaid && contract > 0 && (p.status === "planning" || p.status === "active")) {
      out.push({
        id: `project:${p.id}`,
        projectId: p.id,
        projectName: p.name,
        code: p.code,
        kind: "계약",
        amount: splitVat(contract, base).total,
        month: null,
        status: "undated",
        included: false,
      });
    }
  }
  const rank: Record<InflowStatus, number> = { overdue: 0, scheduled: 1, undated: 2 };
  return out.sort(
    (a, b) =>
      rank[a.status] - rank[b.status] ||
      (a.dueDate ?? "").localeCompare(b.dueDate ?? "") ||
      b.amount - a.amount,
  );
}

// ---- 굴리기 -------------------------------------------------------------

function outcomeOf(rows: RunwayMonth[], opening: number, pick: (r: RunwayMonth) => number): RunwayOutcome {
  let lowest = opening;
  let lowestMonth = rows[0]?.month ?? "";
  let prev = opening;
  let months: number | null = null;
  let zeroMonth: string | null = null;
  if (opening < 0) {
    months = 0;
    zeroMonth = rows[0]?.month ?? null;
  }
  rows.forEach((r, i) => {
    const close = pick(r);
    if (close < lowest) {
      lowest = close;
      lowestMonth = r.month;
    }
    if (months === null && close < 0) {
      // 그 달 안에서 고르게 줄어든다고 보고 어디쯤 바닥나는지 나눈다
      const drop = prev - close;
      months = i + (drop > 0 ? Math.max(0, prev) / drop : 0);
      zeroMonth = r.month;
    }
    prev = close;
  });
  return { months, zeroMonth, lowest, lowestMonth };
}

/** 이 달에 적용되는 가정 — 같은 줄에 여럿이면 가장 늦게 시작한 것 */
function overrideAt(overrides: RunwayOverride[], month: string): RunwayOverride | undefined {
  let hit: RunwayOverride | undefined;
  for (const o of overrides) {
    if (o.from <= month && (!hit || o.from >= hit.from)) hit = o;
  }
  return hit;
}

export interface RunwayInput {
  transactions: FinTransaction[];
  paymentMethods: FinPaymentMethodDoc[];
  projects: FinProjectDoc[];
  settings: RunwaySettings;
  asOf: string;
  /** 연체 판정 기준일 `YYYY-MM-DD` */
  today: string;
}

export function buildRunway({ transactions, paymentMethods, projects, settings, asOf, today }: RunwayInput): RunwayResult {
  const baseMonths = monthsBack(asOf, settings.baseMonths);
  const months = monthsAhead(asOf, settings.horizon);
  const excluded = new Set(settings.excludeSites);
  const baseIdx = new Map(baseMonths.map((m, i) => [m, i]));
  const n = baseMonths.length;

  // ---- 최근 N개월 실적을 줄로 모은다 ----
  const lineMap = new Map<string, Omit<RunwayLine, "avg" | "on" | "values" | "overridden">>();
  const b2bBase = baseMonths.map(() => 0);
  const touch = (key: string, init: () => Omit<RunwayLine, "avg" | "on" | "values" | "overridden">) => {
    let l = lineMap.get(key);
    if (!l) {
      l = init();
      lineMap.set(key, l);
    }
    return l;
  };

  for (const t of transactions) {
    const i = baseIdx.get((t.date ?? "").slice(0, 7));
    if (i === undefined) continue;
    if (t.site && excluded.has(t.site)) continue;
    const amt = netAmount(t);
    if (t.txType === "수입") {
      if (isB2BIncome(t)) {
        b2bBase[i] += amt;
        continue;
      }
      const def = incomeLineOf(t);
      if (!def) continue;
      touch(def.key, () => ({ ...def, flow: "in", base: baseMonths.map(() => 0) })).base[i] += amt;
    } else if (t.txType === "지출" || t.txType === "환급") {
      // 개인사용분은 회수할 돈이라 지출로 보지 않는다 (리포트의 순수지출과 같다)
      if (t.txType === "지출" && t.personalUse) continue;
      const def = expenseLineOf(t);
      const l = touch(def.key, () => ({ ...def, flow: "out", defaultOn: true, base: baseMonths.map(() => 0) }));
      l.base[i] += t.txType === "환급" ? -amt : amt;
    }
    // 카드대금결제 · 자금거래는 세지 않는다 (머리말)
  }

  const overridesByLine = new Map<string, RunwayOverride[]>();
  for (const o of settings.overrides) {
    const list = overridesByLine.get(o.lineKey) ?? [];
    list.push(o);
    overridesByLine.set(o.lineKey, list);
  }

  const lines: RunwayLine[] = [...lineMap.values()]
    .map((l) => {
      const avg = Math.round(l.base.reduce((s, v) => s + v, 0) / Math.max(1, n));
      const on = settings.lineToggles[l.key] ?? l.defaultOn;
      const ovs = overridesByLine.get(l.key) ?? [];
      const overridden = months.map((m) => Boolean(overrideAt(ovs, m)));
      const values = months.map((m) => {
        if (!on) return 0;
        const o = overrideAt(ovs, m);
        return o ? o.amount : avg;
      });
      return { ...l, avg, on, values, overridden };
    })
    // 실적이 전부 0 인 줄(환급만 있다 사라진 계정 등)은 가정이 걸려 있을 때만 남긴다
    .filter((l) => l.base.some((v) => Math.round(v) !== 0) || overridesByLine.has(l.key))
    .sort((a, b) => (a.flow === b.flow ? Math.abs(b.avg) - Math.abs(a.avg) : a.flow === "in" ? -1 : 1));

  // 가정이 가리키는 줄이 이번 범위(사업장 · 기간)에 없으면 — 0 원 줄로 살려 둔다
  for (const [key, ovs] of overridesByLine) {
    if (lines.some((l) => l.key === key)) continue;
    const flow: LineFlow = key.startsWith("in:") ? "in" : "out";
    const label = key.replace(/^in:(biz|etc):|^out:/, "");
    const overridden = months.map((m) => Boolean(overrideAt(ovs, m)));
    lines.push({
      key,
      label: key.startsWith("in:biz:") ? `${label} 매출` : label,
      flow,
      hint: "최근 실적 없음",
      base: baseMonths.map(() => 0),
      avg: 0,
      defaultOn: true,
      on: settings.lineToggles[key] ?? true,
      values: months.map((m) => overrideAt(ovs, m)?.amount ?? 0),
      overridden,
    });
  }

  const b2bAvg = Math.round(b2bBase.reduce((s, v) => s + v, 0) / Math.max(1, n));

  // ---- 프로젝트 입금 ----
  const start = months[0];
  const inflows = projectInflows(projects, start, new Set(settings.skipInflows), today);
  const b2bByMonth = new Map<string, number>();
  for (const f of inflows) {
    if (!f.included || !f.month) continue;
    b2bByMonth.set(f.month, (b2bByMonth.get(f.month) ?? 0) + f.amount);
  }

  // ---- 가정 항목 ----
  const end = months[months.length - 1];
  const items: RunwayItemRow[] = settings.items.map((item) => {
    const to = item.to || end;
    return {
      item,
      values: months.map((m) => (m >= item.from && m <= to ? item.amount : 0)),
    };
  });

  // ---- 시작 현금 ----
  const cash = cashRows(transactions, paymentMethods, asOf, settings, excluded);
  const openingCash = cash.reduce((s, c) => s + c.used, 0);

  // ---- 달마다 굴린다 ----
  let opening = openingCash;
  let openingAlt = openingCash;
  const rows: RunwayMonth[] = months.map((month, i) => {
    let income = 0;
    let expense = 0;
    for (const l of lines) {
      if (l.flow === "in") income += l.values[i];
      else expense += l.values[i];
    }
    for (const r of items) {
      if (r.item.flow === "in") income += r.values[i];
      else expense += r.values[i];
    }
    const b2b = b2bByMonth.get(month) ?? 0;
    const b2bAlt = Math.max(b2b, b2bAvg);
    const net = income + b2b - expense;
    const row: RunwayMonth = {
      month,
      opening,
      income: income + b2b,
      expense,
      net,
      closing: opening + net,
      closingAlt: openingAlt + income + b2bAlt - expense,
      b2b,
      b2bAlt,
    };
    opening = row.closing;
    openingAlt = row.closingAlt;
    return row;
  });

  const on = lines.filter((l) => l.on);
  const baseIncome = on.filter((l) => l.flow === "in").reduce((s, l) => s + l.avg, 0);
  const baseExpense = on.filter((l) => l.flow === "out").reduce((s, l) => s + l.avg, 0);

  return {
    asOf,
    baseMonths,
    months,
    cash,
    openingCash,
    lines,
    b2bBase,
    b2bAvg,
    inflows,
    items,
    rows,
    baseNet: baseIncome - baseExpense,
    baseIncome,
    baseExpense,
    outcome: outcomeOf(rows, openingCash, (r) => r.closing),
    outcomeAlt: outcomeOf(rows, openingCash, (r) => r.closingAlt),
  };
}

// ---- 저장 전 다듬기 (서버 · 화면 공용) ------------------------------------

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const money = (v: unknown) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.abs(n) : 0;
};
const text = (v: unknown, max = 120) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const shortId = () => Math.random().toString(36).slice(2, 10);

/** 받은 값을 저장할 모양으로 — 모르는 칸은 버리고, 틀린 달은 그 항목째 버린다 */
export function sanitizeRunway(raw: unknown): RunwaySettings {
  const r = (raw ?? {}) as Partial<Record<keyof RunwaySettings, unknown>>;
  const pickNum = <T extends readonly number[]>(v: unknown, opts: T, def: number) =>
    (opts as readonly number[]).includes(Number(v)) ? Number(v) : def;

  const overrides = (Array.isArray(r.overrides) ? r.overrides : [])
    .map((o: Partial<RunwayOverride>) => ({
      id: text(o.id, 40) || shortId(),
      lineKey: text(o.lineKey, 200),
      from: text(o.from, 10),
      amount: money(o.amount),
      note: text(o.note, 200) || undefined,
    }))
    .filter((o) => o.lineKey && MONTH_RE.test(o.from))
    .slice(0, 100);

  const items = (Array.isArray(r.items) ? r.items : [])
    .map((it: Partial<RunwayItem>) => {
      const from = text(it.from, 10);
      const to = text(it.to, 10);
      return {
        id: text(it.id, 40) || shortId(),
        label: text(it.label, 80),
        flow: it.flow === "in" ? ("in" as const) : ("out" as const),
        amount: money(it.amount),
        from,
        to: MONTH_RE.test(to) && to >= from ? to : undefined,
        note: text(it.note, 200) || undefined,
      };
    })
    .filter((it) => MONTH_RE.test(it.from))
    .slice(0, 100);

  const lineToggles: Record<string, boolean> = {};
  if (r.lineToggles && typeof r.lineToggles === "object") {
    Object.entries(r.lineToggles as Record<string, unknown>).forEach(([k, v]) => {
      if (k && typeof v === "boolean") lineToggles[k.slice(0, 200)] = v;
    });
  }

  const cash: Record<string, number> = {};
  if (r.cash && typeof r.cash === "object") {
    Object.entries(r.cash as Record<string, unknown>).forEach(([k, v]) => {
      const n = Math.round(Number(v));
      // 잔액은 음수일 수 있다 (마이너스 통장)
      if (k && v !== null && v !== "" && Number.isFinite(n)) cash[k.slice(0, 20)] = n;
    });
  }

  const strList = (v: unknown, max: number) =>
    (Array.isArray(v) ? v : []).map((s) => text(s, 80)).filter(Boolean).slice(0, max);

  return {
    baseMonths: pickNum(r.baseMonths, BASE_MONTH_OPTIONS, DEFAULT_RUNWAY.baseMonths),
    horizon: pickNum(r.horizon, HORIZON_OPTIONS, DEFAULT_RUNWAY.horizon),
    excludeSites: strList(r.excludeSites, 20),
    lineToggles,
    overrides,
    items,
    cash,
    skipInflows: strList(r.skipInflows, 500),
  };
}

/** 저장된 문서 → 화면 값 (옛 문서에 없는 칸은 기본값으로) */
export function runwayFromDoc(doc: unknown): RunwaySettings {
  const d = (doc ?? {}) as Partial<RunwaySettings>;
  return {
    ...sanitizeRunway(d),
    updatedAt: typeof d.updatedAt === "number" ? d.updatedAt : undefined,
    updatedBy: typeof d.updatedBy === "string" ? d.updatedBy : undefined,
  };
}

/** 저장할 값만 — 비교 · 전송용 (누가 언제는 빼고) */
export function runwayPayload(s: RunwaySettings): RunwaySettings {
  return sanitizeRunway(s);
}

export const newOverride = (lineKey: string, from: string, amount = 0): RunwayOverride => ({
  id: shortId(),
  lineKey,
  from,
  amount,
});

export const newItem = (from: string): RunwayItem => ({
  id: shortId(),
  label: "",
  flow: "out",
  amount: 0,
  from,
  to: from,
});
