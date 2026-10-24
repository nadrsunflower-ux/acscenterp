// ============================================================
//  런웨이 — 달마다 얼마가 들어오고 나가서, 언제 현금이 바닥나는가
// ------------------------------------------------------------
//  계산은 한 줄이다.
//
//    내일 현금 = 오늘 현금 + 들어올 돈 − 나갈 돈
//
//  이걸 하루씩 굴려 현금이 0 아래로 내려가는 날을 찾고, 달마다 묶어 보인다.
//  숫자를 어디서 가져오는지가 이 파일의 전부다.
//
//    시작 현금   통장마다 「언제까지 아는가」 를 본다 — 그 달 통장 파일을 올린 날
//                (그 달 말일을 넘지 않는다), 또는 사람이 잔액을 적은 날. 모든 통장의
//                잔액을 아는 가장 늦은 날이 시작일이다. 파일이 늦은 통장 하나가 있으면
//                시작일이 그만큼 앞당겨진다 — 화면이 그 통장을 짚는다.
//                시작일이 달 중간이면 그 달은 남은 날만 센다.
//    반복 수입   B2C·SMOAT 매출 — 최근 N개월 평균을 사업소분류별로.
//    반복 지출   계정대분류별 최근 N개월 평균 (발생주의 순수지출).
//    B2B 입금    평균을 내지 않는다. 한 달에 3천만이 들어오고 다음 달 0 인 돈을
//                평균 내면 매달 들어오는 것처럼 보인다. 대신 프로젝트에 적힌
//                「받을 날」 회차를 그 날에 넣는다 (project.ts 의 installments).
//    가정        사람이 넣는다 — 「12월부터 와우 매출 0」 처럼 평균 한 줄을
//                바꾸거나, 「10/26 부가세 478만」 처럼 돈 한 덩이를 그 날에 더한다.
//
//  달 안의 날짜 — 급여·월세는 1일에 한꺼번에 나간다. 달 평균만 보면 「월말엔 남는데
//  1일에 모자라는」 달이 안 보인다. 그래서 줄마다 최근 실적에서 월초(1~5일)에 나간
//  몫을 재서 1일에 놓고, 나머지는 그 달에 고르게 펼친다.
//
//  B2B 를 일정만으로 세면 짧게 나온다 — 아직 안 따낸 일은 0 이라서. 「평소만큼
//  수주」 는 B2B 입금이 최근 평균보다 적은 달을 평균만큼 채운 낙관선이다.
//
//  ⚠️ 발생주의를 쓰는 이유: 계정별로 나눠 보려면 카드 사용분에 계정이 붙어
//     있어야 한다(카드대금결제에는 계정이 없다). 카드값은 달 단위로는 거의 같은
//     금액이 나간다 — 신한은 쓴 달에 나눠 미리 내고, KB 는 다음 달 14일쯤 지난달
//     몫을 낸다(달마다 비슷해 서로 상쇄된다). 자금거래(계좌 간 이동 · 가수금 ·
//     보증금 · 예수금)는 손익이 아니라 뺀다.
//
//  화면은 app/neander/finance/reports/runway, 저장은 neander_fin_runway
//  (문서 하나 — 팀이 같은 가정을 본다).
// ============================================================

import type { FinPaymentMethodDoc } from "./db-types";
import { installmentStatus, isInstallmentReceived, splitVat, type DuePart, type FinProjectDoc } from "./project";
import { netAmount, type FinImportBatch, type FinTransaction } from "./types";
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
  /**
   * 그 달 며칠에 오가는가 (1~31). 비우면 나가는 돈은 1일, 들어오는 돈은 말일 —
   * 모르면 바닥을 늦게 보지 않는 쪽으로 둔다.
   */
  day?: number;
  note?: string;
}

/**
 * 줄여 보기 — 지출 계정 하나(대·중·소 어느 단계든)를 몇 % 줄이는가.
 * 화면에서는 뺐다. 저장된 문서에 남아 있는 값을 잃지 않으려고 모양만 둔다.
 */
