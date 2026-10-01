// ============================================================
//  분류 규칙 — 사람이 정해 둔 「이 거래처는 앞으로 이 계정」
// ------------------------------------------------------------
//  자동분류(classify.ts)는 확정된 과거 거래로 배운다. 그래서 이력이 쌓이기
//  전의 새 거래처, 이력이 여러 계정으로 갈린 거래처는 매번 사람에게 온다.
//  그 사이를 메우는 것이 이 규칙이다 — 사람이 한 번 말해 두면 다음 달
//  엑셀 임포트와 검토 대기함 AI 분류가 그대로 따른다.
//
//  구독 키워드 규칙(neander_fin_vendor_rules)과는 다르다. 그쪽은 「이 거래처는
//  어느 구독 서비스인가」 를 말하고 구독비 집계가 읽는다. 이쪽은 조건(계좌 ·
//  방향 · 금액)과 결과(계정 · 사업구분)를 갖고, **이력보다 먼저** 본다.
//
//  규칙은 재무 비서에게 말해서 만든다 (server/ai-tools.ts 의
//  propose_class_rule). 비서는 제안만 하고, 사람이 「적용」을 눌러야 저장된다.
//  만들 때 **지금 장부에서 이 규칙에 걸리는 거래**를 같이 보여준다 — 키워드가
//  너무 넓으면 그 자리에서 보인다.
//
//  ⚠️ 규칙은 조용히 틀릴 수 있다. 그래서:
//     · 키워드는 두 글자 이상
//     · 계정은 마스터에 실재해야 한다 (저장할 때도, 쓸 때도 확인)
//     · 손익 거래인데 사업구분이 없으면 확정하지 않고 제안으로 올린다
//     · 「바로 확정」 은 고를 수 있다 — 넓은 키워드는 「제안」 으로 둔다
// ============================================================

import type { FinAccountDoc, FinPaymentMethodDoc } from "./db-types";
import type { FinTransaction, TxType } from "./types";

/** 들어온 돈 · 나간 돈 — 은행 엑셀이 확실히 아는 것 */
export type RuleFlow = "in" | "out";

export interface FinClassRule {
  /** 거래처명에 이 글자가 들어 있으면 (대소문자 · 띄어쓰기 무시) */
  keyword: string;
  /** 이 계좌·카드에서만 (뒷 4자리). 비우면 어디서든 */
  last4?: string;
  /** 들어온 돈인가 나간 돈인가 — 계정이 수입이면 in, 지출이면 out */
  flow: RuleFlow;
  /** 순금액 범위 (원). 비우면 금액 무관 */
  minAmount?: number;
  maxAmount?: number;

  /** 붙일 계정 — 계정 마스터에 있는 조합이어야 한다 */
  txType: TxType;
  acctMajor: string;
  acctMid: string;
  acctMinor: string;
  bizMajor?: string;
  bizMinor?: string;

  /** confirm = 바로 확정 · suggest = 제안으로 올려 사람이 확인 */
  mode: "confirm" | "suggest";
  /** 왜 이 규칙인가 — 만든 사람의 말 그대로 */
  note?: string;
  active: boolean;
}

export interface FinClassRuleDoc extends FinClassRule {
  id: string;
  createdAt: number;
  updatedAt?: number;
  /** 만든(고친) 사람 */
  byEmail?: string;
  /** 어디서 만들었나 */
  source?: "assistant" | "manual";
}

/** 비교용 — 대소문자와 띄어쓰기를 모두 무시한다 (「쿠팡 이츠」 = 「쿠팡이츠」) */
export const ruleKey = (s?: string) => (s ?? "").toLowerCase().replace(/\s+/g, "");

/** 은행·카드 엑셀이 준 거래유형의 방향 (classify.ts 의 flowOfInput 과 같다) */
export const flowOfTxType = (txType: TxType): RuleFlow =>
  txType === "수입" || txType === "환급" ? "in" : "out";

/**
 * 계정으로 방향을 정한다. 수입 계정은 들어온 돈, 지출 계정은 나간 돈.
 * 자금거래는 유형에 방향이 없어 계정 이름이 말한다 (이체입금 · 가수금입금 · 보증금회수).
 */
