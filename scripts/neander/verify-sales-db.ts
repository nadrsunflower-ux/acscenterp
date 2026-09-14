// ============================================================
//  적재된 매출 데이터 점검 (CLI)
// ------------------------------------------------------------
//  Firestore 에 실제로 들어간 것을 읽어 월별 손익을 찍는다.
//  `sales:verify` 는 엑셀 쪽(해석기)을, 이쪽은 **DB 쪽**을 본다.
//
//    npm run sales:verify-db
// ============================================================

import { config } from "dotenv";
config({ path: ".env.local" });

import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { NEANDER_COL } from "@/lib/neander/collections";
import { availableMonths, buildPnl } from "@/lib/neander/sales/aggregate";
import { SEED_ASSUMPTIONS } from "@/lib/neander/sales/master-data";
import type {
  SalesAssumptions,
  SalesEvent,
  SalesLine,
  SalesProduct,
} from "@/lib/neander/sales/types";

const won = (n: number) => Math.round(n).toLocaleString("ko-KR");
const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(1)}%` : "—");

function init() {
  if (getApps().length > 0) return;
  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_B64;
  if (!b64) throw new Error("FIREBASE_SERVICE_ACCOUNT_B64 가 없습니다 (.env.local 확인).");
  const sa = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
  initializeApp({
    credential: cert({
      projectId: sa.project_id,
      clientEmail: sa.client_email,
      privateKey: sa.private_key,
    }),
  });
}

(async () => {
  init();
  const db = getFirestore();
  const [ls, ps, es, as, imp] = await Promise.all([
    db.collection(NEANDER_COL.salesLines).get(),
    db.collection(NEANDER_COL.salesProducts).get(),
    db.collection(NEANDER_COL.salesEvents).get(),
    db.collection(NEANDER_COL.salesAssumptions).doc("current").get(),
    db.collection(NEANDER_COL.salesImports).get(),
  ]);
  const lines = ls.docs.map((d) => ({ id: d.id, ...d.data() })) as SalesLine[];
  const products = ps.docs.map((d) => ({ id: d.id, ...d.data() })) as SalesProduct[];
  const events = es.docs.map((d) => ({ id: d.id, ...d.data() })) as SalesEvent[];
  const a = (as.exists ? { id: as.id, ...as.data() } : SEED_ASSUMPTIONS) as SalesAssumptions;

  console.log(
    `Firestore: 판매 줄 ${won(lines.length)} · 상품 ${products.length}종 · 이벤트 ${events.length}건 · 적재배치 ${imp.size}개`,
  );
  console.log(
    `기본가정: laborMode=${a.laborMode} · 고정비 배부 와우 ${a.allocation.wow} / 아이디 ${a.allocation.id} / 온라인 ${a.allocation.online}`,
  );

  console.log(
    "\n월        매출        확정매출       공헌이익  공헌률       영업이익   미확정   BEP",
  );
  let tr = 0;
  let tc = 0;
  let tk = 0;
  let to = 0;
  let trv = 0;
  for (const m of availableMonths(lines, events).slice().reverse()) {
    const p = buildPnl(m, lines, products, events, a).total;
    tr += p.revenue;
    tc += p.confirmedRevenue;
    tk += p.contribution;
    to += p.operating;
    trv += p.reviewAmount;
    console.log(
      `${m} ${won(p.revenue).padStart(12)} ${won(p.confirmedRevenue).padStart(12)}` +
        ` ${won(p.contribution).padStart(14)} ${pct(p.contribution, p.confirmedRevenue).padStart(6)}` +
        ` ${won(p.operating).padStart(14)} ${String(p.reviewCount).padStart(5)}건` +
        ` ${(p.bepAchieved ? `${(p.bepAchieved * 100).toFixed(0)}%` : "—").padStart(5)}`,
    );
  }
  console.log(
    `합계    ${won(tr).padStart(12)} ${won(tc).padStart(12)} ${won(tk).padStart(14)}` +
      ` ${pct(tk, tc).padStart(6)} ${won(to).padStart(14)}`,
  );
  console.log(`\n미확정 ${won(trv)}원 — 매출의 ${pct(trv, tr)}`);
  console.log(
    `방문자 기록이 있는 이벤트 ${events.filter((e) => e.buyers !== undefined).length}건 / ${events.length}건`,
  );
  const noSupplies = events.filter((e) => !e.supplies).length;
  if (noSupplies > 0) console.log(`준비물이 0 인 이벤트 ${noSupplies}건`);
})().catch((e) => {
  console.error("\n실패:", e instanceof Error ? e.message : e);
  process.exit(1);
});
