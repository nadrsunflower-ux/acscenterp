// ============================================================
//  묶음으로 묻기 — 같은 답으로 풀리는 거래를 한 번에
// ------------------------------------------------------------
//  대기함은 날짜순이라 같은 거래처의 같은 질문이 여기저기 흩어져 있다. 사람은 같은
//  답을 열 번 누른다. 그런데 틀린 분류의 절반 가까이는 몇 안 되는 가맹점 묶음에
//  몰려 있다 (Digits 2026 벤치마크: 오류의 40~56% 가 상위 10개 가맹점 묶음).
//
//  그래서 대기함을 (이름 뼈대 × 계좌 × 들어온/나간 돈 × 금액대)로 묶고, **같은 답으로
//  풀리는 건수가 많은 묶음부터** 묻는다. 묶음마다 후보는 둘 —
//    · 엔진의 제안 (묶음 안 행들이 같은 제안을 들고 있을 때)
//    · 과거 이력의 분류들 (classify.ts 의 classCandidates — 누를 수 있는 것)
//  하나를 누르면 묶음 전체가 그 분류로 확정된다.
//
//  금액대를 나누는 이유: 같은 「이동주」 라도 14,900원은 구독료, 70만원은 대납 정산이다.
// ============================================================

import { classCandidates, normVendor, vendorFamily, type ClassCandidate, type ClassifyContext } from "./classify";
import { bankTypeOf, ledgerPartial } from "./relearn";
import { netAmount, type FinTransaction } from "./types";

/** 금액대 — 자릿수로 (1만 미만 · 10만 미만 · 100만 미만 · 그 이상) */
const bandOf = (amount: number) => {
  const a = Math.abs(amount);
  return a < 10_000 ? "1만 미만" : a < 100_000 ? "1만~10만" : a < 1_000_000 ? "10만~100만" : "100만 이상";
};

export interface ReviewGroup {
  key: string;
  /** 묶음에서 가장 많이 나온 거래처 이름 */
  vendor: string;
  /** 이름이 여럿이면 몇 가지 */
  names: number;
  last4?: string;
  flow: "in" | "out";
  band: string;
  rows: FinTransaction[];
  amount: number;
  from: string;
  to: string;
  /** 묶음 안 행들이 모두 같은 계정을 제안받았으면 그 제안 */
  proposal?: ClassCandidate;
  /** 과거 이력의 분류들 */
  candidates: ClassCandidate[];
  /** 무엇을 보고 뽑은 후보인가 */
  basis?: string;
}

const flowOf = (t: FinTransaction) => {
  const b = bankTypeOf(t);
  return b === "수입" || b === "환급" ? "in" : "out";
};

/**
 * 대기 건을 묶는다. 두 건 이상인 묶음만, 큰 것부터 (같으면 금액이 큰 것부터).
 * 거래처가 비어 있는 행은 묶지 않는다 — 무엇을 같다고 볼지 근거가 없다.
 */
export function groupPending(rows: FinTransaction[], ctx: ClassifyContext): ReviewGroup[] {
  const m = new Map<string, FinTransaction[]>();
  rows.forEach((t) => {
    const v = normVendor(t.vendor);
    if (!v) return;
    const key = [vendorFamily(v), t.last4 ?? "", flowOf(t), bandOf(netAmount(t))].join("¦");
    m.set(key, [...(m.get(key) ?? []), t]);
  });
  const out: ReviewGroup[] = [];
  m.forEach((list, key) => {
    if (list.length < 2) return;
    const names = new Map<string, number>();
    list.forEach((t) => names.set(t.vendor ?? "", (names.get(t.vendor ?? "") ?? 0) + 1));
    const vendor = [...names.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const head = list[0];
    // 엔진의 제안 — 모두 같은 계정을 들고 있을 때만
    const withAcct = list.filter((t) => t.acctMinor);
    const same =
      withAcct.length === list.length &&
      withAcct.every(
        (t) =>
          t.txType === head.txType &&
          t.acctMajor === head.acctMajor &&
          t.acctMid === head.acctMid &&
          t.acctMinor === head.acctMinor,
      );
    const bizSame = same && list.every((t) => t.bizMinor && t.bizMajor === head.bizMajor && t.bizMinor === head.bizMinor);
    const partial = ledgerPartial(head);
    const found = classCandidates(
      { vendor: head.vendor, last4: head.last4, txType: bankTypeOf(head), acctMajor: partial.acctMajor, acctMid: partial.acctMid },
      ctx,
    );
    const dates = list.map((t) => t.date).sort();
    out.push({
      key,
      vendor,
      names: names.size,
      last4: head.last4,
      flow: flowOf(head),
      band: key.split("¦")[3],
      rows: list,
      amount: list.reduce((s, t) => s + netAmount(t), 0),
      from: dates[0],
      to: dates[dates.length - 1],
      proposal: same
        ? {
            txType: head.txType,
            acctMajor: head.acctMajor!,
            acctMid: head.acctMid!,
            acctMinor: head.acctMinor!,
            ...(bizSame ? { bizMajor: head.bizMajor, bizMinor: head.bizMinor } : {}),
            count: list.length,
          }
        : undefined,
      candidates: (found?.items ?? []).filter(
        (c) => !same || c.acctMinor !== head.acctMinor || c.acctMid !== head.acctMid || c.txType !== head.txType,
      ),
      basis: found?.basis,
    });
  });
  return out.sort((a, b) => b.rows.length - a.rows.length || Math.abs(b.amount) - Math.abs(a.amount));
}
