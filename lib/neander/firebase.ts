// ============================================================
//  NEANDER ERP — Firebase 어댑터
// ------------------------------------------------------------
//  NEANDER ERP 영역은 AC'SCENT ERP와 "동일한 Firebase 프로젝트
//  (acscentmanager)" 를 사용한다. 따라서 별도 config 없이
//  AC'SCENT의 getFirebaseApp() 위에서 Firestore / Auth 인스턴스만
//  얻어온다.
//
//  ⚠️ AC'SCENT의 lib/firebase.ts 와 동일한 "지연 초기화(lazy)" 패턴을
//     따른다. import 시점에 throw 하지 않고(빌드/프리렌더 통과),
//     실제 호출 시점에만 초기화한다. env 미설정 시 명확히 throw.
//
//  NEANDER 데이터는 AC'SCENT 매장 데이터와 섞이지 않도록 모든
//  컬렉션에 "neander_" 접두사를 쓴다. (lib/neander/db/* 참고)
// ============================================================
import { getFirestore, type Firestore } from "firebase/firestore";
import { getAuth, type Auth } from "firebase/auth";
import { getStorage, type FirebaseStorage } from "firebase/storage";
import { getFirebaseApp } from "@/lib/firebase";

let _db: Firestore | null = null;
let _auth: Auth | null = null;
let _storage: FirebaseStorage | null = null;

/** Firestore 인스턴스 (지연 초기화). env 미설정 시 throw. */
export function getNeanderDb(): Firestore {
  if (_db) return _db;
  const app = getFirebaseApp();
  if (!app) {
    throw new Error(
      "[neander/firebase] Firebase 환경변수가 설정되지 않았습니다. .env.local 의 NEXT_PUBLIC_FIREBASE_* 값을 확인하세요.",
    );
  }
  _db = getFirestore(app);
  return _db;
}

/** Firebase Auth 인스턴스 (지연 초기화). env 미설정 시 throw. */
export function getNeanderAuth(): Auth {
  if (_auth) return _auth;
  const app = getFirebaseApp();
  if (!app) {
    throw new Error(
      "[neander/firebase] Firebase 환경변수가 설정되지 않았습니다. .env.local 의 NEXT_PUBLIC_FIREBASE_* 값을 확인하세요.",
    );
  }
  _auth = getAuth(app);
  return _auth;
}

/** Firebase Storage 인스턴스 (지연 초기화). env 미설정 시 throw. */
export function getNeanderStorage(): FirebaseStorage {
  if (_storage) return _storage;
  const app = getFirebaseApp();
  if (!app) {
    throw new Error(
      "[neander/firebase] Firebase 환경변수가 설정되지 않았습니다. .env.local 의 NEXT_PUBLIC_FIREBASE_* 값을 확인하세요.",
    );
  }
  _storage = getStorage(app);
  return _storage;
}

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
} as const;
