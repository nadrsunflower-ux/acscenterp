// ============================================================
//  월 마감 — 데이터 품질 점검 + 마감 스냅샷
// ------------------------------------------------------------
//  엑셀로 장부를 굴릴 때는 "이 달 다 봤다"가 사람 머릿속에만 있었다.
//  그래서 두 가지가 반복해서 터졌다 —
//    ① 분류가 덜 끝난 달의 리포트를 그대로 보고 판단한다
//    ② 이미 보고한 달의 숫자가 나중에 조용히 바뀐다
//
//  이 파일은 그 둘을 각각 막는다.
//    ① runMonthChecks — 마감 전에 통과해야 할 점검 목록
//    ② monthSnapshot  — 마감 시점의 숫자를 얼려서 저장 → 이후 drift 감지
//
//  ⚠️ 마감은 **쓰기를 막지 않는다.** 회계 시스템이라면 잠그는 게 맞지만,
//     서버에서 막으려면 모든 쓰기 경로가 거래일을 조회해야 해서 원장
//     일괄 저장이 눈에 띄게 느려진다. 대신 마감 때 숫자를 얼려두고
//     이후 바뀌면 **차이를 드러낸다**(snapshotDrift). 실무에서 필요한 건
//     "못 고치게 하는 것"보다 "고쳐졌다는 걸 아는 것"이다.
//
//  점검 항목은 전부 `why`(왜 문제인가)를 함께 들고 다닌다. 근거 없이
//  빨간 숫자만 보여주면 사람은 그냥 무시한다 — 검토 대기함에서 배운 것.
// ============================================================

import { isAllowedTxAccountMismatch } from "./classify";
import { ledgerHref } from "./ledgerLink";
import { netAmount, PL_TX_TYPES, type FinTransaction } from "./types";
import type { FinAccountDoc, FinPaymentMethodDoc } from "./db-types";

/** block 이 하나라도 있으면 마감할 수 없다 */
export type Severity = "block" | "warn" | "info";

export interface CheckGroup {
  label: string;
  count: number;
  amount: number;
  /** 이 묶음만 걸린 원장 */
  href?: string;
}

export interface CheckResult {
  id: string;
  title: string;
  /** 왜 문제인지 — 사람이 납득해야 고친다 */
  why: string;
  severity: Severity;
  count: number;
  amount: number;
  /** 전체 드릴다운 */
  href?: string;
  /** 상위 묶음 (많으면 잘린다) */
  groups: CheckGroup[];
  /** 표시하지 못한 묶음 수 */
  more: number;
}

/** 마감 시점에 얼려둘 숫자 */
export interface CloseSnapshot {
  count: number;
  income: number;
  expense: number;
  refund: number;
  /** 순손익 = 수입 − (지출 − 환급) */
  net: number;
}

export interface MonthCloseDoc {
  /** 문서 id = month */
  id: string;
  /** `YYYY-MM` */
  month: string;
  closedAt: number;
  closedBy: string;
  snapshot: CloseSnapshot;
  note?: string;
}

const MAX_GROUPS = 6;

export const monthOf = (t: FinTransaction) => (t.date ?? "").slice(0, 7);

/** 장부에 있는 달 — 최신순 */
export function monthsOf(transactions: FinTransaction[]): string[] {
  const s = new Set<string>();
  transactions.forEach((t) => {
    const m = monthOf(t);
    if (/^\d{4}-\d{2}$/.test(m)) s.add(m);
  });
  return [...s].sort().reverse();
}

export function monthSnapshot(transactions: FinTransaction[], month: string): CloseSnapshot {
  const rows = transactions.filter((t) => monthOf(t) === month);
  let income = 0;
  let expense = 0;
  let refund = 0;
  rows.forEach((t) => {
    const n = netAmount(t);
    if (t.txType === "수입") income += n;
    else if (t.txType === "지출") expense += n;
    else if (t.txType === "환급") refund += n;
  });
  return { count: rows.length, income, expense, refund, net: income - (expense - refund) };
}

export interface SnapshotDiff {
  label: string;
  before: number;
  after: number;
  delta: number;
}

/** 마감 스냅샷과 현재 값의 차이. 빈 배열이면 마감 후 바뀐 게 없다. */
export function snapshotDrift(saved: CloseSnapshot, current: CloseSnapshot): SnapshotDiff[] {
  const pairs: [string, keyof CloseSnapshot][] = [
    ["거래 건수", "count"],
    ["수입", "income"],
    ["지출", "expense"],
    ["환급", "refund"],
    ["순손익", "net"],
  ];
  return pairs
    .map(([label, key]) => ({
      label,
      before: saved[key] ?? 0,
      after: current[key],
      delta: current[key] - (saved[key] ?? 0),
    }))
    .filter((d) => d.delta !== 0);
}

// ---- 점검 -----------------------------------------------------

interface Bucket {
  count: number;
  amount: number;
  href?: string;
}

