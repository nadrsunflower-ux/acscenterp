// ============================================================
//  자동분류 엔진
// ------------------------------------------------------------
//  임포트된 거래에 계정·사업구분을 자동으로 붙인다. 세 가지 근거를
//  순서대로 시도하고, 어느 것도 못 맞히면 사람에게 넘긴다.
//
//    1) 과거 이력   같은 거래처가 과거에 늘 같은 계정으로 분류됐다면
//                   그 계정을 쓴다. 가장 강한 근거 — 실측상 이것만으로
//                   전체 거래의 약 50% 가 커버된다.
//    2) 구독 규칙   거래처명에 등록된 키워드가 포함되면 그 규칙을 쓴다.
//                   (ANTHROPIC → Anthropic (Claude) 등)
//    3) 어댑터 힌트 은행·카드 엑셀이 알려주는 것 (이자입금, 카드대금결제,
//                   카드 업종 등). 확실한 것만 오므로 suggested 로 둔다.
//    4) 계좌 기본값 계좌·카드 마스터의 사업장을 채운다. 계정은 못 정한다.
//
//  ⚠️ 자동분류는 절대 최종 확정을 남발하지 않는다. 확신이 충분할 때만
//     confirmed 로 두고, 나머지는 suggested / needs_review 로 남겨
//     검토 대기함에서 사람이 승인하게 한다. 재무 데이터에서 조용히
//     틀린 분류가 쌓이는 것이 가장 나쁘다.
// ============================================================

import type { FinTransaction, ClassificationStatus, TxType } from "./types";
import type { FinAccountDoc, FinPaymentMethodDoc, FinVendorRuleDoc } from "./db-types";

/** 과거 이력에서 계정을 확정으로 볼 최소 건수 */
const MIN_HISTORY_COUNT = 2;
/** 과거 이력에서 계정을 확정으로 볼 최소 일치 비율 */
const MIN_HISTORY_RATIO = 0.95;

