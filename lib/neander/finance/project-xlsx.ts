// ============================================================
//  프로젝트 체크리스트 → 엑셀
// ------------------------------------------------------------
//  원본 「JIMFF_물품체크리스트」 와 같은 열 순서로 내보낸다. 주최측·
//  협력사에 보낼 때는 여전히 엑셀이 오가므로, 화면에서 정리한 표를 그대로
//  파일로 만들 수 있어야 한다. 손익 요약은 두 번째 시트에 둔다 — 체크리스트
//  시트는 외부에 그대로 보내는 일이 있어 계약금액·이익이 섞이면 곤란하다.
// ============================================================

import * as XLSX from "xlsx";
import {
  groupLines,
  lineActual,
  lineEstimate,
  projectSummary,
  formatMargin,
  PROJECT_STATUS_LABEL,
  VAT_LABEL,
  INSTALLMENT_STATUS_LABEL,
  installmentStatus,
  isReceived,
  sanitizeLine,
  type FinProjectDoc,
  type FinProjectLine,
} from "./project";
import type { FinTransaction } from "./types";

const HEADER = ["No.", "분류", "제품명", "수량", "단위", "단가", "금액", "발주처", "위치", "준비수량", "실제금액", "비고"];

export function exportProjectXlsx(p: FinProjectDoc, transactions: FinTransaction[] = []) {
  const groups = groupLines(p.lines);
  // 사용자가 만든 열은 고정 열 뒤에 붙인다 — 화면 순서 그대로
  const extraCols = p.columns ?? [];
  const rows: (string | number)[][] = [];
  rows.push([`${p.name} 지출`]);
  rows.push([`코드 ${p.code}${p.client ? ` · ${p.client}` : ""}${p.startDate ? ` · ${p.startDate}${p.endDate ? ` ~ ${p.endDate}` : ""}` : ""}`]);
  rows.push([]);
  rows.push([...HEADER, ...extraCols.map((c) => c.label)]);
  let no = 0;
  groups.forEach((g) => {
    g.lines.forEach((l) => {
      no += 1;
      rows.push([
        no,
        g.category,
        l.item,
        l.qty,
        l.unit ?? "",
        l.unitPrice ?? "",
        lineEstimate(l),
        l.vendor ?? "",
        l.location ?? "",
        l.preparedQty ?? "",
        l.actual ?? "",
        l.note ?? "",
        ...extraCols.map((c) => l.extra?.[c.id] ?? ""),
      ]);
    });
  });
  const s = projectSummary(p, transactions);
  rows.push([]);
  rows.push(["", "합계", "", "", "", "", s.estimate, "", "", "", s.actual, ""]);
  rows.push([]);
  rows.push(["", "분류별 소계"]);
  rows.push(["", "분류", "품목 수", "견적", "실제"]);
  groups.forEach((g) => rows.push(["", g.category, g.lines.length, g.estimate, g.actual]));
  rows.push(["", "총계", p.lines.length, s.estimate, s.actual]);

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = [4, 18, 28, 7, 6, 11, 12, 12, 8, 8, 12, 24]
    .concat(extraCols.map(() => 16))
    .map((w) => ({ wch: w }));

  const pl: (string | number)[][] = [
    ["항목", "금액"],
    ["프로젝트", p.name],
    ["코드", p.code],
    ["상태", PROJECT_STATUS_LABEL[p.status]],
    ["발주처", p.client ?? ""],
    [],
    ["계약금액 (입력값)", s.contract],
    ["부가세 기준", VAT_LABEL[p.vatMode ?? "excluded"]],
    ...p.revenues.map((r) => [`추가 수입 · ${r.label}`, r.amount] as (string | number)[]),
    ["수입 공급가액", s.revenue],
    ["부가세", s.revenueVat],
    ["청구 총액", s.revenueTotal],
    [],
    ["입금 일정", "금액", "받기로 한 날", "입금일", "상태"],
    ...(p.installments ?? []).map(
      (i) =>
        [i.kind, i.amount, i.dueDate ?? "", i.paidDate ?? "", INSTALLMENT_STATUS_LABEL[installmentStatus(i)]] as (
          | string
          | number
        )[],
    ),
    ...(p.revenues ?? []).map(
      (r) =>
        [`추가 · ${r.label}`, r.amount, "", r.receivedDate ?? "", isReceived(r) ? "입금" : "예정"] as (
          | string
          | number
        )[],
    ),
    ["받은 돈", s.received],
    ["미수금", s.unpaid],
    ...(s.overdue > 0 ? [["연체", s.overdue] as (string | number)[]] : []),
    [],
    ["견적 원가", s.estimate],
    ["실제 원가", s.actual],
    [],
    ["예상 이익", s.profitEstimate],
    ["예상 이익률", formatMargin(s.marginEstimate)],
    ["실질 이익", s.profitActual],
    ["실질 이익률", formatMargin(s.marginActual)],
    [],
    ["원장 참고 · 거래 수", s.ledger.count],
    ["원장 참고 · 수입", s.ledger.income],
    ["원장 참고 · 지출", s.ledger.expense],
  ];
  const ws2 = XLSX.utils.aoa_to_sheet(pl);
  ws2["!cols"] = [{ wch: 22 }, { wch: 16 }, { wch: 14 }, { wch: 14 }, { wch: 8 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "지출");
  XLSX.utils.book_append_sheet(wb, ws2, "손익");
  XLSX.writeFile(wb, `${p.code}_지출.xlsx`);
}

// ---- 엑셀 → 줄 (가져오기) ----------------------------------------

/** 머리글 별칭 — 팀마다 열 이름이 조금씩 다르다 */
const COLS: Record<keyof ParsedCols, string[]> = {
  category: ["분류", "구분", "카테고리"],
  item: ["제품명", "품목", "항목", "품명", "내용"],
  qty: ["수량"],
  unit: ["단위"],
  unitPrice: ["단가"],
  vendor: ["발주처", "구매처", "거래처", "업체"],
  location: ["위치", "보관", "담당"],
  preparedQty: ["준비수량", "준비"],
  actual: ["실제금액", "실제", "실지출"],
  note: ["비고", "메모"],
};
interface ParsedCols {
  category?: number;
  item?: number;
  qty?: number;
  unit?: number;
  unitPrice?: number;
  vendor?: number;
  location?: number;
  preparedQty?: number;
  actual?: number;
  note?: number;
}

const cellStr = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim();
const cellNum = (v: unknown): number | undefined => {
  if (v === null || v === undefined || v === "") return undefined;
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  const n = Number(String(v).replace(/[,원\s]/g, ""));
  return Number.isFinite(n) ? n : undefined;
};

/**
 * 체크리스트 엑셀을 줄 목록으로. 첫 시트에서 「분류」와 「수량」이 함께 있는
 * 행을 머리글로 잡고 그 아래를 읽는다. 「합계」「소계」 행을 만나면 멈춘다.
 * 금액(수량×단가) 열은 읽지 않는다 — 화면에서 다시 계산한다.
 */
export function parseChecklistXlsx(buf: ArrayBuffer): { lines: FinProjectLine[]; skipped: number; error?: string } {
  const wb = XLSX.read(buf, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) return { lines: [], skipped: 0, error: "시트가 없습니다." };
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: null });

  let headerAt = -1;
  const cols: ParsedCols = {};
  for (let i = 0; i < Math.min(rows.length, 30); i += 1) {
    const cells = (rows[i] ?? []).map(cellStr);
    const found: ParsedCols = {};
    (Object.keys(COLS) as (keyof ParsedCols)[]).forEach((k) => {
      const idx = cells.findIndex((c) => COLS[k].some((alias) => c === alias || c.startsWith(alias)));
      if (idx >= 0) found[k] = idx;
    });
    if (found.qty !== undefined && (found.item !== undefined || found.category !== undefined)) {
      headerAt = i;
      Object.assign(cols, found);
      break;
    }
  }
  if (headerAt < 0) {
    return { lines: [], skipped: 0, error: "머리글을 찾지 못했습니다. 「분류 · 제품명 · 수량 · 단가」 열이 있어야 합니다." };
  }

  const lines: FinProjectLine[] = [];
  let skipped = 0;
  let lastCategory = "";
  for (let i = headerAt + 1; i < rows.length; i += 1) {
    const r = rows[i] ?? [];
    const at = (k: keyof ParsedCols) => (cols[k] === undefined ? null : r[cols[k] as number]);
    const item = cellStr(at("item"));
    const catRaw = cellStr(at("category"));
    if (/^(합계|총계|소계)$/.test(catRaw) || /^(합계|총계|소계)$/.test(item)) break;
    if (!item) {
      // 품목 없는 줄 — 완전히 빈 줄이면 건너뛰고, 뭔가 있으면 셌다가 알려준다
      if (r.some((v) => cellStr(v))) skipped += 1;
      continue;
    }
    // 분류가 비면 바로 위 줄의 분류를 잇는다 (병합 셀로 만든 표가 그렇다)
    const category = catRaw || lastCategory;
    lastCategory = category;
    lines.push(
      sanitizeLine({
        category,
        item,
        qty: cellNum(at("qty")) ?? 1,
        unit: cellStr(at("unit")) || undefined,
        unitPrice: cellNum(at("unitPrice")),
        vendor: cellStr(at("vendor")).replace(/^-$/, "") || undefined,
        location: cellStr(at("location")).replace(/^-$/, "") || undefined,
        preparedQty: cellNum(at("preparedQty")),
        actual: cellNum(at("actual")),
        note: cellStr(at("note")) || undefined,
      }),
    );
  }
  return { lines, skipped };
}
