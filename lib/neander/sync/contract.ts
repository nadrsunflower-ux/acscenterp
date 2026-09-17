// ============================================================
//  매출 피드 계약 — 우리 사이트가 ERP 에 내보내는 모양
// ------------------------------------------------------------
//  두 사이트(acscent.co.kr · smoat.co.kr)의 DB 를 ERP 가 직접 읽지 않는다.
//  사이트마다 **읽기 전용 피드 라우트**를 두고 ERP 가 끌어온다.
//
//  왜 직접 읽지 않는가: 사이트의 스키마는 그 사이트 사람의 것이다. 컬럼
//  하나가 바뀌면 ERP 의 숫자가 조용히 틀린다. 피드를 사이에 두면 그 변화가
//  사이트 코드 안에서 막히고, 계약이 깨지면 **시끄럽게** 깨진다.
//
//  그리고 "무엇이 매출인가"는 사이트가 안다 — acscent 는 주문 상태
//  (paid·preparing·shipping·delivered)와 인플루언서 제외 규칙을, smoat 는
//  결제 확정·환불 상태를 이미 자기 코드로 판정하고 있다. 피드는 그 판정을
//  `revenue` 플래그 하나로 실어 보내고, ERP 는 그것을 믿는다.
//  ERP 가 아는 것은 "그래서 그게 판매 줄 몇 개인가"다.
//
//  ⚠️ 개인정보는 싣지 않는다. 수령인·전화번호·주소·이메일은 피드에 없다.
//     ERP 는 회사의 손익을 보는 곳이지 고객 명부가 아니다. 학원 이름과
//     주문번호까지만 온다 (그게 있어야 장부·CS 와 되짚을 수 있다).
//
//  ⚠️ 이 파일은 **세 저장소가 함께 지키는 약속**이다. 고칠 때는
//     acscent(src/app/api/erp/feed) · smoat(src/app/api/erp/feed) 의
//     같은 이름 타입도 함께 고친다. 한쪽만 고치면 version 이 어긋나
//     동기화가 멈춘다 (그게 의도다 — 조용히 틀리는 것보다 낫다).
// ============================================================

/**
 * 계약 판. 사이트와 ERP 가 다르면 동기화를 멈춘다.
 *
 *   1  첫 판
 *   2  커서를 (수정 시각, id) 짝으로 — cursorKey/after. SMOAT 무통장 통째 보내기.
 *      온라인 ids 모드 (지운 주문 찾기).
 */
export const FEED_VERSION = 2;

export type FeedSource = "acscent-online" | "smoat";

export const FEED_SOURCES: { value: FeedSource; label: string; site: string }[] = [
  { value: "acscent-online", label: "온라인 (자사몰)", site: "acscent.co.kr" },
  { value: "smoat", label: "SMOAT", site: "smoat.co.kr" },
];

export const feedSourceLabel = (s: FeedSource) =>
  FEED_SOURCES.find((x) => x.value === s)?.label ?? s;

/**
 * 응답 봉투.
 *
 * 커서는 **(수정 시각, id) 짝**이다. 사이트는 (updatedAt, id) 오름차순으로
 * 그 짝보다 뒤에 있는 것을 limit 만큼 주고, 남았으면 complete=false 로 알린다.
 * ERP 는 받은 cursorKey 를 그대로 after 로 돌려보내며 다시 부른다.
 *
 * 왜 시각만으로는 안 되나: 같은 ms 에 바뀐 줄이 한 쪽(limit)보다 많으면
 * 커서가 움직이지 않아 같은 쪽만 되풀이된다. 거기서 1ms 를 건너뛰면 그 ms 의
 * 남은 줄을 영영 잃는다. id 를 짝으로 붙이면 같은 ms 안에서도 순서가
 * 정해져 늘 앞으로 간다.
 *
 * cursorKey 는 **사이트가 만들고 사이트가 읽는** 문자열이다. ERP 는 속을
 * 들여다보지 않고 저장했다가 돌려줄 뿐이다 (시각의 정밀도·형식은 사이트
 * DB 가 정한다 — acscent 는 마이크로초, smoat 는 밀리초).
 */
export interface FeedEnvelope<T> {
  version: number;
  source: FeedSource;
  /** 사이트가 읽기 시작한 시각 (ms) */
  serverTime: number;
  /** 이번 응답의 마지막 수정 시각 (ms) — 화면에 "어디까지 받았나"를 보여줄 때만 쓴다 */
  cursor: number;
  /** 다음 호출에 after 로 돌려줄 열쇠. 받은 줄이 없으면 요청의 after 그대로 */
  cursorKey: string;
  /** false 면 아직 남았다 — cursorKey 로 한 번 더 부른다 */
  complete: boolean;
  rows: T[];
}

