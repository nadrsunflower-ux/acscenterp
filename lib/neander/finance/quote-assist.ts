import type { FinQuoteLine } from "./docs";

/** 견적 도우미는 초안만 반환한다. 적용과 저장은 편집창에서 따로 한다. */
export type QuoteAssistMode = "items" | "receiver";

export interface QuoteAssistInput {
  mode: QuoteAssistMode;
  projectId: string;
  text?: string;
  file?: File;
}

export interface QuoteItemsAssistResult {
  mode: "items";
  title?: string;
  lines: FinQuoteLine[];
  note?: string;
  warnings?: string[];
}

export interface QuoteReceiverAssistResult {
  mode: "receiver";
  recipient?: string;
  receiver: { ceo?: string; bizNo?: string; address?: string };
}

export type QuoteAssistResult = QuoteItemsAssistResult | QuoteReceiverAssistResult;

export const QUOTE_ASSIST_LIMITS = {
  fileBytes: 4 * 1024 * 1024,
  textChars: 20_000,
  lines: 100,
  qty: 1_000_000,
  amount: 1_000_000_000_000,
} as const;

export const QUOTE_ASSIST_FILE_ACCEPT = ".png,.jpg,.jpeg,.webp,.pdf,.xlsx,.xls,.csv,.docx,.hwpx,.txt,.md";

export class QuoteAssistError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = "QuoteAssistError";
  }
}

interface FileInfo { name: string; size: number; type: string }

export function quoteAssistFileKind(file: Pick<FileInfo, "name" | "type">): "image" | "pdf" | "document" {
  const ext = file.name.toLowerCase().split(".").pop() ?? "";
  const imageTypes: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };
  if (imageTypes[ext] && (!file.type || file.type === "application/octet-stream" || file.type === imageTypes[ext])) return "image";
  if (ext === "pdf" && (!file.type || file.type === "application/octet-stream" || file.type === "application/pdf")) return "pdf";
  if (["xlsx", "xls", "csv", "docx", "hwpx", "txt", "md"].includes(ext) && !file.type.startsWith("image/")) return "document";
  throw new QuoteAssistError("PNG·JPEG·WebP 이미지, PDF, 엑셀, Word(docx), 한글(hwpx), 텍스트 파일을 첨부해 주세요.");
}

/** 클라이언트 안내와 서버 검증에 같은 한도를 사용한다. */
export function validateQuoteAssistInput(raw: { mode: unknown; projectId: unknown; text?: unknown; file?: FileInfo | null }): void {
  if (raw.mode !== "items" && raw.mode !== "receiver") throw new QuoteAssistError("분석 종류를 확인해 주세요.");
  if (typeof raw.projectId !== "string" || !raw.projectId.trim() || raw.projectId.length > 200 || /[\u0000-\u001f/]/.test(raw.projectId) || [".", ".."].includes(raw.projectId.trim())) {
    throw new QuoteAssistError("프로젝트를 확인해 주세요.");
  }
  if (raw.text !== undefined && typeof raw.text !== "string") throw new QuoteAssistError("분석할 내용을 글자로 입력해 주세요.");
  const text = typeof raw.text === "string" ? raw.text : "";
  if (text.length > QUOTE_ASSIST_LIMITS.textChars) throw new QuoteAssistError("분석할 내용은 20,000자 이하로 입력해 주세요.");
  if (!text.trim() && !raw.file) throw new QuoteAssistError("분석할 내용이나 파일을 넣어 주세요.");
  if (raw.file) {
    if (!Number.isFinite(raw.file.size) || raw.file.size <= 0 || raw.file.size > QUOTE_ASSIST_LIMITS.fileBytes) throw new QuoteAssistError("첨부 파일은 비어 있지 않은 4MB 이하 파일이어야 합니다.");
    quoteAssistFileKind(raw.file);
  }
}

const object = (raw: unknown): Record<string, unknown> => raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
const text = (raw: unknown, max: number): string | undefined => typeof raw === "string" ? raw.replace(/\u0000/g, "").trim().slice(0, max) || undefined : undefined;
const boundedNumber = (raw: unknown, max: number): number | undefined => {
  const value = typeof raw === "number" ? raw : typeof raw === "string" && /^\d+(?:\.\d+)?$/.test(raw.trim()) ? Number(raw.trim()) : NaN;
  return Number.isFinite(value) && value >= 0 && value <= max ? value : undefined;
};