export interface RunwayCut {
  path: string;
  pct: number;
  from: string;
}

export interface RunwayScenario {
  id: string;
  name: string;
  cuts: RunwayCut[];
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
  /** 사람이 적은 계좌 잔액 (뒷 4자리 → 금액) */
  cash: Record<string, number>;
  /** 그 잔액이 언제 잔액인가 (뒷 4자리 → `YYYY-MM-DD`) — 시작일을 정하는 데 쓴다 */
  cashDates: Record<string, string>;
  /** 런웨이에 넣지 않을 받을 돈 (회차 id) — 떼일 것 같은 연체 등 */
  skipInflows: string[];
  /** 예전 「줄여 보기」 시나리오 — 화면에선 뺐다. 저장된 값을 지우지 않으려고 둔다 */
  scenarios: RunwayScenario[];
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
  cashDates: {},
  skipInflows: [],
  scenarios: [],
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
  /** 최근 실적 중 월초(1~5일)에 오간 몫 (0~1) — 그만큼 1일에 놓는다 */
  early: number;
  /** 기본으로 넣는가 — 기타수입(지원금·환불수입)은 반복된다고 볼 수 없어 뺀다 */
  defaultOn: boolean;
  on: boolean;
  /** 내다보는 달마다 넣을 금액 — 한 달치 (on 이 아니면 전부 0) */
  values: number[];
  /** 가정으로 바뀐 달 (true = 그 달 값은 평균이 아니다) */
  overridden: boolean[];
}

const UNSET = "(미분류)";
/** 이 날까지를 월초로 본다 — 급여가 1일, 늦어도 2~3일에 나간다 */
const EARLY_DAY = 5;

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

// ---- 날짜 ---------------------------------------------------------------

const DAY_MS = 86_400_000;
/** 그 달의 말일 `YYYY-MM-DD` */
export const monthEnd = (m: string) => {
  const [y, mo] = m.split("-").map(Number);
  return `${m}-${String(new Date(Date.UTC(y, mo, 0)).getUTCDate()).padStart(2, "0")}`;
};
const daysIn = (m: string) => Number(monthEnd(m).slice(8));
const dateOf = (m: string, d: number) => `${m}-${String(d).padStart(2, "0")}`;
/** 한국 날짜 `YYYY-MM-DD` */
const kstDate = (ms: number) => new Date(ms + 9 * 3_600_000).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / DAY_MS);

// ---- 계산 결과 ----------------------------------------------------------

export interface CashRow {
  last4: string;
  alias: string;
  site?: string;
  /** 시작일 기준 장부 잔액 — 시작일까지의 마지막 「거래후 잔액」 */
  ledger: number | null;
  /** 그 잔액이 찍힌 거래일 */
  ledgerDate: string | null;
  /**
   * 장부가 이 날까지는 맞다 — 그 달 통장 파일을 올린 날(그 달 말일을 넘지 않는다).
   * 파일을 안 올린 날들은 잔액이 바뀌었어도 장부가 모른다.
   */
  knownThrough: string | null;
  /** 사람이 적은 값 */
  manual: number | null;
  /** 적은 값이 언제 잔액인가 — 안 적었으면 null */
  manualDate: string | null;
  /** 시작 현금으로 쓴 값 */
  used: number;
  /** 어디서 온 값인가 */
  source: "ledger" | "manual" | "none";
  /** 이 통장이 시작일을 앞당겼다 — 이 통장만 늦게 알아서 다른 통장의 최근 잔액을 못 쓴다 */
  limiting: boolean;
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
  /** 받을 날이 대략(「10월 말」)인가 */
  dueApprox?: DuePart;
  /** 넣을 달 — undated 면 null */
  month: string | null;
  status: InflowStatus;
  /** 런웨이에 넣는가 (날짜가 있고, 사람이 빼지 않았으면) */
  included: boolean;
}

export interface RunwayItemRow {
  item: RunwayItem;
  /** 달마다 한 달치 금액 */
  values: number[];
}

