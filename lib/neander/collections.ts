// ============================================================
//  NEANDER Firestore 컬렉션 이름
// ------------------------------------------------------------
//  firebase.ts 에서 분리해 둔다. 서버 API 라우트(Admin SDK)도 이 이름이
//  필요한데, firebase.ts 를 import 하면 클라이언트 Firebase SDK 전체가
//  서버 번들로 딸려온다. 상수에는 의존성이 없어야 한다.
// ============================================================

/** NEANDER 컬렉션 이름 (neander_ 접두사로 AC'SCENT 데이터와 분리) */
export const NEANDER_COL = {
  members: "neander_members",
  sales: "neander_sales",
  dailyTasks: "neander_daily_tasks",
  workRequests: "neander_work_requests",
  meetings: "neander_meetings",
  shortcuts: "neander_shortcuts",
  schedules: "neander_schedules",
  messages: "neander_messages",
  chatReads: "neander_chat_reads",
  conversations: "neander_conversations",
  /** 이메일 → 팀원 매핑 (보안 규칙의 '허용 팀원' 판정 근거) */
  memberEmails: "neander_member_emails",
  // ---- 개발 협업 허브 (/neander/dev) ----
  /** 기능(에픽) — 비개발자가 보는 상위 묶음 */
  devFeatures: "neander_dev_features",
  /** 개발 작업(칸반 배정 단위) */
  devTasks: "neander_dev_tasks",
  /** 개발 타임라인 활동(수동 업데이트 + 향후 git/claude 자동연동) */
  devActivity: "neander_dev_activity",
  /** 작업/활동에 대한 댓글 */
  devComments: "neander_dev_comments",
  // ---- 재무 (/neander/finance) ----
  /** 통합거래장 — 거래 1건 = 문서 1개 */
  finTransactions: "neander_fin_transactions",
  /** 계정 마스터 (통합_MAP 317 잎 계정) */
  finAccounts: "neander_fin_accounts",
  /** 계좌·카드 마스터 */
  finPaymentMethods: "neander_fin_payment_methods",
  /** 거래처 키워드 → 구독 서비스 자동분류 규칙 */
  finVendorRules: "neander_fin_vendor_rules",
  /** 구독 서비스 마스터 (계정+거래처 키워드 매칭 · 결제수단 정비 계획) */
  finSubscriptions: "neander_fin_subscriptions",
  /** 공통비 배분 규칙 (공용·홍대공용 → 사업부) */
  finAllocations: "neander_fin_allocations",
  /** 월별 예산 (문서 1개 = 한 달, 계정 경로별 금액 맵) */
  finBudgets: "neander_fin_budgets",
  /** 엑셀 임포트 배치 이력 */
  finImports: "neander_fin_imports",
  /** 월 마감 (문서 1개 = 한 달, 마감 시점 숫자 스냅샷) */
  finCloses: "neander_fin_closes",
  /** 법인카드 사용 메모 — 현장에서 남기고, 나중에 카드 명세서와 대조한다 */
  finCardMemos: "neander_fin_card_memos",
  /** 재무 비서와 나눈 대화 (문서 1개 = 대화 1개, 사용자별) */
  finChats: "neander_fin_chats",
  /** 프로젝트 손익 (문서 1개 = 프로젝트 1개, 체크리스트 줄은 문서 안 배열) */
  finProjects: "neander_fin_projects",
  /** 프로젝트 문서 — 견적서·계약서 (문서 1개 = 서류 1개, kind 로 구분, 파일은 Storage 경로) */
  finDocs: "neander_fin_docs",
  /** 원장에 사람이 덧붙인 열 (값은 거래 문서의 extra 에 담긴다) */
  finLedgerColumns: "neander_fin_ledger_columns",
  /** 지운 거래의 원본 — 되돌리기가 숨긴 필드(dedupHash 등)를 되살리는 근거 (server/trash.ts) */
  finTrash: "neander_fin_trash",
  // ---- 매출 단위경제 (/neander/sales) ----
  //  재무와 같은 이유로 서버(Admin SDK)를 거친다 — 보안 규칙을 게시할
  //  권한이 없어서 새 컬렉션은 클라이언트에서 직접 붙을 수 없다.
  /** 판매 줄 — POS·예약 한 줄 = 문서 1개 */
  salesLines: "neander_sales_lines",
  /** 상품 마스터 (문서 id = 상품코드) */
  salesProducts: "neander_sales_products",
  /** 기본가정 — 고정비·시급·수수료율 (문서 1개, id = "current") */
  salesAssumptions: "neander_sales_assumptions",
  /** 이벤트 (문서 id = 이벤트코드) */
  salesEvents: "neander_sales_events",
  /** 적재 배치 이력 — 되돌리기 단위 */
  salesImports: "neander_sales_imports",
  /** 매출 비서와 나눈 대화 (문서 1개 = 대화 1개, 사용자별) */
  salesChats: "neander_sales_chats",
  /** 지운 판매 줄의 원본 — 되돌리기가 숨긴 필드(importId 등)를 되살리는 근거 */
  salesTrash: "neander_sales_trash",
} as const;