export function flowOfAccount(txType: TxType, acctMid?: string, acctMinor?: string): RuleFlow {
  if (txType === "수입") return "in";
  if (txType === "지출" || txType === "카드대금결제") return "out";
  if (txType === "환급") return "in";
  return /입금|회수|수령/.test(`${acctMid ?? ""} ${acctMinor ?? ""}`) ? "in" : "out";
}

/** 규칙이 보는 거래의 최소 모양 */
export interface RuleTarget {
  vendor?: string;
  last4?: string;
  txType: TxType;
  gross?: number;
  adjust?: number;
}

const netOf = (t: RuleTarget) => (t.gross ?? 0) - (t.adjust ?? 0);

/** 조건만 본다 (켜져 있는지는 보지 않는다 — 미리보기도 이걸 쓴다) */
export function ruleHits(rule: FinClassRule, t: RuleTarget, flow: RuleFlow = flowOfTxType(t.txType)): boolean {
  const kw = ruleKey(rule.keyword);
  if (kw.length < 2 || !ruleKey(t.vendor).includes(kw)) return false;
  if (rule.last4 && rule.last4 !== (t.last4 ?? "")) return false;
  if (rule.flow !== flow) return false;
  const net = netOf(t);
  if (rule.minAmount !== undefined && net < rule.minAmount) return false;
  if (rule.maxAmount !== undefined && net > rule.maxAmount) return false;
  return true;
}

/** 조건이 많을수록, 키워드가 길수록 구체적이다 */
const specificity = (r: FinClassRule) =>
  (r.last4 ? 4 : 0) + (r.minAmount !== undefined || r.maxAmount !== undefined ? 2 : 0);

/**
 * 이 거래에 맞는 규칙 하나. 여럿이 걸리면 **더 구체적인 것**이 이긴다 —
 * 「쿠팡」 보다 「쿠팡이츠」, 계좌를 정한 것이 안 정한 것보다. 그래도 같으면
 * 나중에 고친 것.
 */
export function matchClassRule<R extends FinClassRule & { updatedAt?: number; createdAt?: number }>(
  t: RuleTarget,
  rules: R[],
): R | undefined {
  const hits = rules.filter((r) => r.active && ruleHits(r, t));
  if (hits.length === 0) return undefined;
  return hits.sort(
    (a, b) =>
      specificity(b) - specificity(a) ||
      ruleKey(b.keyword).length - ruleKey(a.keyword).length ||
      (b.updatedAt ?? b.createdAt ?? 0) - (a.updatedAt ?? a.createdAt ?? 0),
  )[0];
}

/** 조건이 같은 규칙인가 — 같으면 새로 만들지 않고 고친다 */
export const sameCondition = (a: FinClassRule, b: FinClassRule) =>
  ruleKey(a.keyword) === ruleKey(b.keyword) &&
  (a.last4 ?? "") === (b.last4 ?? "") &&
  a.flow === b.flow &&
  (a.minAmount ?? null) === (b.minAmount ?? null) &&
  (a.maxAmount ?? null) === (b.maxAmount ?? null);

const BIZ_MAJORS = ["B2C", "B2B", "공용", "해당없음"];

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/**
 * 받은 값을 규칙으로 다듬고 검사한다. 저장 직전(서버)과 제안 직전(비서 도구)에
 * **같은 함수**를 쓴다 — 비서가 통과시킨 것을 서버가 거부하는 일이 없게.
 */
