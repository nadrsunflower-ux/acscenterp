// ============================================================
//  지원사업 — 들어올 지원금과 그 돈으로 쓴 것
// ------------------------------------------------------------
//  창업지원금 · 고용지원금 · R&D 처럼 나라 · 지자체 돈을 받는 사업을 건별로 둔다.
//  프로젝트(project.ts)와 닮았지만 셈이 다르다.
//    · 매출이 아니다 — 부가세가 없고(면세), 이익을 내는 돈이 아니라 정해진 데
//      써야 하는 돈이다. 그래서 「이익」 대신 「받을 돈 · 쓴 돈(비목별)」 을 본다.
//    · 매달 같은 날 같은 돈이 들어오는 사업이 많다 — 신한스타트업(9678)에는
//      2026-09·10 매달 880만(제연 215 · 다혜 215 · 홍대 월세 450)이 세 건으로
//      나뉘어 들어왔다.
//
//  원장과 잇는 법 — 거래에 지원사업 칸을 따로 두지 않고 **찾는 조건**으로 고른다.
//    받은 돈  계정이 「기타수입 › 지원금」 인 수입 중
//             · 원장 프로젝트코드가 이 사업 코드이거나
//             · 전용 계좌(accounts)로 들어왔거나 · 입금자(payer)가 맞는 것
//             (계좌와 입금자를 둘 다 적으면 둘 다 맞아야 한다)
//    반납     같은 조건의 「지원금환불」 지출 — 받은 돈에서 뺀다
//    쓴 돈    지출 중 · 원장 프로젝트코드가 이 사업 코드이거나 · 전용 계좌에서 나갔거나
//             · 비목 줄의 단서(거래처 이름 · 계정)에 맞는 것 — 협약 기간 안에서만
//  조건이 잘못 잡은 거래는 사람이 뺀다(alloc 에 "x"). 조건 밖 거래도 사람이 넣을 수
//  있다("in" = 받은 돈 · 비목 줄 id = 그 비목으로 쓴 돈).
//
//  회차는 **들어온 순서대로 채운다** (받은 돈 합을 날짜순 회차에 차례로 붓는다).
//  하루에 세 건으로 나뉘어 들어오는 돈을 회차 하나에 짝지을 필요가 없고, 금액이
//  조금 달라도(수수료 · 일할 계산) 다음 회차로 넘어간다.
//
//  코드는 프로젝트 코드와 같은 이름 공간이다 — 원장의 프로젝트코드 칸 하나로
//  프로젝트 지출과 지원사업 지출을 함께 꼬리표 붙이므로, 서버가 겹치지 않게 막는다.
// ============================================================

import { approxDueDate, DUE_PARTS, dueLabel, PROJECT_ENTITIES, type DuePart, type ProjectEntity } from "./project";
import { netAmount, type FinTransaction } from "./types";
import { todayStrKST } from "../format";

export const GRANT_STATUSES = ["applying", "active", "settling", "done", "dropped"] as const;
export type GrantStatus = (typeof GRANT_STATUSES)[number];

export const GRANT_STATUS_LABEL: Record<GrantStatus, string> = {
  applying: "신청 · 심사",
  active: "진행 중",
  settling: "정산 중",
  done: "끝남",
  dropped: "탈락 · 취소",
};

/** 아직 돈이 오가는 사업 — 받을 돈 합계 · 런웨이에 들어간다 */
export const OPEN_GRANT_STATUSES: GrantStatus[] = ["applying", "active", "settling"];

/** 원장 계정 「기타수입 › 지원금 › …」 의 소분류와 같은 글자 (master-data.ts GR-001~005) */
export const GRANT_KINDS = ["창업지원금", "고용지원금", "R&D지원금", "정부지원금", "위탁지원금"] as const;
export type GrantKind = (typeof GRANT_KINDS)[number];

/** 비목 추천 — 자유 입력이라 사업마다 다른 이름도 쓴다 */
export const BUDGET_ITEM_SUGGESTIONS = [
  "인건비",
  "임차료",
  "재료비",
  "외주용역비",
  "기계장치",
  "광고선전비",
  "여비",
  "지급수수료",
  "기타",
] as const;

/** 원장 계정 중분류 — 받은 돈 · 반납을 고르는 기준 */
export const GRANT_ACCT_MID = "지원금";
export const GRANT_REFUND_MINOR = "지원금환불";

