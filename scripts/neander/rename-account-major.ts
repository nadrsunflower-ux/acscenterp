// ============================================================
//  계정 대분류 이름 바꾸기
// ------------------------------------------------------------
//  대분류의 **이름만** 바꾼다. 그 아래 중·소분류와 거래의 금액 · 상태 · 사업구분은
//  그대로다. 바뀌는 것은 셋이다:
//    ① 계정 마스터 — major 와 조회키(lookupKey). 문서 id 가 조회키라 새 문서로 옮긴다
//    ② 그 대분류를 쓴 거래의 acctMajor
//    ③ 자동분류 지문(engineSig) — 대분류가 지문에 들어 있어서, 엔진이 붙인 채 아무도
//       안 고친 대기 건은 지문도 새 이름으로 다시 남긴다 (안 그러면 「사람이 고친 행」
//       으로 보여 계속 배우기에서 빠진다 — relearn.ts)
//
//  ⚠️ 코드의 계정 목록(master-data.ts FIN_ACCOUNTS)도 같은 이름으로 고쳐야 한다.
//     리포트의 대분류 순서가 그 목록에서 나오고, 마스터를 다시 적재하면 그 목록이
//     옛 이름의 계정을 되살린다.
//
//  2026-10-02 「기타지출」 → 「환불·반환」 에 썼다. 기타비용(쓴 돈)과 이름이 닮아
//  합칠지 물었는데, 들어 있는 것은 전부 환불(받았던 돈을 돌려준 것)이었다.
//
//    npm run finance:rename-major -- --from 기타지출 --to "환불·반환"            (미리보기)
//    npm run finance:rename-major -- --from 기타지출 --to "환불·반환" --apply
//    npm run finance:rename-major -- --undo <output/finance-rename-major/before-….json>
// ============================================================

import { config } from "dotenv";
config({ path: ".env.local" });

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { NEANDER_COL } from "@/lib/neander/collections";
import { engineSigOf } from "@/lib/neander/finance/relearn";
import { safeId } from "@/lib/neander/finance/server/seed";
import { netAmount, type FinTransaction } from "@/lib/neander/finance/types";
import type { FinAccountDoc } from "@/lib/neander/finance/db-types";

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const APPLY = process.argv.includes("--apply");
const FROM = arg("--from");
const TO = arg("--to");
const UNDO = arg("--undo");
const BATCH = 400;
const BY = "script:rename-account-major";
const fmt = (n: number) => Math.round(n).toLocaleString("ko-KR");

