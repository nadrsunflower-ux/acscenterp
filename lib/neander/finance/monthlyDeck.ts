// ============================================================
//  월간 재무 보고 덱 — 슬라이드에 올릴 숫자를 한 번에 만든다
// ------------------------------------------------------------
//  리포트 화면(지출상세)과 **같은 엔진(buildReport)·같은 기준**으로 센다.
//  발표 자료의 숫자가 표와 다르면 회의에서 "어느 게 맞냐"로 시간이 간다.
//
//    수입 · 순수지출(개인사용·환급 차감) · 순금액 = 수입 − 순수지출
//
//  전월 대비는 같은 기준·같은 사업장으로 한 달 앞을 한 번 더 센다.
// ============================================================

import {
  buildReport,
  type Basis,
  type ReportValue,
  type TreeNode,
} from "./report";
import { netAmount, type FinTransaction } from "./types";
import { shiftMonth } from "../format";

export interface DeckLine {
  label: string;
  /** 상위 계정 (중분류 줄에서 대분류 이름) */
  parent?: string;
  value: number;
  prev: number;
}

export interface DeckTrendPoint {
  month: string;
  income: number;
  expense: number;
  net: number;
}

export interface DeckUnit {
  label: string;
  income: number;
  expense: number;
  net: number;
}

export interface DeckVendor {
  vendor: string;
  count: number;
  amount: number;
}

export interface MonthlyDeckData {
  month: string;
  prevMonth: string;
  total: ReportValue;
  prevTotal: ReportValue;
  /** 이전 달에 거래가 하나라도 있었나 — 없으면 전월 대비를 숨긴다 */
  hasPrev: boolean;
  usedCount: number;
  income: DeckLine[];
  expenseMajors: DeckLine[];
  expenseMids: DeckLine[];
  /** 전월 대비 변동이 큰 지출 중분류 — 이번 달에 0원이 된 계정도 포함 */
  movers: DeckLine[];
  trend: DeckTrendPoint[];
  units: DeckUnit[];
  vendors: DeckVendor[];
}

const isIncomeRoot = (n: TreeNode) => n.value.income !== 0 && n.value.expensePure === 0;

function flattenMids(roots: TreeNode[]): TreeNode[] {
  return roots.flatMap((r) => r.children);
}

