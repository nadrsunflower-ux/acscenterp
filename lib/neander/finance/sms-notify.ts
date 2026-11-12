// ============================================================
//  받은 은행 · 카드 문자 → 노션 알림 한 줄 (문구 · 칸 값만 — 노션 요청은 server/sms-notify.ts)
// ------------------------------------------------------------
//  노션 「재무알림」 아래 두 표로 나눈다.
//    · 입출금알림 — 통장 입금 · 출금 (은행 문자)
//    · 카드사용알림 — 법인카드 승인 · 취소 (카드 문자)
//  한 건이 한 줄이고, 그 줄에 받는 사람을 @멘션한 댓글을 달아 폰 알림이 가게 한다.
//  노션 알림에는 줄 이름과 댓글이 같이 보인다 — 겹치지 않게 나눈다(사용자 요청: 핵심만).
//    줄 이름 = 누구 · 어디서 (상대 · 가맹점)      댓글 = 입금/출금 · 금액 · 통장(카드) · 잔액
//  이모지 · 시각(알림에 시각이 붙는다)은 알림에서 뺀다.
//  카드 문자 속 잔액도 댓글 끝에 붙인다(사용자 요청 2026-11-12). 신한 법인카드는 모든 신한
//  법인카드가 같이 쓰는 남은 한도이고, 국민카드 문자에는 잔액이 없어 안 붙는다.
// ============================================================

import type { BankSmsParsed } from "./bank-sms";
import { smsToCardTx, smsToTx } from "./daily-cash";

export type SmsNoticeChannel = "inout" | "card";

export interface SmsNotice {
  channel: SmsNoticeChannel;
  /** 받은 문자함 문서 id — 노션 줄의 「열쇠」 */
  key: string;
  /** 노션 줄 이름 */
  title: string;
  /** 멘션 뒤에 붙는 댓글 글 (폰 알림 미리보기) */
  message: string;
  /** 문자 속 시각 — 2026-11-10T15:57:00+09:00 */
  at: string;
  /** 입금 · 출금 · 승인 · 취소 */
  kind: "입금" | "출금" | "승인" | "취소";
  amount: number;
  /** 통장 · 카드 이름 + 끝자리 (표의 칸) */
  where: string;
  /** 통장 · 카드 끝자리 (가린 카드 번호는 맞춘 뒤) — 자동분류가 이력을 찾는 열쇠 */
  last4: string;
  /** 통장 잔액 · 카드 문자 속 잔액 */
  balance?: number;
  /** 보낸 분 · 받는 분 · 가맹점 */
  party?: string;
  installment?: string;
}

const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;

/**
 * 문자 한 통 → 알림 한 줄. 거래로 못 읽은 문자(인증번호 · 안내 · 광고)는 null.
 * nameOf: 끝자리 → ERP 의 통장 · 카드 이름(별칭). resolveCard: 가린 카드 끝자리(「3*0*」) → 실제 끝자리
 */
export function smsNotice(
  doc: { id: string; receivedAt?: number; createdAt?: number; parsed?: BankSmsParsed },
  nameOf: (kind: "account" | "card", last4: string) => string | undefined,
  resolveCard: (last4: string) => string = (x) => x,
): SmsNotice | null {
  const card = smsToCardTx(doc);
  if (card) {
    const last4 = resolveCard(card.last4);
    const alias = nameOf("card", last4);
    const where = `${alias ?? card.company ?? "카드"} ${last4}`;
    const cancel = card.approval === "취소";
    const party = card.merchant || undefined;
    const inst = card.installment && card.installment !== "일시불" ? card.installment : undefined;
    return {
      channel: "card",
      key: doc.id,
      title: party ?? "가맹점 모름",
      message: [
        `${cancel ? "취소 " : ""}${won(card.amount)}`,
        alias ?? where,
        inst,
        card.remaining !== undefined ? `잔액 ${won(card.remaining)}` : undefined,
      ]
        .filter(Boolean)
        .join(" · "),
      at: `${card.date}T${card.time}:00+09:00`,
      kind: card.approval,
      amount: card.amount,
      where,
      last4,
      ...(card.remaining !== undefined ? { balance: card.remaining } : {}),
      ...(party ? { party } : {}),
      ...(card.installment ? { installment: card.installment } : {}),
    };
  }
  const tx = smsToTx(doc);
  if (!tx || !tx.kind) return null;
  const alias = nameOf("account", tx.last4);
  const where = `${alias ?? tx.bank ?? "통장"} ${tx.last4}`;
  const party = tx.memo || undefined;
  return {
    channel: "inout",
    key: doc.id,
    title: party ?? where,
    message: [`${tx.kind} ${won(tx.amount)}`, alias ?? where, tx.balance !== undefined ? `잔액 ${won(tx.balance)}` : undefined]
      .filter(Boolean)
      .join(" · "),
    at: `${tx.date}T${tx.time}:00+09:00`,
    kind: tx.kind,
    amount: tx.amount,
    where,
    last4: tx.last4,
    ...(tx.balance !== undefined ? { balance: tx.balance } : {}),
    ...(party ? { party } : {}),
  };
}

/** 이 금액 아래면 줄만 남기고 폰 알림(멘션 댓글)은 보내지 않는다 — 설정 minAmount, 0 이면 전부 */
export const shouldPing = (n: SmsNotice, minAmount: number) => n.amount >= Math.max(0, minAmount || 0);
