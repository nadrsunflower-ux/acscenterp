// ============================================================
//  애매한 거래를 검토 대기함으로 보낸다
// ------------------------------------------------------------
//  임포트가 끝나면 "확정"으로 들어왔지만 실제로는 사람이 정해야 하는 행이
//  남는다. 그대로 두면 리포트에 그럴싸한 숫자로 섞여 들어가고, 아무도
//  다시 보지 않는다. 상태를 「검토필요」로 내려서 대기함에 모은다.
//
//  대기함에 넣는 것 — **분류가 정해지지 않은 것만**:
//    ① 계정이 마스터에 없다        리포트 트리에 고아 줄로 남는다
//    ② 계정 소분류가 비어 있다      어느 줄에도 안 잡혀 손익에서 빠진다
//    ③ 사업구분이 비어 있다        사업부 손익·공통비 배분에서 빠진다
//    ④ 거래유형과 계정이 어긋난다   부호가 뒤집혀 손익이 두 배로 틀어진다
//
//  넣지 않는 것 — 분류 문제가 아니다:
//    · 중복 의심   같은 파일을 두 번 올린 적재 문제다. 대기함에서 계정을
//                 고쳐도 해결되지 않는다. 월 마감 화면이 잡는다.
//    · 순금액 0원  전액 취소면 정상이다.
//    · 거래처 없음 분류가 틀린 게 아니라 비어 있는 것이다.
//
//  ⚠️ 이미 대기함에 있는 행은 건드리지 않는다. 그 행이 들고 있는 원래
//     사유(classReason)가 더 구체적인 경우가 많다.
//
//    npm run finance:queue-ambiguous
//    npm run finance:queue-ambiguous -- --apply
// ============================================================

import { config } from "dotenv";
config({ path: ".env.local" });

import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { NEANDER_COL } from "@/lib/neander/collections";
import { isAllowedTxAccountMismatch } from "@/lib/neander/finance/classify";
import { netAmount, PL_TX_TYPES, type FinTransaction } from "@/lib/neander/finance/types";
import type { FinAccountDoc } from "@/lib/neander/finance/db-types";

const APPLY = process.argv.includes("--apply");
const BATCH = 400;
const fmt = (n: number) => Math.round(n).toLocaleString("ko-KR");

interface Rule {
  key: string;
  label: string;
  /** 대기함에 보이는 사유 */
  reason: (t: FinTransaction) => string;
  hit: (t: FinTransaction, ctx: Ctx) => boolean;
}

interface Ctx {
  paths: Set<string>;
  acctTxType: Map<string, string>;
}

const path = (t: FinTransaction) => `${t.acctMajor}|${t.acctMid}|${t.acctMinor}`;

const RULES: Rule[] = [
  {
    key: "no-account",
    label: "계정 소분류가 비어 있음",
    hit: (t) => !t.acctMinor,
    reason: () => "계정이 비어 있습니다 — 어느 리포트 줄에도 잡히지 않습니다",
  },
  {
    key: "unknown-account",
    label: "계정 마스터에 없는 계정",
    hit: (t, c) => !!t.acctMinor && !c.paths.has(path(t)),
    reason: (t) =>
      `개편 전 경로이거나 오타입니다 — 「${t.acctMajor} > ${t.acctMid} > ${t.acctMinor}」 는 현행 마스터에 없습니다`,
  },
  {
    key: "tx-mismatch",
    label: "거래유형과 계정이 어긋남",
    hit: (t, c) => {
      const at = c.acctTxType.get(path(t));
      return !!at && at !== t.txType && !isAllowedTxAccountMismatch(t.txType, t.acctMinor, at);
    },
    reason: (t) => `거래유형은 ${t.txType} 인데 계정은 다른 유형입니다 — 부호가 뒤집힙니다`,
  },
  {
    key: "no-biz",
    label: "사업구분이 비어 있음",
    hit: (t) => PL_TX_TYPES.includes(t.txType) && !t.bizMajor,
    reason: () => "사업구분이 비어 있습니다 — 사업부 손익과 공통비 배분에서 빠집니다",
  },
];

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
  const ctx: Ctx = {
    paths: new Set(accounts.map((a) => `${a.major}|${a.mid}|${a.minor}`)),
    acctTxType: new Map(accounts.map((a) => [`${a.major}|${a.mid}|${a.minor}`, a.txType])),
  };

  const already = all.filter((t) => t.status !== "confirmed");
  const confirmed = all.filter((t) => t.status === "confirmed");

  // 한 행이 여러 이유에 걸릴 수 있다 — 사유를 모아 보여준다
  const plan = confirmed
    .map((t) => ({ t, why: RULES.filter((r) => r.hit(t, ctx)) }))
    .filter((x) => x.why.length > 0);

  console.log("=".repeat(72));
  console.log(`거래 ${all.length}건 · 이미 대기함 ${already.length}건 (건드리지 않음)`);
  console.log("=".repeat(72));

  console.log(`\n대기함으로 보낼 것 ${plan.length}건 ${fmt(plan.reduce((s, x) => s + netAmount(x.t), 0))}원`);
  RULES.forEach((r) => {
    const rows = plan.filter((x) => x.why.includes(r)).map((x) => x.t);
    if (rows.length === 0) return;
    const months = [...new Set(rows.map((t) => (t.date ?? "").slice(0, 7)))].sort();
    console.log(
      `  ${r.label.padEnd(20)} ${String(rows.length).padStart(4)}건 ` +
        `${fmt(rows.reduce((s, t) => s + netAmount(t), 0)).padStart(13)}  (${months.join("·").replace(/2026-/g, "")}월)`,
    );
  });

  const multi = plan.filter((x) => x.why.length > 1);
  if (multi.length) console.log(`  ↳ 이 중 ${multi.length}건은 두 가지 이상에 걸립니다`);

  if (!APPLY) {
    console.log("\n※ 미리보기입니다. 실제로 쓰려면 --apply 를 붙이세요.");
    process.exit(0);
  }

  const now = Date.now();
  const col = db.collection(NEANDER_COL.finTransactions);
  console.log(`\n${plan.length}건 적용 중…`);
  for (let i = 0; i < plan.length; i += BATCH) {
    const b = db.batch();
    plan.slice(i, i + BATCH).forEach(({ t, why }) => {
      b.set(
        col.doc(t.id),
        {
          status: "needs_review",
          updatedAt: now,
          updatedBy: "script:queue-ambiguous",
          classReason: why.map((r) => r.reason(t)).join(" / "),
        },
        { merge: true },
      );
    });
    await b.commit();
    console.log(`  ${Math.min(i + BATCH, plan.length)}/${plan.length}`);
  }

  const after = (await col.get()).docs.filter((d) => d.data().status !== "confirmed").length;
  console.log(`\n완료. 검토 대기 ${already.length}건 → ${after}건`);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
