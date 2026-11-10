// ============================================================
//  자금 일보 — 은행 입출금 문자로 하루(또는 기간) 통장별 잔액 · 입출금을 센다
// ------------------------------------------------------------
//  원천은 받은 문자함(neander_fin_sms_inbox — bank-sms.ts 가 읽은 값)이다.
//  장부와 별도인 **잠정** 자료다 — 월 엑셀이 정본이고, 여기는 그날그날 보는 용도.
//
//  통장마다:
//    기초 잔액  = 기간 앞 마지막 문자의 잔액 (없으면 기간 첫 문자에서 거꾸로 셈)
//    기말 잔액  = 기간 안 마지막 문자의 잔액 (거래가 없으면 기초와 같음)
//    입금 · 출금 = 기간 안 문자의 금액 합
//  그리고 앞뒤 문자의 잔액이 이어지는지 본다 — 「직전 잔액 ± 금액 = 지금 잔액」.
//  어긋나면 그 사이에 문자가 빠진 것이다(gap). 기초 + 입금 − 출금 − 기말의 차이도 같은 값이 된다.
//
//  계산만 한다 (daily-cash.test.ts).
// ============================================================

import type { BankSmsParsed } from "./bank-sms";
import { netAmount, type FinTransaction } from "./types";

export interface SmsTx {
  id: string;
  /** 한국 날짜 YYYY-MM-DD */
  date: string;
  /** HH:mm */
  time: string;
  /** 정렬용 — 날짜 + 시각 + 받은 때 */
  order: string;
  last4: string;
  bank?: string;
  kind: "입금" | "출금";
  amount: number;
  balance?: number;
  memo?: string;
}

const kstDate = (ms: number) => new Date(ms + 9 * 3600_000).toISOString().slice(0, 10);
const kstTime = (ms: number) => new Date(ms + 9 * 3600_000).toISOString().slice(11, 16);

