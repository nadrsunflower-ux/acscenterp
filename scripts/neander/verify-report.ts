// ============================================================
//  리포트 엔진 검증 — 엑셀 장부와 원 단위로 맞는지 확인한다
// ------------------------------------------------------------
//  기준값의 출처: 2607(주)네안데르_장부.xlsx 및 그 장부를 적재한
//  Firestore 데이터의 2026-07 실측. 리포트 로직을 고친 뒤에는 반드시
//  이 스크립트를 돌려 숫자가 그대로인지 확인한다.
//
//    npm run finance:verify-report
// ============================================================

import { config } from "dotenv";
config({ path: ".env.local" });
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { buildReport, makeIsCard, subscriptionReport, subscriptionMatchers, availableUnits, isEmptyValue } from "@/lib/neander/finance/report";
import type { FinTransaction } from "@/lib/neander/finance/types";
import type {
  FinAccountDoc,
  FinAllocationDoc,
  FinPaymentMethodDoc,
  FinSubscriptionDoc,
  FinVendorRuleDoc,
} from "@/lib/neander/finance/db-types";
import { allocate, unitTotals } from "@/lib/neander/finance/allocation";
import {
  FIN_ALLOCATIONS,
  FIN_PAYMENT_METHODS,
  FIN_SUBSCRIPTIONS,
} from "@/lib/neander/finance/master-data";

const sa = JSON.parse(Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_B64!, "base64").toString("utf8"));
initializeApp({ credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey: sa.private_key }) });
const db = getFirestore();

const fmt = (n: number) => Math.round(n).toLocaleString("ko-KR");
let fails = 0;
const eq = (got: number, want: number, label: string) => {
  const ok = Math.round(got) === want;
  if (!ok) fails++;
  console.log(ok ? "ok  " : "FAIL", label.padEnd(38), fmt(got).padStart(14), ok ? "" : `≠ ${fmt(want)}`);
};

