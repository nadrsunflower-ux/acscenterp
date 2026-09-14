// ============================================================
//  재무 월별 적재 퍼즐 — 한 달은 계좌마다 한 파일, 카드사마다 한 파일
// ------------------------------------------------------------
//  은행 거래내역은 **계좌 하나가 파일 하나**다 (신한 3개·우리 2개·국민·
//  토스·카카오 2개 …). 법인카드는 카드사가 **모든 카드를 한 파일**에 담아
//  주므로 신한카드·국민카드 두 칸이면 된다. 칸은 마스터의 계좌·카드에서
//  만든다 — 계좌를 더하면 칸이 는다.
//
//  어느 칸인지는 파일명이 아니라 **내용**으로 정한다:
//    · 양식      열 이름으로 은행·카드사를 안다 (adapters/*.detect)
//    · 계좌      파일 위쪽 「계좌번호 : …」 (국민·우리·토스·카카오)
//    · 신한      파일 안에 계좌번호가 없다 → ① 지난달 마지막 잔액과 이어지는
//                계좌, ② 거래처 이력이 겹치는 계좌 순으로 가려내고, 둘 다
//                애매하면 사람이 고른다
//    · 카드      줄마다 카드번호 뒷자리 — 카드사 칸 하나로 모인다
// ============================================================

import type { ParseFileResult } from "./adapters";
import type { ImportRow } from "./adapters/types";
import { normVendor } from "./classify";
import type { FinPaymentMethodDoc } from "./db-types";
import type { FinBankId } from "./master-data";
import type { FinImportBatch, FinTransaction } from "./types";

export type { FinBankId };

export interface FinBank {
  id: FinBankId;
  label: string;
  /** 칸 머리에 쓰는 짧은 이름 */
  short: string;
  adapterId: string;
  kind: "account" | "card";
  /** 뱃지 색 — 그 회사 브랜드 색에 가깝게 */
  color: string;
  /** 암호가 걸려 오는 파일 */
  encrypted?: boolean;
  /** 파일 안에 계좌번호가 없다 */
  noAccountInFile?: boolean;
  /** 어디서 내려받는지 */
  source: string;
}

export const FIN_BANKS: FinBank[] = [
  { id: "shinhan", label: "신한은행", short: "신한", adapterId: "shinhan-bank", kind: "account", color: "#0046ff", noAccountInFile: true, source: "신한 기업뱅킹 › 거래내역조회 › 엑셀" },
  { id: "kb", label: "국민은행", short: "국민", adapterId: "kb-bank", kind: "account", color: "#c8a23a", source: "KB스타기업뱅킹 › 거래내역조회 › 엑셀" },
  { id: "woori", label: "우리은행", short: "우리", adapterId: "woori-bank", kind: "account", color: "#0067ac", source: "우리WON기업 › 거래내역조회 › 엑셀" },
  { id: "toss", label: "토스뱅크", short: "토스", adapterId: "toss-bank", kind: "account", color: "#0064ff", encrypted: true, source: "토스뱅크 앱 › 거래내역 내보내기" },
  { id: "kakao", label: "카카오뱅크", short: "카카오", adapterId: "kakao-bank", kind: "account", color: "#b8a300", encrypted: true, source: "카카오뱅크 앱 › 거래내역 내보내기" },
  { id: "shinhan-card", label: "신한 법인카드", short: "신한카드", adapterId: "shinhan-card", kind: "card", color: "#0046ff", source: "신한카드 기업 › 법인이용내역(전체)" },
  { id: "kb-card", label: "국민 법인카드", short: "국민카드", adapterId: "kb-card", kind: "card", color: "#c8a23a", source: "KB국민카드 기업 › 승인내역조회" },
];

export const bankById = (id: FinBankId | undefined) => FIN_BANKS.find((b) => b.id === id);
export const bankByAdapter = (adapterId: string) => FIN_BANKS.find((b) => b.adapterId === adapterId);

/**
 * 이 계좌·카드가 어느 은행·카드사 것인가.
 * 마스터에 적혀 있으면 그것을, 없으면 별칭 앞머리로 — 신한지원·(신법)이동주.
 */
