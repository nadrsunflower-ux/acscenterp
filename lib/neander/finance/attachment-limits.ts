// ============================================================
//  채팅 첨부 파일 한도 — 클라이언트(선검사)와 서버(강제)가 같이 쓴다
// ------------------------------------------------------------
//  총량 한도가 4MB 인 이유: Vercel 서버리스 함수의 요청 본문 한도가
//  4.5MB 라서, 대화 기록 JSON 몫을 남겨 두어야 한다.
// ============================================================

/** 확장자 소문자 기준. 구형 .hwp/.doc 은 서버가 변환 안내 메시지로 거부한다. */
export const ATTACH_EXTS = ["pdf", "docx", "xlsx", "xls", "csv", "hwpx", "txt", "md"];

export const MAX_ATTACH_FILES = 4;
export const MAX_ATTACH_TOTAL_BYTES = 4 * 1024 * 1024;

/** 파일 선택창의 accept 속성용 — ".pdf,.docx,…" */
export const ATTACH_ACCEPT = ATTACH_EXTS.map((e) => `.${e}`).join(",");

export const fileExt = (name: string) =>
  name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
