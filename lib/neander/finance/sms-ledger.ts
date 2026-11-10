// ============================================================
//  문자로 들어온 거래 → 장부 한 줄, 그리고 월말 엑셀과 짝 맞추기 (계산만)
// ------------------------------------------------------------
//  통장 · 카드 문자가 오면 그 자리에서 장부(neander_fin_transactions)에 한 줄을 만든다
//  (server/sms-ledger.ts). 분류는 엑셀을 올릴 때와 같은 엔진 — 확정이면 확정, 아니면 검토 대기함.
//  그래서 프로젝트 연결 · 계정 확정을 돈이 움직인 그때 할 수 있다.
//
//  문자로만 들어온 줄은 **잠정**이다 — smsOpen 이 붙는다. 은행 문자는 빠질 수 있고(폰이
//  꺼져 있었다 · 매크로가 놓쳤다), 문구가 엑셀과 조금 다를 수 있다. 월말 엑셀이 정본이다:
//    · 엑셀 한 줄이 들어올 때 아직 짝이 없는 문자 줄 중 같은 계좌 · 같은 날 · 같은 금액을 찾는다.
//      통장은 거래 후 잔액까지 같아야 한다 (잔액이 입금 · 출금 방향과 앞뒤 순서를 가른다).
//    · 짝이 맞으면 엑셀 줄을 새로 넣지 않고, 문자 줄에 엑셀의 거래처 · 시각 · 잔액 · 중복 키를
//      얹는다. 사람이 해 둔 분류 · 프로젝트 · 회차 연결은 그대로 둔다. smsOpen 이 빠진다.
//    · 짝이 없는 엑셀 줄 = 빠진 문자 → 평소처럼 새로 들어간다.
//    · 엑셀을 올린 뒤에도 smsOpen 이 남은 줄 = 엑셀에 없는 거래 → 사람이 본다.
//  임포트 퍼즐은 smsOpen 줄로 칸을 채우지 않는다 — 문자만 있다고 엑셀을 빠뜨리지 않게.
// ============================================================

import type { ClassifySuggestion } from "./classify";
import { engineSigOf } from "./relearn";
import type { SmsNotice } from "./sms-notify";
import { trustCellOf } from "./trust";
import type { FinTransactionInput, TxType } from "./types";

/** 문자 줄의 장부 문서 id — 같은 문자가 두 번 와도 한 줄 */
export const smsLedgerId = (inboxId: string) => `sms-${inboxId}`;

/** 문자 줄의 임시 중복 키 — 엑셀 줄과 겹칠 일이 없다. 짝이 맞으면 엑셀의 키로 바뀐다 */
export const smsDedupHash = (inboxId: string) => `sms¦${inboxId}`;

export type SmsLedgerInput = FinTransactionInput & { smsId: string; smsOpen: true };

/**
 * 알림 한 줄 + 엔진 결과 → 장부 한 줄.
 * 카드 취소는 카드사 엑셀처럼 「지출 · 음수 금액」으로 둔다 (엑셀과 짝이 맞게).
 */
