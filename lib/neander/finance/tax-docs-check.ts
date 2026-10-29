// ============================================================
//  급여·세무 서류 대조 — 서류끼리 · 장부와
// ------------------------------------------------------------
//  세무사 서류는 같은 숫자를 여러 장에 나눠 적는다. 급여대장의 지급합계는
//  신고서의 근로 총지급액이어야 하고, 사업대장의 소득세는 신고서 사업소득
//  징수세액이어야 하고, 납부서 금액은 신고서 납부세액이어야 한다. 실제로
//  2026-05 는 사업대장만 정정되고 신고서는 정정 전 숫자로 남아 있었다.
//
//  장부와는 「낼 돈이 나갔는가」 만 본다.
//    원천세(국세)  다음 달 10일 무렵 국세 납부 — 금액이 같고 계정(근로·사업)도 맞는가
//    지방소득세    같은 무렵 지방세 납부 — 대장에 적힌 지방소득세 합
//    급여          사람마다 차인지급액 — 이름이 같은 인건비 지출 중 가장 가까운 것 (참고)
//  급여는 「참고」 다. 회사가 개인사 몫을 다른 통장에서 더 주기도 하고(1001지급 표),
//  같은 금액이 달마다 되풀이돼서 어느 달 지급인지 장부만으로는 갈리지 않는다.
// ============================================================

import { addDays } from "@/lib/neander/format";
import type { FinTransaction } from "./types";
import {
  personKey,
  pickCurrent,
  type TaxDoc,
  type TaxDocKind,
  type TaxPayLine,
} from "./tax-docs";

export type TaxCheckState = "ok" | "warn" | "bad" | "wait" | "info";

export interface TaxCheck {
  key: string;
  state: TaxCheckState;
  title: string;
  detail?: string;
  /** 장부 대조가 짚은 거래 */
  txIds?: string[];
}

const STATE_RANK: Record<TaxCheckState, number> = { bad: 4, warn: 3, wait: 2, info: 1, ok: 0 };
export const worstState = (checks: TaxCheck[]): TaxCheckState | undefined =>
  checks.length ? checks.reduce((w, c) => (STATE_RANK[c.state] > STATE_RANK[w] ? c.state : w), "ok" as TaxCheckState) : undefined;

const won = (n: number) => `${Math.round(n).toLocaleString("ko-KR")}원`;
const mmdd = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
const netOf = (t: FinTransaction) => t.gross - (t.adjust || 0);
const lastDay = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return `${month}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`;
};
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

/**
 * 금액이 거의 같다 — 기한을 넘겨 낸 납부지연가산세(하루 0.022%)나 이체 수수료만큼.
 * 2026-1분기 부가세는 기한 다음 날 530원을 더 냈다.
 */
const nearAmount = (got: number, want: number) => Math.abs(got - want) <= Math.max(1000, want * 0.005);
function nearNote(t: FinTransaction, want: number, due: string): string {
  const diff = netOf(t) - want;
  const late = daysBetween(due, t.date);
  return `${mmdd(t.date)} ${won(netOf(t))} — ${won(want)} 보다 ${won(Math.abs(diff))} ${diff > 0 ? "더" : "덜"} 냈습니다${diff > 0 && late > 0 ? ` (기한 ${late}일 넘김 · 납부지연가산세로 보임)` : ""}`;
}

/** 토 · 일이면 월요일로 (공휴일은 모른다) */
export function nextBusinessDay(date: string): string {
  const dow = new Date(`${date}T00:00:00`).getDay();
  return dow === 6 ? addDays(date, 2) : dow === 0 ? addDays(date, 1) : date;
}

// ---- 한 달 -------------------------------------------------------

export interface TaxPersonRow {
  key: string;
  name: string;
  type: "wage" | "biz";
  gross: number;
  deduct: number;
  net: number;
  /** 명세서(근로) · 원천징수영수증(사업)의 차인지급액 — 없으면 undefined */
  slipNet?: number;
  /** 장부에서 찾은 지급 (참고) */
  paid?: { tx: FinTransaction; diff: number };
}

