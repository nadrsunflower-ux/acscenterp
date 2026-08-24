// ============================================================
//  사업구분 백필 — 4~6월 미기입분
// ------------------------------------------------------------
//  사업구분 축은 2026-08 에 신설됐다. 그래서 7월분만 100% 채워져 있고
//  4~6월 895건은 비어 있다(1.7억원). 그 기간의 사업부 리포트·공통비 배분이
//  통째로 무의미하다.
//
//  ⚠️ 그렇다고 다 채우면 안 된다. 7월 데이터로 규칙을 뽑아 정확도를 재보니
//     계정마다 편차가 크다:
//        재무비용·세금공과·기타수입 → 공용    100%
//        복리후생비>일반식대         → 공용     96%
//        급여>직원급여              → 공용     50%  ← 표본 10건, 반반
//        마케팅비                   → 아이디   81%
//     급여를 잘못 배분하면 사업부 손익이 통째로 틀어진다. 그래서 이 스크립트는
//     **7월 실측으로 95% 이상 검증된 규칙만** 적용하고 나머지는 손대지 않는다.
//     남은 것은 사람이 원장 시트(계정 필터 → 사업소분류 열 일괄 입력)로 처리한다.
//
//  2026-08-24 실행 결과: 495건 채움, 400건 남김.
//     월별 기입률 4월 40% · 5월 56% · 6월 55% · 7월 100%.
//     남은 400건은 아래 두 부류다 —
//       ① 공용 공간에서 산 것이 실제로는 특정 매장 것 (홍대공용운영비 121건)
//       ② 사람이 배분 비율을 정해야 하는 것 (직원급여 25건 2,461만)
//     원장 시트에서 계정 열 필터 → 사업소분류 일괄 입력으로 처리한다.
//
//  기본은 드라이런이다. 실제로 쓰려면 --apply 를 붙인다.
//
//    npm run finance:backfill-biz          (미리보기)
//    npm run finance:backfill-biz -- --apply
// ============================================================

import { config } from "dotenv";
config({ path: ".env.local" });

import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { NEANDER_COL } from "@/lib/neander/collections";
import { netAmount, type FinTransaction } from "@/lib/neander/finance/types";

const APPLY = process.argv.includes("--apply");
/** 이 정확도 미만인 규칙은 쓰지 않는다 */
const MIN_ACCURACY = 0.95;
/** 규칙을 인정할 최소 학습 표본 */
const MIN_SAMPLE = 3;
const BATCH = 400;

const fmt = (n: number) => Math.round(n).toLocaleString("ko-KR");
const pct = (a: number, b: number) => `${Math.round((a / Math.max(b, 1)) * 100)}%`;

interface Rule {
  name: string;
  /** 이 거래에 적용되는가 */
  match: (t: FinTransaction) => boolean;
  biz: [string, string];
}

/**
 * 규칙 목록. 위에서부터 먼저 맞는 것을 쓴다.
 * 순서가 중요하다 — 계정명 규칙이 대분류 규칙보다 구체적이므로 앞에 온다.
 */
