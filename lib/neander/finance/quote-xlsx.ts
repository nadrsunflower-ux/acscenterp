// ============================================================
//  견적서 → 엑셀
// ------------------------------------------------------------
//  원본이 엑셀 시트였고, 받는 쪽이 숫자를 고쳐 되보내는 일이 있어 엑셀도
//  뽑는다. 「견적서(최종)」 시트와 같은 칸 자리(B2 견적번호, G2~P6 공급자
//  표, B8~ 견적명, 17행부터 품목)에 넣고 병합도 그대로 건다. 다만 테두리·
//  글꼴은 못 넣는다 — 쓰는 SheetJS(커뮤니티판)가 셀 서식을 안 쓴다.
//  보기 좋은 쪽은 PDF 다. 엑셀은 "숫자를 만질 수 있는 사본" 이다.
// ============================================================

import * as XLSX from "xlsx";
import {
  QUOTE_VAT_LABEL,
  formatQuoteNo,
  koreanDate,
  koreanNumber,
  quoteFileStem,
  quoteLineAmount,
  quoteTotals,
  type FinQuoteDoc,
  type FinQuoteInput,
} from "./docs";
import { resolveSeal } from "./supplier";

type Cell = string | number | null;

export function exportQuoteXlsx(q: FinQuoteInput | FinQuoteDoc) {
  const t = quoteTotals(q);
  const s = q.supplier;
  const lines = q.lines.filter((l) => l.name.trim());
  const vat = QUOTE_VAT_LABEL[q.vatMode];
  // SheetJS 커뮤니티판은 이미지를 못 넣는다. 도장 자리에 「(인)」 만 적어 두고,
  // 도장이 찍힌 종이가 필요하면 PDF 쪽으로 보낸다.
  const ceo = resolveSeal(q.sealId) ? `${s.ceo} (인)` : s.ceo;

  // 열: A(빈) B C D E F G H I J K L M N O P — 원본과 같은 자리
  const rows: Cell[][] = [];
  const put = (r: number, c: number, v: Cell) => {
    while (rows.length <= r) rows.push([]);
    rows[r][c] = v;
  };
  const C = (letter: string) => letter.charCodeAt(0) - 65;

  put(1, C("B"), `견적번호 : ${formatQuoteNo(q.quoteNo)}`);
  put(1, C("F"), "공 급 자");
  put(1, C("G"), "사업자번호");
  put(1, C("I"), s.bizNo);
  put(2, C("B"), "견적서");
  put(2, C("G"), "상     호");
  put(2, C("I"), s.name);
  put(2, C("L"), "대 표 자");
  put(2, C("O"), ceo);
  put(3, C("G"), "소 재 지");
  put(3, C("I"), s.address);
  put(4, C("B"), `${q.recipient} 님 귀하\n\n${koreanDate(q.date)}`);
  put(4, C("G"), "업     태");
  put(4, C("I"), s.bizType);
  put(4, C("L"), "종     목");
  put(4, C("O"), s.bizItem);
  put(5, C("G"), "담 당 자");
  put(5, C("I"), s.contact);
  put(5, C("L"), "연 락 처");
  put(5, C("O"), s.phone);
  put(6, C("B"), "아래와 같이 견적합니다.");
  put(7, C("B"), "견 적 명");
  put(7, C("C"), q.title);
  put(8, C("B"), "납품기한");
  put(8, C("C"), q.delivery ?? "");
  put(9, C("B"), "대금 지불방식");
  put(9, C("C"), q.payment ?? "");
  put(10, C("B"), "견적 유효기간");
  put(10, C("C"), q.validity ?? "");
  put(11, C("B"), "합계금액\n(공급가액+세액)");
  put(12, C("C"), "일금");
  put(12, C("D"), koreanNumber(t.total));
  put(12, C("I"), "원정");
  put(12, C("J"), "(₩");
  put(12, C("K"), t.total);
  put(12, C("N"), ")");
  put(12, C("O"), vat);
  put(15, C("B"), "품명");
  put(15, C("E"), "규격/사양");
  put(15, C("H"), "수량");
  put(15, C("J"), "단가");
  put(15, C("M"), "공급가액");
  put(15, C("P"), "비고");
  let r = 16;
  lines.forEach((l) => {
    put(r, C("B"), l.name);
    put(r, C("E"), l.spec ?? "");
    put(r, C("H"), l.qty);
    put(r, C("J"), l.unitPrice);
    put(r, C("M"), quoteLineAmount(l));
    put(r, C("P"), l.note ?? "");
    r += 1;
  });
  put(r, C("B"), "합계");
  put(r, C("H"), t.qty);
  put(r, C("M"), t.sum);
  put(r, C("P"), vat);
  if (q.vatMode === "excluded") {
    put(r + 1, C("M"), `부가세 ${t.vat.toLocaleString("ko-KR")} 별도 · 합계 ${t.total.toLocaleString("ko-KR")}`);
  }
  if (q.note) put(r + 3, C("B"), q.note);

  const ws = XLSX.utils.aoa_to_sheet(rows);
  const m = (s1: string, e1: string) => XLSX.utils.decode_range(`${s1}:${e1}`);
  const merges = [
    m("B2", "E2"), m("F2", "F6"), m("G2", "H2"), m("I2", "P2"),
    m("B3", "E4"), m("G3", "H3"), m("I3", "K3"), m("L3", "N3"), m("O3", "P3"),
    m("G4", "H4"), m("I4", "P4"),
    m("B5", "E6"), m("G5", "H5"), m("I5", "K5"), m("L5", "N5"), m("O5", "P5"),
    m("G6", "H6"), m("I6", "K6"), m("L6", "N6"), m("O6", "P6"),
    m("B7", "P7"), m("C8", "P8"), m("C9", "P9"), m("C10", "P10"), m("C11", "P11"),
    m("B12", "B14"), m("D13", "H13"), m("K13", "M13"), m("O13", "P13"),
  ];
  // 품목 표 — 머리와 줄마다 같은 병합
  for (let i = 15; i <= r; i += 1) {
    const rr = i + 1;
    merges.push(m(`B${rr}`, `D${rr}`), m(`E${rr}`, `G${rr}`), m(`H${rr}`, `I${rr}`), m(`J${rr}`, `L${rr}`), m(`M${rr}`, `O${rr}`));
  }
  ws["!merges"] = merges;
  ws["!cols"] = [2, 14, 8, 8, 8, 4, 6, 6, 8, 6, 8, 6, 8, 6, 8, 12].map((w) => ({ wch: w }));

  // 숫자 칸에 천 단위 서식
  const numCells = ["K13"];
  for (let i = 16; i <= r; i += 1) numCells.push(`H${i + 1}`, `J${i + 1}`, `M${i + 1}`);
  numCells.forEach((a) => {
    const c = ws[a];
    if (c && typeof c.v === "number") c.z = "#,##0";
  });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "견적서");
  XLSX.writeFile(wb, `${quoteFileStem(q)}.xlsx`);
}
