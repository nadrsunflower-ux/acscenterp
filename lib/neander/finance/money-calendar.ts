// ============================================================
//  돈 나가는 날 — 카드값 · 세금 · 급여 · 월세 · 대출 이자 · 공과금 달력
// ------------------------------------------------------------
//  매달(또는 해마다) 정해진 날에 나가는 돈을 규칙으로 적어 두고, 앞으로 올
//  날짜를 펼친다. 노션 「돈 나가는 날」 표와 알림(server/money-calendar.ts)이 쓴다.
//
//  · 규칙은 Firestore(neander_fin_settings/money-calendar)에 둔다 — 거래처 · 통장
//    번호 · 받는 사람 메일이 들어가므로 공개 저장소인 코드에 적지 않는다.
//  · 날짜는 「정해진 날」 과 「실제로 빠지는 날」 이 다르다. 자동이체 · 세금은 그날이
//    토 · 일 · 공휴일이면 다음 영업일로 밀린다(shift: "next"). 급여 · 월세처럼
//    인터넷으로 직접 보내는 돈은 그날 그대로 둔다(shift: "none").
//  · 금액은 미리 알 수 없는 것이 많다(카드값 · 원천세). 그래서 장부에서 지난번에
//    같은 규칙으로 나간 돈을 찾아 「지난번 얼마」 를 붙이고, 이번 회차에 맞는 출금이
//    장부에 이미 있으면 「냈음」 으로 본다.
//
//  계산만 한다 — 노션 · Firestore 를 부르지 않는다 (money-calendar.test.ts).
// ============================================================

import { netAmount, type FinTransaction } from "./types";

export const MONEY_KINDS = ["카드대금", "세금", "급여·월세", "대출이자·공과금"] as const;
export type MoneyKind = (typeof MONEY_KINDS)[number];

/** 장부에서 이 규칙의 출금을 찾는 조건 — 적힌 것은 모두 맞아야 한다 */
export interface MoneyMatch {
  /** 거래처 이름에 들어 있는 글자 (띄어쓰기 무시). 이름이 여럿이면 | 로 나눈다 */
  vendor?: string;
  /** 계정 중분류 (예: 급여 · 사대보험 · 국세) */
  acctMid?: string;
  /** 계정 소분류 — 하나라도 맞으면 된다 */
  acctMinor?: string[];
  /** 통장 · 카드 끝 네 자리 */
  last4?: string;
  /** 사업장 (네안데르 · 일해라컴퍼니 …) */
  site?: string;
}

export interface MoneyRule {
  /** 바뀌지 않는 이름표 — 노션 줄 · 알림 기록의 열쇠 (영문 · 숫자 · -) */
  id: string;
  kind: MoneyKind;
  /** 화면 · 알림에 나가는 이름 (예: 국민카드 대금) */
  label: string;
  /** 나가는 달 (1~12). 비우면 매달 */
  months?: number[];
  /** 그 달의 날. 31 이면 말일 (짧은 달은 그 달 마지막 날) */
  day: number;
  /** 휴일이면 — next: 다음 영업일 · none: 그날 그대로 */
  shift: "next" | "none";
  /** 빠지는 통장 (보이는 글자 그대로) */
  account?: string;
  /** 장부에서 지난 금액 · 낸 기록을 찾는 조건. 없으면 금액을 붙이지 않는다 */
  match?: MoneyMatch;
  /** 낸 기록을 찾는 범위 (실제 날 기준 앞 · 뒤 며칠). 기본 앞 5일 · 뒤 7일 */
  window?: { before: number; after: number };
  /** 알림 · 노션에 같이 적는 한 줄 */
  note?: string;
  /** 잠시 끄기 */
  off?: boolean;
}

export interface MoneyCalendarSettings {
  /** 노션에서 표를 만들 페이지 (주소나 id) — 연결(NEANDER ERP)이 붙어 있어야 한다 */
  notionPage?: string;
  /** 처음 만들 때 정해지는 노션 표 · 데이터 소스 id */
  databaseId?: string;
  dataSourceId?: string;
  /** 알림 받을 노션 계정 메일 */
  recipients: string[];
  /** 며칠 전에 알릴까 (0 = 당일) */
  leadDays: number[];
  rules: MoneyRule[];
}

