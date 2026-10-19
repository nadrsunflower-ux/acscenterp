// ============================================================
//  프로젝트 보고서 — 첫 장(요약)의 숫자
// ------------------------------------------------------------
//  보고서는 내부 보고용이고, 진행 중에는 「중간 보고」, 끝나면 「결산」 이다.
//  둘은 양식이 같고 읽는 법만 다르다(2026-10-19 사용자 결정).
//
//    판정 한 줄   계획 이익률 → 예상(최종) 이익률 · 미수 · 확인할 것
//    손익         계획(견적) · 확정 · 남은 예상 · 예상 최종 · 차이
//                 진행 중에는 「남은 예상」 이 차 있고, 끝나면 0 이 된다.
//                 확정과 견적을 한 칸에 섞지 않는다 — 업계 WIP 표의 첫째 원칙.
//    진행         일정 · 준비 · 원가 확정 · 입금 — 중간 보고의 몸통
//    큰 차이      견적과 크게 다른 줄만, 비고를 사유로
//    확인할 것    연체 · 받을 날 없음 · 빈 실제금액 · 준비 안 됨 · 원장 불일치 …
//
//  화면은 app/neander/finance/projects/[id]/report. 근거는 리서치
//  「프로젝트별 보고서 양식 비교」(PMBOK·PRINCE2 종료 보고, 한 장 상태 보고,
//  WIP·Maconomy 손익 화면).
// ============================================================

import {
  dueLabel,
  hasActual,
  installmentStatus,
  laborTotal,
  lineActual,
  lineEstimate,
  splitVat,
  type FinProjectDoc,
  type FinProjectLine,
  type ProjectStatus,
  type ProjectSummary,
} from "./project";
import { addDays, shiftMonth } from "../format";
import { netAmount, type FinTransaction } from "./types";

export type ReportPhase = "interim" | "final";

export const PHASE_LABEL: Record<ReportPhase, string> = { interim: "중간 보고", final: "결산 보고" };

/** 끝났거나 접은 건은 결산, 나머지는 중간 보고 */
export const reportPhase = (status: ProjectStatus): ReportPhase =>
  status === "done" || status === "cancelled" ? "final" : "interim";

// ---- 원가: 확정 · 남은 예상 ---------------------------------------

export interface CostSplit {
  /** 계획 = Σ 견적 */
  plan: number;
  /** 실제금액이 적힌 줄의 합 */
  confirmed: number;
  /** 실제금액이 아직 없는 줄의 견적 합 — 진행 중이면 「앞으로 나갈 돈」. 견적 0원 줄은 확정(0원)으로 본다 */
  remaining: number;
  /** 예상 최종 = 확정 + 남은 예상 */
  forecast: number;
  confirmedLines: number;
  remainingLines: number;
}

export function costSplit(lines: FinProjectLine[]): CostSplit {
  let confirmed = 0;
  let remaining = 0;
  let confirmedLines = 0;
  let remainingLines = 0;
  let plan = 0;
  for (const l of lines) {
    const est = lineEstimate(l);
    plan += est;
    if (hasActual(l)) {
      confirmed += lineActual(l);
      confirmedLines += 1;
    } else if (est === 0) {
      // 견적 0원(보유 장비 · 무상 제공)인 줄은 기다릴 돈이 없다 — 0원으로 확정
      confirmedLines += 1;
    } else {
      remaining += est;
      remainingLines += 1;
    }
  }
  return { plan, confirmed, remaining, forecast: confirmed + remaining, confirmedLines, remainingLines };
}

// ---- 사내 인력 하루 단가 추천 ---------------------------------------

/** 4대보험 회사 부담 — 국민연금·건강·장기요양·고용·산재를 합치면 급여의 약 10% */
export const EMPLOYER_LOAD = 1.1;
/** 한 달 근무일 */
export const WORKDAYS_PER_MONTH = 21;

export interface DayRateHint {
  /** 원장 급여 거래처 이름 */
  name: string;
  /** 급여가 찍힌 달의 월평균 */
  monthly: number;
  /** 월평균 × 1.1 ÷ 21, 천 원 단위 올림 */
  dayRate: number;
  months: number;
}

/**
 * 하루 단가 추천 — 원장의 끝난 달 최근 3개월 「인건비 › 급여」 를 사람(거래처)별로
 * 모은다. 급여가 찍힌 달로만 나눠 새로 온 사람의 단가가 낮게 나오지 않게 한다.
 * 추천일 뿐이다 — 프로젝트에는 사람이 확인한 값이 그때 값으로 남는다.
 */
const NOT_A_NAME = new Set(["월급", "급여", "상여", "인건비"]);