/** 한 달 안에서 무엇이 얼마 — 표를 펼치면 보인다 */
export interface RunwayPart {
  key: string;
  label: string;
  flow: LineFlow;
  kind: "line" | "item" | "b2b";
  /** 이 달에 센 금액 (첫 달이 남은 날만이면 그만큼) */
  amount: number;
  /** 날짜가 정해진 돈이면 그 날 */
  date?: string;
  /** 가정으로 바꾼 줄인가 */
  overridden?: boolean;
}

export interface RunwayMonth {
  month: string;
  /** 이 달에 센 첫날 — 시작일이 달 중간이면 그 다음 날 */
  from: string;
  opening: number;
  /** 반복 수입 + 프로젝트 입금 + 가정(들어옴) */
  income: number;
  /** 반복 지출 + 가정(나감) */
  expense: number;
  net: number;
  closing: number;
  /** 이 달 가장 낮을 때와 그 날 */
  low: number;
  lowDate: string;
  /** 평소 수주 — B2B 를 평균만큼 채운 말일 현금 */
  closingAlt: number;
  /** 이 달 B2B 입금 (확정 · 평소 수주) */
  b2b: number;
  b2bAlt: number;
  parts: RunwayPart[];
}

export interface RunwayOutcome {
  /** 현금이 0 아래로 내려가기까지 몇 달 (소수). 내다본 기간 안에 안 내려가면 null */
  months: number | null;
  /** 처음 0 아래로 내려가는 날 · 그날 말 현금 · 그 달. 없으면 null */
  zeroDate: string | null;
  zeroClosing: number | null;
  zeroMonth: string | null;
  /** 가장 적은 현금과 그 날 · 그 달 */
  lowest: number;
  lowestDate: string;
  lowestMonth: string;
}

