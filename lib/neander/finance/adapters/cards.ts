// ============================================================
//  법인카드 승인·이용내역 어댑터 (국민 · 신한)
// ------------------------------------------------------------
//  카드 내역은 **발생주의 지출**이다. 같은 돈이 나중에 은행에서
//  「카드대금결제」로 한 번 더 나가므로, 둘을 다 넣어야 두 기준
//  (발생주의·현금흐름)이 모두 맞는다 — report.ts 의 basis 참고.
//
//  국민과 신한의 결정적 차이: **국민은 해외 승인액을 달러로 준다.**
//  `$8.85` 를 그냥 숫자로 읽으면 8원짜리 지출이 된다. 그래서 외화 건은
//  통화와 원문 금액을 따로 들고, 환율을 받아 환산한다.
// ============================================================

import * as XLSX from "xlsx";
import type { WorkBook } from "xlsx";
import type { AdapterResult, ImportError, ImportRow, ParseOptions, SourceAdapter } from "./types";
import {
  col,
  findHeaderRow,
  finishRow,
  hasLabels,
  last4FromFileName,
  last4Of,
  parseAmount,
  parseDateTime,
  pickSheet,
  sheetRange,
  str,
  cellAt,
} from "./util";

/** 업종명 → 계정 추정. 확신이 아니라 후보다 (hint 로만 쓴다) */
const MCC_HINT: { match: RegExp; acctMajor: string; acctMid: string; acctMinor: string }[] = [
  { match: /한식|중식|일식|양식|음식|식당|제과|커피|음료/, acctMajor: "인건비", acctMid: "복리후생비", acctMinor: "일반식대" },
  { match: /주유|가스충전/, acctMajor: "운영비", acctMid: "차량관리비", acctMinor: "차량유지비" },
  { match: /통신|이동전화/, acctMajor: "운영비", acctMid: "일반운영비", acctMinor: "전기수도통신비" },
];

function mccHint(industry: string) {
  const hit = MCC_HINT.find((h) => h.match.test(industry));
  if (!hit) return undefined;
  return {
    acctMajor: hit.acctMajor,
    acctMid: hit.acctMid,
    acctMinor: hit.acctMinor,
    reason: `카드 업종 「${industry}」 기준 추정`,
  };
}

// ============================================================
//  국민 법인카드 — 승인내역조회
//    헤더 1행: 승인일 | 승인시간 | 부서번호 | 부서명 | 카드번호 | 이용자명
//              | 가맹점명 | 업종명 | 결제방법 | 할부개월수 | 승인금액 | 부가세
//              | 승인구분 | 승인방식
// ============================================================

