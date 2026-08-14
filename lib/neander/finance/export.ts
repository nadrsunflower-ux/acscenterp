// ============================================================
//  엑셀 내보내기 — 통합거래장 29열 형식 그대로
// ------------------------------------------------------------
//  ERP 와 엑셀을 당분간 병행 운영하기 위한 안전장치다. 내보낸 파일을
//  기존 워크플로(세무·정산)에 그대로 넣을 수 있어야 하므로, 열 순서와
//  이름을 원본과 똑같이 맞춘다.
//
//  파생 열(순금액·수입금액·지출금액·회계코드·부가세·자산·지점·별칭·
//  조회키)은 저장돼 있지 않으므로 내보낼 때 계산해서 채운다.
// ============================================================

import * as XLSX from "xlsx";
import type { FinTransaction } from "./types";
import { netAmount, incomeAmount, expenseAmount, lookupKeyOf } from "./types";
import type { FinAccountDoc, FinPaymentMethodDoc } from "./db-types";

/** 원본 통합거래장의 29열 (순서 그대로) */
const HEADER = [
  "거래일시",
  "계좌/카번",
  "별칭",
  "거래유형",
  "사업대분류",
  "사업소분류",
  "계정대분류",
  "계정중분류",
  "계정소분류",
  "거래처",
  "계정소분류비고",
  "개인사용",
  "프로젝트코드",
  "원금액",
  "조정금액",
  "순금액",
  "사업장",
  "회계코드",
  "부가세공제여부",
  "자산여부",
  "결제수단구분",
  "지점코드",
  "비고",
  "수입금액",
  "지출금액",
  "검증상태",
  "환급매칭ID",
  "검증일",
  "조회키",
] as const;

const STATUS_TO_EXCEL: Record<string, string> = {
  confirmed: "확정",
  suggested: "제안됨",
  needs_review: "검토필요",
};

export function buildLedgerRows(
  rows: FinTransaction[],
  accounts: FinAccountDoc[],
  paymentMethods: FinPaymentMethodDoc[],
): (string | number)[][] {
  const acctByKey = new Map(accounts.map((a) => [a.lookupKey, a]));
  const pmByLast4 = new Map(paymentMethods.map((p) => [p.last4, p]));

  const body = rows.map((t) => {
    const key = lookupKeyOf(t);
    const a = acctByKey.get(key);
    const pm = t.last4 ? pmByLast4.get(t.last4) : undefined;
    return [
      t.date,
      t.last4 ?? "",
      pm?.alias ?? "",
      t.txType,
      t.bizMajor ?? "",
      t.bizMinor ?? "",
      t.acctMajor ?? "",
      t.acctMid ?? "",
      t.acctMinor ?? "",
      t.vendor ?? "",
      t.acctNote ?? "",
      t.personalUse ? "Y" : "",
      t.projectCode ?? "",
      t.gross ?? 0,
      t.adjust ?? 0,
      netAmount(t),
      t.site ?? pm?.site ?? "",
      a?.code ?? "",
      a?.vat ?? "",
      a?.asset ?? "",
      a?.pay ?? "",
      a?.branch ?? "",
      t.note ?? "",
      incomeAmount(t),
      expenseAmount(t),
      STATUS_TO_EXCEL[t.status] ?? "",
      t.refundMatchId ?? "",
      t.updatedAt ? new Date(t.updatedAt).toISOString().slice(0, 10) : "",
      key,
    ];
  });

  return [[...HEADER], ...body];
}

/** 브라우저에서 .xlsx 로 내려받는다 */
export function exportLedgerXlsx(
  rows: FinTransaction[],
  accounts: FinAccountDoc[],
  paymentMethods: FinPaymentMethodDoc[],
  fileName = "통합거래장.xlsx",
) {
  const aoa = buildLedgerRows(rows, accounts, paymentMethods);
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  // 열 너비를 대충이라도 잡아둬야 열자마자 읽을 수 있다
  ws["!cols"] = HEADER.map((h) => ({ wch: Math.max(10, Math.min(22, h.length * 2)) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "통합거래장");
  XLSX.writeFile(wb, fileName);
}
