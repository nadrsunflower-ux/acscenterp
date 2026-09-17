// ============================================================
//  매출 마스터 기준 데이터 — 「2607악센트원가계산.xlsx」에서 뽑음
// ------------------------------------------------------------
//  최초 1회 「마스터 적재」로 Firestore 에 넣는다. 문서 id 가 상품코드라
//  여러 번 눌러도 중복되지 않고 덮어쓴다 (재무 마스터와 같은 방식).
//
//  적재한 뒤에는 **화면에서 고친다.** 세트 포장재 단가처럼 아직 확정되지
//  않은 값이 있어서, 코드에 박아두면 고칠 때마다 배포해야 한다.
//
//  ⚠️ 옮기면서 발견한 시트 간 불일치는 지우지 않고 conflict 로 남긴다.
//     어느 값을 쓰기로 했는지가 나중에 반드시 문제가 된다.
// ============================================================

import type { SalesAssumptions, SalesEvent, SalesProduct } from "./types";

/** 기본가정 시트 — 고정비 5,565,000 / 시급 10,000 / 수수료는 아래 fee 주석 참고 */
export const SEED_ASSUMPTIONS: SalesAssumptions = {
  id: "current",
  fixed: {
    rent: 5_170_000, // 와우+아이디 공동
    utility: 200_000, // 전기·수도·가스
    telecom: 80_000,
    insurance: 15_000,
    etc: 100_000,
  },
  // 엑셀은 와우·아이디 50:50, 온라인 0. 배부는 판단이므로 화면에서 바꾼다.
  allocation: { wow: 0.5, id: 0.5, online: 0 },
  // 2026 최저임금 10,320원 — 와우·아이디(이벤트 스태프·상시·제작)만 올렸다 (2026-09-15 사용자 결정).
  // 온라인은 범위 밖이라 그대로.
  wage: {
    eventStaff: 10_320,
    idRegular: 10_320,
    puddi: 10_320,
    online: 10_000,
  },
  idOps: { hoursPerDay: 7, daysPerMonth: 30 }, // 13–20시
  wowOps: { hoursPerDay: 8 },
  // 수수료 (부가세 별도). 엑셀은 네이버 건에 1.8%+2.2% 를 합산했지만 Npay
  // 수수료에 카드 처리 비용이 이미 들어 있어 겹치지 않는다 (types.ts 참고).
  //  · naverBooking 1.80% — Npay 「예약」 영세(연 3억 이하) 요율, 네이버 공식
  //    안내 help.naver.com/service/30026/contents/20749 (2026-09 확인).
  //  · card 0.40% — 여전법 우대수수료율, 영세(연 3억 이하) 신용카드.
  //    2026-02-14 시행(그 전 0.50%), 체크카드는 0.15%. 엑셀의 2.2% 는
  //    연매출 30억 초과 일반가맹점 요율대(상한 2.3%)라 우리 등급이 아니다.
  //    ⚠️ 온라인(자사몰)은 PG 를 거치면 PG 몫이 더 붙을 수 있다 — 미확인.
  fee: {
    // 네이버도 카드와 같은 국세청 신고매출로 등급이 정해진다. 카드가
    // 중소1 로 실측됐으므로 Npay 도 중소1 로 맞춘다 (공식 표: 예약 2.35 ·
    // 주문/매장방문결제 1.35 · 해외발급카드는 등급 무관 3.5%).
    // 영세였다면 1.80 / 0.80 이다.
    naverBooking: 0.0235,
    // 카드는 추정값이 아니라 **실측값**이다. 여신금융협회 「기간별 매입내역
    // 세부내역」(와우, 2026-06-30~07-29 · 145건 3,558,000원)의 건별
    // 가맹점수수료를 매입금액으로 나눈 값:
    //   신용카드 1.000% (KB·우리·비씨·롯데·농협 전부 같다 — 카드사 무관)
    //   체크카드 0.750% · 「기타」 0.750% (KB 계열, 체크와 같은 요율)
    //   실효 0.797% · 기타수수료 0 · 부가세대리납부 0
    // → 우리는 영세(0.40/0.15)가 아니라 **중소1(연 3~5억)** 구간이다.
    //   우대등급은 법인 전체 매출로 정해지므로 악센트 매출만으로는 못 맞춘다.
    card: 0.01,
    debit: 0.0075,
    naverInStore: 0.0135,
    naverOverseas: 0.035,
    // 현금성 간편결제·해외 간편결제는 공개 요율이 없다 — 계약서·정산 내역을
    // 보고 채워야 한다. 그때까지는 신용카드 요율로 물러선다(undefined).
  },
  // 온라인 배송비 — 2026-03 까지 단품 주문에 3,000원. 4월부터 없앴다.
  // 기본가정 시트가 말하는 4,000원(28,000 = 24,000+4,000)은 갱신되지 않은
  // 가정이고, 실제 청구액은 3,000원이었다 (3월 시트의 「배송비」 열).
  shipping: {
    fee: 3_000,
    until: "2026-03-31",
    note: "단품 주문만 3,000원 · 복수 구매는 0 (2026-03 시트 실측). 2026-04 부터 전부 무료",
  },
  // 엑셀은 타임인건비(변동비)와 상시 인건비(고정비)를 함께 넣어 같은
  // 인건비를 두 번 셌다. 기본값은 맞는 처리인 "fixed" 로 둔다.
  laborMode: "fixed",
};

