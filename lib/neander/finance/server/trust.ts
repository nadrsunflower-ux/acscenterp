// 믿을 범위 — 서버에서 장부 전체로 다시 재고 저장한다 (finance/trust.ts).
// 화면의 「다시 재기」 · 켜기, 그리고 매일 밤 점검(finance/cron)이 부른다.

import type { Firestore } from "firebase-admin/firestore";
import { NEANDER_COL } from "@/lib/neander/collections";
import { measureTrust, TRUST_DOC_ID, type FinTrustDoc, type TrustMeasure } from "../trust";
import type { FinTransaction } from "../types";
import type { FinAccountDoc, FinPaymentMethodDoc, FinVendorRuleDoc } from "../db-types";

const readAll = async <T>(db: Firestore, col: string) =>
  (await db.collection(col).get()).docs.map((d) => ({ id: d.id, ...d.data() }) as T);

export const trustRef = (db: Firestore) => db.collection(NEANDER_COL.finSettings).doc(TRUST_DOC_ID);

/** 지금 장부로 다시 재서 저장한다. 설정(켜기 · 기준)은 건드리지 않는다 */
export async function remeasureTrust(
  db: Firestore,
  opts: { transactions?: FinTransaction[] } = {},
): Promise<TrustMeasure> {
  const [transactions, accounts, paymentMethods, vendorRules] = await Promise.all([
    opts.transactions ? Promise.resolve(opts.transactions) : readAll<FinTransaction>(db, NEANDER_COL.finTransactions),
    readAll<FinAccountDoc>(db, NEANDER_COL.finAccounts),
    readAll<FinPaymentMethodDoc>(db, NEANDER_COL.finPaymentMethods),
    readAll<FinVendorRuleDoc>(db, NEANDER_COL.finVendorRules),
  ]);
  const measure = measureTrust(transactions, { accounts, paymentMethods, vendorRules });
  await trustRef(db).set({ measure }, { merge: true });
  return measure;
}

export async function readTrust(db: Firestore): Promise<FinTrustDoc | null> {
  const snap = await trustRef(db).get();
  return snap.exists ? ({ id: snap.id, ...snap.data() } as FinTrustDoc) : null;
}