export interface TaxMonthFigures {
  count: number;
  gross: number;
  tax: number;
  local: number;
  net: number;
}

export interface TaxMonthView {
  period: string;
  docs: TaxDoc[];
  /** 종류별 — 판이 여럿이면 다 */
  byKind: Partial<Record<TaxDocKind, TaxDoc[]>>;
  wage?: TaxMonthFigures;
  biz?: TaxMonthFigures;
  /** 낼 원천세 (국세) — 근로 · 사업 */
  whtWage: number;
  whtBiz: number;
  /** 낼 지방소득세 */
  localDue: number;
  /** 원천세 납부기한 */
  dueDate: string;
  /** 신고서에서 지난달 환급을 당겨 썼다 (당월조정환급세액) — 지방소득세 금액이 대장 합과 다를 수 있다 */
  refundAdjusted: boolean;
  people: TaxPersonRow[];
  /** 서류끼리 */
  checks: TaxCheck[];
  /** 장부와 */
  ledgerChecks: TaxCheck[];
}

const sumBy = <T,>(list: T[], f: (x: T) => number | undefined) => list.reduce((n, x) => n + (f(x) ?? 0), 0);

function figuresOf(doc: TaxDoc | undefined): TaxMonthFigures | undefined {
  const t = doc?.data?.total;
  const people = doc?.data?.people ?? [];
  if (t) return { count: t.count, gross: t.gross, tax: t.incomeTax ?? 0, local: t.localTax ?? 0, net: t.net };
  if (!people.length) return undefined;
  return {
    count: people.length,
    gross: sumBy(people, (p) => p.gross),
    tax: sumBy(people, (p) => p.incomeTax),
    local: sumBy(people, (p) => p.localTax),
    net: sumBy(people, (p) => p.net),
  };
}

function billAmount(bills: TaxDoc[], re: RegExp): number | undefined {
  let hit: number | undefined;
  for (const b of bills) for (const it of b.data?.items ?? []) if (re.test(it.label)) hit = (hit ?? 0) + it.amount;
  return hit;
}

