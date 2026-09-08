// ============================================================
//  견적서 → 인쇄 / PDF
// ------------------------------------------------------------
//  chat-pdf.ts 와 같은 방식 — 새 창에 인쇄용 HTML 을 그리고 브라우저
//  인쇄 대화상자를 연다. 「PDF로 저장」 을 고르면 파일이 된다.
//
//  판형은 「2026FNC_납품가_계산기 › 견적서(최종)」 시트를 그대로 옮겼다.
//  왼쪽 위에 견적번호·제목·수신, 오른쪽 위에 공급자 표, 그 아래 견적명·
//  납품기한·지불방식·유효기간, 「일금 ○○원정 (₩ ○○) VAT 포함」, 품명 표,
//  합계. 받는 쪽이 늘 보던 꼴이라야 "이번엔 왜 다르지" 가 없다.
//
//  A4 세로 한 장에 맞춘다. 줄이 스무 개를 넘으면 다음 장으로 넘어가되
//  표 머리를 다시 찍는다 (thead 반복은 브라우저가 해 준다).
// ============================================================

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

const esc = (s: string) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const won = (n: number) => n.toLocaleString("ko-KR");

/** 견적서 본문 HTML — 미리보기와 인쇄창이 같은 것을 쓴다 */
export function quoteHtml(q: FinQuoteInput | FinQuoteDoc): string {
  const t = quoteTotals(q);
  const s = q.supplier;
  const vatLabel = QUOTE_VAT_LABEL[q.vatMode];
  const rows = q.lines
    .filter((l) => l.name.trim())
    .map(
      (l) => `<tr>
        <td class="name">${esc(l.name)}</td>
        <td>${esc(l.spec ?? "")}</td>
        <td class="num">${won(l.qty)}</td>
        <td class="num">${won(l.unitPrice)}</td>
        <td class="num">${won(quoteLineAmount(l))}</td>
        <td class="note">${esc(l.note ?? "")}</td>
      </tr>`,
    )
    .join("");

  return `
  <div class="sheet">
    <div class="head">
      <div class="left">
        <p class="no">견적번호 : ${esc(formatQuoteNo(q.quoteNo))}</p>
        <h1>견 적 서</h1>
        <p class="to"><b>${esc(q.recipient || "　")}</b> 님 귀하</p>
        <p class="date">${esc(koreanDate(q.date))}</p>
      </div>
      <table class="supplier">
        <tbody>
          <tr><th class="side" rowspan="5">공<br>급<br>자</th><th>사업자번호</th><td colspan="3">${esc(s.bizNo)}</td></tr>
          <tr><th>상　　호</th><td>${esc(s.name)}</td><th>대 표 자</th><td>${esc(s.ceo)}</td></tr>
          <tr><th>소 재 지</th><td colspan="3">${esc(s.address)}</td></tr>
          <tr><th>업　　태</th><td>${esc(s.bizType)}</td><th>종　　목</th><td>${esc(s.bizItem)}</td></tr>
          <tr><th>담 당 자</th><td>${esc(s.contact)}</td><th>연 락 처</th><td>${esc(s.phone)}</td></tr>
        </tbody>
      </table>
    </div>

    <p class="intro">아래와 같이 견적합니다.</p>

    <table class="terms">
      <tbody>
        <tr><th>견 적 명</th><td>${esc(q.title)}</td></tr>
        <tr><th>납품기한</th><td>${esc(q.delivery ?? "")}</td></tr>
        <tr><th>대금 지불방식</th><td>${esc(q.payment ?? "")}</td></tr>
        <tr><th>견적 유효기간</th><td>${esc(q.validity ?? "")}</td></tr>
        <tr class="total">
          <th>합계금액<br><span>(공급가액+세액)</span></th>
          <td>일금 <b>${esc(koreanNumber(t.total))}</b> 원정 <span class="won">(₩ ${won(t.total)})</span> <span class="vat">${esc(vatLabel)}</span></td>
        </tr>
      </tbody>
    </table>

    <table class="lines">
      <thead>
        <tr>
          <th class="name">품명</th>
          <th>규격/사양</th>
          <th class="num">수량</th>
          <th class="num">단가</th>
          <th class="num">공급가액</th>
          <th class="note">비고</th>
        </tr>
      </thead>
      <tbody>
        ${rows || '<tr><td colspan="6" class="empty">품목이 없습니다</td></tr>'}
        <tr class="sum">
          <td class="name">합계</td>
          <td></td>
          <td class="num">${won(t.qty)}</td>
          <td></td>
          <td class="num">${won(t.sum)}</td>
          <td class="note">${esc(vatLabel)}</td>
        </tr>
      </tbody>
    </table>

    ${
      q.vatMode === "excluded"
        ? `<p class="breakdown">공급가액 ${won(t.supply)} + 부가세 ${won(t.vat)} = 합계 ${won(t.total)}</p>`
        : `<p class="breakdown">합계 ${won(t.total)} 안에 부가세 ${won(t.vat)} 이 들어 있습니다 (공급가액 ${won(t.supply)})</p>`
    }
    ${q.note ? `<div class="memo">${esc(q.note).replace(/\n/g, "<br>")}</div>` : ""}
  </div>`;
}

