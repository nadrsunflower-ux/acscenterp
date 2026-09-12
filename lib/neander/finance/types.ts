// ============================================================
//  재무 모듈 타입 — 통합거래장 29열의 ERP 표현
// ------------------------------------------------------------
//  엑셀 통합거래장의 29열 중 9열은 수식 파생이다. 저장하지 않고
//  계산·조인으로 얻는다. 저장하는 것은 "사람이 입력한 값"뿐이다.
//
//    저장  거래일시·계좌카번·거래유형·사업구분·계정3단·거래처·
//          원금액·조정금액·사업장·비고·프로젝트코드 …
//    파생  순금액(= 원금액 − 조정금액), 수입/지출금액(거래유형 분기),
//          별칭·사업장기본값(계좌 조인), 회계코드·부가세·자산·지점
//          (계정 조인), 조회키(계정 4단 경로)
//
//  이렇게 두면 "분류를 고치면 회계코드·부가세가 자동으로 따라온다"는
//  엑셀 VLOOKUP 동작이 조인으로 바뀌어 정합성이 깨지지 않는다.
// ============================================================

/** 거래유형 5종. 손익 집계는 수입·지출만 포함하고 환급은 지출에서 차감한다. */
export const TX_TYPES = ["수입", "지출", "자금거래", "카드대금결제", "환급"] as const;
export type TxType = (typeof TX_TYPES)[number];

/**
 * 손익에 잡히는 거래유형.
 * 자금거래(계좌간 이동)·카드대금결제는 실제 손익이 아니므로 제외한다.
 */
export const PL_TX_TYPES: TxType[] = ["수입", "지출", "환급"];

/** 분류 상태 — 자동분류 엔진이 매긴 확신도 */
export type ClassificationStatus =
  /** 확정. 사람이 승인했거나 규칙이 확실함 */
  | "confirmed"
  /** 제안됨. 근거는 있으나 사람 확인 필요 */
  | "suggested"
  /** 판단 불가. 사람이 직접 분류해야 함 */
  | "needs_review";

export const STATUS_LABEL: Record<ClassificationStatus, string> = {
  confirmed: "확정",
  suggested: "제안됨",
  needs_review: "검토필요",
};

export const STATUS_COLOR: Record<ClassificationStatus, string> = {
  confirmed: "#16a34a",
  suggested: "#f59e0b",
  needs_review: "#e11d48",
};

/** 거래 1건 */
export interface FinTransaction {
  id: string;

  // ---- 언제 · 어디서 ----
  /** 거래일 `YYYY-MM-DD` */
  date: string;
  /** 원본 거래일시 문자열 (있으면 보존) */
  datetime?: string;
  /** 계좌/카드 뒷 4자리 — 계좌 마스터와 매칭 */
  last4?: string;

  // ---- 무엇 ----
  txType: TxType;
  /** 사업대분류 B2C / B2B / 공용 / 해당없음 */
  bizMajor?: string;
  /** 사업소분류 와우 / 아이디 / 홍대공용 / SMOAT / 조향 … */
  bizMinor?: string;
  /** 계정 3단 */
  acctMajor?: string;
  acctMid?: string;
  acctMinor?: string;
  /** 거래처 */
  vendor?: string;
  /** 계정소분류비고 */
  acctNote?: string;

  // ---- 얼마 ----
  /** 원금액 */
  gross: number;
  /** 조정금액 (환불·부분취소 등). 순금액 = gross − adjust */
  adjust: number;

  // ---- 부가 정보 ----
  /** 사업장. 계좌 마스터 기본값을 쓰되 수기 덮어쓰기 가능 */
  site?: string;
  /** 임직원 개인 사용분 */
  personalUse?: boolean;
  projectCode?: string;
  /** 비고 (자유 메모) */
  note?: string;
  /**
   * 사람이 덧붙인 열의 값 (열 id → 문자열).
   * 집계·검증·엑셀 내보내기는 보지 않는다 — 화면에서만 쓰는 메모 칸이다.
   */
  extra?: Record<string, string>;