export function suggestDayRates(transactions: FinTransaction[], thisMonth: string): DayRateHint[] {
  const months = new Set([1, 2, 3].map((k) => shiftMonth(thisMonth, -k)));
  const byName = new Map<string, Map<string, number>>();
  for (const t of transactions) {
    if (t.txType !== "지출" || t.acctMajor !== "인건비" || t.acctMid !== "급여") continue;
    const m = (t.date ?? "").slice(0, 7);
    // 거래처가 「김명연 급여」 처럼 적힌 것도 사람 이름으로 모은다. 「월급」 은 이름이 아니다
    const name = (t.vendor ?? "").trim().replace(/\s*급여$/, "").trim();
    if (!months.has(m) || !name || NOT_A_NAME.has(name)) continue;
    const per = byName.get(name) ?? new Map<string, number>();
    per.set(m, (per.get(m) ?? 0) + netAmount(t));
    byName.set(name, per);
  }
  return [...byName.entries()]
    .map(([name, per]) => {
      const total = [...per.values()].reduce((a, b) => a + b, 0);
      const monthly = total / Math.max(1, per.size);
      return {
        name,
        monthly: Math.round(monthly),
        dayRate: Math.ceil((monthly * EMPLOYER_LOAD) / WORKDAYS_PER_MONTH / 1000) * 1000,
        months: per.size,
      };
    })
    .filter((h) => h.monthly > 0)
    .sort((a, b) => b.monthly - a.monthly);
}

// ---- 큰 차이 ------------------------------------------------------

/** 이 비율 이상이면서 이 금액 이상 다를 때만 「큰 차이」 — 작은 줄의 잡음을 막는다 */
export const VARIANCE_RATIO = 0.1;
export const VARIANCE_MIN = 100_000;

export interface Variance {
  line: FinProjectLine;
  estimate: number;
  actual: number;
  /** 실제 − 견적 (양수 = 더 들었다) */
  diff: number;
}

export function bigVariances(lines: FinProjectLine[], limit = 3): Variance[] {
  return lines
    .filter(hasActual)
    .map((line) => {
      const estimate = lineEstimate(line);
      const actual = lineActual(line);
      return { line, estimate, actual, diff: actual - estimate };
    })
    .filter((v) => Math.abs(v.diff) >= VARIANCE_MIN && (v.estimate === 0 || Math.abs(v.diff) / v.estimate >= VARIANCE_RATIO))
    .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))
    .slice(0, limit);
}

// ---- 진행 ----------------------------------------------------------

const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** 일정 한 줄 — 시작 전 D-n · 진행 n일째 · 끝난 지 n일 */
export function scheduleText(start: string | undefined, end: string | undefined, today: string): string {
  if (!start) return "기간 미정";
  const last = end && end >= start ? end : start;
  const total = daysBetween(start, last) + 1;
  if (today < start) return `시작까지 D-${daysBetween(today, start)}`;
  if (today <= last) return total > 1 ? `진행 ${daysBetween(start, today) + 1}일째 · 총 ${total}일` : "오늘 진행";
  return `끝난 지 ${daysBetween(last, today)}일`;
}

export interface NextPayment {
  kind: string;
  /** 청구 총액(부가세 포함) */
  amount: number;
  /** 「2026년 10월 말」 · 날짜 · 빈 글자(날짜 없음) */
  due: string;
  overdue: boolean;
}

/** 아직 안 받은 회차 중 가장 이른 것 — 날짜 없는 회차는 맨 뒤 */
export function nextPayment(p: Pick<FinProjectDoc, "installments" | "vatMode">, today: string): NextPayment | null {
  const open = (p.installments ?? []).filter((i) => !i.paidDate && (Number(i.amount) || 0) > 0);
  if (open.length === 0) return null;
  const first = [...open].sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"))[0];
  return {
    kind: first.kind,
    amount: splitVat(first.amount, p.vatMode ?? "excluded").total,
    due: dueLabel(first),
    overdue: installmentStatus(first, today) === "overdue",
  };
}

// ---- 확인할 것 ------------------------------------------------------

export type CheckTone = "danger" | "warning" | "info";

export interface CheckItem {
  tone: CheckTone;
  text: string;
}

const won = (n: number) => Math.round(n).toLocaleString("ko-KR");

/** 시작이 이만큼 안으로 다가오면 준비 안 된 줄을 경고로 올린다 */
const PREP_WARN_DAYS = 7;

