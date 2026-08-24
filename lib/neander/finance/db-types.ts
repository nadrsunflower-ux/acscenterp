// 재무 마스터 문서 타입 — 서버·클라이언트 공용 (Firestore SDK 를 끌어오지 않는다)

import type {
  FinAccountMaster,
  FinAllocationMaster,
  FinPaymentMethodMaster,
  FinSubscriptionMaster,
  FinVendorRuleMaster,
} from "./master-data";

export interface FinAccountDoc extends FinAccountMaster {
  id: string;
}

export interface FinPaymentMethodDoc extends FinPaymentMethodMaster {
  id: string;
}

export interface FinVendorRuleDoc extends FinVendorRuleMaster {
  id: string;
  /** 이 키워드에 매칭되면 붙일 계정 조회키 (선택) */
  lookupKey?: string;
}

export interface FinSubscriptionDoc extends FinSubscriptionMaster {
  id: string;
}

export interface FinAllocationDoc extends FinAllocationMaster {
  id: string;
}

/**
 * 월별 예산.
 *
 * 문서 1개 = 한 달. 계정마다 문서를 만들면 165개×12개월이 되는데, 예산은
 * 언제나 "그 달 전체"를 함께 보고 함께 고치므로 한 문서에 담는 게 맞다.
 *
 * `lines` 의 키는 계정 트리 경로 `대|중|소` 다. 317개 계정의 이 경로가
 * 전부 유일하다고 확인했고(거래유형 교차 0건), 리포트 트리의 노드 경로와
 * 같은 값이라 집계와 바로 맞물린다.
 */
export interface FinBudgetDoc {
  /** 문서 id = month */
  id: string;
  /** `YYYY-MM` */
  month: string;
  lines: Record<string, number>;
  note?: string;
  updatedAt?: number;
  updatedBy?: string;
}