interface Backup {
  from: string;
  to: string;
  accounts: { oldId: string; newId: string; data: Record<string, unknown> }[];
  transactions: { id: string; engineSig?: string }[];
}

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
  const accCol = db.collection(NEANDER_COL.finAccounts);
  const txCol = db.collection(NEANDER_COL.finTransactions);

  // ---- 되돌리기 ----
  if (UNDO) {
    const saved = JSON.parse(readFileSync(UNDO, "utf8")) as Backup;
    console.log(`${UNDO} — 「${saved.to}」 를 「${saved.from}」 로 되돌립니다 (계정 ${saved.accounts.length} · 거래 ${saved.transactions.length}).`);
    const b = db.batch();
    saved.accounts.forEach((a) => {
      b.set(accCol.doc(a.oldId), a.data);
      if (a.newId !== a.oldId) b.delete(accCol.doc(a.newId));
    });
    await b.commit();
    const now = Date.now();
    for (let i = 0; i < saved.transactions.length; i += BATCH) {
      const tb = db.batch();
      saved.transactions.slice(i, i + BATCH).forEach((t) => {
        tb.set(
          txCol.doc(t.id),
          { acctMajor: saved.from, updatedAt: now, ...(t.engineSig !== undefined ? { engineSig: t.engineSig } : {}) },
          { merge: true },
        );
      });
      await tb.commit();
    }
    console.log("완료.");
    process.exit(0);
  }

  if (!FROM || !TO || FROM === TO) throw new Error("--from <옛 이름> --to <새 이름> 이 필요합니다.");

  const [accSnap, txSnap] = await Promise.all([accCol.get(), txCol.where("acctMajor", "==", FROM).get()]);
  const accounts = accSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as FinAccountDoc[];
  const mine = accounts.filter((a) => a.major === FROM);
  const clash = accounts.filter((a) => a.major === TO);
  const txs = txSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as FinTransaction[];

  console.log(`「${FROM}」 → 「${TO}」`);
  if (clash.length > 0) {
    // 이미 있는 대분류로 바꾸는 것은 「합치기」 다 — 같은 중·소분류가 겹치면 덮어쓴다. 여기서는 하지 않는다
    console.log(`\n「${TO}」 는 이미 있는 대분류입니다 (계정 ${clash.length}개). 이 스크립트는 이름 바꾸기만 합니다 — 멈춥니다.`);
    process.exit(1);
  }
  console.log(`\n계정 ${mine.length}개`);
  mine.forEach((a) => console.log(`  [${a.txType}] ${a.mid} > ${a.minor}  (${a.code || "-"})`));

  const byMinor = new Map<string, { n: number; amount: number }>();
  txs.forEach((t) => {
    const k = `${t.acctMid ?? ""} > ${t.acctMinor ?? ""}`;
    const r = byMinor.get(k) ?? { n: 0, amount: 0 };
    r.n += 1;
    r.amount += netAmount(t);
    byMinor.set(k, r);
  });
  const sigged = txs.filter((t) => t.engineSig && t.engineSig === engineSigOf(t));
  console.log(`\n거래 ${txs.length}건 · ${fmt(txs.reduce((s, t) => s + netAmount(t), 0))}원 (확정 ${txs.filter((t) => t.status === "confirmed").length} · 대기 ${txs.filter((t) => t.status !== "confirmed").length} · 지문을 다시 남길 것 ${sigged.length})`);
  [...byMinor.entries()].sort((a, b) => b[1].n - a[1].n).forEach(([k, v]) => console.log(`  ${String(v.n).padStart(4)}건 ${fmt(v.amount).padStart(13)}원  ${k}`));

  if (!APPLY) {
    console.log("\n※ 미리보기입니다. 실제로 쓰려면 --apply 를 붙이세요.");
    process.exit(0);
  }
  if (mine.length === 0 && txs.length === 0) {
    console.log("\n바꿀 것이 없습니다.");
    process.exit(0);
  }

  // 바꾸기 전 값을 떠 둔다 (깃 밖)
  const renamed = mine.map((a) => {
    const { id, ...data } = a as FinAccountDoc & Record<string, unknown>;
    const lookupKey = String(a.lookupKey ?? "").split("|").map((part, i) => (i === 1 && part === FROM ? TO : part)).join("|");
    return { oldId: id, newId: safeId(lookupKey), data: data as Record<string, unknown>, next: { ...data, major: TO, lookupKey } };
  });
  const backup: Backup = {
    from: FROM,
    to: TO,
    accounts: renamed.map(({ oldId, newId, data }) => ({ oldId, newId, data })),
    transactions: txs.map((t) => ({ id: t.id, ...(t.engineSig !== undefined ? { engineSig: t.engineSig } : {}) })),
  };
  const dir = path.join("output", "finance-rename-major");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `before-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  writeFileSync(file, JSON.stringify(backup, null, 1));
  console.log(`\n되돌리기 파일 → ${file}`);

  // ① 계정 — 새 조회키의 문서로 옮긴다 (한 묶음: 반쯤 옮겨진 상태가 남지 않게)
  const ab = db.batch();
  renamed.forEach(({ oldId, newId, next }) => {
    ab.set(accCol.doc(newId), next);
    if (newId !== oldId) ab.delete(accCol.doc(oldId));
  });
  await ab.commit();
  console.log(`계정 ${renamed.length}개 옮김`);

  // ② 거래 — 대분류 이름과 (엔진 것이면) 지문
  const now = Date.now();
  for (let i = 0; i < txs.length; i += BATCH) {
    const tb = db.batch();
    txs.slice(i, i + BATCH).forEach((t) => {
      const owned = !!t.engineSig && t.engineSig === engineSigOf(t);
      tb.set(
        txCol.doc(t.id),
        {
          acctMajor: TO,
          // 화면의 증분 동기화가 이 값으로 바뀐 거래를 찾는다. 고친 사람(updatedBy)은 그대로 둔다
          updatedAt: now,
          ...(owned ? { engineSig: engineSigOf({ ...t, acctMajor: TO }) } : {}),
        },
        { merge: true },
      );
    });
    await tb.commit();
  }
  console.log(`거래 ${txs.length}건 바꿈 (${BY})`);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