// ============================================================
//  ① 온라인 주문 (acscent.co.kr)
// ============================================================

/**
 * 주문 한 건. 품목이 여럿이면 ERP 에서 판매 줄도 여럿이 된다.
 *
 * 금액은 모두 **원 단위 정수**이고 부가세 포함 표시가다 (사이트가 받는 값
 * 그대로). 할인·배송비를 품목에 미리 나눠 담지 않는다 — 나누는 규칙은
 * ERP 의 단위경제가 정한다.
 */
export interface OnlineOrderRow {
  /** 주문 uuid — 멱등키의 앞부분 */
  id: string;
  /** 사람이 읽는 주문번호 */
  orderNumber: string;
  /** 결제 확정 시각 (ISO). null 이면 아직 결제 전 */
  paidAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** 사이트의 주문 상태 (paid·preparing·shipping·delivered·cancelled …) */
  status: string;
  /**
   * 사이트가 판정한 "이건 매출이다". false 면 ERP 는 이 주문의 줄을
   * **지운다** (결제 대기·취소·인플루언서 증정).
   */
  revenue: boolean;
  /** 매출이 아닌 이유 — 화면에 그대로 보여준다 */
  excluded?: "unpaid" | "cancelled" | "influencer" | "refunded" | "test";
  /** card · kakao_pay · naver_pay · bank_transfer */
  paymentMethod: string;
  pgProvider?: string;
  pgTxId?: string;
  /** Σ 품목 소계 */
  itemsTotal: number;
  shippingFee: number;
  /** 쿠폰 할인액 (주문 단위) */
  discountAmount: number;
  /** 실제 결제액 = itemsTotal + shippingFee − discountAmount */
  finalPrice: number;
  /** 돌려준 금액 (부분환불 누계) */
  refundAmount: number;
  refundedAt: string | null;
  items: OnlineOrderItemRow[];
}

export interface OnlineOrderItemRow {
  /** 품목 uuid — 멱등키의 뒷부분 */
  id: string;
  /** image_analysis · chemistry_set · saju_perfume … */
  productType: string;
  /** 10ml · 50ml · set_10ml · scent_paper · clicker … */
  size: string;
  /** 사람이 읽는 상품명 (향수 이름) */
  name: string;
  unitPrice: number;
  qty: number;
  subtotal: number;
}

/**
 * 상품 매칭 키 — `productType/size`.
 *
 * ERP 의 상품 마스터에 이 문자열을 **별칭(aliases)으로** 넣어 두면 해석기가
 * 그대로 집어낸다. 별칭은 긴 것이 이기므로(resolve.ts byAlias) `saju_perfume/50ml`
 * 가 `50ml` 보다 먼저 걸린다 — 코드에 매칭 표를 두지 않고 마스터에서
 * 고칠 수 있게 하려는 것이다.
 */
export const siteKeyOf = (productType: string, size: string) =>
  `${String(productType ?? "").trim()}/${String(size ?? "").trim()}`;

// ============================================================
//  ② SMOAT 결제 (smoat.co.kr)
// ============================================================

/**
 * 결제 한 건.
 *
 * ⚠️ 지금 SMOAT 의 실매출은 **크레딧 팩 충전(topup)**과 **무통장 수기
 *    지급(deposit)** 뿐이다. 정기구독(subscription)은 다날 정기결제 심사가
 *    끝나지 않아 사이트에서 꺼져 있고 결제 건수가 0 이다. 세 종류를 다
 *    받아 두는 이유는 구독이 켜지는 날 ERP 를 고치지 않으려는 것이다.
 */
export type SmoatSaleKind = "topup" | "deposit" | "subscription";

