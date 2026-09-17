// ============================================================
//  매출 모듈 도메인 — 「2607악센트원가계산.xlsx」의 개념을 타입으로
// ------------------------------------------------------------
//  ⚠️ 이 모듈은 **매출 금액의 정본이 아니다.** 매장 매출은 카드사 정산
//     입금으로, 네이버 예약은 Npay 정산으로 이미 재무 장부에 들어와 있다
//     (lib/neander/finance/adapters/pos.ts 주석 참고). 여기서 POS 를 또
//     거래로 적재하면 회사 매출이 두 번 잡힌다.
//
//  그래서 이 모듈이 답하는 질문은 금액이 아니라 **단위경제**다 —
//  "무엇을 몇 개 팔아 얼마 남겼나". 장부와는 /sales/reconcile 에서
//  합계를 맞춰 보는 관계로만 잇는다.
//
//  엑셀과의 대응:
//    상품마스터 · 직접재료비 → SalesProduct
//    기본가정               → SalesAssumptions
//    입력_페이히어_* · 입력_네이버예약 → SalesLine (적재 결과)
//    입력_이벤트마스터 · 이벤트준비물 · 방문자통계 → SalesEvent
//    매출집계 · 와우매장 · 아이디매장 · 온라인 · 통합BEP → aggregate.ts
// ============================================================

/** 매장 — 엑셀이 손익을 가르는 첫 번째 축 */
export type SalesStore = "wow" | "id" | "online";

export const SALES_STORES: { value: SalesStore; label: string; hint: string }[] = [
  { value: "id", label: "아이디", hint: "상시 + 이벤트" },
  { value: "wow", label: "와우", hint: "이벤트 전용" },
  { value: "online", label: "온라인", hint: "배송 판매" },
];

export const storeLabel = (s: SalesStore) =>
  SALES_STORES.find((x) => x.value === s)?.label ?? s;

/** 판매 유형 — 손익을 가르는 두 번째 축 */
export type SalesKind = "regular" | "event";

export const SALES_KINDS: { value: SalesKind; label: string }[] = [
  { value: "regular", label: "상시" },
  { value: "event", label: "이벤트" },
];

export const kindLabel = (k: SalesKind) =>
  SALES_KINDS.find((x) => x.value === k)?.label ?? k;

/**
 * 결제 경로 — 수수료율의 근거다.
 *
 * ⚠️ 엑셀은 네이버 예약 건에 「네이버예약 1.8% + 카드결제 2.2% = 4.0%」를
 *    매긴다 (아이디매장 시트: 174,720 / 4,368,000). **이 합산은 틀렸다.**
 *    네이버 공식 안내 「예약/주문에 연동한 Npay 정산 및 수수료」
 *    (help.naver.com/service/30026/contents/20749) 는 수수료 표 밑에
 *    「따로 부과되는 카드사 수수료는 없습니다」라고 못박는다. 카드 처리
 *    비용은 Npay 수수료 안에 이미 들어 있다 — 얹으면 이중 계상이다.
 *
 *    그 표(부가세 별도)의 예약 요율이 영세 1.80% 다. 엑셀의 1.8% 는 여기서
 *    온 맞는 숫자였고, 위에 카드를 한 번 더 더한 것만 잘못이다.
 *      예약   영세 1.80 · 중소1 2.35 · 중소2 2.50 · 중소3 2.75 · 일반 2.90 %
 *      주문/매장방문결제  영세 0.80 · … · 일반 2.90 %   ← 예약보다 싸다
 *      해외발급카드(외국인) 3.5 %                        ← 2026-01-05 시행
 *    예약자관리에 결제수단이 남으니, 매장방문결제나 외국인 결제가 섞여
 *    있으면 이 셋을 나눠야 한다. 지금은 전부 예약 요율로 본다.
 */
export type PayRoute = "payhere" | "naver" | "online";

export const PAY_ROUTES: { value: PayRoute; label: string; hint: string }[] = [
  { value: "payhere", label: "현장결제", hint: "페이히어 · 카드사 수수료 0.4%" },
  { value: "naver", label: "네이버예약", hint: "Npay 1.8% · 카드사 수수료 없음" },
  { value: "online", label: "온라인", hint: "자사몰 · 카드사 수수료 0.4%" },
];

export const routeLabel = (r: PayRoute) =>
  PAY_ROUTES.find((x) => x.value === r)?.label ?? r;

