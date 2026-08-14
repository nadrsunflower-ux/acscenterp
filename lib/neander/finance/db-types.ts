// 재무 마스터 문서 타입 — 서버·클라이언트 공용 (Firestore SDK 를 끌어오지 않는다)

import type {
  FinAccountMaster,
  FinPaymentMethodMaster,
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