/**
 * 상품 29종 — 엑셀 상품마스터 22종 + 온라인 4종(온라인 시트 실적에서) +
 * 최애연구소 입장권 · 쿠폰 추가결제 · 포도알 50ml 각 1종(실적에서).
 *
 * aliases 는 POS 결제 내역 문자열을 읽는 근거다. 실제 원본에 찍힌 표기를
 * 그대로 넣었다 — 페이히어 와우에는 「샤쉐」로 찍힌다(사쉐 오타).
 *
 * history 는 2025-12 상품마스터에서 가져온 과거 구간이다. 그 달에는 일반·
 * 뿌덕 50ml 이 58,000원(재료비 4,896)이었고 아이디 이벤트 50ml 이
 * 48,000원(2,724)이었다. 기간을 구분하지 않으면 2025-12 를 적재할 때 전
 * 건이 「금액 불일치」가 되고 재료비도 틀린 값으로 계산된다.
 */
export const SEED_PRODUCTS: SalesProduct[] = [
  // ---- 아이디 상시 (IDI) ------------------------------------
  {
    id: "IDI-001", store: "id", kind: "regular", name: "일반AI", option: "10ml",
    price: 24_000, material: 1_692, timeMin: 30, makeMin: 0, bottles: 1,
    discountRate: 0.3,
    history: [{ until: "2025-12-31", price: 24_000, material: 1_643 }],
    aliases: [
      "일반 10ml 향수", "일반AI 10ml", "퍼스널센트 10ml", "10ml 맞춤형 향수",
      "퍼스널센트 AI 이미지 분석 퍼퓸",
      // 네이버 상품명 (1~7월 99건). 일반AI·뿌덕AI 는 판매가·재료비가
      // 같으므로 어느 쪽으로 읽어도 숫자가 달라지지 않는다.
      "AI 이미지 분석을 통한 향 추천 및 향수 제작",
      "최애연구소 10ml 향수",
    ],
  },
  {
    id: "IDI-002", store: "id", kind: "regular", name: "일반AI", option: "50ml",
    price: 48_000, material: 2_661, timeMin: 30, makeMin: 0, bottles: 1,
    discountRate: 0.3,
    history: [
      { until: "2025-12-31", price: 58_000, material: 4_896 },
      {
        // 2026-01 부터 58,000 → 48,000 인하(확정). 그런데 네이버 예약은
        // **예약 시점 가격**이 청구되고 우리 날짜는 이용일시라, 3월까지
        // 58,000 건이 들어왔다 (실측 2026-01~03 30건). 재료비는 이미
        // 2,661 로 내려간 뒤라 가격만 과거 값을 인정한다.
        until: "2026-03-31",
        price: 58_000,
        material: 2_661,
        note: "인하 후 예약 잔여분 — 48,000 도 함께 인정된다(pricesOf 주석)",
      },
    ],
    aliases: [
      "일반 50ml 향수", "일반AI 50ml", "퍼스널센트 50ml", "50ml 맞춤형 향수",
      "퍼스널센트 AI 이미지 분석 퍼퓸",
      "AI 이미지 분석을 통한 향 추천 및 향수 제작",
      "최애연구소 50ml 향수",
    ],
  },
  {
    id: "IDI-003", store: "id", kind: "regular", name: "뿌덕AI", option: "10ml",
    price: 24_000, material: 1_692, timeMin: 30, makeMin: 0, bottles: 1,
    discountRate: 0.3,
    history: [{ until: "2025-12-31", price: 24_000, material: 1_643 }],
    aliases: [
      "뿌덕 10ml 향수", "뿌덕AI 10ml", "뿌리는 덕질 10ml",
      "뿌리는 덕질 AI 이미지 분석 퍼퓸",
      // 네이버 최다 상품 (1~7월 517건) — 「…분석 편」 표기
      "뿌리는 덕질 AI 이미지 분석 편",
    ],
  },
  {
    id: "IDI-004", store: "id", kind: "regular", name: "뿌덕AI", option: "50ml",
    price: 48_000, material: 2_661, timeMin: 30, makeMin: 0, bottles: 1,
    discountRate: 0.3,
    history: [
      { until: "2025-12-31", price: 58_000, material: 4_896 },
      {
        // 2026-01 부터 58,000 → 48,000 인하(확정). 그런데 네이버 예약은
        // **예약 시점 가격**이 청구되고 우리 날짜는 이용일시라, 3월까지
        // 58,000 건이 들어왔다 (실측 2026-01~03 30건). 재료비는 이미
        // 2,661 로 내려간 뒤라 가격만 과거 값을 인정한다.
        until: "2026-03-31",
        price: 58_000,
        material: 2_661,
        note: "인하 후 예약 잔여분 — 48,000 도 함께 인정된다(pricesOf 주석)",
      },
    ],
    aliases: [
      "뿌덕 50ml 향수", "뿌덕AI 50ml", "뿌리는 덕질 50ml",
      "뿌리는 덕질 AI 이미지 분석 퍼퓸",
      "뿌리는 덕질 AI 이미지 분석 편",
    ],
  },
  {
    id: "IDI-005", store: "id", kind: "regular", name: "뿌디(오프라인)", option: "기본",
    price: 48_000, material: 4_352, timeMin: 30, makeMin: 30, bottles: 1,
    history: [{ until: "2025-12-31", price: 48_000, material: 5_197 }],
    aliases: ["뿌디", "피규어 디퓨저", "피규어 화분 디퓨저", "뿌디 화분 디퓨저"],
    note: "사전제작",
  },
  {
    id: "IDI-006", store: "id", kind: "regular", name: "뿌디(온라인)", option: "기본",
    price: 48_000, material: 9_412, timeMin: 30, makeMin: 30, bottles: 1,
    history: [{ until: "2025-12-31", price: 52_000, material: 9_363 }],
    note: "온라인배송",
  },
  {
    id: "IDI-007", store: "id", kind: "regular", name: "일반AI(온라인)", option: "10ml",
    price: 24_000, material: 5_116, timeMin: 0, makeMin: 10, bottles: 1,
    note: "온라인 — 할인·배송비 없음",
  },
  {
    id: "IDI-008", store: "id", kind: "regular", name: "일반AI(온라인)", option: "50ml",
    price: 48_000, material: 8_218, timeMin: 0, makeMin: 10, bottles: 1,
    note: "온라인 — 할인·배송비 없음",
  },
  {
    id: "IDI-009", store: "id", kind: "regular", name: "뿌덕AI(온라인)", option: "10ml",
    price: 24_000, material: 5_116, timeMin: 0, makeMin: 10, bottles: 1,
    note: "온라인 — 할인·배송비 없음",
  },
  {
    id: "IDI-010", store: "id", kind: "regular", name: "뿌덕AI(온라인)", option: "50ml",
    price: 48_000, material: 8_218, timeMin: 0, makeMin: 10, bottles: 1,
    note: "온라인 — 할인·배송비 없음",
  },
  {
    id: "IDI-011", store: "id", kind: "regular", name: "궁합퍼퓸세트(커플센트)", option: "10ml×2",
    price: 44_000, material: 3_536, timeMin: 30, makeMin: 0, bottles: 2,
    aliases: ["궁합퍼퓸", "커플센트", "커플센트 궁합 퍼퓸 세트"], note: "네이버예약 전용 세트",
  },
  {
    id: "IDI-012", store: "id", kind: "regular", name: "궁합퍼퓸세트(커플센트)", option: "50ml×2",
    price: 88_000, material: 5_335, timeMin: 30, makeMin: 0, bottles: 2,
    aliases: ["궁합퍼퓸 50", "커플센트 궁합 퍼퓸 세트"], note: "네이버예약 전용 세트",
  },
  {
    id: "IDI-013", store: "id", kind: "regular", name: "레이어링 퍼퓸 세트", option: "10ml×2",
    price: 44_000, material: 3_664, timeMin: 30, makeMin: 0, bottles: 2,
    aliases: ["레이어링", "레이어링 퍼퓸 세트"], note: "네이버예약 전용 세트",
    unconfirmed: true,
  },
  {
    id: "IDI-014", store: "id", kind: "regular", name: "레이어링 퍼퓸 세트", option: "50ml×2",
    price: 88_000, material: 5_406, timeMin: 30, makeMin: 0, bottles: 2,
    aliases: ["레이어링 퍼퓸 세트"], note: "네이버예약 전용 세트",
    unconfirmed: true,
  },

  {
    // 쿠폰 오적용 추가결제 — 엑셀 상품마스터의 「오적용추가결제」 열
    // (10ml 7,200 · 50ml 14,400 = 정가의 30%)과 매출집계의 「쿠폰추가
    // ×1/×2/×3」 패턴이 가리키는 것. 재료가 나가지 않고 **금액만** 더
    // 받는 건이라 재료비가 0 인 것이 맞다.
    //
    // ⚠️ **별칭을 일부러 두지 않는다.** POS 에는 「금액 입력」으로만 찍혀
    //    오는데, 그 문구는 쿠폰 추가결제일 수도 있고 수기 판매일 수도 있다.
    //    금액만 보고 자동으로 단정하면 엑셀이 하던 금액 역산과 같아진다.
    //    검토 대기함에서 사람이 고를 수 있게 **자리만** 만들어 둔다.
    id: "IDI-015", store: "id", kind: "regular", name: "쿠폰 추가결제", option: "기본",
    price: 7_200, material: 0, timeMin: 0, makeMin: 0, bottles: 1,
    note: "재료 없이 금액만 추가로 받는 건 — 검토 대기함에서 직접 지정",
  },

  // ---- 2026-09 네이버 예약 옵션에서 추가 (스마트플레이스 › 옵션관리 14개 대조) ----
  //  8월 예약에 이미 찍혀 대기함에 쌓여 있던 것들이다. 8월 실청구가가 지금
  //  목록가보다 낮아서(클리커 9,900 · 오행 44,000/22,000) 그 값을 과거 구간으로
  //  둔다 — 목록가로 오른 정확한 날짜는 모르므로 8월 말까지로 적었다.
  //  재료비를 모르는 것은 unconfirmed 로 드러낸다.
  {
    id: "IDI-016", store: "id", kind: "regular", name: "오행 퍼퓸", option: "50ml",
    price: 48_000, material: 2_661, timeMin: 30, makeMin: 0, bottles: 1,
    aliases: ["데스티니 오행 퍼퓸", "[AI조향사] 오행 퍼퓸(50ml)"],
    history: [{ until: "2026-08-31", price: 44_000, material: 2_661, note: "8월 실청구가" }],
    unconfirmed: true,
    note: "[사주분석] 데스티니 오행 퍼퓸 · 재료비는 일반AI 50ml 와 같다고 가정",
  },
  {
    id: "IDI-017", store: "id", kind: "regular", name: "오행 퍼퓸", option: "10ml",
    price: 24_000, material: 1_692, timeMin: 30, makeMin: 0, bottles: 1,
    aliases: ["데스티니 오행 퍼퓸", "[AI조향사] 오행 퍼퓸(10ml)"],
    history: [{ until: "2026-08-31", price: 22_000, material: 1_692, note: "8월 실청구가" }],
    unconfirmed: true,
    note: "[사주분석] 데스티니 오행 퍼퓸 · 재료비는 일반AI 10ml 와 같다고 가정",
  },
  {
    id: "IDI-018", store: "id", kind: "regular", name: "키캡클리커디퓨저", option: "기본",
    price: 12_900, material: 0, timeMin: 0, makeMin: 0, bottles: 1,
    aliases: ["키캡클리커디퓨저", "[AI조향사] 키캡클리커디퓨저"],
    history: [{ until: "2026-08-31", price: 9_900, material: 0, note: "8월 실청구가" }],
    unconfirmed: true,
    note: "예약 추가 옵션 · 재료비 미확인",
  },
  {
    id: "IDI-019", store: "id", kind: "regular", name: "음양오행 클리커", option: "기본",
    price: 12_900, material: 0, timeMin: 0, makeMin: 0, bottles: 1,
    aliases: ["음양오행 클리커", "[AI조향사] 음양오행 클리커"],
    history: [{ until: "2026-08-31", price: 9_900, material: 0, note: "8월 실청구가" }],
    unconfirmed: true,
    note: "예약 추가 옵션 · 재료비 미확인",
  },
  {
    // 네이버 옵션은 넷(50ml 38,400·33,600 / 10ml 19,200·16,800)이지만 같은 향수의
    // 기간별 할인가라 용량당 한 상품에 구간으로 둔다 (IDI-002 의 58,000→48,000 과 같은 방식).
    id: "IDI-020", store: "id", kind: "regular", name: "한가위 퍼퓸", option: "50ml",
    price: 33_600, material: 2_661, timeMin: 30, makeMin: 0, bottles: 1,
    aliases: ["풍성한 한가위 퍼퓸", "[풍성한 한가위] 퍼퓸(50ml)"],
    history: [{ until: "2026-09-23", price: 38_400, material: 2_661, note: "9/16~9/23 20% 할인" }],
    note: "한가위 할인 옵션 — 9/16~9/23 38,400 · 9/26~9/27 33,600 (48,000 기준 20%·30%)",
  },
  {
    id: "IDI-021", store: "id", kind: "regular", name: "한가위 퍼퓸", option: "10ml",
    price: 16_800, material: 1_692, timeMin: 30, makeMin: 0, bottles: 1,
    aliases: ["풍성한 한가위 퍼퓸", "[풍성한 한가위] 퍼퓸(10ml)"],
    history: [{ until: "2026-09-23", price: 19_200, material: 1_692, note: "9/16~9/23 20% 할인" }],
    note: "한가위 할인 옵션 — 9/16~9/23 19,200 · 9/26~9/27 16,800 (24,000 기준 20%·30%)",
  },

  // ---- 아이디 이벤트 (IDE) ----------------------------------
  {
    id: "IDE-001", store: "id", kind: "event", name: "이벤트향수", option: "10ml",
    price: 24_000, material: 1_642, timeMin: 30, makeMin: 1, bottles: 1,
    discountRate: 0.3,
    aliases: ["이벤트 10ml", "포도알 10ml 향수", "AC'SCENTXPODOAL", "[포도알이벤트] 퍼퓸(10ml)"],
    note: "네이버 이벤트 예약(포도알·밤비 등)이 이 이름으로 들어온다",
  },
  {
    id: "IDE-002", store: "id", kind: "event", name: "이벤트향수", option: "50ml",
    // 2026-09-12 확정: **2026 엑셀 마스터의 38,000 이 오류**이고 48,000 이
    // 맞다. 2025-12 마스터도 48,000 이었고 POS 도 줄곧 48,000 으로 찍혀
    // 왔다(1~7월 116건). 재료비만 2025-12 에 2,724 였다.
    price: 48_000, material: 2_592, timeMin: 30, makeMin: 2, bottles: 1,
    history: [{ until: "2025-12-31", price: 48_000, material: 2_724 }],
    aliases: ["이벤트 50ml"],
  },
  {
    id: "IDE-003", store: "id", kind: "event", name: "이벤트사쉐", option: "기본",
    price: 15_000, material: 534, timeMin: 30, makeMin: 3, bottles: 1,
    aliases: ["사쉐", "샤쉐"],
  },
  {
    id: "IDE-004", store: "id", kind: "event", name: "이벤트피규어디퓨저", option: "기본",
    price: 38_000, material: 3_440, timeMin: 30, makeMin: 30, bottles: 1,
    aliases: ["피규어 디퓨저", "피규어디퓨저"],
    note: "재료비는 이벤트뿌디와 동일 가정",
  },

  {
    // 포도알 협업 50ml — **38,000 원**. 일반 이벤트 50ml(48,000)과 값이
    // 달라 같은 상품으로 둘 수 없다. 실측: 「포도알 50ml 향수」와 네이버
    // 「AC'SCENTXPODOAL[…]」이 38,000 · 76,000(×2) · 114,000(×3) 으로
    // 찍힌다 (1~7월 46건 2,356,000원 + 2025-12 6건).
    id: "IDE-007", store: "id", kind: "event", name: "포도알 이벤트향수", option: "50ml",
    price: 38_000, material: 2_592, timeMin: 30, makeMin: 2, bottles: 1,
    history: [{ until: "2025-12-31", price: 38_000, material: 2_724 }],
    aliases: ["포도알 50ml 향수", "AC'SCENTXPODOAL", "[포도알이벤트] 퍼퓸(50ml)"],
    note: "협업 라인 — 일반 이벤트 50ml 과 판매가가 다르다",
  },
  {
    // 1~7월 페이히어 6건 + 네이버 「[POP-UP] 최애연구소 팝업 방문」 64건.
    // 상품마스터에는 없던 품목이라 여기서 새로 만든다 — 입장권이라
    // 직접재료비가 없는 것이 맞다.
    id: "IDE-005", store: "id", kind: "event", name: "최애연구소 입장권", option: "기본",
    price: 6_000, material: 0, timeMin: 0, makeMin: 0, bottles: 1,
    aliases: ["최애연구소 입장권", "최애연구소 팝업 방문", "최애연구소 팝업입장권"],
    note: "팝업 입장권 — 상품마스터에 없어 실적에서 만든 항목",
  },

  // ---- 와우 이벤트 (WOW) ------------------------------------
  {
    id: "WOW-001", store: "wow", kind: "event", name: "이벤트향수", option: "50ml",
    price: 38_000, material: 2_592, timeMin: 30, makeMin: 0, bottles: 1,
    history: [{ until: "2025-12-31", price: 38_000, material: 2_724 }],
    aliases: ["50ml 향수", "이벤트 50ml", "50ml"],
  },
  {
    id: "WOW-002", store: "wow", kind: "event", name: "이벤트사쉐", option: "기본",
    price: 15_000, material: 534, timeMin: 30, makeMin: 0, bottles: 1,
    aliases: ["샤쉐", "사쉐", "성진 사쉐"],
  },
  {
    id: "WOW-003", store: "wow", kind: "event", name: "이벤트뿌디", option: "기본",
    price: 38_000, material: 3_440, timeMin: 30, makeMin: 30, bottles: 1,
    aliases: ["피규어 디퓨저", "뿌디", "피규어디퓨저"],
  },
  {
    id: "WOW-004", store: "wow", kind: "event", name: "이벤트향수", option: "10ml",
    price: 24_000, material: 1_642, timeMin: 30, makeMin: 0, bottles: 1,
    aliases: ["10ml 향수", "10ml"],
  },

  // ---- 온라인 (ONL) -----------------------------------------
  //  ⚠️ 별칭에 `상품유형/옵션` 꼴의 문자열이 섞여 있는 것은 오타가 아니다.
  //     acscent.co.kr 주문을 자동으로 받을 때(lib/neander/sync) 그 사이트의
  //     상품 키가 그대로 별칭으로 걸린다. 매칭 표를 코드에 두지 않고 **마스터
  //     에서 고칠 수 있게** 하려는 것이다 — 사이트에 새 상품이 생기면 상품
  //     관리 화면에서 별칭 한 줄만 더하면 된다.
  //
  //     긴 별칭이 이기므로(resolve.ts byAlias) `saju_perfume/50ml` 가 `50ml`
  //     보다 먼저 걸린다. 그래야 사주 50ml(44,000)이 일반 50ml(48,000)로
  //     잘못 잡히지 않는다.
  //  ⚠️ 판매가가 시트마다 다르다. 기본가정 시트는 「10ml 28,000 · 50ml
  //     38,000(배송비 포함)」인데, 온라인 시트의 7월 실적은 10ml 7건
  //     168,000원(= 24,000/개) · 50ml 6건 288,000원(= 48,000/개) 이다.
  //     실제로 받은 값을 쓰고, 어긋난 사실은 conflict 로 남긴다.
  {
    id: "ONL-001", store: "online", kind: "regular", name: "온라인향수", option: "10ml",
    price: 24_000, material: 5_116, timeMin: 0, makeMin: 10, bottles: 1,
    aliases: [
      "10ml",
      "image_analysis/10ml",
      "personal_scent/10ml",
      "today_scent/10ml",
      "signature/10ml",
      "graduation/10ml",
    ],
    conflict: "기본가정 시트는 28,000원(배송비 포함). 7월 실적은 24,000원으로 팔렸다.",
  },
  {
    id: "ONL-002", store: "online", kind: "regular", name: "온라인향수", option: "50ml",
    price: 48_000, material: 8_218, timeMin: 0, makeMin: 10, bottles: 1,
    aliases: [
      "50ml",
      "image_analysis/50ml",
      "personal_scent/50ml",
      "today_scent/50ml",
      "signature/50ml",
      "graduation/50ml",
    ],
    conflict: "기본가정 시트는 38,000원(무료배송). 7월 실적은 48,000원으로 팔렸다.",
  },
  {
    id: "ONL-003", store: "online", kind: "regular", name: "온라인뿌디", option: "기본",
    price: 48_000, material: 9_412, timeMin: 0, makeMin: 30, bottles: 1,
    aliases: ["뿌디", "figure_diffuser/set"],
  },
  {
    id: "ONL-004", store: "online", kind: "regular", name: "온라인시향지", option: "기본",
    price: 4_000, material: 3_597, timeMin: 0, makeMin: 0, bottles: 1,
    // `/scent_paper` 는 상품유형을 가리지 않는 꼬리 매칭이다 — 어느 향수를
    // 사든 시향지 옵션은 같은 품목이다 (image_analysis/scent_paper 등)
    aliases: ["시향지", "/scent_paper"],
    note: "공헌이익률 10% — 팔아도 남지 않는다",
  },
  // ---- 2026-09 온라인에서도 사주 상품을 판다 (사용자 확인 · 8월 온라인 적재에서 추가) ----
  //  온라인 가격은 오프라인과 다르다 — 사주 50ml 44,000 · 10ml 22,000 · 클리커 12,900.
  //  재료비는 같은 용량의 온라인 향수(포장·택배 포함)와 같다고 가정한다.
  {
    id: "ONL-005", store: "online", kind: "regular", name: "오행 퍼퓸", option: "50ml",
    price: 44_000, material: 8_218, timeMin: 0, makeMin: 10, bottles: 1,
    aliases: ["오행 퍼퓸 50ml", "사주 50ml", "saju_perfume/50ml"],
    unconfirmed: true,
    note: "사주 · 재료비는 온라인 50ml(ONL-002)와 같다고 가정",
  },
  {
    id: "ONL-006", store: "online", kind: "regular", name: "오행 퍼퓸", option: "10ml",
    price: 22_000, material: 5_116, timeMin: 0, makeMin: 10, bottles: 1,
    aliases: ["오행 퍼퓸 10ml", "사주 10ml", "saju_perfume/10ml"],
    unconfirmed: true,
    note: "사주 · 재료비는 온라인 10ml(ONL-001)와 같다고 가정",
  },
  {
    id: "ONL-007", store: "online", kind: "regular", name: "사주 클리커", option: "기본",
    price: 12_900, material: 0, timeMin: 0, makeMin: 0, bottles: 1,
    aliases: ["디퓨저 클리커", "사주 클리커", "음양오행 클리커", "/clicker"],
    unconfirmed: true,
    note: "사주 · 재료비·포장 미확인 (택배비 넣지 않음 — 향수와 함께 보내는 경우가 많다고 가정)",
  },
  {
    // 원문 「set_10ml」 44,000 — 사주 50ml 과 금액이 같지만 사주가 아니다 (사용자 확인)
    id: "ONL-008", store: "online", kind: "regular", name: "10ml 세트", option: "10ml×2",
    price: 44_000, material: 6_960, timeMin: 0, makeMin: 20, bottles: 2,
    aliases: ["set_10ml", "chemistry_set/set_10ml"],
    unconfirmed: true,
    note: "사주 아님 · 재료비 = 오프라인 10ml 세트(IDI-011 3,536원) + 온라인 포장·택배 몫 3,424원 (가정)",
  },
  {
    // 자사몰의 레이어링 50ml 세트 (chemistry_set/set_50ml · 88,000).
    // 2026-09 자동 적재를 켜면서 추가했다 — 그 전에는 온라인 50ml 세트가
    // 마스터에 없어 전부 검토 대기함으로 갔다.
    id: "ONL-009", store: "online", kind: "regular", name: "50ml 세트", option: "50ml×2",
    price: 88_000, material: 8_830, timeMin: 0, makeMin: 20, bottles: 2,
    aliases: ["set_50ml", "chemistry_set/set_50ml"],
    unconfirmed: true,
    note: "재료비 = 오프라인 레이어링 50ml 세트(IDI-014 5,406원) + 온라인 포장·택배 몫 3,424원 (ONL-008 과 같은 가정)",
  },
];