const RULES: Rule[] = [
  // ① 계정 이름 자체가 사업부를 말한다 (와우운영비가 와우 것이 아닐 수는 없다)
  { name: "계정명: 와우", match: (t) => /와우운영비/.test(t.acctMid ?? "") || /와우판매/.test(t.acctMinor ?? ""), biz: ["B2C", "와우"] },
  { name: "계정명: 아이디", match: (t) => /아이디운영비/.test(t.acctMid ?? "") || /아이디판매/.test(t.acctMinor ?? ""), biz: ["B2C", "아이디"] },
  { name: "계정명: 신촌", match: (t) => /신촌운영비/.test(t.acctMid ?? "") || /신촌판매/.test(t.acctMinor ?? ""), biz: ["B2C", "신촌"] },
  { name: "계정명: SMOAT", match: (t) => /SMOAT/.test(t.acctMid ?? "") || /SMOAT/.test(t.acctMinor ?? ""), biz: ["B2C", "SMOAT"] },
  { name: "계정명: 온라인", match: (t) => /온라인판매/.test(t.acctMinor ?? ""), biz: ["B2C", "온라인"] },
  { name: "계정명: 홍대공용", match: (t) => /홍대공용운영비/.test(t.acctMid ?? ""), biz: ["B2C", "홍대공용"] },

  // ② 비손익 거래. 리포트가 어차피 제외하지만, 비워 두면 "미기입"과 구분이
  //    안 된다. 처음엔 둘을 한 규칙으로 묶었다가 76% 로 거부당했다 —
  //    실측해 보니 자금거래는 「해당없음」, 카드대금결제는 「공용」으로
  //    다르게 처리하고 있었다. 규칙이 거친 것이었지 데이터가 애매한 게 아니었다.
  { name: "비손익: 자금거래", match: (t) => t.txType === "자금거래", biz: ["해당없음", "해당없음"] },
  { name: "비손익: 카드대금결제", match: (t) => t.txType === "카드대금결제", biz: ["공용", "공용"] },

  // ③ 전사 공통으로만 쓰이는 계정 (7월 100% 일관)
  { name: "전사공통: 재무비용", match: (t) => t.acctMajor === "재무비용", biz: ["공용", "공용"] },
  { name: "전사공통: 세금공과", match: (t) => t.acctMajor === "세금공과", biz: ["공용", "공용"] },
  { name: "전사공통: 기타수입", match: (t) => t.acctMajor === "기타수입", biz: ["공용", "공용"] },
  { name: "전사공통: 사대보험", match: (t) => t.acctMid === "사대보험", biz: ["공용", "공용"] },
  { name: "전사공통: 임원급여", match: (t) => t.acctMinor === "임원급여", biz: ["공용", "공용"] },
  { name: "전사공통: 회식·워크숍", match: (t) => t.acctMinor === "회식워크숍비", biz: ["공용", "공용"] },
  { name: "전사공통: 일반식대", match: (t) => t.acctMinor === "일반식대", biz: ["공용", "공용"] },
];

