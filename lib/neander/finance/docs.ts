// ============================================================
//  프로젝트 문서 — 견적서 · 계약서
// ------------------------------------------------------------
//  프로젝트마다 밖으로 나가는 종이가 둘 있다. 일을 따기 전에 보내는
//  **견적서**, 일을 따고 나서 주고받는 **계약서**. 둘 다 지금은 iCloud
//  폴더 어딘가에 엑셀·PDF 로 흩어져 있어서, 반년 지나 "그때 얼마에
//  해 줬지" 를 찾으려면 폴더를 뒤져야 했다.
//
//  견적서는 **만든다.** 출발점은 「2026FNC_납품가_계산기」 의 견적서(최종)
//  시트다 — 견적번호·수신·공급자 표·품명/규격/수량/단가/공급가액 표·
//  「일금 ○○원정」. 그 칸을 그대로 화면에 두고, 채우면 인쇄창(PDF)과
//  엑셀로 뽑는다. 외부에서 받은 견적서 파일도 같은 문서에 붙여 둘 수 있다.
//
//  계약서는 **보관한다.** 계약서 본문을 여기서 쓰지는 않는다 — 대개
//  주최측 양식으로 오고, 도장 찍힌 PDF 가 원본이다. 대신 그 PDF 를
//  프로젝트에 붙이고, 금액·기간·상태 같은 요약을 옆에 적어 목록에서
//  파일을 열지 않고도 읽을 수 있게 한다.
//
//  문서 1개 = Firestore 문서 1개. 두 종류를 한 컬렉션(neander_fin_docs)에
//  `kind` 로 구분해 둔다 — 프로젝트 화면이 "이 프로젝트의 문서" 를 한 번에
//  받아야 하고, 나중에 발주서·거래명세서가 붙어도 같은 자리에 들어간다.
//  파일은 Storage 경로만 남긴다 (card-memo 와 같은 이유 — 서명 URL 은
//  만료된다).
// ============================================================

import { VAT_MODES, VAT_RATE, type VatMode } from "./project";

export type FinDocKind = "quote" | "contract";

export const DOC_KIND_LABEL: Record<FinDocKind, string> = {
  quote: "견적서",
  contract: "계약서",
};

/** Storage 에 올린 파일 하나. `path` 가 본체이고 나머지는 목록에 보이기 위한 것 */
export interface FinDocFile {
  path: string;
  name: string;
  size: number;
  type: string;
  uploadedAt: number;
}

// ---- 견적서 ------------------------------------------------------

export const QUOTE_STATUSES = ["draft", "sent", "accepted", "rejected"] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

export const QUOTE_STATUS_LABEL: Record<QuoteStatus, string> = {
  draft: "작성 중",
  sent: "보냄",
  accepted: "수주",
  rejected: "미수주",
};

export const QUOTE_STATUS_COLOR: Record<QuoteStatus, string> = {
  draft: "#a1a1aa",
  sent: "#2a78d6",
  accepted: "#16a34a",
  rejected: "#f59e0b",
};

/**
 * 견적서 단가의 부가세 기준. 면세는 없다 — 우리 견적은 물품·용역이라
 * 부가세가 붙고, 예시 시트도 「VAT 포함」 으로 나갔다.
 */
export type QuoteVatMode = Exclude<VatMode, "exempt">;

export const QUOTE_VAT_LABEL: Record<QuoteVatMode, string> = {
  included: "VAT 포함",
  excluded: "VAT 별도",
};

/** 견적서 공급자 칸 — 시트 오른쪽 위의 표 */
export interface FinSupplier {
  bizNo: string;
  name: string;
  ceo: string;
  address: string;
  bizType: string;
  bizItem: string;
  contact: string;
  phone: string;
}

/** 예시 시트의 값. 새 견적서는 가장 최근 견적서의 공급자 칸을 물려받고, 없으면 이걸 쓴다 */
export const DEFAULT_SUPPLIER: FinSupplier = {
  bizNo: "683-86-02812",
  name: "(주)네안데르",
  ceo: "유재영",
  address: "서울시 마포구 독막로36길 10-6, 1층",
  bizType: "도매 및 소매업",
  bizItem: "화장품 도소매업",
  contact: "유선화",
  phone: "010-8028-3822",
};

export interface FinQuoteLine {
  id: string;
  /** 품명 */
  name: string;
  /** 규격/사양 — 「개/200ml」 */
  spec?: string;
  qty: number;
  unitPrice: number;
  note?: string;
}

interface FinDocBase {
  id: string;
  projectId: string;
  kind: FinDocKind;
  /** 견적명 · 계약명 */
  title: string;
  note?: string;
  /** 붙여 둔 파일. 저장은 파일 라우트가 따로 한다 — doc.save 는 이 배열을 건드리지 않는다 */
  files: FinDocFile[];
  createdAt: number;
  createdBy?: string;
  updatedAt?: number;
  updatedBy?: string;
}

