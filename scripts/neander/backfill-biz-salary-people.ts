// ============================================================
//  사업구분 백필 ⑤ — 급여를 사람별로 (퇴사자 + 거래처 표기 변형)
// ------------------------------------------------------------
//  급여의 사업구분은 거래의 성질이 아니라 **그 사람이 어디서 일했는가**의
//  문제다 (backfill-biz-decisions A 와 같은 원칙). 남아 있던 미기입 급여는
//  두 부류였다:
//
//   ① 7월 명단에 없는 퇴사자 — 2026-08-25 사람이 소속을 결정했다:
//        김다빈 → 아이디   조용주 → 본사(공용)   김지민 → 신촌
//        김원정 → 아이디   홍채민 → 본사(공용)   이석진 → 본사(공용)
//      「김영연급여」는 김명연의 오타라는 결정도 함께 — 김명연은 아이디.
//      (7월 장부는 김명연을 홍대공용으로 적었으나, 사람이 「모두 아이디」로
//       확정해 7월분 5건도 아이디로 정정했다. 2026-08-25.)
//
//   ② 재직자(또는 2026년 퇴사자)인데 거래처 표기가 달라 매칭이 안 된 것 —
//      「유혜윤 9월 인건비」 「10월 이우빈 인건비」 같은 변형. 이름이
//      들어 있으면 그 사람의 7월 배정을 그대로 쓴다. 김주희·김정연은
//      2026년 퇴사자라는 확인을 받았으므로 재직 기간(2025~) 배정이 유효하다.
//
//  누구 것인지 알 수 없는 라벨(「11월 인건비」 「급여」 「세란병원」)은
//  건드리지 않는다 — 검토 대기함에 남는다.
//
//    npx tsx scripts/neander/backfill-biz-salary-people.ts            (미리보기)
//    npx tsx scripts/neander/backfill-biz-salary-people.ts --apply
// ============================================================

import { config } from "dotenv";
config({ path: ".env.local" });

import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { NEANDER_COL } from "@/lib/neander/collections";
import { netAmount, type FinTransaction } from "@/lib/neander/finance/types";

const APPLY = process.argv.includes("--apply");
const fmt = (n: number) => Math.round(n).toLocaleString("ko-KR");

/** 사람 → 사업구분. 출처: ①은 2026-08-25 사람 결정, ②는 7월 장부 실측 배정 */
const PEOPLE: Record<string, { biz: [string, string]; src: "결정" | "7월" }> = {
  // ① 퇴사자 — 사람 결정
  김다빈: { biz: ["B2C", "아이디"], src: "결정" },
  조용주: { biz: ["공용", "공용"], src: "결정" },
  김지민: { biz: ["B2C", "신촌"], src: "결정" },
  김원정: { biz: ["B2C", "아이디"], src: "결정" },
  홍채민: { biz: ["공용", "공용"], src: "결정" },
  이석진: { biz: ["공용", "공용"], src: "결정" },
  김명연: { biz: ["B2C", "아이디"], src: "결정" },
  // ② 재직자·2026 퇴사자 — 7월 배정
  유재영: { biz: ["공용", "공용"], src: "7월" },
  이동주: { biz: ["공용", "공용"], src: "7월" },
  유선화: { biz: ["공용", "공용"], src: "7월" },
  김주연: { biz: ["공용", "공용"], src: "7월" },
  김주희: { biz: ["공용", "공용"], src: "7월" },
  김정연: { biz: ["공용", "공용"], src: "7월" },
  김제연: { biz: ["공용", "공용"], src: "7월" },
  유다혜: { biz: ["공용", "공용"], src: "7월" },
  유혜윤: { biz: ["B2C", "홍대공용"], src: "7월" },
  이우빈: { biz: ["B2C", "홍대공용"], src: "7월" },
  장하영: { biz: ["B2C", "홍대공용"], src: "7월" },
  조수빈: { biz: ["B2C", "홍대공용"], src: "7월" },
};

