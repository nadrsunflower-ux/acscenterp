// ============================================================
//  사업구분 백필 ③ — 사람이 내린 네 가지 결정을 적용한다
// ------------------------------------------------------------
//  앞의 두 스크립트(규칙 / 계정별 95% 학습)로 669건을 채우고 227건이
//  남았다. 남은 것들은 자동 기준을 못 넘긴 것이라 사람이 정해야 했고,
//  2026-08-24 에 네 가지 결정이 내려졌다. 이 스크립트는 그 결정을 그대로
//  집행한다. 기준을 임의로 낮춘 게 아니라 **결정된 것만** 한다.
//
//   A. 직원급여는 사람별로 채운다
//      7월 배정이 공용 5 : 홍대공용 5 로 정확히 반이라 계정 기준으로는
//      손댈 수 없었다. 그런데 뜯어보니 임의로 갈린 게 아니라 **사람별로**
//      갈려 있었다. 5·6월에 급여를 받은 9명이 전원 7월에도 나오고 각자
//      한 쪽으로만 배정돼 있다. 사업부는 거래의 성질이 아니라 그 사람이
//      어디서 일하는지의 문제라, 1건짜리 관측도 통계 표본과 성격이 다르다.
//      (`매장인건비` 계정은 0건이다 — 매장 직원도 이 계정을 쓴다.)
//
//   B. 계정별 학습이 만장일치면 표본 1~2건이어도 쓴다
//      「홍대공용운영비 > 임차료」 같은 것들이다. 표본 3건 기준에 걸려
//      남아 있었지만 7월 값과 계정 이름이 서로 어긋나지 않는다.
//      만장일치가 아니면(보험료: 아이디 1 / 와우 1) 여전히 건드리지 않는다.
//
//   C. 갈리는 것은 최빈값 80% 이상만
//      실제로 넘는 건 구독서비스비(26/30)와 차량유지비(14/17) 둘뿐이다.
//      일반소모품비(13/22)·원자재비(13/22)처럼 진짜로 다섯 사업부에
//      흩어진 것은 남긴다 — 공용으로 밀어버리면 매장별 손익이 흐려진다.
//
//   D. 임직원퇴직금은 공용
//      7월 표본이 없지만 전사 인사 항목이다. 표본 없는 나머지 19건은
//      근거가 없어 남긴다.
//
//    npm run finance:backfill-biz-decisions
//    npm run finance:backfill-biz-decisions -- --apply
// ============================================================

import { config } from "dotenv";
config({ path: ".env.local" });

import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { NEANDER_COL } from "@/lib/neander/collections";
import { netAmount, PL_TX_TYPES, type FinTransaction } from "@/lib/neander/finance/types";

const APPLY = process.argv.includes("--apply");
/** C: 갈리는 계정에 요구하는 최빈값 비율 */
const SPLIT_MIN = 0.8;
/** C: 갈리는 계정에 요구하는 최소 표본 */
const SPLIT_MIN_SAMPLE = 3;
const BATCH = 400;

const fmt = (n: number) => Math.round(n).toLocaleString("ko-KR");
const pathOf = (t: FinTransaction) =>
  `${t.acctMajor ?? "-"} > ${t.acctMid ?? "-"} > ${t.acctMinor ?? "-"}`;
const bizOf = (t: FinTransaction) => `${t.bizMajor}·${t.bizMinor ?? ""}`;

interface Assign {
  t: FinTransaction;
  biz: [string, string];
  pass: "A" | "B" | "C" | "D";
  why: string;
}

function init() {
  if (getApps().length > 0) return;
  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_B64;
  if (!b64) throw new Error("FIREBASE_SERVICE_ACCOUNT_B64 가 없습니다 (.env.local 확인).");
  const sa = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
  initializeApp({
    credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey: sa.private_key }),
  });
}

/** 이미 분류된 거래에서 key 별 사업구분 분포 */
function distribution(rows: FinTransaction[], keyOf: (t: FinTransaction) => string) {
  const m = new Map<string, Map<string, number>>();
  rows.forEach((t) => {
    const k = keyOf(t);
    if (!m.has(k)) m.set(k, new Map());
    const d = m.get(k)!;
    d.set(bizOf(t), (d.get(bizOf(t)) ?? 0) + 1);
  });
  return m;
}

const split = (biz: string): [string, string] => {
  const i = biz.indexOf("·");
  return [biz.slice(0, i), biz.slice(i + 1)];
};