export interface RunwayResult {
  /** 기준 달 — 평균은 이 달까지 낸다 */
  asOf: string;
  /** 평균 낸 달 (오래된 달부터) */
  baseMonths: string[];
  /** 시작 현금의 날 — 이 날 말까지가 실적이다 */
  start: string;
  /** 내다보는 달 (시작일이 달 중간이면 그 달부터) */
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

/**
 * 통장 하나의 장부가 언제까지 맞는가.
 *
 * 월별 퍼즐로 올린 파일(배치)이 있으면 가장 늦은 달의 배치 — 그 파일을 올린 날
 * (은행에서 그날 내려받았다), 그 달 말일을 넘지 않는다. 배치가 없으면(옛 통합
 * 장부로만 들어온 통장) 마지막 거래가 있는 달의 말일. 적재 이력을 모르면(imports 를
 * 안 넘긴 호출) 기준 달 말일까지는 맞다고 본다 — 예전 동작.
 */
function knownThroughOf(
  last4: string,
  txs: FinTransaction[],
  imports: FinImportBatch[] | undefined,
  asOfEnd: string,
): string | null {
  if (!imports) return txs.length > 0 ? asOfEnd : null;
  const mine = imports.filter((b) => b.slotKey === `account:${last4}` && /^\d{4}-\d{2}$/.test(b.month ?? ""));
  if (mine.length > 0) {
    const best = mine.reduce((a, b) => ((b.month ?? "") > (a.month ?? "") ? b : a));
    const end = monthEnd(best.month!);
    const made = best.createdAt ? kstDate(best.createdAt) : end;
    return made < end ? made : end;
  }
  const last = txs[txs.length - 1];
  return last ? monthEnd(last.date.slice(0, 7)) : null;
}

function startingCash(
  transactions: FinTransaction[],
  paymentMethods: FinPaymentMethodDoc[],
  settings: RunwaySettings,
  excluded: Set<string>,
  asOf: string,
  today: string,
  imports: FinImportBatch[] | undefined,
): { start: string; cash: CashRow[] } {
  const asOfEnd = monthEnd(asOf);
  // 카드는 현금이 아니고, 대출 계좌의 잔액은 빚이다
  const accounts = paymentMethods
    .filter((p) => (p.kind === "account" || p.kind === "cash") && !/대출/.test(p.alias ?? ""))
    .filter((p) => !(p.site && excluded.has(p.site)));
  const byAcct = new Map<string, FinTransaction[]>();
  for (const t of transactions) {
    if (t.balanceAfter == null || !t.last4) continue;
    byAcct.set(t.last4, [...(byAcct.get(t.last4) ?? []), t]);
  }
  byAcct.forEach((list) => list.sort((a, b) => (a.datetime || a.date).localeCompare(b.datetime || b.date)));

  const info = accounts.map((p) => {
    const txs = byAcct.get(p.last4) ?? [];
    const knownThrough = knownThroughOf(p.last4, txs, imports, asOfEnd);
    const m = settings.cash[p.last4];
    const manual = typeof m === "number" && Number.isFinite(m) ? m : null;
    const manualDate = manual !== null ? settings.cashDates?.[p.last4] ?? null : null;
    const known = [knownThrough, manualDate].filter((d): d is string => !!d).sort().pop() ?? null;
    return { p, txs, knownThrough, manual, manualDate, known };
  });

  // 시작일 — 모든 통장의 잔액을 아는 가장 늦은 날. 아무것도 모르는 통장(현금 등)은 시작일을 붙잡지 않는다
  const knowns = info.map((i) => i.known).filter((d): d is string => !!d).sort();
  let start = knowns[0] ?? asOfEnd;
  if (start > today) start = today;
  const latest = knowns[knowns.length - 1] ?? start;

  const cash: CashRow[] = info
    .map((i) => {
      const at = [...i.txs].reverse().find((t) => t.date <= start);
      const ledger = at ? Math.round(at.balanceAfter ?? 0) : null;
      let used = 0;
      let source: CashRow["source"] = "none";
      if (i.knownThrough && i.knownThrough >= start && ledger !== null) {
        used = ledger;
        source = "ledger";
      } else if (i.manual !== null && (i.manualDate === null || i.manualDate >= start)) {
        // 날짜 없는 적은 값은 장부가 모르는 통장에서만 쓴다 (위에서 장부가 이겼다)
        used = i.manual;
        source = "manual";
      } else if (ledger !== null) {
        used = ledger;
        source = "ledger";
      }
      return {
        last4: i.p.last4,
        alias: i.p.alias,
        site: i.p.site,
        ledger,
        ledgerDate: at ? at.date : null,
        knownThrough: i.knownThrough,
        manual: i.manual,
        manualDate: i.manualDate,
        used,
        source,
        limiting: i.known === start && latest > start,
      };
    })
    .sort((a, b) => b.used - a.used || a.alias.localeCompare(b.alias, "ko"));
  return { start, cash };
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
    // 받은 회차는 날짜를 몰라도 뺀다 — 이미 통장 잔액(시작 현금)에 들어 있다
    const open = (p.installments ?? []).filter((i) => !isInstallmentReceived(i) && Math.round(Number(i.amount) || 0) > 0);
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
          dueApprox: i.dueApprox,
          month,
          status,
          included: month !== null && !skip.has(i.id),
        });
      }
      continue;
    }
    // 회차를 안 나눈 계약 — 끝나지 않았고 받은 게 없으면 「날짜 미정」 으로 보인다
    const hasPaid = (p.installments ?? []).some(isInstallmentReceived);
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

/** 이 달에 적용되는 가정 — 같은 줄에 여럿이면 가장 늦게 시작한 것 */
function overrideAt(overrides: RunwayOverride[], month: string): RunwayOverride | undefined {
  let hit: RunwayOverride | undefined;
  for (const o of overrides) {
    if (o.from <= month && (!hit || o.from >= hit.from)) hit = o;
  }
  return hit;
}