/**
 * 결제수단 — 경로 다음으로 수수료가 갈리는 축이다.
 *
 * ⚠️ **카드사별로는 갈리지 않는다.** 영세·중소 가맹점의 우대수수료율은
 *    여신전문금융업법 제18조의3③ · 여신전문금융업감독규정 제25조의6①
 *    이 정한 법정 요율이라 신한·삼성·현대·국민 어디서 긁어도 같다.
 *    카드사마다 협상 요율이 달라지는 건 연매출 30억 초과 일반가맹점뿐이다.
 *    그래서 카드사 축은 만들지 않았다 — 만들면 데이터만 늘고 답은 같다.
 *
 *    대신 실제로 갈리는 건 이쪽이다 (요율은 여신금융협회 매입내역 실측,
 *    2026-07 와우 — 우리 등급은 **중소1**(연 3~5억)이었다):
 *      credit  신용카드          1.000%  — 카드사 5곳 전부 같은 값이었다
 *      debit   체크카드          0.750%  — 「기타」로 분류된 건도 같았다
 *      npay    네이버페이(예약)  Npay 예약 2.35% (중소1 — 카드와 같은 등급으로
 *                               맞췄다. 영세였다면 1.80% 다)
 *      easyCash 현금성 간편결제  카카오머니·네이버 포인트/계좌·제로페이·
 *                               지역화폐 — **우대수수료율 대상이 아니다.**
 *                               간편결제는 신용카드 결제분만 우대를 받는다.
 *      overseas 해외발급카드·알리페이·위챗페이 — 국제브랜드 몫이 더 붙는다.
 *                               네이버 예약의 해외카드는 3.5% (2026-01-05 시행).
 *      cash    현금·계좌이체     수수료 없음
 *
 *    정본은 늘 정산 내역이다 (페이히어 정산·Npay센터·여신금융협회
 *    가맹점매출정보통합조회 cardsales.or.kr). 여기 요율은 그 값을 넣어 두는
 *    자리지, 우리가 추정하는 값이 아니다.
 */
export type PayMethod = "credit" | "debit" | "npay" | "easyCash" | "overseas" | "cash";

export const PAY_METHODS: { value: PayMethod; label: string; hint: string }[] = [
  { value: "credit", label: "신용카드", hint: "법정 우대수수료율 (중소1 1.00% · 실측)" },
  { value: "debit", label: "체크카드", hint: "법정 우대수수료율 (중소1 0.75% · 실측)" },
  { value: "npay", label: "네이버페이", hint: "Npay 예약 수수료 · 카드사 수수료 없음" },
  { value: "easyCash", label: "현금성 간편결제", hint: "카카오머니·포인트·제로페이 — 우대 대상 아님" },
  { value: "overseas", label: "해외발급·해외페이", hint: "국제브랜드 몫이 더 붙는다" },
  { value: "cash", label: "현금·계좌이체", hint: "수수료 없음" },
];

export const methodLabel = (m: PayMethod) =>
  PAY_METHODS.find((x) => x.value === m)?.label ?? m;

/**
 * 원본의 결제수단 문구 → PayMethod. 모르는 문구는 undefined 로 둔다
 * (추측해서 싼 요율로 깎지 않는다 — 모르면 경로 기본값이 걸린다).
 */
export function parsePayMethod(raw: string | undefined | null): PayMethod | undefined {
  const t = (raw ?? "").replace(/\s/g, "").toLowerCase();
  if (!t) return undefined;
  if (/현금|계좌이체|무통장/.test(t)) return "cash";
  if (/체크|직불|debit/.test(t)) return "debit";
  if (/알리페이|위챗|유니온페이|alipay|wechat|해외|overseas/.test(t)) return "overseas";
  if (/제로페이|지역화폐|상품권|카카오머니|네이버포인트|포인트|머니/.test(t)) return "easyCash";
  if (/npay|네이버페이|n페이/.test(t)) return "npay";
  if (/신용|카드|card|삼성페이|애플페이|앱카드|간편/.test(t)) return "credit";
  return undefined;
}

// ============================================================
//  마스터
// ============================================================

/**
 * 과거 가격·재료비 한 구간.
 *
 * 판매가와 재료비는 **시간에 따라 바뀐다.** 2025-12 상품마스터와 2026-07
 * 상품마스터를 나란히 놓으면 여러 품목이 다르다 (일반AI 50ml 58,000 →
 * 48,000, 재료비 4,896 → 2,661 등). 한 줄에 하나의 가격만 두면 과거 달을
 * 적재할 때 전 건이 「금액 불일치」가 되고, 재료비도 틀린 값으로 계산된다.
 */
export interface SalesProductPeriod {
  /** 이 값이 적용되는 마지막 날짜 (YYYY-MM-DD, 이 날까지 포함) */
  until: string;
  price: number;
  material: number;
  note?: string;
}

/**
 * 직접재료비 한 줄 — 엑셀 「직접재료비」 시트의 한 행 (제품명·단가·수량·단위·금액·비고).
 *
 * 단가·수량은 소수가 실제로 있다 (향수베이스 5.5원/g, 질석 1.3원/g, 풀 장식 0.5g).
 * 그래서 줄 금액은 반올림하지 않고, **합계만** 원 단위로 반올림한다 — 엑셀 합계와
 * 같은 값이 나오게 하려면 그래야 한다.
 */
export interface SalesMaterialItem {
  /** 향료원액 · 공병(10ml) · 단박스 */
  name: string;
  /** 단위당 단가 (원) */
  unitPrice: number;
  /** 1개를 만들 때 드는 양 */
  qty: number;
  /** g · EA */
  unit?: string;
  /** 구입처 — 엑셀 「비고」 열 (새로핸즈 · 쿠팡 · 3D프린터) */
  supplier?: string;
}

/** 재료 한 줄의 금액 — 반올림하지 않는다 (위 주석) */
export const materialAmount = (i: SalesMaterialItem) =>
  (Number(i.qty) || 0) * (Number(i.unitPrice) || 0);