export function buildMonthlyDeck(
  transactions: FinTransaction[],
  opts: {
    month: string;
    basis: Basis;
    isCard: (last4?: string) => boolean;
    site?: string;
    /** 추이 차트에 올릴 달 수 (이번 달 포함) */
    trendMonths?: number;
  },
): MonthlyDeckData {
  const { month, basis, isCard, site } = opts;
  const prevMonth = shiftMonth(month, -1);
  const run = (m: string) => buildReport(transactions, { basis, isCard, scope: { month: m, site } });

  const cur = run(month);
  const prev = run(prevMonth);

  const prevMajor = new Map(prev.roots.map((r) => [r.path, r.value]));
  const prevMid = new Map(flattenMids(prev.roots).map((n) => [n.path, n.value]));

  // 수입 — 수입이 잡힌 중분류 (매출 › B2C매출 …)
  const income: DeckLine[] = flattenMids(cur.roots)
    .filter((n) => n.value.income !== 0)
    .map((n) => ({ label: n.label, parent: n.major, value: n.value.income, prev: prevMid.get(n.path)?.income ?? 0 }))
    .sort((a, b) => b.value - a.value);

  // 지출 — 순수지출 기준. 환급이 더 커서 음수가 된 계정도 그대로 보인다.
  const expenseMajors: DeckLine[] = cur.roots
    .filter((n) => !isIncomeRoot(n) && n.value.expensePure !== 0)
    .map((n) => ({ label: n.label, value: n.value.expensePure, prev: prevMajor.get(n.path)?.expensePure ?? 0 }))
    .sort((a, b) => b.value - a.value);

  const expenseMids: DeckLine[] = flattenMids(cur.roots)
    .filter((n) => n.value.expensePure !== 0)
    .map((n) => ({ label: n.label, parent: n.major, value: n.value.expensePure, prev: prevMid.get(n.path)?.expensePure ?? 0 }))
    .sort((a, b) => b.value - a.value);

  const curMid = new Map(flattenMids(cur.roots).map((n) => [n.path, n]));
  const movers: DeckLine[] = [...new Set([...curMid.keys(), ...prevMid.keys()])]
    .map((path) => {
      const n = curMid.get(path);
      const [major, mid] = path.split("|");
      return { label: n?.label ?? mid, parent: major, value: n?.value.expensePure ?? 0, prev: prevMid.get(path)?.expensePure ?? 0 };
    })
    .filter((l) => l.value !== l.prev && !(l.value === 0 && l.prev === 0))
    .sort((a, b) => Math.abs(b.value - b.prev) - Math.abs(a.value - a.prev));

  // 추이 — 최근 N개월 (오래된 달부터)
  const n = opts.trendMonths ?? 6;
  const trend: DeckTrendPoint[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const m = shiftMonth(month, -i);
    const t = i === 0 ? cur.total : i === 1 ? prev.total : run(m).total;
    trend.push({ month: m, income: t.income, expense: t.expensePure, net: t.net });
  }

  // 사업부 — 이번 달·기준 안의 거래를 사업대·소분류로 나눠 같은 엔진으로 센다
  const scoped = transactions.filter(
    (t) => (t.date ?? "").startsWith(month) && (!site || (t.site ?? "") === site),
  );
  const unitKeys = new Map<string, { bizMajor: string; bizMinor: string }>();
  scoped.forEach((t) => {
    const bizMajor = t.bizMajor ?? "";
    const bizMinor = t.bizMinor ?? "";
    unitKeys.set(`${bizMajor}|${bizMinor}`, { bizMajor, bizMinor });
  });
  const units: DeckUnit[] = [...unitKeys.values()]
    .map((u) => {
      const rows = scoped.filter((x) => (x.bizMajor ?? "") === u.bizMajor && (x.bizMinor ?? "") === u.bizMinor);
      const t = buildReport(rows, { basis, isCard }).total;
      const label = [u.bizMajor || "(미정)", u.bizMinor || "(미정)"].join(" · ");
      return { label, income: t.income, expense: t.expensePure, net: t.net };
    })
    .filter((u) => u.income !== 0 || u.expense !== 0)
    .sort((a, b) => b.income + b.expense - (a.income + a.expense));

  // 거래처 — 순수지출(개인사용 제외, 환급 차감).
  // 인건비(급여·복리후생)는 뺀다 — 거래처가 임직원 이름이라 「어디에 돈을
  // 쓰나」가 아니라 급여 명세가 되고, 발표 화면에 개인별 금액이 뜬다.
  const LABOR = "인건비";
  const vmap = new Map<string, DeckVendor>();
  cur.roots
    .flatMap((r) => r.children.flatMap((m) => m.children.flatMap((l) => l.rows)))
    .forEach((t) => {
      if (t.txType === "수입" || t.personalUse || t.acctMajor === LABOR) return;
      const v = t.vendor?.trim() || "(거래처 없음)";
      const s = vmap.get(v) ?? { vendor: v, count: 0, amount: 0 };
      if (t.txType === "환급") s.amount -= netAmount(t);
      else {
        s.amount += netAmount(t);
        s.count += 1;
      }
      vmap.set(v, s);
    });
  const vendors = [...vmap.values()].filter((v) => v.amount > 0).sort((a, b) => b.amount - a.amount).slice(0, 10);

  return {
    month,
    prevMonth,
    total: cur.total,
    prevTotal: prev.total,
    hasPrev: prev.usedCount > 0,
    usedCount: cur.usedCount,
    income,
    expenseMajors,
    expenseMids,
    movers,
    trend,
    units,
    vendors,
  };
}