/** 서류끼리 — 같은 숫자가 다른 장에서도 같은가 */
function crossChecks(v: Omit<TaxMonthView, "checks" | "ledgerChecks">, cur: Record<string, TaxDoc | undefined>, slips: TaxPayLine[]): TaxCheck[] {
  const out: TaxCheck[] = [];
  const ret = cur.ret?.data;
  const eq = (key: string, title: string, a: number | undefined, b: number | undefined, aLabel: string, bLabel: string) => {
    if (a === undefined || b === undefined) return;
    out.push(
      a === b
        ? { key, state: "ok", title, detail: `${aLabel} ${won(a)} = ${bLabel}` }
        : { key, state: "bad", title, detail: `${aLabel} ${won(a)} · ${bLabel} ${won(b)} — ${won(Math.abs(a - b))} 차이` },
    );
  };

  const wageLedger = figuresOf(cur.ledger);
  const bizLedger = figuresOf(cur.bizLedger);
  if (ret?.wage) {
    eq("wage-gross", "근로 총지급액 — 급여대장 · 신고서", wageLedger?.gross, ret.wage.gross, "급여대장", "신고서");
    eq("wage-tax", "근로소득세 — 급여대장 · 신고서", wageLedger?.tax, ret.wage.tax, "급여대장", "신고서");
    if (!cur.ledger && ret.wage.count > 0) out.push({ key: "wage-missing", state: "info", title: "급여대장이 없습니다", detail: `신고서에는 근로 ${ret.wage.count}명` });
  }
  if (ret?.biz) {
    eq("biz-gross", "사업소득 지급액 — 사업대장 · 신고서", bizLedger?.gross, ret.biz.gross, "사업대장", "신고서");
    eq("biz-tax", "사업소득세 — 사업대장 · 신고서", bizLedger?.tax, ret.biz.tax, "사업대장", "신고서");
    if (!cur.bizLedger && ret.biz.count > 0) out.push({ key: "biz-missing", state: "info", title: "사업소득 지급대장이 없습니다", detail: `신고서에는 사업소득 ${ret.biz.count}명` });
  }
  const bills = v.byKind["wht-bill"] ?? [];
  if (ret && bills.length) {
    eq("bill-wage", "근로소득세 — 신고서 납부세액 · 납부서", ret.wage?.paid, billAmount(bills, /근로/), "신고서", "납부서");
    eq("bill-biz", "사업소득세 — 신고서 납부세액 · 납부서", ret.biz?.paid, billAmount(bills, /사업/), "신고서", "납부서");
  }
  // 판이 둘 — 정정본이 있으면 알려 준다 (대조는 정정본으로 했다)
  for (const kind of ["payroll-ledger", "biz-ledger", "wht-return"] as TaxDocKind[]) {
    const list = v.byKind[kind] ?? [];
    if (list.length > 1) {
      const c = pickCurrent(list)!;
      out.push({ key: `dup-${kind}`, state: "info", title: `같은 달 서류가 ${list.length}판`, detail: `「${c.name}」 로 대조했습니다` });
    }
  }
  // 명세서 — 급여대장 사람마다 한 장, 차인지급액이 같은가 (대장이 없으면 견줄 것이 없다)
  const wagePeople = v.people.filter((p) => p.type === "wage");
  if (cur.ledger && wagePeople.length && slips.length) {
    const missing = wagePeople.filter((p) => p.slipNet === undefined);
    const differ = wagePeople.filter((p) => p.slipNet !== undefined && p.slipNet !== p.net);
    const have = wagePeople.length - missing.length;
    out.push({
      key: "slips",
      state: differ.length ? "bad" : missing.length ? "warn" : "ok",
      title: `급여명세서 ${have}/${wagePeople.length}명`,
      detail: [
        missing.length ? `없음: ${missing.map((p) => p.name).join(", ")}` : "",
        differ.length ? `금액 다름: ${differ.map((p) => `${p.name} (대장 ${won(p.net)} · 명세서 ${won(p.slipNet!)})`).join(", ")}` : "",
      ]
        .filter(Boolean)
        .join(" · ") || "차인지급액이 대장과 모두 같습니다",
    });
  }
  // 대장 안 — 사람 줄의 합이 합계 줄과 같은가 (못 읽은 줄이 있으면 어긋난다)
  for (const [doc, label] of [[cur.ledger, "급여대장"], [cur.bizLedger, "사업대장"]] as const) {
    const t = doc?.data?.total;
    const people = doc?.data?.people ?? [];
    if (t && people.length && sumBy(people, (p) => p.net) !== t.net) {
      out.push({ key: `rows-${label}`, state: "warn", title: `${label} 사람 줄을 다 읽지 못했을 수 있습니다`, detail: `사람 줄 합 ${won(sumBy(people, (p) => p.net))} · 합계 줄 ${won(t.net)} — 파일을 직접 확인하세요` });
    }
  }
  return out;
}

// ---- 장부 --------------------------------------------------------

const isWhtTx = (t: FinTransaction) =>
  t.txType === "지출" &&
  !/부가/.test(t.acctMinor ?? "") &&
  ((t.acctMid === "국세" && /원천/.test(t.acctMinor ?? "")) || (/국세/.test(t.vendor ?? "") && (t.acctMajor ?? "세금공과") === "세금공과"));
const isLocalTx = (t: FinTransaction) =>
  t.txType === "지출" &&
  !/주민세|재산세|자동차세|취득세|등록면허세/.test(t.acctMinor ?? "") &&
  ((t.acctMid === "지방세" && /지방소득세/.test(t.acctMinor ?? "")) || /위택스|지방세/.test(t.vendor ?? ""));
const isPayTx = (t: FinTransaction) => t.txType === "지출" && t.acctMajor === "인건비" && /급여|프리랜서/.test(t.acctMid ?? "");