export function bankOfMethod(pm: Pick<FinPaymentMethodDoc, "alias" | "kind" | "bank">): FinBankId | undefined {
  if (pm.bank) return pm.bank;
  const a = pm.alias ?? "";
  if (pm.kind === "card") {
    if (a.startsWith("(신법)")) return "shinhan-card";
    if (a.startsWith("(국법)")) return "kb-card";
    return undefined;
  }
  if (pm.kind !== "account") return undefined;
  if (a.startsWith("신한")) return "shinhan";
  if (a.startsWith("국민")) return "kb";
  if (a.startsWith("우리")) return "woori";
  if (a.startsWith("토스")) return "toss";
  if (a.startsWith("카카오")) return "kakao";
  return undefined;
}

/** 매달 파일을 올리는 계좌인가 — 마스터 값이 없으면 「통장 · 대출 아님 · 은행을 앎」 */
export function isMonthlyAccount(pm: Pick<FinPaymentMethodDoc, "alias" | "kind" | "bank" | "monthly">): boolean {
  if (pm.monthly !== undefined && pm.monthly !== null) return pm.monthly;
  return pm.kind === "account" && !!bankOfMethod(pm) && !/대출/.test(pm.alias ?? "");
}

// ============================================================
//  칸
// ============================================================

export interface FinImportSlot {
  /** `account:4223` · `card:shinhan-card` */
  key: string;
  kind: "account" | "card";
  bank: FinBank;
  /** 별칭 (계좌) · 카드사 이름 (카드) */
  label: string;
  /** 사업장 (계좌) · 카드 장수 (카드) */
  sub: string;
  /** 이 칸이 품는 뒷자리들 — 카드는 그 카드사의 카드 전부 */
  last4s: string[];
}

const BANK_ORDER: FinBankId[] = ["shinhan", "kb", "woori", "toss", "kakao", "shinhan-card", "kb-card"];

/** 마스터에서 칸을 만든다 — 은행 순, 같은 은행 안에서는 뒷자리 순 */
export function buildFinSlots(paymentMethods: FinPaymentMethodDoc[]): FinImportSlot[] {
  const accounts: FinImportSlot[] = [];
  const cardsByIssuer = new Map<FinBankId, string[]>();

  paymentMethods.forEach((pm) => {
    const bankId = bankOfMethod(pm);
    const bank = bankById(bankId);
    if (!bank) return;
    if (pm.kind === "card") {
      cardsByIssuer.set(bank.id, [...(cardsByIssuer.get(bank.id) ?? []), pm.last4]);
      return;
    }
    if (!isMonthlyAccount(pm)) return;
    accounts.push({
      key: `account:${pm.last4}`,
      kind: "account",
      bank,
      label: pm.alias,
      sub: pm.site,
      last4s: [pm.last4],
    });
  });

  accounts.sort(
    (a, b) =>
      BANK_ORDER.indexOf(a.bank.id) - BANK_ORDER.indexOf(b.bank.id) ||
      a.last4s[0].localeCompare(b.last4s[0]),
  );

  const cards: FinImportSlot[] = [...cardsByIssuer.entries()]
    .sort((a, b) => BANK_ORDER.indexOf(a[0]) - BANK_ORDER.indexOf(b[0]))
    .map(([id, last4s]) => {
      const bank = bankById(id)!;
      return {
        key: `card:${id}`,
        kind: "card",
        bank,
        label: bank.label,
        sub: `카드 ${last4s.length}장 한 파일`,
        last4s: [...last4s].sort(),
      };
    });

  return [...accounts, ...cards];
}

// ============================================================
//  칸의 상태 — 배치가 있으면 그 파일, 없어도 장부에 그 달 거래가 있으면 채워진 것
// ============================================================

export interface FinSlotStatus {
  slot: FinImportSlot;
  /** 이 달 이 칸의 배치 (새 방식으로 적재한 것만) */
  batch?: FinImportBatch;
  /** 이 달 장부에 있는 이 칸의 거래 수 */
  count: number;
  /**
   * 방향을 나눠 센다. 수입과 지출을 한 숫자로 더하면 뜻이 없어진다 —
   * gross 는 늘 양수라 「순금액」이 아니라 그냥 절대값의 합이 된다.
   * 자금거래·카드대금결제는 손익이 아니므로(aggregate.plOnly) 건수만 센다.
   */
  income: number;
  expense: number;
  otherCount: number;
  /** 분류 상태별 건수 — 검토가 얼마나 남았는지 */
  confirmed: number;
  suggested: number;
  needsReview: number;
  filled: boolean;
}

