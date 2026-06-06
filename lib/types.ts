// 악센트 운영 관리 사이트 — 공용 타입 계약
// 'id' = 악센트 아이디, 'wow' = 악센트 와우
export type Store = "id" | "wow";

export type ShiftType = "basic" | "extended";

// date = YYYY-MM-DD, start/end = HH:mm
export interface WorkShift {
  id: string;
  store: Store;
  staffName: string;
  date: string;
  start: string;
  end: string;
  shiftType: ShiftType;
  memo?: string;
}

export type TaskType = "daily" | "recurring";

export type Recurrence = "daily" | "weekly" | "monthly";

export interface Task {
  id: string;
  store: Store;
  title: string;
  description?: string; // 업무 세부 설명 (대시보드 체크리스트에 표시)
  type: TaskType;
  date?: string;
  recurrence?: Recurrence;
  weekdays?: number[];
  monthDay?: number;
  createdAt: number;
}

// 일일 업무 블록(라이브러리) — 재사용 가능한 업무 템플릿.
// 관리자 '일일 업무' 탭에서 등록하고, 선택해서 특정 날짜의 daily Task 로 대시보드에 추가한다.
export interface TaskBlock {
  id: string;
  store: Store;
  title: string;
  description?: string; // 업무 세부 설명 (날짜에 추가 시 Task로 전달)
  createdAt: number;
}

// id = taskId + "_" + date
export interface TaskCheck {
  id: string;
  taskId: string;
  date: string;
  checked: boolean;
  checkedBy?: string;
  checkedAt?: number;
  note?: string; // 비고/사유 (미완료 사유 등)
}

export interface CalendarEvent {
  id: string;
  store: Store | "all";
  title: string;
  startDate: string;
  endDate: string;
  color?: string;
  memo?: string;
}

export interface PriceOption {
  label: string;
  amount: number;
}

export interface Product {
  id: string;
  store: Store;
  name: string;
  tagline?: string;
  prices: PriceOption[];
  composition: string;
  note?: string;
  imageUrl?: string;
  order: number;
  active: boolean;
}

export type PromotionType = "discount" | "gift";

export interface Promotion {
  id: string;
  store: Store;
  type: PromotionType;
  title: string;
  startDate: string;
  endDate: string;
  target?: string;
  caution?: string;
  imageUrl?: string;
  active: boolean;
}

export interface FragranceReplacement {
  store: Store;
  recentDate: string;
  nextDate: string;
}

// 청소 가이드 — 구역(zone)별로 청소 항목(item)들을 가진다.
export interface CleaningZone {
  name: string; // 구역 이름 (예: 카운터, 진열대, 바닥)
  items: string[]; // 해당 구역의 청소 항목들
}

export interface CleaningGuide {
  store: Store;
  zones: CleaningZone[];
}
