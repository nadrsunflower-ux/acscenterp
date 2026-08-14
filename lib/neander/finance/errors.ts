// ============================================================
//  재무 오류를 사람이 읽을 수 있는 안내로
// ------------------------------------------------------------
//  재무는 서버 API 를 거치므로 오류가 서버에서 문자열로 온다.
//  원문만 띄우면 무엇을 해야 하는지 알 수 없어 조치까지 붙인다.
// ============================================================

export interface FriendlyError {
  title: string;
  detail: string;
  /** 사용자가 실행하거나 설정해야 할 것 (있으면) */
  command?: string;
}

const messageOf = (e: unknown): string =>
  e instanceof Error ? e.message : typeof e === "string" ? e : String(e);

export function describeFinanceError(e: unknown): FriendlyError {
  const msg = messageOf(e);

  // 서버에 서비스 계정이 없음 — 배포 설정 누락
  if (/FIREBASE_SERVICE_ACCOUNT_B64/.test(msg)) {
    return {
      title: "서버에 Firebase 서비스 계정이 설정되지 않았습니다",
      detail:
        "재무 모듈은 서버(Admin SDK)를 거쳐 Firestore 에 접근합니다. 로컬은 .env.local, " +
        "배포는 Vercel 환경변수에 서비스 계정 JSON 을 base64 로 넣어야 합니다.",
      command: "FIREBASE_SERVICE_ACCOUNT_B64=<base64 로 인코딩한 서비스 계정 JSON>",
    };
  }

  // 재무 접근 대상이 아님
  if (/재무 접근 권한/.test(msg)) {
    return {
      title: "재무 접근 권한이 없습니다",
      detail: msg,
      command: "NEANDER_FINANCE_EMAILS=<허용할 이메일들, 쉼표 구분>",
    };
  }

  // 팀원이 아님
  if (/NEANDER 팀원이 아닙니다/.test(msg)) {
    return { title: "등록된 팀원이 아닙니다", detail: msg };
  }

  if (/로그인이 필요합니다|로그인이 만료/.test(msg)) {
    return { title: "로그인이 필요합니다", detail: msg };
  }

  if (/Failed to fetch|NetworkError|network/i.test(msg)) {
    return {
      title: "서버에 연결하지 못했습니다",
      detail: "네트워크 상태를 확인한 뒤 새로고침하세요.",
    };
  }

  return { title: "오류가 발생했습니다", detail: msg };
}
