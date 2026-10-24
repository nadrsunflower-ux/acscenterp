// ============================================================
//  확정 → 규칙 제안 — 사람이 같은 답을 세 번 하면 네 번째부터는 묻지 않는다
// ------------------------------------------------------------
//  분류 규칙(class-rules.ts)은 재무 비서에게 말해야만 생겼다. 2026-10-02 시험 뒤
//  운영에 저장된 규칙은 0개 — 장치는 있는데 아무도 쓰지 않았다. 사람은 대기함에서
//  확정을 누르고 있었고, 그 순간이 규칙을 만들 가장 좋은 때다.
//
//  사람이 한 건을 확정하면 이렇게 본다.
//    · 같은 이름 뼈대 (`2608고용보험` → 「고용보험」) · 같은 계좌 · 같은 방향의
//      최근 확정 3건이 모두 같은 계정이고, 최근 12건의 90% 이상이 그 계정이다
//    · 그런데 엔진은 다음 같은 거래를 아직 스스로 확정하지 못한다
//      (이미 확정한다면 규칙은 일만 늘린다)
//    · 같은 결과의 규칙이 이미 없다
//  그러면 규칙 초안과 **지금 장부에서 닿는 범위**를 같이 보여 준다 (previewClassRule).
//  다른 계정으로 확정된 거래에 닿으면 키워드가 넓다는 뜻이라 제안하지 않는다.
//
//  사업구분까지 한결같으면 「바로 확정」, 갈리면 사업구분 없이 「제안」 규칙이다 —
//  사업구분이 빈 손익 거래를 확정하면 월 마감이 다시 잡는다.
//
//  ⚠️ 저장은 사람이 누른다. 누르면 대기함의 엔진 소유 행은 계속 배우기가 규칙대로
//     다시 분류한다 — 이미 확정된 거래는 건드리지 않는다 (소급하지 않는다).
// ============================================================

import {
  classifyOne,
  normVendor,
  vendorFamily,
  type ClassifyContext,
} from "./classify";
import {
  describeRuleCondition,
  describeRuleResult,
  flowOfAccount,
  flowOfTxType,
  matchClassRule,
  previewClassRule,
  ruleHits,
  ruleKey,
  type FinClassRule,
  type FinClassRuleDoc,
  type RulePreview,
} from "./class-rules";
import { bankTypeOf, isEngineOwned } from "./relearn";
import type { FinTransaction } from "./types";

/** 최근 몇 건이 모두 같아야 하는가 · 최근 몇 건 중 얼마가 같아야 하는가 */
const STREAK = 3;
const RECENT = 12;
const MIN_RECENT_RATIO = 0.9;

