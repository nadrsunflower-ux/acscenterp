// ============================================================
//  개편 전 계정 경로 정리 — 마감을 막고 있는 32건
// ------------------------------------------------------------
//  2026-07 에 계정 마스터를 개편하면서 몇몇 소분류 이름이 바뀌었다.
//  5~6월 거래는 옛 이름을 그대로 들고 있어서 현행 마스터와 맞지 않는다.
//  월 마감 화면이 이걸 「마감 불가」로 잡는다.
//
//  ⚠️ 이름이 비슷하다고 옮기면 안 된다. 각 매핑은 근거를 확인했다:
//
//   ① 소모품비 → 일반소모품비 (24건)
//      같은 대·중분류 아래의 개명. 월별로 보면 소모품비는 5·6월에만,
//      일반소모품비는 7월에만 나온다 — **한 달도 공존하지 않는다.**
//      공존했다면 서로 다른 계정이라는 뜻이므로 옮기면 안 됐다.
//
//   ② 전기수도요금 → 전기수도통신비 (3건)
//      같은 대·중분류 아래의 개명. 한국전력공사 거래가 7월에는 실제로
//      전기수도통신비로 들어가 있다.
//
//   ③ 재무비용>자금이체관리>예약금지급 → 기타지출>환불지출>예약금환불 (1건)
//      중분류 자체가 마스터에 없다. 확정된 같은 성격 거래 2건
//      (카카오 127,000 · 주최자예약금환불 100,000) 이 모두 지출 유형에
//      기타지출>환불지출>예약금환불 을 쓴다. 자금거래 유형은 예수금 쪽으로
//      가지만 이 건은 지출이다.
//      ↳ 계정대분류가 재무비용에서 기타지출로 바뀌므로, 백필이 「전사공통:
//        재무비용」 규칙으로 넣었던 사업구분은 근거를 잃는다. 지운다.
//
//  ④ 환급 4건은 계정을 손대지 않는다. 계정은 처음부터 마스터에 있었고,
//     조회키에 거래유형이 들어가 `환급|…` 으로 찾다 못 찾은 것뿐이다.
//     (classify.ts 의 isAllowedTxAccountMismatch 에서 고쳤다.)
//     상태만 확정으로 올린다.
//
//    npm run finance:fix-accounts            (미리보기)
//    npm run finance:fix-accounts -- --apply
// ============================================================

import { config } from "dotenv";
config({ path: ".env.local" });

import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { NEANDER_COL } from "@/lib/neander/collections";
import { netAmount, type FinTransaction } from "@/lib/neander/finance/types";
import type { FinAccountDoc } from "@/lib/neander/finance/db-types";

const APPLY = process.argv.includes("--apply");
const BATCH = 400;
const fmt = (n: number) => Math.round(n).toLocaleString("ko-KR");

interface Remap {
  from: [string, string, string];
  to: [string, string, string];
  why: string;
  /** 계정대분류가 바뀌어 사업구분 근거가 사라지는가 */
  clearBiz?: boolean;
}

const REMAPS: Remap[] = [
  {
    from: ["운영비", "일반운영비", "소모품비"],
    to: ["운영비", "일반운영비", "일반소모품비"],
    why: "개명 (5·6월 ↔ 7월, 공존 없음)",
  },
  {
    from: ["운영비", "홍대공용운영비", "전기수도요금"],
    to: ["운영비", "홍대공용운영비", "전기수도통신비"],
    why: "개명 (한국전력공사 7월 실측)",
  },
  {
    from: ["재무비용", "자금이체관리", "예약금지급"],
    to: ["기타지출", "환불지출", "예약금환불"],
    why: "중분류가 마스터에 없음. 확정 사례 2건과 같은 자리",
    clearBiz: true,
  },
];

