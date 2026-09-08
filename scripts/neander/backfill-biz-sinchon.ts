// ============================================================
//  사업구분 백필 ④ — 신촌판매 (2025 소급 전용)
// ------------------------------------------------------------
//  backfill-biz-unit.ts 의 규칙 ① 「계정명: 신촌 → B2C·신촌」 은 이미
//  사람이 승인한 규칙 목록에 있다. 그런데 신촌 매장은 사업구분 축이
//  생기기(2026-08) 전에 접었기 때문에 7월 학습 표본이 **영원히 0건**이고,
//  정확도 게이트에 걸려 자동으로는 절대 적용되지 않는다.
//
//  근거는 표본이 아니라 이름이다 — 신촌판매가 신촌 것이 아닐 수는 없다.
//  같은 계열 규칙들은 표본이 있는 곳에서 전부 100% 로 검증됐다:
//    와우판매 → B2C·와우   1,828건 100%
//    아이디판매 → B2C·아이디  646건 100%
//    온라인판매 → B2C·온라인  207건 100%
//
//  그래서 이 스크립트는 신촌판매·신촌운영비 계정의 거래에만 B2C·신촌을
//  채운다. 다른 계정은 건드리지 않는다.
//
//    npx tsx scripts/neander/backfill-biz-sinchon.ts            (미리보기)
//    npx tsx scripts/neander/backfill-biz-sinchon.ts --apply
// ============================================================

import { config } from "dotenv";
config({ path: ".env.local" });

import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { NEANDER_COL } from "@/lib/neander/collections";
import { netAmount, type FinTransaction } from "@/lib/neander/finance/types";

const APPLY = process.argv.includes("--apply");
const fmt = (n: number) => Math.round(n).toLocaleString("ko-KR");

function init() {
  if (getApps().length > 0) return;
  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_B64;
  if (!b64) throw new Error("FIREBASE_SERVICE_ACCOUNT_B64 가 없습니다 (.env.local 확인).");
  const sa = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
  initializeApp({
    credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey: sa.private_key }),
  });
}

(async () => {
  init();
  const db = getFirestore();
  const col = db.collection(NEANDER_COL.finTransactions);
  const snap = await col.get();
  const all = snap.docs.map((d) => ({ id: d.id, ...d.data() })) as FinTransaction[];

  const targets = all.filter(
    (t) => !t.bizMajor && (/신촌판매/.test(t.acctMinor ?? "") || /신촌운영비/.test(t.acctMid ?? "")),
  );
  const byMonth = new Map<string, number>();
  targets.forEach((t) => byMonth.set((t.date ?? "").slice(0, 7), (byMonth.get((t.date ?? "").slice(0, 7)) ?? 0) + 1));

  console.log(`대상 ${targets.length}건 ${fmt(targets.reduce((s, t) => s + netAmount(t), 0))}원 → B2C·신촌`);
  console.log([...byMonth.entries()].sort().map(([m, n]) => `${m}:${n}`).join(" "));

  if (!APPLY) {
    console.log("\n※ 미리보기입니다. 실제로 쓰려면 --apply 를 붙이세요.");
    process.exit(0);
  }

  const now = Date.now();
  for (let i = 0; i < targets.length; i += 400) {
    const b = db.batch();
    targets.slice(i, i + 400).forEach((t) =>
      b.set(
        col.doc(t.id),
        {
          bizMajor: "B2C",
          bizMinor: "신촌",
          updatedAt: now,
          updatedBy: "script:backfill-biz-sinchon",
          classReason: "사업구분 백필 — 계정명: 신촌 (이름이 사업부를 말함, 동계열 규칙 와우·아이디·온라인 100% 검증)",
        },
        { merge: true },
      ),
    );
    await b.commit();
    console.log(`  ${Math.min(i + 400, targets.length)}/${targets.length}`);
  }
  console.log(`\n✅ ${targets.length}건 적용 완료`);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