/** 하루씩 쌓은 말일 현금에서 바닥 · 가장 낮은 날을 찾는다 */
function outcomeOf(start: string, opening: number, path: { date: string; closing: number }[]): RunwayOutcome {
  let lowest = opening;
  let lowestDate = start;
  let zeroDate: string | null = opening < 0 ? start : null;
  let zeroClosing: number | null = opening < 0 ? opening : null;
  for (const p of path) {
    if (p.closing < lowest) {
      lowest = p.closing;
      lowestDate = p.date;
    }
    if (zeroDate === null && p.closing < 0) {
      zeroDate = p.date;
      zeroClosing = p.closing;
    }
  }
  return {
    // 달은 평균 길이(30.44일)로 — 「1.6개월」 처럼 읽는 숫자다
    months: zeroDate === null ? null : Math.max(0, daysBetween(start, zeroDate) / 30.4375),
    zeroDate,
    zeroClosing: zeroClosing === null ? null : Math.round(zeroClosing),
    zeroMonth: zeroDate ? zeroDate.slice(0, 7) : null,
    lowest: Math.round(lowest),
    lowestDate,
    lowestMonth: lowestDate.slice(0, 7),
  };
}

export interface RunwayInput {
  transactions: FinTransaction[];
  paymentMethods: FinPaymentMethodDoc[];
  projects: FinProjectDoc[];
  settings: RunwaySettings;
  /** 평균을 낼 마지막 달 */
  asOf: string;
  /** 연체 판정 기준일 `YYYY-MM-DD` */
  today: string;
  /** 통장 파일 적재 이력 — 통장마다 장부가 언제까지 맞는지(시작일). 없으면 기준 달 말일까지 맞다고 본다 */
  imports?: FinImportBatch[];
}

