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

/**
 * 원장에 사람이 덧붙인 열.
 *
 * 고정 열(거래일·금액·계정 …)은 집계·검증·내보내기가 의존하는 회계 항목이라
 * 손댈 수 없다. 그 옆에 자기 열을 하나 더 두고 싶을 때 쓴다 — 값은 거래 문서의
 * `extra[id]` 에 문자열로 담기고, 집계에는 들어가지 않는다.
 */
/**
 * 형광펜 끄기 (lib/neander/finance/anomaly.ts).
 *
 *   vendor  — 신뢰한 거래처. 앞으로 이 거래처 거래는 칠하지 않고, 계정 급증
 *             계산에서도 뺀다 (매달 나가는 믿을 만한 큰돈이 계정을 튀게 하지 않게).
 *             key 는 거래처 비교 키(띄어쓰기·대소문자 무시)
 *   account — 그 달 그 계정은 확인했다. key 는 계정 경로(`대|중|소`), month 필수
 */
export interface FinAnomalyIgnoreDoc {
  id: string;
  kind: "vendor" | "account";
  key: string;
  /** 사람이 읽는 이름 (거래처 원문 · 계정 이름) */
  label?: string;
  month?: string;
  createdAt: number;
  createdBy?: string;
}

export interface FinLedgerColumnDoc {
  id: string;
  label: string;
  /** 이 고정 열 **바로 왼쪽**에 놓는다. 비어 있으면 맨 오른쪽 */
  before?: string;
  createdAt: number;
  createdBy?: string;
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