/** 거래 묶음의 수입·지출 합 (환급은 지출을 깎는다) */
export function splitAmounts(rows: Pick<FinTransaction, "txType" | "gross" | "adjust">[]) {
  let income = 0;
  let expense = 0;
  let otherCount = 0;
  rows.forEach((t) => {
    const net = (t.gross || 0) - (t.adjust || 0);
    if (t.txType === "수입") income += net;
    else if (t.txType === "지출") expense += net;
    else if (t.txType === "환급") expense -= net;
    else otherCount += 1;
  });
  return { income, expense, otherCount };
}

const monthOfDate = (d?: string) => (d ?? "").slice(0, 7);

/** 한 달의 칸 상태 전부 + 퍼즐 완성도 */
export function finPuzzleOf(
  slots: FinImportSlot[],
  month: string,
  transactions: FinTransaction[],
  imports: FinImportBatch[],
) {
  const byLast4 = new Map<string, FinTransaction[]>();
  transactions.forEach((t) => {
    if (!t.last4 || monthOfDate(t.date) !== month) return;
    byLast4.set(t.last4, [...(byLast4.get(t.last4) ?? []), t]);
  });

  const pieces: FinSlotStatus[] = slots.map((slot) => {
    const batch = imports.find((b) => b.month === month && b.slotKey === slot.key);
    const rows = slot.last4s.flatMap((l4) => byLast4.get(l4) ?? []);
    let confirmed = 0;
    let suggested = 0;
    let needsReview = 0;
    rows.forEach((t) => {
      if (t.status === "confirmed") confirmed += 1;
      else if (t.status === "suggested") suggested += 1;
      else needsReview += 1;
    });
    return {
      slot,
      batch,
      count: rows.length,
      ...splitAmounts(rows),
      confirmed,
      suggested,
      needsReview,
      filled: !!batch || rows.length > 0,
    };
  });
  const filled = pieces.filter((p) => p.filled).length;
  return { pieces, filled, total: slots.length, complete: slots.length > 0 && filled === slots.length };
}

// ============================================================
//  파일 → 칸
// ============================================================

/** 파일이 담은 달 — 모든 줄이 한 달 안에 있어야 한다. 아니면 null */
export function monthOfRows(rows: Pick<ImportRow, "date">[]): { month: string; from: string; to: string } | null {
  const dates = rows.map((r) => r.date).filter(Boolean).sort();
  if (dates.length === 0) return null;
  const from = dates[0];
  const to = dates[dates.length - 1];
  if (monthOfDate(from) !== monthOfDate(to)) return null;
  return { month: monthOfDate(from), from, to };
}

export interface AccountGuess {
  slot: FinImportSlot;
  /** 왜 이 계좌라고 봤는가 */
  reason: string;
  /** 거래처 겹침 비율 (0~1) — 후보 목록에 같이 보여준다 */
  overlap: number;
  /** 잔액이 이어졌는가 */
  balanceMatch: boolean;
}

/**
 * 계좌번호 없는 파일이 어느 계좌인지.
 *
 *   ① 잔액 — 이 파일 첫 거래의 거래전 잔액이 어느 계좌의 마지막 잔액과 같은가.
 *      맞으면 확실하다 (한 계좌에서만 맞을 때).
 *   ② 거래처 — 파일의 거래처들이 최근 넉 달 그 계좌 이력에 얼마나 나오는가.
 *      1등이 40% 이상이고 2등의 2.5배가 넘으면 그 계좌로 본다.
 *      (실측 2026-07: 입금 통장 파일 71% vs 10%, 급여 통장 파일 65% vs 14%)
 *
 * 둘 다 애매하면 후보 목록만 돌려준다 — 사람이 고른다.
 */
