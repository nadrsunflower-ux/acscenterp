// ============================================================
//  어댑터 공통 유틸
// ------------------------------------------------------------
//  은행·카드 엑셀에서 반복되는 것들: 헤더 행 찾기, 날짜·금액 파싱,
//  마스킹된 카드번호에서 뒷 4자리 꺼내기, 카드대금결제·자금거래 판정.
// ============================================================

import * as XLSX from "xlsx";
import type { WorkBook, WorkSheet } from "xlsx";
import { dedupHashOf, type TxType } from "../types";
import type { ClassifyHint, ImportRow } from "./types";

// ---- 셀 읽기 --------------------------------------------------

export function sheetRange(ws: WorkSheet) {
  return XLSX.utils.decode_range(ws["!ref"] ?? "A1:A1");
}

export function cellAt(ws: WorkSheet, r: number, c: number): unknown {
  const cell = ws[XLSX.utils.encode_cell({ r, c })];
  if (!cell) return undefined;
  return cell.w ?? cell.v;
}

export const str = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString();
  return String(v).trim();
};

/**
 * 헤더 행을 찾는다. 은행 엑셀은 위쪽에 계좌 요약이 몇 줄 있어서 헤더가
 * 1행이 아니다(국민은행 7행, 토스 9행, 카카오 11행).
 */
export function findHeaderRow(
  ws: WorkSheet,
  required: string[],
  maxScan = 30,
): { row: number; cols: Record<string, number> } | null {
  const range = sheetRange(ws);
  const limit = Math.min(range.e.r, range.s.r + maxScan);
  for (let r = range.s.r; r <= limit; r++) {
    const labels: Record<string, number> = {};
    for (let c = range.s.c; c <= range.e.c; c++) {
      const v = str(cellAt(ws, r, c));
      if (v) labels[normalizeLabel(v)] = c;
    }
    const hit = required.every((k) => labels[normalizeLabel(k)] !== undefined);
    if (hit) return { row: r, cols: labels };
  }
  return null;
}

/** 열 이름 비교용 정규화 — 「거래 일시」와 「거래일시」를 같게 본다 */
export const normalizeLabel = (s: string) => s.replace(/\s+/g, "").replace(/\(.*?\)/g, "");

/** 별칭 목록 중 처음 맞는 열 번호 */
export function col(cols: Record<string, number>, ...aliases: string[]): number {
  for (const a of aliases) {
    const i = cols[normalizeLabel(a)];
    if (i !== undefined) return i;
  }
  return -1;
}

// ---- 숫자 ----------------------------------------------------

/**
 * 금액. `1,234` · `-23,900` · `₩1,234` · `(123)` · `$8.85` 를 흡수한다.
 * 통화 기호가 있으면 currency 로 알려준다 — 국민 법인카드 해외 승인은
 * 원화가 아니라 달러로 찍히므로 그냥 숫자로 읽으면 8.85원이 된다.
 */
export function parseAmount(v: unknown): { amount: number; currency?: string } {
  if (typeof v === "number") return { amount: v };
  const s = str(v);
  if (!s) return { amount: 0 };
  const currency = s.includes("$") ? "USD" : s.includes("€") ? "EUR" : s.includes("¥") ? "JPY" : undefined;
  const neg = /^\(.*\)$/.test(s) || s.trimStart().startsWith("-");
  const digits = s.replace(/[^\d.]/g, "");
  if (!digits) return { amount: 0, currency };
  const n = Number(digits);
  if (!Number.isFinite(n)) return { amount: 0, currency };
  return { amount: neg ? -n : n, currency };
}

export const absAmount = (v: unknown) => Math.abs(parseAmount(v).amount);

// ---- 날짜 ----------------------------------------------------

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * `2026.05.31` · `2026-05-31 14:13:43` · `2026/5/31` · 엑셀 날짜 직렬값을
 * `YYYY-MM-DD` 로. 시각이 있으면 datetime 도 함께 낸다.
 */