export function buildRunway({ transactions, paymentMethods, projects, settings, asOf, today, imports }: RunwayInput): RunwayResult {
  const baseMonths = monthsBack(asOf, settings.baseMonths);
  const excluded = new Set(settings.excludeSites);
  const baseIdx = new Map(baseMonths.map((m, i) => [m, i]));
  const n = baseMonths.length;

  // ---- 시작 현금 · 내다볼 달 ----
  const { start, cash } = startingCash(transactions, paymentMethods, settings, excluded, asOf, today, imports);
  const openingCash = cash.reduce((s, c) => s + c.used, 0);
  const startMonth = start.slice(0, 7);
  const startsAtMonthEnd = start === monthEnd(startMonth);
  const months = startsAtMonthEnd
    ? monthsAhead(startMonth, settings.horizon)
    : [startMonth, ...monthsAhead(startMonth, settings.horizon - 1)];

  // ---- 최근 N개월 실적을 줄로 모은다 ----
  type Acc = Omit<RunwayLine, "avg" | "on" | "values" | "overridden" | "early"> & { earlyBase: number[] };
  const lineMap = new Map<string, Acc>();
  const b2bBase = baseMonths.map(() => 0);
  const touch = (key: string, init: () => Acc) => {
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
    const early = Number((t.date ?? "").slice(8, 10)) <= EARLY_DAY;
    if (t.txType === "수입") {
      if (isB2BIncome(t)) {
        b2bBase[i] += amt;
        continue;
      }
      const def = incomeLineOf(t);
      if (!def) continue;
      const l = touch(def.key, () => ({ ...def, flow: "in", base: baseMonths.map(() => 0), earlyBase: baseMonths.map(() => 0) }));
      l.base[i] += amt;
      if (early) l.earlyBase[i] += amt;
    } else if (t.txType === "지출" || t.txType === "환급") {
      // 개인사용분은 회수할 돈이라 지출로 보지 않는다 (리포트의 순수지출과 같다)
      if (t.txType === "지출" && t.personalUse) continue;
      const def = expenseLineOf(t);
      const l = touch(def.key, () => ({ ...def, flow: "out", defaultOn: true, base: baseMonths.map(() => 0), earlyBase: baseMonths.map(() => 0) }));
      const signed = t.txType === "환급" ? -amt : amt;
      l.base[i] += signed;
      if (early) l.earlyBase[i] += signed;
    }
    // 카드대금결제 · 자금거래는 세지 않는다 (머리말)
  }

  const overridesByLine = new Map<string, RunwayOverride[]>();
  for (const o of settings.overrides) {
    const list = overridesByLine.get(o.lineKey) ?? [];
    list.push(o);
    overridesByLine.set(o.lineKey, list);
  }

  /**
   * 1일에 놓을 몫 — 월초(1~5일)에 몰린 만큼만. 매일 고르게 오가는 돈(매장 매출 등)도
   * 1~5일에 그 날 수만큼(5/30.4 ≈ 16%)은 있으니, 그만큼은 몰린 것으로 보지 않는다.
   * 실측(2026-07~09): 인건비 81% → 77% · 운영비 43%(월세) → 32% · 매장 매출 ≈ 0.
   */
  const UNIFORM = EARLY_DAY / 30.4375;
  const earlyOf = (base: number[], earlyBase: number[]) => {
    const total = base.reduce((s, v) => s + v, 0);
    const early = earlyBase.reduce((s, v) => s + v, 0);
    if (total <= 0) return 0;
    return Math.min(1, Math.max(0, (early / total - UNIFORM) / (1 - UNIFORM)));
  };

  const lines: RunwayLine[] = [...lineMap.values()]
    .map(({ earlyBase, ...l }) => {
      const avg = Math.round(l.base.reduce((s, v) => s + v, 0) / Math.max(1, n));
      const on = settings.lineToggles[l.key] ?? l.defaultOn;
      const ovs = overridesByLine.get(l.key) ?? [];
      const overridden = months.map((m) => Boolean(overrideAt(ovs, m)));
      const values = months.map((m) => {
        if (!on) return 0;
        const o = overrideAt(ovs, m);
        return o ? o.amount : avg;
      });
      return { ...l, avg, early: earlyOf(l.base, earlyBase), on, values, overridden };
    })
    // 실적이 전부 0 인 줄(환급만 있다 사라진 계정 등)은 가정이 걸려 있을 때만 남긴다
    .filter((l) => l.base.some((v) => Math.round(v) !== 0) || overridesByLine.has(l.key))
    .sort((a, b) => (a.flow === b.flow ? Math.abs(b.avg) - Math.abs(a.avg) : a.flow === "in" ? -1 : 1));

  // 가정이 가리키는 줄이 이번 범위(사업장 · 기간)에 없으면 — 0 원 줄로 살려 둔다
  for (const [key, ovs] of overridesByLine) {
    if (lines.some((l) => l.key === key)) continue;
    const flow: LineFlow = key.startsWith("in:") ? "in" : "out";
    const label = key.replace(/^in:(biz|etc):|^out:/, "");
    lines.push({
      key,
      label: key.startsWith("in:biz:") ? `${label} 매출` : label,
      flow,
      hint: "최근 실적 없음",
      base: baseMonths.map(() => 0),
      avg: 0,
      early: 0,
      defaultOn: true,
      on: settings.lineToggles[key] ?? true,
      values: months.map((m) => overrideAt(ovs, m)?.amount ?? 0),
      overridden: months.map((m) => Boolean(overrideAt(ovs, m))),
    });
  }

  const b2bAvg = Math.round(b2bBase.reduce((s, v) => s + v, 0) / Math.max(1, n));

  // ---- 프로젝트 입금 ----
  const inflows = projectInflows(projects, months[0], new Set(settings.skipInflows), today);

  // ---- 가정 항목 ----
  const end = months[months.length - 1];
  const items: RunwayItemRow[] = settings.items.map((item) => {
    const to = item.to || end;
    return { item, values: months.map((m) => (m >= item.from && m <= to ? item.amount : 0)) };
  });

  // ---- 하루씩 굴린다 ----
  let closing = openingCash;
  let closingAlt = openingCash;
  const path: { date: string; closing: number }[] = [];
  const pathAlt: { date: string; closing: number }[] = [];
  const rows: RunwayMonth[] = months.map((month, i) => {
    const D = daysIn(month);
    // 시작일이 이 달 중간이면 그 다음 날부터 — 그날까지는 이미 잔액에 들어 있다
    const firstDay = i === 0 && !startsAtMonthEnd ? Number(start.slice(8)) + 1 : 1;
    const span = D - firstDay + 1;
    const inDay = Array.from({ length: D + 1 }, () => 0);
    const outDay = Array.from({ length: D + 1 }, () => 0);
    const parts: RunwayPart[] = [];
    const put = (flow: LineFlow, day: number, amount: number) => {
      if (day < firstDay || day > D || amount === 0) return 0;
      (flow === "in" ? inDay : outDay)[day] += amount;
      return amount;
    };

    for (const l of lines) {
      const v = l.values[i];
      if (!v) continue;
      // 월초 몫은 1일에, 나머지는 고르게
      let got = put(l.flow, 1, l.early * v);
      const daily = ((1 - l.early) * v) / D;
      for (let d = firstDay; d <= D; d++) got += put(l.flow, d, daily);
      if (Math.round(got) !== 0) parts.push({ key: l.key, label: l.label, flow: l.flow, kind: "line", amount: got, overridden: l.overridden[i] });
    }
    for (const r of items) {
      const v = r.values[i];
      if (!v) continue;
      const want = r.item.day ?? (r.item.flow === "out" ? 1 : D);
      const day = Math.min(D, Math.max(firstDay, want));
      // 시작일보다 앞선 날짜의 돈은 이미 잔액에 들어 있다 — 그 달 첫날로 미루지 않고 뺀다
      const got = want < firstDay && i === 0 && !startsAtMonthEnd ? 0 : put(r.item.flow, day, v);
      if (got) parts.push({ key: r.item.id, label: r.item.label || "(이름 없는 가정)", flow: r.item.flow, kind: "item", amount: got, date: dateOf(month, day) });
    }
    let b2b = 0;
    for (const f of inflows) {
      if (!f.included || f.month !== month) continue;
      // 받을 날이 이 달 시작일 뒤면 그 날, 이미 지났으면(연체) 첫날
      const due = f.dueDate && f.dueDate.slice(0, 7) === month ? Number(f.dueDate.slice(8)) : firstDay;
      const day = Math.max(firstDay, Math.min(D, due));
      b2b += put("in", day, f.amount);
      parts.push({ key: f.id, label: `${f.projectName} · ${f.kind}`, flow: "in", kind: "b2b", amount: f.amount, date: dateOf(month, day) });
    }
    // 평소 수주 — 확정 B2B 가 평균보다 적으면 모자란 만큼을 남은 날에 고르게
    const b2bAlt = Math.max(b2b, (b2bAvg * span) / D);
    const altDaily = (b2bAlt - b2b) / span;

    const opening = closing;
    let low = Number.POSITIVE_INFINITY;
    let lowDate = dateOf(month, firstDay);
    let income = 0;
    let expense = 0;
    for (let d = firstDay; d <= D; d++) {
      income += inDay[d];
      expense += outDay[d];
      closing += inDay[d] - outDay[d];
      closingAlt += inDay[d] + altDaily - outDay[d];
      const date = dateOf(month, d);
      path.push({ date, closing });
      pathAlt.push({ date, closing: closingAlt });
      if (closing < low) {
        low = closing;
        lowDate = date;
      }
    }
    parts.sort((a, b) => (a.flow === b.flow ? b.amount - a.amount : a.flow === "in" ? -1 : 1));
    // 원 단위로 맞춘다 — 하루치로 나눈 금액의 소수가 쌓여 1,244.9999 처럼 보이지 않게
    closing = Math.round(closing);
    closingAlt = Math.round(closingAlt);
    income = Math.round(income);
    expense = Math.round(expense);
    return {
      month,
      from: dateOf(month, firstDay),
      opening,
      income,
      expense,
      net: income - expense,
      closing,
      low: Number.isFinite(low) ? Math.round(low) : opening,
      lowDate,
      closingAlt,
      b2b,
      b2bAlt,
      parts,
    };
  });

  const on = lines.filter((l) => l.on);
  const baseIncome = on.filter((l) => l.flow === "in").reduce((s, l) => s + l.avg, 0);
  const baseExpense = on.filter((l) => l.flow === "out").reduce((s, l) => s + l.avg, 0);

  return {
    asOf,
    baseMonths,
    start,
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
    outcome: outcomeOf(start, openingCash, path),
    outcomeAlt: outcomeOf(start, openingCash, pathAlt),
  };
}