function taxLedgerChecks(v: TaxMonthView, txs: FinTransaction[], today: string, used: Set<string>): TaxCheck[] {
  const out: TaxCheck[] = [];
  const from = addDays(v.dueDate, -25);
  const to = addDays(v.dueDate, 25);
  const pool = txs.filter((t) => t.date >= from && t.date <= to);
  const late = today > addDays(v.dueDate, 5);
  const pending = (key: string, title: string, amount: number, cands: FinTransaction[]): TaxCheck =>
    late
      ? {
          key,
          state: "bad",
          title,
          detail: `${won(amount)} 을(를) 장부에서 못 찾았습니다 (기한 ${mmdd(v.dueDate)})${cands.length ? ` · 그 무렵 납부: ${cands.map((t) => `${mmdd(t.date)} ${won(netOf(t))}`).join(", ")}` : ""}`,
          txIds: cands.map((t) => t.id),
        }
      : { key, state: "wait", title, detail: `${won(amount)} · 납부 전 (기한 ${mmdd(v.dueDate)})` };

  // 원천세 — 근로 · 사업을 따로 낸다. 한 번에 낸 달도 있다.
  const wht = pool.filter((t) => isWhtTx(t) && !used.has(t.id));
  const wants: { key: string; label: string; amount: number; re: RegExp }[] = [
    { key: "ledger-wage", label: "근로소득세", amount: v.whtWage, re: /근로/ },
    { key: "ledger-biz", label: "사업소득세", amount: v.whtBiz, re: /사업/ },
  ].filter((w) => w.amount > 0);
  const together = wants.length === 2 ? wht.find((t) => netOf(t) === v.whtWage + v.whtBiz) : undefined;
  if (together) {
    used.add(together.id);
    out.push({ key: "ledger-wht", state: "ok", title: "원천세 (국세)", detail: `${mmdd(together.date)} ${won(netOf(together))} — 근로 · 사업을 한 번에 냈습니다`, txIds: [together.id] });
  } else {
    for (const w of wants) {
      const free = wht.filter((t) => !used.has(t.id));
      const hit = free.find((t) => netOf(t) === w.amount && w.re.test(t.acctMinor ?? "")) ?? free.find((t) => netOf(t) === w.amount);
      const near = hit ? undefined : free.find((t) => nearAmount(netOf(t), w.amount));
      if (!hit && !near) {
        out.push(pending(w.key, w.label, w.amount, free));
        continue;
      }
      const t = (hit ?? near)!;
      used.add(t.id);
      const acct = t.acctMinor ?? "";
      const right = `원천징수소득세(${w.label === "근로소득세" ? "근로" : "사업 3.3%"})`;
      if (!w.re.test(acct)) {
        out.push({
          key: w.key,
          state: "warn",
          title: `${w.label} — 장부 계정 확인`,
          detail: `${mmdd(t.date)} ${won(netOf(t))} 은(는) 금액이 맞지만 계정이 「${acct || "비어 있음"}」 입니다 — 「${right}」 가 맞습니다`,
          txIds: [t.id],
        });
      } else if (near) {
        out.push({ key: w.key, state: "warn", title: w.label, detail: nearNote(t, w.amount, v.dueDate), txIds: [t.id] });
      } else {
        out.push({ key: w.key, state: "ok", title: w.label, detail: `${mmdd(t.date)} ${won(netOf(t))} 납부`, txIds: [t.id] });
      }
    }
  }

  // 지방소득세 — 사람마다 10원 아래를 버려서 대장 합과 같아야 한다
  if (v.localDue > 0) {
    const local = pool.filter((t) => isLocalTx(t) && !used.has(t.id));
    const exact = local.find((t) => netOf(t) === v.localDue);
    const near = exact ? undefined : local.find((t) => Math.abs(netOf(t) - v.localDue) <= Math.max(100, v.localDue * 0.01));
    const hit = exact ?? near;
    if (hit) {
      used.add(hit.id);
      out.push({
        key: "ledger-local",
        state: exact ? "ok" : "warn",
        title: "지방소득세",
        detail: exact
          ? `${mmdd(hit.date)} ${won(netOf(hit))} 납부`
          : `${mmdd(hit.date)} ${won(netOf(hit))} — 대장 합 ${won(v.localDue)} 와(과) ${won(Math.abs(netOf(hit) - v.localDue))} 차이`,
        txIds: [hit.id],
      });
    } else if (v.refundAdjusted && local.length) {
      // 환급을 당겨 쓴 달은 지방소득세도 줄어든다 — 대장 합으로는 금액을 못 맞춘다
      const t = local.sort((a, b) => Math.abs(netOf(a) - v.localDue) - Math.abs(netOf(b) - v.localDue))[0];
      used.add(t.id);
      out.push({
        key: "ledger-local",
        state: "warn",
        title: "지방소득세",
        detail: `${mmdd(t.date)} ${won(netOf(t))} — 대장 합은 ${won(v.localDue)} 이지만 이 달은 신고서에서 환급을 당겨 써서 금액이 다를 수 있습니다. 위택스 납부 내역으로 확인하세요`,
        txIds: [t.id],
      });
    } else out.push(pending("ledger-local", "지방소득세", v.localDue, local));
  }
  return out;
}