export function parseDateTime(
  dateVal: unknown,
  timeVal?: unknown,
): { date: string; datetime?: string } | null {
  let date = "";
  let time = "";

  if (dateVal instanceof Date) {
    const d = dateVal;
    date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    if (d.getHours() || d.getMinutes() || d.getSeconds()) {
      time = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    }
  } else {
    const s = str(dateVal);
    if (!s) return null;
    const m = s.match(/(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
    if (!m) return null;
    date = `${m[1]}-${pad(Number(m[2]))}-${pad(Number(m[3]))}`;
    const tm = s.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if (tm) time = `${pad(Number(tm[1]))}:${tm[2]}:${tm[3] ?? "00"}`;
  }

  if (!time && timeVal !== undefined) {
    const ts = str(timeVal);
    const tm = ts.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if (tm) time = `${pad(Number(tm[1]))}:${tm[2]}:${tm[3] ?? "00"}`;
  }

  return { date, datetime: time ? `${date} ${time}` : undefined };
}

// ---- 계좌·카드 뒷 4자리 ----------------------------------------

/**
 * 마스킹된 번호에서 뒷 4자리.
 *   `5585-26**-****-3800` → 3800
 *   `****-****-0429`      → 0429
 *   `****-**-***5346`     → 5346
 */
export function last4Of(v: unknown): string | undefined {
  const s = str(v);
  if (!s) return undefined;
  const tail = s.replace(/[^\d*]/g, "").slice(-4);
  return /^\d{4}$/.test(tail) ? tail : undefined;
}

/**
 * 파일명에서 마스터에 있는 뒷자리를 찾는다.
 *
 * 신한은행 grid 엑셀처럼 **파일 안에 계좌번호가 아예 없는** 경우가 있다.
 * 그때 `신한은행4223_grid_exceldata (6).xlsx` 의 4223 이 유일한 단서다.
 * 마스터에 있는 값만 인정하므로 `(6)` 같은 잡음에 걸리지 않는다.
 */
export function last4FromFileName(fileName?: string, known?: string[]): string | undefined {
  if (!fileName || !known?.length) return undefined;
  const digits = fileName.match(/\d{3,}/g) ?? [];
  for (const chunk of digits) {
    for (const k of known) {
      // 마스터는 0429 처럼 앞자리 0 을 살려 두므로 양쪽으로 맞춰 본다
      if (chunk.endsWith(k) || chunk.endsWith(k.replace(/^0+/, ""))) return k;
    }
  }
  return undefined;
}

// ---- 거래 성격 판정 -------------------------------------------

/** 카드대금 결제로 볼 만한 표현들 (은행 출금 쪽) */
const CARD_BILL = [
  "카드결", "카드대금", "카드출금", "카드자동", "카드정산출금",
  "신한카드", "국민카드", "삼성카드", "현대카드", "롯데카드", "하나카드", "비씨카드", "우리카드", "농협카드",
];

/**
 * 이 출금이 카드대금 결제인가.
 *
 * 카드대금결제는 손익이 아니다(이미 개별 카드사용내역으로 비용이 잡혔다).
 * 놓치면 같은 지출이 두 번 잡히므로 은행 임포트에서 가장 중요한 판정이다.
 */
export function looksLikeCardBill(...texts: (string | undefined)[]): boolean {
  const hay = texts.filter(Boolean).join(" ");
  return CARD_BILL.some((k) => hay.includes(k));
}

/** 이자 입금 */
export function looksLikeInterest(...texts: (string | undefined)[]): boolean {
  const hay = texts.filter(Boolean).join(" ");
  return /이자/.test(hay);
}

/**
 * 자기 계좌 간 이동인가.
 *
 * ⚠️ **사람 이름으로는 절대 판정하지 않는다.** 계좌 별칭에 임직원 이름이
 *    들어 있어서(`(신법)이동주`) 이름을 근거로 삼으면 급여·대납 정산이
 *    자금거래로 잡혀 손익에서 조용히 빠진다. 실측으로 토스 42건 중 29건이
 *    그렇게 잘못 잡혔다 — 대부분 급여였다.
 *
 * 인정하는 근거는 두 가지뿐이다:
 *   1) 상대 **계좌번호**의 뒷 4자리가 우리 마스터에 있다 (가장 확실)
 *   2) 상대 이름이 우리 **법인명**이다 ((주)네안데르 등)
 */
export function looksLikeOwnTransfer(args: {
  vendor?: string;
  /** 상대 계좌번호 (토스처럼 파일이 알려주는 경우) */
  counterpartyAccount?: string;
  /** 마스터의 계좌·카드 뒷 4자리 */
  knownLast4?: string[];
  /** 우리 법인·사업장 이름 (사람 이름은 넣지 말 것) */
  ownEntities?: string[];
}): { own: boolean; why?: string } {
  const { vendor, counterpartyAccount, knownLast4, ownEntities } = args;

  if (counterpartyAccount && knownLast4?.length) {
    const tail = last4Of(counterpartyAccount);
    if (tail && knownLast4.includes(tail)) {
      return { own: true, why: `상대 계좌 뒷자리 ${tail} 가 우리 계좌 — 계좌간 이동` };
    }
  }

  if (vendor && ownEntities?.length) {
    const v = vendor.replace(/\s|\(|\)|주식회사|㈜|\(주\)/g, "");
    const hit = ownEntities.find((n) => {
      const c = n.replace(/\s|\(|\)|주식회사|㈜/g, "");
      return c.length >= 3 && (v.includes(c) || c.includes(v));
    });
    if (hit) return { own: true, why: `상대 「${vendor}」 가 우리 법인명 — 계좌간 이동으로 추정` };
  }

  return { own: false };
}

export const INTEREST_HINT: ClassifyHint = {
  acctMajor: "기타수입",
  acctMid: "이자수입",
  acctMinor: "예금이자",
  reason: "적요가 이자입금 — 예금이자로 추정",
};

export const OWN_TRANSFER_HINT = (why: string): ClassifyHint => ({
  acctMajor: "계좌간이동",
  acctMid: "이체출금",
  acctMinor: "운영자금이동",
  reason: `${why} — 아니면 유형을 바꿔주세요`,
});

export const CARD_BILL_HINT: ClassifyHint = {
  acctMajor: "재무비용",
  acctMid: "금융비용",
  acctMinor: "카드대금결제",
  reason: "카드대금 결제로 판정 — 손익 대상이 아님",
};

// ---- 행 만들기 ------------------------------------------------

/** dedupHash 를 붙여 완성한다 (모든 어댑터가 이걸 거친다) */
export function finishRow(
  partial: Omit<ImportRow, "dedupHash"> & { txType: TxType },
): ImportRow {
  return {
    ...partial,
    dedupHash: dedupHashOf({
      date: partial.date,
      last4: partial.last4,
      vendor: partial.vendor,
      gross: partial.gross,
      txType: partial.txType,
    }),
  };
}

/** 워크북에서 시트 하나 고르기 (이름 일부 일치 → 첫 시트) */
export function pickSheet(wb: WorkBook, ...nameHints: string[]): { name: string; ws: WorkSheet } | null {
  for (const hint of nameHints) {
    const found = wb.SheetNames.find((n) => n.replace(/\s+/g, "").includes(hint.replace(/\s+/g, "")));
    if (found) return { name: found, ws: wb.Sheets[found] };
  }
  const first = wb.SheetNames[0];
  return first ? { name: first, ws: wb.Sheets[first] } : null;
}

/** 헤더 라벨이 하나라도 있으면 그 시트가 맞다고 본다 (detect 용) */
export function hasLabels(wb: WorkBook, labels: string[], maxScan = 30): boolean {
  for (const sn of wb.SheetNames) {
    const ws = wb.Sheets[sn];
    if (!ws?.["!ref"]) continue;
    const range = sheetRange(ws);
    const limit = Math.min(range.e.r, range.s.r + maxScan);
    const found = new Set<string>();
    for (let r = range.s.r; r <= limit; r++) {
      for (let c = range.s.c; c <= range.e.c; c++) {
        const v = str(cellAt(ws, r, c));
        if (v) found.add(normalizeLabel(v));
      }
    }
    if (labels.every((l) => found.has(normalizeLabel(l)))) return true;
  }
  return false;
}