/**
 * 2026-07 이벤트 12건 — 「이벤트마스터」 + 「이벤트준비물」 합계 +
 * 「방문자통계」의 구매/미구매.
 *
 * 방문자 기록은 와우 팝업만 있다 (아이디 이벤트는 집계하지 않았다).
 * 와우 9건의 구매자 합 309 + 귀속 없는 7/31 2건 = 311 로, 시트의
 * 「총구매자 311」과 맞는다.
 */
export const SEED_EVENTS: SalesEvent[] = [
  {
    id: "WE-053", store: "wow", name: "하이라이트 윤두준",
    from: "2026-07-03", to: "2026-07-05", hoursPerDay: 8, staff: 1,
    supplies: 179_005, buyers: 93, nonBuyers: 61,
  },
  {
    id: "WE-054", store: "wow", name: "XLOV 우무티",
    from: "2026-07-06", to: "2026-07-07", hoursPerDay: 8, staff: 1,
    supplies: 31_000, buyers: 23, nonBuyers: 1,
  },
  {
    id: "WE-055", store: "wow", name: "DIGNITY 루오",
    from: "2026-07-08", to: "2026-07-08", hoursPerDay: 8, staff: 1,
    supplies: 31_000, buyers: 2, nonBuyers: 0,
  },
  {
    id: "WE-056", store: "wow", name: "퍼플키스 수안",
    from: "2026-07-11", to: "2026-07-11", hoursPerDay: 8, staff: 1,
    supplies: 34_300, buyers: 7, nonBuyers: 0,
  },
  {
    id: "WE-057", store: "wow", name: "제로베이스원 김태래",
    from: "2026-07-12", to: "2026-07-14", hoursPerDay: 8, staff: 1,
    supplies: 174_635, buyers: 38, nonBuyers: 44,
  },
  {
    id: "WE-058", store: "wow", name: "세븐틴 원우",
    from: "2026-07-16", to: "2026-07-18", hoursPerDay: 8, staff: 1,
    supplies: 185_025, buyers: 62, nonBuyers: 53,
    note: "7/18 방문자 기록 없음",
  },
  {
    id: "WE-059", store: "wow", name: "트레저 윤재혁",
    from: "2026-07-22", to: "2026-07-23", hoursPerDay: 8, staff: 1,
    supplies: 143_736, buyers: 19, nonBuyers: 18,
  },
  {
    id: "WE-060", store: "wow", name: "앤더블 장하오",
    from: "2026-07-24", to: "2026-07-26", hoursPerDay: 8, staff: 1,
    supplies: 170_116, buyers: 37, nonBuyers: 41,
  },
  {
    id: "WE-061", store: "wow", name: "드래곤포니 안태규",
    from: "2026-07-29", to: "2026-07-29", hoursPerDay: 8, staff: 1,
    supplies: 31_000, buyers: 28, nonBuyers: 4,
  },
  // 아이디 이벤트 — 상시 인건비가 고정비에 들어가므로 스태프 0
  {
    id: "ID-025", store: "id", name: "에이티즈 산",
    from: "2026-07-09", to: "2026-07-11", hoursPerDay: 0, staff: 0,
    supplies: 186_945,
  },
  {
    id: "ID-026", store: "id", name: "플레이브 밤비",
    from: "2026-07-14", to: "2026-07-16", hoursPerDay: 0, staff: 0,
    supplies: 51_670,
  },
  {
    id: "ID-027", store: "id", name: "뉴진스4주년",
    from: "2026-07-21", to: "2026-07-22", hoursPerDay: 0, staff: 0,
    supplies: 272_650,
  },
];

