// ============================================================
//  원장 탭 — 결제수단 종류로 나눠 보기
// ------------------------------------------------------------
//  「전체 · 계좌 · 법인카드 · 현금」. 열 필터와 다른 축이라 필터가 아니라
//  **보기(view)** 로 둔다 — 열 필터로 만들면 계좌 12개의 뒷 4자리가
//  필터 칩에 줄줄이 늘어서고, 사용자가 직접 건 계좌 필터와 섞여 버린다.
//
//  구분은 결제수단 마스터의 `kind` 다. 별칭의 (신법)·(국법) 은 신한법인·
//  국민법인이고 뒤의 이름은 소지자다 — 개인 카드가 아니다. 그래서 카드
//  14장이 곧 법인카드다. 개인 명의 카드(대납)가 생기면 personal 로
//  갈라지므로 그때 탭을 하나 더 두면 된다.
//
//  ⚠️ 탭은 **빠짐없이 나뉘어야 한다.** 계좌/카드만 두면 현금 52건과
//     마스터에 없는 결제수단이 어느 탭에도 안 보이면서 「전체」 건수와만
//     어긋난다. 조용히 사라지는 돈이 재무에서 가장 나쁘다. 그래서 현금도
//     탭으로 두고, 남는 것은 「미지정」으로 드러낸다.
// ============================================================

import type { FinTransaction } from "./types";
import type { FinPaymentMethodDoc } from "./db-types";

export type ScopeKey = "all" | "account" | "card" | "cash" | "unknown";

export interface ScopeTab {
  key: ScopeKey;
  label: string;
  hint: string;
}

export const SCOPE_TABS: ScopeTab[] = [
  { key: "all", label: "전체", hint: "모든 결제수단" },
  { key: "account", label: "계좌", hint: "법인 통장 — 결제 시점이 곧 출금 시점" },
  { key: "card", label: "법인카드", hint: "사용 시점과 카드대금 출금 시점이 다르다" },
  { key: "cash", label: "현금", hint: "사무실 현금" },
  { key: "unknown", label: "미지정", hint: "결제수단 마스터에 없거나 비어 있는 거래" },
];

/** 뒷 4자리 → 결제수단 */
export const paymentIndex = (pms: FinPaymentMethodDoc[]) =>
  new Map(pms.map((p) => [p.last4, p]));

/** 이 거래가 속한 탭 (all 은 반환하지 않는다) */
export function scopeOf(
  t: FinTransaction,
  index: Map<string, FinPaymentMethodDoc>,
): Exclude<ScopeKey, "all"> {
  const pm = t.last4 ? index.get(t.last4) : undefined;
  if (!pm) return "unknown";
  return pm.kind === "card" ? "card" : pm.kind === "cash" ? "cash" : "account";
}

export const inScope = (
  t: FinTransaction,
  scope: ScopeKey,
  index: Map<string, FinPaymentMethodDoc>,
) => scope === "all" || scopeOf(t, index) === scope;

/** 탭에 붙일 건수. 「전체」는 합계 — 나머지 합과 반드시 같다. */
export function scopeCounts(
  rows: FinTransaction[],
  index: Map<string, FinPaymentMethodDoc>,
): Record<ScopeKey, number> {
  const out: Record<ScopeKey, number> = { all: rows.length, account: 0, card: 0, cash: 0, unknown: 0 };
  rows.forEach((t) => {
    out[scopeOf(t, index)] += 1;
  });
  return out;
}
