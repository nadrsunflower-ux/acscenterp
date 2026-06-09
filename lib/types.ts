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
  // 관리자 확인 — 완료(checked)와 별개. true 면 노란색 표시 + 미완료로 집계하지 않음.
  adminApproved?: boolean;
  adminApprovedAt?: number; // 관리자 확인 처리 시각
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

// ---------------------------------------------------------------------------
// 건의함 — 근무자가 매장 운영에 대해 제출하는 건의.
// 근무자는 제목/이름/내용을 작성하고, 관리자는 확인/상태/코멘트를 처리한다.
// ---------------------------------------------------------------------------
// 관리자 처리 상태: 업데이트 예정 / 보류 / 불가 / 완료
export type SuggestionStatus = "planned" | "hold" | "rejected" | "completed";

export interface Suggestion {
  id: string;
  title: string;
  author: string; // 근무자 이름 (content.ts suggestionAuthors 중 하나)
  content: string;
  suggestionDate?: string; // 건의 일자 (YYYY-MM-DD, 근무자 입력)
  createdAt: number; // 제출(등록) 시각 (ms)
  // --- 관리자 처리 필드 ---
  confirmed: boolean; // 확인 체크 (true 면 목록에서 회색 처리)
  status?: SuggestionStatus; // 업데이트 예정 / 보류 / 불가 / 완료 (미선택 시 없음)
  adminComment?: string; // 관리자 코멘트
  // 업데이트 완료(status==='completed') 시 별도로 기록하는 완료 정보
  completedDate?: string; // 업데이트 완료 날짜 (YYYY-MM-DD)
  completedComment?: string; // 업데이트 완료 코멘트
  handledAt?: number; // 관리자가 마지막으로 처리(저장)한 시각
}
