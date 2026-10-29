// ============================================================
//  급여·세무 서류 — 세무사가 보내 주는 급여대장 · 명세서 · 사업대장 · 신고서
// ------------------------------------------------------------
//  매달 세무사(택스플래닛)가 PDF 묶음을 보내 준다. 지금까지는 iCloud 회계 폴더에
//  달마다 손으로 넣었는데, 폴더 이름이 귀속월이기도 하고 신고월이기도 해서
//  (8월 폴더에 7월 귀속 명세서, 10월 폴더에 10월 귀속 대장) 찾을 때마다 헷갈렸다.
//
//  그래서 **파일 안 글자**로 종류와 귀속을 정한다 (tax-docs-parse.ts). 파일 이름 ·
//  폴더는 글자가 없는 스캔본(지방세 납부서 등)일 때만 쓴다.
//
//  서류가 정본이 아니다 — 돈이 나간 기록은 여전히 원장 거래다. 여기서 읽은 숫자는
//  「세무사 서류끼리 맞는가 · 장부와 맞는가」 를 보는 데만 쓴다 (tax-docs-check.ts).
//  급여 · 4대보험을 직접 계산하지 않는다.
//
//  ⚠️ 원천징수영수증 · 지급명세서 글자에는 주민등록번호가 있다. 파일은 재무 권한
//     뒤에만 두고, 읽은 글자는 저장하지 않는다 — 숫자와 이름만 남긴다.
// ============================================================

export type TaxDocKind =
  | "payroll-ledger"
  | "payslip"
  | "biz-ledger"
  | "biz-cert"
  | "wht-return"
  | "wht-bill"
  | "local-bill"
  | "wht-receipt"
  | "payroll-sent"
  | "pay-sheet"
  | "vat-return"
  | "vat-receipt"
  | "vat-bill"
  | "wage-cert"
  | "other";

/** 귀속을 어떤 단위로 적는가 — month `2026-10` · quarter `2026-Q2` · year `2026` */
export type TaxCadence = "month" | "quarter" | "year" | "none";

export const TAX_DOC_KINDS: { kind: TaxDocKind; label: string; short: string; cadence: TaxCadence; hint: string }[] = [
  { kind: "payroll-ledger", label: "급여대장", short: "급여대장", cadence: "month", hint: "근로소득 — 사람마다 지급합계 · 공제 · 차인지급액" },
  { kind: "payslip", label: "급여명세서", short: "명세서", cadence: "month", hint: "근로소득 — 한 사람 한 장" },
  { kind: "biz-ledger", label: "사업소득 지급대장", short: "사업대장", cadence: "month", hint: "3.3% 사업소득 — 사람마다 지급액 · 소득세 · 차인지급액" },
  { kind: "biz-cert", label: "사업소득 원천징수영수증", short: "사업 영수증", cadence: "month", hint: "3.3% 사업소득 — 한 사람 한 장" },
  { kind: "wht-return", label: "원천세 신고서", short: "신고서", cadence: "month", hint: "원천징수이행상황신고서 — 근로 · 사업 인원과 낼 세금" },
  { kind: "wht-bill", label: "원천세 납부서 (국세)", short: "국세 납부서", cadence: "month", hint: "근로소득세 · 사업소득세 — 다음 달 10일까지" },
  { kind: "local-bill", label: "지방소득세 납부서", short: "지방세", cadence: "month", hint: "원천세의 10% — 위택스" },
  { kind: "wht-receipt", label: "원천세 접수증", short: "접수증", cadence: "month", hint: "홈택스 신고 접수증" },
  { kind: "payroll-sent", label: "인건비 신고내역", short: "보낸 내역", cadence: "month", hint: "우리가 세무사에게 보낸 엑셀 (주민번호가 들어 있다)" },
  { kind: "pay-sheet", label: "급여 지급표", short: "지급표", cadence: "month", hint: "MMDD지급.xlsx — 우리가 만든 지급 계산" },
  { kind: "vat-return", label: "부가세 신고서", short: "신고서", cadence: "quarter", hint: "일반과세자 부가가치세 신고서" },
  { kind: "vat-receipt", label: "부가세 접수증", short: "접수증", cadence: "quarter", hint: "과세표준 · 실제 납부할 세액" },
  { kind: "vat-bill", label: "부가세 납부서", short: "납부서", cadence: "quarter", hint: "1·4·7·10월 25일 무렵 기한" },
  { kind: "wage-cert", label: "근로소득 원천징수영수증", short: "근로 영수증", cadence: "year", hint: "연말정산 — 한 사람 한 해" },
  { kind: "other", label: "기타 서류", short: "기타", cadence: "none", hint: "종류를 정하지 못했다 — 직접 고른다" },
];

