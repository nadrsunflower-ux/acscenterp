// ============================================================
//  가정 장표 스타일 — 1600×900 캔버스 안에서 쓰는 sd- 접두 클래스
// ------------------------------------------------------------
//  색은 전부 변수로 쓴다. 화면(어두운 캔버스)과 인쇄본(밝은 종이)이 같은
//  부품을 쓰고 변수만 바꾼다. 차트 색은 dataviz 검증을 통과한 범주 색
//  (어두운 배경 #3987e5 · #d95926 · #199e70 · #c98500, 밝은 배경은 한 단계
//  진한 값)이다. 사업부 ①은 주황, ②는 파랑으로 모든 장에서 같다.
// ============================================================

export const SD_CSS = `
.dk-root, .sd-print {
  --sd-fg: #eef0e9;
  --sd-fg2: rgba(238,240,233,.74);
  --sd-fg3: rgba(238,240,233,.52);
  --sd-fg4: rgba(238,240,233,.34);
  --sd-line: rgba(148,163,184,.2);
  --sd-line2: rgba(148,163,184,.1);
  --sd-panel: rgba(148,163,184,.07);
  --sd-panel2: rgba(148,163,184,.13);
  --sd-accent: #7dd3fc;
  --sd-good: #34d399;
  --sd-bad: #f87171;
  --sd-warn: #fbbf24;
  --sd-a: #d95926;
  --sd-a-soft: rgba(217,89,38,.16);
  --sd-b: #3987e5;
  --sd-b-soft: rgba(57,135,229,.18);
  --sd-s1: #3987e5;
  --sd-s2: #d95926;
  --sd-s3: #199e70;
  --sd-s4: #c98500;
  --sd-muted-bar: rgba(148,163,184,.38);
}
.sd-print {
  --sd-fg: #121417;
  --sd-fg2: #3a3f47;
  --sd-fg3: #626873;
  --sd-fg4: #8a909a;
  --sd-line: #d9dce1;
  --sd-line2: #eceef1;
  --sd-panel: #f5f6f8;
  --sd-panel2: #eceef1;
  --sd-accent: #0b6fb8;
  --sd-good: #0d8a55;
  --sd-bad: #c62f2f;
  --sd-warn: #a86400;
  --sd-a: #c24e1c;
  --sd-a-soft: #fbe9e0;
  --sd-b: #2a6fc4;
  --sd-b-soft: #e3eefb;
  --sd-s1: #2a78d6;
  --sd-s2: #eb6834;
  --sd-s3: #1baf7a;
  --sd-s4: #eda100;
  --sd-muted-bar: #c3c8cf;
}

/* ---- 장표 틀 ---- */
.sd-slide {
  position: absolute; inset: 0;
  padding: 46px 72px 118px;
  display: flex; flex-direction: column;
  color: var(--sd-fg);
  font-size: 20px; line-height: 1.5; letter-spacing: -.01em;
  font-variant-numeric: tabular-nums;
}
.sd-head { display: flex; align-items: center; gap: 12px; font-size: 14px; letter-spacing: .08em; color: var(--sd-fg3); font-weight: 600; }
.sd-head .sd-no { color: var(--sd-accent); font-family: ui-monospace, "Cascadia Mono", Consolas, monospace; letter-spacing: .12em; }
.sd-head .sd-sep { width: 1px; height: 12px; background: var(--sd-line); }
.sd-title {
  margin-top: 12px;
  font-family: "Noto Serif KR", "Pretendard Variable", serif;
  font-weight: 700; font-size: 38px; line-height: 1.28; letter-spacing: -.025em;
  color: var(--sd-fg);
}
.sd-lead { margin-top: 10px; font-size: 20px; line-height: 1.5; color: var(--sd-fg2); max-width: 1320px; }
.sd-body { flex: 1; min-height: 0; margin-top: 22px; display: flex; flex-direction: column; gap: 16px; overflow: hidden; }
.sd-body > .sd-fill { flex: 1; min-height: 0; }
.sd-foot { margin-top: auto; padding-top: 8px; font-size: 12.5px; line-height: 1.45; color: var(--sd-fg4); display: flex; flex-wrap: wrap; gap: 2px 14px; }
.sd-foot b { color: var(--sd-fg3); font-weight: 600; }

/* 표지형 */
.sd-hero { justify-content: center; padding-top: 40px; }
.sd-hero .sd-title { font-size: 58px; line-height: 1.22; }
.sd-hero .sd-lead { font-size: 25px; margin-top: 18px; }

/* ---- 글 ---- */
.sd-text { color: var(--sd-fg); }
.sd-text.sd-muted { color: var(--sd-fg2); }
.sd-size-sm { font-size: 16.5px; line-height: 1.5; }
.sd-size-md { font-size: 21px; }
.sd-size-lg { font-size: 25px; line-height: 1.45; letter-spacing: -.02em; }
.sd-size-xl { font-size: 32px; line-height: 1.35; font-weight: 700; letter-spacing: -.025em; }
.sd-text b, .sd-bul b, .sd-table b, .sd-callout b, .sd-card b { font-weight: 700; color: var(--sd-fg); }
.sd-hl { color: var(--sd-accent); font-weight: 700; }
.sd-circ {
  display: inline-flex; align-items: center; justify-content: center;
  width: 1.08em; height: 1.08em; margin: 0 .1em; border-radius: 999px;
  border: .09em solid currentColor; font-size: .78em; font-weight: 800; line-height: 1;
  vertical-align: .1em; font-family: "Pretendard Variable", Pretendard, sans-serif; letter-spacing: 0;
}
.sd-fn { font-size: .62em; vertical-align: super; line-height: 0; color: var(--sd-accent); font-weight: 700; margin-left: 1px; }
.sd-a-text { color: var(--sd-a); font-weight: 700; }
.sd-b-text { color: var(--sd-b); font-weight: 700; }
.sd-bad-text { color: var(--sd-bad); font-weight: 700; }
.sd-good-text { color: var(--sd-good); font-weight: 700; }

.sd-bul { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 9px; }
.sd-bul > li { position: relative; padding-left: 22px; }
.sd-bul > li::before { content: ""; position: absolute; left: 4px; top: .68em; width: 7px; height: 7px; border-radius: 2px; background: var(--sd-accent); opacity: .85; }
.sd-bul.sd-num { counter-reset: sdn; }
.sd-bul.sd-num > li { padding-left: 34px; counter-increment: sdn; }
.sd-bul.sd-num > li::before {
  content: counter(sdn); width: 24px; height: 24px; top: .12em; left: 0; border-radius: 999px;
  background: var(--sd-panel2); color: var(--sd-accent); font-size: 14px; font-weight: 800; opacity: 1;
  display: flex; align-items: center; justify-content: center;
}
.sd-bul ul { margin: 5px 0 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 3px; }
.sd-bul ul li { position: relative; padding-left: 18px; font-size: .86em; color: var(--sd-fg2); }
.sd-bul ul li::before { content: "·"; position: absolute; left: 5px; color: var(--sd-fg3); }

/* ---- 표 ---- */
.sd-table-wrap { width: 100%; }
.sd-table { width: 100%; border-collapse: collapse; font-size: 18.5px; line-height: 1.4; table-layout: fixed; }
.sd-table.sd-xs { font-size: 13.5px; }
.sd-table.sd-xs th, .sd-table.sd-xs td { padding: 5px 8px; }
.sd-table.sd-lg { font-size: 21px; }
.sd-table.sd-lg th, .sd-table.sd-lg td { padding: 14px 14px; }
.sd-table.sd-sm { font-size: 15.5px; }
.sd-table.sd-sm th, .sd-table.sd-sm td { padding: 7px 9px; }
.sd-table th {
  text-align: left; font-size: .8em; font-weight: 700; color: var(--sd-fg3); letter-spacing: .02em;
  padding: 8px 11px; border-bottom: 1px solid var(--sd-line); vertical-align: bottom;
}
.sd-table td { padding: 9px 11px; border-bottom: 1px solid var(--sd-line2); vertical-align: top; color: var(--sd-fg2); overflow-wrap: anywhere; }
.sd-table td:first-child { color: var(--sd-fg); }
.sd-table .sd-r { text-align: right; }
.sd-table .sd-c { text-align: center; }
.sd-table tr.sd-strong td { background: var(--sd-panel); color: var(--sd-fg); font-weight: 700; }
.sd-table td.sd-strongcol { color: var(--sd-fg); font-weight: 700; }
.sd-table-note { margin-top: 6px; font-size: 13px; color: var(--sd-fg4); line-height: 1.45; }
.sd-chip-tier { display: inline-block; padding: 1px 8px; border-radius: 999px; font-size: .82em; font-weight: 700; background: var(--sd-b-soft); color: var(--sd-b); }

/* ---- 숫자 타일 ---- */
.sd-kpis { display: grid; gap: 12px; }
.sd-kpi { border: 1px solid var(--sd-line); border-radius: 14px; padding: 14px 18px; background: var(--sd-panel); min-width: 0; }
.sd-kpi-label { font-size: 14px; color: var(--sd-fg3); font-weight: 600; line-height: 1.35; }
.sd-kpi-value { margin-top: 6px; font-size: 34px; font-weight: 800; letter-spacing: -.03em; line-height: 1.15; color: var(--sd-fg); white-space: nowrap; }
.sd-kpi-sub { margin-top: 5px; font-size: 13.5px; color: var(--sd-fg3); line-height: 1.4; }
.sd-tone-good .sd-kpi-value { color: var(--sd-good); }
.sd-tone-bad .sd-kpi-value { color: var(--sd-bad); }
.sd-tone-warn .sd-kpi-value { color: var(--sd-warn); }
.sd-tone-accent .sd-kpi-value { color: var(--sd-accent); }
.sd-tone-a { border-color: var(--sd-a); }
.sd-tone-a .sd-kpi-value { color: var(--sd-a); }
.sd-tone-b { border-color: var(--sd-b); }
.sd-tone-b .sd-kpi-value { color: var(--sd-b); }

/* ---- 강조 상자 ---- */
.sd-callout { border-left: 4px solid var(--sd-accent); background: var(--sd-panel); border-radius: 0 12px 12px 0; padding: 12px 18px; font-size: 20px; line-height: 1.5; color: var(--sd-fg); }
.sd-callout-label { font-size: 13px; font-weight: 800; letter-spacing: .06em; color: var(--sd-accent); margin-bottom: 3px; }
.sd-callout.sd-tone-good { border-left-color: var(--sd-good); } .sd-callout.sd-tone-good .sd-callout-label { color: var(--sd-good); }
.sd-callout.sd-tone-bad { border-left-color: var(--sd-bad); } .sd-callout.sd-tone-bad .sd-callout-label { color: var(--sd-bad); }
.sd-callout.sd-tone-warn { border-left-color: var(--sd-warn); } .sd-callout.sd-tone-warn .sd-callout-label { color: var(--sd-warn); }
.sd-callout.sd-tone-a { border-left-color: var(--sd-a); } .sd-callout.sd-tone-a .sd-callout-label { color: var(--sd-a); }
.sd-callout.sd-tone-b { border-left-color: var(--sd-b); } .sd-callout.sd-tone-b .sd-callout-label { color: var(--sd-b); }
.sd-callout.sd-tone-muted { border-left-color: var(--sd-line); color: var(--sd-fg2); }

.sd-cols { display: grid; min-height: 0; }
.sd-col { display: flex; flex-direction: column; gap: 14px; min-width: 0; min-height: 0; }
.sd-card { border: 1px solid var(--sd-line); border-radius: 16px; padding: 16px 20px; background: var(--sd-panel); display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.sd-card-title { font-size: 17px; font-weight: 800; color: var(--sd-fg); letter-spacing: -.01em; }
.sd-card.sd-tone-a { border-color: var(--sd-a); background: var(--sd-a-soft); }
.sd-card.sd-tone-a .sd-card-title { color: var(--sd-a); }
.sd-card.sd-tone-b { border-color: var(--sd-b); background: var(--sd-b-soft); }
.sd-card.sd-tone-b .sd-card-title { color: var(--sd-b); }
.sd-card.sd-tone-bad { border-color: var(--sd-bad); }
.sd-card.sd-tone-bad .sd-card-title { color: var(--sd-bad); }
.sd-card.sd-tone-good { border-color: var(--sd-good); }
.sd-card.sd-tone-good .sd-card-title { color: var(--sd-good); }
.sd-card.sd-tone-warn .sd-card-title { color: var(--sd-warn); }
.sd-card .sd-bul { gap: 6px; font-size: 18.5px; }
.sd-card .sd-text { font-size: 18.5px; }

.sd-steps { display: flex; gap: 10px; align-items: stretch; }
.sd-steps.sd-col-dir { flex-direction: column; }
.sd-step { flex: 1; min-width: 0; border: 1px solid var(--sd-line); border-radius: 14px; padding: 12px 14px; background: var(--sd-panel); position: relative; }
.sd-step-n { font-size: 12px; font-weight: 800; color: var(--sd-accent); letter-spacing: .1em; }
.sd-step-t { font-size: 18.5px; font-weight: 800; margin-top: 2px; line-height: 1.35; }
.sd-step-b { font-size: 15.5px; color: var(--sd-fg2); margin-top: 4px; line-height: 1.45; }

/* ---- 차트 ---- */
.sd-bars { display: flex; flex-direction: column; gap: 10px; }
.sd-bar-row { display: grid; grid-template-columns: 170px 1fr 120px; align-items: center; gap: 12px; font-size: 16px; }
.sd-bar-label { color: var(--sd-fg2); font-size: 15px; line-height: 1.3; }
.sd-bar-track { position: relative; height: 22px; }
.sd-bar-fill { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 0 4px 4px 0; }
.sd-bar-val { text-align: right; font-weight: 700; color: var(--sd-fg); }
.sd-stack { display: flex; height: 46px; width: 100%; gap: 2px; }
.sd-stack > div { height: 100%; min-width: 2px; }
.sd-stack > div:first-child { border-radius: 4px 0 0 4px; }
.sd-stack > div:last-child { border-radius: 0 4px 4px 0; }
.sd-legend { display: flex; flex-wrap: wrap; gap: 6px 18px; font-size: 14px; color: var(--sd-fg2); }
.sd-legend i { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 6px; vertical-align: -1px; }
.sd-svg text { font-family: inherit; }

/* ---- 매물 ---- */
.sd-prop { display: grid; grid-template-columns: 560px 1fr; gap: 22px; flex: 1; min-height: 0; }
.sd-map { position: relative; border-radius: 16px; overflow: hidden; border: 1px solid var(--sd-line); background: var(--sd-panel); }
.sd-map-tiles { position: absolute; inset: 0; }
/* 전역 img { max-width: 100% } 를 풀어야 타일이 제 크기로 깔린다 */
.sd-map-tiles img { position: absolute; width: 256px; height: 256px; max-width: none; display: block; }
.sd-map-dim { position: absolute; inset: 0; background: rgba(10,13,20,.18); pointer-events: none; }
.sd-pin { position: absolute; transform: translate(-50%, -100%); display: flex; flex-direction: column; align-items: center; }
.sd-pin-dot { min-width: 30px; height: 30px; padding: 0 6px; border-radius: 999px; background: var(--sd-a); color: #fff; font-size: 15px; font-weight: 800; display: flex; align-items: center; justify-content: center; border: 2px solid #fff; box-shadow: 0 2px 8px rgba(0,0,0,.35); }
.sd-pin-stem { width: 2px; height: 9px; background: #fff; }
.sd-pin.sd-pin-home .sd-pin-dot { background: #111827; }
.sd-pin.sd-pin-approx .sd-pin-dot { border-style: dashed; }
.sd-map-attr { position: absolute; right: 6px; bottom: 4px; font-size: 10px; color: #333; background: rgba(255,255,255,.75); padding: 1px 5px; border-radius: 4px; }
.sd-map-key { position: absolute; left: 10px; top: 10px; font-size: 12.5px; background: rgba(10,13,20,.78); color: #eef0e9; border-radius: 8px; padding: 5px 9px; line-height: 1.5; }
.sd-map-empty { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: var(--sd-fg3); font-size: 15px; }
.sd-cards4 { display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr; gap: 14px; min-height: 0; }
.sd-pcard { display: grid; grid-template-columns: 150px 1fr; gap: 12px; border: 1px solid var(--sd-line); border-radius: 14px; background: var(--sd-panel); overflow: hidden; min-height: 0; }
.sd-pcard-photo { position: relative; background: var(--sd-panel2); min-height: 0; }
.sd-pcard-photo img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.sd-pcard-photo .sd-nophoto { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: var(--sd-fg3); font-size: 13px; }
.sd-pcard-no { position: absolute; left: 8px; top: 8px; min-width: 26px; height: 26px; border-radius: 999px; background: var(--sd-a); color: #fff; font-size: 14px; font-weight: 800; display: flex; align-items: center; justify-content: center; border: 2px solid #fff; }
.sd-pcard-body { padding: 10px 12px 10px 0; display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.sd-pcard-loc { font-size: 16px; font-weight: 800; line-height: 1.3; }
.sd-pcard-meta { font-size: 14px; color: var(--sd-fg2); line-height: 1.4; }
.sd-pcard-money { font-size: 15.5px; font-weight: 700; color: var(--sd-fg); }
.sd-pcard-feat { font-size: 14px; color: var(--sd-fg2); line-height: 1.45; margin-top: 6px; padding-top: 8px; border-top: 1px solid var(--sd-line2); }
.sd-verdict { font-size: 19px; }

/* ---- 가정 칩·배지 (캔버스 위) ---- */
.sd-chips { position: absolute; left: 72px; right: 72px; bottom: 66px; display: flex; gap: 6px; align-items: center; flex-wrap: nowrap; overflow: hidden; }
.sd-chips-label { font-size: 12px; font-weight: 800; color: var(--sd-fg4); letter-spacing: .08em; margin-right: 4px; white-space: nowrap; }
.sd-chip {
  display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 10px; border-radius: 999px;
  border: 1px solid var(--sd-line); background: rgba(15,18,28,.8); color: var(--sd-fg2);
  font-size: 13px; white-space: nowrap; cursor: pointer; font-family: inherit;
}
.sd-chip b { color: var(--sd-fg); font-weight: 700; }
.sd-chip:hover { border-color: var(--sd-accent); color: var(--sd-fg); }
.sd-chip.sd-chip-on { border-color: var(--sd-warn); }
.sd-chip.sd-chip-on b { color: var(--sd-warn); }
.sd-chip-kind { font-size: 11px; font-weight: 800; color: var(--sd-fg4); }
.sd-chip-more { color: var(--sd-accent); }
.sd-badge {
  position: absolute; right: 72px; top: 40px; display: flex; gap: 8px;
}
.sd-badge span { height: 26px; padding: 0 10px; border-radius: 999px; font-size: 12.5px; font-weight: 800; display: inline-flex; align-items: center; letter-spacing: .02em; }
.sd-badge .sd-b-changed { background: rgba(251,191,36,.16); color: var(--sd-warn); border: 1px solid rgba(251,191,36,.5); }
.sd-badge .sd-b-snap { background: rgba(248,113,113,.14); color: var(--sd-bad); border: 1px solid rgba(248,113,113,.45); }

/* 칩 편집 창 (캔버스 안, 칩 위) */
.sd-pop {
  position: absolute; bottom: 104px; width: 380px; z-index: 5;
  background: #141926; border: 1px solid rgba(148,163,184,.35); border-radius: 14px; padding: 14px 16px;
  box-shadow: 0 18px 40px rgba(0,0,0,.45); color: #eef0e9; font-size: 14px;
}
.sd-pop-title { font-size: 15px; font-weight: 800; }
.sd-pop-src { margin-top: 4px; font-size: 12.5px; color: rgba(238,240,233,.55); line-height: 1.45; }
.sd-pop-row { display: flex; gap: 8px; align-items: center; margin-top: 10px; }
.sd-pop input[type=number] { flex: 1; height: 34px; border-radius: 8px; border: 1px solid rgba(148,163,184,.4); background: #0b0f18; color: #fff; padding: 0 10px; font-size: 15px; font-family: inherit; }
.sd-pop input[type=range] { width: 100%; margin-top: 8px; accent-color: #7dd3fc; }
.sd-pop button { height: 32px; padding: 0 12px; border-radius: 8px; border: 1px solid rgba(148,163,184,.35); background: rgba(148,163,184,.1); color: #eef0e9; font-size: 13px; font-weight: 700; cursor: pointer; font-family: inherit; }
.sd-pop button.sd-primary { background: #7dd3fc; color: #04121c; border-color: #7dd3fc; }
.sd-pop-meta { margin-top: 8px; font-size: 12px; color: rgba(238,240,233,.55); }
.sd-pop-close { position: absolute; right: 8px; top: 8px; height: 26px !important; width: 26px; padding: 0 !important; }

/* 하단 단추 */
.dk-btn.sd-on { background: var(--dk-accent); color: #04060a; border-color: var(--dk-accent); }
.sd-ctrl-txt { font-size: 11.5px; font-weight: 800; letter-spacing: .02em; width: auto !important; padding: 0 9px; }
.sd-snap-flag { font-size: 11.5px; font-weight: 800; color: #f87171; border: 1px solid rgba(248,113,113,.5); border-radius: 999px; padding: 3px 9px; margin-right: 4px; white-space: nowrap; }
`;

