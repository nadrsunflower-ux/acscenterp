// ============================================================
//  Firestore 오류를 사람이 읽을 수 있는 안내로
// ------------------------------------------------------------
//  "Missing or insufficient permissions." 만 띄우면 무엇을 해야 하는지
//  알 수 없다. 특히 재무는 새 컬렉션(neander_fin_*)을 쓰기 때문에
//  보안 규칙을 게시하기 전까지는 반드시 이 오류가 난다.
// ============================================================

export interface FriendlyError {
  title: string;
  detail: string;
  /** 사용자가 실행해야 할 명령 (있으면) */
  command?: string;
}

const codeOf = (e: unknown): string => {
  if (typeof e === "object" && e !== null && "code" in e) {
    return String((e as { code: unknown }).code);
  }
  return "";
};

const messageOf = (e: unknown): string =>
  e instanceof Error ? e.message : String(e);

export function describeFirestoreError(e: unknown): FriendlyError {
  const code = codeOf(e);
  const msg = messageOf(e);

  if (code === "permission-denied" || /insufficient permissions/i.test(msg)) {
    return {
      title: "보안 규칙이 아직 게시되지 않았습니다",
      detail:
        "재무 모듈은 neander_fin_* 컬렉션을 사용합니다. firestore.rules 에 규칙은 추가돼 있지만 Firebase 에 게시하지 않으면 읽기·쓰기가 모두 거부됩니다. 아래를 실행한 뒤 새로고침하세요. (최초 1회 firebase login 이 필요합니다.)",
      command: "npm run firebase:deploy:rules",
    };
  }

  if (code === "unavailable" || /offline|network/i.test(msg)) {
    return {
      title: "Firebase 에 연결하지 못했습니다",
      detail: "네트워크 상태를 확인한 뒤 새로고침하세요.",
    };
  }

  if (code === "unauthenticated") {
    return {
      title: "로그인이 만료되었습니다",
      detail: "다시 로그인해 주세요.",
    };
  }

  return { title: "오류가 발생했습니다", detail: msg };
}