const KIND_META = new Map(TAX_DOC_KINDS.map((k) => [k.kind, k]));
export const taxKindMeta = (kind: TaxDocKind) => KIND_META.get(kind) ?? KIND_META.get("other")!;
export const taxKindLabel = (kind: TaxDocKind) => taxKindMeta(kind).label;
export const cadenceOf = (kind: TaxDocKind): TaxCadence => taxKindMeta(kind).cadence;
export const isTaxDocKind = (v: unknown): v is TaxDocKind => typeof v === "string" && KIND_META.has(v as TaxDocKind);

/** 월별 표의 열 — 세무사가 보내는 것 (우리가 만든 엑셀은 상세에만) */
export const MONTH_COLUMNS: TaxDocKind[] = [
  "payroll-ledger",
  "payslip",
  "biz-ledger",
  "wht-return",
  "wht-bill",
  "local-bill",
  "wht-receipt",
];
export const QUARTER_COLUMNS: TaxDocKind[] = ["vat-return", "vat-receipt", "vat-bill"];

/** 사업자 — 글자에서 읽은 상호를 이 이름으로 맞춘다 */
export const TAX_ENTITIES = ["네안데르", "일해라컴퍼니", "와작홈즈"] as const;

// ---- 읽은 숫자 ----------------------------------------------------

/** 대장 · 명세서의 한 사람 */
export interface TaxPayLine {
  /** 세무사 프로그램의 사원코드 (0006 · 000007) */
  code?: string;
  /** 「(대표)」 는 떼지 않고 그대로 — 장부 대조가 뗀다 */
  name: string;
  /** 지급합계 (사업소득은 지급액) */
  gross: number;
  /** 공제합계 (사업소득은 소득세 + 지방소득세 + 보험료) */
  deduct: number;
  /** 차인지급액 — 통장으로 나갈 돈 */
  net: number;
  incomeTax?: number;
  localTax?: number;
}

export interface TaxPayTotal {
  count: number;
  gross: number;
  deduct: number;
  net: number;
  incomeTax?: number;
  localTax?: number;
}

/** 원천세 신고서 한 줄 (A10 근로 가감계 · A30 사업 가감계 · A99 총합계) */
export interface TaxWhtLine {
  count: number;
  gross: number;
  /** 징수세액 (소득세 등) */
  tax: number;
  /** 납부세액 (소득세 등 · 가산세 포함) */
  paid: number;
  /** 당월조정환급세액 — 지난달 남은 환급을 이번 달 세금에서 뺀 돈 */
  adjust?: number;
}

export interface TaxVatFigures {
  /** 과세기간 `YYYY-MM-DD` */
  from?: string;
  to?: string;
  /** 과세표준 (매출 합계) */
  base?: number;
  salesTax?: number;
  buyTax?: number;
  /** 납부할 세액 — 음수면 환급 */
  payable?: number;
  /** 접수일 */
  filedAt?: string;
}

export interface TaxDocData {
  /** 지급일 `YYYY-MM-DD` (대장 · 명세서) */
  payDate?: string;
  /** 신고서의 지급연월 `YYYY-MM` */
  payMonth?: string;
  /** 납부기한 `YYYY-MM-DD` */
  dueDate?: string;
  people?: TaxPayLine[];
  total?: TaxPayTotal;
  wage?: TaxWhtLine;
  biz?: TaxWhtLine;
  all?: TaxWhtLine;
  /** 납부서 세목별 금액 (근로소득세(갑) · 사업소득세 · 부가가치세) */
  items?: { label: string; amount: number }[];
  vat?: TaxVatFigures;
}

/** 서버가 내려주는 서류 하나 (조각 · 해시는 뺀다) */
export interface TaxDoc {
  id: string;
  kind: TaxDocKind;
  /** 귀속 — 종류의 cadence 꼴. 모르면 비어 있다 */
  period?: string;
  entity?: string;
  name: string;
  type: string;
  size: number;
  uploadedBy: string;
  createdAt: number;
  /** 사람이 종류 · 귀속을 고쳤다 — 다시 읽어도 덮어쓰지 않는다 */
  manual?: boolean;
  /** 글자 층이 없는 스캔본 — 숫자를 못 읽었다 */
  scanned?: boolean;
  /** 어떻게 정했는가 한 줄 (글자 · 파일 이름 · 폴더 · 같이 올린 파일) */
  reason?: string;
  note?: string;
  data?: TaxDocData;
}