export interface FinQuoteDoc extends FinDocBase {
  kind: "quote";
  /** 「제 26-218호」 의 26-218 */
  quoteNo: string;
  /** 견적일 YYYY-MM-DD */
  date: string;
  /** 수신 — 「FNC 님 귀하」 의 FNC */
  recipient: string;
  supplier: FinSupplier;
  /** 납품기한 */
  delivery?: string;
  /** 대금 지불방식 */
  payment?: string;
  /** 견적 유효기간 */
  validity?: string;
  vatMode: QuoteVatMode;
  lines: FinQuoteLine[];
  status: QuoteStatus;
}

// ---- 계약서 ------------------------------------------------------

export const CONTRACT_STATUSES = ["draft", "signed", "done", "cancelled"] as const;
export type ContractStatus = (typeof CONTRACT_STATUSES)[number];

export const CONTRACT_STATUS_LABEL: Record<ContractStatus, string> = {
  draft: "초안 · 검토 중",
  signed: "체결",
  done: "이행 완료",
  cancelled: "해지 · 무산",
};

export const CONTRACT_STATUS_COLOR: Record<ContractStatus, string> = {
  draft: "#f59e0b",
  signed: "#2a78d6",
  done: "#16a34a",
  cancelled: "#a1a1aa",
};

export interface FinContractDoc extends FinDocBase {
  kind: "contract";
  /** 상대방 — 주최사 · 발주처 */
  counterparty: string;
  /** 계약금액 (적힌 그대로). 부가세 기준은 vatMode */
  amount: number;
  vatMode: VatMode;
  startDate?: string;
  endDate?: string;
  /** 체결(날인)일 */
  signedDate?: string;
  status: ContractStatus;
}

export type FinDoc = FinQuoteDoc | FinContractDoc;

type Meta = "id" | "createdAt" | "createdBy" | "updatedAt" | "updatedBy" | "files";
export type FinQuoteInput = Omit<FinQuoteDoc, Meta>;
export type FinContractInput = Omit<FinContractDoc, Meta>;
export type FinDocInput = FinQuoteInput | FinContractInput;

export const isQuote = (d: FinDoc): d is FinQuoteDoc => d.kind === "quote";
export const isContract = (d: FinDoc): d is FinContractDoc => d.kind === "contract";

// ---- 만들기 -------------------------------------------------------

export const shortId = () => Math.random().toString(36).slice(2, 10);

export function newQuoteLine(): FinQuoteLine {
  return { id: shortId(), name: "", qty: 1, unitPrice: 0 };
}

const today = () => new Date().toISOString().slice(0, 10);

/**
 * 다음 견적번호. 예시의 「제 26-218호」 처럼 연도 두 자리 + 일련번호.
 * 올해 견적서 중 가장 큰 일련번호 + 1 — 지운 번호를 다시 쓰지 않는다.
 * 손으로 고칠 수 있는 **제안**일 뿐이라 유일성을 강제하지 않는다.
 */
export function nextQuoteNo(existing: FinDoc[], date = today()): string {
  const yy = date.slice(2, 4);
  let max = 0;
  existing.forEach((d) => {
    if (!isQuote(d)) return;
    const m = /^(\d{2})-(\d+)$/.exec(d.quoteNo.trim());
    if (m && m[1] === yy) max = Math.max(max, Number(m[2]));
  });
  return `${yy}-${String(max + 1).padStart(3, "0")}`;
}

/** 가장 최근 견적서의 공급자 칸 — 담당자·연락처가 바뀌면 그다음부터 따라온다 */
export function lastSupplier(existing: FinDoc[]): FinSupplier {
  const quotes = existing.filter(isQuote).sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt));
  return quotes[0]?.supplier ? { ...DEFAULT_SUPPLIER, ...quotes[0].supplier } : { ...DEFAULT_SUPPLIER };
}

export function emptyQuote(
  projectId: string,
  seed: { title?: string; recipient?: string; existing?: FinDoc[] } = {},
): FinQuoteInput {
  const existing = seed.existing ?? [];
  return {
    projectId,
    kind: "quote",
    title: seed.title ?? "",
    quoteNo: nextQuoteNo(existing),
    date: today(),
    recipient: seed.recipient ?? "",
    supplier: lastSupplier(existing),
    delivery: "",
    payment: "",
    validity: "견적일로부터 7일간",
    vatMode: "included",
    lines: [newQuoteLine()],
    status: "draft",
  };
}

