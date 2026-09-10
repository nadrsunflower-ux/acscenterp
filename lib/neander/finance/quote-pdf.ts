// ============================================================
//  견적서 → 인쇄 / PDF
// ------------------------------------------------------------
//  새 창에 인쇄용 HTML 을 그리고 브라우저 인쇄 대화상자를 연다.
//  「PDF로 저장」 을 고르면 파일이 된다 (chat-pdf.ts 와 같은 방식).
//
//  판형은 「2026FNC_납품가_계산기 › 견적서(최종)」 시트를 그대로 옮겼다.
//  왼쪽 위에 견적번호·제목·수신, 오른쪽 위에 공급자 표, 그 아래 견적명·
//  납품기한·지불방식·유효기간, 「일금 ○○원정 (₩ ○○) VAT 포함」, 품명 표,
//  합계. 받는 쪽이 늘 보던 꼴이라야 "이번엔 왜 다르지" 가 없다.
//
//  **인쇄본은 화면의 시트를 떠서 만든다.** 예전에는 데이터로 HTML 을 따로
//  짰는데, 그러면 고치는 화면과 나가는 종이가 서로 다른 렌더러가 되어
//  한쪽만 고쳐지는 날이 온다. 지금은 QuoteSheet 하나뿐이고, 여기서는 그
//  DOM 을 받아 입력칸을 값의 글자로 바꾸고 종이에 없어야 할 것을 떼어
//  낼 뿐이다.
//
//  A4 세로 한 장에 맞춘다. 줄이 스무 개를 넘으면 다음 장으로 넘어가되
//  표 머리를 다시 찍는다 (thead 반복은 브라우저가 해 준다).
// ============================================================

const esc = (s: string) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * 화면의 견적서 시트 DOM → 인쇄용 HTML.
 *
 * 세 가지만 한다.
 *  1. `data-noprint` 를 떼어 낸다 — 줄 지우기 단추, 날짜 덮개, 인감 셀렉트.
 *  2. 비어 있으면 통째로 빠져야 하는 자리(`data-print-drop-if-empty`) 를 지운다 — 메모.
 *  3. 입력칸을 그 값의 **글자** 로 바꾼다. 화면에서 「12,000」 으로 보이던
 *     칸은 종이에도 「12,000」 으로 박힌다 — 보이는 것이 곧 결과다.
 *
 * 이미지 경로는 절대 URL 로 바꿔 둔다. 인쇄창은 about:blank 에 그리는 새
 * 창이라 「/images/...」 가 어디를 가리키는지 브라우저마다 다르다.
 */
export function sheetPrintHtml(sheet: HTMLElement): string {
  const clone = sheet.cloneNode(true) as HTMLElement;
  clone.classList.remove("sheet--edit");

  clone.querySelectorAll("[data-noprint]").forEach((el) => el.remove());

  clone.querySelectorAll("[data-print-drop-if-empty]").forEach((el) => {
    const f = el.querySelector<HTMLInputElement | HTMLTextAreaElement>("input, textarea");
    if (!f || !f.value.trim()) el.remove();
  });

  clone.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea").forEach((el) => {
    el.replaceWith(document.createTextNode(el.value));
  });

  clone.querySelectorAll("img").forEach((img) => {
    // img.src 는 속성이 상대경로여도 절대 URL 로 읽힌다 — 그 값을 속성에 되쓴다
    img.setAttribute("src", img.src);
    // 도장 파일이 없을 때 인쇄창에 깨진 이미지 아이콘이 뜨지 않게 한다.
    // 화면 쪽은 React 가 onError 로 잡지만, 인쇄본은 떠낸 HTML 뿐이라 혼자 살아야 한다.
    img.setAttribute("onerror", "this.remove()");
  });

  return clone.outerHTML;
}

/** 인쇄창·화면 시트가 같이 쓰는 판형. 이 파일이 종이의 생김새를 혼자 정한다 */
export const QUOTE_CSS = `
  .sheet { font-family: "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", sans-serif; color: #18181b; background: #fff; font-size: 12px; line-height: 1.5; }
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
  /* 인감은 대표자 칸에 겹쳐 찍는다 — 손으로 찍은 도장이 글자를 물듯이.
     칸이 20px 남짓이라 도장이 밖으로 넘치는데, 표를 밀지 않도록 absolute 로 띄운다. */
  .sheet .supplier td.ceo { position: relative; }
  .sheet .supplier td.ceo .seal {
    position: absolute; right: 4px; top: 50%; transform: translateY(-50%);
    width: 46px; height: 46px; object-fit: contain; pointer-events: none;
    mix-blend-mode: multiply; opacity: 0.92;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
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
  .sheet .breakdown { margin: 6px 0 0; text-align: right; color: #52525b; font-size: 11px; }
  .sheet .memo { margin-top: 14px; padding: 8px 10px; border: 1px dashed #a1a1aa; white-space: pre-wrap; font-size: 11.5px; color: #3f3f46; }
`;

/**
 * 인쇄창을 연다. 팝업이 차단되면 false — 호출한 쪽이 알린다.
 * 창 제목이 「PDF로 저장」의 기본 파일명이 된다.
 */
export function openQuotePdf(bodyHtml: string, title: string): boolean {
  const win = window.open("", "_blank");
  if (!win) return false;
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
  ${bodyHtml}
  <script>window.addEventListener("load", () => setTimeout(() => window.print(), 300));</script>
</body>
</html>`);
  win.document.close();
  return true;
}