/** 재료 줄 합계 (원 단위 반올림) */
export const materialTotal = (items: SalesMaterialItem[]) =>
  Math.round(items.reduce((s, i) => s + materialAmount(i), 0));

/**
 * 저장 직전 정리 — 재료 줄이 있으면 재료비를 **줄에서 다시 계산**하고 빈 줄은 버린다.
 *
 * 집계·해석기·비서는 모두 material 한 숫자만 읽는다 (valueAt). 줄과 합계가
 * 어긋난 채 저장되면 화면마다 원가가 달라지므로, 어느 쪽에서 저장하든 이
 * 함수를 거친다 (mutate 라우트 product.upsert). normalizeEvent 와 같은 원칙.
 *
 * ⚠️ 과거 구간(history)의 재료비는 건드리지 않는다 — 줄은 **지금** 원가다.
 */
export function normalizeProduct(p: SalesProduct): SalesProduct {
  const out: SalesProduct = { ...p };
  const items = (p.materialItems ?? [])
    .map((i) => ({
      name: String(i.name ?? "").trim(),
      unitPrice: Number(i.unitPrice) || 0,
      qty: Number(i.qty) || 0,
      ...(String(i.unit ?? "").trim() ? { unit: String(i.unit).trim() } : {}),
      ...(String(i.supplier ?? "").trim() ? { supplier: String(i.supplier).trim() } : {}),
    }))
    .filter((i) => i.name);
  if (items.length > 0) {
    out.materialItems = items;
    out.material = materialTotal(items);
  } else {
    delete out.materialItems;
    out.material = Number(p.material) || 0;
  }
  return out;
}

/** 상품 1종 — 엑셀 「상품마스터」 한 줄 + 「직접재료비」에서 온 재료비 */
export interface SalesProduct {
  /** IDI-001 · IDE-002 · WOW-003 · ONL-001 */
  id: string;
  store: SalesStore;
  kind: SalesKind;
  /** 일반AI · 이벤트사쉐 */
  name: string;
  /** 10ml · 50ml×2 · 기본 */
  option: string;
  /** 실제로 받는 값 */
  price: number;
  /**
   * 직접재료비 1개당. materialItems 가 있으면 그 합계다 (저장할 때
   * normalizeProduct 가 맞춘다). 없으면 사람이 합계만 적은 값이다.
   * 계산은 모두 이 값만 본다.
   */
  material: number;
  /** 직접재료비 상세 줄 (엑셀 「직접재료비」 시트). 있으면 material 은 여기서 계산된다 */
  materialItems?: SalesMaterialItem[];
  /** 타임(분) — 접객 시간, 상시 인건비 배분의 근거 */
  timeMin: number;
  /** 제작(분) — 3D프린팅 등 별도 제작 시간 */
  makeMin: number;
  /** 세트 구성 병 수 (궁합·레이어링 세트 = 2). 낱개 상품은 1 */
  bottles: number;
  /**
   * 이 상품을 쓸 수 있는 이벤트 (코드 목록).
   *
   * 비어 있으면 **그 매장 전체**에서 쓴다 (기본). 값이 있으면 그 이벤트에
   * 귀속된 판매에만 후보로 뜬다.
   *
   * 왜 필요한가: 행사마다 그 행사만의 상품이 나온다 (뉴진스4주년의 18,000원
   * 품목처럼). 그걸 매장 공용 상품으로 넣으면 ① 마스터가 일회성 SKU 로
   * 차오르고 ② 다른 행사의 같은 금액이 그 상품으로 잘못 잡힌다. 협업 라인처럼
   * 여러 행사에 걸치는 것도 있어서 배열로 둔다.
   */
  eventIds?: string[];
  /** POS 결제 내역 문자열을 이 상품으로 읽는 별칭 */
  aliases?: string[];
  /**
   * 쿠폰 할인율 (0.3 = 30%). 엑셀 상품마스터의 「할인율 · 적용가」 열이다.
   * 해석기는 정가와 **할인가 둘 다** 정가로 인정한다 — 24,000 짜리가
   * 16,800 으로 찍혀 오면 그건 다른 상품이 아니라 쿠폰이 먹은 것이다.
   */
  discountRate?: number;
  /**
   * 과거 구간 (until 오름차순). 판매 줄의 날짜가 어느 구간에 들면 그 값을
   * 쓰고, 어디에도 안 들면 현재 값(price·material)을 쓴다.
   */
  history?: SalesProductPeriod[];
  note?: string;
  /**
   * 단가 근거가 아직 확정되지 않음 — 화면에 뱃지로 드러낸다.
   * 엑셀 상품마스터 IDI-013·014 비고: 「세트 포장재 단가 미확정」
   */
  unconfirmed?: boolean;
  /**
   * 엑셀 시트끼리 값이 어긋나는 항목. 어느 값을 쓰기로 했는지 남긴다.
   * (기본가정 vs 온라인 시트의 온라인 판매가 등)
   */
  conflict?: string;
  /**
   * 이 SKU 의 **실제 사진** (앱 안 경로). 있으면 화면이 유형별 공식 사진보다
   * 이것을 먼저 쓴다 — 같은 「50ml」라도 협업 라인은 포장이 다르기 때문이다.
   *
   * 표시 전용이다. 어떤 계산에도 들어가지 않는다.
   * 유형별 대표 사진 규칙은 lib/neander/sales/product-image.ts 참고.
   */
  imageUrl?: string;
}

