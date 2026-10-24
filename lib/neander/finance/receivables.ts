// ============================================================
//  받을 돈 ↔ 들어온 돈 — 입금을 프로젝트 입금 회차에 짝짓는다
// ------------------------------------------------------------
//  회차(project.ts 의 installments)는 「입금일」 한 칸으로만 받았다고 적는다. 그런데
//  장부에는 그 입금이 이미 들어와 있다 — 사람이 둘을 눈으로 맞춰 날짜를 옮겨 적었다.
//  그동안 런웨이는 같은 돈을 통장 잔액과 받을 돈에 두 번 셌다.
//
//  짝짓기는 단계식이다 (결정 규칙 먼저 · 점수는 다음 · 낮으면 사람).
//    ① 금액   받을 돈(부가세 포함 총액)과 입금이 같다 · 수수료(3천 원 이하)만큼 모자란다 ·
//             한 회차보다 작다(부분 입금) · 같은 프로젝트 회차 여럿의 합과 같다(합산 입금)
//    ② 누가   입금자가 이 프로젝트 코드로 묶여 있다 · 예전에 이 발주처 돈을 보낸 이름이다
//             (사람이 짝지은 입금에서 배운다) · 발주처 이름과 겹친다
//    ③ 언제   받을 날 30일 전 ~ 45일 뒤
//  금액이 같아도 누가 보냈는지 모르면 「확신 낮음」 이다 — 매장 카드 정산금이 우연히
//  같은 금액일 수 있다. 맞는 조합이 둘 이상이면 고르지 않고 후보만 보인다.
//
//  ⚠️ 짝짓기는 제안이다. 사람이 「받음 처리」 를 눌러야 회차에 입금일이 찍힌다
//     (mutate 의 project.markReceived). 그때 입금 거래에는 회차 열쇠(receiptOf)와
//     프로젝트 코드가 같이 남는다 — 다음 입금의 「누가」 근거가 된다.
//
//  부가세: 회차 금액은 계약과 같은 기준이다 (별도면 공급가액). 통장에는 부가세까지
//  들어오므로 늘 splitVat(...).total 로 견준다.
// ============================================================

import { isInstallmentReceived, splitVat, type FinProjectDoc } from "./project";
import { netAmount, type FinTransaction } from "./types";
import type { FinPaymentMethodDoc } from "./db-types";

/** 수수료로 보는 모자람 — 이체 · 해외송금 수수료 */
export const FEE_TOLERANCE = 3_000;
/** 받을 날 기준 얼마 전 · 얼마 뒤의 입금까지 보는가 */
const BEFORE_DAYS = 30;
const AFTER_DAYS = 45;

export const receiptKey = (projectId: string, installmentId: string) => `${projectId}:${installmentId}`;

/** 회사 이름 비교 — (주) · 주식회사 · 띄어쓰기 · 기호를 뗀다 */
export const normPayer = (s?: string) =>
  (s ?? "")
    .toLowerCase()
    .replace(/\(주\)|㈜|주식회사|\(유\)|유한회사|\(사\)|사단법인|재단법인|\(재\)/g, "")
    .replace(/[^\p{L}\p{N}]/gu, "");

const dayMs = 24 * 60 * 60 * 1000;
const dayDiff = (a: string, b: string) => Math.round((Date.parse(a) - Date.parse(b)) / dayMs);

export interface OpenInstallment {
  key: string;
  projectId: string;
  projectName: string;
  code: string;
  client?: string;
  installmentId: string;
  kind: string;
  /** 통장에 들어올 금액 (부가세 포함) */
  due: number;
  /** 이미 짝지은 입금 합 */
  received: number;
  remaining: number;
  dueDate?: string;
}

