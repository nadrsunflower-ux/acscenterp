import "server-only";

// ============================================================
//  Firebase Admin SDK — 재무 모듈 서버 전용
// ------------------------------------------------------------
//  왜 재무만 서버를 경유하는가:
//
//  Firestore 보안 규칙은 **클라이언트가 직접 붙을 때만** 적용된다.
//  neander_fin_* 규칙을 게시하려면 Firebase 프로젝트 소유자 권한이
//  필요한데 우리에게는 없다. 반면 Admin SDK(서비스 계정)는 규칙을
//  통째로 우회하므로, 서버를 거치면 규칙 게시 없이 동작한다.
//
//  그리고 이건 단순 우회가 아니라 재무에 더 맞는 구조다. "재무는
//  특정인만"이라는 요구를 규칙으로 표현하려면 매번 규칙을 다시
//  게시해야 하는데, 서버에서는 코드로 즉시 통제된다.
//
//  ⚠️ 이 파일은 절대 클라이언트 번들에 들어가면 안 된다. 서비스 계정은
//     규칙을 우회하는 전체 권한이라 유출되면 Firestore 전체가 열린다.
//     "server-only" import 가 클라이언트에서 import 되면 빌드를 깨뜨린다.
// ============================================================

import { initializeApp, cert, getApps, getApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { getAuth, type Auth } from "firebase-admin/auth";

const APP_NAME = "neander-finance";

interface ServiceAccountJson {
  project_id: string;
  client_email: string;
  private_key: string;
}

function loadServiceAccount(): ServiceAccountJson {
  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_B64;
  if (!b64) {
    throw new Error(
      "FIREBASE_SERVICE_ACCOUNT_B64 가 설정되지 않았습니다. " +
        ".env.local(로컬) 또는 Vercel 환경변수(배포)에 서비스 계정 JSON 을 " +
        "base64 로 인코딩해 넣으세요.",
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
  } catch {
    throw new Error(
      "FIREBASE_SERVICE_ACCOUNT_B64 를 해석하지 못했습니다. base64 로 인코딩된 " +
        "서비스 계정 JSON 이어야 합니다.",
    );
  }
  const sa = parsed as Partial<ServiceAccountJson>;
  if (!sa.project_id || !sa.client_email || !sa.private_key) {
    throw new Error("서비스 계정 JSON 에 project_id/client_email/private_key 가 없습니다.");
  }
  return sa as ServiceAccountJson;
}

/**
 * 이름 붙인 앱을 쓴다. 기본 앱을 쓰면 같은 프로세스의 다른 코드와
 * 충돌할 수 있고, 개발 중 핫리로드로 initializeApp 이 두 번 불려
 * "app already exists" 로 죽는 일이 흔하다.
 */
export function adminApp(): App {
  const existing = getApps().find((a) => a.name === APP_NAME);
  if (existing) return getApp(APP_NAME);
  const sa = loadServiceAccount();
  return initializeApp(
    {
      credential: cert({
        projectId: sa.project_id,
        clientEmail: sa.client_email,
        privateKey: sa.private_key,
      }),
      projectId: sa.project_id,
    },
    APP_NAME,
  );
}

export function adminDb(): Firestore {
  return getFirestore(adminApp());
}

export function adminAuth(): Auth {
  return getAuth(adminApp());
}