/** 사람마다 장부 지급 — 이름이 들어간 인건비 지출 중 금액이 같은 것, 없으면 가장 가까운 것 */
function matchPayments(v: TaxMonthView, txs: FinTransaction[], used: Set<string>, payDate: string) {
  const from = addDays(`${v.period}-01`, -35);
  const to = addDays(payDate, 20);
  const pool = txs.filter((t) => t.date >= from && t.date <= to && isPayTx(t) && !used.has(t.id));
  for (const p of v.people) {
    const cands = pool.filter((t) => !used.has(t.id) && personKey(t.vendor ?? "").includes(p.key));
    if (!cands.length) continue;
    cands.sort((a, b) => {
      const da = Math.abs(netOf(a) - p.net);
      const db = Math.abs(netOf(b) - p.net);
      if ((da === 0) !== (db === 0)) return da === 0 ? -1 : 1;
      const ta = Math.abs(daysBetween(a.date, payDate));
      const tb = Math.abs(daysBetween(b.date, payDate));
      return da === db ? ta - tb : ta === tb ? da - db : ta - tb;
    });
    const hit = cands[0];
    // 금액이 반도 안 맞으면 다른 지급(개인사 몫 · 정산)이다
    if (Math.abs(netOf(hit) - p.net) > p.net * 0.5) continue;
    used.add(hit.id);
    p.paid = { tx: hit, diff: netOf(hit) - p.net };
  }
}

