// ============================================================
//  NEANDER ERP — 개발 협업 허브(/neander/dev) 도메인 타입
// ------------------------------------------------------------
//  기존 lib/neander/types.ts 스타일(enum + X_STATUSES 배열 +
//  xLabel()/xColor() helper)을 그대로 따른다.
// ============================================================

// ---- 개발 작업 상태 (칸반 컬럼) ---------------------------
export type DevStatus = "backlog" | "todo" | "in_progress" | "review" | "done";
export const DEV_STATUSES: { value: DevStatus; label: string; color: string }[] = [
  { value: "backlog", label: "백로그", color: "#94a3b8" },
  { value: "todo", label: "예정", color: "#6366f1" },
  { value: "in_progress", label: "진행중", color: "#0ea5e9" },
  { value: "review", label: "리뷰", color: "#f59e0b" },
  { value: "done", label: "완료", color: "#16a34a" },
];
export const devStatusLabel = (s: DevStatus) =>
  DEV_STATUSES.find((x) => x.value === s)?.label ?? s;
export const devStatusColor = (s: DevStatus) =>
  DEV_STATUSES.find((x) => x.value === s)?.color ?? "#94a3b8";

// ---- 우선순위 ---------------------------------------------
export type DevPriority = "urgent" | "high" | "medium" | "low";
export const DEV_PRIORITIES: { value: DevPriority; label: string; color: string; icon: string }[] = [
  { value: "urgent", label: "긴급", color: "#dc2626", icon: "🔴" },
  { value: "high", label: "높음", color: "#ea580c", icon: "🟠" },
  { value: "medium", label: "보통", color: "#ca8a04", icon: "🟡" },
  { value: "low", label: "낮음", color: "#64748b", icon: "⚪" },
];
export const devPriorityLabel = (p: DevPriority) =>
  DEV_PRIORITIES.find((x) => x.value === p)?.label ?? p;
export const devPriorityColor = (p: DevPriority) =>
  DEV_PRIORITIES.find((x) => x.value === p)?.color ?? "#64748b";
export const devPriorityIcon = (p: DevPriority) =>
  DEV_PRIORITIES.find((x) => x.value === p)?.icon ?? "⚪";
/** 우선순위 정렬 가중치 (작을수록 높은 우선순위) */
export const devPriorityRank = (p: DevPriority): number =>
  ({ urgent: 0, high: 1, medium: 2, low: 3 })[p] ?? 9;

// ---- 작업 종류 --------------------------------------------
export type DevKind = "feature" | "bug" | "chore" | "design" | "refactor";
export const DEV_KINDS: { value: DevKind; label: string; color: string; icon: string }[] = [
  { value: "feature", label: "기능", color: "#7c3aed", icon: "✨" },
  { value: "bug", label: "버그", color: "#e11d48", icon: "🐛" },
  { value: "chore", label: "잡무", color: "#0891b2", icon: "🧹" },
  { value: "design", label: "디자인", color: "#db2777", icon: "🎨" },
  { value: "refactor", label: "리팩터", color: "#0d9488", icon: "🛠️" },
];
export const devKindLabel = (k: DevKind) =>
  DEV_KINDS.find((x) => x.value === k)?.label ?? k;
export const devKindColor = (k: DevKind) =>
  DEV_KINDS.find((x) => x.value === k)?.color ?? "#7c3aed";
export const devKindIcon = (k: DevKind) =>
  DEV_KINDS.find((x) => x.value === k)?.icon ?? "✨";

// ---- 첨부(스크린샷/파일) — chat의 ChatAttachment와 동형 ----
export interface DevAttachment {
  kind: "image" | "file";
  url: string;
  name: string;
  contentType: string;
  size: number;
  width?: number;
  height?: number;
}

// ---- 기능(에픽) -------------------------------------------
export type FeatureStatus = "active" | "shipped" | "paused";
export const FEATURE_STATUSES: { value: FeatureStatus; label: string; color: string }[] = [
  { value: "active", label: "진행중", color: "#0ea5e9" },
  { value: "shipped", label: "출시됨", color: "#16a34a" },
  { value: "paused", label: "보류", color: "#94a3b8" },
];
export const featureStatusLabel = (s: FeatureStatus) =>
  FEATURE_STATUSES.find((x) => x.value === s)?.label ?? s;
export const featureStatusColor = (s: FeatureStatus) =>
  FEATURE_STATUSES.find((x) => x.value === s)?.color ?? "#94a3b8";