/** 외부 모델의 응답은 저장 문서로 캐스팅하지 않고, 허용한 칸만 새로 만든다. */
export function normalizeQuoteAssistResult(mode: QuoteAssistMode, raw: unknown): QuoteAssistResult {
  const value = object(raw);
  if (mode === "receiver") {
    const receiver = object(value.receiver);
    const recipient = text(value.recipient ?? value.name, 300);
    const ceo = text(receiver.ceo ?? value.ceo, 100);
    const rawBizNo = text(receiver.bizNo ?? value.bizNumber, 30);
    const digits = rawBizNo?.replace(/\D/g, "");
    const bizNo = digits?.length === 10 ? `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}` : undefined;
    const address = text(receiver.address ?? value.address, 1000);
    if (!recipient && !ceo && !bizNo && !address) throw new QuoteAssistError("수신자 정보를 읽지 못했습니다. 선명한 사업자등록증이나 해당 내용을 다시 넣어 주세요.", 422);
    return { mode, ...(recipient ? { recipient } : {}), receiver: { ...(ceo ? { ceo } : {}), ...(bizNo ? { bizNo } : {}), ...(address ? { address } : {}) } };
  }

  const candidates = Array.isArray(value.lines) ? value.lines : Array.isArray(value.items) ? value.items : [];
  if (candidates.length > QUOTE_ASSIST_LIMITS.lines) throw new QuoteAssistError("품목이 100개를 넘습니다. 내용을 나누어 분석해 주세요.", 422);
  const warnings = new Set<string>();
  if (Array.isArray(value.warnings)) value.warnings.slice(0, 20).forEach((w) => { const s = text(w, 300); if (s) warnings.add(s); });
  const lines: FinQuoteLine[] = [];
  candidates.forEach((candidate, index) => {
    const line = object(candidate);
    const name = text(line.name, 300);
    if (!name) return;
    const qtyValue = line.qty ?? line.quantity;
    const qty = boundedNumber(qtyValue, QUOTE_ASSIST_LIMITS.qty) ?? 1;
    if (qtyValue !== undefined && boundedNumber(qtyValue, QUOTE_ASSIST_LIMITS.qty) === undefined) warnings.add(`「${name}」의 수량을 읽지 못해 1로 두었습니다.`);
    const stated = line.priceProvided === true;
    const price = boundedNumber(line.unitPrice, QUOTE_ASSIST_LIMITS.amount);
    let unitPrice = stated && price !== undefined ? Math.round(price) : 0;
    if (!stated || price === undefined) warnings.add(`「${name}」의 확인된 단가가 없어 0원으로 두었습니다. 단가를 확인해 주세요.`);
    if (qty * unitPrice > QUOTE_ASSIST_LIMITS.amount) {
      unitPrice = 0;
      warnings.add(`「${name}」의 금액이 허용 범위를 넘어 단가를 0원으로 두었습니다.`);
    }
    const spec = text(line.spec, 1000);
    const note = text(line.note, 1000);
    lines.push({ id: `ai-${Date.now().toString(36)}-${index}-${Math.random().toString(36).slice(2, 8)}`, name, qty, unitPrice, ...(spec ? { spec } : {}), ...(note ? { note } : {}) });
  });
  if (!lines.length) throw new QuoteAssistError("견적 품목을 찾지 못했습니다. 품명·수량·단가가 적힌 내용을 넣어 주세요.", 422);
  const title = text(value.title, 300);
  const note = text(value.note, 5000);
  return { mode, lines, ...(title ? { title } : {}), ...(note ? { note } : {}), ...(warnings.size ? { warnings: [...warnings].slice(0, 100) } : {}) };
}

export function parseQuoteAssistResponse(mode: QuoteAssistMode, content: string): QuoteAssistResult {
  try {
    const raw = JSON.parse(content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
    return normalizeQuoteAssistResult(mode, raw);
  } catch (error) {
    if (error instanceof QuoteAssistError) throw error;
    throw new QuoteAssistError("분석 결과를 읽지 못했습니다. 다시 시도해 주세요.", 502);
  }
}