/** 아직 다 받지 않은 회차 — 짝지은 입금을 빼고 남은 돈 */
export function openInstallments(projects: FinProjectDoc[], transactions: FinTransaction[]): OpenInstallment[] {
  const got = new Map<string, number>();
  transactions.forEach((t) =>
    (t.receiptOf ?? []).forEach((k) => got.set(k, (got.get(k) ?? 0) + netAmount(t) / Math.max(1, t.receiptOf!.length))),
  );
  const out: OpenInstallment[] = [];
  projects.forEach((p) => {
    if (p.status === "cancelled") return;
    const base = p.vatMode ?? "excluded";
    (p.installments ?? []).forEach((i) => {
      if (isInstallmentReceived(i)) return;
      const amount = Math.round(Number(i.amount) || 0);
      if (amount <= 0) return;
      const key = receiptKey(p.id, i.id);
      const due = splitVat(amount, base).total;
      const received = Math.round(got.get(key) ?? 0);
      out.push({
        key,
        projectId: p.id,
        projectName: p.name,
        code: p.code,
        client: p.client,
        installmentId: i.id,
        kind: i.kind,
        due,
        received,
        remaining: due - received,
        dueDate: i.dueDate,
      });
    });
  });
  return out;
}

/**
 * 발주처마다 「예전에 이 발주처 돈을 보낸 입금자 이름」 — 사람이 짝지은 입금에서 배운다.
 * 짝짓기 기록이 없던 예전 회차는 입금일 ±3일 · 같은 금액 · 같은 프로젝트 코드인 입금이
 * 하나뿐일 때만 그 이름을 쓴다.
 */
export function payerAliases(projects: FinProjectDoc[], transactions: FinTransaction[]): Map<string, Set<string>> {
  const byProject = new Map(projects.map((p) => [p.id, p]));
  const out = new Map<string, Set<string>>();
  const add = (p: FinProjectDoc | undefined, vendor?: string) => {
    const name = normPayer(vendor);
    if (!p || name.length < 2) return;
    [p.id, normPayer(p.client)].filter(Boolean).forEach((k) => {
      const set = out.get(k) ?? new Set<string>();
      set.add(name);
      out.set(k, set);
    });
  };
  transactions.forEach((t) => (t.receiptOf ?? []).forEach((k) => add(byProject.get(k.split(":")[0]), t.vendor)));
  const incomes = transactions.filter((t) => t.txType === "수입" && netAmount(t) > 0);
  projects.forEach((p) => {
    const base = p.vatMode ?? "excluded";
    (p.installments ?? []).forEach((i) => {
      if (!i.paidDate) return;
      const due = splitVat(Math.round(Number(i.amount) || 0), base).total;
      const hits = incomes.filter(
        (t) =>
          Math.abs(dayDiff(t.date, i.paidDate!)) <= 3 &&
          Math.abs(netAmount(t) - due) <= FEE_TOLERANCE &&
          (t.projectCode ?? "").trim().toLowerCase() === p.code.trim().toLowerCase(),
      );
      if (hits.length === 1) add(p, hits[0].vendor);
    });
  });
  return out;
}

export type MatchAmount = "exact" | "fee" | "partial" | "sum";
export type MatchWho = "code" | "alias" | "name" | "none";
export type MatchConfidence = "high" | "medium" | "low";

export interface ReceiptMatch {
  /** 입금 거래 */
  tx: { id: string; date: string; vendor?: string; amount: number; last4?: string };
  /** 채울 회차 — 합산 입금이면 여럿 */
  targets: OpenInstallment[];
  amount: MatchAmount;
  who: MatchWho;
  confidence: MatchConfidence;
  /** 사람이 읽는 근거 */
  reasons: string[];
  /** 같은 입금에 맞는 다른 조합 · 같은 회차에 맞는 다른 입금이 있다 — 사람이 고른다 */
  ambiguous: boolean;
}

const won = (n: number) => Math.round(n).toLocaleString("ko-KR");

/**
 * 짝지을 입금이 될 수 있는가. 통장으로 들어온 수입만 — 카드 · 현금은 아니다.
 * 이미 다른 회차에 짝지었거나, 다른 프로젝트 코드로 묶였거나, 사람이 B2B 가 아닌
 * 매출(매장 정산 등)로 확정한 입금은 뺀다.
 */
function isCandidate(t: FinTransaction, accounts: Set<string>): boolean {
  if (t.txType !== "수입" || netAmount(t) <= 0 || (t.receiptOf?.length ?? 0) > 0) return false;
  if (!t.last4 || !accounts.has(t.last4)) return false;
  if (t.status === "confirmed" && t.acctMinor && t.bizMajor && t.bizMajor !== "B2B" && t.acctMid !== "B2B매출") return false;
  return true;
}

