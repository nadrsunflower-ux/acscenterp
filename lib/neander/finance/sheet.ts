// ============================================================
//  원장 시트 — 셀 편집 초안(draft) 모델
// ------------------------------------------------------------
//  화면의 스프레드시트는 셀을 고칠 때마다 서버에 쓰지 않는다. 바뀐 행을
//  초안으로 쌓아두고 "저장" 한 번에 일괄 반영한다 (키 입력마다 Firestore
//  쓰기는 비용·경합 문제가 있고, 잘못 붙여넣은 걸 되돌릴 틈도 없다).
//
//  여기엔 React 와 무관한 순수 로직만 둔다: 어떤 필드가 편집 대상인지,
//  두 행이 같은지, 행이 저장 가능한 상태인지, 서버에 보낼 패치는 무엇인지.
// ============================================================

import { isAllowedTxAccountMismatch } from "./classify";
import type { FinAccountDoc, FinPaymentMethodDoc } from "./db-types";
import {
  TX_TYPES,
  dedupHashOf,
  lookupKeyOf,
  type ClassificationStatus,
  type FinTransaction,
  type FinTransactionInput,
  type TxType,
} from "./types";

/** 새 행의 id 접두 — 저장 전까지 서버 id 가 없으므로 임시로 붙인다 */
export const NEW_ID_PREFIX = "new:";
export const isNewRow = (t: Pick<FinTransaction, "id">) => t.id.startsWith(NEW_ID_PREFIX);

export const BIZ_MAJORS = ["B2C", "B2B", "공용", "해당없음"] as const;
export const STATUSES: ClassificationStatus[] = ["confirmed", "suggested", "needs_review"];

/**
 * 사람이 고칠 수 있는 필드. 이 목록이 "같은 행인가" 비교와 서버 패치의
 * 기준이다. 파생 값(순금액)·이력(createdAt 등)은 들어가지 않는다.
 */
export const EDITABLE_FIELDS = [
  "date",
  "last4",
  "txType",
  "bizMajor",
  "bizMinor",
  "acctMajor",
  "acctMid",
  "acctMinor",
  "vendor",
  "acctNote",
  "gross",
  "adjust",
  "site",
  "note",
  "personalUse",
  "projectCode",
  "refundMatchId",
  "status",
] as const satisfies readonly (keyof FinTransactionInput)[];

type EditableField = (typeof EDITABLE_FIELDS)[number];

/** 빈 문자열·null·undefined 를 같은 "비어 있음"으로 본다 */
const norm = (v: unknown) => (v === "" || v === null || v === undefined ? undefined : v);

/** 사람이 덧붙인 열의 값 비교 — 빈 문자열과 없음을 같게 본다 */
function extraEqual(a?: Record<string, string>, b?: Record<string, string>): boolean {
  const keys = new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})]);
  for (const k of keys) if (norm(a?.[k]) !== norm(b?.[k])) return false;
  return true;
}

export function rowsEqual(a: FinTransaction, b: FinTransaction): boolean {
  if (!EDITABLE_FIELDS.every((k) => norm(a[k]) === norm(b[k]))) return false;
  return extraEqual(a.extra, b.extra);
}

// ---- 셀 입력 정규화 ------------------------------------------

/**
 * 날짜 셀. 엑셀에서 붙여넣으면 `2026-07-31 14:02`, `2026.7.31`, `20260731`
 * 같은 꼴로 들어온다. 모두 `YYYY-MM-DD` 로 맞추고, 못 읽으면 원문을
 * 그대로 둔다 — 조용히 버리면 사용자가 눈치채지 못한다. 검증에서 걸린다.
 */
export function normalizeDateInput(raw: string): string {
  const s = raw.trim();
  if (!s) return "";
  const m =
    s.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})/) ?? s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!m) return s;
  return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
}

/** 형식뿐 아니라 실제 존재하는 날짜인지(2월 30일 등) 본다. 시간대 영향이 없도록 UTC 로 계산. */
export const isValidDate = (s: string) => {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
};

/** 금액 셀. `1,234` / `△1,234` / `-1234` / `1234원` 을 숫자로. 못 읽으면 NaN. */
export function parseAmountInput(raw: string): number {
  const s = raw.trim();
  if (!s) return 0;
  const neg = s.startsWith("△") || s.startsWith("-") || s.startsWith("(");
  const digits = s.replace(/[^\d.]/g, "");
  if (!digits) return NaN;
  const n = Math.round(Number(digits));
  return neg ? -n : n;
}

// ---- 검증 ----------------------------------------------------

export interface RowIssue {
  field: EditableField;
  message: string;
}

/**
 * 행 하나의 저장 가능 여부. 붙여넣기로 들어온 임의 문자열이 마스터에
 * 없는 값이면 여기서 잡는다. 계정은 3단이 모두 비었거나(미분류)
 * 마스터 4단 경로에 있어야 한다 — 반쪽짜리 경로는 집계를 깨뜨린다.
 */