export interface DevFeature {
  id: string;
  name: string;
  description?: string;
  /** 미지정 시 팔레트 순환 색을 UI에서 배정 */
  color?: string;
  status: FeatureStatus;
  /** 표시 순서 (작을수록 위) */
  order: number;
  createdAt: number;
  updatedAt: number;
}
export type DevFeatureInput = Omit<DevFeature, "id" | "createdAt" | "updatedAt">;

// ---- 체크리스트(서브태스크) -------------------------------
export interface ChecklistItem {
  id: string;
  text: string;
  done: boolean;
}

// ---- 개발 작업 --------------------------------------------
export interface DevTask {
  id: string;
  title: string;
  description?: string;
  kind: DevKind;
  status: DevStatus;
  priority: DevPriority;
  /** 소속 기능(에픽) — 비정규화 이름 함께 보관 */
  featureId?: string;
  featureName?: string;
  /** 담당 개발자(복수) */
  assigneeIds: string[];
  assigneeNames: string[];
  /** 배정자(리포터) */
  reporterId?: string;
  reporterName?: string;
  dueDate?: string; // YYYY-MM-DD
  checklist?: ChecklistItem[];
  labels?: string[];
  /** 자동연동 대비: 연결 브랜치/PR */
  branch?: string;
  prUrl?: string;
  /**
   * 일일업무 미러 역링크: assigneeId → neander_daily_tasks doc id.
   * (회의록 ActionItem.taskIds 와 동일 관용구 — 브릿지가 관리, UI는 읽기만)
   */
  dailyTaskIds?: Record<string, string>;
  /** 칸반 컬럼 내 정렬 (작을수록 위) */
  order: number;
  /** 완료 처리 시각 */
  doneAt?: number;
  createdAt: number;
  updatedAt: number;
}
export type DevTaskInput = Omit<DevTask, "id" | "createdAt" | "updatedAt">;

// ---- 개발 타임라인 활동 -----------------------------------
export type ActivitySource = "manual" | "github" | "claude";
export type ActivityType = "update" | "commit" | "pr" | "status" | "note";
export interface DevActivity {
  id: string;
  type: ActivityType;
  source: ActivitySource;
  /** 수동 작성일 때 팀원 id */
  authorId?: string;
  authorName: string;
  title: string;
  body?: string;
  featureId?: string;
  featureName?: string;
  taskId?: string;
  taskTitle?: string;
  attachments?: DevAttachment[];
  /** 자동연동 메타(repo/branch/sha/url/증감) */
  meta?: {
    repo?: string;
    branch?: string;
    sha?: string;
    url?: string;
    additions?: number;
    deletions?: number;
  };
  pinned?: boolean;
  /** 이모지 반응: emoji → memberIds[] */
  reactions?: Record<string, string[]>;
  createdAt: number;
}
export type DevActivityInput = Omit<DevActivity, "id" | "createdAt">;

// ---- 댓글 -------------------------------------------------
export type CommentTarget = "task" | "activity";
export interface DevComment {
  id: string;
  targetType: CommentTarget;
  targetId: string;
  authorId?: string;
  authorName: string;
  body: string;
  attachments?: DevAttachment[];
  createdAt: number;
  updatedAt?: number;
}
export type DevCommentInput = Omit<DevComment, "id" | "createdAt" | "updatedAt">;

// ---- 기능 색 팔레트 (순환 배정) ---------------------------
export const FEATURE_COLORS = [
  "#6366f1",
  "#0ea5e9",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#ec4899",
  "#14b8a6",
];

/** id 문자열을 안정적으로 팔레트 색으로 매핑 (color 미지정 기능용) */
export function featureColorFor(feature: Pick<DevFeature, "id" | "color">): string {
  if (feature.color) return feature.color;
  let h = 0;
  for (let i = 0; i < feature.id.length; i++) h = (h * 31 + feature.id.charCodeAt(i)) >>> 0;
  return FEATURE_COLORS[h % FEATURE_COLORS.length];
}

/** 체크리스트 진행 (완료/전체) */
export function checklistProgress(items?: ChecklistItem[]): { done: number; total: number } {
  const total = items?.length ?? 0;
  const done = items?.filter((i) => i.done).length ?? 0;
  return { done, total };
}

/**
 * secure-context 와 무관하게 안전한 로컬 id 생성.
 * ⚠️ crypto.randomUUID 는 http://<사내 IP> 같은 비보안 컨텍스트에서 undefined →
 *    체크리스트/라벨 추가가 크래시한다. 내부망 http 배포를 위해 이 헬퍼를 쓴다.
 */
export function devId(prefix = "id"): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}
