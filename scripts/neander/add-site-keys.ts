// ============================================================
//  자사몰 상품 키를 상품 마스터에 **더하기만** 한다 (CLI)
// ------------------------------------------------------------
//  온라인 자동 적재(lib/neander/sync)는 acscent.co.kr 의 상품 키
//  (`image_analysis/50ml` 꼴)를 상품 별칭으로 찾는다. 그 별칭은 코드의
//  SEED_PRODUCTS 에 들어 있지만, 이미 적재된 Firestore 마스터에는 없다.
//
//  ⚠️ 「마스터 적재」(master.seed)로 넣으면 안 된다. 그 동작은 코드의 값으로
//     상품 문서를 **덮어쓴다** — 상품 관리 화면에서 고친 판매가·재료비·별칭이
//     전부 코드 값으로 돌아간다. 이 스크립트는 별칭 배열에 빠진 키만 더하고
//     (arrayUnion), 다른 필드는 읽지도 쓰지도 않는다.
//
//     예외 하나: 마스터에 아예 없는 상품(ONL-009 50ml 세트)은 코드 값으로
//     새로 만든다. 고친 값이 있을 수 없는 문서다.
//
//  실행:
//    npm run sync:site-keys            무엇이 바뀔지 보여주기만 한다
//    npm run sync:site-keys -- --apply 실제로 쓴다
// ============================================================

import { config } from "dotenv";
config({ path: ".env.local" });

import { initializeApp, cert, getApps } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { NEANDER_COL } from "@/lib/neander/collections";
import { SEED_PRODUCTS } from "@/lib/neander/sales/master-data";

const APPLY = process.argv.includes("--apply");
const ACTOR = "script:add-site-keys";

function init() {
  if (getApps().length > 0) return;
  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_B64;
  if (!b64) throw new Error("FIREBASE_SERVICE_ACCOUNT_B64 가 없습니다 (.env.local 확인).");
  const sa = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
  initializeApp({
    credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey: sa.private_key }),
  });
}

/** 자사몰 상품 키인가 — 사람이 붙인 별칭("시향지")과 가른다 */
const isSiteKey = (a: string) => a.includes("/");

async function main() {
  init();
  const db = getFirestore();
  const col = db.collection(NEANDER_COL.salesProducts);
  const snap = await col.get();
  const live = new Map(snap.docs.map((d) => [d.id, d.data() as { aliases?: string[]; store?: string }]));

  // 이미 어느 상품에 걸려 있는 키 — 다른 상품에 또 걸면 해석기가 둘 중 하나를 고른다
  const owner = new Map<string, string>();
  live.forEach((doc, id) => (doc.aliases ?? []).filter(isSiteKey).forEach((a) => owner.set(a, id)));

  const plan: { id: string; action: "add" | "create"; keys: string[] }[] = [];
  const conflicts: string[] = [];

  for (const p of SEED_PRODUCTS.filter((x) => x.store === "online")) {
    const keys = (p.aliases ?? []).filter(isSiteKey);
    if (keys.length === 0) continue;
    const doc = live.get(p.id);
    if (!doc) {
      plan.push({ id: p.id, action: "create", keys });
      continue;
    }
    const have = new Set(doc.aliases ?? []);
    const add = keys.filter((k) => {
      if (have.has(k)) return false;
      const other = owner.get(k);
      if (other && other !== p.id) {
        conflicts.push(`${k} — 이미 ${other} 에 걸려 있어 ${p.id} 에 더하지 않습니다`);
        return false;
      }
      return true;
    });
    if (add.length > 0) plan.push({ id: p.id, action: "add", keys: add });
  }

  console.log(`\n상품 마스터 ${live.size}건 · 온라인 상품 키 점검\n`);
  if (plan.length === 0) console.log("  더할 것이 없습니다 — 이미 모두 들어 있습니다.");
  plan.forEach((x) =>
    console.log(`  ${x.action === "create" ? "새로 만듦" : "별칭 더함"}  ${x.id}  ${x.keys.join(", ")}`),
  );
  conflicts.forEach((c) => console.log(`  ⚠️ ${c}`));

  if (!APPLY) {
    console.log(plan.length > 0 ? "\n  (보기만 했습니다. 쓰려면 -- --apply)\n" : "");
    return;
  }

  const now = Date.now();
  const batch = db.batch();
  for (const x of plan) {
    if (x.action === "add") {
      batch.update(col.doc(x.id), {
        aliases: FieldValue.arrayUnion(...x.keys),
        updatedAt: now,
        updatedBy: ACTOR,
      });
    } else {
      const seed = SEED_PRODUCTS.find((p) => p.id === x.id)!;
      const { id, ...rest } = seed;
      const clean = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined));
      batch.set(col.doc(id), { ...clean, id, updatedAt: now, updatedBy: ACTOR });
    }
  }
  if (plan.length > 0) await batch.commit();
  console.log(`\n  ${plan.length}건을 썼습니다.\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
