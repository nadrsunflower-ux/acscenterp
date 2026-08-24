// ============================================================
//  재무 마스터 적재 (CLI)
// ------------------------------------------------------------
//  화면의 마스터 › 「엑셀 기준으로 다시 적재」와 **같은 함수**를 부른다
//  (lib/neander/finance/server/seed.ts). 화면에서 눌러도 되지만, 적재 결과를
//  로그로 남기고 싶을 때는 이쪽이 낫다.
//
//    npm run finance:seed-master
// ============================================================

import { config } from "dotenv";
config({ path: ".env.local" });

import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { seedFinanceMasterData } from "@/lib/neander/finance/server/seed";
import { NEANDER_COL } from "@/lib/neander/collections";

function init() {
  if (getApps().length > 0) return;
  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_B64;
  if (!b64) throw new Error("FIREBASE_SERVICE_ACCOUNT_B64 가 없습니다 (.env.local 확인).");
  const sa = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
  initializeApp({
    credential: cert({
      projectId: sa.project_id,
      clientEmail: sa.client_email,
      privateKey: sa.private_key,
    }),
  });
}

(async () => {
  init();
  const db = getFirestore();

  const before = await counts(db);
  console.log("적재 전:", before);

  const r = await seedFinanceMasterData(db);
  console.log("\n적재 결과:");
  console.log(`  계정            ${r.accounts}`);
  console.log(`  계좌·카드        ${r.paymentMethods}`);
  console.log(`  거래처 규칙       ${r.vendorRules}`);
  console.log(`  구독 서비스       ${r.subscriptions}`);
  console.log(`  배분 규칙        +${r.allocations} (기존 규칙의 켜짐 상태는 보존)`);

  const after = await counts(db);
  console.log("\n적재 후:", after);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

async function counts(db: FirebaseFirestore.Firestore) {
  const of = async (col: string) => (await db.collection(col).count().get()).data().count;
  const pm = await db.collection(NEANDER_COL.finPaymentMethods).get();
  return {
    accounts: await of(NEANDER_COL.finAccounts),
    paymentMethods: pm.size,
    kindFilled: pm.docs.filter((d) => d.data().kind).length,
    vendorRules: await of(NEANDER_COL.finVendorRules),
    subscriptions: await of(NEANDER_COL.finSubscriptions),
    allocations: await of(NEANDER_COL.finAllocations),
  };
}
