// ============================================================
//  통합거래장 어댑터 — 기존 xlsx.ts 를 어댑터 틀에 맞춘다
// ------------------------------------------------------------
//  우리 장부 엑셀은 이미 분류가 끝난 파일이다. 그래서 다른 어댑터와 달리
//  계정·사업구분이 원본에 들어 있고, classify.ts 가 그대로 확정한다.
//  파서를 다시 쓰지 않고 감싸기만 한다 — 구·신버전 열 별칭, 헤더 위치
//  탐색, 카드번호 앞자리 0 복원 같은 실전 로직이 그 안에 있다.
// ============================================================

import type { WorkBook } from "xlsx";
import { parseWorkbook } from "../xlsx";
import type { AdapterResult, ParseOptions, SourceAdapter } from "./types";
import { hasLabels } from "./util";

export const ledgerAdapter: SourceAdapter = {
  id: "ledger",
  label: "통합거래장 (우리 장부)",
  kind: "ledger",

  detect(wb) {
    // 거래유형 + 원금액 이 함께 있으면 우리 장부다. 은행·카드 엑셀에는
    // 「거래유형」이 있어도 「원금액」은 없다.
    if (hasLabels(wb, ["거래유형", "원금액"])) return 1;
    return 0;
  },

  parse(wb: WorkBook, opts: ParseOptions): AdapterResult {
    const res = parseWorkbook(wb);
    return {
      // ParsedRow 와 ImportRow 는 같은 모양이다 (hint·foreign 만 옵션으로 추가)
      rows: res.rows,
      errors: res.errors,
      sheetName: res.sheetName,
      headerRowNo: res.headerRowNo,
      detectedLast4: [...new Set(res.rows.map((r) => r.last4).filter(Boolean) as string[])],
      needs: {},
      warnings: [],
    };
  },
};
