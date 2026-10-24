// ============================================================
//  정기 지출 — 매달 나가는 돈을 찾아 다음 날을 내다보고, 빠지면 알린다
// ------------------------------------------------------------
//  구독 화면(report.ts)은 구독 계정 안에서만 「결제 없음」 을 본다. 그런데 매달
//  나가야 하는 돈은 구독만이 아니다 — 월세 · 급여 · 4대보험 · 원천세 · 보험료 · 대출 이자.
//  이 돈이 한 달 빠지면 연체 · 가산세가 붙거나, 거꾸로 장부에 안 올라온 것이다.
//
//  찾는 방법은 단순 규칙이다 (Plaid 의 recurring 과 같은 결):
//    · 같은 거래처(이름 뼈대) · 같은 계좌의 나간 돈이
//    · 최근 8개월 중 3달 이상 (해마다 나가는 것은 2번 이상, 11~13개월 간격)
//    · 달마다 날짜가 ±6일 안에서 · 금액이 가운데 값의 ±15% 안에서
//  그러면 다음 날 = 마지막 달 + 1달의 그 날짜.
//
//  「빠짐」 판정은 조심한다. 은행 내역은 매달 엑셀로 올라오므로, 그 계좌의 내역이
//  **다음 날 뒤까지 올라와 있을 때만** 빠졌다고 본다. 안 그러면 아직 안 올린 달의
//  정기 지출이 전부 「빠짐」 이 된다.
//
//  카드값(카드대금결제)은 금액이 매달 달라 여기서 잡지 않는다. 현금 예측은 런웨이(runway.ts)가
//  한다 — 여기는 「빠진 것」 을 찾는 데 쓴다 (자동 처리 · 월 마감 · 대시보드).
// ============================================================

import { normVendor, vendorFamily } from "./classify";
import type { FinPaymentMethodDoc } from "./db-types";
import { netAmount, type FinTransaction } from "./types";

const LOOKBACK_MONTHS = 8;
const MIN_MONTHS = 3;
const DAY_SPREAD = 6;
const AMOUNT_SPREAD = 0.15;
/** 다음 날에서 이만큼 지나도 없으면 빠진 것 (자동이체가 하루 이틀 밀리는 일이 있다) */
const GRACE_DAYS = 5;

export type RecurringCadence = "monthly" | "yearly";
export type RecurringStatus = "active" | "missing" | "ended" | "waiting";

export interface RecurringSeries {
  key: string;
  vendor: string;
  last4?: string;
  alias?: string;
  /** 통장 · 카드 */
  via: "account" | "card" | "other";
  cadence: RecurringCadence;
  /** 계정 소분류 (가장 최근) — 월세 · 급여 · 보험 … */
  acctMinor?: string;
  acctMajor?: string;
  /** 가운데 값 */
  amount: number;
  /** 달마다의 날 (가운데 값) */
  day: number;
  /** 본 달 (오래된 것부터) */
  months: string[];
  lastDate: string;
  /** 다음에 나갈 날 */
  nextDate: string;
  status: RecurringStatus;
  /** 그 계좌 내역이 어디까지 올라왔나 */
  coveredTo?: string;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};

const addMonths = (month: string, n: number) => {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};
const lastDay = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};
/** 그 달의 그 날 — 짧은 달이면 말일 */
export const dateIn = (month: string, day: number) => `${month}-${String(Math.min(day, lastDay(month))).padStart(2, "0")}`;
const addDays = (date: string, n: number) => new Date(Date.parse(date) + n * 86_400_000).toISOString().slice(0, 10);

/** 나간 돈인가 — 정기 지출로 볼 거래 (카드값 · 계좌 간 이동은 뺀다) */
const isOutflow = (t: FinTransaction) => t.txType === "지출" && netAmount(t) > 0;

/**
 * 정기 지출을 찾는다. `today` 기준으로 다음 날 · 빠짐을 판정한다.
 * 같은 거래처라도 금액대가 다르면(월세 · 관리비) 따로 본다 — 가운데 값에서 15% 를 넘게
 * 벗어난 달은 그 줄에서 뺀다.
 */
