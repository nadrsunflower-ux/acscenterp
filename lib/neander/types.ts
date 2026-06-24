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
export type TaskStatus = "todo" | "done" | "extended" | "on_hold";
export const TASK_STATUSES: { value: TaskStatus; label: string }[] = [
  { value: "todo", label: "예정" },
  { value: "done", label: "완료" },
  { value: "extended", label: "연장" },
  { value: "on_hold", label: "보류" },
];
export const taskStatusLabel = (s: TaskStatus) =>
  TASK_STATUSES.find((x) => x.value === s)?.label ?? s;

/** 일일업무 분류 */
export type TaskCategory = "id" | "wow" | "smoat" | "etc";
export const TASK_CATEGORIES: { value: TaskCategory; label: string; color: string }[] = [
  { value: "smoat", label: "스모트", color: "#0891b2" },
  { value: "id", label: "아이디", color: "#7c5cff" },
  { value: "wow", label: "와우", color: "#ff8a3d" },
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
  /** 캐릭터 이모지 아바타 (없으면 이름 첫 글자 표시) */
  avatar?: string;
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
  /** status === "extended" 일 때, 연장 전 원래 날짜. date 는 연장된 날짜로 이동된다. */
  originalDate?: string;
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
  /** 분류 (스모트/아이디/와우/기타) */
  category?: TaskCategory;
  dueDate?: string; // YYYY-MM-DD
  status: RequestStatus;
  /** 받은 사람이 요청자에게 남기는 간단한 답장 메시지 */
  replyMessage?: string;
  /** 받은 사람이 '확인완료'를 눌렀는지 (알림 뱃지 제거 기준) */
  acknowledged?: boolean;
  /** 보낸 사람의 '압박 주기' 누른 횟수 */
  nudgeCount?: number;
  /** 받은 사람이 '일일업무 추가'로 등록한 일일업무 id (중복 추가 방지) */
  taskId?: string;
  createdAt: number;
  updatedAt: number;
}
export type WorkRequestInput = Omit<
  WorkRequest,
  | "id"
  | "createdAt"
  | "updatedAt"
  | "status"
  | "replyMessage"
  | "acknowledged"
  | "nudgeCount"
  | "taskId"
>;

// ---- 회의록 -----------------------------------------------

/** 회의록의 우선순위 액션플랜 항목 */
export interface ActionItem {
  /** 로컬 식별용 id (목록 key / 일일업무 연결 추적) */
  id: string;
  text: string;
  /** 분류 (스모트/아이디/와우/기타) — 일일업무 분류와 동일 */
  category?: TaskCategory;
  /** 세부사항 (선택) */
  detail?: string;
  /** 담당자(복수). 비정규화 이름 함께 보관 */
  assigneeIds?: string[];
  assigneeNames?: string[];
  /** @deprecated 단수 담당자 — 구버전 문서 호환용(읽기 전용) */
  assigneeId?: string;
  /** @deprecated 단수 담당자 이름 — 구버전 문서 호환용 */
  assigneeName?: string;
  dueDate?: string; // YYYY-MM-DD
  /** 담당자별 연결된 일일업무 id 맵 (assigneeId → task 문서 id) */
  taskIds?: Record<string, string>;
  /** @deprecated 단수 일일업무 id — 구버전 문서 호환용 */
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
  /** 대상자 팀원 id 목록 (복수 선택) */
  targetIds: string[];
  date: string; // YYYY-MM-DD 일정 날짜
  title: string;
  content?: string;
  createdAt: number;
  updatedAt: number;
}
export type ScheduleInput = Omit<Schedule, "id" | "createdAt" | "updatedAt">;

// ---- 바로가기 ---------------------------------------------

/** 바로가기 상위 그룹 (스모트/아이디/와우) */
export type ShortcutGroup = "smoat" | "id" | "wow";
export const SHORTCUT_GROUPS: {
  value: ShortcutGroup;
  label: string;
  color: string;
}[] = [
  { value: "smoat", label: "스모트", color: "#0891b2" },
  { value: "id", label: "아이디", color: "#7c5cff" },
  { value: "wow", label: "와우", color: "#ff8a3d" },
];
export const shortcutGroupLabel = (g: ShortcutGroup) =>
  SHORTCUT_GROUPS.find((x) => x.value === g)?.label ?? g;