export function validateRow(
  t: FinTransaction,
  ctx: { accounts: AccountIndex; paymentMethods: FinPaymentMethodDoc[] },
): RowIssue[] {
  const issues: RowIssue[] = [];
  if (!isValidDate(t.date ?? "")) issues.push({ field: "date", message: "거래일은 YYYY-MM-DD" });
  if (!(TX_TYPES as readonly string[]).includes(t.txType)) {
    issues.push({ field: "txType", message: `거래유형은 ${TX_TYPES.join("/")} 중 하나` });
  }
  if (t.bizMajor && !(BIZ_MAJORS as readonly string[]).includes(t.bizMajor)) {
    issues.push({ field: "bizMajor", message: `사업대분류는 ${BIZ_MAJORS.join("/")} 중 하나` });
  }
  if (t.last4 && !ctx.paymentMethods.some((p) => p.last4 === t.last4)) {
    issues.push({ field: "last4", message: "계좌 마스터에 없는 번호" });
  }
  if (!Number.isFinite(t.gross)) issues.push({ field: "gross", message: "원금액은 숫자" });
  if (!Number.isFinite(t.adjust)) issues.push({ field: "adjust", message: "조정금액은 숫자" });
  if (!STATUSES.includes(t.status)) issues.push({ field: "status", message: "상태 값이 잘못됨" });

  const anyAcct = Boolean(t.acctMajor || t.acctMid || t.acctMinor);
  if (anyAcct && !ctx.accounts.keys.has(lookupKeyOf(t))) {
    // 조회키가 안 맞아도 **계정 3단은 맞는** 경우가 있다. 거래유형만 다른
    // 것인데, 그중 일부는 장부의 확립된 관행이라 틀린 게 아니다.
    //   카드대금결제  계정은 「지출 > 재무비용 > 금융비용 > 카드대금결제」 로
    //                 등록돼 있지만 거래유형은 손익에서 빼려고 별도로 둔다.
    //   환급          되돌린 대상(=지출) 계정을 가리켜야 순손익이 맞는다.
    // 분류 엔진은 이미 이 둘을 정상으로 안다(classify.ts). 검증만 몰라서
    // 멀쩡한 행에 경고가 붙어 있었다 — 2608 장부에서 13건.
    const acctTxType = ctx.accounts.txTypeByPath.get(accountPathOf(t));
    if (!acctTxType || !isAllowedTxAccountMismatch(t.txType, t.acctMinor, acctTxType)) {
      const field: EditableField = !t.acctMajor ? "acctMajor" : !t.acctMid ? "acctMid" : "acctMinor";
      issues.push({
        field,
        message: acctTxType
          ? `이 계정은 ${acctTxType} 용이라 ${t.txType} 에 쓸 수 없음`
          : "계정 마스터에 없는 조합",
      });
    }
  }
  return issues;
}

/** 계정 3단 경로 — 거래유형을 뺀 나머지. 조회키와 달리 유형에 매이지 않는다. */
const accountPathOf = (t: Pick<FinTransaction, "acctMajor" | "acctMid" | "acctMinor">) =>
  [t.acctMajor ?? "", t.acctMid ?? "", t.acctMinor ?? ""].join("|");

/**
 * 검증에 쓰는 계정 색인.
 *
 * 조회키 집합만으로는 "마스터에 아예 없는 계정" 과 "계정은 맞는데 거래유형만
 * 다른 것" 을 구별할 수 없다. 후자는 관행상 정상인 경우가 있어서 3단 경로 →
 * 거래유형 맵을 함께 들고 다닌다.
 */
export interface AccountIndex {
  keys: Set<string>;
  txTypeByPath: Map<string, string>;
}

export const accountIndex = (accounts: FinAccountDoc[]): AccountIndex => ({
  keys: new Set(accounts.map((a) => a.lookupKey)),
  txTypeByPath: new Map(
    accounts.map((a) => [[a.major ?? "", a.mid ?? "", a.minor ?? ""].join("|"), a.txType]),
  ),
});

// ---- 정렬 ----------------------------------------------------

/** 정렬 가능한 열. `net` 은 저장 값이 아니라 파생(순금액)이다. */
export type SortKey =
  | "date"
  | "txType"
  | "last4"
  | "vendor"
  | "bizMajor"
  | "bizMinor"
  | "acctMajor"
  | "acctMid"
  | "acctMinor"
  | "gross"
  | "adjust"
  | "net"
  | "site"
  | "note"
  | "status";

export interface SortSpec {
  key: SortKey;
  dir: "asc" | "desc";
}

/** 상태는 가나다가 아니라 "손이 더 가는 순서"로 센다 */
const STATUS_ORDER: Record<ClassificationStatus, number> = {
  confirmed: 0,
  suggested: 1,
  needs_review: 2,
};

