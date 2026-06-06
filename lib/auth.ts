// 관리자 인증 관련 상수 (쿠키 이름 등).
// 실제 검증/설정은 app/api/admin-login, admin-logout, middleware.ts 에서 사용.
export const ADMIN_COOKIE = "admin_session";

// 로그인 성공 시 쿠키에 저장하는 값.
export const ADMIN_COOKIE_VALUE = "1";

// 쿠키 유효기간 (초) — 7일
export const ADMIN_COOKIE_MAX_AGE = 60 * 60 * 24 * 7;

// 로그인 페이지 경로 (middleware 예외 처리에 사용)
export const ADMIN_LOGIN_PATH = "/admin/login";
