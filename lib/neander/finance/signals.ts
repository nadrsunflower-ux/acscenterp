// ============================================================
//  재무 월간 신호 — 보고 해설(AI)이 인용할 "사실" 목록
// ------------------------------------------------------------
//  계약: lib/neander/insights/types.ts (Signal · sortSignals)
//
//  이 파일은 **새로 세지 않는다**. 슬라이드·리포트 화면이 이미 쓰는 집계
//  함수를 그대로 불러 그 결과에서 "평소와 다르거나 돈이 걸린 것"만 고른다.
//  신호의 숫자가 슬라이드 숫자와 원 단위로 다르면 해설 전체를 믿을 수 없게 된다.
//
//    핵심 요약 · 수입 구성 · 사업부 · 거래처  buildMonthlyDeck (덱과 같은 엔진)
//    계정 급증 · 튄 거래                     anomaly.ts (형광펜과 같은 판정·같은 끄기)
//    사업부 손익(배분 후)                    unitTotals + allocate (사업부 화면과 같게)
//    예산                                    budget.ts (예산 화면과 같게 — 발생주의 고정)
//    구독                                    subscriptionMonthView (구독 화면과 같게)
//
//  원칙
//    · impact(월 영향)는 근거가 선 것만 — 급증분·예산 초과분·평소 대비 증가분.
//      적자 크기나 순금액은 "새는 돈"이 아니라 결과라 impact 로 두지 않는다.
//    · 인건비 계정의 거래처는 임직원 이름이다. 덱의 거래처 슬라이드처럼
//      거래처 이름이 드러나는 신호(튄 거래·집중도·급증 원인)에서는 뺀다.
//    · 사업장(site)으로 좁히면 예산은 건너뛴다 — 예산은 회사 전체 한 벌이다.
//    · 빈 데이터·이상한 달 문자열에도 던지지 않고 빈 배열을 돌려준다.
// ============================================================

import { sortSignals, type Signal, type SignalMetric, type SignalSeverity } from "../insights/types";
import { shiftMonth, shortWon } from "../format";
import { unitTotals, allocate, type UnitTotals } from "./allocation";
import {
  accountSpikes,
  txFlags,
  vendorKey,
  ignoredAccountKey,
  type AnomalyIgnores,
} from "./anomaly";
import { budgetLinesOf, expenseMajors } from "./budget";
import type {
  FinAccountDoc,
  FinAllocationDoc,
  FinAnomalyIgnoreDoc,
  FinBudgetDoc,
  FinPaymentMethodDoc,
  FinSubscriptionDoc,
  FinVendorRuleDoc,
} from "./db-types";
import { ledgerHref } from "./ledgerLink";
import { FIN_ACCOUNTS } from "./master-data";
import { buildMonthlyDeck } from "./monthlyDeck";
import {
  buildReport,
  inScope,
  makeIsCard,
  NO_ACCOUNT,
  subscriptionMatchers,
  subscriptionMonthView,
  type Basis,
  type TreeNode,
} from "./report";
import { netAmount, type FinTransaction } from "./types";

export interface FinanceSignalInput {
  /** `YYYY-MM` */
  month: string;
  transactions: FinTransaction[];
  accounts: FinAccountDoc[];
  paymentMethods: FinPaymentMethodDoc[];
  allocations: FinAllocationDoc[];
  budgets: FinBudgetDoc[];
  subscriptions: FinSubscriptionDoc[];
  vendorRules: FinVendorRuleDoc[];
  anomalyIgnores: FinAnomalyIgnoreDoc[];
  /** 기본 발생주의 */
  basis?: Basis;
  /** 사업장으로 좁힌다 (비우면 전체) */
  site?: string;
}

/** 신호 개수 상한 — 해설 프롬프트가 길어지면 요점이 흐려진다 */
const MAX_SIGNALS = 25;

/** 거래처 이름이 곧 임직원 이름인 계정 (monthlyDeck 의 거래처 슬라이드와 같은 제외) */
const LABOR = "인건비";

const REPORTS = "/neander/finance/reports";

// ---- 작은 도우미 ------------------------------------------------

const won = (n: number) => `${shortWon(n)}원`;
const signedWon = (n: number) => `${n > 0 ? "+" : ""}${shortWon(n)}원`;
const pct = (ratio: number) => Math.round(ratio * 100);
const pathLabel = (path: string) => path.split("|").join(" › ");

