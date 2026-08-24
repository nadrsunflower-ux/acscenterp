// ============================================================
//  공통비 배분 — 사업부 손익을 "진짜" 손익으로
// ------------------------------------------------------------
//  공용·홍대공용에 쌓인 비용은 어느 사업부에도 귀속돼 있지 않다. 그래서
//  와우·아이디의 흑자는 공통비를 빼기 전 숫자다. 이걸 나눠 실어야
//  "이 사업부가 돈을 버는가"에 답할 수 있다.
//
//  ⚠️ 배분은 사실이 아니라 **경영 판단**이다. 드라이버(무엇에 비례해 나눌
//     것인가)를 바꾸면 사업부 손익이 통째로 달라진다. 그래서
//     ① 규칙은 기본 비활성이고,
//     ② 화면은 항상 배분 전/후를 함께 보여주며,
//     ③ 어떤 규칙이 얼마를 어디로 보냈는지 줄 단위로 남긴다.
//     조용히 재해석하지 않는 것이 이 파일의 유일한 원칙이다.
// ============================================================

import type { FinAllocationDoc } from "./db-types";
import { inBasis, inScope, type Basis } from "./report";
import { netAmount, type FinTransaction } from "./types";

export const unitKeyOf = (bizMajor?: string, bizMinor?: string) =>
  `${bizMajor || "(미정)"}|${bizMinor || "(미정)"}`;

export interface UnitTotals {
  key: string;
  bizMajor: string;
  bizMinor: string;
  income: number;
  /** 지출 − 환급 */
  expense: number;
  /** 임직원 개인 사용분 */
  personal: number;
  /** 회사가 실제로 부담한 비용 = 지출 − 환급 − 개인사용. **배분 대상** */
  cost: number;
  /** 순손익 = 수입 − 비용. report.ts 의 ReportValue.net 과 같은 정의 */
  net: number;
  count: number;
}

/**
 * 사업부별 합계를 한 번에 훑는다. 사업부마다 buildReport 를 돌리면
 * 거래를 사업부 수만큼 반복해서 읽게 되므로 여기서는 한 번만 돈다.
 */
export function unitTotals(
  transactions: FinTransaction[],
  opts: { basis: Basis; isCard: (last4?: string) => boolean; month?: string },
): UnitTotals[] {
  const map = new Map<string, UnitTotals>();
  transactions.forEach((t) => {
    if (!inScope(t, { month: opts.month })) return;
    if (!inBasis(t, opts.basis, opts.isCard)) return;
    const bizMajor = t.bizMajor || "(미정)";
    const bizMinor = t.bizMinor || "(미정)";
    const key = unitKeyOf(bizMajor, bizMinor);
    if (!map.has(key)) {
      map.set(key, {
        key, bizMajor, bizMinor,
        income: 0, expense: 0, personal: 0, cost: 0, net: 0, count: 0,
      });
    }
    const u = map.get(key)!;
    const n = netAmount(t);
    u.count += 1;
    if (t.txType === "수입") u.income += n;
    else if (t.txType === "환급") u.expense -= n;
    else {
      u.expense += n;
      if (t.personalUse) u.personal += n;
    }
  });
  map.forEach((u) => {
    u.cost = u.expense - u.personal;
    u.net = u.income - u.cost;
  });
  return [...map.values()];
}

// ---- 배분 ------------------------------------------------------

export interface AllocationLine {
  rule: string;
  from: string;
  to: string;
  share: number;
  amount: number;
}

export interface AllocationOutcome {
  lines: AllocationLine[];
  /** 사업부 key → 순손익 조정액. 비용을 받으면 음수, 내보내면 양수 */
  delta: Record<string, number>;
  /** 사업부 key → 받은 비용 (표시용) */
  received: Record<string, number>;
  /** 사업부 key → 내보낸 비용 */
  given: Record<string, number>;
  /** 건너뛴 규칙의 이유 — 조용히 넘어가지 않는다 */
  warnings: string[];
  /** 실제로 적용된 규칙 수 */
  applied: number;
}

const EMPTY: AllocationOutcome = {
  lines: [],
  delta: {},
  received: {},
  given: {},
  warnings: [],
  applied: 0,
};

/**
 * 규칙 순서를 정한다.
 *
 * 한 규칙의 원천이 다른 규칙의 대상이면 뒤에 와야 한다 — 공용이 홍대공용에
 * 비용을 실어준 다음에 홍대공용이 와우·아이디로 내보내야 제대로 흘러간다.
 * 서로 물고 물리면(순환) 원래 순서를 쓰고 경고를 남긴다.
 */
function orderRules(rules: FinAllocationDoc[]): { ordered: FinAllocationDoc[]; warning?: string } {
  const sourceOf = new Map<string, FinAllocationDoc[]>();
  rules.forEach((r) => {
    const key = unitKeyOf(r.fromMajor, r.fromMinor);
    if (!sourceOf.has(key)) sourceOf.set(key, []);
    sourceOf.get(key)!.push(r);
  });

  const ordered: FinAllocationDoc[] = [];
  const done = new Set<FinAllocationDoc>();
  const visiting = new Set<FinAllocationDoc>();
  let cyclic = false;

  const visit = (rule: FinAllocationDoc) => {
    if (done.has(rule)) return;
    if (visiting.has(rule)) {
      cyclic = true;
      return;
    }
    visiting.add(rule);
    // 이 규칙의 대상이 원천인 규칙들을 **나중에** 두려면, 먼저 이 규칙을 넣어야 한다.
    // 반대로 이 규칙의 원천으로 흘러드는 규칙은 먼저 실행돼야 한다.
    rules.forEach((other) => {
      if (other === rule) return;
      const otherTargets = other.targets;
      const myKey = unitKeyOf(rule.fromMajor, rule.fromMinor);
      const feedsMe = otherTargets
        ? otherTargets.includes(myKey)
        : unitKeyOf(other.fromMajor, other.fromMinor) !== myKey; // targets 미지정 = 전부
      if (feedsMe) visit(other);
    });
    visiting.delete(rule);
    done.add(rule);
    ordered.push(rule);
  };

  rules.forEach(visit);
  return {
    ordered: cyclic ? rules : ordered,
    warning: cyclic
      ? "배분 규칙이 서로 물려 있어(순환) 등록 순서대로 적용했습니다. 규칙의 대상에서 서로를 빼세요."
      : undefined,
  };
}