/** 받은 문자 한 건 → 거래 한 줄. 은행 거래로 못 읽었거나 계좌를 모르면 null */
export function smsToTx(doc: { id: string; receivedAt?: number; createdAt?: number; parsed?: BankSmsParsed }): SmsTx | null {
  const p = doc.parsed;
  if (!p?.ok || !p.kind || !p.amount || !p.last4) return null;
  const at = Number(doc.receivedAt) || Number(doc.createdAt) || 0;
  let date = kstDate(at);
  let time = kstTime(at);
  // 문자 속 날짜 · 시각이 있으면 그것을 쓴다 — 연도는 받은 날에서. 1월에 받은 12월 문자는 전년도
  if (p.when) {
    const [md, hm] = p.when.split(" ");
    const [mm, dd] = md.split("-").map(Number);
    let year = Number(date.slice(0, 4));
    if (mm === 12 && Number(date.slice(5, 7)) === 1) year -= 1;
    date = `${year}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
    time = hm;
  }
  return {
    id: doc.id,
    date,
    time,
    order: `${date} ${time} ${String(at).padStart(14, "0")}`,
    last4: p.last4,
    bank: p.bank,
    kind: p.kind,
    amount: p.amount,
    balance: p.balance,
    memo: p.memo,
  };
}

export interface CashAccount {
  last4: string;
  label: string;
  bank?: string;
  site?: string;
}

/**
 * 연결 상태 — sms: 문자가 들어오는 중 · waiting: 문자 통지를 신청했지만 아직 한 통도 안 옴 ·
 * none: 연결 안 됨 (월 엑셀 장부로만)
 */
export type CashLink = "sms" | "waiting" | "none";

export interface DailyCashRow extends CashAccount {
  /** 기초 · 기말 잔액 — 문자가 한 번도 없었으면 null */
  opening: number | null;
  closing: number | null;
  inSum: number;
  outSum: number;
  inCount: number;
  outCount: number;
  /** 빠진 문자로 보이는 돈 (+ 들어온 것 · − 나간 것) 합 */
  gap: number;
  gapCount: number;
  /** 이 통장의 마지막 문자 (기간과 상관없이) */
  lastSeen?: string;
  /** 이 줄의 숫자를 어디서 셌나 — 문자 · 장부(월 엑셀) */
  source?: "sms" | "ledger";
  /** 장부가 어디까지 올라와 있나 (장부 기준 줄) */
  coveredTo?: string;
}

export interface DailyCashLine extends SmsTx {
  label: string;
  /** 이 줄 바로 앞에 빠진 돈 (잔액이 안 이어질 때) */
  gapBefore?: number;
}

export interface DailyCashReport {
  from: string;
  to: string;
  rows: DailyCashRow[];
  /** 날짜별 거래 — 날짜 오름차순, 그 안은 시각 오름차순 */
  days: { date: string; lines: DailyCashLine[]; inSum: number; outSum: number }[];
  totals: { opening: number; closing: number; inSum: number; outSum: number; gap: number };
}

const signed = (t: SmsTx) => (t.kind === "입금" ? t.amount : -t.amount);

/** from ~ to (한국 날짜, 둘 다 포함) 자금 일보 */
export function buildDailyCash(txsIn: SmsTx[], accounts: CashAccount[], from: string, to: string): DailyCashReport {
  const txs = [...txsIn].sort((a, b) => a.order.localeCompare(b.order));
  const known = new Map(accounts.map((a) => [a.last4, a]));
  // 문자로만 처음 보는 통장도 줄에 넣는다 (ERP 결제수단에 없는 계좌)
  for (const t of txs) if (!known.has(t.last4)) known.set(t.last4, { last4: t.last4, label: `${t.bank ?? ""} ${t.last4}`.trim(), bank: t.bank });

  const rows: DailyCashRow[] = [];
  const lines: DailyCashLine[] = [];
  for (const acct of known.values()) {
    const mine = txs.filter((t) => t.last4 === acct.last4);
    if (!mine.length) continue;
    const before = mine.filter((t) => t.date < from);
    const inside = mine.filter((t) => t.date >= from && t.date <= to);
    const prevBal = [...before].reverse().find((t) => t.balance !== undefined)?.balance;
    const firstWithBal = inside.find((t) => t.balance !== undefined);
    const implied = firstWithBal ? firstWithBal.balance! - signed(firstWithBal) : undefined;
    const opening = prevBal ?? implied ?? null;

    let gap = 0;
    let gapCount = 0;
    let running: number | undefined = prevBal;
    for (const t of inside) {
      let gapBefore: number | undefined;
      if (running !== undefined && t.balance !== undefined) {
        const expect = running + signed(t);
        if (expect !== t.balance) {
          gapBefore = t.balance - expect;
          gap += gapBefore;
          gapCount += 1;
        }
      }
      if (t.balance !== undefined) running = t.balance;
      else if (running !== undefined) running += signed(t);
      lines.push({ ...t, label: acct.label, ...(gapBefore !== undefined ? { gapBefore } : {}) });
    }
    const lastBal = [...inside].reverse().find((t) => t.balance !== undefined)?.balance;
    rows.push({
      ...acct,
      source: "sms",
      opening,
      closing: inside.length ? (lastBal ?? running ?? null) : opening,
      inSum: inside.filter((t) => t.kind === "입금").reduce((s, t) => s + t.amount, 0),
      outSum: inside.filter((t) => t.kind === "출금").reduce((s, t) => s + t.amount, 0),
      inCount: inside.filter((t) => t.kind === "입금").length,
      outCount: inside.filter((t) => t.kind === "출금").length,
      gap,
      gapCount,
      lastSeen: `${mine[mine.length - 1].date} ${mine[mine.length - 1].time}`,
    });
  }
  rows.sort((a, b) => (b.closing ?? 0) - (a.closing ?? 0) || a.label.localeCompare(b.label));

  const byDay = new Map<string, DailyCashLine[]>();
  for (const l of lines.sort((a, b) => a.order.localeCompare(b.order))) byDay.set(l.date, [...(byDay.get(l.date) ?? []), l]);
  const days = [...byDay.entries()].map(([date, ls]) => ({
    date,
    lines: ls,
    inSum: ls.filter((l) => l.kind === "입금").reduce((s, l) => s + l.amount, 0),
    outSum: ls.filter((l) => l.kind === "출금").reduce((s, l) => s + l.amount, 0),
  }));

  const sum = (f: (r: DailyCashRow) => number) => rows.reduce((s, r) => s + f(r), 0);
  return {
    from,
    to,
    rows,
    days,
    totals: {
      opening: sum((r) => r.opening ?? 0),
      closing: sum((r) => r.closing ?? 0),
      inSum: sum((r) => r.inSum),
      outSum: sum((r) => r.outSum),
      gap: sum((r) => r.gap),
    },
  };
}

// ---- 장부(월 엑셀) 기준 — 문자가 안 오는 통장 · 카드 -------------------------

/** 장부 거래의 거래 후 잔액 — 칸(balanceAfter)이 없으면 메모의 「잔액 1,234」 */
export function ledgerBalance(t: Pick<FinTransaction, "balanceAfter" | "note">): number | undefined {
  if (typeof t.balanceAfter === "number") return t.balanceAfter;
  const m = (t.note ?? "").match(/잔액\s*(-?[\d,]+)/);
  return m ? Number(m[1].replace(/,/g, "")) : undefined;
}

/** 통장 기준 들어온 돈인가 나간 돈인가 */
export function ledgerDirection(t: Pick<FinTransaction, "txType" | "acctMid" | "note">): "in" | "out" | null {
  if (t.txType === "수입" || t.txType === "환급") return "in";
  if (t.txType === "지출" || t.txType === "카드대금결제") return "out";
  if (t.txType === "자금거래") {
    if (/입금/.test(t.acctMid ?? "")) return "in";
    if (/출금|반환/.test(t.acctMid ?? "")) return "out";
    if (/^\s*입금/.test(t.note ?? "")) return "in";
    if (/^\s*출금/.test(t.note ?? "")) return "out";
  }
  return null;
}

const ledgerOrder = (t: FinTransaction) => `${t.date} ${(t as { datetime?: string }).datetime ?? ""} ${String(t.createdAt ?? 0).padStart(14, "0")}`;

/** 장부로 센 통장 한 줄 — 기초 · 기말은 장부 메모의 잔액, 입출금은 기간 안 거래 */
export function ledgerAccountRow(ledger: FinTransaction[], acct: CashAccount, from: string, to: string): DailyCashRow {
  const mine = ledger.filter((t) => String(t.last4 ?? "") === acct.last4).sort((a, b) => ledgerOrder(a).localeCompare(ledgerOrder(b)));
  const before = mine.filter((t) => t.date < from);
  const inside = mine.filter((t) => t.date >= from && t.date <= to);
  const lastBal = (arr: FinTransaction[]) => [...arr].reverse().map(ledgerBalance).find((b) => b !== undefined);
  const firstIn = inside.find((t) => ledgerBalance(t) !== undefined && ledgerDirection(t));
  const implied = firstIn ? ledgerBalance(firstIn)! - (ledgerDirection(firstIn) === "in" ? 1 : -1) * netAmount(firstIn) : undefined;
  const opening = lastBal(before) ?? implied ?? null;
  const closing = lastBal([...before, ...inside]) ?? opening;
  const ins = inside.filter((t) => ledgerDirection(t) === "in");
  const outs = inside.filter((t) => ledgerDirection(t) === "out");
  const coveredTo = mine.length ? mine[mine.length - 1].date : undefined;
  return {
    ...acct,
    source: "ledger",
    opening,
    closing,
    inSum: ins.reduce((s, t) => s + netAmount(t), 0),
    outSum: outs.reduce((s, t) => s + netAmount(t), 0),
    inCount: ins.length,
    outCount: outs.length,
    gap: 0,
    gapCount: 0,
    coveredTo,
  };
}

// ---- 법인카드 -------------------------------------------------------

export interface CardTx {
  id: string;
  date: string;
  time: string;
  order: string;
  last4: string;
  company?: string;
  approval: "승인" | "취소";
  amount: number;
  merchant?: string;
  holder?: string;
  installment?: string;
  /** 문자 끝의 잔액 (신한 법인카드 — 남은 한도로 보임) */
  remaining?: number;
}

/** 받은 문자 한 건 → 카드 승인 · 취소 한 줄. 카드 문자가 아니거나 못 읽었으면 null */
export function smsToCardTx(doc: { id: string; receivedAt?: number; createdAt?: number; parsed?: BankSmsParsed }): CardTx | null {
  const p = doc.parsed;
  const c = p?.card;
  if (p?.channel !== "card" || !p.ok || !c?.last4 || !c.amount) return null;
  const base = smsToTx({ id: doc.id, receivedAt: doc.receivedAt, createdAt: doc.createdAt, parsed: { ok: true, kind: "출금", amount: c.amount, last4: c.last4, when: p.when } });
  if (!base) return null;
  return {
    id: doc.id,
    date: base.date,
    time: base.time,
    order: base.order,
    last4: c.last4,
    company: c.company,
    approval: c.approval,
    amount: c.amount,
    merchant: c.merchant,
    holder: c.holder,
    installment: c.installment,
    ...(c.remaining !== undefined ? { remaining: c.remaining } : {}),
  };
}

export interface CardRow extends CashAccount {
  source: "sms" | "ledger";
  /** 기간 사용액 = 승인 − 취소 */
  useSum: number;
  approveCount: number;
  cancelCount: number;
  /** 마지막 문자 · 장부의 마지막 사용일 */
  lastSeen?: string;
  coveredTo?: string;
}

/** 문자로 센 카드 한 줄 */
export function smsCardRow(txs: CardTx[], card: CashAccount, from: string, to: string): CardRow {
  const mine = txs.filter((t) => t.last4 === card.last4).sort((a, b) => a.order.localeCompare(b.order));
  const inside = mine.filter((t) => t.date >= from && t.date <= to);
  const ok = inside.filter((t) => t.approval === "승인");
  const no = inside.filter((t) => t.approval === "취소");
  const last = mine[mine.length - 1];
  return {
    ...card,
    source: "sms",
    useSum: ok.reduce((s, t) => s + t.amount, 0) - no.reduce((s, t) => s + t.amount, 0),
    approveCount: ok.length,
    cancelCount: no.length,
    ...(last ? { lastSeen: `${last.date} ${last.time}` } : {}),
  };
}

/** 장부(카드 기록 · 월 엑셀)로 센 카드 한 줄 — 지출은 승인, 환급은 취소로 본다 */
export function ledgerCardRow(ledger: FinTransaction[], card: CashAccount, from: string, to: string): CardRow {
  const mine = ledger.filter((t) => String(t.last4 ?? "") === card.last4);
  const inside = mine.filter((t) => t.date >= from && t.date <= to);
  const ok = inside.filter((t) => t.txType === "지출");
  const no = inside.filter((t) => t.txType === "환급");
  const coveredTo = mine.reduce((m, t) => (t.date > m ? t.date : m), "");
  return {
    ...card,
    source: "ledger",
    useSum: ok.reduce((s, t) => s + netAmount(t), 0) - no.reduce((s, t) => s + netAmount(t), 0),
    approveCount: ok.length,
    cancelCount: no.length,
    ...(coveredTo ? { coveredTo, lastSeen: coveredTo } : {}),
  };
}
