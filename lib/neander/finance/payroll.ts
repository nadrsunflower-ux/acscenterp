// ============================================================
//  급여 지급 — 지급일에 보낼 사람 · 금액 · 계좌를 미리 적어 두는 표
// ------------------------------------------------------------
//  급여는 매달 1일에 회사 통장 서너 개에서 스무 건 남짓이 한꺼번에 나간다.
//  한 사람이 두 회사에서 나눠 받기도 한다(네안데르 4223 + 안다르 0429). 그래서
//  표의 한 줄은 「사람 × 보내는 회사」 다.
//
//  · 급여를 계산하지 않는다 — 세금 · 4대보험은 세무사 서류가 정본이다
//    (tax-docs.ts 머리말). 여기 적는 금액은 「통장에서 보낼 돈(실수령)」 이다.
//  · 한 달 = 문서 하나 (neander_fin_payroll/{YYYY-MM}, 지급하는 달). 계좌번호가
//    들어가므로 서버(api/neander/finance/payroll)만 읽고 쓴다.
//  · 보냈는지는 장부가 정한다 — 지급일 앞뒤에 이름이 들어간 출금이 있으면 「보냄」.
//    문자로 먼저 들어온 출금(sms-…)도 장부 줄이라 그날 바로 바뀐다. 장부에 아직
//    없으면 사람이 「보냄」 을 눌러 둔다(sent).
//  · 새 달은 지난달 표를 그대로 가져온다(줄 id 도 그대로 — 지난달과 견주는 열쇠).
//    표가 하나도 없으면 장부의 지난 급여 출금으로 시작한다.
//
//  계산만 한다 — Firestore · 화면을 부르지 않는다 (payroll.test.ts).
// ============================================================

import { PROJECT_ENTITIES, type ProjectEntity } from "./project";
import { personKey } from "./tax-docs";
import { netAmount, type FinTransaction } from "./types";

export const PAY_KINDS = ["직원", "임원", "프리랜서", "알바", "기타"] as const;
export type PayKind = (typeof PAY_KINDS)[number];

export interface PayLine {
  /** 바뀌지 않는 열쇠 — 다음 달로 복사해도 그대로 (지난달 금액을 찾는다) */
  id: string;
  name: string;
  /** 보내는 회사 */
  entity?: ProjectEntity;
  kind?: PayKind;
  /** 보낼 돈 — 통장에서 나가는 금액(실수령) */
  amount: number;
  bank?: string;
  account?: string;
  /** 예금주 — 이름과 다를 때만 */
  holder?: string;
  memo?: string;
  /** 사람이 「보냄」 으로 표시한 날 — 장부에 출금이 아직 없을 때 */
  sent?: string;
}

export interface PayrollInput {
  /** 지급하는 달 YYYY-MM — 문서 id */
  id: string;
  /** 지급일 */
  payDate: string;
  lines: PayLine[];
  note?: string;
}

