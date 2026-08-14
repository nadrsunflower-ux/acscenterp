import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  orderBy,
  writeBatch,
  getDocs,
} from "firebase/firestore";
import { getNeanderDb, NEANDER_COL } from "@/lib/neander/firebase";
import { clean, cleanForUpdate } from "@/lib/neander/db/helpers";
import type {
  FinTransaction,
  FinTransactionInput,
  FinImportBatch,
} from "./types";
import {
  FIN_ACCOUNTS,
  FIN_PAYMENT_METHODS,
  FIN_VENDOR_RULES,
  type FinAccountMaster,
  type FinPaymentMethodMaster,
  type FinVendorRuleMaster,
} from "./master-data";

// Firestore writeBatch 의 1회 상한. 임포트는 수백 건이라 반드시 쪼개야 한다.
const BATCH_LIMIT = 450;

const colOf = (name: string) => collection(getNeanderDb(), name);
const refOf = (name: string, id: string) => doc(getNeanderDb(), name, id);

// ---- 거래 --------------------------------------------------

/** 거래 전체 구독. 필터·집계는 클라이언트에서 처리한다 (연 단위 수천 건 규모). */
export function subscribeFinTransactions(
  cb: (rows: FinTransaction[]) => void,
  onError?: (e: unknown) => void,
) {
  const q = query(colOf(NEANDER_COL.finTransactions), orderBy("date", "desc"));
  return onSnapshot(
    q,
    (snap) => {
      cb(
        snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<FinTransaction, "id">) })),
      );
    },
    // 오류를 삼키면 "권한 없음"이 "데이터 없음"처럼 보인다 — 반드시 올려보낸다.
    (e) => onError?.(e),
  );
}

export async function addFinTransaction(input: FinTransactionInput) {
  await addDoc(
    colOf(NEANDER_COL.finTransactions),
    clean({ ...input, createdAt: Date.now() }),
  );
}

export async function updateFinTransaction(
  id: string,
  patch: Partial<FinTransactionInput>,
) {
  await updateDoc(
    refOf(NEANDER_COL.finTransactions, id),
    cleanForUpdate({ ...patch, updatedAt: Date.now() }),
  );
}

export async function deleteFinTransaction(id: string) {
  await deleteDoc(refOf(NEANDER_COL.finTransactions, id));
}

/**
 * 거래 다건 일괄 적재 (임포트용).
 * 450건씩 끊어서 커밋하고, 진행률을 콜백으로 알린다.
 */
export async function addFinTransactionsBulk(
  rows: FinTransactionInput[],
  onProgress?: (done: number, total: number) => void,
) {
  const db = getNeanderDb();
  const now = Date.now();
  for (let i = 0; i < rows.length; i += BATCH_LIMIT) {
    const chunk = rows.slice(i, i + BATCH_LIMIT);
    const batch = writeBatch(db);
    chunk.forEach((r) => {
      batch.set(doc(colOf(NEANDER_COL.finTransactions)), clean({ ...r, createdAt: now }));
    });
    await batch.commit();
    onProgress?.(Math.min(i + chunk.length, rows.length), rows.length);
  }
}

/** 거래 다건 일괄 상태 변경 (검토 대기함의 일괄 승인) */
export async function bulkUpdateFinTransactions(
  ids: string[],
  patch: Partial<FinTransactionInput>,
) {
  const db = getNeanderDb();
  const now = Date.now();
  for (let i = 0; i < ids.length; i += BATCH_LIMIT) {
    const batch = writeBatch(db);
    ids.slice(i, i + BATCH_LIMIT).forEach((id) => {
      batch.update(
        refOf(NEANDER_COL.finTransactions, id),
        cleanForUpdate({ ...patch, updatedAt: now }),
      );
    });
    await batch.commit();
  }
}

/**
 * 특정 임포트 배치로 들어온 거래를 전부 되돌린다.
 * 잘못 올렸을 때 손으로 지우지 않아도 되게 하는 안전장치.
 */
export async function deleteFinTransactionsByBatch(batchId: string) {
  const snap = await getDocs(colOf(NEANDER_COL.finTransactions));
  const ids = snap.docs
    .filter((d) => (d.data() as FinTransaction).importBatchId === batchId)
    .map((d) => d.id);
  const db = getNeanderDb();
  for (let i = 0; i < ids.length; i += BATCH_LIMIT) {
    const batch = writeBatch(db);
    ids.slice(i, i + BATCH_LIMIT).forEach((id) =>
      batch.delete(refOf(NEANDER_COL.finTransactions, id)),
    );
    await batch.commit();
  }
  return ids.length;
}

// ---- 임포트 이력 --------------------------------------------