/**
 * 한 줄 요약 — 브리핑 · 대시보드가 쓴다 (잡힌 돈만 기준).
 *   start    시작 잔액의 날
 *   zero     처음 0 아래로 내려가는 날 (없으면 null)
 *   lowest   내다본 기간 중 가장 낮은 날
 */
export function runwayDanger(r: RunwayResult): {
  start: string;
  opening: number;
  zero: { date: string; closing: number } | null;
  lowest: { date: string; closing: number };
} {
  const o = r.outcome;
  return {
    start: r.start,
    opening: r.openingCash,
    zero: o.zeroDate !== null && o.zeroClosing !== null ? { date: o.zeroDate, closing: o.zeroClosing } : null,
    lowest: { date: o.lowestDate, closing: o.lowest },
  };
}

// ---- 저장 전 다듬기 (서버 · 화면 공용) ------------------------------------

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
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
        day: Number.isInteger(Number(it.day)) && Number(it.day) >= 1 && Number(it.day) <= 31 ? Number(it.day) : undefined,
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
  // 날짜는 잔액이 적힌 계좌만 — 잔액을 지우면 날짜도 같이 사라진다
  const cashDates: Record<string, string> = {};
  if (r.cashDates && typeof r.cashDates === "object") {
    Object.entries(r.cashDates as Record<string, unknown>).forEach(([k, v]) => {
      const d = text(v, 10);
      if (k.slice(0, 20) in cash && DATE_RE.test(d)) cashDates[k.slice(0, 20)] = d;
    });
  }

  const strList = (v: unknown, max: number) =>
    (Array.isArray(v) ? v : []).map((s) => text(s, 80)).filter(Boolean).slice(0, max);

  const scenarios = (Array.isArray(r.scenarios) ? r.scenarios : [])
    .map((sc: Partial<RunwayScenario>, i) => {
      const seen = new Set<string>();
      const cuts = (Array.isArray(sc.cuts) ? sc.cuts : [])
        .map((c: Partial<RunwayCut>) => ({
          path: text(c.path, 200),
          pct: Math.min(100, Math.max(0, Math.round(Number(c.pct) || 0))),
          from: text(c.from, 10),
        }))
        // 같은 경로가 두 번 오면 앞의 것 — 화면은 경로마다 하나만 만든다
        .filter((c) => c.path && MONTH_RE.test(c.from) && !seen.has(c.path) && seen.add(c.path))
        .slice(0, 300);
      return { id: text(sc.id, 40) || shortId(), name: text(sc.name, 60) || `시나리오 ${i + 1}`, cuts };
    })
    .slice(0, 20);

  return {
    baseMonths: pickNum(r.baseMonths, BASE_MONTH_OPTIONS, DEFAULT_RUNWAY.baseMonths),
    horizon: pickNum(r.horizon, HORIZON_OPTIONS, DEFAULT_RUNWAY.horizon),
    excludeSites: strList(r.excludeSites, 20),
    lineToggles,
    overrides,
    items,
    cash,
    cashDates,
    skipInflows: strList(r.skipInflows, 500),
    scenarios,
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

export const newScenario = (name: string): RunwayScenario => ({ id: shortId(), name, cuts: [] });

export const newItem = (from: string): RunwayItem => ({
  id: shortId(),
  label: "",
  flow: "out",
  amount: 0,
  from,
  to: from,
});