/** 고정비·시급·수수료율 — 엑셀 「기본가정」 시트 */
export interface SalesAssumptions {
  /** 문서 1개 = 한 벌. id = "current" */
  id: string;
  /** 월 공통 고정비 */
  fixed: {
    rent: number;
    utility: number;
    telecom: number;
    insurance: number;
    etc: number;
  };
  /**
   * 고정비 배부 비율 (합 1.0). 엑셀은 와우·아이디 50:50, 온라인 0.
   *
   * ⚠️ 배부는 사실이 아니라 **경영 판단**이다. 재무 리포트가 쓰는 원칙
   *    (배분 전·후를 나란히 둔다)을 이 모듈도 그대로 따른다.
   */
  allocation: Record<SalesStore, number>;
  /** 시급 (원/시간) */
  wage: {
    /** 와우 이벤트 스태프 */
    eventStaff: number;
    /** 아이디 상시 (13–20시) */
    idRegular: number;
    /** 뿌디 제작 (3D프린팅) */
    puddi: number;
    /** 온라인 제작 */
    online: number;
  };
  /** 아이디 상시 운영 — 월 상시 인건비의 근거 */
  idOps: { hoursPerDay: number; daysPerMonth: number };
  /** 와우 이벤트 기본 운영시간 */
  wowOps: { hoursPerDay: number };
  /**
   * 수수료율 (소수, 부가세 별도). 경로와 결제수단으로 **하나만** 고른다 —
   * 겹쳐 더하지 않는다 (feeRateOf 참고). 우대등급은 반기마다 재산정되니
   * (1월 말·7월 말) 통지서가 오면 마스터에서 고친다.
   *
   * naverBooking · card 는 옛 문서와의 호환을 위해 필수로 남기고,
   * 나머지는 없으면 그 둘로 물러선다.
   */
  fee: {
    /** Npay 「예약」 — 영세 1.80% */
    naverBooking: number;
    /** 신용카드 — 영세 0.40% */
    card: number;
    /** Npay 「주문/매장방문결제」 — 영세 0.80%. 예약보다 싸다 */
    naverInStore?: number;
    /** Npay 해외발급카드(외국인) — 3.5%, 2026-01-05 시행 */
    naverOverseas?: number;
    /** 체크카드 — 영세 0.15% */
    debit?: number;
    /** 현금성 간편결제 — 우대 대상이 아니라 따로 받는다 */
    easyCash?: number;
    /** 해외발급카드·알리페이·위챗페이 */
    overseas?: number;
  };
  /**
   * 온라인 배송비 — **특정 시점까지 주문에 더해 받았다.**
   *
   * 관측: 2026-02~03 단품 주문에 3,000원이 붙었고(3월 시트에 「배송비」 열이
   * 그대로 있다), 복수 구매는 0 이었다. 2026-04 부터는 전부 0 — 배송비를
   * 없앴다.
   *
   * ⚠️ 기본가정 시트의 「10ml 판매가 28,000 (배송비 포함)」은 24,000 + **4,000**
   *    을 뜻하는데, 실제로 청구된 적은 없다. 그 값은 2~7월 내내 갱신되지
   *    않은 채 남아 있다. 실제 청구액은 3,000 이었다.
   *
   * 원가(5,116 등)에는 이미 배송비가 포함돼 있다(기본가정 「재료+배송」).
   * 배송비를 안 받게 되면서 **수입만 줄고 비용은 그대로**다 — 그게 이
   * 변화의 손익 효과다.
   */
  shipping?: {
    /** 건당 추가 금액 */
    fee: number;
    /** 이 날짜까지 받았다 (이후 무료). 비우면 지금도 받는다 */
    until?: string;
    /** 복수 구매는 무료였다 — 매칭에는 쓰지 않고 근거로 남긴다 */
    note?: string;
  };
  /**
   * 아이디 상시 인건비를 어디에 넣을지.
   *
   * ⚠️ 엑셀은 **같은 인건비를 두 번** 넣는다.
   *    · 변동비: 상시상품 줄마다 「타임인건비」 (7월 1,295,000원)
   *    · 고정비: 「상시 인건비」 7h × 30일 × 10,000 = 2,100,000원
   *    같은 사람의 같은 시간이다. 13–20시 고정 근무라 손님이 오든 안 오든
   *    지급되므로 **고정비가 맞고**, 타임인건비는 비용이 아니라 접객
   *    가동률을 보는 참고 숫자다.
   *
   *    "fixed"  — 고정비로만 (권장). 아이디 공헌이익이 엑셀보다
   *               1,295,000원 높게 나온다. 그게 맞는 숫자다.
   *    "excel"  — 엑셀 그대로 재현. 이관 검증용으로만 쓴다.
   */
  laborMode: "fixed" | "excel";
  updatedAt?: number;
  updatedBy?: string;
}

