// ============================================================
//  업종 — 처음 보는 가맹점이 무슨 가게인지
// ------------------------------------------------------------
//  검토 대기함에는 「과거 이력·규칙 없음」 으로 남는 카드 결제가 많다. 처음 간
//  식당, 처음 넣은 주유소. 사람은 이름만 보고 안다 — `카페엔젤` 은 카페고
//  `연길반점` 은 식당이다. 그런데 식당 이름에는 공통된 낱말이 없어서
//  (`만게츠` · `대박` · `정정`) 낱말을 세는 것으로는 알 수 없다. 상식이 필요하다.
//
//  그 상식만 모델에게 맡긴다 — **이름을 보고 업종 하나를 고른다.** 계정은 고르게
//  하지 않는다. 업종이 어느 계정인지는 자동분류(classify.ts)가 장부 이력에서
//  배운다 (음식점은 일반식대 92%, 주유소는 차량유지비). 그래서 계정 체계가
//  바뀌어도 모델이 아니라 장부를 따르고, 사람이 확정한 것이 곧 학습이 된다.
//
//  업종은 거래에 `vendorKind` 로 남는다. 한 번 붙으면 다시 묻지 않는다 —
//  같은 가맹점이 또 오면 앞의 것을 그대로 쓴다 (vendorKindLookup).
//
//  카드 결제에만 붙인다. 통장 거래의 거래처는 사람 이름 · 적요라 업종이 없다.
//
//  이 파일은 서버·화면 공용이다 (모델을 부르는 쪽은 server/ai-vendor-kind.ts).
// ============================================================

import type { FinPaymentMethodDoc } from "./db-types";
import type { FinTransaction } from "./types";

/**
 * 업종 목록. 계정과 1:1 로 맞추지 않는다 — 가게의 **종류**다.
 * 음식점과 주점을 가르는 것은 회식을 가려 보려는 것이고, 주유소와 주차·통행료를
 * 가르는 것은 같은 계정이어도 이름이 전혀 달라서다.
 */
export const VENDOR_KINDS = [
  "음식점",
  "카페·베이커리",
  "주점",
  "편의점",
  "마트·슈퍼",
  "주유소",
  "주차·통행료·정비",
  "택시·대중교통",
  "철도·항공·숙박",
  "소프트웨어·온라인구독",
  "온라인광고",
  "온라인쇼핑·결제대행",
  "문구·사무·전자",
  "인쇄·제작",
  "택배·물류",
  "통신",
  "보험",
  "병원·약국",
  "교육·도서",
  "공공·세금",
  "기타",
  "모름",
] as const;
export type VendorKind = (typeof VENDOR_KINDS)[number];

const KNOWN = new Set<string>(VENDOR_KINDS);

/**
 * 근거로 쓸 수 있는 업종인가. 「기타」·「모름」 은 가게들을 한데 묶어 주지 못한다 —
 * 그 안에는 온갖 것이 섞여 있다.
 */
export const isUsefulKind = (kind?: string | null): kind is string =>
  !!kind && KNOWN.has(kind) && kind !== "기타" && kind !== "모름";

/** 가맹점 이름을 견주는 열쇠 (classify.ts 의 normVendor 와 같다 — 서로 물지 않게 따로 둔다) */
export const vendorKindKey = (vendor?: string) => (vendor ?? "").trim().toLowerCase().replace(/\s+/g, " ");

/** 이미 붙어 있는 업종 — 가맹점 열쇠 → 업종. 같은 가게를 두 번 묻지 않는다 */
export function vendorKindLookup(transactions: Pick<FinTransaction, "vendor" | "vendorKind">[]): Map<string, string> {
  const known = new Map<string, string>();
  transactions.forEach((t) => {
    if (t.vendorKind && t.vendor) known.set(vendorKindKey(t.vendor), t.vendorKind);
  });
  return known;
}

/** 업종을 붙일 거래인가 — 카드로 나간 돈 */
export function wantsVendorKind(
  t: Pick<FinTransaction, "vendor" | "last4" | "txType">,
  cardLast4: Set<string>,
): boolean {
  return !!t.vendor?.trim() && cardLast4.has(t.last4 ?? "") && (t.txType === "지출" || t.txType === "환급");
}

export const cardLast4Of = (paymentMethods: Pick<FinPaymentMethodDoc, "last4" | "kind">[]) =>
  new Set(paymentMethods.filter((p) => p.kind === "card").map((p) => p.last4));

/** 모델에게 물을 이름들 — 아직 업종이 없는 카드 가맹점 (같은 이름은 한 번만) */
export function vendorsToLabel(
  rows: Pick<FinTransaction, "vendor" | "last4" | "txType" | "vendorKind">[],
  known: Map<string, string>,
  cardLast4: Set<string>,
): string[] {
  const names = new Map<string, string>();
  rows.forEach((t) => {
    if (t.vendorKind || !wantsVendorKind(t, cardLast4)) return;
    const key = vendorKindKey(t.vendor);
    if (!known.has(key) && !names.has(key)) names.set(key, (t.vendor ?? "").trim());
  });
  return [...names.values()];
}
