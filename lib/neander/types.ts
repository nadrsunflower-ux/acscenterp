// ============================================================
//  NEANDER ERP — 도메인 타입 정의
//  (AC'SCENT ERP에 통합된 NEANDER 상위 ERP 영역에서 사용)
// ============================================================

// ---- 공통 enum / 라벨 -------------------------------------

/** 매출 채널 */
export type SalesChannel = "accent" | "wow" | "etc";
export const SALES_CHANNELS: { value: SalesChannel; label: string }[] = [
  { value: "accent", label: "악센트 아이디" },
  { value: "wow", label: "와우" },
  { value: "etc", label: "기타" },
];
export const salesChannelLabel = (c: SalesChannel) =>
  SALES_CHANNELS.find((x) => x.value === c)?.label ?? c;

/** 일일업무 상태 */
export type TaskStatus = "todo" | "done" | "extended";
export const TASK_STATUSES: { value: TaskStatus; label: string }[] = [
  { value: "todo", label: "예정" },
  { value: "done", label: "완료" },
  { value: "extended", label: "연장" },
];
export const taskStatusLabel = (s: TaskStatus) =>
  TASK_STATUSES.find((x) => x.value === s)?.label ?? s;

/** 일일업무 분류 */
export type TaskCategory = "id" | "wow" | "smoat" | "etc";
export const TASK_CATEGORIES: { value: TaskCategory; label: string; color: string }[] = [
  { value: "id", label: "아이디", color: "#7c5cff" },
  { value: "wow", label: "와우", color: "#ff8a3d" },
  { value: "smoat", label: "스모트", color: "#0891b2" },
  { value: "etc", label: "기타", color: "#71717a" },
];
export const taskCategoryLabel = (c: TaskCategory) =>
  TASK_CATEGORIES.find((x) => x.value === c)?.label ?? c;
export const taskCategoryColor = (c: TaskCategory) =>
  TASK_CATEGORIES.find((x) => x.value === c)?.color ?? "#71717a";

/** 업무요청 상태 */
export type RequestStatus = "requested" | "in_progress" | "done" | "on_hold";
export const REQUEST_STATUSES: { value: RequestStatus; label: string }[] = [
  { value: "requested", label: "요청됨" },
  { value: "in_progress", label: "진행예정" },
  { value: "on_hold", label: "보류" },
  { value: "done", label: "완료" },
];
/** 요청을 받은 사람이 선택할 수 있는 처리 상태 (요청됨 제외) */
export const RECEIVED_STATUS_ACTIONS: { value: RequestStatus; label: string }[] = [
  { value: "in_progress", label: "진행예정" },
  { value: "on_hold", label: "보류" },
  { value: "done", label: "완료" },
];
export const requestStatusLabel = (s: RequestStatus) =>
  REQUEST_STATUSES.find((x) => x.value === s)?.label ?? s;

// ---- 엔티티 -----------------------------------------------

/** 구성원 (팀원 5명) */
export interface Member {
  id: string;
  name: string;
  role?: string;
  /** Google 로그인 이메일 — 이 값과 일치하는 계정이 이 팀원으로 로그인된다 */
  email?: string;
  /** UI 아바타/뱃지 색상 (tailwind 색 hex) */
  color?: string;
  createdAt: number;
}
export type MemberInput = Omit<Member, "id" | "createdAt">;

/** 일일업무 */
export interface DailyTask {
  id: string;
  memberId: string; // 담당자
  memberName: string; // 표시용 (비정규화)
  date: string; // YYYY-MM-DD
  category: TaskCategory; // 분류 (아이디/와우/스모트/기타)
  title: string;
  detail?: string;
  status: TaskStatus;
  /** status === "extended" 일 때 연장된 날짜 (YYYY-MM-DD) */
  extendedDate?: string;
  createdAt: number;
  updatedAt: number;
}
export type DailyTaskInput = Omit<DailyTask, "id" | "createdAt" | "updatedAt">;

/** 매출 */
export interface Sale {
  id: string;
  channel: SalesChannel;
  amount: number; // 원
  date: string; // YYYY-MM-DD
  memberId: string; // 담당자
  memberName: string; // 표시용 (비정규화)
  client?: string; // 거래처
  memo?: string;
  createdAt: number;
}
export type SaleInput = Omit<Sale, "id" | "createdAt">;

/** 업무요청 (구성원 간 전송) */
export interface WorkRequest {
  id: string;
  fromId: string;
  fromName: string;
  toId: string;
  toName: string;
  title: string;
  detail?: string;
  dueDate?: string; // YYYY-MM-DD
  status: RequestStatus;
  /** 받은 사람이 요청자에게 남기는 간단한 답장 메시지 */
  replyMessage?: string;
  /** 받은 사람이 '확인완료'를 눌렀는지 (알림 뱃지 제거 기준) */
  acknowledged?: boolean;
  /** 보낸 사람의 '압박 주기' 누른 횟수 */
  nudgeCount?: number;
  createdAt: number;
  updatedAt: number;
}
export type WorkRequestInput = Omit<
  WorkRequest,
  "id" | "createdAt" | "updatedAt" | "status" | "replyMessage" | "acknowledged" | "nudgeCount"
>;

// ---- 회의록 -----------------------------------------------

/** 회의록의 우선순위 액션플랜 항목 */
export interface ActionItem {
  /** 로컬 식별용 id (목록 key / 일일업무 연결 추적) */
  id: string;
  text: string;
  assigneeId: string;
  assigneeName: string;
  dueDate?: string; // YYYY-MM-DD
  /** 일일업무로 등록된 경우 그 task 문서 id (중복 등록 방지) */
  taskId?: string;
}

/** 회의록 */
export interface Meeting {
  id: string;
  date: string; // YYYY-MM-DD 회의 날짜
  title?: string;
  content: string; // 회의 내용 정리
  /** 우선순위 액션플랜 (위에서부터 높은 우선순위) */
  actionItems: ActionItem[];
  createdAt: number;
  updatedAt: number;
}
export type MeetingInput = Omit<Meeting, "id" | "createdAt" | "updatedAt">;

// ---- 스케줄 -----------------------------------------------

/** 스케줄 (대상자에게 공유되는 일정) */
export interface Schedule {
  id: string;
  target: string; // 대상자 (자유 입력: "전 직원", "김주연" 등)
  date: string; // YYYY-MM-DD 일정 날짜
  title: string;
  content?: string;
  createdAt: number;
  updatedAt: number;
}
export type ScheduleInput = Omit<Schedule, "id" | "createdAt" | "updatedAt">;

// ---- 메신저 -----------------------------------------------

/** 채팅 메시지 */
export interface ChatMessage {
  id: string;
  /** 대화 식별자: "team" 또는 "dm_<idA>__<idB>"(정렬됨) */
  conversationId: string;
  senderId: string;
  senderName: string;
  text: string;
  createdAt: number;
}

/** 사용자별 대화 읽음 시각 맵 ({ conversationId: lastReadMs }) */
export type ChatReads = Record<string, number>;
