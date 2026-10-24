// ============================================================
//  거래 변경 이력 — 누가 · 무엇으로 · 언제 · 무엇을 바꿨나
// ------------------------------------------------------------
//  원장은 여러 길로 바뀐다 — 검토 대기함 확정, 원장 시트 일괄 저장, 계속 배우기,
//  묶음 확정, 재무 비서의 제안 적용, 자동 처리 되돌리기. 그런데 거래에는 마지막
//  수정 시각(updatedAt)과 사람(updatedBy) 하나만 남아서, 「이 계정을 누가 언제
//  왜 바꿨지」 를 물으면 답이 없었다. 자동화를 넓힐수록 이 질문이 늘어난다.
//
//  그래서 쓰기가 일어날 때마다 서버가 바뀐 칸만 한 줄로 남긴다 (neander_fin_tx_log).
//    · 남긴 사람(by)은 서버가 찍는다 — 브라우저가 고를 수 없다 (회의 기록과 같다)
//    · 무엇으로(via)는 브라우저가 알려 준다 — 「계속 배우기」 · 「묶음 확정」 처럼
//      사람이 누른 것이 아니라 프로그램이 한 일을 가린다
//    · 엑셀 적재(새 거래 수백 건)는 남기지 않는다 — 적재 이력(neander_fin_imports)이 그 기록이다
//
//  화면은 거래 편집 창 아래 「기록」 칸 (TransactionEditor).
// ============================================================

/** 기록하는 칸 — 회계에 닿는 것만. 메모성 칸(extra)은 뺀다 */
export const LOGGED_FIELDS = [
  "status",
  "txType",
  "acctMajor",
  "acctMid",
  "acctMinor",
  "bizMajor",
  "bizMinor",
  "vendor",
  "date",
  "gross",
  "adjust",
  "last4",
  "site",
  "projectCode",
  "personalUse",
  "note",
  "cardMemo",
] as const;
export type LoggedField = (typeof LOGGED_FIELDS)[number];

export const FIELD_LABEL: Record<LoggedField, string> = {
  status: "상태",
  txType: "거래유형",
  acctMajor: "계정 대분류",
  acctMid: "계정 중분류",
  acctMinor: "계정 소분류",
  bizMajor: "사업대분류",
  bizMinor: "사업소분류",
  vendor: "거래처",
  date: "거래일",
  gross: "원금액",
  adjust: "조정금액",
  last4: "계좌·카드",
  site: "사업장",
  projectCode: "프로젝트",
  personalUse: "개인사용",
  note: "비고",
  cardMemo: "카드 메모",
};

/** 무엇으로 바꿨나 — 브라우저가 알려 준다 (모르면 비워 둔다) */
export const VIA_LABEL: Record<string, string> = {
  review: "검토 대기함",
  group: "검토 대기함 · 묶음 확정",
  relearn: "계속 배우기 (자동)",
  trust: "믿을 범위 켜기 (자동)",
  auto: "자동 처리 · 대기함으로 돌려보냄",
  ledger: "거래 원장",
  editor: "거래 편집 창",
  assistant: "재무 비서 제안",
  undo: "되돌리기",
  card: "카드 메모 대조",
  receipt: "받을 돈 짝짓기",
  mail: "결제 알림 메일 대조",
  import: "엑셀 임포트",
};

export const isVia = (v: unknown): v is string => typeof v === "string" && /^[a-z-]{1,24}$/.test(v);

export type LogValue = string | number | boolean | null;

export interface TxLogChange {
  f: LoggedField;
  from: LogValue;
  to: LogValue;
}

export type TxLogKind = "edit" | "add" | "delete" | "restore";

export interface TxLogEntry {
  id: string;
  txId: string;
  at: number;
  /** 남긴 사람 — 서버가 찍은 로그인 이메일 */
  by: string;
  via?: string;
  kind: TxLogKind;
  changes?: TxLogChange[];
}

const norm = (v: unknown): LogValue => {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
  return String(v);
};

/** 바뀐 칸만 — 비어 있음 · null · undefined 는 같은 것으로 본다 */
export function diffFields(before: Record<string, unknown> | undefined, after: Record<string, unknown>): TxLogChange[] {
  const out: TxLogChange[] = [];
  LOGGED_FIELDS.forEach((f) => {
    if (!(f in after)) return;
    const from = norm(before?.[f]);
    const to = norm(after[f]);
    if (from !== to) out.push({ f, from, to });
  });
  return out;
}

const STATUS_WORD: Record<string, string> = { confirmed: "확정", suggested: "제안됨", needs_review: "검토필요" };

/** 바뀐 값을 사람 말로 */
export function logValueText(f: LoggedField, v: LogValue): string {
  if (v === null) return "비움";
  if (f === "status") return STATUS_WORD[String(v)] ?? String(v);
  if (f === "personalUse") return v ? "예" : "아니오";
  if (typeof v === "number") return v.toLocaleString("ko-KR");
  const s = String(v);
  return s.length > 40 ? `${s.slice(0, 40)}…` : s;
}