/**
 * 엑셀 검증 기준 (2026-07).
 *
 * 이 숫자가 화면에서 맞아야 이관이 끝난 것이다 — 재무 대시보드가
 * 「총수입 41,656,602」를 머리에 박아둔 것과 같은 규율이다.
 *
 * ⚠️ 다만 **매출은 원 단위로 맞지 않는 게 정상이다.** 엑셀의 이벤트별
 *    매출은 일부가 잔여·배분으로 계산됐고(아이디매장 시트), 이 모듈은
 *    적재된 줄에서 다시 더한다. 어긋난 금액은 /sales/reconcile 에서
 *    드러내는 것이 목적이므로, 여기 값은 "비교 대상"이지 "정답"이 아니다.
 */
export const EXCEL_BASELINE = {
  month: "2026-07",
  revenue: { wow: 8_658_000, id: 15_243_300, online: 536_000, total: 24_437_300 },
  variable: { wow: 3_172_819, id: 3_137_477, online: 157_060, total: 6_467_356 },
  contribution: { wow: 5_485_181, id: 12_105_823, online: 378_940, total: 17_969_944 },
  fixed: { wow: 2_782_500, id: 4_882_500, online: 0, total: 7_665_000 },
  operating: { wow: 2_702_681, id: 7_223_323, online: 378_940, total: 10_304_944 },
  /** 페이히어 원본 총계 — 이벤트 합계(8,658,000)보다 30,000 많다 */
  posSourceTotal: { wow: 8_688_000, id: 5_099_400, online: 536_000 },
  naverSourceTotal: 10_143_900,
  /** 엑셀이 「기타·미분류」로 추정 처리한 금액 — 전체 매출의 15.2% */
  unclassified: 3_715_300,
} as const;
