// ============================================================
//  계정 경로 정규화 — 개편 전 분류를 현행 마스터에 맞춘다
// ------------------------------------------------------------
//  2026-08-10 카테고리 개편으로 계정 경로가 바뀌었다. 개편 전 장부
//  (~2606)를 적재하면 계정 4단 경로가 현행 마스터(통합_MAP)와 어긋난다.
//
//  어긋나면 이런 문제가 생긴다:
//   1) 엑셀 내보내기의 회계코드·부가세·자산·지점이 빈칸 (계정 조인 실패)
//   2) 거래 편집 모달의 계정 드롭다운이 현재 값을 못 찾음
//   3) **월별 비교가 깨진다** — 예를 들어 법인세가 5·6월엔 '재무비용',
//      7월엔 '세금공과' 로 잡혀 계정대분류 추이가 어긋난다
//
//  해결 방식: **소분류(잎) 이름은 개편 후에도 대체로 그대로**라는 점을
//  이용해, 같은 거래유형 안에서 소분류 이름이 유일하게 일치하는 마스터
//  계정으로 상위 경로를 교정한다.
//
//  ⚠️ 후보가 여럿이거나 없으면 **건드리지 않는다.** 재무에서 추측으로
//     분류를 바꾸는 것은 안 하느니만 못하다. 대신 검토 대기함으로 보내
//     사람이 정하게 한다.
//
//    npm run finance:normalize -- [--dry] [--flag-unresolved]
// ============================================================

import * as dotenv from "dotenv";
import { resolve } from "path";
dotenv.config({ path: resolve(__dirname, "../../.env.local") });

import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { NEANDER_COL } from "../../lib/neander/collections";
import { PL_TX_TYPES, type FinTransaction, type TxType } from "../../lib/neander/finance/types";
import type { FinAccountDoc } from "../../lib/neander/finance/db-types";

const BATCH_LIMIT = 450;

function initAdmin() {
  if (getApps().length) return;
  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_B64;
  if (!b64) {
    console.error("FIREBASE_SERVICE_ACCOUNT_B64 가 없습니다. npm run finance:normalize 로 실행하세요.");
    process.exit(1);
  }
  const sa = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
  initializeApp({
    credential: cert({
      projectId: sa.project_id,
      clientEmail: sa.client_email,
      privateKey: sa.private_key,
    }),
  });
}

const pathOf = (t: { txType: TxType; acctMajor?: string; acctMid?: string; acctMinor?: string }) =>
  [t.txType, t.acctMajor ?? "", t.acctMid ?? "", t.acctMinor ?? ""].join("|");