function sortValue(t: FinTransaction, key: SortKey): string | number | undefined {
  switch (key) {
    case "net":
      return (Number(t.gross) || 0) - (Number(t.adjust) || 0);
    case "gross":
    case "adjust":
      return Number(t[key]) || 0;
    // 거래유형·상태는 이름순이 아니라 정해진 순서로 (수입→지출→…, 확정→검토필요)
    case "txType":
      return (TX_TYPES as readonly string[]).indexOf(t.txType);
    case "status":
      return STATUS_ORDER[t.status] ?? 99;
    default:
      return t[key];
  }
}

const isEmptyValue = (v: string | number | undefined) =>
  v === undefined || v === null || v === "" || (typeof v === "number" && Number.isNaN(v));

/**
 * 필터 결과를 정렬한다. 빈 값은 방향과 무관하게 **항상 아래**로 보낸다
 * (엑셀·구글 시트와 같은 규칙이다 — 오름차순이라고 빈칸이 위로 올라오면
 * 채워야 할 행이 눈에서 사라진다). 값이 같으면 원래 순서를 유지한다.
 */
export function sortRows(rows: FinTransaction[], spec: SortSpec | null): FinTransaction[] {
  if (!spec) return rows;
  const dir = spec.dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = sortValue(a, spec.key);
    const bv = sortValue(b, spec.key);
    const ae = isEmptyValue(av);
    const be = isEmptyValue(bv);
    if (ae && be) return 0;
    if (ae) return 1;
    if (be) return -1;
    const d =
      typeof av === "number" && typeof bv === "number"
        ? av - bv
        : String(av).localeCompare(String(bv), "ko");
    return d * dir;
  });
}

// ---- 서버 패치 ----------------------------------------------

/**
 * 수정 행 → 패치. TransactionEditor 의 저장과 같은 규칙이다:
 * 빈 값은 undefined(서버에서 null = 필드 비우기), 금액은 숫자 강제,
 * 날짜·계좌·거래처·금액·유형이 바뀌었을 수 있으니 중복 키를 다시 센다.
 */
export function toPatch(t: FinTransaction): Partial<FinTransactionInput> {
  const str = (v?: string) => (v ? v : undefined);
  return {
    date: t.date,
    last4: str(t.last4),
    txType: t.txType as TxType,
    bizMajor: str(t.bizMajor),
    bizMinor: str(t.bizMinor),
    acctMajor: str(t.acctMajor),
    acctMid: str(t.acctMid),
    acctMinor: str(t.acctMinor),
    vendor: str(t.vendor),
    acctNote: str(t.acctNote),
    gross: Number(t.gross) || 0,
    adjust: Number(t.adjust) || 0,
    site: str(t.site),
    note: str(t.note),
    personalUse: t.personalUse || undefined,
    projectCode: str(t.projectCode),
    refundMatchId: str(t.refundMatchId),
    status: t.status,
    // 덧붙인 열은 값이 있을 때만 실어 보낸다 — 키가 있으면 서버가 null 로
    // 덮어써서 남의 열까지 지운다 (client.ts 의 undefined→null 주석 참고)
    ...(t.extra ? { extra: t.extra } : null),
    dedupHash: dedupHashOf({
      date: t.date,
      last4: t.last4,
      vendor: t.vendor,
      gross: Number(t.gross) || 0,
      txType: t.txType as TxType,
    }),
  };
}

/** 새 행 → 적재 입력. 화면에서 만든 거래임을 근거로 남긴다. */
export function toInput(t: FinTransaction): FinTransactionInput {
  const p = toPatch(t);
  return {
    ...p,
    date: p.date ?? "",
    txType: p.txType ?? "지출",
    gross: p.gross ?? 0,
    adjust: p.adjust ?? 0,
    status: p.status ?? "confirmed",
    dedupHash: p.dedupHash ?? "",
    classReason: "화면에서 직접 입력",
  };
}

/**
 * 아무것도 안 적은 새 행인가. "행 추가"만 누르고 비워둔 행을 0원 지출로
 * 적재하면 안 된다 — 저장에서 제외하되, 몇 건 제외했는지는 알려준다.
 */
export function isBlankRow(t: FinTransaction): boolean {
  return (
    !t.vendor &&
    !(Number(t.gross) || 0) &&
    !(Number(t.adjust) || 0) &&
    !t.acctMajor &&
    !t.acctMid &&
    !t.acctMinor &&
    !t.note &&
    !t.last4
  );
}

/** 빈 새 행 */
export function blankRow(id: string, date: string): FinTransaction {
  return {
    id,
    date,
    txType: "지출",
    gross: 0,
    adjust: 0,
    status: "confirmed",
    dedupHash: "",
    createdAt: 0,
  };
}
