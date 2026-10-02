// ============================================================
//  업종 채우기 — 이미 장부에 있는 카드 거래에 업종을 붙인다
// ------------------------------------------------------------
//  업종 근거(classify.ts 3′)는 **확정된 거래에 업종이 붙어 있어야** 배울 수 있다.
//  새로 올리는 명세서는 적재 화면이 그때그때 붙이지만, 그 전에 들어온 거래에는
//  없다. 이 스크립트가 한 번 채운다 (finance/vendor-kind.ts).
//
//  분류는 건드리지 않는다. `vendorKind` 하나만 쓴다. 자동분류가 붙인 채 아무도
//  안 고친 대기 건에는 지문(engineSig)을 같이 남긴다 — 수정 시각이 찍히면
//  「사람이 고친 행」 으로 보여 다시 배우지 못한다 (relearn.ts).
//
//    npm run finance:vendor-kinds                       (몇 건인지만 본다 — 모델을 부르지 않는다)
//    npm run finance:vendor-kinds -- --ask              (모델에게 물어 결과를 본다 · 쓰지 않는다)
//    npm run finance:vendor-kinds -- --ask --apply      (물어서 쓴다)
//    npm run finance:vendor-kinds -- --from <kinds.json> --apply   (전에 받아 둔 답을 쓴다)
//    npm run finance:vendor-kinds -- --undo <output/…/before-….json>
//
//  채운 뒤 대기함의 제안은 검토 대기함을 열면 스스로 다시 붙는다 (계속 배우기).
//  지금 바로 보려면 npm run finance:reclassify-pending.
// ============================================================

import { config } from "dotenv";
config({ path: ".env.local" });

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { NEANDER_COL } from "@/lib/neander/collections";
import { engineSigOf, isEngineOwned } from "@/lib/neander/finance/relearn";
import { labelVendorKinds } from "@/lib/neander/finance/server/ai-vendor-kind";
import {
  cardLast4Of,
  vendorKindKey,
  vendorKindLookup,
  vendorsToLabel,
  wantsVendorKind,
  VENDOR_KINDS,
} from "@/lib/neander/finance/vendor-kind";
import type { FinPaymentMethodDoc } from "@/lib/neander/finance/db-types";
import type { FinTransaction } from "@/lib/neander/finance/types";

const APPLY = process.argv.includes("--apply");
const ASK = process.argv.includes("--ask");
const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const FROM = arg("--from");
const UNDO = arg("--undo");
const BATCH = 400;

function init() {
  if (getApps().length > 0) return;
  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_B64;
  if (!b64) throw new Error("FIREBASE_SERVICE_ACCOUNT_B64 가 없습니다 (.env.local 확인).");
  const sa = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
  initializeApp({ credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey: sa.private_key }) });
}

