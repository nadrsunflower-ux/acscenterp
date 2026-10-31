import type { FinTransactionInput } from "./types";

/** 원본 파일 전체를 보낸다. 서버가 파일 전체의 동일 결제 발생 순번을 센다. */
export interface ImportAppendInput {
  fileName: string;
  fileHash: string;
  month: string;
  slotKey: string;
  adapterId: string;
  from: string;
  to: string;
  last4s: string[];
  rows: FinTransactionInput[];
}

/** 이번 요청에서 실제로 추가한 거래만 센다. 기존 거래는 건드리지 않는다. */
export interface ImportAppendResult {
  id: string;
  inserted: number;
  skipped: number;
  income: number;
  expense: number;
  confirmed: number;
  suggested: number;
  needsReview: number;
}

export const MAX_IMPORT_APPEND_ROWS = 5_000;
export const IMPORT_APPEND_CHUNK_ROWS = 200;
