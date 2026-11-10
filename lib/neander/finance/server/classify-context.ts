// ============================================================
//  서버에서 자동분류 엔진 준비 — 장부 이력 · 규칙 · 믿을 범위 · 프로젝트 (서버 전용)
// ------------------------------------------------------------
//  엑셀 임포트는 화면이 엔진을 돌리지만, 문자로 들어온 거래(server/sms-notify.ts)와 폰 확인
//  화면(api/neander/finance/tx-card)은 서버에서 돌린다. 장부 이력은 18개월만 — 엔진은
//  거래처마다 최근 12건을 본다. 문자가 몰려 오거나 폰 화면을 연달아 열 때 장부를 매번 다시
//  읽지 않게 10분 기억한다 (서버 인스턴스가 살아 있는 동안).
// ============================================================

import "server-only";

import type { Firestore, QuerySnapshot } from "firebase-admin/firestore";
import { NEANDER_COL } from "@/lib/neander/collections";
import { buildVendorIndex, type ClassifyContext } from "../classify";
import type { FinClassRuleDoc } from "../class-rules";
import type { FinAccountDoc, FinPaymentMethodDoc, FinVendorRuleDoc } from "../db-types";
import type { FinProjectDoc } from "../project";
import { TRUST_DOC_ID, trustGateOf, type FinTrustDoc } from "../trust";
import type { FinTransaction } from "../types";

const HISTORY_DAYS = 548;
const TTL_MS = 10 * 60_000;

export interface ClassifyData {
  engine: ClassifyContext;
  projects: FinProjectDoc[];
  accounts: FinAccountDoc[];
  /** 사업소분류 → 가장 많이 쓰인 사업대분류 (장부에 쓰인 조합이 곧 후보 — 검토 대기함과 같다) */
  bizMajorOf: Map<string, string>;
  at: number;
}

let cache: ClassifyData | null = null;

const rows = <T,>(snap: QuerySnapshot) => snap.docs.map((d) => ({ id: d.id, ...d.data() }) as T);

export async function classifyData(db: Firestore, paymentMethods?: FinPaymentMethodDoc[]): Promise<ClassifyData> {
  if (cache && Date.now() - cache.at < TTL_MS) {
    return paymentMethods ? { ...cache, engine: { ...cache.engine, paymentMethods } } : cache;
  }
  const since = new Date(Date.now() + 9 * 3600_000 - HISTORY_DAYS * 86_400_000).toISOString().slice(0, 10);
  const [tx, ac, vr, cr, trust, pj, pm] = await Promise.all([
    db.collection(NEANDER_COL.finTransactions).where("date", ">=", since).get(),
    db.collection(NEANDER_COL.finAccounts).get(),
    db.collection(NEANDER_COL.finVendorRules).get(),
    db.collection(NEANDER_COL.finClassRules).get(),
    db.collection(NEANDER_COL.finSettings).doc(TRUST_DOC_ID).get(),
    db.collection(NEANDER_COL.finProjects).get(),
    paymentMethods ? Promise.resolve(null) : db.collection(NEANDER_COL.finPaymentMethods).get(),
  ]);
  const history = rows<FinTransaction>(tx);
  const accounts = rows<FinAccountDoc>(ac);
  const count = new Map<string, Map<string, number>>();
  history.forEach((t) => {
    if (!t.bizMajor || !t.bizMinor) return;
    const m = count.get(t.bizMinor) ?? new Map<string, number>();
    m.set(t.bizMajor, (m.get(t.bizMajor) ?? 0) + 1);
    count.set(t.bizMinor, m);
  });
  const bizMajorOf = new Map([...count].map(([minor, m]) => [minor, [...m.entries()].sort((a, b) => b[1] - a[1])[0][0]]));
  cache = {
    engine: {
      vendorIndex: buildVendorIndex(history),
      vendorRules: rows<FinVendorRuleDoc>(vr),
      paymentMethods: paymentMethods ?? rows<FinPaymentMethodDoc>(pm!),
      accounts,
      classRules: rows<FinClassRuleDoc>(cr),
      trust: trustGateOf(trust.exists ? ({ id: trust.id, ...trust.data() } as FinTrustDoc) : null),
    },
    projects: rows<FinProjectDoc>(pj),
    accounts,
    bizMajorOf,
    at: Date.now(),
  };
  return cache;
}

/** 프로젝트 문서가 바뀐 직후(회차 받음 처리)에는 다음 요청이 새로 읽게 */
export function forgetClassifyData() {
  cache = null;
}
