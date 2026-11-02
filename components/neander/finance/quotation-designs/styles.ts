/** The same rules accompany the editable preview, image export and print HTML. */
export const QUOTE_DESIGN_CSS = `
  .quotation-design, .quotation-design * { box-sizing: border-box; }
  .quotation-design { color: #1a1a2e; background: #fff; overflow-wrap: anywhere; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .quotation-design h1, .quotation-design p { max-width: 100%; }
  .quotation-design div { min-width: 0; }
  .quotation-design table { max-width: 100%; }
  .quotation-design .qd-items { table-layout: fixed; }
  .quotation-design .qd-items th, .quotation-design .qd-items td { vertical-align: top; overflow-wrap: anywhere; }
  .quotation-design .qd-items th { word-break: keep-all; overflow-wrap: normal; white-space: nowrap; }
  .quotation-design:not([data-design="5"]) .qd-items th:first-child { width: 44px !important; }
  .quotation-design .qd-line-note { display: block; margin-top: 3px; color: #636e72; font-size: 10px; font-weight: 400; white-space: pre-wrap; }
  .quotation-design .qd-price-basis { margin: 0 0 5px; color: #636e72; text-align: right; font-size: 10px; }
  .quotation-design .qd-terms dd { flex: 1; min-width: 0; }
  .quotation-design img { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  @media print {
    .quotation-design { width: 100% !important; min-height: 0 !important; padding: 24px 32px !important; line-height: 1.35 !important; }
    .quotation-design[data-design="2"] { padding: 0 !important; }
    .quotation-design .qd-dark-header { padding: 24px 32px !important; }
    .quotation-design .qd-body { padding: 24px 32px !important; }
    .quotation-design .qd-classic-frame { padding: 24px 28px !important; }
    .quotation-design .qd-heading { margin-bottom: 20px !important; }
    .quotation-design .qd-hero { margin-top: 16px !important; margin-bottom: 20px !important; }
    .quotation-design .qd-spacer { height: 16px !important; }
    .quotation-design .qd-footer { margin-top: 16px !important; }
    .quotation-design .qd-note { margin-top: 16px !important; padding: 12px !important; }
    .quotation-design thead { display: table-header-group; }
    .quotation-design tr { break-inside: avoid; page-break-inside: avoid; }
    .quotation-design .qd-terms, .quotation-design .qd-contact { break-inside: avoid; }
  }
`;