/**
 * 금액 크기로 심각도 — 이번 달 순수지출에 견준 비중과 절대 하한을 함께 본다.
 * 비중만 보면 지출이 작은 사업장에서 몇 만원이 "high" 가 되고,
 * 절대액만 보면 회사 규모가 바뀔 때마다 문턱을 고쳐야 한다.
 */
function amountSeverity(amount: number, base: number): SignalSeverity {
  const a = Math.abs(amount);
  const b = Math.max(base, 1);
  if (a >= b * 0.1 && a >= 1_000_000) return "high";
  if (a >= b * 0.03 && a >= 300_000) return "medium";
  return "low";
}

const metric = (label: string, value: number, unit: SignalMetric["unit"]): SignalMetric => ({
  label,
  value: Math.round(unit === "배" ? value * 10 : value) / (unit === "배" ? 10 : 1),
  unit,
});

/** Anomaly.tsx 의 useIgnores 와 같은 방식으로 끄기 목록을 만든다 */
export function anomalyIgnoresOf(docs: FinAnomalyIgnoreDoc[]): AnomalyIgnores {
  const vendors = new Set<string>();
  const accounts = new Set<string>();
  (docs ?? []).forEach((d) => {
    if (d.kind === "vendor") vendors.add(d.key);
    else if (d.month) accounts.add(ignoredAccountKey(d.month, d.key));
  });
  return { vendors, accounts };
}