export function emptyContract(
  projectId: string,
  seed: { title?: string; counterparty?: string; amount?: number; vatMode?: VatMode; startDate?: string; endDate?: string } = {},
): FinContractInput {
  return {
    projectId,
    kind: "contract",
    title: seed.title ?? "",
    counterparty: seed.counterparty ?? "",
    amount: seed.amount ?? 0,
    vatMode: seed.vatMode ?? "included",
    startDate: seed.startDate,
    endDate: seed.endDate,
    status: "draft",
  };
}

// ---- 계산 ---------------------------------------------------------

export const quoteLineAmount = (l: Pick<FinQuoteLine, "qty" | "unitPrice">) =>
  Math.round((Number(l.qty) || 0) * (Number(l.unitPrice) || 0));

export interface QuoteTotals {
  /** 표에 적힌 공급가액 합 (단가 기준 그대로) */
  sum: number;
  qty: number;
  supply: number;
  vat: number;
  /** 「합계금액 (공급가액+세액)」 — 견적서 위에 크게 적히는 숫자 */
  total: number;
}

/**
 * VAT 포함 견적은 표의 합이 곧 총액이고 그 안에 세액이 들어 있다.
 * VAT 별도 견적은 표의 합이 공급가액이고 10% 를 더한 값이 총액이다.
 * 예시 시트는 포함 기준이라 합계 8,200,000 이 그대로 「일금 팔백이십만원정」 이었다.
 */
export function quoteTotals(q: Pick<FinQuoteDoc, "lines" | "vatMode">): QuoteTotals {
  const sum = q.lines.reduce((a, l) => a + quoteLineAmount(l), 0);
  const qty = q.lines.reduce((a, l) => a + (Number(l.qty) || 0), 0);
  if (q.vatMode === "included") {
    const supply = Math.round(sum / (1 + VAT_RATE));
    return { sum, qty, supply, vat: sum - supply, total: sum };
  }
  const vat = Math.round(sum * VAT_RATE);
  return { sum, qty, supply: sum, vat, total: sum + vat };
}

/**
 * 금액을 한글 숫자로 — 8,200,000 → 「팔백이십만」. 엑셀 [DBNum4] 서식과
 * 같은 꼴이다. 「일금 ○○원정」 자리에 들어간다. 1,200,000 은 「일백이십만」
 * 으로, 자리마다 「일」을 살린다 — 계약서에 「일금일천이백만원정」 이라
 * 적는 관행과 같고, 숫자를 고쳐 쓰기 어렵게 하려는 뜻이다.
 */
export function koreanNumber(n: number): string {
  const v = Math.abs(Math.round(n));
  if (v === 0) return "영";
  const DIGIT = ["", "일", "이", "삼", "사", "오", "육", "칠", "팔", "구"];
  const SMALL = ["", "십", "백", "천"];
  const BIG = ["", "만", "억", "조", "경"];
  const groups: number[] = [];
  let rest = v;
  while (rest > 0) {
    groups.push(rest % 10000);
    rest = Math.floor(rest / 10000);
  }
  return groups
    .map((g, i) => {
      if (g === 0) return "";
      let s = "";
      const digits = String(g).padStart(4, "0").split("").map(Number);
      digits.forEach((d, j) => {
        if (d === 0) return;
        s += DIGIT[d] + SMALL[3 - j];
      });
      return s + BIG[i];
    })
    .reverse()
    .join("");
}

export const formatQuoteNo = (no: string) => (no.trim() ? `제 ${no.trim()}호` : "");

/** 「2026년08월14일」 — 예시 시트의 날짜 표기 */
export function koreanDate(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  return m ? `${m[1]}년${m[2]}월${m[3]}일` : ymd;
}

/** 견적서 파일명 — 「26-218_FNC_견적서」 */
export function quoteFileStem(q: Pick<FinQuoteDoc, "quoteNo" | "recipient">): string {
  const safe = (s: string) => s.replace(/[\\/:*?"<>|]+/g, "_").trim();
  return [safe(q.quoteNo), safe(q.recipient), "견적서"].filter(Boolean).join("_");
}

// ---- 정렬 ---------------------------------------------------------

/** 프로젝트 안에서는 최근 것이 위 */
export function docsOfProject(docs: FinDoc[], projectId: string, kind?: FinDocKind): FinDoc[] {
  return docs
    .filter((d) => d.projectId === projectId && (!kind || d.kind === kind))
    .sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt));
}

// ---- 정규화 (서버 저장 직전) ---------------------------------------

const str = (v: unknown): string | undefined => {
  const s = String(v ?? "").trim();
  return s ? s : undefined;
};
const num = (v: unknown): number | undefined => {
  if (v === "" || v === null || v === undefined) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};