// ---- 공휴일 -----------------------------------------------------
//
//  관공서 공휴일 + 대체공휴일 + 근로자의 날(노동절 — 은행이 쉬고, 국세기본법도
//  납부기한을 다음 날로 미룬다). 해마다 12월에 다음 해를 더한다 — 표에 없는 해는
//  주말만 거른다(holidayYears 로 알 수 있다). 음력 명절 · 대체공휴일은 정부 발표 기준.
const HOLIDAYS: Record<number, string[]> = {
  2025: [
    "01-01", "01-27", "01-28", "01-29", "01-30", "03-01", "03-03", "05-01", "05-05", "05-06", "06-03", "06-06",
    "08-15", "10-03", "10-05", "10-06", "10-07", "10-08", "10-09", "12-25",
  ],
  2026: [
    "01-01", "02-16", "02-17", "02-18", "03-01", "03-02", "05-01", "05-05", "05-24", "05-25", "06-03", "06-06",
    "08-15", "08-17", "09-24", "09-25", "09-26", "10-03", "10-05", "10-09", "12-25",
  ],
  2027: [
    "01-01", "02-06", "02-07", "02-08", "02-09", "03-01", "05-01", "05-05", "05-13", "06-06", "08-15", "08-16",
    "09-14", "09-15", "09-16", "10-03", "10-04", "10-09", "10-11", "12-25", "12-27",
  ],
};
const HOLIDAY_SET = new Set(Object.entries(HOLIDAYS).flatMap(([y, ds]) => ds.map((d) => `${y}-${d}`)));
export const holidayYears = () => Object.keys(HOLIDAYS).map(Number);

const DAY_MS = 86_400_000;
export const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
export const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
const dow = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();

export const isHoliday = (date: string) => HOLIDAY_SET.has(date);
export const isBusinessDay = (date: string) => dow(date) !== 0 && dow(date) !== 6 && !isHoliday(date);

/** 그날이 쉬는 날이면 다음 영업일 */
export function nextBusinessDayKr(date: string): string {
  let d = date;
  for (let i = 0; i < 15 && !isBusinessDay(d); i++) d = addDays(d, 1);
  return d;
}

const WEEKDAY = ["일", "월", "화", "수", "목", "금", "토"];
/** 11/10(화) */
export const shortDate = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}(${WEEKDAY[dow(date)]})`;

// ---- 날짜 펼치기 --------------------------------------------------

const lastDayOf = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

export interface MoneyOccurrence {
  /** rule.id ¦ 정해진 날 — 노션 줄 · 알림 기록의 열쇠 */
  key: string;
  rule: MoneyRule;
  /** 규칙상 날 (그 달의 day) */
  nominal: string;
  /** 실제로 빠지는 날 (휴일이면 밀린 날) */
  date: string;
  /** 휴일 때문에 밀렸나 */
  shifted: boolean;
}

/** from ~ to 사이(실제 날 기준)에 오는 회차 */
export function expandRules(rules: MoneyRule[], from: string, to: string): MoneyOccurrence[] {
  const out: MoneyOccurrence[] = [];
  // 실제 날이 밀려 from 안으로 들어오는 경우까지 — 한 달 앞에서부터 본다
  const start = addDays(from, -31);
  let y = Number(start.slice(0, 4));
  let m = Number(start.slice(5, 7));
  const endY = Number(to.slice(0, 4));
  const endM = Number(to.slice(5, 7));
  while (y < endY || (y === endY && m <= endM)) {
    for (const rule of rules) {
      if (rule.off) continue;
      if (rule.months?.length && !rule.months.includes(m)) continue;
      const day = Math.min(rule.day, lastDayOf(y, m));
      const nominal = `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const date = rule.shift === "next" ? nextBusinessDayKr(nominal) : nominal;
      if (date < from || date > to) continue;
      out.push({ key: `${rule.id}¦${nominal}`, rule, nominal, date, shifted: date !== nominal });
    }
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.rule.label.localeCompare(b.rule.label));
}

// ---- 장부와 맞추기 --------------------------------------------------

const squash = (s: string | undefined) => (s ?? "").replace(/\s+/g, "");

