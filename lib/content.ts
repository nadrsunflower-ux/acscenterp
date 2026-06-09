// 정적 운영 콘텐츠 (Firestore 와 무관하게 코드에 고정되는 안내성 데이터).
// 매장 운영시간, 환불 규정/방법, 와이파이, 재고 위치 이미지.
import type { Store, SuggestionStatus } from "./types";

export interface StoreHour {
  store: Store;
  label: string; // "기본" | "확장"
  start: string; // HH:mm
  end: string; // HH:mm
}

export const storeHours: StoreHour[] = [
  { store: "id", label: "기본", start: "12:30", end: "19:30" },
  { store: "id", label: "확장", start: "13:30", end: "20:30" },
  { store: "wow", label: "기본", start: "11:40", end: "19:00" },
];

export interface RefundMethod {
  title: string;
  steps: string[];
  images?: string[];
}

export interface RefundInfo {
  policy: string;
  methods: RefundMethod[];
}

export const refund: RefundInfo = {
  policy: "~2일 전 100% 환불 / 1일 전 50% 환불 / 당일 0%",
  methods: [
    {
      title: "네이버예약",
      steps: ["예약 고객", "이용완료", "결제 금액 변경"],
    },
    {
      title: "포스기",
      steps: ["더보기", "결제내역", "환불"],
    },
  ],
};

export interface WifiInfo {
  ssid: string;
  password: string;
}

export const wifi: WifiInfo = {
  ssid: "KT_WiFi_Mesh_8165",
  password: "2ec90ez162",
};

export interface StockLocation {
  label: string;
  image: string;
}

export const stockLocations: StockLocation[] = [
  { label: "내부 창고", image: "/images/stock-warehouse.jpg" },
  { label: "향료 재고", image: "/images/stock-fragrance.jpg" },
  { label: "카운터 재고", image: "/images/stock-counter.jpg" },
];

// 매장 표시명
export const storeLabel: Record<Store, string> = {
  id: "악센트 아이디",
  wow: "악센트 와우",
};

// 특정 매장의 운영시간만 추출
export function hoursForStore(store: Store): StoreHour[] {
  return storeHours.filter((h) => h.store === store);
}

// ---------------------------------------------------------------------------
// 건의함 — 근무자 목록 / 처리 상태 라벨
// ---------------------------------------------------------------------------
// 건의함에서 선택 가능한 근무자 (사용자 지정)
export const suggestionAuthors: string[] = [
  "김정연",
  "김제연",
  "김주희",
  "김명연",
  "장하영",
  "유혜윤",
  "이우빈",
];

// 관리자 처리 상태 표시명
export const suggestionStatusLabel: Record<SuggestionStatus, string> = {
  planned: "업데이트 예정",
  hold: "업데이트 보류",
  rejected: "업데이트 불가",
  completed: "업데이트 완료",
};