/** 화면 밖에 뜨는 것 — 가정 패널·발표자 노트 (캔버스 비율과 무관한 보통 크기) */
export const SD_OVERLAY_CSS = `
.sd-panel {
  position: fixed; top: 0; right: 0; bottom: 0; z-index: 130;
  width: min(460px, 100vw); display: flex; flex-direction: column;
  background: #10141f; color: #eef0e9; border-left: 1px solid rgba(148,163,184,.25);
  box-shadow: -18px 0 40px rgba(0,0,0,.4); font-family: "Pretendard Variable", Pretendard, sans-serif;
  font-size: 14px; letter-spacing: -.01em;
}
.sd-panel * { box-sizing: border-box; }
.sd-panel-head { padding: 14px 16px 10px; border-bottom: 1px solid rgba(148,163,184,.18); display: flex; flex-direction: column; gap: 10px; }
.sd-panel-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.sd-panel-title { font-size: 16px; font-weight: 800; }
.sd-panel-sub { font-size: 12px; color: rgba(238,240,233,.55); }
.sd-panel-actions { display: flex; flex-wrap: wrap; gap: 6px; }
.sd-panel button, .sd-panel select {
  height: 30px; padding: 0 10px; border-radius: 8px; border: 1px solid rgba(148,163,184,.3);
  background: rgba(148,163,184,.08); color: #eef0e9; font-size: 12.5px; font-weight: 700; cursor: pointer; font-family: inherit;
}
.sd-panel button:hover { border-color: #7dd3fc; }
.sd-panel button:disabled { opacity: .45; cursor: default; }
.sd-panel button.sd-primary { background: #7dd3fc; border-color: #7dd3fc; color: #04121c; }
.sd-panel button.sd-danger { color: #fca5a5; }
.sd-panel-scroll { flex: 1; overflow-y: auto; padding: 6px 0 24px; }
.sd-group { border-bottom: 1px solid rgba(148,163,184,.12); }
.sd-group-head { display: flex; align-items: center; justify-content: space-between; padding: 10px 16px; cursor: pointer; user-select: none; }
.sd-group-head b { font-size: 14px; }
.sd-group-head span { font-size: 12px; color: rgba(238,240,233,.5); }
.sd-group-body { padding: 0 16px 10px; display: flex; flex-direction: column; gap: 10px; }
.sd-field { border: 1px solid rgba(148,163,184,.16); border-radius: 10px; padding: 9px 10px; background: rgba(148,163,184,.04); }
.sd-field.sd-flash { border-color: #7dd3fc; box-shadow: 0 0 0 2px rgba(125,211,252,.25); }
.sd-field.sd-changed { border-color: rgba(251,191,36,.55); }
.sd-field-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
.sd-field-label { font-size: 13.5px; font-weight: 700; line-height: 1.35; }
.sd-field-kind { font-size: 11px; font-weight: 800; padding: 1px 6px; border-radius: 999px; background: rgba(148,163,184,.14); color: rgba(238,240,233,.7); white-space: nowrap; }
.sd-field-kind.sd-k-erp { background: rgba(52,211,153,.14); color: #6ee7b7; }
.sd-field-kind.sd-k-snap { background: rgba(248,113,113,.14); color: #fca5a5; }
.sd-field-kind.sd-k-changed { background: rgba(251,191,36,.16); color: #fcd34d; }
.sd-field-row { display: flex; align-items: center; gap: 8px; margin-top: 6px; }
.sd-field-row input[type=number] {
  width: 130px; height: 30px; border-radius: 7px; border: 1px solid rgba(148,163,184,.35); background: #0b0f18; color: #fff;
  padding: 0 8px; font-size: 14px; font-family: inherit; font-variant-numeric: tabular-nums;
}
.sd-field-row input[type=range] { flex: 1; min-width: 0; accent-color: #7dd3fc; }
.sd-field-unit { font-size: 12.5px; color: rgba(238,240,233,.6); white-space: nowrap; }
.sd-field-src { margin-top: 5px; font-size: 11.5px; color: rgba(238,240,233,.48); line-height: 1.45; }
.sd-field-reset { height: 24px !important; padding: 0 7px !important; font-size: 11.5px !important; }
.sd-toggle { display: inline-flex; align-items: center; gap: 8px; cursor: pointer; }
.sd-toggle input { width: 16px; height: 16px; accent-color: #7dd3fc; }
.sd-sec { padding: 10px 16px; border-bottom: 1px solid rgba(148,163,184,.12); display: flex; flex-direction: column; gap: 8px; }
.sd-sec-title { font-size: 13px; font-weight: 800; color: rgba(238,240,233,.8); }
.sd-sec input[type=text] { height: 30px; border-radius: 7px; border: 1px solid rgba(148,163,184,.35); background: #0b0f18; color: #fff; padding: 0 8px; font-size: 13px; font-family: inherit; flex: 1; min-width: 0; }
.sd-list { display: flex; flex-direction: column; gap: 4px; font-size: 12.5px; }
.sd-list-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 5px 8px; border-radius: 7px; background: rgba(148,163,184,.06); }
.sd-list-row small { color: rgba(238,240,233,.5); }
.sd-msg { font-size: 12px; color: #6ee7b7; }
.sd-err { font-size: 12px; color: #fca5a5; }

.sd-notes {
  position: fixed; left: 0; right: 0; bottom: 0; z-index: 120; max-height: 42vh; overflow-y: auto;
  background: rgba(8,10,16,.94); color: #eef0e9; border-top: 1px solid rgba(148,163,184,.3);
  padding: 16px max(16px, calc((100vw - 1100px) / 2)) 22px; font-family: "Pretendard Variable", Pretendard, sans-serif;
  font-size: 17px; line-height: 1.65; letter-spacing: -.01em;
}
.sd-notes-head { display: flex; justify-content: space-between; align-items: center; font-size: 12.5px; color: rgba(238,240,233,.55); font-weight: 700; margin-bottom: 8px; }
.sd-notes p { margin: 0 0 10px; }

.sd-loading { position: fixed; inset: 0; z-index: 100; background: #04060a; color: rgba(238,240,233,.8); display: flex; align-items: center; justify-content: center; flex-direction: column; gap: 12px; font-family: "Pretendard Variable", Pretendard, sans-serif; font-size: 16px; padding: 24px; text-align: center; }
.sd-loading a { color: #7dd3fc; }

/* ---- 인쇄 ---- */
.sd-print { display: none; }
@media print {
  @page { size: 1600px 900px; margin: 0; }
  html, body { background: #fff !important; }
  body * { visibility: hidden; }
  .sd-print, .sd-print * { visibility: visible; }
  .sd-print { display: block; position: absolute; left: 0; top: 0; width: 1600px; }
  .sd-print-page { position: relative; width: 1600px; height: 900px; overflow: hidden; break-after: page; page-break-after: always; background: #fff; }
  .sd-print-page:last-child { break-after: auto; page-break-after: auto; }
  .sd-print * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .sd-print .dk-rise, .sd-print .dk-grow { opacity: 1 !important; animation: none !important; transform: none !important; }
}
.sd-print-foot { position: absolute; left: 72px; right: 72px; bottom: 26px; display: flex; justify-content: space-between; font-size: 12px; color: var(--sd-fg4); border-top: 1px solid var(--sd-line2); padding-top: 8px; }
`;