export const kbCardAdapter: SourceAdapter = {
  id: "kb-card",
  label: "국민 법인카드 (승인내역)",
  kind: "card",

  detect(wb) {
    return hasLabels(wb, ["승인일", "가맹점명", "승인금액"]) ? 0.95 : 0;
  },

  parse(wb: WorkBook, opts: ParseOptions): AdapterResult {
    const picked = pickSheet(wb, "Sheet1");
    const rows: ImportRow[] = [];
    const errors: ImportError[] = [];
    const detected = new Set<string>();
    const warnings: string[] = [];
    let fxRows = 0;

    if (!picked) {
      return empty("시트를 찾지 못했습니다.");
    }
    const { name, ws } = picked;
    const head = findHeaderRow(ws, ["승인일", "가맹점명", "승인금액"]);
    if (!head) return empty("승인일·가맹점명·승인금액 열을 찾지 못했습니다.");

    const c = {
      date: col(head.cols, "승인일"),
      time: col(head.cols, "승인시간"),
      card: col(head.cols, "카드번호"),
      user: col(head.cols, "이용자명"),
      vendor: col(head.cols, "가맹점명"),
      industry: col(head.cols, "업종명"),
      amount: col(head.cols, "승인금액"),
      vat: col(head.cols, "부가세"),
      kind: col(head.cols, "승인구분"),
    };

    const range = sheetRange(ws);
    for (let r = head.row + 1; r <= range.e.r; r++) {
      const rowNo = r + 1;
      const dt = parseDateTime(cellAt(ws, r, c.date), c.time >= 0 ? cellAt(ws, r, c.time) : undefined);
      const vendor = str(cellAt(ws, r, c.vendor));
      const raw = cellAt(ws, r, c.amount);
      if (!dt && !vendor) continue; // 빈 줄
      if (!dt) {
        errors.push({ rowNo, reason: "승인일을 읽지 못했습니다." });
        continue;
      }
      const { amount, currency } = parseAmount(raw);
      if (!amount) {
        errors.push({ rowNo, reason: `승인금액이 비어 있거나 0 입니다 (${str(raw)}).` });
        continue;
      }

      const last4 = opts.last4 ?? last4Of(cellAt(ws, r, c.card));
      if (last4) detected.add(last4);
      const industry = c.industry >= 0 ? str(cellAt(ws, r, c.industry)) : "";
      const approvalKind = c.kind >= 0 ? str(cellAt(ws, r, c.kind)) : "";

      // 외화 승인: 환율을 받아 원화로 환산한다. 환율이 없으면 환산하지 않고
      // 원문을 남긴 채 오류로 돌려 사람이 결정하게 한다 (0원으로 넣으면
      // 조용히 사라진다).
      let gross = amount;
      let note = "";
      let foreign: ImportRow["foreign"];
      if (currency) {
        fxRows += 1;
        foreign = { currency, amount };
        if (!opts.fxRate) {
          errors.push({
            rowNo,
            reason: `외화 승인 ${currency} ${amount} — 환율을 입력하면 원화로 환산합니다.`,
          });
          continue;
        }
        gross = Math.round(amount * opts.fxRate);
        note = `${currency} ${amount} × ${opts.fxRate.toLocaleString("ko-KR")}`;
      }

      const vat = c.vat >= 0 ? parseAmount(cellAt(ws, r, c.vat)).amount : 0;
      const notes = [
        note,
        industry && industry !== "-" ? `업종 ${industry}` : "",
        approvalKind ? `승인 ${approvalKind}` : "",
        vat ? `부가세 ${vat.toLocaleString("ko-KR")}` : "",
      ].filter(Boolean);

      rows.push(
        finishRow({
          rowNo,
          date: dt.date,
          datetime: dt.datetime,
          last4,
          txType: "지출",
          vendor: vendor || undefined,
          gross,
          adjust: 0,
          note: notes.join(" · ") || undefined,
          foreign,
          hint: mccHint(industry),
        }),
      );
    }

    if (fxRows > 0 && !opts.fxRate) {
      warnings.push(
        `해외 승인 ${fxRows}건은 달러로 찍혀 있습니다. 환율을 입력하기 전에는 적재되지 않습니다.`,
      );
    }

    return {
      rows,
      errors,
      sheetName: name,
      headerRowNo: head.row + 1,
      detectedLast4: [...detected],
      needs: { account: detected.size === 0, fxCurrency: fxRows ? "USD" : undefined, fxRows },
      warnings,
    };

    function empty(reason: string): AdapterResult {
      return {
        rows: [],
        errors: [{ rowNo: 0, reason }],
        sheetName: picked?.name ?? "",
        headerRowNo: 0,
        detectedLast4: [],
        needs: {},
        warnings: [],
      };
    }
  },
};

// ============================================================
//  신한 법인카드 — 법인이용내역(전체)
//    헤더 1행: 이용일시 | 접수일 | 승인번호 | 이용카드 | 이용자명 | 가맹점명
//              | 이용금액 | 이용구분 | 할부개월수 | 이용지역 | 카드구분 | 결제예정일
//
//  신한은 해외 건도 **원화로 환산해서** 준다 (이용지역만 '해외'). 그래서
//  국민과 달리 환율이 필요 없다.
// ============================================================

