// ============================================================
//  어댑터 레지스트리 — 파일을 보고 출처를 알아낸다
// ------------------------------------------------------------
//  사용자가 "이건 신한은행 파일입니다" 를 고르게 만들지 않는다. 은행에서
//  받은 파일을 그대로 끌어다 놓으면 열 이름으로 출처를 판정한다. 애매하면
//  후보를 보여주고 고르게 한다 — 조용히 잘못 고르는 것보다 낫다.
// ============================================================

import * as XLSX from "xlsx";
import type { WorkBook } from "xlsx";
import { bankAdapters } from "./banks";
import { cardAdapters } from "./cards";
import { detectPayhere, parsePayhere as parsePayhereImpl } from "./pos";
import { detectNaverBooking, parseNaverBooking as parseNaverBookingImpl } from "./naver";
import { ledgerAdapter } from "./ledger";
import type { AdapterResult, ParseOptions, SourceAdapter } from "./types";

export const ADAPTERS: SourceAdapter[] = [ledgerAdapter, ...cardAdapters, ...bankAdapters];

/**
 * 매출 대사 전용 출처. 거래를 만들지 않으므로 어댑터 목록과 따로 둔다 —
 * 둘 다 정산 입금으로 이미 매출이 잡혀 있어서 적재하면 이중 계상이다.
 */
export const RECONCILE_SOURCES = [
  { id: "payhere", label: "페이히어 POS 매출 (대사용)" },
  { id: "naver-booking", label: "네이버 예약 (대사용)" },
] as const;

export interface Detection {
  adapter: SourceAdapter | null;
  /** 페이히어처럼 적재하지 않는 출처 */
  pos: boolean;
  confidence: number;
  /** 확신이 낮을 때 보여줄 후보들 */
  candidates: { adapter: SourceAdapter; confidence: number }[];
}

export function detectSource(wb: WorkBook, fileName?: string): Detection {
  // 대사 전용 출처를 먼저 걸러낸다 (적재 대상이 아니다)
  if (detectPayhere(wb) > 0 || detectNaverBooking(wb) > 0) {
    return { adapter: null, pos: true, confidence: 0.95, candidates: [] };
  }
  const scored = ADAPTERS.map((a) => ({ adapter: a, confidence: a.detect(wb, fileName) }))
    .filter((x) => x.confidence > 0)
    .sort((a, b) => b.confidence - a.confidence);

  return {
    adapter: scored[0]?.adapter ?? null,
    pos: false,
    confidence: scored[0]?.confidence ?? 0,
    candidates: scored,
  };
}

export function adapterById(id: string): SourceAdapter | undefined {
  return ADAPTERS.find((a) => a.id === id);
}

// ---- 파일 읽기 ------------------------------------------------

/** 암호가 걸린 오피스 파일의 시그니처 (CDFV2 + 암호화 스트림) */
export function looksEncrypted(buf: ArrayBuffer): boolean {
  const b = new Uint8Array(buf);
  // OLE2 헤더 D0 CF 11 E0 — xls 도 같은 헤더라 이것만으로는 부족하다.
  const ole = b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0;
  if (!ole) return false;
  // "EncryptedPackage" 스트림 이름이 UTF-16 으로 박혀 있다
  const needle = "EncryptedPackage";
  const utf16 = new Uint8Array(needle.length * 2);
  for (let i = 0; i < needle.length; i++) utf16[i * 2] = needle.charCodeAt(i);
  outer: for (let i = 0; i < b.length - utf16.length; i++) {
    for (let j = 0; j < utf16.length; j++) if (b[i + j] !== utf16[j]) continue outer;
    return true;
  }
  return false;
}

export function readWorkbook(buf: ArrayBuffer): WorkBook {
  return XLSX.read(buf, { type: "array", cellDates: true, cellText: true });
}

export interface ParseFileResult extends AdapterResult {
  adapterId: string;
  adapterLabel: string;
  detection: Detection;
}

/** 감지 → 파싱을 한 번에 (어댑터를 직접 지정할 수도 있다) */
export function parseWithAdapter(
  wb: WorkBook,
  opts: ParseOptions & { adapterId?: string },
): ParseFileResult | null {
  const detection = detectSource(wb, opts.fileName);
  const adapter = opts.adapterId ? adapterById(opts.adapterId) : detection.adapter;
  if (!adapter) return null;
  const result = adapter.parse(wb, opts);
  return { ...result, adapterId: adapter.id, adapterLabel: adapter.label, detection };
}

export * from "./types";
export { parsePayhere, reconcilePos, storeToUnit, type PosResult, type PosReconcile } from "./pos";
export { parseNaverBooking, detectNaverBooking } from "./naver";

/** 대사 전용 파일을 출처에 맞는 파서로 읽는다 */
export function parseReconcileSource(wb: WorkBook, fileName?: string) {
  if (detectNaverBooking(wb) > 0) return parseNaverBookingImpl(wb, fileName);
  return parsePayhereImpl(wb, fileName);
}
