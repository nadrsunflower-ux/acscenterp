// ============================================================
//  계약서 → 인쇄 / PDF
// ------------------------------------------------------------
//  견적서와 같은 길이다 — 화면의 시트(ContractSheet)를 떠서 새 창에 옮기고
//  브라우저 인쇄 대화상자를 연다(quote-pdf.ts). 렌더러가 하나뿐이라
//  고치는 화면과 나가는 종이가 어긋날 자리가 없다.
//
//  판형은 우리가 받아 본 계약서들의 꼴을 따랐다: 가운데 큰 제목, 전문,
//  「계약의 개요」 표, 조항, 맺음말, 날짜, 양쪽 서명란. 글자는 10pt 남짓
//  (13.5px) — 계약서는 여러 장이고 조항을 끝까지 읽어야 하는 종이라
//  견적서(12px)보다 크게 잡았다.
//
//  여러 장으로 넘어간다. 조항 제목이 쪽 끝에 홀로 남지 않게 하고, 맺음말·
//  날짜·서명란은 한 덩어리로 다음 쪽에 넘긴다 — 서명란만 덜렁 넘어간
//  계약서는 앞장을 바꿔 끼울 수 있어 보인다. 쪽 번호는 아래 가운데에
//  「- 1 -」 로 찍는다(크롬 131+. 모르는 브라우저는 그냥 안 찍는다).
// ============================================================

import { openPrintWindow } from "./quote-pdf";

/** 인쇄창·화면 시트가 같이 쓰는 판형. 이 파일이 종이의 생김새를 혼자 정한다 */
export const CONTRACT_CSS = `
  .csheet { font-family: "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", sans-serif; color: #18181b; background: #fff; font-size: 13.5px; line-height: 1.75; word-break: keep-all; overflow-wrap: anywhere; }
  .csheet h1 { margin: 0 0 22px; text-align: center; font-size: 22px; font-weight: 800; line-height: 1.45; white-space: pre-wrap; }
  .csheet h2 { margin: 20px 0 6px; font-size: 14.5px; font-weight: 700; }
  .csheet .pre { margin: 0; white-space: pre-wrap; }
  .csheet table { border-collapse: collapse; width: 100%; }
  .csheet th, .csheet td { border: 1px solid #52525b; padding: 5px 9px; vertical-align: middle; }
  .csheet th { background: #f4f4f5; font-weight: 600; text-align: center; }
  .csheet .terms th { width: 132px; }
  .csheet .terms th .role { display: block; font-weight: 400; font-size: 12px; color: #52525b; line-height: 1.3; }
  .csheet .terms td { white-space: pre-wrap; }
  .csheet .terms td b { font-weight: 700; }
  .csheet .items thead th { background: #e4e4e7; white-space: nowrap; }
  .csheet .items td { text-align: center; }
  .csheet .items td.name { width: 30%; text-align: left; }
  .csheet .items td.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .csheet .items tr.sum td { background: #f4f4f5; font-weight: 700; }
  .csheet .clause { margin-top: 14px; }
  .csheet .clause h3 { margin: 0; font-size: 13.5px; font-weight: 700; }
  .csheet .clause .c-text { white-space: pre-wrap; }
  .csheet .closing { margin-top: 26px; white-space: pre-wrap; }
  .csheet .signed { margin: 30px 0 18px; text-align: center; font-size: 15px; white-space: pre; }
  .csheet .sign th { width: 108px; white-space: nowrap; }
  .csheet .sign th.who { background: #e4e4e7; }
  .csheet .sign td { width: calc(50% - 108px); }
  /* 인감은 「(인)」 위에 겹쳐 찍는다 — 손으로 찍은 도장이 글자를 물듯이 */
  .csheet .sign td.ceo { position: relative; padding-right: 60px; }
  .csheet .sign td.ceo .stamp { position: absolute; right: 12px; top: 50%; transform: translateY(-50%); color: #71717a; }
  .csheet .sign td.ceo .seal {
    position: absolute; right: 4px; top: 50%; transform: translateY(-50%);
    width: 46px; height: 46px; object-fit: contain; pointer-events: none;
    mix-blend-mode: multiply; opacity: 0.92;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
`;

const PRINT_CSS = `
  .csheet .clause h3 { break-after: avoid; }
  .csheet .tail { break-inside: avoid; }
  .csheet tr { break-inside: avoid; }
  .csheet .items thead { display: table-header-group; }
`;

/** 인쇄창을 연다. 팝업이 차단되면 false */
export const openContractPdf = (bodyHtml: string, title: string): boolean =>
  openPrintWindow({
    bodyHtml,
    title,
    css: CONTRACT_CSS,
    printCss: PRINT_CSS,
    page: 'size: A4 portrait; margin: 20mm 18mm 18mm; @bottom-center { content: "- " counter(page) " -"; font-size: 9pt; color: #52525b; }',
  });