export interface SmoatSaleRow {
  /** 사이트 안에서 고유한 id (uuid·cuid) */
  id: string;
  kind: SmoatSaleKind;
  /** 결제 확정 시각 (ISO). null 이면 아직 매출이 아니다 */
  paidAt: string | null;
  updatedAt: string;
  /** 사이트의 상태 문자열 (COMPLETED·REFUNDED·CANCELLED·MANUAL_GRANT …) */
  status: string;
  /** 사이트가 판정한 "이건 매출이다" */
  revenue: boolean;
  /**
   * 매출이 아닌 이유.
   * duplicate = 이미 다른 줄로 세고 있는 건 (충전에 연결된 입금 알림 등)
   */
  excluded?: "pending" | "failed" | "cancelled" | "refunded" | "test" | "duplicate";
  /** 결제액 (환불 전) */
  amount: number;
  /** 돌려준 금액 */
  refundAmount: number;
  refundedAt: string | null;
  /** CARD · VIRTUAL_ACCOUNT · TRANSFER · EASY_PAY · MOBILE · BANK */
  paymentMethod: string;
  pgTxId?: string;
  /** 산 쪽 — 학원. 개인은 보내지 않는다 (대표 이름·이메일 없음) */
  accountId: string;
  accountName: string;
  /** 무엇을 샀나 — 팩 이름(스타터·스탠다드 …) 또는 플랜 등급 */
  packLabel?: string;
  /** 산 크레딧 수 */
  credits?: number;
  /** 구독일 때의 등급 (STARTER·STANDARD·PREMIUM·ENTERPRISE) */
  planTier?: string;
  /** 구독 결제가 덮는 기간 */
  periodStart?: string;
  periodEnd?: string;
}

/**
 * 월별 원가 — SMOAT 의 변동비는 AI 호출 비용이다 (향수의 재료비 자리).
 *
 * 결제와 성격이 달라 줄이 아니라 **월 집계**로 온다. 사이트가 달러로
 * 기록하므로 환산 전후를 모두 싣는다 — ERP 는 환산 근거를 화면에 드러낸다.
 */
export interface SmoatMonthlyCostRow {
  /** YYYY-MM */
  month: string;
  /** AI 공급사 호출 비용 (USD) */
  aiUsd: number;
  /** 같은 값을 원으로 (사이트가 쓴 환율) */
  aiKrw: number;
  /** 환산에 쓴 환율 — 없으면 사이트가 원화로 직접 기록한 것 */
  fxRate?: number;
  /** 이 달에 판 크레딧 수 */
  creditsSold: number;
  /** 이 달에 쓰인 크레딧 수 — 선수금이 얼마나 소진됐나 */
  creditsUsed: number;
  updatedAt: string;
}

/** SMOAT 피드는 결제 줄과 월별 원가를 함께 싣는다 */
export interface SmoatFeedPayload {
  /** 충전·구독 — since 뒤로 바뀐 것만 */
  sales: SmoatSaleRow[];
  costs: SmoatMonthlyCostRow[];
  /**
   * 처리된 무통장 알림 **전부** (커서와 무관).
   *
   * 무통장 알림 표에는 수정 시각이 없어서, 수기 지급이 나중에 충전에
   * 연결되거나(MATCHED) 무시로 바뀌어도(IGNORED) 커서로는 그 변화를 알 수
   * 없다. 그래서 통째로 받고, 여기 없는 수기 지급 줄은 ERP 가 지운다 —
   * 같은 돈이 충전 줄로 한 번 더 잡히지 않게.
   */
  deposits: SmoatSaleRow[];
  /** false 면 한도에 닿아 전부가 아니다 — 지우기를 건너뛴다 */
  depositsComplete: boolean;
}

/**
 * SMOAT 응답 봉투 — rows 대신 payload.
 *
 * 온라인 피드는 주문 줄 하나만 실어 `rows` 로 보내지만, SMOAT 은 결제 줄과
 * 월별 원가라는 **성격이 다른 둘**을 함께 보낸다. 억지로 한 배열에 섞지
 * 않는다. 커서는 결제 줄(sales)에만 걸리고, 원가는 작아서 늘 통째로 온다.
 */
export interface SmoatFeedEnvelope extends Omit<FeedEnvelope<never>, "rows" | "source"> {
  source: "smoat";
  payload: SmoatFeedPayload;
}

// ============================================================
//  신호 — "가져가라"
// ============================================================

/**
 * 사이트가 결제를 확정한 직후 ERP 에 보내는 빈 신호.
 *
 * 결제 내용을 밀어 넣지 않는 이유: 밀어 넣으면 사이트가 ERP 의 저장 규칙을
 * 알아야 하고, 신호를 놓치면 그 건이 영영 빠진다. 신호는 "지금 끌어가면
 * 새 것이 있다"는 말만 하므로, 놓쳐도 다음 주기 폴링이 메운다.
 */
export interface FeedSignal {
  source: FeedSource;
  /** 무엇 때문에 부르는지 — 로그에만 쓴다 */
  reason?: string;
  /**
   * 주문을 **지웠을** 때. 지운 주문은 피드에 다시 나타나지 않으므로, ERP 가
   * 가진 주문이 아직 사이트에 있는지 되물어야 그 매출 줄을 치울 수 있다.
   */
  reconcile?: boolean;
}