export const shortcutGroupColor = (g: ShortcutGroup) =>
  SHORTCUT_GROUPS.find((x) => x.value === g)?.color ?? "#71717a";
/** 해당 그룹이 하위 분류(마케팅/영업/개발/B2B)를 쓰는지. 와우는 분류 없음. */
export const groupHasCategories = (g: ShortcutGroup) => g !== "wow";

/** 바로가기 하위 분류 (마케팅/영업/개발/B2B) — 스모트·아이디 그룹에서만 사용 */
export type ShortcutCategory = "marketing" | "sales" | "dev" | "b2b";
export const SHORTCUT_CATEGORIES: {
  value: ShortcutCategory;
  label: string;
  color: string;
}[] = [
  { value: "marketing", label: "마케팅", color: "#f43f5e" },
  { value: "sales", label: "영업", color: "#3182f6" },
  { value: "dev", label: "개발", color: "#8b5cf6" },
  { value: "b2b", label: "B2B", color: "#f59e0b" },
];
export const shortcutCategoryLabel = (c: ShortcutCategory) =>
  SHORTCUT_CATEGORIES.find((x) => x.value === c)?.label ?? c;
export const shortcutCategoryColor = (c: ShortcutCategory) =>
  SHORTCUT_CATEGORIES.find((x) => x.value === c)?.color ?? "#71717a";

/** 바로가기 (팀 공용 링크 모음 — 그룹 > 분류 2단 탭으로 묶임) */
export interface Shortcut {
  id: string;
  /** 상위 그룹 (스모트/아이디/와우). 레거시 문서엔 없을 수 있어 읽을 때 'smoat' 로 보정. */
  group: ShortcutGroup;
  /** 하위 분류 — 스모트/아이디에서만 사용. 와우는 분류 없음(undefined). */
  category?: ShortcutCategory;
  title: string;
  /** 이동할 링크 (https:// 정규화된 절대 URL) */
  url: string;
  /** 링크 사용에 필요한 비밀번호 (있을 때만 저장). 허용 팀원만 접근 가능. */
  password?: string;
  createdAt: number;
  updatedAt: number;
}
export type ShortcutInput = Omit<Shortcut, "id" | "createdAt" | "updatedAt">;

// ---- 메신저 -----------------------------------------------

/** 채팅 메시지에 첨부된 이미지/파일 (Firebase Storage 업로드 결과) */
export interface ChatAttachment {
  /** 이미지면 인라인 미리보기, 그 외는 다운로드 칩으로 표시 */
  kind: "image" | "file";
  url: string;
  name: string;
  contentType: string;
  /** 바이트 단위 파일 크기 */
  size: number;
}

/** 채팅 메시지 */
export interface ChatMessage {
  id: string;
  /**
   * 대화 식별자:
   *  - "team"               전체 팀 채팅
   *  - "dm_<idA>__<idB>"    팀원 간 기본 1:1 (정렬됨)
   *  - 그 외(랜덤 doc id)    사용자가 직접 만든 채팅방(neander_conversations)
   */
  conversationId: string;
  senderId: string;
  senderName: string;
  /** 첨부만 있을 때는 빈 문자열 */
  text: string;
  /** 이미지·파일 첨부 (있을 때만) */
  attachment?: ChatAttachment;
  createdAt: number;
}

/** 사용자별 대화 읽음 시각 맵 ({ conversationId: lastReadMs }) */
export type ChatReads = Record<string, number>;

/** 사용자가 직접 만든 채팅방 (1:1 또는 단체, 이름 지정 가능) */
export interface Conversation {
  id: string;
  /** 채팅방 이름 */
  name: string;
  /** 참여자 팀원 id 목록 (만든 사람 포함) */
  memberIds: string[];
  /** true=단체방, false=1:1 방 */
  isGroup: boolean;
  /** 만든 사람 팀원 id */
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}
export type ConversationInput = Omit<Conversation, "id" | "createdAt" | "updatedAt">;