export function guessAccount(
  rows: ImportRow[],
  candidates: FinImportSlot[],
  transactions: FinTransaction[],
): { sure?: AccountGuess; ranked: AccountGuess[] } {
  if (candidates.length === 0) return { ranked: [] };
  const sorted = [...rows].sort((a, b) => (a.datetime ?? a.date).localeCompare(b.datetime ?? b.date));
  const first = sorted[0];
  const fileFrom = first?.date ?? "";

  // ① 잔액
  const opening = first?.balanceBefore;
  const balanceHits = new Set<string>();
  if (opening !== undefined && fileFrom) {
    candidates.forEach((c) => {
      const prev = transactions
        .filter((t) => c.last4s.includes(t.last4 ?? "") && t.balanceAfter !== undefined && t.date < fileFrom)
        .sort((a, b) => (b.datetime ?? b.date).localeCompare(a.datetime ?? a.date))[0];
      if (prev && Math.round(prev.balanceAfter!) === Math.round(opening)) balanceHits.add(c.key);
    });
  }

  // ② 거래처 겹침 — 최근 넉 달
  const since = addMonths(fileFrom || new Date().toISOString().slice(0, 10), -4);
  const vendorsInFile = new Set(rows.map((r) => normVendor(r.vendor)).filter(Boolean));
  const ranked: AccountGuess[] = candidates.map((c) => {
    const hist = new Set(
      transactions
        .filter((t) => c.last4s.includes(t.last4 ?? "") && t.date >= since && t.date < (fileFrom || "9999"))
        .map((t) => normVendor(t.vendor))
        .filter(Boolean),
    );
    let hit = 0;
    vendorsInFile.forEach((v) => {
      if (hist.has(v)) hit += 1;
    });
    const overlap = vendorsInFile.size ? hit / vendorsInFile.size : 0;
    const balanceMatch = balanceHits.has(c.key);
    return {
      slot: c,
      overlap,
      balanceMatch,
      reason: balanceMatch
        ? "지난달 마지막 잔액과 이어집니다"
        : hist.size === 0
          ? "이 계좌는 최근 이력이 없습니다"
          : `거래처 ${hit}/${vendorsInFile.size}개가 이 계좌 이력에 있습니다`,
    };
  });
  ranked.sort((a, b) => Number(b.balanceMatch) - Number(a.balanceMatch) || b.overlap - a.overlap);

  if (balanceHits.size === 1) {
    return { sure: ranked.find((g) => g.balanceMatch), ranked };
  }
  const [top, second] = ranked;
  if (top && top.overlap >= 0.4 && (!second || top.overlap >= second.overlap * 2.5)) {
    return { sure: top, ranked };
  }
  return { ranked };
}

function addMonths(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1 + n, d || 1));
  return dt.toISOString().slice(0, 10);
}

export type SlotResolution =
  /** 이 칸이다 */
  | { kind: "slot"; slot: FinImportSlot; reason?: string }
  /** 이 은행의 계좌 중 하나인데 어느 것인지 모른다 */
  | { kind: "ambiguous"; bank: FinBank; ranked: AccountGuess[] }
  /** 칸이 없다 (마스터에 없는 계좌·카드사) */
  | { kind: "none"; message: string };

/** 파싱 결과가 어느 칸에 들어가는가 */
export function resolveFinSlot(
  result: ParseFileResult,
  slots: FinImportSlot[],
  transactions: FinTransaction[],
): SlotResolution {
  const bank = bankByAdapter(result.adapterId);
  if (!bank) {
    return { kind: "none", message: `「${result.adapterLabel}」 양식은 월별 칸이 없습니다. 통합거래장 형식은 CLI(npm run finance:import)로 적재합니다.` };
  }

  if (bank.kind === "card") {
    const slot = slots.find((s) => s.key === `card:${bank.id}`);
    if (!slot) return { kind: "none", message: `마스터에 ${bank.label} 카드가 없습니다. 마스터 › 계좌·카드에 먼저 등록하세요.` };
    return { kind: "slot", slot };
  }

  const detected = result.detectedLast4[0];
  if (detected) {
    const slot = slots.find((s) => s.kind === "account" && s.last4s.includes(detected));
    if (slot) return { kind: "slot", slot };
    return {
      kind: "none",
      message: `${bank.label} ···${detected} 계좌는 월별 적재 칸이 아닙니다. 마스터 › 계좌·카드에서 등록하거나 「월별 적재」를 켜세요.`,
    };
  }

  const candidates = slots.filter((s) => s.kind === "account" && s.bank.id === bank.id);
  if (candidates.length === 0) {
    return { kind: "none", message: `마스터에 ${bank.label} 계좌가 없습니다.` };
  }
  if (candidates.length === 1) {
    return { kind: "slot", slot: candidates[0], reason: `${bank.label} 계좌가 하나뿐입니다` };
  }
  const guess = guessAccount(result.rows, candidates, transactions);
  if (guess.sure) return { kind: "slot", slot: guess.sure.slot, reason: guess.sure.reason };
  return { kind: "ambiguous", bank, ranked: guess.ranked };
}