const key = (p: [string, string, string]) => p.join("|");
const show = (p: [string, string, string]) => p.join(" > ");

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
  const [txSnap, acctSnap] = await Promise.all([
    db.collection(NEANDER_COL.finTransactions).get(),
    db.collection(NEANDER_COL.finAccounts).get(),
  ]);
  const all = txSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as FinTransaction[];
  const accounts = acctSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as FinAccountDoc[];
  const master = new Set(accounts.map((a) => `${a.major}|${a.mid}|${a.minor}`));
  const pathOf = (t: FinTransaction) => `${t.acctMajor}|${t.acctMid}|${t.acctMinor}`;

  // ---- 안전장치 -----------------------------------------------
  console.log("=".repeat(72));
  console.log("매핑 검사");
  console.log("=".repeat(72));
  let unsafe = 0;
  REMAPS.forEach((r) => {
    const toOk = master.has(key(r.to));
    const fromGone = !master.has(key(r.from));
    // 같은 달에 둘 다 쓰였다면 개명이 아니라 서로 다른 계정이다
    const monthsFrom = new Set(all.filter((t) => pathOf(t) === key(r.from)).map((t) => (t.date ?? "").slice(0, 7)));
    const monthsTo = new Set(all.filter((t) => pathOf(t) === key(r.to)).map((t) => (t.date ?? "").slice(0, 7)));
    const overlap = [...monthsFrom].filter((m) => monthsTo.has(m));
    const ok = toOk && fromGone && overlap.length === 0;
    if (!ok) unsafe += 1;
    console.log(`  ${ok ? "✓" : "✕"} ${show(r.from)}\n      → ${show(r.to)}   ${r.why}`);
    if (!toOk) console.log(`      ✕ 목적지가 마스터에 없습니다`);
    if (!fromGone) console.log(`      ✕ 출발지가 아직 마스터에 살아 있습니다 — 옮기면 안 됩니다`);
    if (overlap.length) console.log(`      ✕ ${overlap.join(",")} 에 둘 다 쓰였습니다 — 개명이 아닙니다`);
  });
  if (unsafe > 0) {
    console.log(`\n${unsafe}개 매핑이 검사를 통과하지 못했습니다. 중단합니다.`);
    process.exit(1);
  }

  // ---- 대상 ---------------------------------------------------
  const moves = REMAPS.flatMap((r) =>
    all.filter((t) => pathOf(t) === key(r.from)).map((t) => ({ t, r })),
  );

  // 환급: 계정은 그대로, 상태만 푼다 (계정이 마스터에 있는 것만)
  const refunds = all.filter(
    (t) => t.txType === "환급" && t.status !== "confirmed" && master.has(pathOf(t)),
  );
  const refundStuck = all.filter(
    (t) => t.txType === "환급" && t.status !== "confirmed" && !master.has(pathOf(t)),
  );

  console.log("\n" + "=".repeat(72));
  console.log(`계정 이관 ${moves.length}건 · 환급 상태 해제 ${refunds.length}건`);
  console.log("=".repeat(72));
  REMAPS.forEach((r) => {
    const rows = moves.filter((m) => m.r === r).map((m) => m.t);
    if (rows.length === 0) return;
    const months = [...new Set(rows.map((t) => (t.date ?? "").slice(0, 7)))].sort();
    console.log(
      `  ${show(r.from)} → ${r.to[2]}   ${rows.length}건 ${fmt(rows.reduce((s, t) => s + netAmount(t), 0))}원  (${months.join("·")})`,
    );
    if (r.clearBiz) {
      rows.forEach((t) =>
        console.log(`      사업구분 ${t.bizMajor ?? "-"}·${t.bizMinor ?? "-"} → 비움 (근거가 된 계정대분류가 바뀜)`),
      );
    }
  });
  refunds.forEach((t) =>
    console.log(`  환급 ${t.date} ${fmt(netAmount(t)).padStart(9)}원 ${t.vendor ?? "-"} → 확정 (계정은 이미 마스터에 있음)`),
  );
  if (refundStuck.length) {
    console.log(`\n  ⚠️ 계정이 마스터에 없는 환급 ${refundStuck.length}건은 건드리지 않습니다.`);
  }

  if (!APPLY) {
    console.log("\n※ 미리보기입니다. 실제로 쓰려면 --apply 를 붙이세요.");
    process.exit(0);
  }

  // ---- 적용 ---------------------------------------------------
  const now = Date.now();
  const col = db.collection(NEANDER_COL.finTransactions);
  type Op = (b: FirebaseFirestore.WriteBatch) => void;
  const ops: Op[] = [];

  moves.forEach(({ t, r }) => {
    const data: Record<string, unknown> = {
      acctMajor: r.to[0],
      acctMid: r.to[1],
      acctMinor: r.to[2],
      status: "confirmed",
      updatedAt: now,
      updatedBy: "script:fix-legacy-accounts",
      classReason: `개편 전 계정 정리 — ${show(r.from)} → ${show(r.to)} (${r.why})`,
    };
    if (r.clearBiz) {
      data.bizMajor = null;
      data.bizMinor = null;
    }
    ops.push((b) => b.set(col.doc(t.id), data, { merge: true }));
  });

  refunds.forEach((t) => {
    ops.push((b) =>
      b.set(
        col.doc(t.id),
        {
          status: "confirmed",
          updatedAt: now,
          updatedBy: "script:fix-legacy-accounts",
          classReason:
            "환급이 지출 계정을 쓰는 건 정상 — 조회키의 거래유형 때문에 막혀 있던 것 (계정은 마스터에 있음)",
        },
        { merge: true },
      ),
    );
  });

  console.log(`\n${ops.length}건 적용 중…`);
  for (let i = 0; i < ops.length; i += BATCH) {
    const b = db.batch();
    ops.slice(i, i + BATCH).forEach((op) => op(b));
    await b.commit();
    console.log(`  ${Math.min(i + BATCH, ops.length)}/${ops.length}`);
  }

  // ---- 확인 ---------------------------------------------------
  const after = (await col.get()).docs.map((d) => ({ id: d.id, ...d.data() })) as FinTransaction[];
  const stillUnknown = after.filter((t) => t.acctMinor && !master.has(pathOf(t)));
  const stillPending = after.filter((t) => t.status !== "confirmed");
  console.log(`\n완료.`);
  console.log(`  마스터에 없는 계정  ${moves.length}건 → ${stillUnknown.length}건`);
  console.log(`  검토 대기          → ${stillPending.length}건`);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
