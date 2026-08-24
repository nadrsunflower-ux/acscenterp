// ============================================================
//  은행 거래내역 어댑터 (국민 · 신한 · 토스 · 카카오)
// ------------------------------------------------------------
//  은행 내역은 **통장에 찍힌 것 전부**다. 그래서 손익이 아닌 것이 섞여
//  있고, 그걸 걸러내는 게 이 어댑터들의 핵심 일이다:
//
//    카드대금결제  이미 카드 내역으로 비용을 잡았으므로 손익 아님
//    자금거래      계좌 간 이동·예수금 — 손익 아님
//    이자입금      기타수입 > 이자수입 > 예금이자 (확실한 계정)
//
//  이걸 놓치면 같은 지출이 두 번 잡히거나 매출이 부풀려진다. 다만
//  **확정하지는 않는다** — 카드대금·이자처럼 표현이 확실한 것만 유형을
//  정하고, 나머지 계정 판단은 classify.ts 에 넘긴다.
//
//  네 은행의 차이:
//    국민   요약 6줄 뒤 헤더. 출금액/입금액 두 열.
//    신한   헤더 1행. `적요`는 거래 방식(BZ뱅크), `내용`이 실제 상대방.
//           **파일 안에 계좌번호가 없어** 파일명이나 사용자 선택이 필요하다.
//    토스   B열부터. 금액에 부호가 있고 `구분`(수입/지출)도 준다.
//    카카오 B열부터. 금액은 양수, `구분`으로 방향을 판단한다.
// ============================================================

import type { WorkBook } from "xlsx";
import type { AdapterResult, ImportError, ImportRow, ParseOptions, SourceAdapter } from "./types";
import {
  CARD_BILL_HINT,
  INTEREST_HINT,
  cellAt,
  col,
  findHeaderRow,
  finishRow,
  hasLabels,
  last4FromFileName,
  last4Of,
  looksLikeCardBill,
  looksLikeInterest,
  OWN_TRANSFER_HINT,
  looksLikeOwnTransfer,
  parseAmount,
  parseDateTime,
  pickSheet,
  sheetRange,
  str,
} from "./util";
import type { TxType } from "../types";

/** 시트 위쪽 요약 줄에서 계좌번호를 찾는다 (`계좌번호 : 012501-04-33880`) */
function scanAccountNumber(wb: WorkBook, sheetName: string, maxRow = 12): string | undefined {
  const ws = wb.Sheets[sheetName];
  if (!ws) return undefined;
  const range = sheetRange(ws);
  for (let r = range.s.r; r <= Math.min(range.e.r, range.s.r + maxRow); r++) {
    for (let c = range.s.c; c <= range.e.c; c++) {
      const v = str(cellAt(ws, r, c));
      if (!v) continue;
      if (/계좌번호/.test(v)) {
        const inline = last4Of(v.replace(/계좌번호\s*:?/, ""));
        if (inline) return inline;
        // 라벨과 값이 다른 칸에 있는 형태 (카카오·토스)
        for (let k = 1; k <= 3; k++) {
          const nxt = last4Of(cellAt(ws, r, c + k));
          if (nxt) return nxt;
        }
      }
    }
  }
  return undefined;
}

/** 은행 공통 행 만들기 — 방향·유형 판정을 한 곳에 모은다 */
function bankRow(args: {
  rowNo: number;
  date: string;
  datetime?: string;
  last4?: string;
  vendor?: string;
  /** 적요·거래구분 등 성격을 알려주는 문구들 */
  memos: (string | undefined)[];
  inAmount: number;
  outAmount: number;
  /** 상대 계좌번호 (파일이 주는 경우) — 자금거래 판정의 유일한 확실한 근거 */
  counterpartyAccount?: string;
  knownLast4?: string[];
  ownEntities?: string[];
  balance?: string;
}): ImportRow {
  const { rowNo, date, datetime, last4, vendor, memos, inAmount, outAmount } = args;
  const texts = [vendor, ...memos];
  const isOut = outAmount > 0;
  const gross = isOut ? outAmount : inAmount;

  let txType: TxType = isOut ? "지출" : "수입";
  let hint: ImportRow["hint"];

  if (isOut && looksLikeCardBill(...texts)) {
    txType = "카드대금결제";
    hint = CARD_BILL_HINT;
  } else if (!isOut && looksLikeInterest(...memos)) {
    hint = INTEREST_HINT;
  } else {
    const own = looksLikeOwnTransfer({
      vendor,
      counterpartyAccount: args.counterpartyAccount,
      knownLast4: args.knownLast4,
      ownEntities: args.ownEntities,
    });
    if (own.own) {
      txType = "자금거래";
      hint = OWN_TRANSFER_HINT(own.why!);
    }
  }

  const note = [...memos.filter(Boolean), args.balance ? `잔액 ${args.balance}` : ""]
    .filter(Boolean)
    .join(" · ");

  return finishRow({
    rowNo,
    date,
    datetime,
    last4,
    txType,
    vendor: vendor || undefined,
    gross,
    adjust: 0,
    note: note || undefined,
    hint,
  });
}