export function matchesRule(t: FinTransaction, m: MoneyMatch): boolean {
  if (t.txType === "수입" || t.txType === "자금거래") return false;
  if (netAmount(t) <= 0) return false;
  if (m.vendor && !m.vendor.split("|").some((v) => squash(t.vendor).includes(squash(v)))) return false;
  if (m.acctMid && t.acctMid !== m.acctMid) return false;
  if (m.acctMinor?.length && !m.acctMinor.includes(t.acctMinor ?? "")) return false;
  if (m.last4 && String(t.last4 ?? "") !== m.last4) return false;
  if (m.site && t.site !== m.site) return false;
  return true;
}

const windowOf = (rule: MoneyRule) => rule.window ?? { before: 5, after: 7 };

export interface MoneyPaid {
  date: string;
  amount: number;
  count: number;
}

/** 한 회차에 맞는 출금 — 실제 날 앞뒤 범위 안. 여러 건이면 합친다 (카드값 나눠 빠짐 · 원천세+지방소득세) */
export function paidFor(occ: Pick<MoneyOccurrence, "date" | "rule">, txs: FinTransaction[]): MoneyPaid | null {
  const m = occ.rule.match;
  if (!m) return null;
  const w = windowOf(occ.rule);
  const lo = addDays(occ.date, -w.before);
  const hi = addDays(occ.date, w.after);
  const hit = txs.filter((t) => t.date >= lo && t.date <= hi && matchesRule(t, m));
  if (!hit.length) return null;
  return {
    date: hit.reduce((a, t) => (t.date > a ? t.date : a), hit[0].date),
    amount: hit.reduce((s, t) => s + netAmount(t), 0),
    count: hit.length,
  };
}

/** 지난번 — 이 회차보다 앞선 회차 가운데 장부에 출금이 있는 가장 최근 것 (최대 13회차 전까지) */
export function lastPaidBefore(rule: MoneyRule, before: string, txs: FinTransaction[]): (MoneyPaid & { nominal: string }) | null {
  if (!rule.match) return null;
  const past = expandRules([rule], addDays(before, -400), addDays(before, -1)).reverse();
  for (const occ of past) {
    const p = paidFor(occ, txs);
    if (p) return { ...p, nominal: occ.nominal };
  }
  return null;
}

// ---- 한 줄로 ------------------------------------------------------

export type MoneyState = "예정" | "냈음";

export interface MoneyRow extends MoneyOccurrence {
  state: MoneyState;
  paid: MoneyPaid | null;
  last: (MoneyPaid & { nominal: string }) | null;
  /** 이번 회차 금액 짐작 — 냈으면 낸 돈, 아니면 지난번 금액 */
  amount: number | null;
  /** 근거 한 줄 (휴일 밀림 · 지난번 · 메모) */
  basis: string;
}

const manwon = (n: number) => {
  const man = n / 10_000;
  return man >= 100 ? `${Math.round(man).toLocaleString("ko-KR")}만 원` : `${(Math.round(man * 10) / 10).toLocaleString("ko-KR")}만 원`;
};
export const moneyText = manwon;

export function buildMoneyRows(rules: MoneyRule[], txs: FinTransaction[], from: string, to: string): MoneyRow[] {
  return expandRules(rules, from, to).map((occ) => {
    const paid = paidFor(occ, txs);
    const last = paid ? null : lastPaidBefore(occ.rule, occ.date, txs);
    const parts: string[] = [];
    if (occ.shifted) parts.push(`${shortDate(occ.nominal)}이 쉬는 날이라 ${shortDate(occ.date)}로 밀림`);
    if (paid) parts.push(`${shortDate(paid.date)} ${paid.amount.toLocaleString("ko-KR")}원 냄${paid.count > 1 ? ` (${paid.count}건)` : ""}`);
    else if (last) parts.push(`지난번 ${shortDate(last.date)} ${last.amount.toLocaleString("ko-KR")}원${last.count > 1 ? ` (${last.count}건)` : ""}`);
    if (occ.rule.note) parts.push(occ.rule.note);
    return {
      ...occ,
      state: paid ? "냈음" : "예정",
      paid,
      last,
      amount: paid?.amount ?? last?.amount ?? null,
      basis: parts.join(" · "),
    };
  });
}