export function normalizeClassRule(
  raw: Record<string, unknown>,
  refs: { accounts: Pick<FinAccountDoc, "txType" | "major" | "mid" | "minor">[]; paymentMethods: Pick<FinPaymentMethodDoc, "last4">[] },
): { ok: true; rule: FinClassRule } | { ok: false; error: string } {
  const keyword = str(raw.keyword);
  if (!keyword || ruleKey(keyword).length < 2) {
    return { ok: false, error: "키워드는 두 글자 이상이어야 합니다 (한 글자는 거의 모든 거래처에 걸립니다)." };
  }
  const acctMajor = str(raw.acctMajor);
  const acctMid = str(raw.acctMid);
  const acctMinor = str(raw.acctMinor);
  if (!acctMajor || !acctMid || !acctMinor) {
    return { ok: false, error: "계정은 대·중·소 세 단계를 모두 지정해야 합니다." };
  }
  const found = refs.accounts.filter((a) => a.major === acctMajor && a.mid === acctMid && a.minor === acctMinor);
  const wantType = str(raw.txType);
  const account = (wantType ? found.find((a) => a.txType === wantType) : undefined) ?? found[0];
  if (!account) {
    return { ok: false, error: `계정 마스터에 「${acctMajor}>${acctMid}>${acctMinor}」 조합이 없습니다.` };
  }
  const txType = account.txType as TxType;

  const last4 = str(raw.last4);
  if (last4 && !refs.paymentMethods.some((p) => p.last4 === last4)) {
    return { ok: false, error: `마스터에 뒷자리 ${last4} 인 계좌·카드가 없습니다.` };
  }

  const wantFlow = str(raw.flow);
  const natural = flowOfAccount(txType, acctMid, acctMinor);
  // 수입·지출 계정은 방향이 정해져 있다 — 다르게 적어 와도 계정을 따른다
  const flow: RuleFlow =
    txType === "자금거래" && (wantFlow === "in" || wantFlow === "out") ? wantFlow : natural;

  const minAmount = num(raw.minAmount);
  const maxAmount = num(raw.maxAmount);
  if (minAmount !== undefined && maxAmount !== undefined && minAmount > maxAmount) {
    return { ok: false, error: "금액 범위의 최소가 최대보다 큽니다." };
  }

  const bizMajor = str(raw.bizMajor);
  const bizMinor = str(raw.bizMinor);
  if (bizMajor && !BIZ_MAJORS.includes(bizMajor)) {
    return { ok: false, error: `사업대분류는 ${BIZ_MAJORS.join(" · ")} 중 하나여야 합니다.` };
  }
  if (bizMinor && !bizMajor) {
    return { ok: false, error: "사업소분류를 적으려면 사업대분류도 함께 적어야 합니다." };
  }

  const mode = raw.mode === "suggest" ? "suggest" : "confirm";
  const note = str(raw.note);
  return {
    ok: true,
    rule: {
      keyword,
      ...(last4 ? { last4 } : {}),
      flow,
      ...(minAmount !== undefined ? { minAmount } : {}),
      ...(maxAmount !== undefined ? { maxAmount } : {}),
      txType,
      acctMajor,
      acctMid,
      acctMinor,
      ...(bizMajor ? { bizMajor } : {}),
      ...(bizMinor ? { bizMinor } : {}),
      mode,
      ...(note ? { note: note.slice(0, 200) } : {}),
      active: raw.active === false ? false : true,
    },
  };
}

const won = (n: number) => Math.round(n).toLocaleString("ko-KR");

/** 조건을 사람 말로 — 「거래처에 「쿠팡이츠」 · 신한출금에서 나간 돈 · 5만원 이하」 */
export function describeRuleCondition(rule: FinClassRule, paymentMethods: Pick<FinPaymentMethodDoc, "last4" | "alias">[] = []): string {
  const where = rule.last4
    ? `${paymentMethods.find((p) => p.last4 === rule.last4)?.alias ?? `뒷자리 ${rule.last4}`}에서 `
    : "";
  const amount =
    rule.minAmount !== undefined && rule.maxAmount !== undefined
      ? ` · ${won(rule.minAmount)}~${won(rule.maxAmount)}원`
      : rule.minAmount !== undefined
        ? ` · ${won(rule.minAmount)}원 이상`
        : rule.maxAmount !== undefined
          ? ` · ${won(rule.maxAmount)}원 이하`
          : "";
  return `거래처에 「${rule.keyword}」 · ${where}${rule.flow === "in" ? "들어온 돈" : "나간 돈"}${amount}`;
}

/** 결과를 사람 말로 — 「인건비 > 복리후생비 > 일반식대 · 공용·공용」 */
export function describeRuleResult(rule: FinClassRule): string {
  const acct = [rule.acctMajor, rule.acctMid, rule.acctMinor].join(" > ");
  const biz = [rule.bizMajor, rule.bizMinor].filter(Boolean).join("·");
  const type = rule.txType === "수입" || rule.txType === "지출" ? "" : `${rule.txType} · `;
  return `${type}${acct}${biz ? ` · ${biz}` : ""}`;
}

