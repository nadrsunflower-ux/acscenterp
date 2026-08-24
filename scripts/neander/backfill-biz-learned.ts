// ============================================================
//  사업구분 백필 ② — 계정별로 7월에서 배운다
// ------------------------------------------------------------
//  먼저 만든 backfill-biz-unit.ts 는 손으로 쓴 규칙이었다. 그래서 계정
//  **중분류** 단위로 뭉쳐졌고, 「홍대공용운영비 → 홍대공용」 같은 규칙이
//  94% 에서 걸려 통째로 버려졌다.
//
//  이 스크립트는 계정 **소분류** 경로마다 이미 분류된 거래에서 직접
//  배운다. 같은 데이터인데 결이 고와지니 갈라진다 —
//
//    홍대공용운영비 (중분류 뭉치)        94%  ✕ 버려짐
//      ├ 생카소모품비                   98%  ✓ 채움 (93건)
//      ├ 일반소모품비                  100%  ✓ 채움 (17건)
//      ├ 보험료          7월은 아이디·와우  ✕ 남김 — 계정 이름과 다르다
//      └ 비품구입비       7월은 아이디 2:1   ✕ 남김
//
//  「홍대공용운영비인데 홍대공용이 아닌」 거래가 실제로 있다는 게 요점이다.
//  공용 공간에서 산 물건이 특정 매장 것인 경우다. 중분류로 뭉치면 이게
//  안 보인다.
//
//  ⚠️ 학습이라고 해서 다 믿지 않는다. 95% 이상 · 표본 3건 이상만 쓴다.
//     직원급여는 7월이 공용 5 : 홍대공용 5 로 정확히 반이라 손대지 않는다.
//     급여 2,461만원을 잘못 배분하면 사업부 손익이 통째로 틀어진다.
//
//    npm run finance:backfill-biz-learned
//    npm run finance:backfill-biz-learned -- --apply
// ============================================================

import { config } from "dotenv";
config({ path: ".env.local" });

import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { NEANDER_COL } from "@/lib/neander/collections";
import { netAmount, PL_TX_TYPES, type FinTransaction } from "@/lib/neander/finance/types";

const APPLY = process.argv.includes("--apply");
/** 이 이하로 일관되지 않으면 쓰지 않는다 */
const MIN_ACCURACY = 0.95;
/** 이보다 표본이 적으면 쓰지 않는다 — 1건짜리 "100%" 는 근거가 아니다 */
const MIN_SAMPLE = 3;
const BATCH = 400;

const fmt = (n: number) => Math.round(n).toLocaleString("ko-KR");
const pathOf = (t: FinTransaction) =>
  `${t.acctMajor ?? "-"} > ${t.acctMid ?? "-"} > ${t.acctMinor ?? "-"}`;
