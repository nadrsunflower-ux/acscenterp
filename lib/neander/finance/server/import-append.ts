import "server-only";

import { createHash } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import { NEANDER_COL } from "@/lib/neander/collections";
import type { FinPaymentMethodDoc } from "../db-types";
import { buildFinSlots } from "../import-slots";
import {
  IMPORT_APPEND_CHUNK_ROWS,
  MAX_IMPORT_APPEND_ROWS,
  type ImportAppendInput,
  type ImportAppendResult,
} from "../import-append";
import { netAmount, TX_TYPES, type FinTransactionInput } from "../types";

export class ImportAppendError extends Error {
  constructor(message: string, readonly status = 400, readonly partial?: ImportAppendResult) { super(message); }
}

const assert: (condition: unknown, message: string, status?: number) => asserts condition = (condition, message, status = 400) => {
  if (!condition) throw new ImportAppendError(message, status);
};
const hashOf = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const clean = (value: Record<string, unknown>) => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
const validDate = (value: unknown): value is string => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
};
const requiredText = (value: unknown, label: string, max: number) => {
  assert(typeof value === "string" && value.trim() && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value), `${label}을 확인하세요.`);
  return value;
};

/** 입력 거래에는 새 원본 필드만 받는다. 기존 거래 id·연결·나누기 꼬리표는 만들지 않는다. */
function parseInput(raw: ImportAppendInput): ImportAppendInput {
  assert(raw && typeof raw === "object", "추가할 파일 정보가 없습니다.");
  const fileName = requiredText(raw.fileName, "파일 이름", 240);
  const fileHash = requiredText(raw.fileHash, "파일 확인값", 64).toLowerCase();
  assert(/^[a-f0-9]{64}$/.test(fileHash), "파일 확인값을 확인하세요.");
  assert(typeof raw.month === "string" && validDate(`${raw.month}-01`), "적재할 달을 확인하세요.");
  const month = raw.month;
  const slotKey = requiredText(raw.slotKey, "계좌·카드 칸", 100);
  const adapterId = requiredText(raw.adapterId, "파일 양식", 100);
  assert(validDate(raw.from) && validDate(raw.to) && raw.from <= raw.to && raw.from.slice(0, 7) === month && raw.to.slice(0, 7) === month,
    "파일의 기간과 선택한 달이 다릅니다.");
  assert(Array.isArray(raw.last4s) && raw.last4s.length > 0 && raw.last4s.length <= 100 && raw.last4s.every((value) => typeof value === "string" && /^\d{4}$/.test(value)),
    "파일의 계좌·카드 번호를 확인하세요.");
  assert(Array.isArray(raw.rows) && raw.rows.length > 0 && raw.rows.length <= MAX_IMPORT_APPEND_ROWS,
    `한 파일에서 1~${MAX_IMPORT_APPEND_ROWS.toLocaleString("ko-KR")}건을 추가할 수 있습니다.`);
  const stringFields = ["datetime", "bizMajor", "bizMinor", "acctMajor", "acctMid", "acctMinor", "vendor", "acctNote", "projectCode", "site", "note", "vendorKind", "classReason", "engineSig", "engineCell", "refundMatchId"] as const;
  const rows = raw.rows.map((row, index) => {
    assert(row && typeof row === "object", `${index + 1}행의 거래가 올바르지 않습니다.`);
    assert(validDate(row.date) && row.date.slice(0, 7) === month && row.date >= raw.from && row.date <= raw.to,
      `${index + 1}행의 거래일이 선택한 달·파일 기간과 다릅니다.`);
    assert(typeof row.last4 === "string" && /^\d{4}$/.test(row.last4), `${index + 1}행의 계좌·카드 번호를 확인하세요.`);
    assert((TX_TYPES as readonly string[]).includes(row.txType), `${index + 1}행의 거래유형을 확인하세요.`);
    assert(["confirmed", "suggested", "needs_review"].includes(row.status), `${index + 1}행의 검토 상태를 확인하세요.`);
    assert(Number.isFinite(row.gross) && Number.isFinite(row.adjust) && Math.abs(row.gross) <= Number.MAX_SAFE_INTEGER && Math.abs(row.adjust) <= Number.MAX_SAFE_INTEGER,
      `${index + 1}행의 금액을 확인하세요.`);
    // 이 키는 은행·카드 원본의 값이다. 자동분류 뒤의 유형·금액으로 다시 만들지 않는다.
    assert(typeof row.dedupHash === "string" && row.dedupHash.trim() && Buffer.byteLength(row.dedupHash, "utf8") <= 1_500 && !/(?:#split\d+)+$/.test(row.dedupHash),
      `${index + 1}행의 원본 중복 확인값을 확인하세요.`);
    assert(row.personalUse === undefined || typeof row.personalUse === "boolean", `${index + 1}행의 개인사용 표시를 확인하세요.`);
    assert(row.balanceAfter === undefined || Number.isFinite(row.balanceAfter), `${index + 1}행의 거래 후 잔액을 확인하세요.`);
    const data: Record<string, unknown> = { date: row.date, last4: row.last4, txType: row.txType, gross: row.gross, adjust: row.adjust,
      status: row.status, dedupHash: row.dedupHash, personalUse: row.personalUse, balanceAfter: row.balanceAfter };
    stringFields.forEach((field) => {
      const value = row[field];
      assert(value === undefined || (typeof value === "string" && value.length <= (field === "note" ? 32_000 : 4_000)), `${index + 1}행의 ${field} 값을 확인하세요.`);
      if (value !== undefined) data[field] = value;
    });
    return clean(data) as unknown as FinTransactionInput;
  });
  return { fileName, fileHash, month, slotKey, adapterId, from: raw.from, to: raw.to, last4s: [...new Set(raw.last4s)], rows };
}

const emptyResult = (id: string): ImportAppendResult => ({ id, inserted: 0, skipped: 0, income: 0, expense: 0, confirmed: 0, suggested: 0, needsReview: 0 });
function countAdded(result: ImportAppendResult, row: FinTransactionInput) {
  result.inserted++;
  const amount = netAmount(row);
  if (row.txType === "수입") result.income += amount;
  else if (row.txType === "지출") result.expense += amount;
  else if (row.txType === "환급") result.expense -= amount;
  if (row.status === "confirmed") result.confirmed++;
  else if (row.status === "suggested") result.suggested++;
  else result.needsReview++;
}

/**
 * 기존 거래는 읽기만 한다. 청크마다 신규 거래·파일 이력·중복 잠금을 함께 쓴다.
 * 같은 날 동일 결제가 여러 번 있어도 전체 파일의 발생 순번으로 정확히 센다.
 */
export async function appendFinanceImport(db: Firestore, by: string, raw: ImportAppendInput): Promise<ImportAppendResult> {
  const input = parseInput(raw);
  const batchId = `append-${hashOf([input.fileHash, input.month, input.slotKey])}`;
  const sourceSignature = hashOf(input.rows.map((row) => [row.dedupHash, row.date, row.last4, row.gross, row.adjust]));
  const batchRef = db.collection(NEANDER_COL.finImports).doc(batchId);
  // 전역 중복 키이므로 계좌·달이 다른 동시 요청도 같은 잠금을 사용한다.
  const lockRef = db.collection(NEANDER_COL.finSettings).doc("import-append-dedup-v1");
  const transactionCol = db.collection(NEANDER_COL.finTransactions);
  const seen = new Map<string, number>();
  const numbered = input.rows.map((row) => {
    const occurrence = (seen.get(row.dedupHash) ?? 0) + 1;
    seen.set(row.dedupHash, occurrence);
    return { row, occurrence };
  });
  const result = emptyResult(batchId);

  for (let offset = 0; offset < numbered.length; offset += IMPORT_APPEND_CHUNK_ROWS) {
    const chunk = numbered.slice(offset, offset + IMPORT_APPEND_CHUNK_ROWS);
    try {
      const added = await db.runTransaction(async (tx) => {
        await tx.get(lockRef);
        const hashes = [...new Set(chunk.map(({ row }) => row.dedupHash))];
        const hashQueries = [];
        for (let index = 0; index < hashes.length; index += 30) {
          hashQueries.push(transactionCol.where("dedupHash", "in", hashes.slice(index, index + 30)).select("dedupHash", "splitGroup"));
        }
        const [batchDoc, methods, imports, splits, ...matches] = await Promise.all([
          tx.get(batchRef), tx.get(db.collection(NEANDER_COL.finPaymentMethods)),
          tx.get(db.collection(NEANDER_COL.finImports).where("slotKey", "==", input.slotKey)),
          tx.get(transactionCol.where("splitNo", ">=", 1).select("dedupHash", "splitGroup")),
          ...hashQueries.map((query) => tx.get(query)),
        ]);
        const slot = buildFinSlots(methods.docs.map((doc) => ({ ...doc.data(), id: doc.id }) as FinPaymentMethodDoc)).find((candidate) => candidate.key === input.slotKey);
        assert(slot && slot.bank.adapterId === input.adapterId, "선택한 계좌·카드 칸과 파일 양식이 다릅니다.");
        assert(!slot.from || slot.from <= input.month, "계좌를 열기 전 달에는 적재할 수 없습니다.");
        assert(input.last4s.every((last4) => slot.last4s.includes(last4)) && input.rows.every((row) => slot.last4s.includes(row.last4!)),
          "파일의 계좌·카드 번호가 선택한 칸과 다릅니다.");
        const previous = batchDoc.exists ? batchDoc.data()! : undefined;
        assert(!previous || previous.sourceSignature === sourceSignature,
          "같은 파일을 이전과 다른 금액·환율로 읽었습니다. 기존 거래는 유지했습니다. 원본 해석을 확인한 뒤 다시 시도하세요.", 409);

        const sources = new Map<string, Set<string>>();
        [...matches.flatMap((snapshot) => snapshot.docs), ...splits.docs].forEach((doc) => {
          const data = doc.data();
          if (typeof data.dedupHash !== "string") return;
          const hash = data.dedupHash.replace(/(?:#split\d+)+$/, "");
          if (!hashes.includes(hash)) return;
          const ids = sources.get(hash) ?? new Set<string>();
          ids.add(typeof data.splitGroup === "string" && data.splitGroup ? data.splitGroup : doc.id);
          sources.set(hash, ids);
        });
        const fresh: FinTransactionInput[] = [];
        const counted = new Map([...sources].map(([hash, ids]) => [hash, ids.size]));
        const current = emptyResult(batchId);
        chunk.forEach(({ row, occurrence }) => {
          if (occurrence <= (counted.get(row.dedupHash) ?? 0)) { current.skipped++; return; }
          fresh.push(row);
          counted.set(row.dedupHash, (counted.get(row.dedupHash) ?? 0) + 1);
          countAdded(current, row);
        });
        const now = Date.now();
        fresh.forEach((row) => tx.create(transactionCol.doc(), clean({ ...row, importBatchId: batchId, createdAt: now })));
        const inserted = (Number(previous?.inserted) || 0) + current.inserted;
        const processedRows = Math.max(Number(previous?.processedRows) || 0, offset + chunk.length);
        tx.set(batchRef, clean({ fileName: input.fileName, fileHash: input.fileHash, month: input.month, slotKey: input.slotKey,
          adapterId: input.adapterId, from: input.from, to: input.to, last4s: input.last4s, mode: "append", sourceSignature,
          sourceRows: input.rows.length, processedRows, complete: offset + chunk.length >= input.rows.length,
          inserted, skipped: Math.max(0, processedRows - inserted), income: (Number(previous?.income) || 0) + current.income,
          expense: (Number(previous?.expense) || 0) + current.expense, createdAt: previous?.createdAt ?? now,
          byEmail: previous?.byEmail ?? by, updatedAt: now, updatedBy: by }));
        // 파일 없는 「거래 없음」 표시만 거둔다. 기존 실제 파일 배치·거래는 그대로 둔다.
        imports.docs.filter((doc) => doc.id !== batchId && doc.data().month === input.month && doc.data().noActivity === true)
          .slice(0, 500 - fresh.length - 2)
          .forEach((doc) => tx.delete(doc.ref));
        tx.set(lockRef, { updatedAt: now, updatedBy: by });
        return current;
      });
      (Object.keys(result) as (keyof ImportAppendResult)[]).forEach((key) => {
        if (key !== "id") result[key] += added[key];
      });
    } catch (error) {
      if (error instanceof ImportAppendError) {
        if (offset > 0) throw new ImportAppendError(`${error.message} 앞서 추가된 ${result.inserted}건은 남아 있습니다. 같은 파일을 다시 올리면 중복 없이 이어집니다.`, error.status, result);
        throw error;
      }
      throw new ImportAppendError(`파일 추가를 끝내지 못했습니다. 기존 거래는 그대로이며 이번 요청에서 추가한 ${result.inserted}건은 남아 있습니다. 같은 파일로 다시 시도하면 중복 없이 이어집니다.`, 503, result);
    }
  }
  return result;
}