/** 인쇄창·미리보기가 같이 쓰는 스타일 */
export const QUOTE_CSS = `
  .sheet { font-family: "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", sans-serif; color: #18181b; font-size: 12px; line-height: 1.5; }
  .sheet table { border-collapse: collapse; width: 100%; }
  .sheet th, .sheet td { border: 1px solid #52525b; padding: 4px 7px; vertical-align: middle; }
  .sheet th { background: #f4f4f5; font-weight: 600; text-align: center; white-space: nowrap; }
  .sheet .head { display: flex; gap: 18px; align-items: stretch; }
  .sheet .left { flex: 0 0 38%; display: flex; flex-direction: column; }
  .sheet .left .no { margin: 0 0 6px; font-size: 12px; }
  .sheet .left h1 { margin: 0 0 14px; font-size: 30px; letter-spacing: 0.35em; font-weight: 800; }
  .sheet .left .to { margin: auto 0 4px; font-size: 15px; }
  .sheet .left .to b { font-size: 17px; margin-right: 8px; }
  .sheet .left .date { margin: 0; color: #3f3f46; }
  .sheet .supplier { flex: 1; font-size: 11.5px; }
  .sheet .supplier th.side { width: 22px; background: #e4e4e7; font-size: 13px; line-height: 1.3; }
  .sheet .supplier th { width: 68px; }
  .sheet .supplier td { min-width: 90px; }
  .sheet .intro { margin: 14px 0 6px; font-size: 12.5px; }
  .sheet .terms th { width: 110px; text-align: center; }
  .sheet .terms td { text-align: left; }
  .sheet .terms tr.total th span { font-weight: 400; font-size: 10.5px; }
  .sheet .terms tr.total td { font-size: 14px; padding: 8px 10px; }
  .sheet .terms tr.total td b { font-size: 16px; margin: 0 2px; }
  .sheet .terms tr.total .won { margin-left: 8px; }
  .sheet .terms tr.total .vat { float: right; font-size: 11px; color: #3f3f46; }
  .sheet .lines { margin-top: 12px; }
  .sheet .lines thead th { background: #e4e4e7; }
  .sheet .lines th.name, .sheet .lines td.name { width: 34%; text-align: left; }
  .sheet .lines th.note, .sheet .lines td.note { width: 12%; }
  .sheet .lines td { text-align: center; }
  .sheet .lines td.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .sheet .lines tr.sum td { background: #f4f4f5; font-weight: 700; }
  .sheet .lines td.empty { color: #a1a1aa; padding: 14px; }
  .sheet .breakdown { margin: 6px 0 0; text-align: right; color: #52525b; font-size: 11px; }
  .sheet .memo { margin-top: 14px; padding: 8px 10px; border: 1px dashed #a1a1aa; white-space: pre-wrap; font-size: 11.5px; color: #3f3f46; }
`;

/**
 * 인쇄창을 연다. 팝업이 차단되면 false — 호출한 쪽이 알린다.
 * 창 제목이 「PDF로 저장」의 기본 파일명이 된다.
 */
export function openQuotePdf(q: FinQuoteInput | FinQuoteDoc): boolean {
  const win = window.open("", "_blank");
  if (!win) return false;
  const title = quoteFileStem(q);
  win.document.write(`<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<title>${esc(title)}</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0 auto; padding: 36px 40px; max-width: 820px; background: #fff; }
  ${QUOTE_CSS}
  .print-btn {
    position: fixed; top: 16px; right: 16px; border: 0; border-radius: 8px;
    background: #4f46e5; color: #fff; padding: 8px 14px; font-size: 13px; cursor: pointer;
  }
  @media print {
    .print-btn { display: none; }
    body { padding: 0; max-width: none; }
    .sheet .lines thead { display: table-header-group; }
    .sheet tr { page-break-inside: avoid; }
  }
  @page { size: A4 portrait; margin: 16mm 14mm; }
</style>
</head>
<body>
  <button type="button" class="print-btn" onclick="window.print()">인쇄 / PDF 저장</button>
  ${quoteHtml(q)}
  <script>window.addEventListener("load", () => setTimeout(() => window.print(), 300));</script>
</body>
</html>`);
  win.document.close();
  return true;
}
