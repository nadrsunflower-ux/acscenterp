// ============================================================
//  자금 일보 말풍선 — 표의 숫자 하나를 이루는 거래 · 통장 목록
// ------------------------------------------------------------
//  자금 일보(app/neander/finance/daily)의 입금 · 출금 · 잔액 · 카드 사용액에 커서를
//  올리면 그 숫자의 내역이 말풍선으로 뜬다. 여기는 그 목록만 만든다.
//
//  ⚠️ 목록의 합은 칸의 숫자와 원 단위로 같아야 한다. 그래서 거르는 규칙을
//     daily-cash.ts 의 줄 계산과 똑같이 둔다 (daily-cash-detail.test.ts 가 맞춰 본다).
//       · 문자 통장   buildDailyCash 의 기간 안 줄 (kind 로 입금 · 출금)
//       · 장부 통장   ledgerAccountRow — 계좌 끝자리 · 기간 · ledgerDirection · netAmount
//       · 문자 카드   smsCardRow — 승인은 +, 취소는 −
//       · 장부 카드   ledgerCardRow — 지출은 +, 환급은 −
// ============================================================

import { ledgerDirection, type CardTx, type DailyCashLine } from "./daily-cash";
import { netAmount, type FinTransaction } from "./types";

export interface DetailLine {
  key: string;
  /** 왼쪽 작은 칸 — 시각, 기간이면 날짜와 시각 */
  when?: string;
  /** 거래처 · 보낸 분 · 받는 분 · 통장 이름 */
  title: string;
  /** 둘째 줄 — 통장 · 계정 · 메모 */
  sub?: string;
  amount: number;
  flow?: "income" | "expense";
  /** 제목 옆 작은 꼬리표 (취소 · 환급) */
  tag?: string;
  /** 줄 아래 경고 (빠진 문자) */
  warn?: string;
}

export interface DetailOpts {
  /** 기간 보기 — 시각 앞에 날짜를 붙인다 */
  withDate?: boolean;
  /** 여러 통장이 섞인 목록 — 둘째 줄에 통장 이름을 붙인다 */
  account?: string;
}

const md = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
const join = (...parts: (string | undefined)[]) => parts.map((p) => p?.trim()).filter(Boolean).join(" · ") || undefined;
const won = (n: number) => `${n < 0 ? "-" : "+"}${Math.abs(n).toLocaleString("ko-KR")}원`;

/** 최근 것이 위 — 아래 「통장 거래 내역」 표와 같은 순서 */
const latestFirst = <T extends { order: string }>(list: T[]) => [...list].sort((a, b) => b.order.localeCompare(a.order));

/** 문자로 받은 통장 거래 — kind 하나만 */
export function smsFlowLines(lines: DailyCashLine[], kind: "입금" | "출금", opts: DetailOpts & { last4?: string } = {}): DetailLine[] {
  return latestFirst(lines.filter((l) => l.kind === kind && (!opts.last4 || l.last4 === opts.last4))).map((l) => ({
    key: l.id,
    when: opts.withDate ? `${md(l.date)} ${l.time}` : l.time,
    title: l.memo?.trim() || (kind === "입금" ? "(보낸 분 없음)" : "(받는 분 없음)"),
    sub: join(opts.account ?? (opts.last4 ? undefined : `${l.label} ${l.last4}`), l.balance !== undefined ? `잔액 ${l.balance.toLocaleString("ko-KR")}` : undefined),
    amount: l.amount,
    flow: kind === "입금" ? "income" : "expense",
    ...(l.gapBefore !== undefined ? { warn: `이 거래 앞에 문자가 빠진 것으로 보여요 — 잔액 차이 ${won(l.gapBefore)}` } : {}),
  }));
}

const ledgerKey = (t: FinTransaction) => `${t.date} ${(t as { datetime?: string }).datetime ?? ""} ${String(t.createdAt ?? 0).padStart(14, "0")}`;
const accountOf = (t: FinTransaction) => [t.acctMid, t.acctMinor].filter(Boolean).join(" › ") || undefined;