(async () => {
  init();
  const db = getFirestore();
  const snap = await db.collection(NEANDER_COL.finTransactions).get();
  const all = snap.docs.map((d) => ({ id: d.id, ...d.data() })) as FinTransaction[];

  const labeled = all.filter((t) => t.bizMajor);
  const todo = all.filter((t) => PL_TX_TYPES.includes(t.txType) && !t.bizMajor);
  const assigned = new Map<string, Assign>();
  const take = (a: Assign) => {
    if (!assigned.has(a.t.id)) assigned.set(a.t.id, a);
  };

  // ── A. 직원급여: 사람별 ──────────────────────────────────
  const payByPerson = distribution(
    labeled.filter((t) => t.acctMinor === "직원급여"),
    (t) => (t.vendor ?? "").trim(),
  );
  const payMissing: string[] = [];
  todo
    .filter((t) => t.acctMinor === "직원급여")
    .forEach((t) => {
      const d = payByPerson.get((t.vendor ?? "").trim());
      // 그 사람의 7월 배정이 한 가지여야 한다. 두 갈래면 사람이 정해야 한다.
      if (!d || d.size !== 1) {
        payMissing.push(`${t.vendor ?? "-"} (${d ? `${d.size}갈래` : "7월에 없음"})`);
        return;
      }
      const biz = [...d.keys()][0];
      take({ t, biz: split(biz), pass: "A", why: `7월 급여 배정 — ${t.vendor} 은(는) ${biz}` });
    });

  // ── B/C. 계정 소분류별 ───────────────────────────────────
  const byAcct = distribution(labeled, pathOf);
  const heldC: string[] = [];
  todo
    .filter((t) => !assigned.has(t.id))
    .forEach((t) => {
      const d = byAcct.get(pathOf(t));
      if (!d) return;
      if (d.size === 1) {
        const biz = [...d.keys()][0];
        const n = [...d.values()][0];
        take({ t, biz: split(biz), pass: "B", why: `계정 「${pathOf(t)}」 의 기존 분류 ${n}건이 모두 ${biz}` });
        return;
      }
      const sorted = [...d.entries()].sort((a, b) => b[1] - a[1]);
      const total = sorted.reduce((s, [, n]) => s + n, 0);
      const [top, hit] = sorted[0];
      if (hit / total >= SPLIT_MIN && total >= SPLIT_MIN_SAMPLE) {
        take({ t, biz: split(top), pass: "C", why: `계정 「${pathOf(t)}」 의 기존 분류 ${total}건 중 ${hit}건이 ${top}` });
      } else {
        heldC.push(`${pathOf(t)}  ${Math.round((hit / total) * 100)}% (${hit}/${total})`);
      }
    });

  // ── D. 임직원퇴직금 ──────────────────────────────────────
  todo
    .filter((t) => !assigned.has(t.id) && t.acctMid === "퇴직금")
    .forEach((t) => take({ t, biz: ["공용", "공용"], pass: "D", why: "전사 인사 항목 (사람 판단)" }));

  // ---- 출력 ---------------------------------------------------
  const plan = [...assigned.values()];
  const left = todo.filter((t) => !assigned.has(t.id));
  const PASS_NAME = {
    A: "A 직원급여 사람별",
    B: "B 계정 만장일치 (표본 1~2건 포함)",
    C: `C 최빈값 ${SPLIT_MIN * 100}%↑`,
    D: "D 퇴직금",
  } as const;

  console.log("=".repeat(78));
  console.log(`사업구분 미기입(손익) ${todo.length}건 ${fmt(todo.reduce((s, t) => s + netAmount(t), 0))}원`);
  console.log("=".repeat(78));

  (["A", "B", "C", "D"] as const).forEach((p) => {
    const rows = plan.filter((a) => a.pass === p);
    if (rows.length === 0) return;
    console.log(`\n${PASS_NAME[p]} — ${rows.length}건 ${fmt(rows.reduce((s, a) => s + netAmount(a.t), 0))}원`);
    const g = new Map<string, { n: number; amt: number; biz: string }>();
    rows.forEach((a) => {
      const k = p === "A" ? (a.t.vendor ?? "-") : pathOf(a.t);
      const x = g.get(k) ?? { n: 0, amt: 0, biz: a.biz.join("·") };
      x.n += 1;
      x.amt += netAmount(a.t);
      g.set(k, x);
    });
    [...g.entries()]
      .sort((a, b) => Math.abs(b[1].amt) - Math.abs(a[1].amt))
      .forEach(([k, v]) =>
        console.log(`   ${k.slice(0, 40).padEnd(40)} ${String(v.n).padStart(3)}건 ${fmt(v.amt).padStart(11)}  → ${v.biz}`),
      );
  });

  if (payMissing.length) {
    console.log(`\n⚠️ 7월 배정을 찾지 못한 급여: ${[...new Set(payMissing)].join(", ")}`);
  }

  console.log(`\n남길 것 ${left.length}건 ${fmt(left.reduce((s, t) => s + netAmount(t), 0))}원`);
  const lg = new Map<string, { n: number; amt: number }>();
  left.forEach((t) => {
    const x = lg.get(pathOf(t)) ?? { n: 0, amt: 0 };
    x.n += 1;
    x.amt += netAmount(t);
    lg.set(pathOf(t), x);
  });
  [...lg.entries()]
    .sort((a, b) => Math.abs(b[1].amt) - Math.abs(a[1].amt))
    .forEach(([k, v]) => console.log(`   ${k.slice(0, 40).padEnd(40)} ${String(v.n).padStart(3)}건 ${fmt(v.amt).padStart(11)}`));

  if (!APPLY) {
    console.log("\n※ 미리보기입니다. 실제로 쓰려면 --apply 를 붙이세요.");
    process.exit(0);
  }

  const now = Date.now();
  const col = db.collection(NEANDER_COL.finTransactions);
  console.log(`\n${plan.length}건 적용 중…`);
  for (let i = 0; i < plan.length; i += BATCH) {
    const b = db.batch();
    plan.slice(i, i + BATCH).forEach((a) =>
      b.set(
        col.doc(a.t.id),
        {
          bizMajor: a.biz[0],
          bizMinor: a.biz[1],
          updatedAt: now,
          updatedBy: "script:backfill-biz-decisions",
          classReason: `사업구분 백필 ${a.pass} — ${a.why}`,
        },
        { merge: true },
      ),
    );
    await b.commit();
    console.log(`  ${Math.min(i + BATCH, plan.length)}/${plan.length}`);
  }

  const after = (await col.get()).docs.map((d) => ({ id: d.id, ...d.data() })) as FinTransaction[];
  const still = after.filter((t) => PL_TX_TYPES.includes(t.txType) && !t.bizMajor);
  console.log(`\n완료. 사업구분 미기입(손익) ${todo.length}건 → ${still.length}건`);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
