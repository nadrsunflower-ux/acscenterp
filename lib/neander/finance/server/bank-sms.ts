// ============================================================
//  은행 입출금 문자 → 받은 편지함 (서버 전용)
// ------------------------------------------------------------
//  api/neander/finance/sms 가 부른다. 문자 원문을 그대로 남기고 읽은 값을 붙인다.
//  장부(neander_fin_transactions)에는 넣지 않는다 — 4주 시험 동안은 잠정 자료다.
//
//  · 같은 문자가 두 번 와도 한 건이다 — 문서 id 를 「보낸 번호 + 원문」 해시로 둔다
//    (매크로드로이드가 다시 보내거나 문자 앱이 두 번 알려도 겹치지 않는다).
//  · 열쇠(토큰)는 코드 · 환경변수에 두지 않고 Firestore 설정에 **해시만** 둔다
//    (neander_fin_settings/sms-feed.tokenHash). 새 열쇠는 그 칸만 바꾸면 된다.
// ============================================================

import { createHash, timingSafeEqual } from "crypto";
import type { Firestore } from "firebase-admin/firestore";
import { NEANDER_COL } from "@/lib/neander/collections";
import { BANK_SMS_PARSER, parseBankSms, type BankSmsParsed } from "../bank-sms";

const SETTINGS_DOC = "sms-feed";
const MAX_TEXT = 2000;

export const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

/** 요청의 열쇠가 설정에 저장된 해시와 같은가 */
export async function smsTokenOk(db: Firestore, token: string): Promise<boolean> {
  if (!token) return false;
  const snap = await db.collection(NEANDER_COL.finSettings).doc(SETTINGS_DOC).get();
  const want = snap.exists ? String(snap.get("tokenHash") ?? "") : "";
  if (!want || snap.get("enabled") === false) return false;
  const a = Buffer.from(sha256(token), "hex");
  const b = Buffer.from(want, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface SmsInboxDoc {
  /** 보낸 번호 (은행 대표번호) */
  from: string;
  /** 문자 원문 */
  text: string;
  /** 전용폰이 받은 때 (폰이 보낸 값 — 없으면 서버가 받은 때) */
  receivedAt: number;
  /** 서버가 받은 때 */
  createdAt: number;
  parsed: BankSmsParsed;
  parsedWith: number;
  /** 같은 문자를 몇 번 받았나 */
  hits: number;
}

/** 문자 한 통을 남긴다. 이미 있으면 받은 횟수만 올린다 */
export async function saveBankSms(
  db: Firestore,
  input: { from?: string; text?: string; receivedAt?: number },
): Promise<{ id: string; duplicate: boolean; parsed: BankSmsParsed } | { error: string }> {
  const text = (input.text ?? "").trim();
  if (!text) return { error: "문자 내용이 비어 있습니다." };
  if (text.length > MAX_TEXT) return { error: "문자가 너무 깁니다." };
  const from = (input.from ?? "").replace(/[^\d+]/g, "").slice(0, 20);
  const id = sha256(`${from}¦${text}`).slice(0, 40);
  const now = Date.now();
  const ref = db.collection(NEANDER_COL.finSmsInbox).doc(id);
  const parsed = parseBankSms(text);
  const duplicate = await db.runTransaction(async (tx) => {
    const cur = await tx.get(ref);
    if (cur.exists) {
      tx.update(ref, { hits: (Number(cur.get("hits")) || 1) + 1, lastHitAt: now });
      return true;
    }
    const receivedAt = Number.isFinite(input.receivedAt) && input.receivedAt! > 0 ? input.receivedAt! : now;
    const doc: SmsInboxDoc = { from, text, receivedAt, createdAt: now, parsed, parsedWith: BANK_SMS_PARSER, hits: 1 };
    tx.set(ref, doc);
    return false;
  });
  return { id, duplicate, parsed };
}