export function checkItems(
  p: FinProjectDoc,
  s: ProjectSummary,
  cost: CostSplit,
  phase: ReportPhase,
  today: string,
): CheckItem[] {
  const out: CheckItem[] = [];
  const inst = p.installments ?? [];

  if (s.overdueCount > 0) {
    out.push({ tone: "danger", text: `받기로 한 날이 지난 회차 ${s.overdueCount}건 · ${won(s.overdue)}원 — 청구서를 냈는지부터 확인` });
  }
  const undated = inst.filter((i) => !i.paidDate && !i.dueDate && (Number(i.amount) || 0) > 0);
  if (undated.length > 0) {
    out.push({ tone: "warning", text: `받을 날이 없는 회차 ${undated.length}건 — 「10월 말」 처럼 대략이라도 적어 두면 런웨이에 들어갑니다` });
  }
  if (inst.length === 0 && s.revenueTotal > 0 && s.unpaid > 0) {
    out.push({ tone: "warning", text: "입금 회차가 없습니다 — 언제 얼마를 받을지 적어 두세요" });
  } else if (s.installmentCount > 0 && Math.abs(s.scheduleGap) >= 1) {
    out.push({
      tone: "warning",
      text: `회차 합계가 계약 청구액보다 ${won(Math.abs(s.scheduleGap))}원 ${s.scheduleGap > 0 ? "적습니다 — 아직 안 나눈 몫" : "많습니다 — 금액 확인"}`,
    });
  }
  if (s.deductionPending > 0) {
    out.push({ tone: "warning", text: `발주처에 돌려줄 돈 ${won(s.deductionPending)}원이 남았습니다` });
  }

  if (laborTotal(p.labor) === 0 && s.revenue > 0) {
    out.push({
      tone: phase === "final" ? "warning" : "info",
      text: "사내 인력을 안 적었습니다 — 정직원 · 대표가 쓴 날을 적어야 「인력 반영 이익」 이 나옵니다",
    });
  }

  if (s.lineCount === 0) {
    out.push({ tone: "warning", text: "지출 줄이 없습니다 — 원가 0 으로 계산돼 이익이 부풀어 보입니다" });
  } else if (cost.remainingLines > 0) {
    out.push(
      phase === "final"
        ? { tone: "warning", text: `실제금액이 빈 줄 ${cost.remainingLines}개(견적 ${won(cost.remaining)}원)를 견적으로 계산했습니다 — 결산 전에 채우세요` }
        : { tone: "info", text: `아직 실제금액이 없는 줄 ${cost.remainingLines}개(견적 ${won(cost.remaining)}원)는 견적으로 셉니다` },
    );
  }

  if (phase === "interim" && s.lineCount > 0 && s.doneCount < s.lineCount) {
    const left = s.lineCount - s.doneCount;
    const soon = p.startDate ? p.startDate <= addDays(today, PREP_WARN_DAYS) : false;
    out.push({
      tone: soon ? "warning" : "info",
      text: `준비 안 된 줄 ${left}개${p.startDate && p.startDate >= today ? ` · ${scheduleText(p.startDate, p.endDate, today)}` : ""}`,
    });
  }

  // 원장 대조 — 확정 원가와 비교한다 (견적으로 채운 몫은 원장에 있을 수 없다)
  if (s.ledger.count > 0) {
    const ledgerOut = s.ledger.expense - s.ledger.refund;
    const gap = ledgerOut - cost.confirmed;
    if (Math.abs(gap) >= VARIANCE_MIN && Math.abs(gap) >= Math.max(cost.confirmed, ledgerOut) * VARIANCE_RATIO) {
      out.push({
        tone: "info",
        text:
          gap > 0
            ? `원장 지출이 확정 원가보다 ${won(gap)}원 많습니다 — 지출 줄에 안 적은 결제가 있는지`
            : `확정 원가가 원장 지출보다 ${won(-gap)}원 많습니다 — 카드 대금이 아직 안 찍혔거나 현금·재고 지출`,
      });
    }
  }

  const rank: Record<CheckTone, number> = { danger: 0, warning: 1, info: 2 };
  return out.sort((a, b) => rank[a.tone] - rank[b.tone]);
}

// ---- 판정 한 줄 -----------------------------------------------------

const pct = (m: number | null) => (m === null ? "—" : `${(m * 100).toFixed(0)}%`);

export function verdictLine(
  s: ProjectSummary,
  phase: ReportPhase,
  checks: CheckItem[],
  extra: { labor?: number; openTodos?: number } = {},
): string[] {
  const parts: string[] = [];
  if (s.lineCount > 0 && s.marginEstimate !== null && s.marginActual !== null) {
    const d = Math.round((s.marginActual - s.marginEstimate) * 100);
    parts.push(
      `계획 이익률 ${pct(s.marginEstimate)} → ${phase === "final" ? "최종" : "예상"} ${pct(s.marginActual)}${d === 0 ? "" : ` (${d > 0 ? "+" : ""}${d}%p)`}`,
    );
  } else if (s.marginActual !== null) {
    parts.push(`이익률 ${pct(s.marginActual)}`);
  }
  // 사내 인력을 적었으면 그것까지 뺀 이익률 — 외부 원가만 본 이익률은 크게 보인다
  if ((extra.labor ?? 0) > 0 && s.revenue > 0) {
    parts.push(`인력 반영 ${pct((s.profitActual - (extra.labor ?? 0)) / s.revenue)}`);
  }
  if (s.revenueTotal > 0) {
    parts.push(s.unpaid > 0 ? `미수 ${won(s.unpaid)}원${s.overdueCount > 0 ? ` (연체 ${s.overdueCount}건)` : ""}` : "다 받음");
  }
  if ((extra.openTodos ?? 0) > 0) parts.push(`남은 일 ${extra.openTodos}건`);
  const need = checks.filter((c) => c.tone !== "info").length;
  parts.push(need > 0 ? `확인할 것 ${need}건` : "확인할 것 없음");
  return parts;
}