async function main() {
  const args = process.argv.slice(2);
  const dry = args.includes("--dry");
  const flagUnresolved = args.includes("--flag-unresolved");

  initAdmin();
  const db = getFirestore();

  const [txSnap, acSnap] = await Promise.all([
    db.collection(NEANDER_COL.finTransactions).get(),
    db.collection(NEANDER_COL.finAccounts).get(),
  ]);
  const accounts = acSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as FinAccountDoc[];
  const txs = txSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as FinTransaction[];
  const masterPaths = new Set(accounts.map((a) => a.lookupKey));

  console.log(`거래 ${txs.length}건 · 마스터 계정 ${accounts.length}개${dry ? "  (모의 실행)" : ""}\n`);

  // 거래유형 + 소분류 이름 → 마스터 계정 후보
  const byLeaf = new Map<string, FinAccountDoc[]>();
  accounts.forEach((a) => {
    const k = `${a.txType}|${a.minor}`;
    if (!byLeaf.has(k)) byLeaf.set(k, []);
    byLeaf.get(k)!.push(a);
  });

  interface Fix {
    ids: string[];
    from: string;
    to: string;
    a: FinAccountDoc;
  }
  const fixes = new Map<string, Fix>();
  const unresolved = new Map<string, { n: number; ids: string[]; pl: boolean }>();

  txs.forEach((t) => {
    const p = pathOf(t);
    if (masterPaths.has(p)) return;
    // 계정이 아예 비어 있으면 정규화 대상이 아니다 (분류 자체가 없는 것)
    if (!t.acctMinor) return;

    const cands = byLeaf.get(`${t.txType}|${t.acctMinor}`) ?? [];
    if (cands.length === 1) {
      const a = cands[0];
      const to = a.lookupKey;
      if (!fixes.has(p)) fixes.set(p, { ids: [], from: p, to, a });
      fixes.get(p)!.ids.push(t.id);
    } else {
      if (!unresolved.has(p)) {
        unresolved.set(p, { n: 0, ids: [], pl: PL_TX_TYPES.includes(t.txType) });
      }
      const u = unresolved.get(p)!;
      u.n++;
      u.ids.push(t.id);
    }
  });

  const fixCount = [...fixes.values()].reduce((s, f) => s + f.ids.length, 0);
  console.log(`── 교정 가능 (소분류 이름이 마스터에 유일하게 존재) — ${fixCount}건 / ${fixes.size}종`);
  [...fixes.values()]
    .sort((a, b) => b.ids.length - a.ids.length)
    .forEach((f) =>
      console.log(`  ${String(f.ids.length).padStart(4)}건  ${f.from}\n         →  ${f.to}  (${f.a.code})`),
    );

  const unCount = [...unresolved.values()].reduce((s, u) => s + u.n, 0);
  console.log(`\n── 교정 불가 — ${unCount}건 / ${unresolved.size}종`);
  [...unresolved.entries()]
    .sort((a, b) => b[1].n - a[1].n)
    .forEach(([p, u]) =>
      console.log(`  ${String(u.n).padStart(4)}건  ${p}${u.pl ? "" : "   (손익 비대상 — 계정 불필요)"}`),
    );

  if (dry) {
    console.log("\n(모의 실행이라 여기서 끝냅니다)");
    process.exit(0);
  }

  // ---- 적용 ----
  const now = Date.now();
  const updates: { id: string; data: Record<string, unknown> }[] = [];

  fixes.forEach((f) => {
    f.ids.forEach((id) =>
      updates.push({
        id,
        data: {
          acctMajor: f.a.major,
          acctMid: f.a.mid,
          acctMinor: f.a.minor,
          classReason: `개편 전 분류를 현행 마스터로 교정 (${f.from} → ${f.to})`,
          updatedAt: now,
          updatedBy: "normalize-accounts",
        },
      }),
    );
  });

  if (flagUnresolved) {
    // 손익에 잡히는 것만 사람 검토로 보낸다. 자금거래·카드대금결제는
    // 계정이 없어도 집계에 영향이 없다.
    unresolved.forEach((u, p) => {
      if (!u.pl) return;
      u.ids.forEach((id) =>
        updates.push({
          id,
          data: {
            status: "needs_review",
            classReason: `개편 전 분류 「${p}」 가 현행 마스터에 없음 — 사람이 정해야 함`,
            updatedAt: now,
            updatedBy: "normalize-accounts",
          },
        }),
      );
    });
  }

  if (updates.length === 0) {
    console.log("\n적용할 변경이 없습니다.");
    process.exit(0);
  }

  for (let i = 0; i < updates.length; i += BATCH_LIMIT) {
    const batch = db.batch();
    updates.slice(i, i + BATCH_LIMIT).forEach((u) => {
      batch.set(db.collection(NEANDER_COL.finTransactions).doc(u.id), u.data, { merge: true });
    });
    await batch.commit();
    console.log(`  적용 ${Math.min(i + BATCH_LIMIT, updates.length)}/${updates.length}`);
  }
  console.log(`\n✅ ${updates.length}건 갱신 완료`);
  process.exit(0);
}

main().catch((e) => {
  console.error("\n❌ 실패:", e instanceof Error ? e.message : e);
  process.exit(1);
});