/** 거래처 이름 → 규칙 키워드. 날짜 · 일련번호 · 결제 코드를 걷어낸다 (classify.ts 의 이름 뼈대) */
export function keywordOf(vendor?: string): string {
  return vendorFamily(normVendor(vendor))
    .replace(/[#*]/g, " ")
    .replace(/[()\[\]_]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface RuleSuggestion {
  /** 조건 열쇠 — 「이번엔 아니오」 를 기억하는 데 쓴다 */
  key: string;
  rule: FinClassRule;
  condition: string;
  result: string;
  preview: RulePreview;
  /** 근거 — 최근 확정이 몇 건 연속 같았나 */
  streak: number;
  /** 겹치는 기존 규칙 (다른 결과) — 더 구체적인 이 규칙이 이긴다 */
  overlaps: { id: string; keyword: string; result: string }[];
  /** 저장하면 대기함에서 바로 따라올 것 (엔진 소유 행) */
  follow: number;
}

const classOf = (t: Pick<FinTransaction, "txType" | "acctMajor" | "acctMid" | "acctMinor">) =>
  `${t.txType}|${t.acctMajor ?? ""}|${t.acctMid ?? ""}|${t.acctMinor ?? ""}`;
const bizOf = (t: Pick<FinTransaction, "bizMajor" | "bizMinor">) => `${t.bizMajor ?? ""}|${t.bizMinor ?? ""}`;

export const ruleSuggestionKey = (r: Pick<FinClassRule, "keyword" | "last4" | "flow">) =>
  `${ruleKey(r.keyword)}|${r.last4 ?? ""}|${r.flow}`;

/**
 * 방금 확정한 거래로 규칙을 제안할 수 있으면 제안을, 아니면 null.
 * `transactions` 는 확정이 반영된 뒤의 장부, `ctx` 는 그 장부로 만든 색인이다.
 */
export function suggestRuleFor(
  t: FinTransaction,
  transactions: FinTransaction[],
  ctx: ClassifyContext & { classRules: FinClassRuleDoc[] },
  dismissed: Set<string> = new Set(),
): RuleSuggestion | null {
  if (t.status !== "confirmed" || !t.acctMinor || !t.acctMajor || !t.acctMid || !t.vendor) return null;
  const keyword = keywordOf(t.vendor);
  if (ruleKey(keyword).length < 2) return null;
  const flow = t.txType === "자금거래" ? flowOfAccount(t.txType, t.acctMid, t.acctMinor) : flowOfTxType(t.txType);
  const draft: FinClassRule = {
    keyword,
    ...(t.last4 ? { last4: t.last4 } : {}),
    flow,
    txType: t.txType,
    acctMajor: t.acctMajor,
    acctMid: t.acctMid,
    acctMinor: t.acctMinor,
    mode: "confirm",
    active: true,
  };
  const key = ruleSuggestionKey(draft);
  if (dismissed.has(key)) return null;

  // 이 조건에 걸리는 확정 거래 — 최근 것부터
  const hits = transactions
    .filter((x) => {
      if (x.status !== "confirmed" || !x.acctMinor) return false;
      const f = x.txType === "자금거래" ? flowOfAccount(x.txType, x.acctMid, x.acctMinor) : flowOfTxType(x.txType);
      return ruleHits(draft, x, f);
    })
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  const recent = hits.slice(0, RECENT);
  const streak = recent.slice(0, STREAK);
  if (streak.length < STREAK || streak.some((x) => classOf(x) !== classOf(t))) return null;
  if (recent.filter((x) => classOf(x) === classOf(t)).length / recent.length < MIN_RECENT_RATIO) return null;

  // 사업구분까지 한결같으면 바로 확정, 아니면 사업구분 없이 제안
  const bizSteady = streak.every((x) => x.bizMinor && bizOf(x) === bizOf(streak[0]));
  const rule: FinClassRule = bizSteady
    ? { ...draft, bizMajor: streak[0].bizMajor, bizMinor: streak[0].bizMinor }
    : { ...draft, mode: "suggest" };

  // 같은 결과의 규칙이 이미 있으면 할 일이 없다
  const existing = matchClassRule({ vendor: t.vendor, last4: t.last4, txType: bankTypeOf(t), gross: t.gross, adjust: t.adjust }, ctx.classRules);
  if (existing && classOf(existing) === classOf(rule) && (!rule.bizMinor || bizOf(existing) === bizOf(rule))) return null;

  // 엔진이 다음 거래를 이미 스스로 확정한다면 규칙은 일만 늘린다
  const next = classifyOne(
    { vendor: t.vendor, last4: t.last4, txType: bankTypeOf(t), gross: t.gross, adjust: t.adjust },
    { ...ctx, classRules: [] },
  );
  if (next.status === "confirmed" && classOf({ ...next, txType: next.txType ?? t.txType }) === classOf(rule)) return null;

  const { preview } = previewClassRule(rule, transactions);
  // 최근 1년 안에 다른 계정으로 확정된 거래에 닿는다 — 키워드가 넓거나 거래처가 갈린다.
  // (그보다 오래된 것은 계정 체계가 바뀌기 전 분류일 수 있다 — 2026-08 개편)
  const since = `${String(Number((t.date ?? "").slice(0, 4)) - 1)}${(t.date ?? "").slice(4)}`;
  if (hits.some((x) => (x.date ?? "") >= since && classOf(x) !== classOf(t))) return null;

  const overlaps = ctx.classRules
    .filter((r) => r.active && classOf(r) !== classOf(rule))
    .filter((r) => hits.some((x) => ruleHits(r, x, flow)))
    .map((r) => ({ id: r.id, keyword: r.keyword, result: describeRuleResult(r) }));

  const follow = transactions.filter(
    (x) =>
      x.status !== "confirmed" &&
      isEngineOwned(x) &&
      ruleHits(rule, { vendor: x.vendor, last4: x.last4, txType: bankTypeOf(x), gross: x.gross, adjust: x.adjust }) &&
      classOf(x) !== classOf(rule),
  ).length;

  return {
    key,
    rule,
    condition: describeRuleCondition(rule, ctx.paymentMethods),
    result: describeRuleResult(rule),
    preview,
    streak: streak.length,
    overlaps,
    follow,
  };
}