function buildMonth(period: string, docs: TaxDoc[]): Omit<TaxMonthView, "checks" | "ledgerChecks"> & { cur: Record<string, TaxDoc | undefined>; slips: TaxPayLine[]; payDate: string } {
  const byKind: Partial<Record<TaxDocKind, TaxDoc[]>> = {};
  for (const d of docs) (byKind[d.kind] ??= []).push(d);
  const cur = {
    ledger: pickCurrent(byKind["payroll-ledger"] ?? []),
    bizLedger: pickCurrent(byKind["biz-ledger"] ?? []),
    ret: pickCurrent(byKind["wht-return"] ?? []),
  };
  const slips = (byKind.payslip ?? []).flatMap((d) => d.data?.people ?? []);
  const certs = (byKind["biz-cert"] ?? []).flatMap((d) => d.data?.people ?? []);

  const slipByKey = new Map(slips.map((s) => [personKey(s.name), s]));
  const certByKey = new Map(certs.map((s) => [personKey(s.name), s]));
  // 대장이 없는 달은 명세서 · 영수증이 사람 줄이 된다 — 그때는 자기 자신과 견주지 않는다
  const hasLedger = !!cur.ledger?.data?.people?.length;
  const hasBizLedger = !!cur.bizLedger?.data?.people?.length;
  const wagePeople = hasLedger ? cur.ledger!.data!.people! : slips;
  const bizPeople = hasBizLedger ? cur.bizLedger!.data!.people! : certs;
  const row = (p: TaxPayLine, type: "wage" | "biz", against?: Map<string, TaxPayLine>): TaxPersonRow => ({
    key: personKey(p.name),
    name: p.name,
    type,
    gross: p.gross,
    deduct: p.deduct,
    net: p.net,
    slipNet: against?.get(personKey(p.name))?.net,
  });
  const people: TaxPersonRow[] = [
    ...wagePeople.map((p) => row(p, "wage", hasLedger ? slipByKey : undefined)),
    ...bizPeople.map((p) => row(p, "biz", hasBizLedger ? certByKey : undefined)),
  ];

  const ret = cur.ret?.data;
  const wage = figuresOf(cur.ledger) ?? (slips.length ? figuresOf({ data: { people: slips } } as TaxDoc) : undefined) ?? (ret?.wage ? { count: ret.wage.count, gross: ret.wage.gross, tax: ret.wage.tax, local: 0, net: 0 } : undefined);
  const biz = figuresOf(cur.bizLedger) ?? (certs.length ? figuresOf({ data: { people: certs } } as TaxDoc) : undefined) ?? (ret?.biz ? { count: ret.biz.count, gross: ret.biz.gross, tax: ret.biz.tax, local: 0, net: 0 } : undefined);

  // 낼 돈 — 납부서가 있으면 그것(실제로 내는 금액), 없으면 신고서 납부세액, 그것도 없으면 대장
  const bills = byKind["wht-bill"] ?? [];
  const whtWage = billAmount(bills, /근로/) ?? ret?.wage?.paid ?? wage?.tax ?? 0;
  const whtBiz = billAmount(bills, /사업/) ?? ret?.biz?.paid ?? biz?.tax ?? 0;
  const localDue = billAmount(byKind["local-bill"] ?? [], /./) ?? (wage?.local ?? 0) + (biz?.local ?? 0);

  const payMonth = ret?.payMonth ?? period;
  const [y, m] = payMonth.split("-").map(Number);
  const next = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}`;
  const dueDate = bills.find((b) => b.data?.dueDate)?.data?.dueDate ?? nextBusinessDay(`${next}-10`);
  const payDate = cur.ledger?.data?.payDate ?? (byKind.payslip ?? []).find((d) => d.data?.payDate)?.data?.payDate ?? lastDay(period);

  const refundAdjusted = !!(ret?.wage?.adjust || ret?.biz?.adjust);
  return { period, docs, byKind, wage, biz, whtWage, whtBiz, localDue, dueDate, refundAdjusted, people, cur, slips, payDate };
}

/**
 * 귀속월마다 대조한다. 장부 거래는 앞 달부터 차례로 짝지어(한 거래를 두 달이 같이
 * 쓰지 않게) — 같은 금액의 급여 · 원천세가 달마다 되풀이되기 때문이다.
 */
export function buildTaxMonths(docs: TaxDoc[], txs: FinTransaction[], today: string): TaxMonthView[] {
  const groups = new Map<string, TaxDoc[]>();
  for (const d of docs) {
    if (!d.period || !/^20\d\d-\d\d$/.test(d.period)) continue;
    groups.set(d.period, [...(groups.get(d.period) ?? []), d]);
  }
  const usedTax = new Set<string>();
  const usedPay = new Set<string>();
  return [...groups.keys()].sort().map((period) => {
    const b = buildMonth(period, groups.get(period)!);
    const { cur, slips, payDate, ...rest } = b;
    const view: TaxMonthView = { ...rest, checks: [], ledgerChecks: [] };
    view.checks = crossChecks(view, cur, slips);
    if (view.whtWage + view.whtBiz + view.localDue > 0) view.ledgerChecks = taxLedgerChecks(view, txs, today, usedTax);
    matchPayments(view, txs, usedPay, payDate);
    return view;
  });
}

// ---- 부가세 (분기) -------------------------------------------------

export interface TaxVatView {
  period: string;
  entity: string;
  docs: TaxDoc[];
  byKind: Partial<Record<TaxDocKind, TaxDoc[]>>;
  base?: number;
  payable?: number;
  /** 납부서 금액 (10원 아래 버림) */
  billed?: number;
  dueDate: string;
  checks: TaxCheck[];
}

/** 분기 → 부가세 신고 · 납부기한 (다음 달 25일) */
export function vatDueOf(period: string): string {
  const y = Number(period.slice(0, 4));
  const q = Number(period.slice(6));
  const m = q * 3 + 1;
  return nextBusinessDay(m > 12 ? `${y + 1}-01-25` : `${y}-${String(m).padStart(2, "0")}-25`);
}

export function buildVatQuarters(docs: TaxDoc[], txs: FinTransaction[], today: string): TaxVatView[] {
  const groups = new Map<string, TaxDoc[]>();
  for (const d of docs) {
    if (!d.period || !/^20\d\d-Q[1-4]$/.test(d.period)) continue;
    const k = `${d.period}|${d.entity ?? "네안데르"}`;
    groups.set(k, [...(groups.get(k) ?? []), d]);
  }
  const used = new Set<string>();
  return [...groups.keys()].sort().map((k) => {
    const [period, entity] = k.split("|");
    const list = groups.get(k)!;
    const byKind: Partial<Record<TaxDocKind, TaxDoc[]>> = {};
    for (const d of list) (byKind[d.kind] ??= []).push(d);
    const ret = pickCurrent(byKind["vat-return"] ?? [])?.data?.vat;
    const rec = pickCurrent(byKind["vat-receipt"] ?? [])?.data?.vat;
    const bill = pickCurrent(byKind["vat-bill"] ?? []);
    const billed = bill?.data?.items?.find((i) => /부가/.test(i.label))?.amount;
    const payable = rec?.payable ?? ret?.payable;
    const dueDate = bill?.data?.dueDate ?? vatDueOf(period);
    const checks: TaxCheck[] = [];
    if (ret?.payable !== undefined && rec?.payable !== undefined) {
      checks.push(
        ret.payable === rec.payable
          ? { key: "vat-ret-rec", state: "ok", title: "신고서 · 접수증", detail: `납부할 세액 ${won(rec.payable)}` }
          : { key: "vat-ret-rec", state: "bad", title: "신고서 · 접수증", detail: `신고서 ${won(ret.payable)} · 접수증 ${won(rec.payable)}` },
      );
    }
    // 장부 — 10원 아래를 버린 금액이 나간다
    const want = billed ?? (payable !== undefined && payable > 0 ? Math.floor(payable / 10) * 10 : undefined);
    if (want !== undefined && want > 0) {
      const from = addDays(dueDate, -30);
      const to = addDays(dueDate, 30);
      const cands = txs.filter(
        (t) =>
          !used.has(t.id) &&
          t.txType === "지출" &&
          t.date >= from &&
          t.date <= to &&
          (/부가/.test(t.acctMinor ?? "") || (/국세/.test(t.vendor ?? "") && !/원천/.test(t.acctMinor ?? ""))) &&
          (!t.site || t.site === entity),
      );
      const hit = cands.find((t) => netOf(t) === want);
      const near = hit ? undefined : cands.find((t) => nearAmount(netOf(t), want));
      if (hit) {
        used.add(hit.id);
        checks.push({ key: "vat-ledger", state: "ok", title: "장부 납부", detail: `${mmdd(hit.date)} ${won(netOf(hit))}`, txIds: [hit.id] });
      } else if (near) {
        used.add(near.id);
        checks.push({ key: "vat-ledger", state: "warn", title: "장부 납부", detail: nearNote(near, want, dueDate), txIds: [near.id] });
      } else if (today > addDays(dueDate, 5)) {
        checks.push({
          key: "vat-ledger",
          state: "bad",
          title: "장부 납부",
          detail: `${won(want)} 을(를) 장부에서 못 찾았습니다 (기한 ${mmdd(dueDate)})${cands.length ? ` · 그 무렵: ${cands.map((t) => `${mmdd(t.date)} ${won(netOf(t))}`).join(", ")}` : ""}`,
          txIds: cands.map((t) => t.id),
        });
      } else checks.push({ key: "vat-ledger", state: "wait", title: "장부 납부", detail: `${won(want)} · 납부 전 (기한 ${mmdd(dueDate)})` });
    } else if (payable !== undefined && payable < 0) {
      checks.push({ key: "vat-refund", state: "info", title: "환급", detail: `${won(-payable)} 돌려받을 세액` });
    }
    return { period, entity, docs: list, byKind, base: rec?.base ?? ret?.base, payable, billed, dueDate, checks };
  });
}