export function detectRecurring(
  transactions: FinTransaction[],
  paymentMethods: FinPaymentMethodDoc[],
  today: string,
): RecurringSeries[] {
  const thisMonth = today.slice(0, 7);
  const since = addMonths(thisMonth, -LOOKBACK_MONTHS);
  const yearSince = addMonths(thisMonth, -26);
  const pm = new Map(paymentMethods.map((p) => [p.last4, p]));
  // 계좌마다 내역이 어디까지 올라왔나 — 빠짐 판정의 바닥
  const coveredTo = new Map<string, string>();
  transactions.forEach((t) => {
    if (!t.last4) return;
    if ((coveredTo.get(t.last4) ?? "") < t.date) coveredTo.set(t.last4, t.date);
  });

  const groups = new Map<string, FinTransaction[]>();
  transactions.forEach((t) => {
    if (!isOutflow(t) || (t.date ?? "") < yearSince) return;
    const v = normVendor(t.vendor);
    if (!v) return;
    const k = `${vendorFamily(v)}¦${t.last4 ?? ""}`;
    groups.set(k, [...(groups.get(k) ?? []), t]);
  });

  const out: RecurringSeries[] = [];
  groups.forEach((rows, key) => {
    rows.sort((a, b) => a.date.localeCompare(b.date));
    const head = rows[rows.length - 1];
    const method = head.last4 ? pm.get(head.last4) : undefined;
    const base = {
      vendor: head.vendor ?? "",
      last4: head.last4,
      alias: method?.alias,
      via: (method?.kind === "account" ? "account" : method?.kind === "card" ? "card" : "other") as RecurringSeries["via"],
      acctMinor: head.acctMinor,
      acctMajor: head.acctMajor,
    };
    const cover = head.last4 ? coveredTo.get(head.last4) : undefined;
    const statusOf = (next: string, cyclesLate: number): RecurringStatus => {
      if (!cover || cover < addDays(next, GRACE_DAYS)) return next < today ? "waiting" : "active";
      return cyclesLate >= 2 ? "ended" : "missing";
    };

    // ---- 매달 ----
    const recent = rows.filter((t) => t.date.slice(0, 7) >= since);
    const amt = median(recent.map(netAmount));
    const near = recent.filter((t) => Math.abs(netAmount(t) - amt) <= amt * AMOUNT_SPREAD);
    // 달마다 한 건 — 가운데 값에 가장 가까운 것
    const byMonth = new Map<string, FinTransaction>();
    near.forEach((t) => {
      const m = t.date.slice(0, 7);
      const cur = byMonth.get(m);
      if (!cur || Math.abs(netAmount(t) - amt) < Math.abs(netAmount(cur) - amt)) byMonth.set(m, t);
    });
    const months = [...byMonth.keys()].sort();
    if (months.length >= MIN_MONTHS) {
      const days = months.map((m) => Number(byMonth.get(m)!.date.slice(8, 10)));
      const day = median(days);
      // 말일 즈음(28~31)은 같은 날로 본다 — 짧은 달은 28일에 나간다
      const spread = days.map((d) => (day >= 28 && d >= 26 ? 0 : Math.abs(d - day)));
      // 한 달 쉰 달이 하나 있어도 된다 (명절 · 공휴일로 다음 달 초에 몰린 경우)
      const gaps = months.slice(1).map((m, i) => {
        const [y1, m1] = months[i].split("-").map(Number);
        const [y2, m2] = m.split("-").map(Number);
        return (y2 - y1) * 12 + (m2 - m1);
      });
      if (Math.max(...spread) <= DAY_SPREAD && gaps.filter((g) => g > 1).length <= 1 && gaps.every((g) => g <= 2)) {
        const last = months[months.length - 1];
        let next = dateIn(addMonths(last, 1), day);
        let late = 0;
        // 이미 지난 다음 날이 내역에도 없으면 한 번 더 넘긴다 (몇 번 빠졌나를 센다)
        while (next < today && cover && cover >= addDays(next, GRACE_DAYS) && late < 3) {
          late += 1;
          next = dateIn(addMonths(next.slice(0, 7), 1), day);
        }
        const firstMissed = late > 0 ? dateIn(addMonths(last, 1), day) : next;
        out.push({
          key: `m¦${key}`,
          ...base,
          cadence: "monthly",
          amount: amt,
          day,
          months,
          lastDate: byMonth.get(last)!.date,
          nextDate: late > 0 ? firstMissed : next,
          status: late > 0 ? (late >= 2 ? "ended" : "missing") : statusOf(next, 0),
          coveredTo: cover,
        });
        return;
      }
    }

    // ---- 해마다 ---- (도메인 · 보험 · 연간 구독)
    if (rows.length >= 2) {
      const a = rows[rows.length - 2];
      const b = rows[rows.length - 1];
      const gap = (Date.parse(b.date) - Date.parse(a.date)) / 86_400_000;
      // 해마다는 두 번만 보고 정하므로 엄하게 — 금액이 거의 같고(±1%), 밥값 · 소모품처럼
      // 우연히 1년 만에 다시 간 곳은 뺀다 (식당에 두 번 간 것이 「연간 결제」 가 되던 것)
      const close = Math.abs(netAmount(a) - netAmount(b)) <= Math.max(netAmount(a), netAmount(b)) * 0.01;
      const casual = /식대|회식|소모품|교통|주유|택시|미팅|간식/.test(`${b.acctMid ?? ""} ${b.acctMinor ?? ""}`);
      if (gap >= 335 && gap <= 395 && close && !casual && netAmount(b) >= 1_000) {
        const next = dateIn(addMonths(b.date.slice(0, 7), 12), Number(b.date.slice(8, 10)));
        out.push({
          key: `y¦${key}`,
          ...base,
          cadence: "yearly",
          amount: Math.round((netAmount(a) + netAmount(b)) / 2),
          day: Number(b.date.slice(8, 10)),
          months: [a.date.slice(0, 7), b.date.slice(0, 7)],
          lastDate: b.date,
          nextDate: next,
          status: statusOf(next, 0),
          coveredTo: cover,
        });
      }
    }
  });
  const rank: Record<RecurringStatus, number> = { missing: 0, waiting: 1, active: 2, ended: 3 };
  return out.sort((a, b) => rank[a.status] - rank[b.status] || b.amount - a.amount);
}

export const RECURRING_STATUS_LABEL: Record<RecurringStatus, string> = {
  active: "예정",
  waiting: "내역 기다리는 중",
  missing: "빠짐",
  ended: "끊김",
};
