// ============================================================
//  접근 허용 판정 (NEANDER ERP)
// ------------------------------------------------------------
//  로그인한 Google 계정이 다음 중 하나면 접근 허용:
//   1) 팀원(member) 문서의 email 과 일치  (= 그 팀원으로 로그인)
//   2) NEXT_PUBLIC_NEANDER_ADMIN_EMAILS 의 부트스트랩 관리자
//      (팀원 이메일을 아직 등록하기 전, 최초 셋업용)
//
//  ⚠️ AC'SCENT ERP에 통합되며 환경변수명을 NEANDER 전용으로 분리했다:
//     NEXT_PUBLIC_NEANDER_ADMIN_EMAILS (쉼표 구분)
// ============================================================

export const ADMIN_EMAILS: string[] = (
  process.env.NEXT_PUBLIC_NEANDER_ADMIN_EMAILS ?? ""
)
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

const norm = (e: string | null | undefined) => (e ?? "").trim().toLowerCase();

export function isAdminEmail(email: string | null | undefined): boolean {
  const e = norm(email);
  return !!e && ADMIN_EMAILS.includes(e);
}

export function isAllowedEmail(
  email: string | null | undefined,
  memberEmails: string[],
): boolean {
  const e = norm(email);
  if (!e) return false;
  return ADMIN_EMAILS.includes(e) || memberEmails.includes(e);
}