/** 장부의 첫 달 — 그보다 앞선 달은 "0원" 이 아니라 "기록 없음" (anomaly.ts 와 같은 생각) */
function firstMonthOf(txs: FinTransaction[]): string {
  let first = "9999-99";
  txs.forEach((t) => {
    const m = t.date?.slice(0, 7);
    if (m && m < first) first = m;
  });
  return first;
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function acctHref(path: string, month: string, site?: string, txTypes?: string[]): string {
  const [acctMajor, acctMid, acctMinor] = path.split("|");
  return ledgerHref({ month, acctMajor, acctMid, acctMinor, site, txTypes });
}

// ---- 본체 --------------------------------------------------------

export function buildFinanceSignals(input: FinanceSignalInput): Signal[] {
  const { month, site } = input;
  if (!/^\d{4}-\d{2}$/.test(month ?? "")) return [];
  const basis: Basis = input.basis ?? "accrual";
  const txs = input.transactions ?? [];
  if (txs.length === 0) return [];

  const isCard = makeIsCard(input.paymentMethods ?? []);
  const ignores = anomalyIgnoresOf(input.anomalyIgnores ?? []);
  const scope = site ? { site } : {};
  /** 사업장으로 좁힌 거래 — 사업부·구독 집계의 입력 */
  const scoped = site ? txs.filter((t) => inScope(t, scope)) : txs;
  const first = firstMonthOf(txs);

  const deck = buildMonthlyDeck(txs, { month, basis, isCard, site, trendMonths: 6 });
  const cur = buildReport(txs, { basis, isCard, scope: { month, site } });
  if (cur.scopedCount === 0) return [];
  const prev = buildReport(txs, { basis, isCard, scope: { month: deck.prevMonth, site } });
  const base = cur.total.expensePure;

  const out: Signal[] = [];
  const push = (s: Omit<Signal, "module">) => out.push({ module: "finance", ...s });

  // ---- 7. 순금액 (핵심 요약) ----------------------------------------
  {
    const net = deck.total.net;
    const earlier = deck.trend.slice(0, -1).filter((p) => p.month >= first);
    const last3 = earlier.slice(-3);
    const avg3 = last3.length ? last3.reduce((s, p) => s + p.net, 0) / last3.length : undefined;
    let streak = 0;
    for (let i = deck.trend.length - 1; i >= 0; i--) {
      const p = deck.trend[i];
      if (p.month < first || p.net >= 0) break;
      streak += 1;
    }
    const severity: SignalSeverity = streak >= 2 ? "high" : net < 0 ? "medium" : "low";
    const vsPrev = deck.hasPrev ? ` — 전월 ${signedWon(deck.prevTotal.net)}` : "";
    const sentences = [
      `수입 ${won(deck.total.income)}에서 순수지출(개인사용·환급 차감) ${won(deck.total.expensePure)}을 뺀 금액입니다.`,
    ];
    if (deck.hasPrev) {
      sentences.push(`전월 대비 ${signedWon(net - deck.prevTotal.net)}${avg3 !== undefined ? `, 직전 ${last3.length}개월 평균(${signedWon(avg3)}) 대비 ${signedWon(net - avg3)}` : ""}입니다.`);
    }
    if (streak >= 2) sentences.push(`${streak}개월 연속 순금액이 음수입니다.`);
    const metrics: SignalMetric[] = [
      metric("수입", deck.total.income, "원"),
      metric("순수지출", deck.total.expensePure, "원"),
      metric("순금액", net, "원"),
    ];
    if (deck.hasPrev) metrics.push(metric("전월 순금액", deck.prevTotal.net, "원"));
    if (avg3 !== undefined) metrics.push(metric(`직전 ${last3.length}개월 평균`, avg3, "원"));
    if (streak > 0) metrics.push(metric("연속 음수", streak, "개"));
    push({
      id: "cash-net",
      topic: "cash-net",
      severity,
      title: `이번 달 순금액 ${signedWon(net)}${vsPrev}`,
      detail: sentences.join(" "),
      metrics,
      chapter: "핵심 요약",
      href: `${REPORTS}?month=${month}${basis === "cash" ? "&basis=cash" : ""}${site ? `&site=${encodeURIComponent(site)}` : ""}`,
    });
  }

  // ---- 1. 계정 급증 (지출 구성) --------------------------------------
  {
    const spikes = accountSpikes(txs, month, scope, ignores);
    const paths = [...spikes.keys()];
    // 가장 깊은 경로만 — 소분류가 튀면 중·대분류도 따라 튀므로 겹쳐 세지 않는다
    const deepest = paths.filter((p) => !paths.some((q) => q !== p && q.startsWith(`${p}|`)));
    let history = 0;
    for (let i = 1; i <= 6; i++) if (shiftMonth(month, -i) >= first) history += 1;
    deepest
      .map((path) => ({ path, s: spikes.get(path)! }))
      .sort((a, b) => b.s.current - b.s.baseline - (a.s.current - a.s.baseline))
      .slice(0, 4)
      .forEach(({ path, s }) => {
        const diff = s.current - s.baseline;
        const isLabor = path.split("|")[0] === LABOR;
        const drivers = isLabor
          ? []
          : [...s.drivers.values()].slice(0, 3).map((d) => `${d.vendor}(${d.baseline > 0 ? `${won(d.baseline)}→` : "신규 "}${won(d.current)})`);
        const ratio = s.baseline > 0 ? s.current / s.baseline : 0;
        const title =
          s.baseline > 0
            ? `${pathLabel(path)} 지출 평소의 ${ratio.toFixed(1)}배 — ${won(s.baseline)} → ${won(s.current)}`
            : `${pathLabel(path)} 평소엔 없던 지출 ${won(s.current)}`;
        const detail = [
          `직전 ${history}개월 월 지출 중앙값 ${won(s.baseline)}과 비교해 ${signedWon(diff)} 늘었습니다 (지출 − 환급, 신뢰한 거래처 제외).`,
          drivers.length ? `증가를 이끈 거래처: ${drivers.join(", ")}.` : isLabor ? "인건비 계정이라 거래처(개인) 내역은 싣지 않습니다." : "",
          "한 달만의 일인지, 고정비로 굳어지는지 확인이 필요합니다.",
        ].filter(Boolean).join(" ");
        const metrics = [
          metric("이번 달", s.current, "원"),
          metric("직전 중앙값", s.baseline, "원"),
          metric("증가분", diff, "원"),
        ];
        if (ratio > 0) metrics.push(metric("배율", ratio, "배"));
        push({
          id: `fixed-cost-leak:${path}`,
          topic: "fixed-cost-leak",
          severity: amountSeverity(diff, base),
          title,
          detail,
          impact: -Math.round(diff),
          metrics,
          chapter: "지출 구성",
          href: acctHref(path, month, site, ["지출", "환급"]),
        });
      });
  }

  // ---- 2. 튄 거래 (지출 상위 거래처) ----------------------------------
  {
    const flags = txFlags(txs, month, ignores);
    if (flags.size > 0) {
      /** 거래처 과거 건별 금액 — bigger 의 평소 금액(anomaly.ts 와 같은 계산) */
      const past = new Map<string, number[]>();
      txs.forEach((t) => {
        const m = t.date?.slice(0, 7);
        if (!m || m >= month || t.txType !== "지출") return;
        const k = vendorKey(t.vendor);
        if (!k) return;
        (past.get(k) ?? past.set(k, []).get(k)!).push(netAmount(t));
      });

      type Cand = { amount: number; signal: Omit<Signal, "module"> };
      const cands: Cand[] = [];
      const newByVendor = new Map<string, { label: string; rows: FinTransaction[] }>();

      txs.forEach((t) => {
        const f = flags.get(t.id);
        if (!f || !inScope(t, scope) || t.acctMajor === LABOR) return;
        const n = netAmount(t);
        const k = vendorKey(t.vendor);
        if (f[0].kind === "newVendor") {
          const g = newByVendor.get(k) ?? { label: t.vendor?.trim() || k, rows: [] };
          g.rows.push(t);
          newByVendor.set(k, g);
        } else if (f[0].kind === "bigger") {
          const usual = median(past.get(k) ?? []);
          const acct = [t.acctMajor || NO_ACCOUNT, t.acctMid || NO_ACCOUNT, t.acctMinor || NO_ACCOUNT].join(" › ");
          cands.push({
            amount: n,
            signal: {
              id: `bigger-than-usual:${t.id}`,
              topic: "bigger-than-usual",
              severity: amountSeverity(n - usual, base),
              title: `${t.vendor?.trim()} ${won(n)} — 평소 건당 ${won(usual)}의 ${(n / usual).toFixed(1)}배`,
              detail: `${t.date} ${acct} 계정으로 나간 거래입니다. 이 거래처의 이전 건별 금액 중앙값(${won(usual)})보다 ${signedWon(n - usual)} 큽니다. 일회성 대량 구매인지 단가 인상인지 확인이 필요합니다.`,
              impact: -Math.round(n - usual),
              metrics: [metric("이번 거래", n, "원"), metric("평소 건당", usual, "원"), metric("배율", n / usual, "배")],
              chapter: "지출 상위 거래처",
              href: ledgerHref({ month, vendor: t.vendor, site }),
            },
          });
        }
      });

      newByVendor.forEach((g, k) => {
        const amount = g.rows.reduce((s, t) => s + netAmount(t), 0);
        const t0 = g.rows[0];
        const acct = [t0.acctMajor || NO_ACCOUNT, t0.acctMid || NO_ACCOUNT, t0.acctMinor || NO_ACCOUNT].join(" › ");
        cands.push({
          amount,
          signal: {
            id: `new-vendor:${k}`,
            topic: "new-vendor",
            severity: amountSeverity(amount, base),
            title: `처음 보는 거래처 ${g.label}에 ${won(amount)}${g.rows.length > 1 ? ` (${g.rows.length}건)` : ""}`,
            detail: `이전 달 장부에 한 번도 없던 거래처로 30만원 이상 나간 거래입니다 (${acct}). 새 공급처·새 계약이면 앞으로 매달 나갈 돈인지, 분류가 맞는지 확인이 필요합니다.`,
            metrics: [metric("금액", amount, "원"), metric("건수", g.rows.length, "건")],
            chapter: "지출 상위 거래처",
            href: ledgerHref({ month, vendor: g.label, site }),
          },
        });
      });

      cands
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 5)
        .forEach((c) => push(c.signal));
    }
  }

  // ---- 3. 사업부 손익 (사업부별 손익) ---------------------------------
  {
    const rules = input.allocations ?? [];
    const unitsOf = (m: string) => {
      const units = unitTotals(scoped, { basis, isCard, month: m });
      const alloc = allocate({ transactions: scoped, units, rules, basis, isCard, month: m });
      return { units, alloc, after: (u: UnitTotals) => u.net + (alloc.delta[u.key] ?? 0) };
    };
    const now = unitsOf(month);
    const before = unitsOf(deck.prevMonth);
    const prevNet = new Map(before.units.map((u) => [u.key, before.after(u)]));
    const allocNote =
      now.alloc.applied > 0
        ? `공통비 배분(규칙 ${now.alloc.applied}개) 후 숫자입니다 — 배분 기준은 사실이 아니라 경영 판단이라 규칙을 바꾸면 달라집니다.`
        : "활성 배분 규칙이 없어 공통비를 나누기 전 숫자입니다 — 공용 비용이 빠져 있어 실제보다 좋아 보일 수 있습니다.";
    const label = (u: UnitTotals) => `${u.bizMajor} · ${u.bizMinor}`;
    const emitted = new Set<string>();

    const unitSignal = (u: UnitTotals, kind: "loss" | "mover") => {
      const net = now.after(u);
      const p = prevNet.get(u.key);
      const delta = p === undefined ? undefined : net - p;
      const lossStreak = net < 0 && p !== undefined && p < 0;
      const title =
        kind === "loss"
          ? `${label(u)} 적자 ${signedWon(net)}${p !== undefined ? ` — 전월 ${signedWon(p)}` : ""}`
          : `${label(u)} 손익 전월 대비 ${signedWon(delta ?? 0)} — ${signedWon(p ?? 0)} → ${signedWon(net)}`;
      const metrics = [
        metric("수입", u.income, "원"),
        metric("비용", u.cost, "원"),
        metric("배분 조정", now.alloc.delta[u.key] ?? 0, "원"),
        metric("순손익", net, "원"),
      ];
      if (p !== undefined) metrics.push(metric("전월 순손익", p, "원"));
      push({
        id: `unit-pl:${u.key}`,
        topic: "unit-pl",
        severity: kind === "loss" ? (lossStreak ? "high" : "medium") : amountSeverity(delta ?? 0, base),
        title,
        detail: [
          `수입 ${won(u.income)}, 비용(지출 − 환급 − 개인사용) ${won(u.cost)}${now.alloc.delta[u.key] ? `, 배분 조정 ${signedWon(now.alloc.delta[u.key])}` : ""}입니다.`,
          kind === "loss" && lossStreak ? "전월에 이어 두 달 연속 적자입니다." : delta !== undefined ? `전월 대비 ${signedWon(delta)} 변했습니다.` : "",
          allocNote,
        ].filter(Boolean).join(" "),
        metrics,
        chapter: "사업부별 손익",
        href: ledgerHref({ month, bizMajor: u.bizMajor, bizMinor: u.bizMinor, site }),
      });
      emitted.add(u.key);
    };

    // 적자 사업부 — 수입이 없는 공통비 사업부(공용·홍대공용)는 원래 적자라 뺀다
    now.units
      .filter((u) => u.income > 0 && now.after(u) < 0)
      .sort((a, b) => now.after(a) - now.after(b))
      .slice(0, 3)
      .forEach((u) => unitSignal(u, "loss"));

    // 가장 크게 움직인 사업부 — 전월이 있었고 100만원 이상 움직였을 때만
    if (before.units.length > 0) {
      const mover = now.units
        .filter((u) => !emitted.has(u.key) && prevNet.has(u.key))
        .map((u) => ({ u, d: Math.abs(now.after(u) - prevNet.get(u.key)!) }))
        .sort((a, b) => b.d - a.d)[0];
      if (mover && mover.d >= 1_000_000) unitSignal(mover.u, "mover");
    }
  }

  // ---- 4. 예산 초과 (지출 구성) --------------------------------------
  // 예산 화면과 같게: 발생주의 · 사업장 없음 · 결산 = 순수지출 · 지출 대분류만
  if (!site) {
    const lines = budgetLinesOf(input.budgets ?? [], month);
    if (Object.keys(lines).length > 0) {
      const accounts = input.accounts?.length ? input.accounts : (FIN_ACCOUNTS as FinAccountDoc[]);
      const majors = expenseMajors(accounts);
      const report = buildReport(txs, { basis: "accrual", isCard, scope: { month } });
      const leaves: TreeNode[] = [];
      const walk = (n: TreeNode) => (n.children.length === 0 ? leaves.push(n) : n.children.forEach(walk));
      report.roots.filter((r) => majors.has(r.major)).forEach(walk);
      const budgetBase = report.total.expensePure;

      leaves
        .map((n) => ({ n, b: lines[n.path] ?? 0, a: n.value.expensePure }))
        .filter((x) => x.b > 0 && x.a > x.b)
        .sort((x, y) => y.a - y.b - (x.a - x.b))
        .slice(0, 3)
        .forEach(({ n, b, a }) => {
          push({
            id: `budget-overrun:${n.path}`,
            topic: "budget-overrun",
            severity: amountSeverity(a - b, budgetBase),
            title: `${pathLabel(n.path)} 예산 집행률 ${pct(a / b)}% — 예산 ${won(b)}에 ${won(a)} 사용`,
            detail: `이번 달 예산 ${won(b)}보다 ${won(a - b)} 더 썼습니다 (순수지출 기준, 발생주의). 일시적 초과인지, 예산을 현실에 맞게 올려야 하는지 판단이 필요합니다.`,
            impact: -Math.round(a - b),
            metrics: [metric("예산", b, "원"), metric("결산", a, "원"), metric("초과", a - b, "원"), metric("집행률", pct(a / b), "%")],
            chapter: "지출 구성",
            href: acctHref(n.path, month),
          });
        });

      const unbudgeted = leaves
        .filter((n) => !(lines[n.path] > 0) && n.value.expensePure > 0)
        .sort((x, y) => y.value.expensePure - x.value.expensePure);
      const unbudgetedAmount = unbudgeted.reduce((s, n) => s + n.value.expensePure, 0);
      if (unbudgeted.length > 0 && unbudgetedAmount >= 300_000) {
        const top = unbudgeted.slice(0, 3).map((n) => `${pathLabel(n.path)} ${won(n.value.expensePure)}`);
        push({
          id: "budget-overrun:unbudgeted",
          topic: "budget-overrun",
          severity: amountSeverity(unbudgetedAmount, budgetBase) === "high" ? "medium" : "low",
          title: `예산 없이 나간 지출 ${won(unbudgetedAmount)} (${unbudgeted.length}개 계정)`,
          detail: `이번 달 예산을 적지 않은 계정에서 순수지출이 발생했습니다. 큰 것: ${top.join(", ")}. 예산 누락인지 계획에 없던 지출인지 가려야 합니다.`,
          metrics: [metric("금액", unbudgetedAmount, "원"), metric("계정 수", unbudgeted.length, "개")],
          chapter: "지출 구성",
          href: `${REPORTS}/budget`,
        });
      }
    }
  }

  // ---- 5. 거래처 집중도 (지출 상위 거래처) ----------------------------
  // 덱 거래처 슬라이드와 같은 규칙: 순수지출 · 개인사용 제외 · 환급 차감 · 인건비 제외
  {
    const vmap = new Map<string, number>();
    cur.roots
      .flatMap((r) => r.children.flatMap((m) => m.children.flatMap((l) => l.rows)))
      .forEach((t) => {
        if (t.txType === "수입" || t.personalUse || t.acctMajor === LABOR) return;
        const v = t.vendor?.trim() || "(거래처 없음)";
        vmap.set(v, (vmap.get(v) ?? 0) + (t.txType === "환급" ? -netAmount(t) : netAmount(t)));
      });
    const positive = [...vmap.entries()].filter(([, a]) => a > 0);
    const total = positive.reduce((s, [, a]) => s + a, 0);
    const top = deck.vendors;
    if (total >= 1_000_000 && positive.length >= 3 && top.length > 0) {
      const share1 = top[0].amount / total;
      const top3 = top.slice(0, 3).reduce((s, v) => s + v.amount, 0);
      const share3 = top3 / total;
      if (share1 >= 0.3 || share3 >= 0.6) {
        push({
          id: "vendor-concentration",
          topic: "vendor-concentration",
          severity: share1 >= 0.5 || share3 >= 0.8 ? "medium" : "low",
          title:
            share1 >= 0.3
              ? `거래처 지출의 ${pct(share1)}%가 ${top[0].vendor} 한 곳 — ${won(top[0].amount)}`
              : `상위 3개 거래처가 거래처 지출의 ${pct(share3)}% — ${won(top3)}`,
          detail: `인건비·개인사용을 뺀 거래처 지출 ${won(total)} 가운데 1위 ${top[0].vendor} ${pct(share1)}%, 상위 3곳(${top.slice(0, 3).map((v) => v.vendor).join(", ")}) ${pct(share3)}%입니다. 한 곳에 몰리면 단가 협상력과 공급 차질 위험을 함께 봐야 합니다.`,
          metrics: [
            metric("거래처 지출", total, "원"),
            metric("1위 비중", pct(share1), "%"),
            metric("상위 3곳 비중", pct(share3), "%"),
          ],
          chapter: "지출 상위 거래처",
          href: ledgerHref({ month, vendor: top[0].vendor, site }),
        });
      }
    }
  }

  // ---- 6. 구독 (지출 구성) -------------------------------------------
  {
    const matchers = subscriptionMatchers(input.subscriptions ?? [], input.vendorRules ?? []);
    if (matchers.length > 0) {
      const history: string[] = [];
      for (let i = 5; i >= 0; i--) {
        const m = shiftMonth(month, -i);
        if (m >= first) history.push(m);
      }
      const { views, report } = subscriptionMonthView(scoped, matchers, month, history);
      const KINDS = new Set(["spike", "over", "split", "missing"]);
      const subs: Omit<Signal, "module">[] = [];
      views.forEach((v) => {
        const alerts = v.alerts.filter((a) => KINDS.has(a.kind));
        if (alerts.length === 0) return;
        const net = v.current?.net ?? 0;
        const spike = alerts.some((a) => a.kind === "spike");
        const over = alerts.some((a) => a.kind === "over");
        const extra = spike ? net - v.baseline : over && v.matcher.expected ? net - v.matcher.expected : 0;
        const title = spike
          ? `구독 ${v.matcher.service} ${won(net)} — 직전 중앙값 ${won(v.baseline)}의 ${(net / v.baseline).toFixed(1)}배`
          : over
            ? `구독 ${v.matcher.service} ${won(net)} — 월 예상 ${won(v.matcher.expected ?? 0)} 초과`
            : alerts[0].kind === "missing"
              ? `구독 ${v.matcher.service} 이번 달 결제 없음 — 평소 ${won(v.baseline)}`
              : `구독 ${v.matcher.service} 결제수단 ${v.current?.last4.length ?? 0}개로 분산`;
        const metrics = [metric("이번 달", net, "원"), metric("직전 중앙값", v.baseline, "원")];
        if (v.matcher.expected) metrics.push(metric("월 예상", v.matcher.expected, "원"));
        subs.push({
          id: `subscription:${v.matcher.service}`,
          topic: "subscription",
          severity: extra > 0 ? (amountSeverity(extra, base) === "low" ? "low" : "medium") : "low",
          title,
          detail: `${alerts.map((a) => a.message).join(" · ")}. 구독 계정(${v.matcher.cycle === "usage" ? "사용량 과금" : "월정액"}) 안에서 거래처 키워드로 맞춘 금액이며, 직전 ${history.filter((m) => m !== month).length}개월 중앙값과 비교했습니다.`,
          impact: extra > 0 ? -Math.round(extra) : undefined,
          metrics,
          chapter: "지출 구성",
          href: `${REPORTS}/subscriptions`,
        });
      });
      subs
        .sort((a, b) => Math.abs(b.impact ?? 0) - Math.abs(a.impact ?? 0))
        .slice(0, 3)
        .forEach((s) => push(s));

      // 개인 명의 카드 비중 — 구독 화면의 결제수단 정비 진행률과 같은 계산
      const personal = new Set((input.paymentMethods ?? []).filter((p) => p.personal).map((p) => p.last4));
      let personalAmt = 0;
      let corpAmt = 0;
      report.services.forEach((s) =>
        s.rows.forEach((t) => {
          if (t.txType !== "지출") return;
          if (personal.has(t.last4 ?? "")) personalAmt += netAmount(t);
          else corpAmt += netAmount(t);
        }),
      );
      const subTotal = personalAmt + corpAmt;
      if (personalAmt > 0 && subTotal > 0) {
        const ratio = personalAmt / subTotal;
        push({
          id: "subscription:personal-card",
          topic: "subscription",
          severity: ratio >= 0.3 ? "medium" : "low",
          title: `구독 결제의 ${pct(ratio)}%가 개인 명의 카드 — ${won(personalAmt)}`,
          detail: `이번 달 구독 결제 ${won(subTotal)} 가운데 ${won(personalAmt)}이 임직원 개인 명의 카드로 나갔습니다. 대납 정산이 필요하고, 법인카드로 옮기면 청구서만 봐도 귀속이 갈립니다.`,
          metrics: [metric("개인 카드", personalAmt, "원"), metric("구독 결제", subTotal, "원"), metric("비중", pct(ratio), "%")],
          chapter: "지출 구성",
          href: `${REPORTS}/subscriptions`,
        });
      }
    }
  }

  // ---- 8. 데이터 신뢰도 (집계 기준) -----------------------------------
  {
    const monthRows = txs.filter((t) => inScope(t, { month, site }));
    const unreviewed = monthRows.filter((t) => t.status === "suggested" || t.status === "needs_review");
    const needsReview = unreviewed.filter((t) => t.status === "needs_review").length;
    const unreviewedAmt = unreviewed.reduce((s, t) => s + Math.abs(netAmount(t)), 0);
    const noAcct = cur.roots.find((r) => r.path === NO_ACCOUNT);
    const uncategorized = noAcct?.value.expensePure ?? 0;
    const uncategorizedIncome = noAcct?.value.income ?? 0;
    if (unreviewed.length > 0 || uncategorized !== 0 || uncategorizedIncome !== 0) {
      const scale = Math.max(cur.total.income + cur.total.expensePure, 1);
      const share = unreviewedAmt / scale;
      const severity: SignalSeverity =
        share >= 0.3 || Math.abs(uncategorized) >= base * 0.1 ? "high" : needsReview > 0 || share >= 0.1 ? "medium" : "low";
      const parts: string[] = [];
      if (unreviewed.length) parts.push(`미확정 ${unreviewed.length}건 ${won(unreviewedAmt)}`);
      if (uncategorized) parts.push(`미분류 지출 ${won(uncategorized)}`);
      if (uncategorizedIncome) parts.push(`미분류 수입 ${won(uncategorizedIncome)}`);
      push({
        id: "data-reliability",
        topic: "data-reliability",
        severity,
        title: `이번 달 장부 ${parts.join(" · ")}`,
        detail: [
          unreviewed.length
            ? `자동분류가 제안만 했거나(${unreviewed.length - needsReview}건) 판단하지 못한(${needsReview}건) 거래가 남아 있어, 분류가 바뀌면 계정·사업부 숫자가 움직입니다 (금액은 절댓값 합, 규모 대비 ${pct(share)}%).`
            : "",
          uncategorized || uncategorizedIncome ? `계정이 비어 있는 거래는 「${NO_ACCOUNT}」로 모여 구성 슬라이드에서 원인을 설명할 수 없습니다.` : "",
          "발표 전에 검토 대기함을 비우는 것이 좋습니다.",
        ].filter(Boolean).join(" "),
        metrics: [
          metric("미확정 건수", unreviewed.length, "건"),
          metric("검토필요 건수", needsReview, "건"),
          metric("미확정 금액", unreviewedAmt, "원"),
          metric("미분류 지출", uncategorized, "원"),
        ],
        chapter: "집계 기준",
        href: "/neander/finance/review",
      });
    }
  }

  // ---- 9. 수입 구성 (수입 구성) --------------------------------------
  if (deck.hasPrev) {
    const mids = (roots: TreeNode[]) =>
      new Map(roots.flatMap((r) => r.children).filter((n) => n.value.income !== 0).map((n) => [n.path, n.value.income]));
    const now = mids(cur.roots);
    const before = mids(prev.roots);
    const moves = [...new Set([...now.keys(), ...before.keys()])]
      .map((path) => ({ path, value: now.get(path) ?? 0, prev: before.get(path) ?? 0 }))
      .map((x) => ({ ...x, d: x.value - x.prev }))
      .filter((x) => x.d !== 0)
      .sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
    const m = moves[0];
    const incomeTotal = cur.total.income;
    if (m && Math.abs(m.d) >= 300_000) {
      const ratio = m.prev !== 0 ? m.d / Math.abs(m.prev) : undefined;
      const share = incomeTotal > 0 ? m.value / incomeTotal : 0;
      const metrics = [
        metric("이번 달", m.value, "원"),
        metric("전월", m.prev, "원"),
        metric("변동", m.d, "원"),
        metric("수입 중 비중", pct(share), "%"),
      ];
      if (ratio !== undefined) metrics.push(metric("변동률", pct(ratio), "%"));
      const totalDelta = incomeTotal - prev.total.income;
      push({
        id: "income-mix",
        topic: "income-mix",
        severity: amountSeverity(m.d, Math.max(prev.total.income, 1)) === "high" && m.d < 0 ? "high" : m.d < 0 ? "medium" : "low",
        title: `수입 ${pathLabel(m.path)} ${won(m.value)} — 전월 대비 ${signedWon(m.d)}${ratio !== undefined ? ` (${ratio > 0 ? "+" : ""}${pct(ratio)}%)` : ""}`,
        detail: `수입 중분류 가운데 전월보다 가장 크게 움직인 항목입니다 (${won(m.prev)} → ${won(m.value)}). 전체 수입은 ${won(prev.total.income)} → ${won(incomeTotal)}(${signedWon(totalDelta)})이고, 이 항목이 이번 달 수입의 ${pct(share)}%입니다.`,
        metrics,
        chapter: "수입 구성",
        href: acctHref(m.path, month, site, ["수입"]),
      });
    }
  }

  return sortSignals(out).slice(0, MAX_SIGNALS);
}
