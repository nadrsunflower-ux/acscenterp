import "server-only";

// ============================================================
//  장표 실측 — Firestore 원자료를 읽어 actuals.ts 로 넘긴다
// ------------------------------------------------------------
//  재무·매출 API(/finance/data · /sync)를 다시 부르지 않고 같은 컬렉션을
//  Admin SDK 로 직접 읽는다. 원장은 계산에 쓰는 필드만 고른다(select) —
//  거래 1만 건을 통째로 받지 않으려고.
//
//  스모트와 재무는 따로 실패한다. 한쪽을 못 읽으면 그쪽만 비우고 이유를
//  돌려주며, 화면은 그 부분에만 스냅샷을 쓴다.
// ============================================================

import type { Firestore } from "firebase-admin/firestore";
import { NEANDER_COL } from "@/lib/neander/collections";
import { dateStrKST } from "@/lib/neander/format";
import {
  computeFinanceActuals,
  computeSmoatActuals,
  type RawFinProject,
  type RawFinTx,
  type RawSmoatCost,
  type RawSmoatSale,
} from "../actuals";
import type { DeckActualRules, DeckActuals } from "../types";

const TX_FIELDS = [
  "date",
  "txType",
  "acctMajor",
  "acctMid",
  "acctMinor",
  "bizMajor",
  "vendor",
  "gross",
  "adjust",
  "projectCode",
] as const;

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function loadSmoatRaw(db: Firestore) {
  const [salesSnap, costSnap] = await Promise.all([
    db.collection(NEANDER_COL.smoatSales).get(),
    db.collection(NEANDER_COL.smoatCosts).get(),
  ]);
  const sales = salesSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as RawSmoatSale);
  const costs = costSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as RawSmoatCost);
  const lastSync = Math.max(0, ...sales.map((s) => s.syncedAt ?? 0), ...costs.map((c) => c.syncedAt ?? 0));
  return { sales, costs, asOf: lastSync > 0 ? dateStrKST(lastSync) : dateStrKST(Date.now()) };
}

export async function loadFinanceRaw(db: Firestore) {
  const [txSnap, projSnap] = await Promise.all([
    db.collection(NEANDER_COL.finTransactions).select(...TX_FIELDS).get(),
    db.collection(NEANDER_COL.finProjects).get(),
  ]);
  const txs = txSnap.docs.map((d) => d.data() as RawFinTx);
  const projects = projSnap.docs.map((d) => d.data() as RawFinProject).filter((p) => p.code);
  return { txs, projects };
}

export async function loadDeckActuals(
  db: Firestore,
  rules: DeckActualRules,
): Promise<{ actuals: DeckActuals; errors: { smoat?: string; finance?: string } }> {
  const actuals: DeckActuals = {};
  const errors: { smoat?: string; finance?: string } = {};

  await Promise.all([
    loadSmoatRaw(db)
      .then(({ sales, costs, asOf }) => {
        actuals.smoat = computeSmoatActuals(sales, costs, rules.smoat, asOf);
      })
      .catch((e) => {
        errors.smoat = message(e);
      }),
    loadFinanceRaw(db)
      .then(({ txs, projects }) => {
        actuals.finance = computeFinanceActuals(txs, projects, rules.finance);
      })
      .catch((e) => {
        errors.finance = message(e);
      }),
  ]);
  return { actuals, errors };
}