export const shinhanCardAdapter: SourceAdapter = {
  id: "shinhan-card",
  label: "신한 법인카드 (이용내역)",
  kind: "card",

  detect(wb) {
    return hasLabels(wb, ["이용일시", "이용카드", "이용금액"]) ? 0.95 : 0;
  },

  parse(wb: WorkBook, opts: ParseOptions): AdapterResult {
    const picked = pickSheet(wb, "Sheet0");
    const rows: ImportRow[] = [];
    const errors: ImportError[] = [];
    const detected = new Set<string>();

    if (!picked) {
      return {
        rows, errors: [{ rowNo: 0, reason: "시트를 찾지 못했습니다." }],
        sheetName: "", headerRowNo: 0, detectedLast4: [], needs: {}, warnings: [],
      };
    }
    const { name, ws } = picked;
    const head = findHeaderRow(ws, ["이용일시", "이용카드", "이용금액"]);
    if (!head) {
      return {
        rows, errors: [{ rowNo: 0, reason: "이용일시·이용카드·이용금액 열을 찾지 못했습니다." }],
        sheetName: name, headerRowNo: 0, detectedLast4: [], needs: {}, warnings: [],
      };
    }

    const c = {
      date: col(head.cols, "이용일시"),
      card: col(head.cols, "이용카드"),
      vendor: col(head.cols, "가맹점명"),
      amount: col(head.cols, "이용금액"),
      kind: col(head.cols, "이용구분"),
      region: col(head.cols, "이용지역"),
      due: col(head.cols, "결제예정일"),
    };

    const range = sheetRange(ws);
    for (let r = head.row + 1; r <= range.e.r; r++) {
      const rowNo = r + 1;
      const dt = parseDateTime(cellAt(ws, r, c.date));
      const vendor = str(cellAt(ws, r, c.vendor));
      if (!dt && !vendor) continue;
      if (!dt) {
        errors.push({ rowNo, reason: "이용일시를 읽지 못했습니다." });
        continue;
      }
      const { amount } = parseAmount(cellAt(ws, r, c.amount));
      if (!amount) {
        errors.push({ rowNo, reason: "이용금액이 비어 있거나 0 입니다." });
        continue;
      }
      const last4 = opts.last4 ?? last4Of(cellAt(ws, r, c.card));
      if (last4) detected.add(last4);

      const region = c.region >= 0 ? str(cellAt(ws, r, c.region)) : "";
      const kind = c.kind >= 0 ? str(cellAt(ws, r, c.kind)) : "";
      const due = c.due >= 0 ? str(cellAt(ws, r, c.due)) : "";
      const notes = [
        region === "해외" ? "해외 이용 (원화 환산)" : "",
        kind && kind !== "일시불" ? kind : "",
        due ? `결제예정 ${due}` : "",
      ].filter(Boolean);

      rows.push(
        finishRow({
          rowNo,
          date: dt.date,
          datetime: dt.datetime,
          last4,
          txType: "지출",
          vendor: vendor || undefined,
          gross: amount,
          adjust: 0,
          note: notes.join(" · ") || undefined,
        }),
      );
    }

    return {
      rows,
      errors,
      sheetName: name,
      headerRowNo: head.row + 1,
      detectedLast4: [...detected],
      needs: { account: detected.size === 0 },
      warnings: [],
    };
  },
};

/** 파일명에서 카드 뒷자리 보강 — 카드 파일은 보통 파일 안에 번호가 있어 예비용 */
export function fallbackLast4(opts: ParseOptions): string | undefined {
  return opts.last4 ?? last4FromFileName(opts.fileName, opts.knownLast4);
}

export const cardAdapters = [kbCardAdapter, shinhanCardAdapter];

/** XLSX 를 직접 쓰지 않는 곳에서도 타입이 필요해 재수출 */
export type { WorkBook };
export { XLSX };