/** 장부(월 엑셀)로 센 통장 거래 — ledgerAccountRow 의 입금 · 출금과 같은 거르기 */
export function ledgerFlowLines(
  ledger: FinTransaction[],
  last4: string,
  from: string,
  to: string,
  dir: "in" | "out",
  opts: DetailOpts = {},
): DetailLine[] {
  const mine = ledger.filter((t) => String(t.last4 ?? "") === last4 && t.date >= from && t.date <= to && ledgerDirection(t) === dir);
  return latestFirst(mine.map((t) => ({ t, order: ledgerKey(t) }))).map(({ t }) => ({
    key: t.id,
    when: md(t.date),
    title: t.vendor?.trim() || "(거래처 없음)",
    sub: join(opts.account, accountOf(t)),
    amount: netAmount(t),
    flow: dir === "in" ? "income" : "expense",
  }));
}

/** 문자로 받은 카드 승인 · 취소 — smsCardRow 의 사용액과 같은 합 */
export function smsCardLines(txs: CardTx[], last4: string, from: string, to: string, opts: DetailOpts = {}): DetailLine[] {
  const mine = txs.filter((t) => t.last4 === last4 && t.date >= from && t.date <= to);
  return latestFirst(mine).map((t) => ({
    key: t.id,
    when: opts.withDate ? `${md(t.date)} ${t.time}` : t.time,
    title: t.merchant?.trim() || "(가맹점 없음)",
    sub: join(opts.account, t.holder, t.installment),
    amount: t.approval === "승인" ? t.amount : -t.amount,
    flow: "expense",
    ...(t.approval === "취소" ? { tag: "취소" } : {}),
  }));
}

/** 문자 카드 여러 장의 승인만 · 취소만 — 법인카드 요약 칸(cardStrip 의 승인 · 취소 합과 같다) */
export function smsCardKindLines(
  txs: CardTx[],
  last4s: string[],
  from: string,
  to: string,
  approval: "승인" | "취소",
  labelOf: (last4: string) => string,
  opts: DetailOpts = {},
): DetailLine[] {
  const cards = new Set(last4s);
  const mine = txs.filter((t) => cards.has(t.last4) && t.date >= from && t.date <= to && t.approval === approval);
  return latestFirst(mine).map((t) => ({
    key: t.id,
    when: opts.withDate ? `${md(t.date)} ${t.time}` : t.time,
    title: t.merchant?.trim() || "(가맹점 없음)",
    sub: join(`${labelOf(t.last4)} ${t.last4}`, t.holder, t.installment),
    amount: t.amount,
    flow: approval === "승인" ? "expense" : "income",
    ...(approval === "취소" ? { tag: "취소" } : {}),
  }));
}

/** 카드 기록(월 엑셀)의 사용 — ledgerCardRow 와 같이 지출은 +, 환급은 − */
export function ledgerCardLines(ledger: FinTransaction[], last4: string, from: string, to: string, opts: DetailOpts = {}): DetailLine[] {
  const mine = ledger.filter((t) => String(t.last4 ?? "") === last4 && t.date >= from && t.date <= to && (t.txType === "지출" || t.txType === "환급"));
  return latestFirst(mine.map((t) => ({ t, order: ledgerKey(t) }))).map(({ t }) => ({
    key: t.id,
    when: md(t.date),
    title: t.vendor?.trim() || "(가맹점 없음)",
    sub: join(opts.account, accountOf(t)),
    amount: t.txType === "환급" ? -netAmount(t) : netAmount(t),
    flow: "expense",
    ...(t.txType === "환급" ? { tag: "환급" } : {}),
  }));
}

/** 목록의 합 — 말풍선 맨 아래 합계 */
export const sumLines = (lines: DetailLine[]) => lines.reduce((s, l) => s + l.amount, 0);