(async () => {
  init();
  const db = getFirestore();
  const col = db.collection(NEANDER_COL.finTransactions);

  if (UNDO) {
    const saved = JSON.parse(readFileSync(UNDO, "utf8")) as { id: string; engineSig?: string | null }[];
    console.log(`${UNDO} — ${saved.length}건에서 업종을 뗍니다.`);
    const now = Date.now();
    for (let i = 0; i < saved.length; i += BATCH) {
      const b = db.batch();
      saved.slice(i, i + BATCH).forEach(({ id, engineSig }) => {
        b.set(
          col.doc(id),
          // 지문은 이 스크립트가 새로 남긴 것만 거둔다 (전에 있던 것은 그대로)
          { vendorKind: FieldValue.delete(), updatedAt: now, ...(engineSig === null ? { engineSig: FieldValue.delete() } : {}) },
          { merge: true },
        );
      });
      await b.commit();
    }
    console.log("완료.");
    process.exit(0);
  }

  const [txSnap, pmSnap] = await Promise.all([col.get(), db.collection(NEANDER_COL.finPaymentMethods).get()]);
  const all = txSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as FinTransaction[];
  const cards = cardLast4Of(pmSnap.docs.map((d) => d.data()) as FinPaymentMethodDoc[]);
  const known = vendorKindLookup(all);
  const targets = all.filter((t) => !t.vendorKind && wantsVendorKind(t, cards));
  const names = vendorsToLabel(all, known, cards);
  console.log(`카드 거래 중 업종이 없는 것 ${targets.length.toLocaleString("ko-KR")}건 · 이미 아는 가맹점 ${known.size}곳 · 물어야 할 가맹점 ${names.length}곳`);

  // 전에 받아 둔 답 → 없으면 모델
  if (FROM) {
    const saved = JSON.parse(readFileSync(FROM, "utf8")) as Record<string, string>;
    const valid = new Set<string>(VENDOR_KINDS);
    let used = 0;
    Object.entries(saved).forEach(([k, v]) => {
      const key = vendorKindKey(k);
      if (valid.has(v) && !known.has(key)) {
        known.set(key, v);
        used += 1;
      }
    });
    console.log(`${FROM} 에서 ${used}곳의 답을 읽었습니다.`);
  }
  const still = vendorsToLabel(all, known, cards);
  if (still.length > 0 && ASK) {
    console.log(`모델에게 ${still.length}곳을 묻습니다…`);
    const res = await labelVendorKinds(still);
    Object.entries(res.kinds).forEach(([k, v]) => known.set(k, v));
    console.log(`  받은 답 ${Object.keys(res.kinds).length}곳 · ${res.model} · $${res.costUsd.toFixed(4)}`);
  } else if (still.length > 0) {
    console.log(`  아직 답이 없는 가맹점 ${still.length}곳 — --ask 를 붙이면 모델에게 묻습니다 (1,000곳에 약 $0.12).`);
  }

  const plan = targets
    .map((t) => ({ t, kind: known.get(vendorKindKey(t.vendor)) }))
    .filter((x): x is { t: FinTransaction; kind: string } => !!x.kind);
  const tally = new Map<string, number>();
  plan.forEach(({ kind }) => tally.set(kind, (tally.get(kind) ?? 0) + 1));
  console.log(`\n업종이 붙는 거래 ${plan.length.toLocaleString("ko-KR")}건 (남는 것 ${targets.length - plan.length}건)`);
  console.log("  " + [...tally.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(" · "));
  const pending = plan.filter(({ t }) => t.status !== "confirmed");
  console.log(`  그중 대기함에 있는 것 ${pending.length}건 (엔진 소유 ${pending.filter(({ t }) => isEngineOwned(t)).length}건)`);

  if (!APPLY) {
    console.log("\n※ 미리보기입니다. 실제로 쓰려면 --apply 를 붙이세요.");
    process.exit(0);
  }
  if (plan.length === 0) {
    console.log("\n붙일 것이 없습니다.");
    process.exit(0);
  }

  const dir = path.join("output", "finance-vendor-kinds");
  mkdirSync(dir, { recursive: true });
  const backup = path.join(dir, `before-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  const rows = plan.map(({ t, kind }) => {
    // 엔진이 붙인 채 아무도 안 고친 대기 건 — 지문이 없으면 지금 남긴다
    const sig = isEngineOwned(t) && !t.engineSig ? engineSigOf(t) : undefined;
    return { id: t.id, kind, sig };
  });
  writeFileSync(backup, JSON.stringify(rows.map((r) => ({ id: r.id, vendorKind: r.kind, engineSig: r.sig ? null : undefined })), null, 1));
  console.log(`\n되돌리기 파일 → ${backup}`);

  const now = Date.now();
  for (let i = 0; i < rows.length; i += BATCH) {
    const b = db.batch();
    rows.slice(i, i + BATCH).forEach(({ id, kind, sig }) => {
      // 수정 시각은 찍는다 — 화면의 증분 동기화가 이 값으로 바뀐 거래를 찾는다. 고친 사람은 그대로 둔다
      b.set(col.doc(id), { vendorKind: kind, updatedAt: now, ...(sig ? { engineSig: sig } : {}) }, { merge: true });
    });
    await b.commit();
    process.stdout.write(`${Math.min(i + BATCH, rows.length)} `);
  }
  console.log("\n완료.");
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