// ============================================================
//  국민은행
// ============================================================

export const kbBankAdapter: SourceAdapter = {
  id: "kb-bank",
  label: "국민은행 거래내역",
  kind: "bank",

  detect(wb) {
    return hasLabels(wb, ["거래일시", "출금액", "입금액", "보낸분/받는분"]) ? 0.95 : 0;
  },

  parse(wb, opts) {
    const picked = pickSheet(wb, "Sheet 1", "Sheet1");
    if (!picked) return fail("시트를 찾지 못했습니다.", "");
    const { name, ws } = picked;
    const head = findHeaderRow(ws, ["거래일시", "출금액", "입금액"]);
    if (!head) return fail("거래일시·출금액·입금액 열을 찾지 못했습니다.", name);

    const c = {
      date: col(head.cols, "거래일시"),
      who: col(head.cols, "보낸분/받는분"),
      out: col(head.cols, "출금액"),
      in: col(head.cols, "입금액"),
      balance: col(head.cols, "잔액"),
      memo: col(head.cols, "메모"),
      brief: col(head.cols, "적요"),
      display: col(head.cols, "내 통장 표시"),
    };

    const fileLast4 = scanAccountNumber(wb, name) ?? last4FromFileName(opts.fileName, opts.knownLast4);
    const last4 = opts.last4 ?? fileLast4;

    const rows: ImportRow[] = [];
    const errors: ImportError[] = [];
    const range = sheetRange(ws);
    for (let r = head.row + 1; r <= range.e.r; r++) {
      const rowNo = r + 1;
      const dt = parseDateTime(cellAt(ws, r, c.date));
      if (!dt) continue;
      const out = parseAmount(cellAt(ws, r, c.out)).amount;
      const inn = parseAmount(cellAt(ws, r, c.in)).amount;
      if (!out && !inn) {
        errors.push({ rowNo, reason: "입금액·출금액이 모두 0 입니다." });
        continue;
      }
      rows.push(
        bankRow({
          rowNo,
          date: dt.date,
          datetime: dt.datetime,
          last4,
          vendor: str(cellAt(ws, r, c.who)),
          memos: [
            c.brief >= 0 ? str(cellAt(ws, r, c.brief)) : undefined,
            c.display >= 0 ? str(cellAt(ws, r, c.display)) : undefined,
            c.memo >= 0 ? str(cellAt(ws, r, c.memo)) : undefined,
          ],
          inAmount: inn,
          outAmount: out,
          knownLast4: opts.knownLast4,
          ownEntities: opts.ownEntities,
          balance: c.balance >= 0 ? str(cellAt(ws, r, c.balance)) : undefined,
        }),
      );
    }

    return {
      rows, errors, sheetName: name, headerRowNo: head.row + 1,
      detectedLast4: fileLast4 ? [fileLast4] : [],
      needs: { account: !last4 },
      warnings: [],
    };
  },
};

// ============================================================
//  신한은행 (인터넷뱅킹 grid 엑셀)
// ============================================================