const compact = <T extends Record<string, unknown>>(o: T): T => {
  const out: Record<string, unknown> = {};
  Object.keys(o).forEach((k) => {
    if (o[k] !== undefined) out[k] = o[k];
  });
  return out as T;
};
const date = (v: unknown): string | null | undefined => {
  const s = str(v);
  if (s === undefined) return undefined;
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
};
const oneOf = <T extends string>(list: readonly T[], v: unknown, fallback: T): T =>
  (list as readonly string[]).includes(String(v)) ? (v as T) : fallback;

function sanitizeSupplier(raw: unknown): FinSupplier {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<FinSupplier>;
  const pick = (k: keyof FinSupplier) => str(r[k]) ?? "";
  return {
    bizNo: pick("bizNo"),
    name: pick("name"),
    ceo: pick("ceo"),
    address: pick("address"),
    bizType: pick("bizType"),
    bizItem: pick("bizItem"),
    contact: pick("contact"),
    phone: pick("phone"),
  };
}

function sanitizeQuoteLine(raw: Partial<FinQuoteLine>): FinQuoteLine {
  return compact({
    id: str(raw.id) ?? shortId(),
    name: String(raw.name ?? "").trim(),
    spec: str(raw.spec),
    qty: num(raw.qty) ?? 0,
    unitPrice: Math.round(num(raw.unitPrice) ?? 0),
    note: str(raw.note),
  }) as FinQuoteLine;
}

export type SanitizeResult<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * 저장 직전 정리. 견적서는 품명이 있는 줄만 남긴다 — 「줄 추가」 만 누른
 * 빈 줄이 견적서에 찍혀 나가면 안 된다. 제목·수신은 비어 있어도 저장은
 * 되게 둔다 (초안 단계에서는 모르는 게 많다). 대신 PDF 를 뽑을 때 알린다.
 */
export function sanitizeFinDoc(raw: Partial<FinDocInput> & { kind?: unknown }): SanitizeResult<FinDocInput> {
  const projectId = str(raw.projectId);
  if (!projectId) return { ok: false, error: "프로젝트가 없습니다." };
  const title = String(raw.title ?? "").trim();
  const note = str(raw.note);

  if (raw.kind === "quote") {
    const r = raw as Partial<FinQuoteInput>;
    const d = date(r.date);
    if (d === null) return { ok: false, error: "견적일은 YYYY-MM-DD 형식이어야 합니다." };
    const lines = (Array.isArray(r.lines) ? r.lines : []).map(sanitizeQuoteLine).filter((l) => l.name);
    return {
      ok: true,
      value: compact({
        projectId,
        kind: "quote" as const,
        title,
        note,
        quoteNo: String(r.quoteNo ?? "").trim(),
        date: d ?? today(),
        recipient: String(r.recipient ?? "").trim(),
        supplier: sanitizeSupplier(r.supplier),
        delivery: str(r.delivery),
        payment: str(r.payment),
        validity: str(r.validity),
        vatMode: oneOf(["included", "excluded"] as const, r.vatMode, "included"),
        lines,
        status: oneOf(QUOTE_STATUSES, r.status, "draft"),
      }),
    };
  }

  if (raw.kind === "contract") {
    const r = raw as Partial<FinContractInput>;
    const startDate = date(r.startDate);
    const endDate = date(r.endDate);
    const signedDate = date(r.signedDate);
    if (startDate === null || endDate === null || signedDate === null) {
      return { ok: false, error: "날짜는 YYYY-MM-DD 형식이어야 합니다." };
    }
    if (startDate && endDate && startDate > endDate) {
      return { ok: false, error: "종료일이 시작일보다 앞설 수 없습니다." };
    }
    if (!title) return { ok: false, error: "계약명이 필요합니다." };
    return {
      ok: true,
      value: compact({
        projectId,
        kind: "contract" as const,
        title,
        note,
        counterparty: String(r.counterparty ?? "").trim(),
        amount: Math.round(num(r.amount) ?? 0),
        vatMode: oneOf(VAT_MODES, r.vatMode, "included"),
        startDate,
        endDate,
        signedDate,
        status: oneOf(CONTRACT_STATUSES, r.status, "draft"),
      }),
    };
  }

  return { ok: false, error: "문서 종류를 알 수 없습니다." };
}

/** 파일 목록 정리 — 경로 없는 항목은 버린다 */
export function sanitizeFiles(raw: unknown): FinDocFile[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((f) => {
      const r = (f ?? {}) as Partial<FinDocFile>;
      const path = str(r.path);
      if (!path) return null;
      return {
        path,
        name: str(r.name) ?? path.slice(path.lastIndexOf("/") + 1),
        size: num(r.size) ?? 0,
        type: str(r.type) ?? "",
        uploadedAt: num(r.uploadedAt) ?? 0,
      };
    })
    .filter((f): f is FinDocFile => f !== null);
}

/** 파일 크기 표시 — 목록에서 "이게 스캔본인지 초안인지" 가늠하는 데 쓴다 */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}
