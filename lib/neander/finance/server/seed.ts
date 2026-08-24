// ============================================================
//  마스터 적재 — 화면(API 라우트)과 스크립트가 함께 쓴다
// ------------------------------------------------------------
//  같은 일을 두 곳에 적어 두면 반드시 갈라진다. 적재 규칙은 여기 하나뿐이고
//  API 라우트(mutate)와 CLI 스크립트(seed-finance-master)가 이 함수를 부른다.
//
//  적재 성격이 항목마다 다르다:
//   - 계정·계좌·거래처규칙·구독 : 엑셀이 정본이므로 **덮어쓴다** (결정적 문서 id)
//   - 배분 규칙                : 켜고 끈 상태가 **사람의 판단**이므로 이미 있으면
//                               건드리지 않고, 없는 것만 비활성으로 새로 넣는다
// ============================================================

import {
  FIN_ACCOUNTS,
  FIN_ALLOCATIONS,
  FIN_PAYMENT_METHODS,
  FIN_SUBSCRIPTIONS,
  FIN_VENDOR_RULES,
} from "../master-data";
import { NEANDER_COL } from "../../collections";

/** Firestore writeBatch 1회 상한(500)보다 넉넉히 아래로 */
const BATCH_LIMIT = 450;

/** Firestore 는 undefined 를 거부한다 */
function clean(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  Object.keys(obj).forEach((k) => {
    if (obj[k] !== undefined) out[k] = obj[k];
  });
  return out;
}

/** Firestore 문서 id 제약: `/` 불가, `__...__` 예약 */
export function safeId(s: string): string {
  const t = s.replace(/\//g, "／").slice(0, 400);
  return /^__.*__$/.test(t) ? `_${t}` : t;
}

export interface SeedResult {
  accounts: number;
  paymentMethods: number;
  vendorRules: number;
  subscriptions: number;
  /** 새로 추가된 배분 규칙 수 (기존 규칙은 건드리지 않는다) */
  allocations: number;
}

type Db = FirebaseFirestore.Firestore;

export async function seedFinanceMasterData(db: Db): Promise<SeedResult> {
  const writeAll = async <T>(col: string, rows: readonly T[], idOf: (r: T) => string) => {
    for (let i = 0; i < rows.length; i += BATCH_LIMIT) {
      const batch = db.batch();
      rows.slice(i, i + BATCH_LIMIT).forEach((r) => {
        batch.set(db.collection(col).doc(safeId(idOf(r))), clean(r as Record<string, unknown>));
      });
      await batch.commit();
    }
  };

  await writeAll(NEANDER_COL.finAccounts, FIN_ACCOUNTS, (a) => a.lookupKey);
  await writeAll(NEANDER_COL.finPaymentMethods, FIN_PAYMENT_METHODS, (p) => p.last4);
  await writeAll(NEANDER_COL.finVendorRules, FIN_VENDOR_RULES, (v) => v.keyword);
  await writeAll(NEANDER_COL.finSubscriptions, FIN_SUBSCRIPTIONS, (v) => v.service);

  let allocations = 0;
  for (const rule of FIN_ALLOCATIONS) {
    const ref = db.collection(NEANDER_COL.finAllocations).doc(safeId(rule.name));
    if ((await ref.get()).exists) continue;
    await ref.set(clean(rule as unknown as Record<string, unknown>));
    allocations += 1;
  }

  return {
    accounts: FIN_ACCOUNTS.length,
    paymentMethods: FIN_PAYMENT_METHODS.length,
    vendorRules: FIN_VENDOR_RULES.length,
    subscriptions: FIN_SUBSCRIPTIONS.length,
    allocations,
  };
}