/** 받을 회차 */
export interface FinGrantInstallment {
  id: string;
  /** 「10월분」 「1차」 */
  label: string;
  /** 받을 돈 (원) — 면세라 통장에 들어오는 금액 그대로 */
  amount: number;
  dueDate?: string;
  /** 대략 — 「11월 중」. dueDate 는 그 구간의 끝 날 (project.ts 의 DUE_PARTS) */
  dueApprox?: DuePart;
  /** 원장에 없는 돈을 받았다 (장부 이전 · 다른 통장) — 들어온 순서 채우기와 따로 받은 것으로 본다 */
  received?: boolean;
  note?: string;
}

/** 비목 한 줄 — 이 돈을 어디에 쓰기로 했나 */
export interface FinGrantBudgetLine {
  id: string;
  /** 비목 — 인건비 · 임차료 · 재료비 … */
  item: string;
  /** 세목 · 대상 — 「김제연」 「홍대 매장 월세」 */
  label?: string;
  /** 예산 (원) */
  amount: number;
  /** 찾는 단서 — 원장 거래처에 이 글자가 들어 있으면 이 비목으로 쓴 돈 */
  who?: string;
  /** 찾는 단서 — 원장 계정 대분류 · 중분류 (「인건비」 「임차료」) */
  acct?: string;
  note?: string;
}

/** 원장 거래 배정 — "in" 받은 돈으로 넣기 · "x" 이 사업 돈 아님 · 그 밖은 비목 줄 id */
export type GrantAlloc = Record<string, string>;
export const ALLOC_IN = "in";
export const ALLOC_OUT = "x";

export interface FinGrantDoc {
  id: string;
  /** 원장 프로젝트코드에 쓰는 코드 — 프로젝트 코드와 겹치면 안 된다 */
  code: string;
  name: string;
  kind: GrantKind;
  status: GrantStatus;
  /** 주관 · 전담기관 (「중소벤처기업부」 「서울시」) */
  agency?: string;
  /** 입금자 — 통장에 찍히는 이름 (「기술벤처스」). 비우면 계좌 · 코드로만 찾는다 */
  payer?: string;
  /** 전용 계좌 · 이 사업 돈이 드나드는 계좌의 뒤 4자리 */
  accounts?: string[];
  /** 돈을 받은 사업체 */
  entity?: ProjectEntity;
  /** 협약 기간 */
  startDate?: string;
  endDate?: string;
  /** 총 지원금 (정부 몫) */
  total: number;
  /** 자부담 — 현금 · 현물 */
  selfCash?: number;
  selfInKind?: number;
  installments: FinGrantInstallment[];
  budget: FinGrantBudgetLine[];
  alloc?: GrantAlloc;
  note?: string;
  createdAt: number;
  createdBy?: string;
  updatedAt?: number;
  updatedBy?: string;
}

export type FinGrantInput = Omit<FinGrantDoc, "id" | "createdAt" | "createdBy" | "updatedAt" | "updatedBy">;

const shortId = () => Math.random().toString(36).slice(2, 10);

export const newGrantInstallment = (label = "", amount = 0): FinGrantInstallment => ({ id: shortId(), label, amount });
export const newBudgetLine = (item = ""): FinGrantBudgetLine => ({ id: shortId(), item, amount: 0 });

export function emptyGrant(): FinGrantInput {
  return { code: "", name: "", kind: "창업지원금", status: "active", total: 0, installments: [], budget: [] };
}

/**
 * 매달 같은 날 같은 돈 — 「2026-09 ~ 2027-02 · 매달 15일 · 880만 · {m}월분」.
 * 그 달에 그 날이 없으면(31일) 그 달 말일로.
 */