/**
 * 그 날짜에 유효한 판매가·재료비.
 *
 * 과거 구간이 없으면 현재 값이다. 이 함수를 통하지 않고 p.price 를 직접
 * 쓰면 과거 달의 원가가 조용히 틀린다.
 */
export function valueAt(
  p: SalesProduct,
  date: string,
): { price: number; material: number } {
  if (p.history && date) {
    for (const h of p.history) {
      if (date <= h.until) return { price: h.price, material: h.material };
    }
  }
  return { price: p.price, material: p.material };
}

/**
 * 그 날짜·매장에 붙던 배송비. 없으면 0.
 *
 * 온라인 매장에만 붙는다 — 매장에서 받아 가는 판매에는 배송이 없다.
 */
export function shippingFeeAt(
  a: SalesAssumptions,
  store: SalesStore,
  date: string,
): number {
  const s = a.shipping;
  if (!s || s.fee <= 0 || store !== "online") return 0;
  if (s.until && date > s.until) return 0;
  return s.fee;
}

/**
 * 이 줄에 실제로 걸리는 수수료율 — 경로와 결제수단으로 **하나만** 고른다.
 *
 * 결제수단을 모르면(원본에 열이 없으면) 경로의 기본값으로 본다:
 * 네이버는 Npay 예약, 나머지는 신용카드. 체크카드가 섞여 있었다면
 * 그만큼 과대계상이다 (영세 기준 최대 0.25%p).
 */
export function feeRateOf(
  route: PayRoute,
  fee: SalesAssumptions["fee"],
  method?: PayMethod,
): number {
  if (method === "cash") return 0;
  if (route === "naver") {
    // 네이버 예약은 Npay 수수료 하나로 끝난다 — 카드사 수수료가 따로 없다.
    if (method === "overseas") return fee.naverOverseas ?? fee.naverBooking;
    return fee.naverBooking;
  }
  if (method === "debit") return fee.debit ?? fee.card;
  if (method === "easyCash") return fee.easyCash ?? fee.card;
  if (method === "overseas") return fee.overseas ?? fee.card;
  return fee.card;
}

/** 월 고정비 합계 */
export function fixedTotal(a: SalesAssumptions): number {
  const f = a.fixed;
  return f.rent + f.utility + f.telecom + f.insurance + f.etc;
}

/** 아이디 월 상시 인건비 — 운영시간 × 운영일수 × 시급 */
export function idRegularLabor(a: SalesAssumptions): number {
  return a.idOps.hoursPerDay * a.idOps.daysPerMonth * a.wage.idRegular;
}

// ============================================================
//  이벤트
// ============================================================

/**
 * 준비물 한 줄 — 엑셀 「입력_이벤트준비물」 시트의 한 행.
 * 금액은 저장하지 않고 수량 × 단가로 계산한다 (시트도 그렇게 돼 있다).
 */
export interface SalesSupplyItem {
  /** 배너 · 시향지 · 향스 & 사스 */
  name: string;
  qty: number;
  unitPrice: number;
  /** 구매처·구분 — 직생 · 배너 · 애즈 · 레드 · 사칠 … (시트의 「카테고리」 열) */
  category?: string;
}

/** 준비물 한 줄의 금액 */
export const supplyAmount = (i: SalesSupplyItem) =>
  Math.round((Number(i.qty) || 0) * (Number(i.unitPrice) || 0));

/**
 * 방문자 하루치 — 엑셀 「방문자통계」 시트의 한 행.
 * 전환율은 하루 단위로 기록돼 있어야 "며칠째부터 떨어지는지"가 보인다.
 */
export interface SalesEventVisit {
  /** YYYY-MM-DD */
  date: string;
  buyers: number;
  nonBuyers: number;
  note?: string;
}

/** 이벤트 1건 — 「이벤트마스터」 + 「이벤트준비물」 + 「방문자통계」 */
export interface SalesEvent {
  /** WE-053 · ID-025 */
  id: string;
  store: SalesStore;
  name: string;
  /** YYYY-MM-DD */
  from: string;
  to: string;
  /** 일 운영시간 */
  hoursPerDay: number;
  /** 스태프 수 */
  staff: number;
  /** 시급 — 비워두면 기본가정의 eventStaff */
  wage?: number;
  /**
   * 준비물 비용 합계.
   *
   * supplyItems 가 있으면 그 합계다 (저장할 때 normalizeEvent 가 맞춘다).
   * 없으면 사람이 합계만 적은 값이다 — 엑셀에서 이관된 이벤트가 그렇다.
   * 집계(aggregate.ts)는 이 값만 본다.
   */
  supplies: number;
  /** 준비물 줄 (있으면 supplies 는 여기서 계산된다) */
  supplyItems?: SalesSupplyItem[];
  /**
   * 방문자 — 구매/미구매. 전환율의 근거.
   * visits 가 있으면 그 합계다 (normalizeEvent). 없으면 합계만 적은 값.
   */
  buyers?: number;
  nonBuyers?: number;
  /** 하루치 방문자 기록 (있으면 buyers·nonBuyers 는 여기서 계산된다) */
  visits?: SalesEventVisit[];
  note?: string;
  createdAt?: number;
  updatedAt?: number;
}