// ---- 알림 ------------------------------------------------------

/** 오늘 보낼 알림 — 실제 날까지 남은 날이 leadDays 에 있는 「예정」 회차 */
export function dueAlerts(rows: MoneyRow[], today: string, leadDays: number[]): { row: MoneyRow; lead: number; sentKey: string }[] {
  return rows
    .filter((r) => r.state === "예정")
    .map((r) => ({ row: r, lead: daysBetween(today, r.date) }))
    .filter((x) => leadDays.includes(x.lead))
    .map((x) => ({ ...x, sentKey: `${x.row.key}¦${x.lead}` }));
}

/** 알림 글 (멘션 뒤에 붙는 부분) */
export function alertText(row: MoneyRow, lead: number): string {
  const when = lead === 0 ? `오늘 ${shortDate(row.date)}` : `${lead}일 뒤 ${shortDate(row.date)}`;
  const bits = [`${when} · ${row.rule.label}`];
  if (row.rule.account) bits.push(`${row.rule.account} 통장`);
  if (row.last) bits.push(`지난번 ${manwon(row.last.amount)}`);
  if (row.shifted) bits.push(`${shortDate(row.nominal)}이 쉬는 날이라 밀림`);
  if (row.rule.note) bits.push(row.rule.note);
  return bits.join(" — ");
}

// ---- 설정 다듬기 ----------------------------------------------------

const isKind = (v: unknown): v is MoneyKind => (MONEY_KINDS as readonly string[]).includes(v as string);
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);

export function sanitizeMoneySettings(raw: unknown): MoneyCalendarSettings {
  const r = (raw ?? {}) as Record<string, unknown>;
  const rules = (Array.isArray(r.rules) ? r.rules : [])
    .map((x): MoneyRule | null => {
      const o = (x ?? {}) as Record<string, unknown>;
      const id = str(o.id);
      const label = str(o.label);
      const day = Number(o.day);
      if (!id || !/^[a-z0-9-]+$/.test(id) || !label || !isKind(o.kind) || !(day >= 1 && day <= 31)) return null;
      const months = Array.isArray(o.months) ? o.months.map(Number).filter((n) => n >= 1 && n <= 12) : undefined;
      const mt = (o.match ?? null) as Record<string, unknown> | null;
      const w = (o.window ?? null) as Record<string, unknown> | null;
      return {
        id,
        kind: o.kind,
        label,
        ...(months?.length ? { months } : {}),
        day,
        shift: o.shift === "none" ? "none" : "next",
        ...(str(o.account) ? { account: str(o.account) } : {}),
        ...(mt
          ? {
              match: {
                ...(str(mt.vendor) ? { vendor: str(mt.vendor) } : {}),
                ...(str(mt.acctMid) ? { acctMid: str(mt.acctMid) } : {}),
                ...(Array.isArray(mt.acctMinor) && mt.acctMinor.length ? { acctMinor: mt.acctMinor.map(String) } : {}),
                ...(str(mt.last4) ? { last4: str(mt.last4) } : {}),
                ...(str(mt.site) ? { site: str(mt.site) } : {}),
              },
            }
          : {}),
        ...(w && Number(w.before) >= 0 && Number(w.after) >= 0 ? { window: { before: Number(w.before), after: Number(w.after) } } : {}),
        ...(str(o.note) ? { note: str(o.note) } : {}),
        ...(o.off === true ? { off: true } : {}),
      };
    })
    .filter((x): x is MoneyRule => x !== null);
  const lead = Array.isArray(r.leadDays) ? r.leadDays.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 30) : [];
  return {
    ...(str(r.notionPage) ? { notionPage: str(r.notionPage) } : {}),
    ...(str(r.databaseId) ? { databaseId: str(r.databaseId) } : {}),
    ...(str(r.dataSourceId) ? { dataSourceId: str(r.dataSourceId) } : {}),
    recipients: (Array.isArray(r.recipients) ? r.recipients : []).map(String).filter((e) => e.includes("@")),
    leadDays: lead.length ? [...new Set(lead)].sort((a, b) => b - a) : [3, 0],
    rules,
  };
}
