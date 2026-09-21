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
  /**
   * 회의 첨부 파일 — 회의 id 에 매인다. Storage 버킷이 없어 메일 첨부처럼
   * 768KB 조각(parts/{n})으로 둔다. 보안 규칙에 없어 서버(meetings/server/files.ts)만 접근
   */
  meetingFiles: "neander_meeting_files",
  /**
   * 회의 기록 — 누가 무엇을 했는가 한 줄씩 (meetings/server/log.ts).
   * 회의 문서 안 배열이 아니라 따로 둔다 — 같은 순간에 둘이 손대도 안 덮어쓰게
   */
  meetingLog: "neander_meeting_log",
  /**
   * 회의 녹음 — 회의 id 에 매인다. 아래에 segments/{n}(10분 조각 · 받아쓴 줄)
   * 과 그 아래 parts/{k}(768KB 음성 조각)가 붙는다. 서버(meetings/server/recordings.ts)만 접근
   */
  meetingRecordings: "neander_meeting_recordings",
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
  /** 형광펜 끄기 — 신뢰한 거래처(영구) · 이 달 확인한 계정 (finance/anomaly.ts) */
  finAnomalyIgnores: "neander_fin_anomaly_ignores",
  /** 월간 인사이트 — 매출·재무 보고의 AI 해설 (문서 id = `${module}_${month}`, insights/types.ts) */
  insights: "neander_insights",
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
  // ---- 사이트 자동 동기화 (/neander/sales/sync) ----
  //  우리 사이트(acscent.co.kr · smoat.co.kr)의 매출을 피드로 끌어온다.
  //  lib/neander/sync/contract.ts 가 그 계약이다.
  /** 피드별 커서·마지막 결과 (문서 id = FeedSource) */
  syncState: "neander_sync_state",
  /**
   * 사람이 봐야 할 것 — 적재하지 못한 주문, 사람이 고친 줄과 어긋난 사이트 값.
   * (문서 id = `${source}_${주문·결제 id}`)
   *
   * 실행 결과(lastRun)에만 남기면 다음 실행이 덮어써 한 시간 뒤에 사라진다.
   * 그 주문은 커서가 이미 지나갔으니 다시 오지도 않는다 — 조용히 잃는다.
   * 그래서 풀릴 때까지 따로 남긴다. 그 주문이 나중에 제대로 적재되면 지운다.
   */
  syncIssues: "neander_sync_issues",
  // ---- SMOAT 매출 (/neander/sales/smoat) ----
  //  향수 매장과 성격이 달라 판매 줄(salesLines)에 섞지 않는다. 같은
  //  워크스페이스 안의 **다른 사업**이다 (lib/neander/smoat/types.ts 주석).
  /** SMOAT 결제 한 건 = 문서 1개 (id = `${kind}_${사이트 id}`) */
  smoatSales: "neander_smoat_sales",
  /** SMOAT 월별 AI 원가·크레딧 (문서 id = YYYY-MM) */
  smoatCosts: "neander_smoat_costs",
  // ---- 메일 (/neander/mail) ----
  //  카페24 메일함을 ERP 안에서 읽고 보낸다 (lib/neander/mail/server/).
  //  서버(Admin SDK)만 접근한다 — 암호화된 메일 비밀번호가 들어 있다.
  /**
   * 사람마다 메일 계정 1개 (문서 id = ERP 로그인 이메일).
   * 아래에 inbox · sent · trash 하위 컬렉션과 meta/uidls(받은 표시) 가 붙는다.
   */
  mailAccounts: "neander_mail_accounts",
  /**
   * 예약 메일 — 계정 아래가 아니라 한 곳에 모은다. 누구의 ERP 가 열려 있든
   * 20초 확인이 「보낼 때가 된 예약」을 한 번의 질의로 찾아 보내야 해서다.
   */
  mailScheduled: "neander_mail_scheduled",
  /**
   * 첨부 조각 저장소 — Storage 버킷이 없어 Firestore 에 768KB 씩 나눠 둔다.
   * 보내기 전 첨부 · 임시저장 · 예약 · 큰 첨부 내려받기가 쓴다.
   */
  mailBlobs: "neander_mail_blobs",
  /** 수신확인 — 열람 표시 id → 보낸 메일 (공개 픽셀 라우트가 찾는다) */
  mailTrack: "neander_mail_track",
} as const;