const bizOf = (t: FinTransaction) => `${t.bizMajor}·${t.bizMinor ?? ""}`;

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
  const snap = await db.collection(NEANDER_COL.finTransactions).get();
  const all = snap.docs.map((d) => ({ id: d.id, ...d.data() })) as FinTransaction[];

  // ---- 1) 계정 경로마다 사업구분 분포를 센다 ------------------
  const learned = new Map<string, Map<string, number>>();
  all
    .filter((t) => t.bizMajor)
    .forEach((t) => {
      const p = pathOf(t);
      if (!learned.has(p)) learned.set(p, new Map());
      const d = learned.get(p)!;
      d.set(bizOf(t), (d.get(bizOf(t)) ?? 0) + 1);
    });

  // ---- 2) 채울 대상 ------------------------------------------
  //  비손익(자금거래·카드대금결제)은 앞선 스크립트가 이미 처리했다.
  const todo = all.filter((t) => PL_TX_TYPES.includes(t.txType) && !t.bizMajor);
  const groups = new Map<string, FinTransaction[]>();
  todo.forEach((t) => groups.set(pathOf(t), [...(groups.get(pathOf(t)) ?? []), t]));

  interface Plan {
    rows: FinTransaction[];
    biz: [string, string];
    hit: number;
    total: number;
  }
  const plans: Plan[] = [];
  const held: { p: string; rows: FinTransaction[]; note: string }[] = [];

  [...groups.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .forEach(([p, rows]) => {
      const dist = learned.get(p);
      if (!dist) {
        held.push({ p, rows, note: "학습 표본 없음" });
        return;
      }
      const sorted = [...dist.entries()].sort((a, b) => b[1] - a[1]);
      const total = sorted.reduce((s, [, n]) => s + n, 0);
      const [top, hit] = sorted[0];
      if (hit / total < MIN_ACCURACY || total < MIN_SAMPLE) {
        held.push({
          p,
          rows,
          note:
            total < MIN_SAMPLE && hit / total >= MIN_ACCURACY
              ? `표본 ${total}건뿐 (${top})`
              : `갈림 — ${sorted.map(([b, n]) => `${b} ${n}`).join(" / ")}`,
        });
        return;
      }
      const [major, minor] = top.split("·");
      plans.push({ rows, biz: [major, minor], hit, total });
    });

  const planned = plans.flatMap((x) => x.rows);
  const heldRows = held.flatMap((x) => x.rows);

  console.log("=".repeat(78));
  console.log(`사업구분 미기입(손익) ${todo.length}건 ${fmt(todo.reduce((s, t) => s + netAmount(t), 0))}원`);
  console.log("=".repeat(78));

  console.log(`\n채울 것 ${planned.length}건 ${fmt(planned.reduce((s, t) => s + netAmount(t), 0))}원`);
  plans.forEach((x) =>
    console.log(
      `  ${pathOf(x.rows[0]).slice(0, 42).padEnd(42)} ${String(x.rows.length).padStart(4)}건 ` +
        `${fmt(x.rows.reduce((s, t) => s + netAmount(t), 0)).padStart(11)}  → ${x.biz.join("·")} (학습 ${x.hit}/${x.total})`,
    ),
  );

  console.log(`\n남길 것 ${heldRows.length}건 ${fmt(heldRows.reduce((s, t) => s + netAmount(t), 0))}원`);
  held
    .sort((a, b) => Math.abs(b.rows.reduce((s, t) => s + netAmount(t), 0)) - Math.abs(a.rows.reduce((s, t) => s + netAmount(t), 0)))
    .forEach((x) =>
      console.log(
        `  ${x.p.slice(0, 42).padEnd(42)} ${String(x.rows.length).padStart(4)}건 ` +
          `${fmt(x.rows.reduce((s, t) => s + netAmount(t), 0)).padStart(11)}  ${x.note}`,
      ),
    );

  if (!APPLY) {
    console.log("\n※ 미리보기입니다. 실제로 쓰려면 --apply 를 붙이세요.");
    process.exit(0);
  }

  const now = Date.now();
  const col = db.collection(NEANDER_COL.finTransactions);
  const ops = plans.flatMap((x) =>
    x.rows.map((t) => ({
      id: t.id,
      data: {
        bizMajor: x.biz[0],
        bizMinor: x.biz[1],
        updatedAt: now,
        updatedBy: "script:backfill-biz-learned",
        classReason: `사업구분 백필 — 계정 「${pathOf(t)}」 은 이미 분류된 거래 ${x.total}건 중 ${x.hit}건이 ${x.biz.join("·")}`,
      },
    })),
  );

  console.log(`\n${ops.length}건 적용 중…`);
  for (let i = 0; i < ops.length; i += BATCH) {
    const b = db.batch();
    ops.slice(i, i + BATCH).forEach((o) => b.set(col.doc(o.id), o.data, { merge: true }));
    await b.commit();
    console.log(`  ${Math.min(i + BATCH, ops.length)}/${ops.length}`);
  }

  const after = (await col.get()).docs.map((d) => ({ id: d.id, ...d.data() })) as FinTransaction[];
  const left = after.filter((t) => PL_TX_TYPES.includes(t.txType) && !t.bizMajor);
  console.log(`\n완료. 사업구분 미기입(손익) ${todo.length}건 → ${left.length}건`);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