export interface PayrollDoc extends PayrollInput {
  updatedAt?: number;
  updatedBy?: string;
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_LINES = 200;

export const defaultPayDate = (month: string) => `${month}-01`;

/** 다음 달 YYYY-MM */
export function shiftMonth(month: string, n: number): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7)) - 1 + n;
  const d = new Date(Date.UTC(y, m, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

const DAY_MS = 86_400_000;
const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
export const daysUntil = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);

/** 화면이 처음 보여 줄 달 — 1~5일이면 이번 달 지급, 아니면 다음 달 지급 */
export function upcomingPayMonth(today: string): string {
  const month = today.slice(0, 7);
  return Number(today.slice(8, 10)) <= 5 ? month : shiftMonth(month, 1);
}

export const newLineId = () => `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

export const emptyLine = (entity?: ProjectEntity): PayLine => ({ id: newLineId(), name: "", amount: 0, ...(entity ? { entity } : {}) });

// ---- 다듬기 (서버 · 화면 같이) ------------------------------------------

const str = (v: unknown, max = 200) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);
const isEntity = (v: unknown): v is ProjectEntity => (PROJECT_ENTITIES as readonly string[]).includes(v as string);
const isKind = (v: unknown): v is PayKind => (PAY_KINDS as readonly string[]).includes(v as string);

export function sanitizePayroll(raw: unknown): { ok: true; value: PayrollInput } | { ok: false; error: string } {
  const o = (raw ?? {}) as Record<string, unknown>;
  const id = str(o.id);
  if (!id || !MONTH_RE.test(id)) return { ok: false, error: "지급하는 달(YYYY-MM)이 필요합니다." };
  const payDate = str(o.payDate) ?? defaultPayDate(id);
  if (!DATE_RE.test(payDate) || Number.isNaN(Date.parse(payDate))) return { ok: false, error: "지급일이 날짜가 아닙니다." };
  const rawLines = Array.isArray(o.lines) ? o.lines : [];
  if (rawLines.length > MAX_LINES) return { ok: false, error: `한 달에 ${MAX_LINES}줄까지입니다.` };
  const seen = new Set<string>();
  const lines: PayLine[] = [];
  for (const r of rawLines) {
    const l = (r ?? {}) as Record<string, unknown>;
    const lineId = str(l.id, 40) ?? newLineId();
    if (seen.has(lineId)) continue;
    seen.add(lineId);
    const amount = Math.round(Number(l.amount));
    const name = str(l.name, 60) ?? "";
    const line: PayLine = { id: lineId, name, amount: Number.isFinite(amount) && amount > 0 ? amount : 0 };
    // 이름도 금액도 없는 줄은 막 추가한 빈 줄이다 — 저장하지 않는다
    if (!name && !line.amount) continue;
    if (isEntity(l.entity)) line.entity = l.entity;
    if (isKind(l.kind)) line.kind = l.kind;
    const bank = str(l.bank, 40);
    const account = str(l.account, 60);
    const holder = str(l.holder, 60);
    const memo = str(l.memo, 300);
    const sent = str(l.sent, 10);
    if (bank) line.bank = bank;
    if (account) line.account = account;
    if (holder) line.holder = holder;
    if (memo) line.memo = memo;
    if (sent && DATE_RE.test(sent)) line.sent = sent;
    lines.push(line);
  }
  const note = str(o.note, 1000);
  return { ok: true, value: { id, payDate, lines, ...(note ? { note } : {}) } };
}

// ---- 새 달 시작 -------------------------------------------------------

/** 지난달 표를 그대로 — 보냄 표시만 지운다 */
export function copyPlan(prev: PayrollInput, month: string): PayrollInput {
  return {
    id: month,
    payDate: defaultPayDate(month),
    lines: prev.lines.map(({ sent: _sent, ...l }) => ({ ...l })),
  };
}

const isSalaryTx = (t: FinTransaction) =>
  t.txType !== "수입" && t.txType !== "자금거래" && t.acctMajor === "인건비" && /급여|프리랜서/.test(t.acctMid ?? "") && netAmount(t) > 0;

/** 「10월 이우빈 인건비」 · 「김명연 급여」 → 사람 이름만 */
export function nameFromVendor(vendor: string): string {
  const cut = vendor
    .replace(/\(.*?\)/g, " ")
    .replace(/\d+\s*월(분)?/g, " ")
    .replace(/급여|인건비|월급|상여금?|수당/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cut || vendor.trim();
}

function kindOf(t: FinTransaction): PayKind | undefined {
  if (/프리랜서/.test(t.acctMid ?? "")) return "프리랜서";
  if (/임원/.test(t.acctMinor ?? "")) return "임원";
  if (/직원/.test(t.acctMinor ?? "")) return "직원";
  return undefined;
}

/**
 * 장부의 지난 급여로 시작 — 가장 최근 「1일 무렵(앞 3일 · 뒤 7일) 급여 출금이 세 건 이상」
 * 인 달을 찾아 그 출금을 줄로 옮긴다. 계좌는 장부에 없어 비워 둔다.
 */
export function planFromLedger(txs: FinTransaction[], month: string, before: string): { from: string; plan: PayrollInput } | null {
  const pay = txs.filter((t) => isSalaryTx(t) && t.date < before);
  const months = [...new Set(pay.map((t) => t.date.slice(0, 7)))].sort().reverse();
  // 말일 무렵(앞 3일)에 당겨 보낸 것까지 — 그래서 다음 달 1일도 후보로 넣는다
  const firsts = [...new Set(months.flatMap((m) => [shiftMonth(m, 1), m]))].sort().reverse();
  for (const m of firsts) {
    const lo = addDays(`${m}-01`, -3);
    const hi = addDays(`${m}-01`, 7);
    // 회사 → 이름 순 — 지급일엔 통장 하나씩 열어 보낸다
    const rank = (t: FinTransaction) => (isEntity(t.site) ? PROJECT_ENTITIES.indexOf(t.site) : PROJECT_ENTITIES.length);
    const hit = pay
      .filter((t) => t.date >= lo && t.date <= hi)
      .sort((a, b) => rank(a) - rank(b) || nameFromVendor(a.vendor ?? "").localeCompare(nameFromVendor(b.vendor ?? ""), "ko") || a.date.localeCompare(b.date));
    if (hit.length < 3) continue;
    return {
      from: `${m}-01`,
      plan: {
        id: month,
        payDate: defaultPayDate(month),
        lines: hit.map((t, i) => ({
          id: `p${m.replace("-", "")}${String(i).padStart(2, "0")}`,
          name: nameFromVendor(t.vendor ?? ""),
          amount: Math.round(netAmount(t)),
          ...(isEntity(t.site) ? { entity: t.site } : {}),
          ...(kindOf(t) ? { kind: kindOf(t) } : {}),
        })),
      },
    };
  }
  return null;
}

// ---- 장부와 맞추기 ------------------------------------------------------

export type LineState = "sent" | "diff" | "manual" | "open" | "late";

export interface LineStatus {
  state: LineState;
  /** 장부에서 찾은 출금 */
  tx?: FinTransaction;
  /** 장부 금액 − 적은 금액 */
  diff?: number;
}

/** 이체 수수료(500원) 정도는 같은 돈으로 본다 */
const NEAR = 1_000;
/** 지급일 앞뒤 — 말일에 당겨 보내거나 며칠 늦게 보낸 것까지 */
export const MATCH_WINDOW = { before: 5, after: 10 };

/**
 * 줄마다 보냈는지 — 지급일 앞뒤 출금 가운데 거래처에 이름이 들어 있고 회사(site)가
 * 맞는 것. 금액이 딱 맞는 것부터 모든 줄에 먼저 짝을 지어, 가까운 금액이 남의 출금을
 * 가로채지 않게 한다. 한 출금은 한 줄에만 붙는다.
 */
export function matchPayroll(plan: Pick<PayrollInput, "payDate" | "lines">, txs: FinTransaction[], today: string): Map<string, LineStatus> {
  const lo = addDays(plan.payDate, -MATCH_WINDOW.before);
  const hi = addDays(plan.payDate, MATCH_WINDOW.after);
  const pool = txs.filter((t) => t.date >= lo && t.date <= hi && t.txType !== "수입" && t.txType !== "자금거래" && netAmount(t) > 0);
  const used = new Set<string>();
  const out = new Map<string, LineStatus>();
  const cands = (l: PayLine) => {
    const key = personKey(l.name);
    const holder = l.holder ? personKey(l.holder) : "";
    if (!key && !holder) return [];
    return pool.filter((t) => {
      if (used.has(t.id)) return false;
      const v = personKey(t.vendor ?? "");
      if (!((key && v.includes(key)) || (holder && v.includes(holder)))) return false;
      return !l.entity || !t.site || t.site === l.entity;
    });
  };
  const near = (t: FinTransaction, l: PayLine) => Math.abs(Math.round(netAmount(t)) - l.amount);
  const closest = (list: FinTransaction[], l: PayLine) =>
    [...list].sort((a, b) => near(a, l) - near(b, l) || Math.abs(daysUntil(plan.payDate, a.date)) - Math.abs(daysUntil(plan.payDate, b.date)))[0];

  const passes: { test: (t: FinTransaction, l: PayLine) => boolean; state: LineState }[] = [
    { test: (t, l) => near(t, l) === 0, state: "sent" },
    { test: (t, l) => near(t, l) <= NEAR, state: "sent" },
    // 금액이 반도 안 맞으면 다른 지급(정산 · 개인사 몫)이다 — tax-docs-check 와 같은 선
    { test: (t, l) => l.amount > 0 && near(t, l) <= l.amount * 0.5, state: "diff" },
  ];
  for (const pass of passes) {
    for (const l of plan.lines) {
      if (out.has(l.id)) continue;
      const hit = closest(cands(l).filter((t) => pass.test(t, l)), l);
      if (!hit) continue;
      used.add(hit.id);
      out.set(l.id, { state: pass.state, tx: hit, diff: Math.round(netAmount(hit)) - l.amount });
    }
  }
  for (const l of plan.lines) {
    if (out.has(l.id)) continue;
    if (l.sent) out.set(l.id, { state: "manual" });
    else out.set(l.id, { state: today > plan.payDate ? "late" : "open" });
  }
  return out;
}

export const isDone = (s: LineStatus | undefined) => s?.state === "sent" || s?.state === "diff" || s?.state === "manual";

// ---- 합계 ------------------------------------------------------------

export interface PayrollTotals {
  count: number;
  amount: number;
  sentCount: number;
  sentAmount: number;
  /** 회사별 — 보낼 돈 · 남은 돈 */
  byEntity: { entity: ProjectEntity | "미정"; count: number; amount: number; left: number }[];
}

export function payrollTotals(lines: PayLine[], status: Map<string, LineStatus>): PayrollTotals {
  const real = lines.filter((l) => l.name || l.amount);
  const by = new Map<ProjectEntity | "미정", { count: number; amount: number; left: number }>();
  let sentCount = 0;
  let sentAmount = 0;
  for (const l of real) {
    const done = isDone(status.get(l.id));
    if (done) {
      sentCount += 1;
      sentAmount += l.amount;
    }
    const k = l.entity ?? "미정";
    const cur = by.get(k) ?? { count: 0, amount: 0, left: 0 };
    cur.count += 1;
    cur.amount += l.amount;
    if (!done) cur.left += l.amount;
    by.set(k, cur);
  }
  const order = [...PROJECT_ENTITIES, "미정"] as const;
  return {
    count: real.length,
    amount: real.reduce((s, l) => s + l.amount, 0),
    sentCount,
    sentAmount,
    byEntity: order.filter((k) => by.has(k)).map((k) => ({ entity: k, ...by.get(k)! })),
  };
}

/** 지난 표의 같은 줄 금액 — id 가 같거나, 없으면 이름 · 회사가 같은 줄 */
export function previousAmount(line: PayLine, prev: PayrollInput | undefined): number | undefined {
  if (!prev) return undefined;
  const same = prev.lines.find((p) => p.id === line.id) ?? prev.lines.find((p) => personKey(p.name) === personKey(line.name) && p.entity === line.entity);
  return same?.amount;
}

// ---- 돈 나가는 날 알림 --------------------------------------------------

/** 이 회사 몫의 보낼 돈 — 알림 규칙의 사업장(site)이 없으면 전부 */
export function plannedAmount(plan: Pick<PayrollInput, "lines"> | undefined, site?: string): { amount: number; count: number } | null {
  if (!plan) return null;
  const lines = plan.lines.filter((l) => l.amount > 0 && (!site || l.entity === site));
  if (!lines.length) return null;
  return { amount: lines.reduce((s, l) => s + l.amount, 0), count: lines.length };
}
