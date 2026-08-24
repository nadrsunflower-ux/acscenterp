// ============================================================
//  임포트 어댑터 — 출처별 엑셀을 하나의 거래 모양으로
// ------------------------------------------------------------
//  은행·카드사·POS 는 각자 다른 엑셀을 준다. 열 이름도, 헤더 위치도,
//  금액의 부호 규칙도 다르다. 어댑터가 그 차이를 흡수하고 결과는 늘
//  같은 `ImportRow` 로 낸다 — 그래서 미리보기·중복검사·자동분류·적재는
//  출처를 몰라도 된다.
//
//  설계 원칙 세 가지
//   1) **추측을 확정으로 올리지 않는다.** 어댑터가 아는 것(카드 뒷자리,
//      이자입금 같은 확실한 계정)은 hint 로 넘기고, 최종 판단은
//      classify.ts 가 한다. 어댑터가 계정을 확정하면 조용히 틀린 분류가
//      쌓인다.
//   2) **읽지 못한 행은 버리지 않고 이유와 함께 남긴다.** 재무에서 조용한
//      누락이 가장 나쁘다.
//   3) **원본을 보존한다.** 외화 승인액, 원본 적요, 잔액 같은 것은 note 에
//      남겨 나중에 사람이 대조할 수 있게 한다.
// ============================================================

import type { WorkBook } from "xlsx";
import type { TxType } from "../types";

/** 어댑터가 내는 거래 1건. xlsx.ts 의 ParsedRow 와 같은 모양 + 힌트 */
export interface ImportRow {
  /** 원본 엑셀 행 번호 (1-base) — 오류 안내에 쓴다 */
  rowNo: number;
  date: string;
  datetime?: string;
  last4?: string;
  txType: TxType;
  bizMajor?: string;
  bizMinor?: string;
  acctMajor?: string;
  acctMid?: string;
  acctMinor?: string;
  vendor?: string;
  acctNote?: string;
  personalUse?: boolean;
  projectCode?: string;
  gross: number;
  adjust: number;
  site?: string;
  note?: string;
  refundMatchId?: string;
  dedupHash: string;
  /**
   * 어댑터의 추정. 확정이 아니라 "이력·규칙이 없을 때 쓸 후보"다.
   * classify.ts 가 suggested 로 처리한다.
   */
  hint?: ClassifyHint;
  /** 외화 원문 — 환산 전 금액을 잃지 않기 위해 */
  foreign?: { currency: string; amount: number };
}

export interface ClassifyHint {
  acctMajor?: string;
  acctMid?: string;
  acctMinor?: string;
  bizMajor?: string;
  bizMinor?: string;
  /** 왜 이렇게 추정했는가 — 검토함에서 사람에게 보여준다 */
  reason: string;
}

export interface ImportError {
  rowNo: number;
  reason: string;
}

/** 어댑터가 사람에게 물어야 하는 것 */
export interface AdapterNeeds {
  /** 파일에 계좌·카드 정보가 없어 사용자가 골라야 한다 */
  account?: boolean;
  /** 외화 건이 있어 환율이 필요하다 */
  fxCurrency?: string;
  fxRows?: number;
}

export interface AdapterResult {
  rows: ImportRow[];
  errors: ImportError[];
  /** 파싱에 쓴 시트 */
  sheetName: string;
  headerRowNo: number;
  /** 파일에서 읽어낸 계좌·카드 뒷 4자리들 (참고용) */
  detectedLast4: string[];
  needs: AdapterNeeds;
  /** 사람에게 알려야 하는 주의사항 (이중 계상 위험 등) */
  warnings: string[];
}

export interface ParseOptions {
  /** 파일명 — 파일 안에 계좌 정보가 없을 때 뒷자리를 찾는 근거 */
  fileName?: string;
  /** 사용자가 고른 계좌·카드 (파일 값보다 우선) */
  last4?: string;
  /** 외화 환율 (1 외화 = ? 원) */
  fxRate?: number;
  /** 마스터의 계좌·카드 뒷자리 목록 — 파일명 매칭에 쓴다 */
  knownLast4?: string[];
  /**
   * 우리 **법인·사업장** 이름 (네안데르·안다르 …). 자금거래 판정에 쓴다.
   * ⚠️ 사람 이름을 넣으면 급여가 자금거래로 잡혀 손익에서 사라진다.
   */
  ownEntities?: string[];
}

export type AdapterKind = "bank" | "card" | "pos" | "ledger";

export interface SourceAdapter {
  id: string;
  label: string;
  kind: AdapterKind;
  /** 이 어댑터가 이 워크북을 읽을 수 있는가. 확신도(0~1)로 답한다 */
  detect(wb: WorkBook, fileName?: string): number;
  parse(wb: WorkBook, opts: ParseOptions): AdapterResult;
}