/** 준비물 합계 — 줄이 있으면 줄의 합, 없으면 적어 둔 합계 */
export function suppliesTotal(e: Pick<SalesEvent, "supplies" | "supplyItems">): number {
  if (e.supplyItems && e.supplyItems.length > 0) {
    return e.supplyItems.reduce((s, i) => s + supplyAmount(i), 0);
  }
  return Number(e.supplies) || 0;
}

/** 방문자 합계 — 하루치 기록이 있으면 그 합, 없으면 적어 둔 합계 */
export function visitTotals(
  e: Pick<SalesEvent, "buyers" | "nonBuyers" | "visits">,
): { buyers: number | undefined; nonBuyers: number | undefined } {
  if (e.visits && e.visits.length > 0) {
    return {
      buyers: e.visits.reduce((s, v) => s + (Number(v.buyers) || 0), 0),
      nonBuyers: e.visits.reduce((s, v) => s + (Number(v.nonBuyers) || 0), 0),
    };
  }
  return { buyers: e.buyers, nonBuyers: e.nonBuyers };
}

/**
 * 저장 직전 정리 — 줄이 있으면 합계를 줄에서 다시 계산하고, 빈 줄은 버린다.
 *
 * 합계 필드(supplies · buyers · nonBuyers)는 집계와 AI 도구가 그대로 읽는다.
 * 줄과 합계가 어긋난 채 저장되면 화면마다 다른 숫자가 나오므로, 어느 쪽에서
 * 저장하든 이 함수를 거친다 (mutate 라우트가 부른다).
 */
export function normalizeEvent(e: SalesEvent): SalesEvent {
  const out: SalesEvent = { ...e, name: e.name.trim(), id: e.id.trim() };
  const items = (e.supplyItems ?? [])
    .map((i) => ({
      name: String(i.name ?? "").trim(),
      qty: Number(i.qty) || 0,
      unitPrice: Number(i.unitPrice) || 0,
      ...(String(i.category ?? "").trim() ? { category: String(i.category).trim() } : {}),
    }))
    .filter((i) => i.name);
  if (items.length > 0) {
    out.supplyItems = items;
    out.supplies = items.reduce((s, i) => s + supplyAmount(i), 0);
  } else {
    delete out.supplyItems;
    out.supplies = Number(e.supplies) || 0;
  }
  const visits = (e.visits ?? [])
    .map((v) => ({
      date: String(v.date ?? "").slice(0, 10),
      buyers: Number(v.buyers) || 0,
      nonBuyers: Number(v.nonBuyers) || 0,
      ...(String(v.note ?? "").trim() ? { note: String(v.note).trim() } : {}),
    }))
    .filter((v) => /^\d{4}-\d{2}-\d{2}$/.test(v.date))
    .sort((a, b) => a.date.localeCompare(b.date));
  if (visits.length > 0) {
    out.visits = visits;
    out.buyers = visits.reduce((s, v) => s + v.buyers, 0);
    out.nonBuyers = visits.reduce((s, v) => s + v.nonBuyers, 0);
  } else {
    delete out.visits;
    if (e.buyers === undefined || e.buyers === null) delete out.buyers;
    if (e.nonBuyers === undefined || e.nonBuyers === null) delete out.nonBuyers;
  }
  if (out.wage === undefined || out.wage === null || Number.isNaN(Number(out.wage))) delete out.wage;
  if (!String(out.note ?? "").trim()) delete out.note;
  return out;
}