/** 반올림 잔차는 가장 큰 항목에 몰아준다 (엑셀 OpenRouter배분 시트와 같은 규칙) */
function splitAmount(pool: number, weights: { key: string; w: number }[]): { key: string; share: number; amount: number }[] {
  const total = weights.reduce((s, x) => s + x.w, 0);
  if (total <= 0) return [];
  const out = weights.map((x) => ({
    key: x.key,
    share: x.w / total,
    amount: Math.round((pool * x.w) / total),
  }));
  const residual = Math.round(pool) - out.reduce((s, x) => s + x.amount, 0);
  if (residual !== 0 && out.length > 0) {
    const biggest = out.reduce((a, b) => (b.amount > a.amount ? b : a));
    biggest.amount += residual;
  }
  return out.filter((x) => x.amount !== 0);
}

/**
 * 배분 실행.
 *
 * 계정을 지정한 규칙(`acctMajors`)은 **원본 거래**에서만 풀을 잡는다 —
 * 다른 규칙에서 배분받은 금액에는 계정이 없어서 "인건비만" 같은 조건을
 * 걸 수 없기 때문이다. 계정을 지정하지 않은 규칙은 배분받은 금액까지
 * 포함해 다시 내보낸다(연쇄).
 */
export function allocate(opts: {
  transactions: FinTransaction[];
  units: UnitTotals[];
  rules: FinAllocationDoc[];
  basis: Basis;
  isCard: (last4?: string) => boolean;
  month?: string;
}): AllocationOutcome {
  const active = opts.rules.filter((r) => r.active);
  if (active.length === 0) return EMPTY;

  const byKey = new Map(opts.units.map((u) => [u.key, u]));
  const { ordered, warning } = orderRules(active);
  const warnings: string[] = warning ? [warning] : [];

  const received: Record<string, number> = {};
  const given: Record<string, number> = {};
  const lines: AllocationLine[] = [];
  let applied = 0;

  ordered.forEach((rule) => {
    const fromKey = unitKeyOf(rule.fromMajor, rule.fromMinor);
    const from = byKey.get(fromKey);
    if (!from) {
      warnings.push(`「${rule.name}」 — 원천 사업부 ${fromKey} 에 이 달 거래가 없어 건너뜁니다.`);
      return;
    }

    // 풀 계산
    let pool: number;
    if (rule.acctMajors?.length) {
      pool = opts.transactions
        .filter(
          (t) =>
            inScope(t, { month: opts.month, bizMajor: rule.fromMajor, bizMinor: rule.fromMinor }) &&
            inBasis(t, opts.basis, opts.isCard) &&
            rule.acctMajors!.includes(t.acctMajor ?? "") &&
            (t.txType === "지출" || t.txType === "카드대금결제" || t.txType === "환급"),
        )
        .reduce(
          (s, t) =>
            s +
            (t.txType === "환급" ? -netAmount(t) : t.personalUse ? 0 : netAmount(t)),
          0,
        );
    } else {
      pool = from.cost + (received[fromKey] ?? 0) - (given[fromKey] ?? 0);
    }
    if (pool <= 0) {
      warnings.push(`「${rule.name}」 — 배분할 비용이 0 이라 건너뜁니다.`);
      return;
    }

    // 대상과 가중치
    const targetKeys = (rule.targets?.length
      ? rule.targets
      : opts.units.map((u) => u.key)
    ).filter((k) => k !== fromKey);

    const weights = targetKeys
      .map((k) => {
        const u = byKey.get(k);
        if (!u) return null;
        const w =
          rule.driver === "fixed"
            ? (rule.shares?.[k] ?? 0)
            : rule.driver === "expense"
              ? u.cost
              : u.income;
        return { key: k, w: Math.max(0, w) };
      })
      .filter((x): x is { key: string; w: number } => x !== null);

    const split = splitAmount(pool, weights);
    if (split.length === 0) {
      const why =
        rule.driver === "fixed"
          ? "고정 비율이 지정되지 않았습니다"
          : rule.driver === "revenue"
            ? "대상 사업부의 수입이 전부 0 입니다"
            : "대상 사업부의 지출이 전부 0 입니다";
      warnings.push(`「${rule.name}」 — ${why}. 균등 분할하지 않고 건너뜁니다.`);
      return;
    }

    split.forEach((x) => {
      received[x.key] = (received[x.key] ?? 0) + x.amount;
      lines.push({ rule: rule.name, from: fromKey, to: x.key, share: x.share, amount: x.amount });
    });
    given[fromKey] = (given[fromKey] ?? 0) + split.reduce((s, x) => s + x.amount, 0);
    applied += 1;
  });

  const delta: Record<string, number> = {};
  Object.keys({ ...received, ...given }).forEach((k) => {
    // 비용을 받으면 순손익이 그만큼 나빠지고, 내보내면 좋아진다
    delta[k] = (given[k] ?? 0) - (received[k] ?? 0);
  });

  return { lines, delta, received, given, warnings, applied };
}