function ruleFor(t: FinTransaction): Rule | null {
  return RULES.find((r) => r.match(t)) ?? null;
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

(async () => {
  init();
  const db = getFirestore();
  const snap = await db.collection(NEANDER_COL.finTransactions).get();
  const all = snap.docs.map((d) => ({ id: d.id, ...d.data() })) as FinTransaction[];

  // ---- 1) 7월 실측으로 각 규칙의 정확도를 잰다 ----------------
  const labeled = all.filter((t) => t.bizMajor);
  const accuracy = new Map<string, { hit: number; miss: number; examples: string[] }>();
  labeled.forEach((t) => {
    const r = ruleFor(t);
    if (!r) return;
    if (!accuracy.has(r.name)) accuracy.set(r.name, { hit: 0, miss: 0, examples: [] });
    const a = accuracy.get(r.name)!;
    if (r.biz[0] === t.bizMajor && r.biz[1] === (t.bizMinor ?? "")) a.hit += 1;
    else {
      a.miss += 1;
      if (a.examples.length < 3) {
        a.examples.push(`${t.acctMid}>${t.acctMinor} → 실제 ${t.bizMajor}·${t.bizMinor}`);
      }
    }
  });

  console.log("=".repeat(74));
  console.log("규칙 정확도 (이미 사업구분이 있는 거래로 검증)");
  console.log("=".repeat(74));
  const trusted = new Set<string>();
  RULES.forEach((r) => {
    const a = accuracy.get(r.name);
    if (!a) {
      console.log(`  ─  ${r.name.padEnd(28)} 학습 표본 없음 → 쓰지 않음`);
      return;
    }
    const total = a.hit + a.miss;
    const acc = a.hit / total;
    const ok = acc >= MIN_ACCURACY && total >= MIN_SAMPLE;
    if (ok) trusted.add(r.name);
    console.log(
      `  ${ok ? "✓" : "✕"}  ${r.name.padEnd(28)} ${pct(a.hit, total).padStart(4)} (${a.hit}/${total})` +
        (ok ? "" : `  → 쓰지 않음${total < MIN_SAMPLE ? " (표본 부족)" : ""}`),
    );
    if (!ok && a.examples.length) a.examples.forEach((e) => console.log(`        어긋난 예: ${e}`));
  });

  // ---- 2) 채울 대상 ------------------------------------------
  const targets = all.filter((t) => !t.bizMajor);
  const plan = targets
    .map((t) => ({ t, r: ruleFor(t) }))
    .filter((x) => x.r && trusted.has(x.r.name)) as { t: FinTransaction; r: Rule }[];
  const left = targets.filter((t) => {
    const r = ruleFor(t);
    return !r || !trusted.has(r.name);
  });

  console.log("\n" + "=".repeat(74));
  console.log(`사업구분 미기입 ${targets.length}건 ${fmt(targets.reduce((s, t) => s + netAmount(t), 0))}원`);
  console.log("=".repeat(74));
  const byRule = new Map<string, { n: number; amt: number; biz: string }>();
  plan.forEach(({ t, r }) => {
    const k = r.name;
    if (!byRule.has(k)) byRule.set(k, { n: 0, amt: 0, biz: r.biz.join("·") });
    const g = byRule.get(k)!;
    g.n += 1;
    g.amt += netAmount(t);
  });
  console.log(`\n채울 것 ${plan.length}건:`);
  [...byRule.entries()]
    .sort((a, b) => b[1].n - a[1].n)
    .forEach(([k, v]) => console.log(`  ${k.padEnd(28)} ${String(v.n).padStart(4)}건 ${fmt(v.amt).padStart(12)}  → ${v.biz}`));

  console.log(`\n남길 것 ${left.length}건 ${fmt(left.reduce((s, t) => s + netAmount(t), 0))}원 — 사람이 판단해야 합니다:`);
  const byAcct = new Map<string, { n: number; amt: number }>();
  left.forEach((t) => {
    const k = `${t.acctMajor ?? "(미분류)"}>${t.acctMid ?? ""}`;
    if (!byAcct.has(k)) byAcct.set(k, { n: 0, amt: 0 });
    const g = byAcct.get(k)!;
    g.n += 1;
    g.amt += netAmount(t);
  });
  [...byAcct.entries()]
    .sort((a, b) => Math.abs(b[1].amt) - Math.abs(a[1].amt))
    .slice(0, 15)
    .forEach(([k, v]) => console.log(`  ${k.padEnd(34)} ${String(v.n).padStart(4)}건 ${fmt(v.amt).padStart(12)}`));
  if (byAcct.size > 15) console.log(`  … 외 ${byAcct.size - 15}개 계정 묶음`);

  // ---- 3) 적용 ------------------------------------------------
  if (!APPLY) {
    console.log("\n※ 미리보기입니다. 실제로 쓰려면 --apply 를 붙이세요.");
    process.exit(0);
  }

  console.log(`\n${plan.length}건 적용 중…`);
  const now = Date.now();
  for (let i = 0; i < plan.length; i += BATCH) {
    const batch = db.batch();
    plan.slice(i, i + BATCH).forEach(({ t, r }) => {
      batch.set(
        db.collection(NEANDER_COL.finTransactions).doc(t.id),
        {
          bizMajor: r.biz[0],
          bizMinor: r.biz[1],
          updatedAt: now,
          updatedBy: "script:backfill-biz-unit",
          classReason: `사업구분 백필 — ${r.name} (7월 실측 검증)`,
        },
        { merge: true },
      );
    });
    await batch.commit();
    console.log(`  ${Math.min(i + BATCH, plan.length)}/${plan.length}`);
  }

  const after = await db.collection(NEANDER_COL.finTransactions).get();
  const stillEmpty = after.docs.filter((d) => !d.data().bizMajor).length;
  console.log(`\n완료. 사업구분 미기입 ${targets.length}건 → ${stillEmpty}건`);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
