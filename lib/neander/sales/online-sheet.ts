// ============================================================
//  페이히어 온라인 매출 시트 — 매출 적재의 네 번째 칸
// ------------------------------------------------------------
//  온라인 주문은 POS 매출 내역처럼 매장 이름이 박힌 원본으로 오지 않는다.
//  원가계산 엑셀의 「입력_페이히어_온라인」 시트 모양 그대로 온다:
//
//    [ 페이히어 온라인 매출 데이터 ]
//    ▼ 여기부터 붙여넣기 (헤더 포함) ▼            … 565800   ← 시트의 검산 합계
//    결제일 | 결제시간 | 결제 내역 | 합계 | 수량 | 금액 | 배송상태 | 비고(주문번호)
//
//  한 주문에 상품이 여러 개면 줄도 여럿이다 (같은 주문번호) — 줄마다 한 상품.
//  재무 어댑터(parseReconcileSource)는 이 모양을 모르므로 여기서 읽어 같은
//  PosResult 로 돌려준다. 적재 화면이 **먼저** detectOnlineSheet 로 알아본다.
//
//  읽는 규칙은 엑셀 적재 스크립트(import-sales-xlsx.ts)의 온라인 시트와 같다 —
//  금액 열은 입금액 → 금액 → 합계 순, 0원 줄은 뺀다, 날짜는 셀의 로컬 날짜.
//  2026-02~07 온라인 판매 줄이 그 스크립트로 들어갔으니 8월부터도 같아야 한다.
// ============================================================

import * as XLSX from "xlsx";
import type { WorkBook } from "xlsx";
import type { PosResult } from "@/lib/neander/finance/adapters";
import type { PosSale } from "@/lib/neander/finance/adapters/pos";

const cellText = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim();
const num = (v: unknown) => {
  if (typeof v === "number") return v;
  const n = Number(String(v ?? "").replace(/[,\s원]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

/** 셀 → YYYY-MM-DD. 날짜 셀은 로컬 날짜로 (스크립트의 toDate 와 같다) */
function toDate(v: unknown): string {
  const p = (n: number) => String(n).padStart(2, "0");
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`;
  }
  if (typeof v === "number" && v > 20000 && v < 80000) {
    const d = new Date(Date.UTC(1899, 11, 30) + v * 86400000);
    return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
  }
  const m = cellText(v).match(/(\d{4})[-./]\s*(\d{1,2})[-./]\s*(\d{1,2})/);
  return m ? `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}` : "";
}

interface Located {
  sheet: string;
  grid: unknown[][];
  header: number;
}

function locate(wb: WorkBook): Located | null {
  for (const sheet of wb.SheetNames) {
    const ws = wb.Sheets[sheet];
    if (!ws) continue;
    const grid = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: "" });
    const header = grid
      .slice(0, 20)
      .findIndex((row) => {
        const cells = (row ?? []).map(cellText);
        return cells.includes("결제일") && cells.includes("결제 내역");
      });
    if (header < 0) continue;
    const head = (grid[header] ?? []).map(cellText);
    const above = grid.slice(0, header).flat().map(cellText).join(" ");
    // 매장 POS 내역도 「결제일 · 결제 내역」 열을 쓴다 — 온라인이라는 표시가 있어야 한다
    if (/온라인/.test(sheet) || /온라인/.test(above) || head.includes("배송상태")) {
      return { sheet, grid, header };
    }
  }
  return null;
}

/** 페이히어 온라인 매출 시트인가 */
export function detectOnlineSheet(wb: WorkBook): boolean {
  return locate(wb) !== null;
}

export function parseOnlineSheet(wb: WorkBook, fileName?: string): PosResult | null {
  const at = locate(wb);
  if (!at) return null;
  const { sheet, grid, header } = at;
  const head = (grid[header] ?? []).map(cellText);
  const col = (name: string) => head.indexOf(name);
  const cDate = col("결제일");
  const cItem = col("결제 내역");
  const cQty = col("수량");
  const amountCols = ["입금액", "금액", "합계"].map(col).filter((i) => i >= 0);

  const sales: PosSale[] = [];
  for (let r = header + 1; r < grid.length; r++) {
    const row = grid[r] ?? [];
    const date = toDate(row[cDate]);
    if (!date) continue;
    let total = 0;
    for (const c of amountCols) {
      const v = num(row[c]);
      if (v > 0) {
        total = v;
        break;
      }
    }
    if (total <= 0) continue; // 0원 줄은 매출이 아니다 (스크립트와 같다)
    const qty = cQty >= 0 ? num(row[cQty]) : 0;
    sales.push({
      rowNo: r + 1,
      date,
      items: cellText(row[cItem]),
      total,
      card: 0,
      cash: 0,
      easy: 0,
      other: 0,
      online: total,
      ...(qty > 0 ? { qty } : {}),
    });
  }

  const dates = sales.map((s) => s.date).sort();
  const from = dates[0];
  const to = dates[dates.length - 1];
  const loaded = sales.reduce((s, x) => s + x.total, 0);
  // 시트 위쪽 「▼ 여기부터 붙여넣기」 줄의 검산 합계 — 있으면 원본 합계로 쓴다.
  // 적재 합계와 다르면 칸에 「원본 합계와 N원 다릅니다」가 뜬다.
  const checkRow = grid.slice(0, header).find((row) => (row ?? []).some((c) => /붙여넣기/.test(cellText(c))));
  const declared = checkRow?.map(num).find((n) => n > 0);

  const warnings: string[] = [];
  if (declared !== undefined && declared !== loaded) {
    warnings.push(
      `시트 검산 합계 ${declared.toLocaleString("ko-KR")}원과 읽은 합계 ${loaded.toLocaleString("ko-KR")}원이 다릅니다.`,
    );
  }

  return {
    sourceLabel: "페이히어 온라인",
    sheetName: sheet,
    warnings,
    store: "온라인",
    period: from && to ? `${from} ~ ${to}` : fileName ?? "",
    from,
    to,
    summary: {
      total: declared ?? loaded,
      net: loaded,
      count: sales.length,
      avg: sales.length ? Math.round(loaded / sales.length) : 0,
      refund: 0,
      refundCount: 0,
    },
    sales,
    byMethod: { card: 0, cash: 0, easy: 0, other: 0, online: loaded },
  };
}
