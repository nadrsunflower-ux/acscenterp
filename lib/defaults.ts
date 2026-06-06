// seedInitialData() 가 Firestore 에 1회 주입하는 기본 데이터.
// id는 seed 시 결정적(deterministic)으로 부여하여 중복 주입을 방지한다.
import type {
  Product,
  Promotion,
  FragranceReplacement,
  CleaningGuide,
  CalendarEvent,
} from "./types";

// 상품 — id/order 포함 (seed용 고정 id)
export const defaultProducts: Product[] = [
  {
    id: "id-ppuduk-1",
    store: "id",
    name: "뿌리는 덕질 1탄",
    tagline: "AI 이미지 분석 퍼퓸",
    prices: [
      { label: "50ml", amount: 48000 },
      { label: "10ml", amount: 24000 },
    ],
    composition: "퍼퓸+분석보고서",
    order: 1,
    active: true,
  },
  {
    id: "id-ppuduk-3",
    store: "id",
    name: "뿌리는 덕질 3탄",
    tagline: "레이어링 퍼퓸 세트",
    prices: [
      { label: "50ml*2", amount: 88000 },
      { label: "10ml*2", amount: 44000 },
    ],
    composition: "퍼퓸세트+분석보고서+패키지",
    order: 2,
    active: true,
  },
  {
    id: "id-podoal",
    store: "id",
    name: "포도알 이벤트",
    tagline: "KPOP 플랫폼 제휴 상품",
    prices: [
      { label: "50ml", amount: 38000 },
      { label: "10ml", amount: 24000 },
    ],
    composition: "퍼퓸+특전",
    order: 3,
    active: true,
  },
  {
    id: "wow-sachet",
    store: "wow",
    name: "사쉐",
    prices: [{ label: "기본", amount: 15000 }],
    composition: "사쉐",
    order: 1,
    active: true,
  },
  {
    id: "wow-perfume",
    store: "wow",
    name: "퍼퓸",
    prices: [{ label: "50ml", amount: 38000 }],
    composition: "퍼퓸 50ml",
    order: 2,
    active: true,
  },
  {
    id: "wow-etc",
    store: "wow",
    name: "기타",
    prices: [],
    composition: "이벤트별 상이",
    note: "이벤트별 상이, 특전 구성 안내지 확인",
    order: 3,
    active: true,
  },
];

// 운영 이벤트(프로모션) — id 포함 (seed용 고정 id)
export const defaultPromotions: Promotion[] = [
  {
    id: "id-promo-discount-10",
    store: "id",
    type: "discount",
    title: "전상품 10%",
    startDate: "2026-06-01",
    endDate: "2026-06-30",
    target: "네이버플레이스에서 10% 쿠폰을 다운받아 예약한 고객님들",
    caution: "포도알 이벤트 적용 불가",
    active: true,
  },
  {
    id: "id-promo-icecream-cap",
    store: "id",
    type: "gift",
    title: "아이스크림캡",
    startDate: "2026-06-01",
    endDate: "2026-06-30",
    target: "악센트아이디 인스타 팔로우하고 태그하여 인증샷 업로드한 고객님들",
    active: true,
  },
  {
    id: "id-promo-ppuduk-case",
    store: "id",
    type: "gift",
    title: "뿌덕퍼퓸케이스",
    startDate: "2026-06-01",
    endDate: "2026-07-31",
    target: "재방문 고객님들",
    caution: "예약 이력 확인 후 증정",
    active: true,
  },
];

// 생일 이벤트(대시보드 캘린더 노출용) — 생일·포도알 이벤트.
// 기본값 없음: 할인/증정은 '매장 이벤트'(promotions)이며 대시보드에 표시하지 않는다.
// 생일 이벤트는 관리자 '생일 이벤트' 탭에서 직접 등록한다.
export const defaultEvents: CalendarEvent[] = [];

// 향료 교체일 기본값 (아이디 기준)
export const defaultFragrance: FragranceReplacement = {
  store: "id",
  recentDate: "2025-12-25",
  nextDate: "2026-06-25",
};

// 기본 청소 가이드 — 구역/항목 비어 있음(실제 내용은 관리자 페이지에서 입력).
export const defaultCleaning: CleaningGuide[] = [
  { store: "id", zones: [] },
  { store: "wow", zones: [] },
];
