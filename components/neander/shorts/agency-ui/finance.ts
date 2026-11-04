// ============================================================
//  대행 화면 계산 조각 (화면에서만 쓰는 순수 함수)
// ------------------------------------------------------------
//  업체의 재무 계약 요약(ClientFinanceSummary · 서버가 계산)을 화면 한 줄로 합친다 —
//  대시보드 · 업체 목록 · 계약 · 업체 상세가 같은 합계를 쓰게.
//  계산식은 새로 만들지 않는다: 연체는 재무의 installmentStatus, 부가세 풀기는 splitVat 그대로.
// ============================================================

import { installmentStatus } from "@/lib/neander/finance/project";
import { todayStrKST } from "@/lib/neander/format";
import type { ClientFinanceSummary } from "@/lib/neander/shorts/agency";

export type VatBasis = "excluded" | "included" | "mixed";

/** 금액 옆에 붙이는 부가세 기준 */
export const vatText = (v: VatBasis | "excluded" | "included") => (v === "excluded" ? "부가세 별도" : v === "included" ? "부가세 포함" : "부가세 기준 섞임");

export interface FinanceRollup {
  /** 재무에서 찾은 계약 수 */
  count: number;
  contract: number;
  /** 회차가 하나도 없으면 셀 수 없다 — null */
  received: number | null;
  remaining: number | null;
  overdue: number;
  vat: VatBasis;
  next: { date: string; label: string; amount: number; vat: "excluded" | "included"; code: string } | null;
  contracts: (ClientFinanceSummary["contracts"][number] & { code: string; projectId: string | null })[];
}

/** 업체 하나의 재무 계약(여러 개)을 합친다. 재무에서 찾은 것이 없으면 null */
export function rollupFinance(fs: ClientFinanceSummary[] | undefined): FinanceRollup | null {
  const linked = (fs ?? []).filter((x) => x.projectId);
  if (!linked.length) return null;
  const known = linked.filter((x) => x.received !== null);
  const vats = new Set(linked.map((x) => x.vatMode));
  const next =
    linked
      .flatMap((x) => (x.next ? [{ ...x.next, vat: x.vatMode, code: x.code }] : []))
      .sort((a, b) => a.date.localeCompare(b.date))[0] ?? null;
  return {
    count: linked.length,
    contract: linked.reduce((n, x) => n + x.contractAmount, 0),
    received: known.length ? known.reduce((n, x) => n + (x.received ?? 0), 0) : null,
    remaining: known.length ? known.reduce((n, x) => n + (x.remaining ?? 0), 0) : null,
    overdue: linked.reduce((n, x) => n + x.overdue, 0),
    vat: vats.size === 1 ? [...vats][0] : "mixed",
    next,
    contracts: linked.flatMap((x) => x.contracts.map((k) => ({ ...k, code: x.code, projectId: x.projectId }))),
  };
}

export interface OverdueLine {
  key: string;
  code: string;
  name: string;
  projectId: string | null;
  kind: string;
  amount: number;
  dueDate: string;
  vat: "excluded" | "included";
  /** 기한에서 며칠 지났나 */
  days: number;
}

type SummaryInstallment = ClientFinanceSummary["installments"][number];

/** 회차 상태 — 받음 · 연체 · 예정 (재무의 규칙 그대로. 요약의 null 을 재무 모양에 맞춘다) */
export const installmentState = (i: SummaryInstallment, today = todayStrKST()) =>
  installmentStatus({ dueDate: i.dueDate ?? undefined, paidDate: i.paidDate ?? undefined, received: i.received }, today);

/** 기한이 지났는데 받지 못한 회차 — 재무의 회차 상태 규칙 그대로 */
export function overdueLines(fs: ClientFinanceSummary[] | undefined, today = todayStrKST()): OverdueLine[] {
  const out: OverdueLine[] = [];
  for (const x of fs ?? []) {
    if (!x.projectId) continue;
    for (const i of x.installments) {
      if (installmentState(i, today) !== "overdue" || !i.dueDate) continue;
      out.push({ key: `${x.code}-${i.id}`, code: x.code, name: x.name, projectId: x.projectId, kind: i.kind, amount: i.amount, dueDate: i.dueDate, vat: x.vatMode, days: daysBetween(i.dueDate, today) });
    }
  }
  return out.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

/** YYYY-MM-DD 두 날 사이 날 수 */
export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Number.isFinite(a) && Number.isFinite(b) ? Math.round((b - a) / 86_400_000) : 0;
}

const WEEK = ["일", "월", "화", "수", "목", "금", "토"];

/** 시각(ms) → 「11/3 (화)」 (한국 시각) */
export function fmtDayKst(ms: number | null | undefined): string {
  if (!ms) return "—";
  const d = new Date(ms + 9 * 3600_000);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} (${WEEK[d.getUTCDay()]})`;
}

/** 날짜 글자 YYYY-MM-DD → 「11/25 (수)」 · 다른 모양이면 그대로 */
export function fmtDateStr(s: string | null | undefined): string {
  if (!s) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return s;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return `${Number(m[2])}/${Number(m[3])} (${WEEK[d.getUTCDay()]})`;
}

/** 원 단위 숫자 */
export const wonText = (n: number) => `${Math.round(n).toLocaleString("ko-KR")}원`;
