// ============================================================
//  2608 적재분 — 사람이 판단해 정한 계정 교정
// ------------------------------------------------------------
//  2026-08 장부는 528건 전부 원본에 분류가 있어 그대로 확정 적재됐다.
//  그중 계정 마스터와 어긋나 원장 시트에 경고가 뜨던 2건을 사람이
//  판단해서 정한 값으로 고친다.
//
//    ① r145 주최자예약금반환 100,000
//       장부는 「예약금반환」, 마스터는 「예약금환불」(DP-002). 뜻이 같은
//       표기 차이라 계정을 새로 만들지 않고 **ERP 마스터 이름에 맞춘다.**
//       (같은 뜻의 계정이 둘이 되면 예약금 집계가 갈라진다.)
//
//  거래는 dedupHash 로 찾는다 — 날짜·거래처·금액·유형이 같아야 하므로
//  엉뚱한 행을 고칠 위험이 없다.
//
//    npx tsx scripts/neander/fix-2608-review-rows.ts          # 미리보기
//    npx tsx scripts/neander/fix-2608-review-rows.ts --apply  # 반영
// ============================================================

import { config } from "dotenv";
config({ path: ".env.local" });

import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { NEANDER_COL } from "@/lib/neander/collections";

const APPLY = process.argv.includes("--apply");
const BY = "fix-2608-review-rows";

/** 고칠 거래 — 찾는 조건과 바꿀 값 */
const FIXES = [
  {
    label: "r145 주최자예약금반환",
    match: { date: "2026-08-07", vendor: "주최자예약금반환", gross: 100000 },
    patch: { acctMinor: "예약금환불" },
    why: "장부 「예약금반환」 → 마스터 「예약금환불」(DP-002). 표기 차이라 ERP 기준으로 맞춤.",
  },
  {
    // ② r527 사단법인 기술벤처스 8,800,000
    //    장부는 「환급 + 기타수입>기타잡수입>기타」 였다. 그러면 8,800,000 이
    //    **이익으로 잡힌다.** 실제로는 나중에 그대로 넘겨줘야 하는 돈이라
    //    손익 대상이 아니다 (사람 확인, 2026-09-09).
    //
    //    금액이 8,000,000 + 부가세 800,000 으로 딱 떨어지고, 2026-07 주식회사
    //    들의곰 5,500,000 · 주식회사 너울 14,630,000 과 같은 모양이다.
    //    그 둘이 쓰는 계정이 정산입금(부가세포함)[PA-001] 이다.
    label: "r527 사단법인 기술벤처스",
    match: { date: "2026-08-31", vendor: "사단법인 기술벤처스", gross: 8800000 },
    patch: {
      txType: "자금거래",
      acctMajor: "대행정산",
      acctMid: "정산입금",
      acctMinor: "정산입금(부가세포함)",
      // 자금거래는 손익 축이 없다. 기존 297건 중 296건이 해당없음/해당없음이고
      // 대행정산 4건도 전부 그렇다.
      bizMajor: "해당없음",
      bizMinor: "해당없음",
    },
    why: "환급(이익) → 자금거래(손익 비대상). 나중에 그대로 넘겨줄 돈이라 대행정산 PA-001.",
  },
];

function init() {
  if (getApps().length) return;
  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_B64;
  if (!b64) throw new Error("FIREBASE_SERVICE_ACCOUNT_B64 가 없습니다 (.env.local 확인).");
  const sa = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
  initializeApp({
    credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey: sa.private_key }),
  });
}

async function main() {
  init();
  const db = getFirestore();
  console.log(APPLY ? "반영합니다.\n" : "미리보기입니다 (--apply 를 붙이면 씁니다).\n");

  for (const fix of FIXES) {
    const snap = await db
      .collection(NEANDER_COL.finTransactions)
      .where("date", "==", fix.match.date)
      .where("vendor", "==", fix.match.vendor)
      .where("gross", "==", fix.match.gross)
      .get();

    if (snap.size !== 1) {
      console.log(`❌ ${fix.label} — ${snap.size}건 찾음 (1건이어야 함). 건너뜁니다.`);
      continue;
    }
    const doc = snap.docs[0];
    const cur = doc.data() as any;
    const p = fix.patch as Record<string, string>;
    const show = (o: Record<string, any>) =>
      `[${o.txType}] ${o.acctMajor}>${o.acctMid}>${o.acctMinor} · ${o.bizMajor}/${o.bizMinor}`;
    console.log(`${fix.label}  ${Number(cur.gross).toLocaleString()}원`);
    console.log(`   ${show(cur)}`);
    console.log(` → ${show({ ...cur, ...p })}`);
    console.log(`   ${fix.why}`);
    if (APPLY) {
      await doc.ref.update({ ...fix.patch, updatedAt: Date.now(), updatedBy: BY });
      console.log("   ✅ 반영됨");
    }
    console.log();
  }

  console.log(APPLY ? "완료." : "(미리보기라 아무것도 쓰지 않았습니다.)");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