/**
 * 규칙이 이 거래를 **확정**해도 되는가.
 * 손익 거래(수입·지출)는 사업구분까지 있어야 장부가 완성된다 — 없으면 월 마감이
 * 「사업구분이 비어 있음」 으로 잡는다. 그래서 그때는 제안으로 올린다.
 */
export function ruleConfirms(rule: FinClassRule, hasBiz: boolean): boolean {
  if (rule.mode !== "confirm") return false;
  const pl = rule.txType === "수입" || rule.txType === "지출";
  return !pl || hasBiz;
}

// ---- 비서의 제안 ------------------------------------------------

/**
 * 재무 비서가 올리는 규칙 제안. 거래 변경 제안(ChangeProposal)에 실려 화면으로
 * 간다 — 저장은 사람이 「적용」을 눌렀을 때만 (classRule.upsert / classRule.delete).
 */
export interface RuleProposal {
  action: "save" | "delete";
  /** 고치거나 지울 규칙 (새로 만들 때는 없다) */
  ruleId?: string;
  rule: FinClassRule;
  /** 조건 · 결과를 사람 말로 */
  condition: string;
  result: string;
  /** 지금 장부에서 이 규칙에 걸리는 거래 */
  preview: RulePreview;
}

// ---- 미리보기 --------------------------------------------------

export interface RulePreview {
  /** 지금 장부에서 이 규칙에 걸리는 거래 수 */
  total: number;
  /** 그중 이미 이 계정인 것 */
  same: number;
  /** 다른 계정으로 **확정**돼 있는 것 — 많으면 키워드가 너무 넓다는 신호 */
  conflict: number;
  /** 아직 확정되지 않은 것 (제안됨·검토필요) */
  pending: number;
  /** 지금 분류별 건수 (많은 것부터) */
  byClass: { label: string; count: number }[];
  /** 최근 거래 몇 건 */
  samples: { id: string; date: string; vendor?: string; acct: string; amount: number; status: string }[];
}

/** 규칙이 **어디까지 닿는지** — 승인하는 사람이 이걸 보고 누른다 */
export function previewClassRule(rule: FinClassRule, transactions: FinTransaction[]): {
  preview: RulePreview;
  /** 아직 확정되지 않은 거래 id — 비서가 「이것들도 지금 바꿀까요」 를 이어서 제안할 때 쓴다 */
  pendingIds: string[];
} {
  const hits = transactions
    .filter((t) => {
      // 자금거래는 유형에 방향이 없다 — 계정 이름으로 본다
      const flow = t.txType === "자금거래" ? flowOfAccount(t.txType, t.acctMid, t.acctMinor) : flowOfTxType(t.txType);
      return ruleHits(rule, t, flow);
    })
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  const acctOf = (t: FinTransaction) => [t.acctMajor, t.acctMid, t.acctMinor].filter(Boolean).join(">") || "(미분류)";
  const isSame = (t: FinTransaction) =>
    t.acctMajor === rule.acctMajor && t.acctMid === rule.acctMid && t.acctMinor === rule.acctMinor;
  const counts = new Map<string, number>();
  hits.forEach((t) => counts.set(t.acctMinor || "(미분류)", (counts.get(t.acctMinor || "(미분류)") ?? 0) + 1));
  const pending = hits.filter((t) => t.status !== "confirmed");
  return {
    preview: {
      total: hits.length,
      same: hits.filter(isSame).length,
      conflict: hits.filter((t) => t.status === "confirmed" && !!t.acctMinor && !isSame(t)).length,
      pending: pending.length,
      byClass: [...counts.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count).slice(0, 6),
      samples: hits.slice(0, 8).map((t) => ({
        id: t.id,
        date: t.date,
        vendor: t.vendor,
        acct: acctOf(t),
        amount: (t.gross ?? 0) - (t.adjust ?? 0),
        status: t.status,
      })),
    },
    pendingIds: pending.filter((t) => !isSame(t) || t.status !== "confirmed").map((t) => t.id),
  };
}