  // ---- 분류 상태 ----
  status: ClassificationStatus;
  /** 자동분류 근거 — 검토 대기함에서 사람에게 보여준다 */
  classReason?: string;
  /**
   * 환급 매칭 라벨 (`RF-2607-01`). 엑셀에서는 원거래와 환급 거래가
   * 이 값을 **공유**한다. 1:1 FK 가 아니라 그룹 라벨이므로 그대로 보존한다.
   */
  refundMatchId?: string;

  // ---- 적재 이력 ----
  /** 중복 검사 키 — 같은 파일을 두 번 올려도 중복 적재되지 않는다 */
  dedupHash: string;
  /** 이 거래를 넣은 임포트 배치 */
  importBatchId?: string;

  createdAt: number;
  updatedAt?: number;
  /** 마지막으로 분류를 고친 사람 (팀원 id) */
  updatedBy?: string;
}

export type FinTransactionInput = Omit<FinTransaction, "id" | "createdAt">;

/** 임포트 배치 1회 */
export interface FinImportBatch {
  id: string;
  /** 원본 파일명 */
  fileName: string;
  /** 적재된 건수 */
  inserted: number;
  /** 중복으로 건너뛴 건수 */
  skipped: number;
  /** 적재한 사람 (팀원 id) */
  byMemberId?: string;
  createdAt: number;
}

// ---- 파생 계산 ---------------------------------------------

/** 순금액 = 원금액 − 조정금액. 모든 집계의 기준. */
export function netAmount(t: Pick<FinTransaction, "gross" | "adjust">): number {
  return (t.gross || 0) - (t.adjust || 0);
}

/** 수입금액 — 거래유형이 수입일 때만 순금액, 아니면 0 */
export function incomeAmount(t: FinTransaction): number {
  return t.txType === "수입" ? netAmount(t) : 0;
}

/** 지출금액 — 거래유형이 지출일 때만 순금액, 아니면 0 */
export function expenseAmount(t: FinTransaction): number {
  return t.txType === "지출" ? netAmount(t) : 0;
}

/** 환급액 — 지출에서 차감되는 금액 */
export function refundAmount(t: FinTransaction): number {
  return t.txType === "환급" ? netAmount(t) : 0;
}

/** 계정 조회키 `거래유형|대|중|소` — 계정 마스터 조인에 사용 */
export function lookupKeyOf(
  t: Pick<FinTransaction, "txType" | "acctMajor" | "acctMid" | "acctMinor">,
): string {
  return [t.txType, t.acctMajor ?? "", t.acctMid ?? "", t.acctMinor ?? ""].join("|");
}

/**
 * 중복 검사 키.
 *
 * 엑셀의 조회키는 `거래유형|대|중|소` 형태의 **분류 lookup 키**라
 * 같은 분류의 거래 수백 건이 같은 값을 갖는다 — 중복 검사에 쓸 수 없다.
 * 대신 "같은 날, 같은 계좌, 같은 거래처, 같은 금액이면 같은 거래"로 본다.
 * 분류는 나중에 바뀔 수 있으므로 **분류 필드는 넣지 않는다.**
 *
 * ⚠️ 이 값은 유일하지 않다. 같은 날 같은 거래처에 같은 금액이 실제로 두 번
 *    청구되는 일이 있다(2607 장부 실측 4건). 그래서 임포트 중복 판정은
 *    "이 키가 이미 있는가"가 아니라 **"몇 건 있는가"** 를 센다 —
 *    DB 에 2건 있고 파일에 3건이면 1건만 새로 넣는다. 키 하나로
 *    막아버리면 멀쩡한 거래가 조용히 누락된다.
 */
export function dedupHashOf(input: {
  date: string;
  last4?: string;
  vendor?: string;
  gross: number;
  txType: TxType;
}): string {
  const norm = (s?: string) => (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  return [
    input.date,
    norm(input.last4),
    norm(input.vendor),
    Math.round(input.gross || 0),
    input.txType,
  ].join("¦");
}

/** 회계 표기: 음수는 △ 로 (엑셀 사업부손익 시트와 동일한 표기) */
export function formatSigned(n: number): string {
  const abs = Math.abs(Math.round(n)).toLocaleString("ko-KR");
  return n < 0 ? `△${abs}` : abs;
}
