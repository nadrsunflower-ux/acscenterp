// ============================================================
//  계좌 백필 — 칸은 찾았는데 계좌 없이 들어간 거래
// ------------------------------------------------------------
//  신한 grid 엑셀은 파일 안에 계좌번호가 없다. 엑셀 임포트가 잔액·거래처로
//  칸을 **추정**해 넣을 때 줄에 그 계좌를 찍지 않고 저장했다 (2026-10-02
//  발견, import-slots.ts 의 withSlotAccount 로 고침). 그 결과:
//
//    · 거래에 last4 가 없다 → 칸이 「적재됨 · 0건」, 수입·지출·검토 수도 0
//    · 중복 키(dedupHash)에 계좌 자리가 비어 있다 → 같은 파일을 고친 화면으로
//      다시 올리면 중복으로 걸러지지 않는다
//    · 사업장(site)이 계좌 마스터 기본값을 못 받았다
//
//  2026-09 신한출금(4223) 56건 · 신한입금(4248) 123건이 그렇게 들어갔다.
//
//  되돌리고 다시 올리면 검토 대기함에서 고친 분류가 지워진다. 그래서 문서를
//  그 자리에서 고친다 — 배치의 칸(slotKey)이 곧 계좌다. **분류·금액·거래처는
//  건드리지 않는다.**
//
//    last4      칸의 계좌
//    dedupHash  비어 있던 계좌 자리만 채운다 (다른 조각은 적재 때 값 그대로)
//    site       비어 있을 때만 계좌 마스터의 사업장
//    updatedAt  지금 — 화면의 증분 동기화가 바로 받아 가게
//
//  기본은 드라이런이다. 실제로 쓰려면 --apply 를 붙인다.
//
//    npm run finance:backfill-slot-account
//    npm run finance:backfill-slot-account -- --apply
// ============================================================

import { config } from "dotenv";
config({ path: ".env.local" });

import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { NEANDER_COL } from "@/lib/neander/collections";
import type { FinPaymentMethodDoc } from "@/lib/neander/finance/db-types";
import type { FinImportBatch, FinTransaction } from "@/lib/neander/finance/types";

const APPLY = process.argv.includes("--apply");
const BATCH = 400;
/** dedupHashOf 의 구분자 (finance/types.ts) */
const SEP = "¦";

function init() {
  if (getApps().length > 0) return;
  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_B64;
  if (!b64) throw new Error("FIREBASE_SERVICE_ACCOUNT_B64 가 없습니다 (.env.local 확인).");
  const sa = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
  initializeApp({
    credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey: sa.private_key }),
  });
}

/**
 * 중복 키의 계좌 자리를 채운다.
 * 키는 `날짜¦계좌¦거래처¦금액¦유형` 이다. 다시 계산하지 않고 **빈 자리만**
 * 채운다 — 유형·거래처는 적재 뒤에 사람이 고쳤을 수 있고, 키는 적재 때 값
 * 그대로여야 같은 파일이 다시 왔을 때 걸린다. 모양이 다르면 손대지 않는다.
 */
function rekey(hash: string | undefined, last4: string): string | null {
  if (!hash) return null;
  const parts = hash.split(SEP);
  if (parts.length !== 5 || parts[1] !== "") return null;
  parts[1] = last4.trim().toLowerCase();
  return parts.join(SEP);
}

(async () => {
  init();
  const db = getFirestore();

  const [impSnap, pmSnap] = await Promise.all([
    db.collection(NEANDER_COL.finImports).get(),
    db.collection(NEANDER_COL.finPaymentMethods).get(),
  ]);
  const pmByLast4 = new Map(
    pmSnap.docs.map((d) => {
      const pm = { id: d.id, ...d.data() } as FinPaymentMethodDoc;
      return [pm.last4, pm] as const;
    }),
  );
  const batches = impSnap.docs
    .map((d) => ({ id: d.id, ...d.data() }) as FinImportBatch)
    .filter((b) => b.slotKey?.startsWith("account:") && !b.noActivity)
    .sort((a, b) => (a.month ?? "").localeCompare(b.month ?? "") || (a.slotKey ?? "").localeCompare(b.slotKey ?? ""));

  console.log(`계좌 칸 배치 ${batches.length}개를 봅니다 ${APPLY ? "(쓰기)" : "(드라이런)"}\n`);

  const now = Date.now();
  let total = 0;
  let keyKept = 0;
  let siteFilled = 0;
  const writes: { id: string; patch: Record<string, string | number> }[] = [];

  for (const b of batches) {
    const last4 = b.slotKey!.slice("account:".length);
    const pm = pmByLast4.get(last4);
    const snap = await db.collection(NEANDER_COL.finTransactions).where("importBatchId", "==", b.id).get();
    const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as FinTransaction);
    const missing = rows.filter((t) => !t.last4);
    if (missing.length === 0) continue;

    let kept = 0;
    let sites = 0;
    missing.forEach((t) => {
      const patch: Record<string, string | number> = { last4, updatedAt: now };
      const next = rekey(t.dedupHash, last4);
      if (next) patch.dedupHash = next;
      else kept += 1;
      if (!t.site && pm?.site) {
        patch.site = pm.site;
        sites += 1;
      }
      writes.push({ id: t.id, patch });
    });
    total += missing.length;
    keyKept += kept;
    siteFilled += sites;

    const reviewed = missing.filter((t) => t.status === "confirmed").length;
    console.log(
      `${b.month}  ${(pm?.alias ?? "?").padEnd(8)} ···${last4}  ${b.fileName}\n` +
        `    계좌 없는 거래 ${missing.length}/${rows.length}건 · 그중 확정 ${reviewed}건 (분류는 그대로 둡니다)\n` +
        `    사업장 채움 ${sites}건${pm ? ` → ${pm.site}` : " (마스터에 이 계좌가 없습니다)"} · 중복 키 유지 ${kept}건`,
    );
  }

  console.log(`\n합계: ${total}건에 계좌를 채웁니다 · 사업장 ${siteFilled}건 · 중복 키를 못 바꾼 것 ${keyKept}건`);
  if (total === 0) {
    console.log("고칠 거래가 없습니다.");
    return;
  }
  if (!APPLY) {
    console.log("\n드라이런입니다. 실제로 쓰려면 --apply 를 붙이세요.");
    return;
  }

  for (let i = 0; i < writes.length; i += BATCH) {
    const wb = db.batch();
    writes.slice(i, i + BATCH).forEach((w) => wb.update(db.collection(NEANDER_COL.finTransactions).doc(w.id), w.patch));
    await wb.commit();
  }

  // 쓴 뒤 다시 읽어 확인한다
  let left = 0;
  for (const b of batches) {
    const snap = await db.collection(NEANDER_COL.finTransactions).where("importBatchId", "==", b.id).get();
    left += snap.docs.filter((d) => !d.data().last4).length;
  }
  console.log(`\n${writes.length}건을 고쳤습니다. 다시 읽어 보니 계좌 없는 거래 ${left}건.`);
  if (left > 0) process.exit(1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
