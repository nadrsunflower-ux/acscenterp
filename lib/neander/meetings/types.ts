// ============================================================
//  회의 첨부 파일 — 브라우저와 서버가 같이 쓰는 모양과 한도
// ------------------------------------------------------------
//  회의 하나가 파일 하나처럼 움직인다: 「+ 새 회의」 로 만들고, 그 안에
//  회의록(본문·액션플랜·자료 링크)과 첨부 파일이 들어간다. 첨부는 회의
//  문서(neander_meetings/{id})에 매이고, 회의를 지우면 같이 지워진다.
// ============================================================

/** 회의에 붙인 파일 — 내용은 서버 조각 저장소에 있다 */
export interface MeetingFile {
  id: string;
  /** 붙은 회의 (neander_meetings 문서 id) */
  meetingId: string;
  name: string;
  type: string;
  size: number;
  /** 올린 사람 ERP 이메일 — 화면은 팀원 목록에서 이름을 찾는다 */
  uploadedBy: string;
  createdAt: number;
  /**
   * 노션으로 옮긴 파일 — ERP 에는 이름·크기·올린 사람만 남고 내용은 노션에 있다
   * (lib/neander/meetings/server/archive.ts). 내려받기는 ERP 가 노션에서 새 주소를
   * 받아 넘겨준다 — 노션 주소는 1시간이면 만료되므로 저장하지 않는다.
   */
  archive?: { pageUrl: string; blockId: string; at: number };
}

/** 조각 하나 — Firestore 문서 1MB 한도 아래, base64 로 부풀어도 Vercel 요청 4.5MB 아래 */
export const MEETING_FILE_PART_BYTES = 768 * 1024;

/**
 * 파일 하나의 한도. Storage 가 아니라 Firestore 에 쌓이므로 무료 요금제라면
 * 저장 1GB 를 ERP 전체(장부·매출)와 나눠 쓴다 — 넉넉히 잡지 않는다.
 * 더 큰 자료(영상 등)는 드라이브에 두고 회의록 「자료 링크」 로 건다.
 */
export const MEETING_FILE_MAX_BYTES = 30 * 1024 * 1024;