export interface MatchInput {
  projects: FinProjectDoc[];
  transactions: FinTransaction[];
  paymentMethods: FinPaymentMethodDoc[];
  /** `YYYY-MM-DD` — 이보다 뒤의 입금은 아직 없다 */
  today: string;
}

/**
 * 짝지을 후보를 찾는다. 입금 하나에 한 묶음, 회차 하나에 한 입금이 되게 확신이 높은 것부터
 * 고르고, 같은 확신으로 둘 이상이 맞으면 ambiguous 로 남긴다.
 */
export function matchReceipts({ projects, transactions, paymentMethods, today }: MatchInput): ReceiptMatch[] {
  const open = openInstallments(projects, transactions);
  if (open.length === 0) return [];
  const accounts = new Set(paymentMethods.filter((p) => p.kind === "account").map((p) => p.last4));
  const aliases = payerAliases(projects, transactions);
  const byProject = new Map<string, OpenInstallment[]>();
  open.forEach((o) => byProject.set(o.projectId, [...(byProject.get(o.projectId) ?? []), o]));
  const project = new Map(projects.map((p) => [p.id, p]));
  const deposits = transactions.filter((t) => isCandidate(t, accounts) && t.date <= today);

  const whoOf = (t: FinTransaction, o: OpenInstallment): MatchWho => {
    if ((t.projectCode ?? "").trim().toLowerCase() === o.code.trim().toLowerCase()) return "code";
    // 다른 프로젝트로 묶인 입금은 이 회차의 것이 아니다
    if (t.projectCode) return "none";
    const payer = normPayer(t.vendor);
    if (payer.length < 2) return "none";
    const known = [...(aliases.get(o.projectId) ?? []), ...(aliases.get(normPayer(o.client)) ?? [])];
    if (known.includes(payer)) return "alias";
    const client = normPayer(o.client);
    if (client.length >= 2 && (client.includes(payer) || payer.includes(client))) return "name";
    return "none";
  };
  const inWindow = (t: FinTransaction, o: OpenInstallment) => {
    if (!o.dueDate) {
      const start = project.get(o.projectId)?.startDate;
      return !start || dayDiff(t.date, start) >= -90;
    }
    const d = dayDiff(t.date, o.dueDate);
    return d >= -BEFORE_DAYS && d <= AFTER_DAYS;
  };
  const amountOf = (net: number, remaining: number): MatchAmount | null => {
    if (net === remaining) return "exact";
    if (remaining - net > 0 && remaining - net <= FEE_TOLERANCE) return "fee";
    if (net < remaining - FEE_TOLERANCE) return "partial";
    return null;
  };

  type Cand = ReceiptMatch & { rank: number; distance: number };
  const cands: Cand[] = [];
  deposits.forEach((t) => {
    const net = netAmount(t);
    open.forEach((o) => {
      if (t.projectCode && t.projectCode.trim().toLowerCase() !== o.code.trim().toLowerCase()) return;
      const who = whoOf(t, o);
      const amount = amountOf(net, o.remaining);
      if (!amount) return;
      const windowOk = inWindow(t, o);
      // 부분 입금은 누가 보냈는지 알 때만 — 아무 입금이나 부분 입금으로 볼 수 있다
      if (amount === "partial" && who === "none") return;
      if (who === "none" && !windowOk) return;
      const confidence: MatchConfidence =
        amount === "partial" ? "low" : who !== "none" ? "high" : windowOk ? "medium" : "low";
      const reasons = [
        amount === "exact"
          ? `받을 돈 ${won(o.remaining)}원과 같은 금액`
          : amount === "fee"
            ? `받을 돈보다 ${won(o.remaining - net)}원 적음 (수수료로 봄)`
            : `받을 돈 ${won(o.remaining)}원 중 일부 (부분 입금)`,
        who === "code"
          ? `입금이 프로젝트 「${o.code}」 로 묶여 있음`
          : who === "alias"
            ? "예전에 이 발주처 돈을 보낸 이름"
            : who === "name"
              ? `입금자가 발주처 「${o.client}」 와 이름이 겹침`
              : "입금자 이름으로는 모름",
        o.dueDate ? `받을 날 ${o.dueDate} 기준 ${dayDiff(t.date, o.dueDate) >= 0 ? `${dayDiff(t.date, o.dueDate)}일 뒤` : `${-dayDiff(t.date, o.dueDate)}일 전`}` : "받을 날 미정",
      ];
      cands.push({
        tx: { id: t.id, date: t.date, vendor: t.vendor, amount: net, last4: t.last4 },
        targets: [o],
        amount,
        who,
        confidence,
        reasons,
        ambiguous: false,
        rank: { high: 3, medium: 2, low: 1 }[confidence] * 10 + (amount === "exact" ? 2 : amount === "fee" ? 1 : 0),
        distance: o.dueDate ? Math.abs(dayDiff(t.date, o.dueDate)) : 999,
      });
    });
    // 합산 입금 — 같은 프로젝트의 회차 여럿의 합과 같고, 그런 조합이 하나뿐일 때
    byProject.forEach((list) => {
      if (list.length < 2) return;
      const combos: OpenInstallment[][] = [];
      const n = Math.min(list.length, 6);
      for (let mask = 1; mask < 1 << n; mask++) {
        const pick = list.slice(0, n).filter((_, i) => mask & (1 << i));
        if (pick.length < 2) continue;
        const sum = pick.reduce((s, o) => s + o.remaining, 0);
        if (net === sum || (sum - net > 0 && sum - net <= FEE_TOLERANCE)) combos.push(pick);
      }
      if (combos.length !== 1) return;
      const pick = combos[0];
      const who = pick.map((o) => whoOf(t, o)).find((w) => w !== "none") ?? "none";
      if (who === "none") return;
      cands.push({
        tx: { id: t.id, date: t.date, vendor: t.vendor, amount: net, last4: t.last4 },
        targets: pick,
        amount: "sum",
        who,
        confidence: "high",
        reasons: [`${pick.map((o) => o.kind).join(" + ")} 합 ${won(pick.reduce((s, o) => s + o.remaining, 0))}원과 같음 (한 번에 보냄)`, who === "code" ? `입금이 프로젝트 「${pick[0].code}」 로 묶여 있음` : "입금자 이름이 이 발주처"],
        ambiguous: false,
        rank: 31,
        distance: 0,
      });
    });
  });

  // 확신이 높은 것부터 — 입금 하나 · 회차 하나는 한 번만 쓴다
  cands.sort((a, b) => b.rank - a.rank || a.distance - b.distance || b.tx.date.localeCompare(a.tx.date));
  const usedTx = new Set<string>();
  const usedInst = new Set<string>();
  const out: ReceiptMatch[] = [];
  for (const c of cands) {
    if (usedTx.has(c.tx.id) || c.targets.some((o) => usedInst.has(o.key))) continue;
    // 같은 급의 다른 짝이 있으면 사람이 고른다
    const rivals = cands.filter(
      (x) =>
        x !== c &&
        x.rank === c.rank &&
        ((x.tx.id === c.tx.id && !usedInst.has(x.targets[0].key)) ||
          (x.targets.some((o) => c.targets.some((y) => y.key === o.key)) && !usedTx.has(x.tx.id))),
    );
    usedTx.add(c.tx.id);
    // 부분 입금은 회차를 다 쓰지 않는다 — 나머지를 다른 입금이 채울 수 있다
    if (c.amount !== "partial") c.targets.forEach((o) => usedInst.add(o.key));
    const { rank: _r, distance: _d, ...m } = c;
    out.push({ ...m, ambiguous: rivals.length > 0 });
  }
  const order: Record<MatchConfidence, number> = { high: 0, medium: 1, low: 2 };
  return out.sort((a, b) => order[a.confidence] - order[b.confidence] || b.tx.date.localeCompare(a.tx.date));
}

/** 짝지은 입금이 받을 돈을 다 채웠나 — 수수료만큼은 모자라도 채운 것으로 본다 */
export const isCovered = (due: number, received: number) => received >= due - FEE_TOLERANCE;