export const normVendor = (s?: string) =>
  (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");

/** 분류 결과 — 거래에 덮어쓸 필드들 */
export interface ClassifySuggestion {
  status: ClassificationStatus;
  /**
   * 거래유형 교정. 은행 엑셀은 입출금 **방향**만 알고 성격은 모른다.
   * 이력이 준 계정이 자금거래·카드대금결제 계열이면 유형도 그것이어야
   * 한다 — 안 그러면 `지출 + 계좌간이동` 같은 모순이 생기고, 리포트에서
   * 비손익 거래가 손익으로 잡힌다.
   */
  txType?: TxType;
  acctMajor?: string;
  acctMid?: string;
  acctMinor?: string;
  bizMajor?: string;
  bizMinor?: string;
  site?: string;
  classReason: string;
}

/** 거래처별 과거 분류 통계 */
export interface VendorStat {
  vendor: string;
  total: number;
  /** 가장 많이 쓰인 분류 */
  top: {
    acctMajor: string;
    acctMid: string;
    acctMinor: string;
    bizMajor: string;
    bizMinor: string;
    count: number;
  } | null;
  ratio: number;
}

/**
 * 확정된 과거 거래로 거래처 색인을 만든다.
 * 임포트 1건마다 전체 이력을 훑지 않도록 미리 한 번만 계산한다.
 */
export function buildVendorIndex(history: FinTransaction[]): Map<string, VendorStat> {
  const groups = new Map<string, Map<string, number>>();
  const totals = new Map<string, number>();

  history.forEach((t) => {
    if (t.status !== "confirmed") return;
    const v = normVendor(t.vendor);
    if (!v || !t.acctMinor) return;
    const key = [t.acctMajor ?? "", t.acctMid ?? "", t.acctMinor ?? "", t.bizMajor ?? "", t.bizMinor ?? ""].join("|");
    if (!groups.has(v)) groups.set(v, new Map());
    const g = groups.get(v)!;
    g.set(key, (g.get(key) ?? 0) + 1);
    totals.set(v, (totals.get(v) ?? 0) + 1);
  });

  const out = new Map<string, VendorStat>();
  groups.forEach((g, vendor) => {
    const total = totals.get(vendor) ?? 0;
    let bestKey = "";
    let bestCount = 0;
    g.forEach((count, key) => {
      if (count > bestCount) {
        bestCount = count;
        bestKey = key;
      }
    });
    const [acctMajor, acctMid, acctMinor, bizMajor, bizMinor] = bestKey.split("|");
    out.set(vendor, {
      vendor,
      total,
      top: bestKey
        ? { acctMajor, acctMid, acctMinor, bizMajor, bizMinor, count: bestCount }
        : null,
      ratio: total ? bestCount / total : 0,
    });
  });
  return out;
}

/** 자동분류에 필요한 참조 데이터 묶음 */
export interface ClassifyContext {
  vendorIndex: Map<string, VendorStat>;
  vendorRules: FinVendorRuleDoc[];
  paymentMethods: FinPaymentMethodDoc[];
  /**
   * 계정 마스터. 제안한 계정의 거래유형이 실제 거래유형과 맞는지 검증한다.
   * 없으면 검증을 건너뛴다(예전 호출부 호환).
   */
  accounts?: FinAccountDoc[];
}

/** 계정 3단으로 마스터를 찾아 그 계정의 거래유형을 돌려준다 */
function accountTxType(
  accounts: FinAccountDoc[] | undefined,
  major?: string,
  mid?: string,
  minor?: string,
): TxType | undefined {
  if (!accounts?.length || !major || !minor) return undefined;
  const hit = accounts.find(
    (a) => a.major === major && (!mid || a.mid === mid) && a.minor === minor,
  );
  return hit ? (hit.txType as TxType) : undefined;
}

/** 손익에 잡히지 않는 유형 — 계정이 이쪽이면 유형도 이쪽이어야 한다 */
const NON_PL: TxType[] = ["자금거래", "카드대금결제"];

/**
 * 계정의 거래유형과 실제 거래유형이 **의도적으로** 다른 조합.
 *
 * 카드대금결제 계정은 `지출 > 재무비용 > 금융비용 > 카드대금결제` 로
 * 등록돼 있다 — 재무비용 밑에 있으니 계정 자체는 지출이다. 하지만 거래유형은
 * 별도의 `카드대금결제` 다(손익에서 빼기 위해). 기존 장부의 확립된 관행이라
 * 불일치로 보면 안 된다.
 *
 * 키는 `거래유형|계정소분류`.
 */
const ALLOWED_MISMATCH = new Set(["카드대금결제|카드대금결제"]);

export const isAllowedTxAccountMismatch = (txType: string, acctMinor?: string) =>
  ALLOWED_MISMATCH.has(`${txType}|${acctMinor ?? ""}`);

/** 분류 대상 — 임포트 직후의 최소 정보 */
export interface ClassifyInput {
  vendor?: string;
  last4?: string;
  txType: TxType;
  /** 엑셀에 이미 분류가 들어있으면 그대로 존중한다 */
  acctMajor?: string;
  acctMid?: string;
  acctMinor?: string;
  bizMajor?: string;
  bizMinor?: string;
  site?: string;
  /**
   * 임포트 어댑터의 추정 (확정 아님). 은행·카드 엑셀이 알려주는 것들 —
   * 「이자입금」적요, 카드대금 판정, 카드 업종명 같은 것. 과거 이력·구독
   * 규칙이 없을 때 마지막 후보로 쓰고 `suggested` 로 남긴다.
   */
  hint?: {
    acctMajor?: string;
    acctMid?: string;
    acctMinor?: string;
    bizMajor?: string;
    bizMinor?: string;
    reason: string;
  };
}

export function classifyOne(input: ClassifyInput, ctx: ClassifyContext): ClassifySuggestion {
  const pm = input.last4
    ? ctx.paymentMethods.find((p) => p.last4 === input.last4)
    : undefined;
  // 사업장은 계좌 마스터 기본값을 쓰되, 원본에 값이 있으면 그것을 우선한다
  // (엑셀에서도 수기 덮어쓰기가 가능한 열이다).
  const site = input.site || pm?.site;

  // 0) 원본에 이미 완전한 분류가 있으면 그대로 확정.
  //    기존 장부를 옮기는 경우가 여기에 해당한다 — 사람이 이미 분류해둔 것을
  //    엔진이 다시 의심할 이유가 없다.
  if (input.acctMajor && input.acctMid && input.acctMinor) {
    return {
      status: "confirmed",
      acctMajor: input.acctMajor,
      acctMid: input.acctMid,
      acctMinor: input.acctMinor,
      bizMajor: input.bizMajor,
      bizMinor: input.bizMinor,
      site,
      classReason: "원본 장부에 분류가 있어 그대로 확정",
    };
  }

  // 자금거래·카드대금결제는 손익에 안 잡히므로 계정 분류가 필요 없다.
  // 다만 어댑터가 판정한 경우(은행 적요로 추정)는 사람이 한 번 봐야 한다 —
  // 「카드결」 같은 문구로 맞힌 것이라 틀릴 수 있고, 틀리면 지출이 사라진다.
  if (input.txType === "자금거래" || input.txType === "카드대금결제") {
    return {
      status: input.hint ? "suggested" : "confirmed",
      acctMajor: input.acctMajor || input.hint?.acctMajor,
      acctMid: input.acctMid || input.hint?.acctMid,
      acctMinor: input.acctMinor || input.hint?.acctMinor,
      bizMajor: input.bizMajor,
      bizMinor: input.bizMinor,
      site,
      classReason: input.hint
        ? `${input.hint.reason} — 확인 필요`
        : `${input.txType}는 손익 대상이 아니라 분류 불필요`,
    };
  }

  const v = normVendor(input.vendor);

  // 1) 과거 이력
  const stat = v ? ctx.vendorIndex.get(v) : undefined;
  if (stat?.top && stat.total >= MIN_HISTORY_COUNT) {
    const pct = Math.round(stat.ratio * 100);
    const strong = stat.ratio >= MIN_HISTORY_RATIO;
    const base = {
      acctMajor: stat.top.acctMajor || undefined,
      acctMid: stat.top.acctMid || undefined,
      acctMinor: stat.top.acctMinor || undefined,
      bizMajor: input.bizMajor || stat.top.bizMajor || undefined,
      bizMinor: input.bizMinor || stat.top.bizMinor || undefined,
      site,
    };
    const why = `거래처 「${input.vendor}」 과거 ${stat.total}건 중 ${pct}% 가 같은 분류`;

    // 이력이 준 계정의 거래유형이 지금 유형과 다르면 그냥 넘기면 안 된다.
    const acctTx = accountTxType(ctx.accounts, base.acctMajor, base.acctMid, base.acctMinor);
    if (acctTx && acctTx !== input.txType && !isAllowedTxAccountMismatch(input.txType, base.acctMinor)) {
      if (NON_PL.includes(acctTx)) {
        // 은행은 입출금 방향만 안다. 이력이 이 거래처를 비손익으로 분류해
        // 왔다면 그게 더 정확하다 — 유형을 고쳐 제안하고 사람이 확인한다.
        return {
          status: "suggested",
          txType: acctTx,
          ...base,
          classReason: `${why} → 거래유형을 ${input.txType} 에서 ${acctTx} 로 고쳐 제안`,
        };
      }
      // 수입 ↔ 지출이 어긋나는 건 계정을 그대로 쓸 수 없다 (부호가 뒤집힌다)
      return {
        status: "needs_review",
        site,
        bizMajor: input.bizMajor,
        bizMinor: input.bizMinor,
        classReason: `${why} 이지만 그 계정은 ${acctTx} 용이라 이번 ${input.txType} 에 맞지 않습니다 — 직접 골라주세요`,
      };
    }

    return {
      status: strong ? "confirmed" : "suggested",
      ...base,
      classReason: why,
    };
  }

  // 2) 구독 규칙 (거래처명 부분일치)
  const rule = v
    ? ctx.vendorRules.find((r) => r.keyword && v.includes(r.keyword.toLowerCase()))
    : undefined;
  if (rule) {
    const [rMajor, rMid, rMinor] = (rule.lookupKey ?? "").split("|").slice(1);
    return {
      status: "suggested",
      acctMajor: input.acctMajor || rMajor || undefined,
      acctMid: input.acctMid || rMid || undefined,
      acctMinor: input.acctMinor || rMinor || undefined,
      bizMajor: input.bizMajor,
      bizMinor: input.bizMinor,
      site,
      classReason: `구독 규칙 「${rule.keyword}」 → ${rule.service}`,
    };
  }

  // 3) 어댑터 힌트 — 은행·카드 엑셀이 알려준 것
  if (input.hint?.acctMinor || input.hint?.acctMajor) {
    return {
      status: "suggested",
      acctMajor: input.acctMajor || input.hint.acctMajor,
      acctMid: input.acctMid || input.hint.acctMid,
      acctMinor: input.acctMinor || input.hint.acctMinor,
      bizMajor: input.bizMajor || input.hint.bizMajor,
      bizMinor: input.bizMinor || input.hint.bizMinor,
      site,
      classReason: input.hint.reason,
    };
  }

  // 4) 판단 불가 — 사람에게 넘긴다
  return {
    status: "needs_review",
    acctMajor: input.acctMajor,
    acctMid: input.acctMid,
    acctMinor: input.acctMinor,
    bizMajor: input.bizMajor,
    bizMinor: input.bizMinor,
    site,
    classReason: v
      ? `거래처 「${input.vendor}」 과거 이력·규칙 없음`
      : "거래처가 비어 있어 판단 불가",
  };
}

/** 임포트 미리보기용 요약 */
export interface ClassifySummary {
  confirmed: number;
  suggested: number;
  needsReview: number;
  total: number;
  /** 자동확정률 */
  autoRate: number;
}

export function summarize(results: ClassifySuggestion[]): ClassifySummary {
  const confirmed = results.filter((r) => r.status === "confirmed").length;
  const suggested = results.filter((r) => r.status === "suggested").length;
  const needsReview = results.filter((r) => r.status === "needs_review").length;
  const total = results.length;
  return {
    confirmed,
    suggested,
    needsReview,
    total,
    autoRate: total ? confirmed / total : 0,
  };
}