/** 이벤트 기간의 날짜 목록 (양끝 포함). 기간이 비었으면 빈 배열 */
export function eventDates(e: { from: string; to: string }): string[] {
  if (!e.from || !e.to || e.to < e.from) return [];
  const out: string[] = [];
  const cur = new Date(`${e.from}T00:00:00Z`);
  const end = new Date(`${e.to}T00:00:00Z`);
  if (Number.isNaN(cur.getTime()) || Number.isNaN(end.getTime())) return [];
  // 두 달을 넘는 이벤트는 없다 — 폭주 방지
  for (let i = 0; cur <= end && i < 92; i++) {
    out.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

/** 매장별 이벤트 코드 접두 — 엑셀 이벤트마스터의 WE-/ID- */
export const EVENT_CODE_PREFIX: Record<SalesStore, string> = {
  wow: "WE-",
  id: "ID-",
  online: "ON-",
};

/** 다음 이벤트 코드 — 그 매장의 가장 큰 번호 + 1 (WE-061 → WE-062) */
export function nextEventCode(store: SalesStore, events: Pick<SalesEvent, "id">[]): string {
  const prefix = EVENT_CODE_PREFIX[store];
  let max = 0;
  events.forEach((e) => {
    const m = e.id.match(/^([A-Z]+-)(\d+)$/);
    if (m && m[1] === prefix) max = Math.max(max, Number(m[2]));
  });
  return `${prefix}${String(max + 1).padStart(3, "0")}`;
}

/** 운영일수 (양끝 포함) */
export function eventDays(e: { from: string; to: string }): number {
  if (!e.from || !e.to) return 0;
  const a = Date.parse(e.from);
  const b = Date.parse(e.to);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.max(1, Math.round((b - a) / 86400000) + 1);
}

/** 이벤트 인건비 = 운영일수 × 일시간 × 스태프 × 시급 */
export function eventLabor(e: SalesEvent, a: SalesAssumptions): number {
  const wage = e.wage ?? a.wage.eventStaff;
  return eventDays(e) * e.hoursPerDay * e.staff * wage;
}

/** 구매전환율 (0~1). 방문자 기록이 없으면 null */
export function conversionRate(e: SalesEvent): number | null {
  const b = e.buyers ?? 0;
  const n = e.nonBuyers ?? 0;
  if (b + n === 0) return null;
  return b / (b + n);
}

/**
 * 이 상품을 그 이벤트의 판매에 쓸 수 있는가.
 *
 * 전용 이벤트가 지정된 상품은 **그 이벤트에만** 뜬다. 상시 판매(이벤트 귀속
 * 없음)에는 전용 상품이 뜨지 않는다 — 전용이라는 말이 그런 뜻이다.
 */
export function productInScope(
  p: Pick<SalesProduct, "eventIds">,
  eventId: string | undefined,
): boolean {
  if (!p.eventIds || p.eventIds.length === 0) return true;
  return !!eventId && p.eventIds.includes(eventId);
}

/**
 * 이벤트 표시 이름 — **이름과 코드를 함께** 보여준다.
 *
 * 코드만 보이면(ID-027) 어느 행사인지 알 수 없고, 이름만 보이면 엑셀
 * 이벤트마스터·준비물 시트와 맞춰 볼 수가 없다 — 그 시트들은 코드로 돌아간다.
 * 둘 다 필요하므로 한 군데서 만든다.
 *
 * 이벤트에 귀속되지 않은 줄은 「상시」다 (이벤트 기간 밖 판매).
 */
export function eventLabelOf(
  eventId: string | undefined,
  byId: Map<string, { id: string; name: string }>,
): string {
  if (!eventId) return "상시";
  const e = byId.get(eventId);
  return e ? `${e.name} (${e.id})` : eventId;
}

/** 날짜가 이 이벤트 기간 안인가 */
export function coversDate(e: { from: string; to: string }, date: string): boolean {
  return !!date && date >= e.from && date <= e.to;
}

// ============================================================
//  판매 줄 (적재 결과)
// ============================================================

/**
 * 해석 상태.
 *
 * ⚠️ 엑셀은 상품을 못 알아낸 매출을 「기타·미분류」로 묶고 원가를
 *    **평균원가율로 추정**했다. 2026-07 에 그 금액이 3,715,300원 —
 *    전체 매출의 15% 다. 이 모듈은 추정하지 않고 needs_review 로 남겨
 *    사람이 판단하게 한다. 숨기지 않는 것이 이 이관의 핵심이다.
 */
export type SalesLineStatus =
  /** 상품까지 확정 — 원가 계산에 들어간다 */
  | "resolved"
  /** 상품을 못 정했다 — 검토 대기함으로 */
  | "needs_review"
  /** 사람이 직접 적은 줄 (잡수익 등). 원가는 적은 값만 쓴다 */
  | "manual";

/** 해석 실패 이유 — 대기함에서 묶어 보여주고, 규칙을 고칠 단서가 된다 */
export type SalesLineReason =
  /** "외 1건" 처럼 한 줄에 여러 상품이 묶였다 */
  | "multi_item"
  /** "금액 입력" — POS 에서 상품 없이 금액만 찍었다 */
  | "amount_only"
  /** 별칭 표에 없는 이름 */
  | "unknown_item"
  /** 이름은 알았는데 금액이 정가 조합과 안 맞는다 (할인·쿠폰 의심) */
  | "price_mismatch"
  /** 환불 건 */
  | "refunded";

export const REASON_LABEL: Record<SalesLineReason, string> = {
  multi_item: "복합 결제",
  amount_only: "금액만 입력",
  unknown_item: "모르는 상품명",
  price_mismatch: "금액 불일치",
  refunded: "환불",
};

export const REASON_HINT: Record<SalesLineReason, string> = {
  multi_item: "한 결제에 상품이 여러 개 묶여 있습니다. 「조합으로 나누기」로 상품별로 나눠 확정하세요.",
  amount_only: "POS 에서 상품 없이 금액만 찍은 건입니다.",
  unknown_item: "상품 별칭 표에 없는 이름입니다. 마스터에 별칭을 추가하세요.",
  price_mismatch: "상품은 알았지만 금액이 정가와 맞지 않습니다 (할인·쿠폰 의심).",
  refunded: "환불된 건이라 매출에서 빼야 합니다.",
};

/** 할인 적용 기록 — 정가 합계와 할인율 (할인액 = list − amount) */
export interface SalesLineDiscount {
  /** 그 날짜 정가 × 수량 */
  list: number;
  /** 0.1 = 10% · 할인액 ÷ 정가 합계 */
  rate: number;
}

/** 적재된 판매 한 줄 */
export interface SalesLine {
  id: string;
  /** YYYY-MM-DD */
  date: string;
  store: SalesStore;
  route: PayRoute;
  /** 실제 결제 금액 (이 줄의 매출) */
  amount: number;
  /** 확정된 상품 (resolved 일 때만) */
  productId?: string;
  /** 수량 — 세트는 세트 수 */
  qty: number;
  status: SalesLineStatus;
  reason?: SalesLineReason;
  /** 원본 결제 내역 문자열 — 판단의 근거라 항상 남긴다 */
  raw: string;
  /** 기간으로 귀속된 이벤트. 없으면 상시 */
  eventId?: string;
  /** 이 줄을 만든 적재 배치 (되돌리기 단위) */
  importId?: string;
  /**
   * 사람이 직접 적은 재료비 — manual 줄에서만 쓴다.
   * resolved 줄의 재료비는 마스터에서 계산하므로 저장하지 않는다
   * (마스터를 고치면 과거 숫자도 같이 맞아야 한다).
   */
  manualMaterial?: number;
  /**
   * 이 결제에 포함된 배송비. 상품 금액에 더해 받은 값이라 매출에는 들어간다.
   * 어느 줄이 배송비를 품고 있는지 남겨 두지 않으면 나중에 되짚을 수 없다.
   */
  shippingFee?: number;
  /**
   * 결제수단 — 수수료율이 여기서 갈린다. 원본에 열이 있을 때만 채운다.
   * 비어 있으면 경로의 기본값(네이버 Npay · 나머지 신용카드)으로 본다.
   */
  payMethod?: PayMethod;
  /**
   * 조합으로 나눈 줄이면 원래 결제 줄의 id. 「샤쉐 외 1건」 53,000 이
   * 사쉐 + 50ml 두 줄이 될 때 두 번째 줄에 붙는다 — 한 결제였다는 흔적.
   */
  splitFrom?: string;
  /**
   * 이벤트 기간에 온 **일반 손님**이라 이벤트 매출에서 뗀 줄. eventId 는 비어 있고,
   * 이벤트를 다시 저장해도 날짜로 다시 붙지 않는다 (reattachEventLines 가 지킨다).
   * 이벤트는 매장을 통째로 쓰지 않는 날도 있어서, 같은 날 같은 매장이라도
   * 이벤트 손님이 아닌 판매가 섞인다.
   */
  eventOptOut?: boolean;
  /**
   * 할인해서 받은 줄 — 검토 대기함 「할인 적용」으로 확정했을 때만 붙는다.
   * 매출은 여전히 amount(실제 결제액)다. 정가와 할인율을 남기는 이유는
   * "왜 69,300 인가"를 나중에 되짚고, 할인 행사의 크기를 셀 수 있게 하려는 것.
   */
  discount?: SalesLineDiscount | null;
  memo?: string;
  /**
   * 이 줄을 만든 **사이트 자동 동기화**의 출처 (lib/neander/sync).
   * 손으로 올린 엑셀 줄에는 없다.
   *
   * 있으면 그 줄의 주인은 동기화다 — 사이트에서 주문이 바뀌면 다시 덮어쓰고,
   * 매출이 아니게 되면(취소·전액환불) 지운다. 단 **사람이 한 번 고치면
   * 주인이 사람으로 바뀐다** (updatedBy 가 사람 이메일이 된다). 그 뒤로는
   * 동기화가 손대지 않고 어긋난 사실만 알린다 — 사람이 대기함에서 판단해
   * 확정한 것을 기계가 조용히 되돌리면 안 된다.
   */
  syncSource?: string;
  /**
   * 동기화가 만든 줄의 사이트 주문 id. 사이트에서 주문이 **지워지면** 피드에
   * 다시 나타나지 않으므로, ERP 가 가진 주문 id 를 모아 "아직 있나"를
   * 되물을 때 쓴다 (sync/server/pull.ts reconcileOnline).
   */
  syncOrderId?: string;
  /** 동기화가 이 줄을 마지막으로 맞춘 시각 */
  syncedAt?: number;
  createdAt?: number;
  updatedAt?: number;
  updatedBy?: string;
}

export type SalesLineInput = Omit<SalesLine, "id">;

/** 이 줄이 이벤트 실적인가 */
export const isEventLine = (l: SalesLine) => !!l.eventId;

/** 적재 배치 — 파일 하나가 배치 하나. 되돌리기가 "그 파일만" 이어야 쓸모가 있다 */
export interface SalesImportBatch {
  id: string;
  /** 원본 파일명 */
  fileName: string;
  /** 페이히어 · 네이버 예약 */
  sourceLabel: string;
  store: SalesStore;
  route: PayRoute;
  /** 적재한 기간 */
  from?: string;
  to?: string;
  /** 만든 줄 수 */
  rows: number;
  resolved: number;
  needsReview: number;
  /** 원본 합계 — 대사의 기준 */
  sourceTotal: number;
  /** 적재된 줄의 합계. sourceTotal 과 달라지면 어딘가 빠진 것이다 */
  loadedTotal: number;
  createdAt: number;
  createdBy?: string;
  /** 되돌렸는가 */
  undone?: boolean;
}

// ============================================================
//  표시 도우미
// ============================================================

/** 0.7352 → "73.5%" */
export function pct(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(digits)}%`;
}

/** 비율 계산 — 분모 0 이면 null (0% 로 보이면 안 된다) */
export function ratio(num: number, den: number): number | null {
  if (!den) return null;
  return num / den;
}