export function smsLedgerInput(args: {
  inboxId: string;
  notice: SmsNotice;
  sug: ClassifySuggestion | null;
  /** 결제수단 마스터의 사업장 — 엔진이 안 정했을 때 */
  site?: string;
}): SmsLedgerInput {
  const { notice: n, sug } = args;
  const raw: TxType = n.channel === "card" ? "지출" : n.kind === "입금" ? "수입" : "지출";
  const txType = sug?.txType ?? raw;
  const date = n.at.slice(0, 10);
  const time = n.at.slice(11, 19);
  const cancel = n.channel === "card" && n.kind === "취소";
  const gross = cancel ? -n.amount : n.amount;
  const inst = n.channel === "card" && n.installment && n.installment !== "일시불" ? n.installment : undefined;
  const status = sug?.status ?? "needs_review";
  const row: Record<string, unknown> = {
    date,
    datetime: `${date} ${time}`,
    last4: n.last4,
    txType,
    bizMajor: sug?.bizMajor,
    bizMinor: sug?.bizMinor,
    acctMajor: sug?.acctMajor,
    acctMid: sug?.acctMid,
    acctMinor: sug?.acctMinor,
    vendor: n.party,
    gross,
    adjust: 0,
    site: sug?.site ?? args.site,
    note: inst,
    status,
    classReason: sug?.classReason ?? "문자로 들어온 거래 — 자동분류를 못 했습니다",
    ...(sug ? { engineSig: engineSigOf({ ...sug, txType }) } : {}),
    ...(sug?.basis ? { engineCell: trustCellOf(sug.basis) } : {}),
    dedupHash: smsDedupHash(args.inboxId),
    ...(n.channel === "inout" && n.balance !== undefined ? { balanceAfter: n.balance } : {}),
    smsId: args.inboxId,
    smsOpen: true,
  };
  return Object.fromEntries(Object.entries(row).filter(([, v]) => v !== undefined)) as unknown as SmsLedgerInput;
}

/** 짝 맞추기에 쓰는 문자 줄 */
export interface SmsOpenRow {
  id: string;
  date: string;
  datetime?: string;
  last4?: string;
  gross: number;
  adjust?: number;
  balanceAfter?: number;
  txType: TxType;
}

type ExcelRow = Pick<FinTransactionInput, "date" | "datetime" | "last4" | "gross" | "adjust" | "balanceAfter" | "txType">;

const dayDiff = (a: string, b: string) => Math.round(Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);
const minuteOf = (dt?: string) => {
  const m = dt?.match(/(\d{2}):(\d{2})/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : undefined;
};
/** 들어온 돈인가 나간 돈인가 — 자금거래는 유형만으로 모른다(null) */
const flowOf = (t: TxType): "in" | "out" | null =>
  t === "수입" || t === "환급" ? "in" : t === "지출" || t === "카드대금결제" ? "out" : null;

/**
 * 엑셀 한 줄의 짝이 될 문자 줄. 없으면 undefined.
 *  · 같은 계좌(끝자리) · 같은 금액(조정까지)
 *  · 같은 날 — 없으면 하루 앞뒤(자정 무렵 · 카드 승인일과 이용일 차이)는 후보가 하나일 때만
 *  · 둘 다 잔액이 있으면 잔액이 같아야 한다 (통장)
 *  · 잔액이 없으면 입금 · 출금 방향이 어긋나지 않아야 한다
 * 이미 짝지은 줄(used)은 다시 쓰지 않는다. 같은 조건이 여럿이면 시각이 가까운 것.
 */
export function matchSmsRow(row: ExcelRow, open: SmsOpenRow[], used: Set<string>): string | undefined {
  const fits = open.filter((s) => {
    if (used.has(s.id) || s.last4 !== row.last4) return false;
    if (Math.round(s.gross) !== Math.round(row.gross) || Math.round(s.adjust ?? 0) !== Math.round(row.adjust ?? 0)) return false;
    if (s.balanceAfter !== undefined && row.balanceAfter !== undefined) return Math.round(s.balanceAfter) === Math.round(row.balanceAfter);
    const a = flowOf(s.txType);
    const b = flowOf(row.txType);
    return !a || !b || a === b;
  });
  const sameDay = fits.filter((s) => s.date === row.date);
  const pool = sameDay.length ? sameDay : fits.filter((s) => dayDiff(s.date, row.date) <= 1);
  if (!pool.length || (!sameDay.length && pool.length > 1)) return undefined;
  const at = minuteOf(row.datetime);
  return [...pool].sort((x, y) => {
    const dx = at === undefined ? 0 : Math.abs((minuteOf(x.datetime) ?? at) - at);
    const dy = at === undefined ? 0 : Math.abs((minuteOf(y.datetime) ?? at) - at);
    return dx - dy || (x.datetime ?? "").localeCompare(y.datetime ?? "");
  })[0].id;
}