/** 묶음 누적기 — 같은 코드를 검사마다 다시 쓰지 않으려고 */
function grouper() {
  const m = new Map<string, Bucket>();
  return {
    add(label: string, t: FinTransaction, href?: string) {
      const b = m.get(label) ?? { count: 0, amount: 0, href };
      b.count += 1;
      b.amount += netAmount(t);
      m.set(label, b);
    },
    /** 건수 많은 순으로 자른 결과 */
    take(): { groups: CheckGroup[]; more: number } {
      const all = [...m.entries()]
        .map(([label, b]) => ({ label, ...b }))
        .sort((a, b) => b.count - a.count);
      return { groups: all.slice(0, MAX_GROUPS), more: Math.max(0, all.length - MAX_GROUPS) };
    },
  };
}

function result(
  base: Omit<CheckResult, "count" | "amount" | "groups" | "more">,
  rows: FinTransaction[],
  g: ReturnType<typeof grouper>,
): CheckResult {
  const { groups, more } = g.take();
  return {
    ...base,
    count: rows.length,
    amount: rows.reduce((s, t) => s + netAmount(t), 0),
    groups,
    more,
  };
}

export interface CheckContext {
  month: string;
  transactions: FinTransaction[];
  accounts: FinAccountDoc[];
  paymentMethods: FinPaymentMethodDoc[];
}

