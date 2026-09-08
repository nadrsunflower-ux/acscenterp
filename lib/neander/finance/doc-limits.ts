// ============================================================
//  프로젝트 문서 파일 한도 — 클라이언트(선검사)와 서버(강제)가 같이 쓴다
// ------------------------------------------------------------
//  라우트 파일에서 내보내면 Next 가 "Route 의 export 가 아니다" 라고
//  빌드를 막는다. 그래서 attachment-limits.ts 처럼 따로 둔다.
//
//  파일 하나 4MB 인 이유: Vercel 서버리스 함수의 요청 본문 한도가 4.5MB
//  라서다. 한 요청에 한 파일만 실어 이 한도를 파일 단위로 만든다.
// ============================================================

export const MAX_DOC_FILE_BYTES = 4 * 1024 * 1024;
export const MAX_DOC_FILES = 10;
/** 확장자 소문자. 이미지는 스캔본(도장 찍힌 계약서 사진)을 위해 */
export const DOC_FILE_EXTS = ["pdf", "xlsx", "xls", "docx", "hwp", "hwpx", "jpg", "jpeg", "png", "zip"];
/** 파일 선택창의 accept 속성용 */
export const DOC_FILE_ACCEPT = DOC_FILE_EXTS.map((e) => `.${e}`).join(",");

export const docFileExt = (name: string) =>
  name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