export const shinhanBankAdapter: SourceAdapter = {
  id: "shinhan-bank",
  label: "신한은행 거래내역",
  kind: "bank",

  detect(wb) {
    // 신한 grid 는 `내용` 열이 있고 `보낸분/받는분` 이 없다 — 국민과 구분되는 지점
    return hasLabels(wb, ["거래일시", "입금액", "출금액", "내용"]) ? 0.9 : 0;
  },

  parse(wb, opts) {
    const picked = pickSheet(wb, "sheet");
    if (!picked) return fail("시트를 찾지 못했습니다.", "");
    const { name, ws } = picked;
    const head = findHeaderRow(ws, ["거래일시", "입금액", "출금액"]);
    if (!head) return fail("거래일시·입금액·출금액 열을 찾지 못했습니다.", name);

    const c = {
      date: col(head.cols, "거래일시"),
      brief: col(head.cols, "적요"),
      in: col(head.cols, "입금액"),
      out: col(head.cols, "출금액"),
      content: col(head.cols, "내용"),
      balance: col(head.cols, "잔액"),
      branch: col(head.cols, "거래점명"),
    };

    // 이 파일에는 계좌번호가 없다. 파일명이 유일한 단서.
    const fromName = last4FromFileName(opts.fileName, opts.knownLast4);
    const last4 = opts.last4 ?? fromName;

    const rows: ImportRow[] = [];
    const errors: ImportError[] = [];
    const range = sheetRange(ws);
    for (let r = head.row + 1; r <= range.e.r; r++) {
      const rowNo = r + 1;
      const dt = parseDateTime(cellAt(ws, r, c.date));
      if (!dt) continue;
      const inn = parseAmount(cellAt(ws, r, c.in)).amount;
      const out = parseAmount(cellAt(ws, r, c.out)).amount;
      if (!inn && !out) {
        errors.push({ rowNo, reason: "입금액·출금액이 모두 0 입니다." });
        continue;
      }
      // 신한은 `내용`이 실제 상대방(조수빈·김제연 급여), `적요`는 거래 방식(BZ뱅크)
      rows.push(
        bankRow({
          rowNo,
          date: dt.date,
          datetime: dt.datetime,
          last4,
          vendor: str(cellAt(ws, r, c.content)),
          memos: [
            c.brief >= 0 ? str(cellAt(ws, r, c.brief)) : undefined,
            c.branch >= 0 ? str(cellAt(ws, r, c.branch)) : undefined,
          ],
          inAmount: inn,
          outAmount: out,
          knownLast4: opts.knownLast4,
          ownEntities: opts.ownEntities,
          balance: c.balance >= 0 ? str(cellAt(ws, r, c.balance)) : undefined,
        }),
      );
    }

    return {
      rows, errors, sheetName: name, headerRowNo: head.row + 1,
      detectedLast4: fromName ? [fromName] : [],
      needs: { account: !last4 },
      warnings: last4
        ? []
        : ["이 파일에는 계좌번호가 없습니다. 어느 계좌인지 직접 골라주세요."],
    };
  },
};

// ============================================================
//  토스뱅크
//    B열부터 시작. 헤더: 거래 일시 | 적요 | 거래 유형 | 거래 기관
//                     | 계좌번호 | 거래 금액 | 거래 후 잔액 | 메모 | 구분
//    금액에 부호가 있고 `구분`(수입/지출)도 함께 준다.
// ============================================================

export const tossBankAdapter: SourceAdapter = {
  id: "toss-bank",
  label: "토스뱅크 거래내역",
  kind: "bank",

  detect(wb) {
    return hasLabels(wb, ["거래일시", "거래유형", "거래금액", "거래후잔액"]) ? 0.95 : 0;
  },

  parse(wb, opts) {
    const picked = pickSheet(wb, "토스뱅크");
    if (!picked) return fail("시트를 찾지 못했습니다.", "");
    const { name, ws } = picked;
    const head = findHeaderRow(ws, ["거래 일시", "거래 금액"]);
    if (!head) return fail("거래 일시·거래 금액 열을 찾지 못했습니다.", name);

    const c = {
      date: col(head.cols, "거래 일시", "거래일시"),
      brief: col(head.cols, "적요"),
      type: col(head.cols, "거래 유형", "거래유형"),
      bank: col(head.cols, "거래 기관", "거래기관"),
      amount: col(head.cols, "거래 금액", "거래금액"),
      balance: col(head.cols, "거래 후 잔액", "거래후잔액"),
      memo: col(head.cols, "메모"),
      dir: col(head.cols, "구분"),
      acct: col(head.cols, "계좌번호"),
    };

    const fileLast4 = scanAccountNumber(wb, name) ?? last4FromFileName(opts.fileName, opts.knownLast4);
    const last4 = opts.last4 ?? fileLast4;

    const rows: ImportRow[] = [];
    const errors: ImportError[] = [];
    const range = sheetRange(ws);
    for (let r = head.row + 1; r <= range.e.r; r++) {
      const rowNo = r + 1;
      const dt = parseDateTime(cellAt(ws, r, c.date));
      if (!dt) continue;
      const { amount } = parseAmount(cellAt(ws, r, c.amount));
      if (!amount) {
        errors.push({ rowNo, reason: "거래 금액이 비어 있거나 0 입니다." });
        continue;
      }
      const dir = c.dir >= 0 ? str(cellAt(ws, r, c.dir)) : "";
      // 부호와 `구분` 둘 다 있다. 어긋나면 `구분` 을 믿는다 (은행이 명시한 값)
      const isOut = dir ? dir === "지출" : amount < 0;
      const abs = Math.abs(amount);
      const type = c.type >= 0 ? str(cellAt(ws, r, c.type)) : "";

      rows.push(
        bankRow({
          rowNo,
          date: dt.date,
          datetime: dt.datetime,
          last4,
          vendor: str(cellAt(ws, r, c.brief)),
          memos: [
            type,
            c.bank >= 0 ? str(cellAt(ws, r, c.bank)) : undefined,
            c.memo >= 0 ? str(cellAt(ws, r, c.memo)) : undefined,
          ],
          inAmount: isOut ? 0 : abs,
          outAmount: isOut ? abs : 0,
          // 토스는 상대 계좌번호를 준다 — 자금거래 판정의 가장 확실한 근거
          counterpartyAccount: c.acct >= 0 ? str(cellAt(ws, r, c.acct)) : undefined,
          knownLast4: opts.knownLast4,
          ownEntities: opts.ownEntities,
          balance: c.balance >= 0 ? str(cellAt(ws, r, c.balance)) : undefined,
        }),
      );
    }

    return {
      rows, errors, sheetName: name, headerRowNo: head.row + 1,
      detectedLast4: fileLast4 ? [fileLast4] : [],
      needs: { account: !last4 },
      warnings: [],
    };
  },
};