export function subscribeFinImports(
  cb: (rows: FinImportBatch[]) => void,
  onError?: (e: unknown) => void,
) {
  const q = query(colOf(NEANDER_COL.finImports), orderBy("createdAt", "desc"));
  return onSnapshot(
    q,
    (snap) => {
      cb(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<FinImportBatch, "id">) })));
    },
    (e) => onError?.(e),
  );
}

export async function addFinImport(input: Omit<FinImportBatch, "id" | "createdAt">) {
  const ref = await addDoc(
    colOf(NEANDER_COL.finImports),
    clean({ ...input, createdAt: Date.now() }),
  );
  return ref.id;
}

export async function deleteFinImport(id: string) {
  await deleteDoc(refOf(NEANDER_COL.finImports, id));
}

// ---- 마스터 (계정 · 계좌카드 · 규칙) ------------------------

export interface FinAccountDoc extends FinAccountMaster {
  id: string;
}
export interface FinPaymentMethodDoc extends FinPaymentMethodMaster {
  id: string;
}
export interface FinVendorRuleDoc extends FinVendorRuleMaster {
  id: string;
  /** 이 키워드에 매칭되면 붙일 계정 조회키 (선택) */
  lookupKey?: string;
}

export function subscribeFinAccounts(
  cb: (rows: FinAccountDoc[]) => void,
  onError?: (e: unknown) => void,
) {
  return onSnapshot(
    colOf(NEANDER_COL.finAccounts),
    (snap) => {
      cb(snap.docs.map((d) => ({ id: d.id, ...(d.data() as FinAccountMaster) })));
    },
    (e) => onError?.(e),
  );
}

export function subscribeFinPaymentMethods(
  cb: (rows: FinPaymentMethodDoc[]) => void,
  onError?: (e: unknown) => void,
) {
  return onSnapshot(
    colOf(NEANDER_COL.finPaymentMethods),
    (snap) => {
      cb(snap.docs.map((d) => ({ id: d.id, ...(d.data() as FinPaymentMethodMaster) })));
    },
    (e) => onError?.(e),
  );
}

export function subscribeFinVendorRules(
  cb: (rows: FinVendorRuleDoc[]) => void,
  onError?: (e: unknown) => void,
) {
  return onSnapshot(
    colOf(NEANDER_COL.finVendorRules),
    (snap) => {
      cb(
        snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as FinVendorRuleMaster & { lookupKey?: string }),
        })),
      );
    },
    (e) => onError?.(e),
  );
}

/** 문서 id 로 쓸 수 있게 정리 (Firestore id 는 `/` 를 못 쓴다) */
const safeId = (s: string) => s.replace(/\//g, "／").slice(0, 400);

/**
 * 마스터 초기 적재. 결정적 문서 id 를 쓰므로 여러 번 눌러도
 * 중복 누적되지 않고 덮어쓴다 (매장 seedInitialData 와 같은 방식).
 */
export async function seedFinanceMaster(
  onProgress?: (label: string, done: number, total: number) => void,
) {
  const db = getNeanderDb();

  const writeAll = async <T>(
    colName: string,
    rows: readonly T[],
    idOf: (r: T) => string,
    label: string,
  ) => {
    for (let i = 0; i < rows.length; i += BATCH_LIMIT) {
      const chunk = rows.slice(i, i + BATCH_LIMIT);
      const batch = writeBatch(db);
      chunk.forEach((r) =>
        batch.set(refOf(colName, safeId(idOf(r))), clean(r as Record<string, unknown>)),
      );
      await batch.commit();
      onProgress?.(label, Math.min(i + chunk.length, rows.length), rows.length);
    }
  };

  await writeAll(NEANDER_COL.finAccounts, FIN_ACCOUNTS, (a) => a.lookupKey, "계정");
  await writeAll(
    NEANDER_COL.finPaymentMethods,
    FIN_PAYMENT_METHODS,
    (p) => p.last4,
    "계좌·카드",
  );
  await writeAll(
    NEANDER_COL.finVendorRules,
    FIN_VENDOR_RULES,
    (v) => v.keyword,
    "자동분류 규칙",
  );

  return {
    accounts: FIN_ACCOUNTS.length,
    paymentMethods: FIN_PAYMENT_METHODS.length,
    vendorRules: FIN_VENDOR_RULES.length,
  };
}

export async function upsertFinVendorRule(
  keyword: string,
  data: Omit<FinVendorRuleDoc, "id">,
) {
  await writeBatch(getNeanderDb())
    .set(refOf(NEANDER_COL.finVendorRules, safeId(keyword)), clean(data))
    .commit();
}

export async function deleteFinVendorRule(id: string) {
  await deleteDoc(refOf(NEANDER_COL.finVendorRules, id));
}