/** 김영연 → 김명연 오타 (사람 결정) */
const TYPO: Record<string, string> = { 김영연: "김명연" };

/** 거래처 문자열에서 사람을 찾는다 — 이름이 정확히 포함돼야 한다 */
function personOf(vendor: string | undefined): { name: string; typo: boolean } | null {
  if (!vendor) return null;
  for (const [wrong, right] of Object.entries(TYPO)) {
    if (vendor.includes(wrong)) return { name: right, typo: true };
  }
  const hits = Object.keys(PEOPLE).filter((n) => vendor.includes(n));
  // 두 사람 이름이 같이 들어 있으면(있을 리 없지만) 판단하지 않는다
  return hits.length === 1 ? { name: hits[0], typo: false } : null;
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
  const col = db.collection(NEANDER_COL.finTransactions);
  const snap = await col.get();
  const all = snap.docs.map((d) => ({ id: d.id, ...d.data() })) as FinTransaction[];

  // 대상: 사업구분이 빈 급여 지출 (임원·직원 불문)
  const todo = all.filter((t) => t.txType === "지출" && t.acctMid === "급여" && !t.bizMajor);

  const plan: { t: FinTransaction; name: string; biz: [string, string]; src: string; typo: boolean }[] = [];
  const skipped: FinTransaction[] = [];
  todo.forEach((t) => {
    const p = personOf(t.vendor);
    if (!p) {
      skipped.push(t);
      return;
    }
    const d = PEOPLE[p.name];
    plan.push({ t, name: p.name, biz: d.biz, src: d.src, typo: p.typo });
  });

  console.log(`사업구분 없는 급여 ${todo.length}건 — 채움 ${plan.length}건 · 남김 ${skipped.length}건\n`);

  const byPerson = new Map<string, { n: number; amt: number; biz: string; src: string }>();
  plan.forEach((x) => {
    const e = byPerson.get(x.name) ?? { n: 0, amt: 0, biz: x.biz.join("·"), src: x.src };
    e.n++;
    e.amt += netAmount(x.t);
    byPerson.set(x.name, e);
  });
  [...byPerson.entries()]
    .sort((a, b) => b[1].amt - a[1].amt)
    .forEach(([n, e]) =>
      console.log(`  ${n.padEnd(8)} ${String(e.n).padStart(3)}건 ${fmt(e.amt).padStart(12)}  → ${e.biz}  (${e.src})`),
    );

  console.log(`\n남김 (누구 것인지 알 수 없음):`);
  skipped.forEach((t) => console.log(`  ${t.date}  ${(t.vendor ?? "(없음)").padEnd(16)} ${fmt(netAmount(t)).padStart(12)}`));

  if (!APPLY) {
    console.log("\n※ 미리보기입니다. 실제로 쓰려면 --apply 를 붙이세요.");
    process.exit(0);
  }

  const now = Date.now();
  for (let i = 0; i < plan.length; i += 400) {
    const b = db.batch();
    plan.slice(i, i + 400).forEach(({ t, name, biz, src, typo }) => {
      const data: Record<string, unknown> = {
        bizMajor: biz[0],
        bizMinor: biz[1],
        status: "confirmed",
        classReason:
          src === "결정"
            ? `사업구분 백필 — ${name} 소속은 사람 결정 (2026-08-25)${typo ? " · 거래처 「김영연」은 김명연의 오타" : ""}`
            : `사업구분 백필 — ${name} 의 7월 배정 (거래처 표기 변형으로 자동 매칭이 놓친 것)`,
        updatedAt: now,
        updatedBy: "script:backfill-biz-salary-people",
      };
      if (typo) data.vendor = "김명연";
      b.set(col.doc(t.id), data, { merge: true });
    });
    await b.commit();
    console.log(`  ${Math.min(i + 400, plan.length)}/${plan.length}`);
  }
  console.log(`\n✅ ${plan.length}건 적용 완료`);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