// ============================================================
//  카카오뱅크
//    B열부터. 헤더: 거래일시 | 구분 | 거래금액 | 거래 후 잔액
//                 | 거래구분 | 내용 | 메모
//    금액은 양수. 방향은 `구분`(수입/지출).
// ============================================================

export const kakaoBankAdapter: SourceAdapter = {
  id: "kakao-bank",
  label: "카카오뱅크 거래내역",
  kind: "bank",

  detect(wb) {
    return hasLabels(wb, ["거래일시", "거래금액", "거래구분", "내용"]) ? 0.93 : 0;
  },

  parse(wb, opts) {
    const picked = pickSheet(wb, "카카오뱅크");
    if (!picked) return fail("시트를 찾지 못했습니다.", "");
    const { name, ws } = picked;
    const head = findHeaderRow(ws, ["거래일시", "거래금액", "거래구분"]);
    if (!head) return fail("거래일시·거래금액·거래구분 열을 찾지 못했습니다.", name);

    const c = {
      date: col(head.cols, "거래일시"),
      dir: col(head.cols, "구분"),
      amount: col(head.cols, "거래금액"),
      balance: col(head.cols, "거래 후 잔액", "거래후잔액"),
      type: col(head.cols, "거래구분"),
      content: col(head.cols, "내용"),
      memo: col(head.cols, "메모"),
    };

    const fileLast4 = scanAccountNumber(wb, name) ?? last4FromFileName(opts.fileName, opts.knownLast4);
    const last4 = opts.last4 ?? fileLast4;

    const rows: ImportRow[] = [];
    const errors: ImportError[] = [];
    const range = sheetRange(ws);
    for (let r = head.row + 1; r <= range.e.r; r++) {
      const rowNo = r + 1;
      const dt = parseDateTime(cellAt(ws, r, c.date));
      if (!dt) continue;
      const { amount } = parseAmount(cellAt(ws, r, c.amount));
      if (!amount) {
        errors.push({ rowNo, reason: "거래금액이 비어 있거나 0 입니다." });
        continue;
      }
      const dir = c.dir >= 0 ? str(cellAt(ws, r, c.dir)) : "";
      if (!dir) {
        errors.push({ rowNo, reason: "수입/지출 구분이 비어 있어 방향을 알 수 없습니다." });
        continue;
      }
      const isOut = dir === "지출";
      const abs = Math.abs(amount);

      rows.push(
        bankRow({
          rowNo,
          date: dt.date,
          datetime: dt.datetime,
          last4,
          vendor: str(cellAt(ws, r, c.content)),
          memos: [
            c.type >= 0 ? str(cellAt(ws, r, c.type)) : undefined,
            c.memo >= 0 ? str(cellAt(ws, r, c.memo)) : undefined,
          ],
          inAmount: isOut ? 0 : abs,
          outAmount: isOut ? abs : 0,
          knownLast4: opts.knownLast4,
          ownEntities: opts.ownEntities,
          balance: c.balance >= 0 ? str(cellAt(ws, r, c.balance)) : undefined,
        }),
      );
    }

    return {
      rows, errors, sheetName: name, headerRowNo: head.row + 1,
      detectedLast4: fileLast4 ? [fileLast4] : [],
      needs: { account: !last4 },
      warnings: [],
    };
  },
};

function fail(reason: string, sheetName: string): AdapterResult {
  return {
    rows: [],
    errors: [{ rowNo: 0, reason }],
    sheetName,
    headerRowNo: 0,
    detectedLast4: [],
    needs: {},
    warnings: [],
  };
}

export const bankAdapters = [kbBankAdapter, shinhanBankAdapter, tossBankAdapter, kakaoBankAdapter];