export function runMonthChecks(ctx: CheckContext): CheckResult[] {
  const { month } = ctx;
  const rows = ctx.transactions.filter((t) => monthOf(t) === month);
  const acctPaths = new Set(ctx.accounts.map((a) => `${a.major}|${a.mid}|${a.minor}`));
  const acctTxType = new Map(ctx.accounts.map((a) => [`${a.major}|${a.mid}|${a.minor}`, a.txType]));
  const knownLast4 = new Set(ctx.paymentMethods.map((p) => p.last4));
  const out: CheckResult[] = [];

  // ── ① 검토가 끝나지 않은 거래 ──────────────────────────────
  {
    const hit = rows.filter((t) => t.status !== "confirmed");
    if (hit.length) {
      const g = grouper();
      hit.forEach((t) => g.add(t.status === "suggested" ? "제안됨" : "검토필요", t));
      out.push(
        result(
          {
            id: "pending",
            title: "검토가 끝나지 않은 거래",
            why: "분류가 확정되지 않은 거래가 리포트에 그대로 섞여 들어갑니다.",
            severity: "block",
            href: "/neander/finance/review",
          },
          hit,
          g,
        ),
      );
    }
  }

  // ── ② 계정 미기입 ─────────────────────────────────────────
  {
    const hit = rows.filter((t) => !t.acctMinor);
    if (hit.length) {
      const g = grouper();
      hit.forEach((t) =>
        g.add(t.acctMajor || "(대분류도 없음)", t, ledgerHref({ month, acctMinor: "" })),
      );
      out.push(
        result(
          {
            id: "no-account",
            title: "계정 소분류가 비어 있음",
            why: "계정이 없으면 어느 리포트 줄에도 잡히지 않아 손익에서 통째로 빠집니다.",
            severity: "block",
            href: ledgerHref({ month, acctMinor: "" }),
          },
          hit,
          g,
        ),
      );
    }
  }

  // ── ③ 마스터에 없는 계정 ───────────────────────────────────
  //   개편 전 경로가 남아 있거나 오타. 리포트 트리에 고아 노드로 뜬다.
  {
    const hit = rows.filter(
      (t) => t.acctMinor && !acctPaths.has(`${t.acctMajor}|${t.acctMid}|${t.acctMinor}`),
    );
    if (hit.length) {
      const g = grouper();
      hit.forEach((t) =>
        g.add(
          `${t.acctMajor} > ${t.acctMid} > ${t.acctMinor}`,
          t,
          ledgerHref({
            month,
            acctMajor: t.acctMajor,
            acctMid: t.acctMid,
            acctMinor: t.acctMinor,
          }),
        ),
      );
      out.push(
        result(
          {
            id: "unknown-account",
            title: "계정 마스터에 없는 계정",
            why: "개편 전 경로이거나 오타입니다. 리포트 트리에 고아 줄로 남아 합계가 어긋납니다.",
            severity: "block",
          },
          hit,
          g,
        ),
      );
    }
  }

  // ── ④ 사업구분 미기입 (손익 거래만) ────────────────────────
  {
    const hit = rows.filter(
      (t) => PL_TX_TYPES.includes(t.txType) && !t.bizMajor,
    );
    if (hit.length) {
      const g = grouper();
      hit.forEach((t) =>
        g.add(
          `${t.acctMajor ?? "(미분류)"} > ${t.acctMid ?? ""}`,
          t,
          ledgerHref({ month, acctMajor: t.acctMajor, acctMid: t.acctMid, bizMajor: "" }),
        ),
      );
      out.push(
        result(
          {
            id: "no-biz",
            title: "사업구분이 비어 있음",
            why: "사업부 손익과 공통비 배분에서 빠집니다. 전사 합계는 맞지만 사업부별로는 틀립니다.",
            severity: "warn",
            href: ledgerHref({ month, bizMajor: "" }),
          },
          hit,
          g,
        ),
      );
    }
  }

  // ── ⑤ 거래유형과 계정 성격이 어긋남 ─────────────────────────
  {
    const hit = rows.filter((t) => {
      const at = acctTxType.get(`${t.acctMajor}|${t.acctMid}|${t.acctMinor}`);
      return !!at && at !== t.txType && !isAllowedTxAccountMismatch(t.txType, t.acctMinor, at);
    });
    if (hit.length) {
      const g = grouper();
      hit.forEach((t) => {
        const at = acctTxType.get(`${t.acctMajor}|${t.acctMid}|${t.acctMinor}`);
        g.add(`${t.txType} 인데 계정은 ${at} (${t.acctMinor})`, t, ledgerHref({ month, acctMinor: t.acctMinor }));
      });
      out.push(
        result(
          {
            id: "tx-mismatch",
            title: "거래유형과 계정이 어긋남",
            why: "수입 계정에 지출이 달리면 부호가 뒤집혀 손익이 두 배로 틀어집니다.",
            severity: "warn",
          },
          hit,
          g,
        ),
      );
    }
  }

  // ── ⑥ 중복 의심 ───────────────────────────────────────────
  //   같은 날 · 같은 금액 · 같은 거래처 · **같은 결제수단**이 두 건 이상.
  //
  //   처음엔 결제수단을 빼고 봤더니 55건이 걸렸는데, 뜯어보니 절반이
  //   가짜였다 —
  //     · 자금거래는 이체출금·이체입금을 **양쪽 다** 기록한다. 같은 날
  //       같은 금액 같은 상대가 두 줄 나오는 게 설계다. (24건 2.84억)
  //     · 같은 가게에서 두 사람이 각자 카드로 계산하면 뒷 4자리가 다르다.
  //   그래서 자금거래를 빼고 결제수단까지 같은 것만 남긴다.
  {
    const byKey = new Map<string, FinTransaction[]>();
    rows.forEach((t) => {
      if (!t.vendor || !t.gross) return;
      if (t.txType === "자금거래") return;
      const k = `${t.date}|${t.gross}|${t.vendor}|${t.last4 ?? ""}`;
      byKey.set(k, [...(byKey.get(k) ?? []), t]);
    });
    const dupes = [...byKey.values()].filter((v) => v.length > 1);
    const hit = dupes.flat();
    if (hit.length) {
      const g = grouper();
      dupes.forEach((v) =>
        v.forEach((t) =>
          g.add(`${t.date} ${t.vendor} ×${v.length}`, t, ledgerHref({ month, vendor: t.vendor })),
        ),
      );
      out.push(
        result(
          {
            id: "dup",
            title: "중복 의심",
            why: "같은 날·같은 금액·같은 거래처를 같은 카드로 두 번 결제했습니다. 같은 파일을 두 번 올리면 생깁니다.",
            severity: "warn",
          },
          hit,
          g,
        ),
      );
    }
  }

  // ── ⑦ 마스터에 없는 결제수단 ────────────────────────────────
  {
    const hit = rows.filter((t) => t.last4 && !knownLast4.has(t.last4));
    if (hit.length) {
      const g = grouper();
      hit.forEach((t) => g.add(`뒷 4자리 ${t.last4}`, t));
      out.push(
        result(
          {
            id: "unknown-last4",
            title: "마스터에 없는 계좌·카드",
            why: "현금흐름 기준 집계는 결제수단 종류(통장/카드/현금)로 갈립니다. 마스터에 없으면 어느 쪽에도 못 넣습니다.",
            severity: "warn",
          },
          hit,
          g,
        ),
      );
    }
  }

  // ── ⑧ 거래처 미기입 ────────────────────────────────────────
  {
    const hit = rows.filter((t) => !t.vendor);
    if (hit.length) {
      const g = grouper();
      hit.forEach((t) => g.add(t.acctMinor || "(계정 없음)", t));
      out.push(
        result(
          {
            id: "no-vendor",
            title: "거래처가 비어 있음",
            why: "자동분류는 거래처로 배웁니다. 비어 있으면 다음 달에도 같은 거래를 손으로 분류해야 합니다.",
            severity: "info",
          },
          hit,
          g,
        ),
      );
    }
  }

  // ── ⑨ 금액 0원 ─────────────────────────────────────────────
  {
    const hit = rows.filter((t) => netAmount(t) === 0);
    if (hit.length) {
      const g = grouper();
      hit.forEach((t) => g.add(t.acctMinor || "(계정 없음)", t));
      out.push(
        result(
          {
            id: "zero",
            title: "순금액이 0원",
            why: "전액 취소·환불이면 정상이지만, 임포트가 금액 칸을 못 읽은 경우일 수도 있습니다.",
            severity: "info",
          },
          hit,
          g,
        ),
      );
    }
  }

  const rank: Record<Severity, number> = { block: 0, warn: 1, info: 2 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity] || b.count - a.count);
}

/** 마감을 막는 항목이 있는가 */
export const blockingChecks = (checks: CheckResult[]) =>
  checks.filter((c) => c.severity === "block");
