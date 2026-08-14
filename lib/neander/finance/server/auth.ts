import "server-only";

// ============================================================
//  재무 API 접근 통제 — 서버에서 신원을 직접 확인한다
// ------------------------------------------------------------
//  클라이언트는 Google 로그인 ID 토큰을 Authorization 헤더로 보낸다.
//  서버는 그 토큰을 Firebase Admin 으로 검증해 이메일을 얻고, 두 단계로
//  통과 여부를 정한다.
//
//    1) NEANDER 팀원인가        neander_member_emails 컬렉션 대조
//                               (Firestore 규칙의 isAllowedMember 와 동일 기준)
//    2) 재무 접근 대상인가       NEANDER_FINANCE_EMAILS 가 설정돼 있으면
//                               그 목록에 있는 사람만. 비어 있으면 팀원 전체.
//
//  ⚠️ 토큰 검증을 건너뛰면 안 된다. 이메일을 클라이언트가 보내는 값으로
//     믿으면 아무나 남의 이메일을 적어 회사 재무를 열 수 있다.
// ============================================================

import { adminAuth, adminDb } from "./admin";

export interface FinanceUser {
  uid: string;
  email: string;
}

export class AccessError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const norm = (s: string | undefined | null) => (s ?? "").trim().toLowerCase();

const bootstrapAdmins = () =>
  (process.env.NEXT_PUBLIC_NEANDER_ADMIN_EMAILS ?? "")
    .split(",")
    .map(norm)
    .filter(Boolean);

const financeAllowlist = () =>
  (process.env.NEANDER_FINANCE_EMAILS ?? "").split(",").map(norm).filter(Boolean);

/**
 * 요청에서 신원을 확인하고 재무 접근 권한까지 검사한다.
 * 통과하지 못하면 AccessError 를 던진다.
 */
export async function requireFinanceUser(req: Request): Promise<FinanceUser> {
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) {
    throw new AccessError(401, "로그인이 필요합니다.");
  }

  let decoded;
  try {
    decoded = await adminAuth().verifyIdToken(token);
  } catch {
    throw new AccessError(401, "로그인이 만료되었습니다. 다시 로그인해 주세요.");
  }

  const email = norm(decoded.email);
  if (!email) {
    throw new AccessError(403, "이메일이 없는 계정은 사용할 수 없습니다.");
  }

  // 1) NEANDER 팀원인지
  const isBootstrapAdmin = bootstrapAdmins().includes(email);
  if (!isBootstrapAdmin) {
    const snap = await adminDb().collection("neander_member_emails").doc(email).get();
    if (!snap.exists) {
      throw new AccessError(403, `${email} 은 등록된 NEANDER 팀원이 아닙니다.`);
    }
  }

  // 2) 재무 접근 대상인지
  const allow = financeAllowlist();
  if (allow.length > 0 && !allow.includes(email)) {
    throw new AccessError(
      403,
      `${email} 은 재무 접근 권한이 없습니다. 관리자에게 NEANDER_FINANCE_EMAILS 등록을 요청하세요.`,
    );
  }

  return { uid: decoded.uid, email };
}

/** AccessError 를 그대로 응답으로 바꾼다 */
export function accessErrorResponse(e: unknown): Response | null {
  if (e instanceof AccessError) {
    return Response.json({ error: e.message }, { status: e.status });
  }
  return null;
}