/** 한 파일 한도 — 세무사 PDF 는 100~600KB, 부가세 신고서가 1MB 남짓 */
export const TAX_DOC_MAX_BYTES = 20 * 1024 * 1024;
/** 조각 크기 — 회의 첨부와 같다 (Firestore 문서 1MB · Vercel 요청 4.5MB 사이) */
export const TAX_DOC_PART_BYTES = 768 * 1024;
export const TAX_DOC_EXTS = ["pdf", "xlsx", "xls", "csv", "jpg", "jpeg", "png", "docx", "hwp", "hwpx"];

export const taxDocExt = (name: string) => (name.split(".").pop() ?? "").toLowerCase();

/**
 * 폴더째 올릴 때 가져올 파일인가 — 회계 폴더에는 장부 · 원가계산 · 예산 엑셀(수 MB)이
 * 같이 있다. 세무사 서류(PDF · zip)만 가져오고, 엑셀은 급여 쪽 작업 파일(인건비 신고내역 ·
 * MMDD지급)만 — 그것도 주민번호 · 주소가 있어 `withSheets` 일 때만. 장부 사본(통합거래장)과
 * 참고자료 폴더는 뺀다. 화면의 「폴더째 올리기」 와 이관 스크립트가 같은 기준을 쓴다.
 */
export function isTaxFolderPick(path: string, withSheets = false): boolean {
  const p = path.normalize("NFC");
  const base = p.split("/").pop() ?? p;
  if (!base || base.startsWith(".") || base.startsWith("~$") || p.includes("__MACOSX/")) return false;
  if (/참고자료|개인사업자자료/.test(p) || /통합거래장/.test(base)) return false;
  const ext = taxDocExt(base);
  if (ext === "pdf" || ext === "zip") return true;
  return withSheets && (ext === "xlsx" || ext === "xls") && /인건비.?신고내역|^\d{4}지급/.test(base);
}

// ---- 귀속 ---------------------------------------------------------

const MONTH_RE = /^20\d\d-(0[1-9]|1[0-2])$/;
const QUARTER_RE = /^20\d\d-Q[1-4]$/;
const YEAR_RE = /^20\d\d$/;

/** 그 종류에 맞는 귀속 꼴인가 */
export function isPeriodFor(kind: TaxDocKind, period: string | undefined): boolean {
  if (!period) return false;
  switch (cadenceOf(kind)) {
    case "month":
      return MONTH_RE.test(period);
    case "quarter":
      return QUARTER_RE.test(period);
    case "year":
      return YEAR_RE.test(period);
    default:
      return MONTH_RE.test(period) || QUARTER_RE.test(period) || YEAR_RE.test(period);
  }
}

/** 귀속의 해 */
export const periodYear = (period: string | undefined) => (period && /^20\d\d/.test(period) ? period.slice(0, 4) : undefined);

export function periodLabel(period: string | undefined): string {
  if (!period) return "귀속 모름";
  if (MONTH_RE.test(period)) return `${period.slice(0, 4)}년 ${Number(period.slice(5))}월`;
  if (QUARTER_RE.test(period)) {
    const q = Number(period.slice(6));
    return `${period.slice(0, 4)}년 ${q <= 2 ? 1 : 2}기 ${q % 2 ? "예정" : "확정"} (${q}분기)`;
  }
  if (YEAR_RE.test(period)) return `${period}년 귀속`;
  return period;
}

/** 분기 끝 달 → 분기 (3 → Q1) */
export const quarterOfMonth = (month: number) => Math.min(4, Math.max(1, Math.ceil(month / 3)));

/** 같은 종류 · 같은 귀속에 판이 둘 이상이면 — 「정정 · 수정」 이 붙은 것, 아니면 나중에 올린 것 */
export function pickCurrent(docs: TaxDoc[]): TaxDoc | undefined {
  if (docs.length <= 1) return docs[0];
  const fixed = docs.filter((d) => /정정|수정/.test(d.name));
  const pool = fixed.length ? fixed : docs;
  return [...pool].sort((a, b) => b.createdAt - a.createdAt)[0];
}

/** 이름 맞추기 — 「유재영(대표)」 · 「유재영님」 · 「유재영 급여」 를 같은 사람으로 */
export function personKey(name: string): string {
  return name
    .replace(/\(.*?\)/g, "")
    .replace(/님$/, "")
    .replace(/\s+/g, "")
    .toUpperCase();
}