(async () => {
  const [txs, accs, pms, rules] = await Promise.all([
    db.collection("neander_fin_transactions").get(),
    db.collection("neander_fin_accounts").get(),
    db.collection("neander_fin_payment_methods").get(),
    db.collection("neander_fin_vendor_rules").get(),
  ]);
  const transactions = txs.docs.map((d) => ({ id: d.id, ...d.data() })) as FinTransaction[];
  const accounts = accs.docs.map((d) => ({ id: d.id, ...d.data() })) as FinAccountDoc[];
  const paymentMethods = pms.docs.map((d) => ({ id: d.id, ...d.data() })) as FinPaymentMethodDoc[];
  const vendorRules = rules.docs.map((d) => ({ id: d.id, ...d.data() })) as FinVendorRuleDoc[];
  const isCard = makeIsCard(paymentMethods);
  const scope = { month: "2026-07" };

  console.log("=== 지출상세 · 발생주의 (2026-07) ===");
  const a = buildReport(transactions, { basis: "accrual", isCard, scope, accounts });
  eq(a.total.income, 41_656_602, "수입금액");
  eq(a.total.expense, 58_896_728, "지출금액");
  eq(a.total.personal, 12_800, "개인사용");
  eq(a.total.refund, 143_700, "환급");
  eq(a.total.expensePure, 58_896_728 - 12_800 - 143_700, "지출(순수) = 지출−개인−환급");
  eq(a.total.net, 41_656_602 - (58_896_728 - 12_800 - 143_700), "순금액 = 수입−순수");

  console.log("\n=== 지출상세 · 현금흐름 (2026-07) ===");
  const c = buildReport(transactions, { basis: "cash", isCard, scope, accounts });
  eq(c.total.expense, 56_989_399, "지출금액 (계좌·현금 + 카드대금)");
  eq(c.total.income, 41_656_602, "수입금액 (기준 무관)");
  eq(a.total.expense - c.total.expense, 1_907_329, "차이 = 청구 전 카드 사용분");

  console.log("\n=== 트리 정합성 ===");
  const walkSum = (nodes: any[]): number => nodes.reduce((s, n) => s + n.value.expense, 0);
  eq(walkSum(a.roots), a.total.expense, "대분류 합 = 총계");
  const midSum = a.roots.reduce((s, r) => s + r.children.reduce((s2: number, m: any) => s2 + m.value.expense, 0), 0);
  eq(midSum, a.total.expense, "중분류 합 = 총계");
  const leafSum = a.roots.reduce((s, r) => s + r.children.reduce((s2: number, m: any) => s2 + m.children.reduce((s3: number, l: any) => s3 + l.value.expense, 0), 0), 0);
  eq(leafSum, a.total.expense, "소분류 합 = 총계");
  const leafCount = a.roots.reduce((s, r) => s + r.children.reduce((s2: number, m: any) => s2 + m.children.length, 0), 0);
  const nonEmpty = a.roots.filter((r) => !isEmptyValue(r.value)).length;
  console.log(`     계정 잎 ${leafCount}개 (마스터 ${accounts.length}) · 값이 있는 대분류 ${nonEmpty}/${a.roots.length}`);
  console.log("     대분류 순서:", a.roots.map((r) => r.label).join(" → "));

  console.log("\n=== 사업부 (2026-07, 발생주의) ===");
  const julRows = transactions.filter((t) => (t.date ?? "").startsWith("2026-07"));
  const units = availableUnits(julRows);
  let unitNetSum = 0;
  units.forEach((u) => {
    const r = buildReport(transactions, { basis: "accrual", isCard, scope: { month: "2026-07", bizMajor: u.bizMajor, bizMinor: u.bizMinor } });
    console.log(`     ${u.label.padEnd(14)} ${String(r.total.count).padStart(4)}건  순 ${fmt(r.total.net).padStart(13)}`);
    unitNetSum += r.total.net;
  });
  eq(unitNetSum, a.total.net, "사업부 순금액 합 = 전체 순금액");

  console.log("\n=== 구독 (2026-07) ===");
  const s = subscriptionReport(julRows, subscriptionMatchers([], vendorRules));
  eq(s.total, 4_180_260, "구독 계정 합계");
  eq(s.services.reduce((x, v) => x + v.net, 0) + s.unmatchedTotal, s.total, "서비스 합 + 미매칭 = 총계");
  console.log(`     서비스 ${s.services.length}개 · 미매칭 ${s.unmatched.length}건 ${fmt(s.unmatchedTotal)}`);
  console.log("     상위 5:", s.services.slice(0, 5).map((x) => `${x.service} ${fmt(x.net)}`).join(" / "));
  // 사람 이름 키워드(이동주·김제연)는 진짜 대납 구독비도 갖고 있다.
  // 계정 제한이 걸러내야 하는 것은 "같은 이름의 급여 이체"다.
  const nameRules = s.services.filter((x) => x.keywords.some((k) => /이동주|김제연/.test(k)));
  const nameNet = nameRules.reduce((x, v) => x + v.net, 0);
  eq(nameNet, 29_800 + 513_975, "이름 키워드 = 대납 구독비만 (급여 제외)");
  const salaryLeak = julRows.filter(
    (t) => t.txType === "지출" && /이동주|김제연/.test(t.vendor ?? "") && (t.acctMajor ?? "") === "인건비",
  );
  const leaked = s.services.some((x) => x.rows.some((r) => salaryLeak.includes(r)));
  console.log(leaked ? "FAIL 급여가 구독비에 섞임" : "ok   급여 5,000,512원이 구독비에서 제외됨");
  if (leaked) fails++;

  // ========================================================
  //  2단계 — 결제수단 종류 · 구독 마스터 · 공통비 배분
  //  Firestore 에 아직 적재되지 않았을 수 있으므로 마스터 소스로 검증한다.
  // ========================================================
  console.log("\n=== 2단계 · 결제수단 종류(kind) ===");
  const seeded = FIN_PAYMENT_METHODS.map((p) => ({ ...p, id: p.last4 })) as FinPaymentMethodDoc[];
  const isCardByKind = makeIsCard(seeded);
  const kindCards = seeded.filter((p) => p.kind === "card").map((p) => p.last4).sort();
  const personalCards = seeded.filter((p) => p.personal).map((p) => p.last4).sort();
  console.log(
    JSON.stringify(kindCards) === JSON.stringify(personalCards)
      ? "ok   kind=card 와 personal 이 일치 (법인카드 0장인 현 상태)"
      : "FAIL kind 와 personal 이 갈라짐",
  );
  if (JSON.stringify(kindCards) !== JSON.stringify(personalCards)) fails++;
  const cashByKind = buildReport(transactions, { basis: "cash", isCard: isCardByKind, scope, accounts });
  eq(cashByKind.total.expense, 56_989_399, "kind 로 판정해도 현금흐름 동일");
  console.log(`     통장 ${seeded.filter((p) => p.kind === "account").length} · 카드 ${kindCards.length} · 현금 ${seeded.filter((p) => p.kind === "cash").length}`);

  console.log("\n=== 2단계 · 구독 마스터 ===");
  const subDocs = FIN_SUBSCRIPTIONS.map((x) => ({ ...x, id: x.service })) as FinSubscriptionDoc[];
  const mastered = subscriptionMatchers(subDocs, []);
  const sm = subscriptionReport(julRows, mastered);
  eq(sm.total, 4_180_260, "구독 계정 합계 (마스터 기준, 총액 불변)");
  eq(sm.services.reduce((x, v) => x + v.net, 0) + sm.unmatchedTotal, sm.total, "서비스 합 + 미매칭 = 총계");
  console.log(`     서비스 ${sm.services.length}개 · 미매칭 ${sm.unmatched.length}건 ${fmt(sm.unmatchedTotal)} (옛 규칙은 ${s.unmatched.length}건 ${fmt(s.unmatchedTotal)})`);
  const better = sm.unmatched.length <= s.unmatched.length;
  console.log(better ? "ok   마스터가 옛 규칙보다 덜 놓침" : "FAIL 마스터가 더 놓침");
  if (!better) fails++;
  // 복수 키워드의 실효 — CLAUDE.AI 표기는 ANTHROPIC 하나로는 안 잡힌다
  const claudeAll = transactions.filter(
    (t) => t.txType === "지출" && /CLAUDE\.AI/i.test(t.vendor ?? "") &&
      ["구독서비스비", "툴구독비", "개발프로그램구독비"].includes(t.acctMinor ?? ""),
  );
  const claudeAmt = claudeAll.reduce((x, t) => x + (t.gross - t.adjust), 0);
  const oldHit = subscriptionReport(claudeAll, subscriptionMatchers([], vendorRules)).services.length;
  const newHit = subscriptionReport(claudeAll, mastered).services.length;
  console.log(
    oldHit === 0 && newHit === 1
      ? `ok   CLAUDE.AI 표기 ${claudeAll.length}건 ${fmt(claudeAmt)} — 옛 규칙은 놓치고 마스터는 잡음`
      : `FAIL CLAUDE.AI 매칭 (옛 ${oldHit} / 새 ${newHit})`,
  );
  if (!(oldHit === 0 && newHit === 1)) fails++;

  console.log("\n=== 2단계 · 공통비 배분 ===");
  const allocUnits = unitTotals(transactions, { basis: "accrual", isCard, month: "2026-07" });
  const netBefore = allocUnits.reduce((x, u) => x + u.net, 0);
  eq(netBefore, a.total.net, "사업부 순손익 합 = 전체 (배분 전)");

  const allocRules = FIN_ALLOCATIONS.map((r) => ({ ...r, id: r.name, active: true })) as FinAllocationDoc[];
  // 3번 규칙(인건비만)은 2번과 겹치므로 켜지 않는다 — 주석에 적힌 그대로
  const useRules = allocRules.filter((r) => !r.name.includes("인건비만"));
  const out = allocate({ transactions, units: allocUnits, rules: useRules, basis: "accrual", isCard, month: "2026-07" });
  console.log(`     적용 ${out.applied}개 규칙 · ${out.lines.length}줄 · ${fmt(out.lines.reduce((x, l) => x + l.amount, 0))} 이동`);
  out.warnings.forEach((w) => console.log("     ⚠", w));

  const netAfter = allocUnits.reduce((x, u) => x + u.net + (out.delta[u.key] ?? 0), 0);
  eq(netAfter, netBefore, "배분 후 총합 = 배분 전 총합 (배분은 총액을 만들지 않는다)");
  const givenSum = Object.values(out.given).reduce((x, v) => x + v, 0);
  const recvSum = Object.values(out.received).reduce((x, v) => x + v, 0);
  eq(givenSum, recvSum, "내보낸 합 = 받은 합 (반올림 잔차 없음)");

  // 규칙은 **비용만** 배분한다. 공용에 남는 것은 그 사업부의 수입이며
  // (예금이자·캐시백 등) 공통비가 아니므로 배분 대상이 아니다.
  const commons = allocUnits.filter((u) => u.bizMajor === "공용" || u.bizMinor === "홍대공용");
  const commonAfter = commons.reduce((x, u) => x + u.net + (out.delta[u.key] ?? 0), 0);
  const commonIncome = commons.reduce((x, u) => x + u.income, 0);
  eq(commonAfter, commonIncome, "공용·홍대공용에 비용 0 남음 (남은 건 수입뿐)");

  // 매출비율 드라이버의 한계: 이 달 수입이 0 인 사업부는 공통비를 한 푼도
  // 받지 않는다. 조용히 넘어가면 그 사업부가 실제보다 좋아 보이므로 밝힌다.
  const noRevenue = allocUnits.filter(
    (u) => u.count > 0 && u.income === 0 && u.bizMajor !== "공용" && u.bizMinor !== "홍대공용",
  );
  if (noRevenue.length > 0) {
    console.log(
      `     ⓘ 이 달 수입 0 이라 공통비를 받지 않은 사업부: ${noRevenue.map((u) => u.key).join(", ")}` +
        " — 매출비율 드라이버의 구조적 한계 (인원·사용량 드라이버가 필요하면 fixed 로)",
    );
  }

  console.log("     배분 후 사업부 손익:");
  allocUnits
    .filter((u) => u.count > 0)
    .sort((x, y) => y.net + (out.delta[y.key] ?? 0) - (x.net + (out.delta[x.key] ?? 0)))
    .forEach((u) => {
      const after = u.net + (out.delta[u.key] ?? 0);
      console.log(`       ${u.key.padEnd(14)} 배분전 ${fmt(u.net).padStart(13)} → 배분후 ${fmt(after).padStart(13)}`);
    });

  console.log(fails === 0 ? "\n✅ 전부 통과" : `\n❌ ${fails}건 실패`);
  process.exit(fails === 0 ? 0 : 1);
})();