export function monthlyInstallments(from: string, to: string, day: number, amount: number): FinGrantInstallment[] {
  const out: FinGrantInstallment[] = [];
  let [y, m] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  // 해를 넘기면 「27년 1월분」 처럼 해를 붙인다
  const multiYear = y !== ty;
  for (let guard = 0; guard < 120 && (y < ty || (y === ty && m <= tm)); guard++) {
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const d = Math.min(Math.max(1, Math.round(day) || 1), last);
    const date = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    out.push({ ...newGrantInstallment(`${multiYear ? `${String(y).slice(2)}년 ` : ""}${m}월분`, amount), dueDate: date });
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

// ---- 원장 쪽 ---------------------------------------------------

/** 이름 비교 — (주) · 사단법인 · 띄어쓰기를 뗀다 (receivables.ts 의 normPayer 와 같은 결) */
export const normName = (s?: string) =>
  (s ?? "")
    .toLowerCase()
    .replace(/\(주\)|㈜|주식회사|\(유\)|유한회사|\(사\)|사단법인|재단법인|\(재\)/g, "")
    .replace(/[^\p{L}\p{N}]/gu, "");

const sameCode = (a?: string, b?: string) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

const DAY = 86_400_000;
const addDays = (date: string, n: number) => new Date(Date.parse(date) + n * DAY).toISOString().slice(0, 10);

/**
 * 원장에서 이 사업 돈으로 볼 기간. 협약 전에 선지급되거나 끝난 뒤 늦게 들어오는
 * 돈이 있어 받은 돈은 앞뒤로 넉넉히, 쓴 돈은 협약 기간 그대로 본다.
 */
function inWindow(date: string, g: Pick<FinGrantDoc, "startDate" | "endDate">, padBefore: number, padAfter: number) {
  if (g.startDate && date < addDays(g.startDate, -padBefore)) return false;
  if (g.endDate && date > addDays(g.endDate, padAfter)) return false;
  return true;
}

/** 거래처 · 비고에 입금자 이름이 들어 있나 */
function payerMatches(t: FinTransaction, payer?: string) {
  const p = normName(payer);
  if (!p) return false;
  return normName(t.vendor).includes(p) || normName(t.note).includes(p);
}

/** 조건(계좌 · 입금자)으로 이 사업 거래인가 — 코드 꼬리표는 따로 본다 */
function routeMatches(t: FinTransaction, g: Pick<FinGrantDoc, "accounts" | "payer">) {
  const accounts = (g.accounts ?? []).filter(Boolean);
  const hasAcct = accounts.length > 0;
  const hasPayer = !!normName(g.payer);
  if (!hasAcct && !hasPayer) return false;
  if (hasAcct && !accounts.includes(String(t.last4 ?? ""))) return false;
  if (hasPayer && !payerMatches(t, g.payer)) return false;
  return true;
}

export const isGrantIncome = (t: FinTransaction) => t.txType === "수입" && t.acctMid === GRANT_ACCT_MID;
export const isGrantRefund = (t: FinTransaction) => t.acctMinor === GRANT_REFUND_MINOR && (t.txType === "지출" || t.txType === "환급");
/** 쓴 돈으로 볼 수 있는 거래 — 계좌 사이 이동(자금거래)과 반납은 쓴 돈이 아니다 */
const isSpendable = (t: FinTransaction) => (t.txType === "지출" || t.txType === "환급") && !isGrantRefund(t);

/** 비목 줄 단서에 맞는가 */
export function lineMatches(t: FinTransaction, line: Pick<FinGrantBudgetLine, "who" | "acct">) {
  const who = normName(line.who);
  const acct = (line.acct ?? "").trim();
  if (!who && !acct) return false;
  if (who && !normName(t.vendor).includes(who) && !normName(t.note).includes(who)) return false;
  if (acct && t.acctMajor !== acct && t.acctMid !== acct) return false;
  return true;
}

export interface GrantTx {
  tx: FinTransaction;
  /** 금액 — 받은 돈 · 반납 · 쓴 돈 모두 양수 (환급은 쓴 돈을 줄이니 음수) */
  amount: number;
  /** 왜 이 사업 거래로 잡혔나 */
  why: "code" | "route" | "line" | "manual";
}

export interface GrantSpend extends GrantTx {
  /** 배정된 비목 줄 — 없으면 「비목 미정」 */
  lineId?: string;
}

export interface GrantLedger {
  incomes: GrantTx[];
  refunds: GrantTx[];
  spends: GrantSpend[];
}

/**
 * 원장에서 이 사업 거래를 고른다. 순서: 사람이 뺀 것 → 사람이 넣은 것 → 코드 → 조건.
 */
export function grantLedger(g: FinGrantInput, transactions: FinTransaction[]): GrantLedger {
  const alloc = g.alloc ?? {};
  const lineIds = new Set(g.budget.map((l) => l.id));
  const incomes: GrantTx[] = [];
  const refunds: GrantTx[] = [];
  const spends: GrantSpend[] = [];

  for (const t of transactions) {
    const a = alloc[t.id];
    if (a === ALLOC_OUT) continue;
    const net = netAmount(t);
    const tagged = sameCode(t.projectCode, g.code);

    // 받은 돈
    if (isGrantIncome(t)) {
      if (a === ALLOC_IN) incomes.push({ tx: t, amount: net, why: "manual" });
      else if (tagged) incomes.push({ tx: t, amount: net, why: "code" });
      else if (routeMatches(t, g) && inWindow(t.date, g, 92, 183)) incomes.push({ tx: t, amount: net, why: "route" });
      continue;
    }
    if (a === ALLOC_IN) {
      // 지원금 계정이 아닌데 사람이 받은 돈으로 넣은 것 (계정을 잘못 붙인 입금)
      if (t.txType === "수입") incomes.push({ tx: t, amount: net, why: "manual" });
      continue;
    }
    // 반납
    if (isGrantRefund(t)) {
      if (tagged || (routeMatches(t, g) && inWindow(t.date, g, 92, 365))) refunds.push({ tx: t, amount: Math.abs(net), why: tagged ? "code" : "route" });
      continue;
    }
    // 쓴 돈
    if (!isSpendable(t)) continue;
    const signed = t.txType === "환급" ? -Math.abs(net) : net;
    if (a && lineIds.has(a)) {
      spends.push({ tx: t, amount: signed, why: "manual", lineId: a });
      continue;
    }
    const byLine = g.budget.find((l) => lineMatches(t, l));
    // 코드 꼬리표는 사람이 붙인 것이라 협약 기간 밖이어도 넣는다
    if (tagged) {
      spends.push({ tx: t, amount: signed, why: "code", lineId: byLine?.id });
      continue;
    }
    if (!inWindow(t.date, g, 0, 0)) continue;
    const accounts = (g.accounts ?? []).filter(Boolean);
    if (accounts.length > 0 && accounts.includes(String(t.last4 ?? ""))) spends.push({ tx: t, amount: signed, why: "route", lineId: byLine?.id });
    else if (byLine) spends.push({ tx: t, amount: signed, why: "line", lineId: byLine.id });
  }

  const byDate = (x: GrantTx, y: GrantTx) => x.tx.date.localeCompare(y.tx.date);
  return { incomes: incomes.sort(byDate), refunds: refunds.sort(byDate), spends: spends.sort(byDate) };
}

// ---- 회차 상태 ---------------------------------------------------

/**
 * paid    다 받음
 * partial 일부만 (들어온 돈이 이 회차 중간에서 끝났다)
 * overdue 받을 날이 지났는데 안 들어옴
 * planned 아직
 */
export type GrantInstStatus = "paid" | "partial" | "overdue" | "planned";

export const GRANT_INST_LABEL: Record<GrantInstStatus, string> = {
  paid: "받음",
  partial: "일부",
  overdue: "늦음",
  planned: "예정",
};

export interface GrantInstView {
  inst: FinGrantInstallment;
  status: GrantInstStatus;
  /** 이 회차에 채워진 돈 */
  filled: number;
  /** 남은 돈 */
  remaining: number;
}

/** 수수료 · 일할 계산으로 조금 모자라도 받은 것으로 — receivables.ts 의 FEE_TOLERANCE 와 같다 */
const TOLERANCE = 3_000;

/** 날짜 없는 회차는 맨 뒤 — 받은 돈은 날짜가 정해진 회차부터 채운다 */
const instOrder = (a: FinGrantInstallment, b: FinGrantInstallment) =>
  (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999");

export function installmentViews(
  installments: FinGrantInstallment[],
  ledgerReceived: number,
  today = todayStrKST(),
): GrantInstView[] {
  let pool = Math.max(0, ledgerReceived);
  const views = new Map<string, GrantInstView>();
  [...installments].sort(instOrder).forEach((inst) => {
    const amount = Math.max(0, Math.round(inst.amount) || 0);
    if (inst.received) {
      views.set(inst.id, { inst, status: "paid", filled: amount, remaining: 0 });
      return;
    }
    const filled = Math.min(pool, amount);
    pool -= filled;
    const remaining = amount - filled;
    const status: GrantInstStatus =
      remaining <= TOLERANCE ? "paid" : filled > 0 ? "partial" : inst.dueDate && inst.dueDate < today ? "overdue" : "planned";
    views.set(inst.id, { inst, status, filled, remaining: status === "paid" ? 0 : remaining });
  });
  // 화면은 사람이 적은 순서대로
  return installments.map((i) => views.get(i.id)!);
}

// ---- 요약 ---------------------------------------------------------

export interface GrantBudgetView {
  line: FinGrantBudgetLine;
  spent: number;
  count: number;
}

export interface GrantSummary {
  total: number;
  /** 회차 합 — 총 지원금과 다르면 화면이 알린다 */
  scheduled: number;
  /** 원장에서 받은 돈 (반납 전) */
  receivedLedger: number;
  /** 원장 밖에서 받았다고 표시한 회차 합 */
  receivedManual: number;
  refunded: number;
  /** 받은 돈 = 원장 + 표시 − 반납 */
  received: number;
  /** 남은 지원금 = 총액 − 받은 돈 (총액이 없으면 회차 합 기준) */
  remaining: number;
  overdue: number;
  overdueCount: number;
  /** 다음 받을 회차 */
  next?: { label: string; dueDate?: string; dueApprox?: DuePart; amount: number };
  installments: GrantInstView[];
  budgetTotal: number;
  spent: number;
  /** 비목을 못 정한 쓴 돈 */
  unassigned: number;
  budget: GrantBudgetView[];
  ledger: GrantLedger;
}

export function grantSummary(g: FinGrantInput, transactions: FinTransaction[], today = todayStrKST()): GrantSummary {
  const ledger = grantLedger(g, transactions);
  const receivedLedger = ledger.incomes.reduce((s, x) => s + x.amount, 0);
  const refunded = ledger.refunds.reduce((s, x) => s + x.amount, 0);
  // 반납한 돈은 받은 돈에서 빼고 회차를 채운다 — 돌려준 만큼은 안 받은 셈이다
  const views = installmentViews(g.installments, receivedLedger - refunded, today);
  const receivedManual = views.filter((v) => v.inst.received).reduce((s, v) => s + v.filled, 0);
  const scheduled = g.installments.reduce((s, i) => s + (Math.round(i.amount) || 0), 0);
  const received = receivedLedger + receivedManual - refunded;
  const total = Math.round(g.total) || 0;
  const base = total > 0 ? total : scheduled;
  const open = views.filter((v) => v.status !== "paid");
  const overdueViews = views.filter((v) => v.status === "overdue" || (v.status === "partial" && v.inst.dueDate && v.inst.dueDate < today));
  const nextView = [...open].sort((a, b) => instOrder(a.inst, b.inst))[0];

  const budget = g.budget.map((line) => {
    const mine = ledger.spends.filter((s) => s.lineId === line.id);
    return { line, spent: mine.reduce((s, x) => s + x.amount, 0), count: mine.length };
  });
  const spent = ledger.spends.reduce((s, x) => s + x.amount, 0);
  const unassigned = ledger.spends.filter((s) => !s.lineId).reduce((s, x) => s + x.amount, 0);

  return {
    total,
    scheduled,
    receivedLedger,
    receivedManual,
    refunded,
    received,
    remaining: Math.max(0, base - received),
    overdue: overdueViews.reduce((s, v) => s + v.remaining, 0),
    overdueCount: overdueViews.length,
    next: nextView
      ? { label: nextView.inst.label, dueDate: nextView.inst.dueDate, dueApprox: nextView.inst.dueApprox, amount: nextView.remaining }
      : undefined,
    installments: views,
    budgetTotal: g.budget.reduce((s, l) => s + (Math.round(l.amount) || 0), 0),
    spent,
    unassigned,
    budget,
    ledger,
  };
}

/** 받을 날 글자 — 대략이면 「2026년 11월 중」 */
export const grantDueLabel = (i: Pick<FinGrantInstallment, "dueDate" | "dueApprox">) => dueLabel(i);

/**
 * 아직 안 들어온 회차 — 런웨이(runway.ts)의 「들어올 돈」 에 이을 자리다.
 * 지금은 화면만 쓴다. 날짜 없는 회차는 date 없이 돌려준다(런웨이는 따로 보여야 한다).
 */
export function openGrantInstallments(
  grants: FinGrantDoc[],
  transactions: FinTransaction[],
  today = todayStrKST(),
): { grantId: string; grantName: string; label: string; date?: string; amount: number }[] {
  return grants
    .filter((g) => OPEN_GRANT_STATUSES.includes(g.status))
    .flatMap((g) =>
      grantSummary(g, transactions, today)
        .installments.filter((v) => v.remaining > 0)
        .map((v) => ({ grantId: g.id, grantName: g.name, label: v.inst.label, date: v.inst.dueDate, amount: v.remaining })),
    );
}

/** 목록 순서 — 진행 중 먼저, 그 안에서 다음 받을 날이 가까운 것부터 */
export function sortGrants(list: FinGrantDoc[]): FinGrantDoc[] {
  const rank = (s: GrantStatus) => GRANT_STATUSES.indexOf(s === "applying" ? "active" : s);
  return [...list].sort((a, b) => rank(a.status) - rank(b.status) || (b.startDate ?? "").localeCompare(a.startDate ?? "") || a.name.localeCompare(b.name));
}

// ---- 저장 전 다듬기 (서버 · 화면 같은 정본) ------------------------

const str = (v: unknown) => {
  const s = String(v ?? "").trim();
  return s ? s : undefined;
};
const num = (v: unknown) => {
  if (v === "" || v === null || v === undefined) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : undefined;
};
const dateStr = (v: unknown) => {
  const s = str(v);
  return s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined;
};
function compact<T extends Record<string, unknown>>(o: T): T {
  const out: Record<string, unknown> = {};
  Object.entries(o).forEach(([k, v]) => {
    if (v !== undefined) out[k] = v;
  });
  return out as T;
}

export function sanitizeGrantInstallment(raw: Partial<FinGrantInstallment>): FinGrantInstallment {
  const due = dateStr(raw.dueDate);
  const part = due && (DUE_PARTS as readonly string[]).includes(String(raw.dueApprox)) ? (raw.dueApprox as DuePart) : undefined;
  return compact({
    id: str(raw.id) ?? shortId(),
    label: str(raw.label) ?? "",
    amount: num(raw.amount) ?? 0,
    dueDate: due && part ? approxDueDate(due.slice(0, 7), part) : due,
    dueApprox: part,
    received: raw.received ? true : undefined,
    note: str(raw.note),
  }) as FinGrantInstallment;
}

export function sanitizeBudgetLine(raw: Partial<FinGrantBudgetLine>): FinGrantBudgetLine {
  return compact({
    id: str(raw.id) ?? shortId(),
    item: str(raw.item) ?? "",
    label: str(raw.label),
    amount: num(raw.amount) ?? 0,
    who: str(raw.who),
    acct: str(raw.acct),
    note: str(raw.note),
  }) as FinGrantBudgetLine;
}

export function sanitizeGrant(
  raw: Partial<FinGrantInput>,
): { ok: true; value: FinGrantInput } | { ok: false; error: string } {
  const name = str(raw.name);
  const code = str(raw.code);
  if (!name) return { ok: false, error: "사업 이름이 비어 있습니다." };
  if (!code) return { ok: false, error: "코드가 비어 있습니다." };
  const kind = (GRANT_KINDS as readonly string[]).includes(String(raw.kind)) ? (raw.kind as GrantKind) : "정부지원금";
  const status = (GRANT_STATUSES as readonly string[]).includes(String(raw.status)) ? (raw.status as GrantStatus) : "active";
  const entity = (PROJECT_ENTITIES as readonly string[]).includes(String(raw.entity)) ? (raw.entity as ProjectEntity) : undefined;
  const accounts = [...new Set((Array.isArray(raw.accounts) ? raw.accounts : []).map((a) => String(a ?? "").trim()).filter((a) => /^\d{4}$/.test(a)))];
  // 금액도 날짜도 없는 회차 · 비목은 「추가」 만 눌러 둔 줄이다
  const installments = (Array.isArray(raw.installments) ? raw.installments : [])
    .map(sanitizeGrantInstallment)
    .filter((i) => i.amount !== 0 || i.dueDate || i.label || i.received || i.note);
  const budget = (Array.isArray(raw.budget) ? raw.budget : [])
    .map(sanitizeBudgetLine)
    .filter((l) => l.item || l.label || l.amount !== 0 || l.who || l.acct || l.note);
  const lineIds = new Set(budget.map((l) => l.id));
  const alloc: GrantAlloc = {};
  Object.entries(raw.alloc && typeof raw.alloc === "object" ? raw.alloc : {}).forEach(([txId, v]) => {
    const val = String(v ?? "");
    if (txId && (val === ALLOC_IN || val === ALLOC_OUT || lineIds.has(val))) alloc[txId] = val;
  });
  return {
    ok: true,
    value: compact({
      code,
      name,
      kind,
      status,
      agency: str(raw.agency),
      payer: str(raw.payer),
      accounts: accounts.length > 0 ? accounts : undefined,
      entity,
      startDate: dateStr(raw.startDate),
      endDate: dateStr(raw.endDate),
      total: num(raw.total) ?? 0,
      selfCash: num(raw.selfCash) || undefined,
      selfInKind: num(raw.selfInKind) || undefined,
      installments,
      budget,
      alloc: Object.keys(alloc).length > 0 ? alloc : undefined,
      note: str(raw.note),
    }) as FinGrantInput,
  };
}
