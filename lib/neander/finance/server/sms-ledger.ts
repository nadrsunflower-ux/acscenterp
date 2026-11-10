// ============================================================
//  문자로 들어온 거래 → 장부에 바로 한 줄 (서버 전용) — 계산은 ../sms-ledger.ts
// ------------------------------------------------------------
//  server/sms-notify.ts 가 분류한 직후 부른다. ERP 에 있는 통장 · 카드(결제수단 마스터)의
//  문자만 넣는다 — 모르는 끝자리는 노션 알림만 간다.
//  문서 id 가 받은 문자 id 에서 나오므로(sms-…) 같은 문자가 두 번 와도 한 줄이다.
//  화면은 증분 동기화(createdAt)로 새 줄을 받아 간다.
// ============================================================

import "server-only";

import type { Firestore } from "firebase-admin/firestore";
import { NEANDER_COL } from "@/lib/neander/collections";
import type { ClassifySuggestion } from "../classify";
import type { FinPaymentMethodDoc } from "../db-types";
import { smsLedgerId, smsLedgerInput } from "../sms-ledger";
import type { SmsNotice } from "../sms-notify";

export type SmsLedgerOutcome = { id: string; created: boolean } | { skipped: string };

export async function postSmsToLedger(
  db: Firestore,
  args: { inboxId: string; notice: SmsNotice; sug: ClassifySuggestion | null; paymentMethods: FinPaymentMethodDoc[] },
): Promise<SmsLedgerOutcome> {
  const { notice: n } = args;
  const kind = n.channel === "card" ? "card" : "account";
  const pm = args.paymentMethods.find((p) => p.last4 === n.last4 && p.kind === kind);
  if (!pm) return { skipped: `ERP 에 없는 ${kind === "card" ? "카드" : "통장"} (${n.last4})` };
  const id = smsLedgerId(args.inboxId);
  const ref = db.collection(NEANDER_COL.finTransactions).doc(id);
  const now = Date.now();
  const input = smsLedgerInput({ inboxId: args.inboxId, notice: n, sug: args.sug, site: pm.site });
  try {
    await ref.create({ ...input, createdAt: now, updatedAt: now, updatedBy: "sms" });
  } catch (e) {
    // 이미 있다 (같은 문자가 다시 왔거나 다시 보내기) — 사람이 고쳤을 수 있으니 덮지 않는다
    if ((e as { code?: number }).code === 6) return { id, created: false };
    throw e;
  }
  await db.collection(NEANDER_COL.finSmsInbox).doc(args.inboxId).update({ ledgerId: id });
  return { id, created: true };
}
