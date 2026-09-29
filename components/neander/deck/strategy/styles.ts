// ============================================================
//  가정 장표 스타일 — 1504×846 캔버스 안에서 쓰는 sd- 접두 클래스
// ------------------------------------------------------------
//  글씨 최소 크기 (1600×900 화면 기준, 2차 수정 요청)
//    제목 44 · 핵심 숫자 56 · 본문·카드 제목 26 · 표 본문 22 · 차트 라벨 18 · 각주·칩 15
//  캔버스를 1504×846 으로 잡아 1600×900 에서는 1.06배, 1280×800 에서는 0.851배로
//  보인다 — 1280 에서도 최소값의 85% 아래로 내려가지 않는다. 휴대폰은 캔버스를
//  줄이지 않고 세로로 흘리며(Deck flowBelow) 글씨를 0.85배(--sd-k)로 둔다.
//  검사: e2e/deck-overflow.mjs 가 역할별 최소 크기를 잰다 (sd-title · sd-kpi-value ·
//  td · sd-lbl · sd-foot …). 새 부품을 만들면 역할 클래스를 붙인다.
//
//  색은 전부 변수로 쓴다. 화면(어두운 캔버스)과 인쇄본(밝은 종이)이 같은
//  부품을 쓰고 변수만 바꾼다. 차트 색은 dataviz 검증을 통과한 범주 색
//  (어두운 배경 #3987e5 · #d95926 · #199e70 · #c98500, 밝은 배경은 한 단계
//  진한 값)이다. 사업부 ①은 주황(따뜻한 색), ②는 파랑(차가운 색)으로 모든 장에서 같다.
// ============================================================

export const CANVAS = { w: 1504, h: 846 };

/** 글씨 크기 — 흘리는 화면(휴대폰)에서는 --sd-k 배 */
const f = (px: number) => `calc(${px}px * var(--sd-k, 1))`;

export const SD_CSS = `
.dk-root, .sd-print {
  --sd-k: 1;
  --sd-fg: #eef0e9;
  --sd-fg2: rgba(238,240,233,.8);
  --sd-fg3: rgba(238,240,233,.62);
  --sd-fg4: rgba(238,240,233,.46);
  --sd-line: rgba(148,163,184,.24);
  --sd-line2: rgba(148,163,184,.12);
  --sd-panel: rgba(148,163,184,.07);
  --sd-panel2: rgba(148,163,184,.14);
  --sd-accent: #7dd3fc;
  --sd-good: #34d399;
  --sd-good-soft: rgba(52,211,153,.14);
  --sd-bad: #f87171;
  --sd-bad-soft: rgba(248,113,113,.14);
  --sd-warn: #fbbf24;
  --sd-warn-soft: rgba(251,191,36,.12);
  --sd-a: #d95926;
  --sd-a-soft: rgba(217,89,38,.16);
  --sd-a-text: #f08a5d;
  --sd-b: #3987e5;
  --sd-b-soft: rgba(57,135,229,.18);
  --sd-b-text: #6aa8f0;
  --sd-s1: #3987e5;
  --sd-s2: #d95926;
  --sd-s3: #199e70;
  --sd-s4: #c98500;
  --sd-muted-bar: rgba(148,163,184,.42);
  --sd-surface: #0a0d14;
}
.dk-flow { --sd-k: .85; }
.sd-print {
  --sd-fg: #121417;
  --sd-fg2: #333941;
  --sd-fg3: #565c66;
  --sd-fg4: #6f757f;
  --sd-line: #d0d4da;
  --sd-line2: #e6e8ec;
  --sd-panel: #f5f6f8;
  --sd-panel2: #eceef1;
  --sd-accent: #0b6fb8;
  --sd-good: #0d8a55;
  --sd-good-soft: #e3f4ec;
  --sd-bad: #c62f2f;
  --sd-bad-soft: #fbe7e7;
  --sd-warn: #a86400;
  --sd-warn-soft: #fbf1e0;
  --sd-a: #c24e1c;
  --sd-a-soft: #fbe9e0;
  --sd-a-text: #b2481a;
  --sd-b: #2a6fc4;
  --sd-b-soft: #e3eefb;
  --sd-b-text: #2a6fc4;
  --sd-s1: #2a78d6;
  --sd-s2: #eb6834;
  --sd-s3: #1baf7a;
  --sd-s4: #eda100;
  --sd-muted-bar: #c3c8cf;
  --sd-surface: #ffffff;
}

/* ---- 장표 틀 ---- */
.sd-slide {
  position: absolute; inset: 0;
  padding: 30px 56px 104px;
  display: flex; flex-direction: column;
  color: var(--sd-fg);
  font-size: ${f(26)}; line-height: 1.42; letter-spacing: -.015em;
  font-variant-numeric: tabular-nums;
  /* 한국어는 낱말 중간에서 줄을 바꾸지 않는다 (제목이 「자랐지/만」 으로 갈리지 않게) */
  word-break: keep-all; overflow-wrap: break-word;
}
.sd-head { display: flex; align-items: center; gap: 12px; font-size: ${f(15)}; letter-spacing: .06em; color: var(--sd-fg3); font-weight: 600; min-height: 22px; }
.sd-head .sd-no { color: var(--sd-accent); font-family: ui-monospace, "Cascadia Mono", Consolas, monospace; letter-spacing: .1em; }
.sd-head .sd-sep { width: 1px; height: 12px; background: var(--sd-line); }
.sd-title {
  margin-top: 8px;
  font-family: "Noto Serif KR", "Pretendard Variable", serif;
  font-weight: 700; font-size: ${f(44)}; line-height: 1.3; letter-spacing: -.03em;
  color: var(--sd-fg); text-wrap: balance;
}
.sd-lead { margin-top: 10px; font-size: ${f(26)}; line-height: 1.42; color: var(--sd-fg2); }
.sd-body { flex: 1; min-height: 0; margin-top: 20px; display: flex; flex-direction: column; gap: 18px; overflow: hidden; }
.sd-foot { margin-top: auto; padding-top: 4px; font-size: ${f(15)}; line-height: 1.4; color: var(--sd-fg3); display: flex; flex-wrap: wrap; gap: 2px 16px; }
.sd-foot b { color: var(--sd-fg2); font-weight: 700; }

/* 표지형 */
.sd-hero { justify-content: center; padding-top: 30px; }
.sd-hero .sd-title { font-size: ${f(60)}; line-height: 1.2; }
.sd-hero .sd-lead { font-size: ${f(30)}; margin-top: 16px; }

/* ---- 글 ---- */
.sd-text { color: var(--sd-fg); }
.sd-text.sd-muted { color: var(--sd-fg2); }
.sd-size-md, .sd-size-sm { font-size: ${f(26)}; }
.sd-size-lg { font-size: ${f(30)}; line-height: 1.4; letter-spacing: -.02em; }
.sd-size-xl { font-size: ${f(38)}; line-height: 1.3; font-weight: 700; letter-spacing: -.025em; }
/* 각주성 설명 한 줄 — 역할: 각주 (15 이상) */
.sd-note { font-size: ${f(17)}; line-height: 1.45; color: var(--sd-fg3); }
.sd-note b { color: var(--sd-fg2); }
.sd-text b, .sd-bul b, .sd-table b, .sd-callout b, .sd-card b, .sd-icard b { font-weight: 700; color: var(--sd-fg); }
.sd-hl { color: var(--sd-accent); font-weight: 700; }
.sd-circ {
  display: inline-flex; align-items: center; justify-content: center;
  width: 1.1em; height: 1.1em; margin: 0 .1em; border-radius: 999px;
  border: .09em solid currentColor; font-size: max(.8em, ${f(15)}); font-weight: 800; line-height: 1;
  vertical-align: .08em; font-family: "Pretendard Variable", Pretendard, sans-serif; letter-spacing: 0;
}
/* 각주 번호 — 15px 아래로 줄이지 않는 대신 조금만 올려 윗줄 글자에 닿지 않게 */
.sd-fn { font-size: max(.6em, ${f(15)}); vertical-align: baseline; position: relative; top: -.4em; line-height: 1; color: var(--sd-accent); font-weight: 700; margin-left: 1px; }
.sd-a-text { color: var(--sd-a-text); font-weight: 700; }
.sd-b-text { color: var(--sd-b-text); font-weight: 700; }
.sd-bad-text { color: var(--sd-bad); font-weight: 700; }
.sd-good-text { color: var(--sd-good); font-weight: 700; }
.sd-lbl { font-size: ${f(20)}; line-height: 1.35; color: var(--sd-fg2); }
.sd-lbl-s { font-size: ${f(18)}; line-height: 1.35; color: var(--sd-fg3); }

.sd-bul { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 12px; font-size: ${f(26)}; }
.sd-bul > li { position: relative; padding-left: 26px; }
.sd-bul > li::before { content: ""; position: absolute; left: 4px; top: .6em; width: 9px; height: 9px; border-radius: 2px; background: var(--sd-accent); opacity: .85; }
.sd-bul.sd-num { counter-reset: sdn; }
.sd-bul.sd-num > li { padding-left: 44px; counter-increment: sdn; }
.sd-bul.sd-num > li::before {
  content: counter(sdn); width: 32px; height: 32px; top: .08em; left: 0; border-radius: 999px;
  background: var(--sd-panel2); color: var(--sd-accent); font-size: ${f(18)}; font-weight: 800; opacity: 1;
  display: flex; align-items: center; justify-content: center;
}
.sd-bul ul { margin: 4px 0 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 3px; }
.sd-bul ul li { position: relative; padding-left: 20px; color: var(--sd-fg2); }
.sd-bul ul li::before { content: "·"; position: absolute; left: 6px; color: var(--sd-fg3); }

/* ---- 표 (본문 22, 머리 19) ---- */
.sd-table-wrap { width: 100%; }
.sd-table { width: 100%; border-collapse: collapse; font-size: ${f(22)}; line-height: 1.36; table-layout: fixed; }
.sd-table.sd-lg { font-size: ${f(26)}; }
.sd-table.sd-lg th, .sd-table.sd-lg td { padding: 13px 14px; }
.sd-table th {
  text-align: left; font-size: ${f(19)}; font-weight: 700; color: var(--sd-fg3); letter-spacing: .01em;
  padding: 8px 12px; border-bottom: 1px solid var(--sd-line); vertical-align: bottom;
}
.sd-table td { padding: 10px 12px; border-bottom: 1px solid var(--sd-line2); vertical-align: top; color: var(--sd-fg2); overflow-wrap: anywhere; }
.sd-table td:first-child { color: var(--sd-fg); }
.sd-table .sd-r { text-align: right; }
.sd-table .sd-c { text-align: center; }
.sd-table tr.sd-strong td { background: var(--sd-panel); color: var(--sd-fg); font-weight: 700; }
.sd-table td.sd-strongcol { color: var(--sd-fg); font-weight: 700; }
.sd-table tr.sd-link-row { cursor: pointer; }
.sd-table tr.sd-link-row:hover td { background: var(--sd-panel2); }
.sd-table-note { margin-top: 6px; font-size: ${f(16)}; color: var(--sd-fg3); line-height: 1.45; }
.sd-chip-tier { display: inline-block; padding: 1px 8px; border-radius: 999px; font-weight: 700; background: var(--sd-b-soft); color: var(--sd-b-text); }

/* ---- 핵심 숫자 (56) ---- */
.sd-kpis { display: grid; gap: 14px; }
.sd-kpi { border: 1px solid var(--sd-line); border-radius: 16px; padding: 14px 20px 16px; background: var(--sd-panel); min-width: 0; }
.sd-kpi-label { font-size: ${f(20)}; color: var(--sd-fg2); font-weight: 600; line-height: 1.3; }
.sd-kpi-value { margin-top: 4px; font-size: ${f(56)}; font-weight: 800; letter-spacing: -.035em; line-height: 1.1; color: var(--sd-fg); white-space: nowrap; }
.sd-kpi-value.sd-kpi-text { white-space: normal; }
.sd-kpi-sub { margin-top: 6px; font-size: ${f(18)}; color: var(--sd-fg3); line-height: 1.4; }
.sd-tone-good .sd-kpi-value { color: var(--sd-good); }
.sd-tone-bad .sd-kpi-value { color: var(--sd-bad); }
.sd-tone-warn .sd-kpi-value { color: var(--sd-warn); }
.sd-tone-accent .sd-kpi-value { color: var(--sd-accent); }
.sd-tone-muted .sd-kpi-value { color: var(--sd-fg3); }
.sd-kpi.sd-tone-a { border-color: var(--sd-a); }
.sd-tone-a .sd-kpi-value { color: var(--sd-a-text); }
.sd-kpi.sd-tone-b { border-color: var(--sd-b); }
.sd-tone-b .sd-kpi-value { color: var(--sd-b-text); }

/* ---- 강조 상자 ---- */
.sd-callout { border-left: 5px solid var(--sd-accent); background: var(--sd-panel); border-radius: 0 14px 14px 0; padding: 12px 20px; font-size: ${f(26)}; line-height: 1.42; color: var(--sd-fg); }
.sd-callout.sd-big { font-size: ${f(34)}; line-height: 1.34; padding: 18px 26px; font-weight: 700; letter-spacing: -.02em; }
.sd-callout-label { font-size: ${f(18)}; font-weight: 800; letter-spacing: .04em; color: var(--sd-accent); margin-bottom: 2px; }
.sd-callout.sd-tone-good { border-left-color: var(--sd-good); } .sd-callout.sd-tone-good .sd-callout-label { color: var(--sd-good); }
.sd-callout.sd-tone-bad { border-left-color: var(--sd-bad); } .sd-callout.sd-tone-bad .sd-callout-label { color: var(--sd-bad); }
.sd-callout.sd-tone-warn { border-left-color: var(--sd-warn); } .sd-callout.sd-tone-warn .sd-callout-label { color: var(--sd-warn); }
.sd-callout.sd-tone-a { border-left-color: var(--sd-a); background: var(--sd-a-soft); } .sd-callout.sd-tone-a .sd-callout-label { color: var(--sd-a-text); }
.sd-callout.sd-tone-b { border-left-color: var(--sd-b); background: var(--sd-b-soft); } .sd-callout.sd-tone-b .sd-callout-label { color: var(--sd-b-text); }
.sd-callout.sd-tone-muted { border-left-color: var(--sd-line); color: var(--sd-fg2); }

.sd-cols { display: grid; min-height: 0; }
.sd-col { display: flex; flex-direction: column; gap: 16px; min-width: 0; min-height: 0; }
.sd-card { border: 1px solid var(--sd-line); border-radius: 16px; padding: 16px 22px; background: var(--sd-panel); display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.sd-card-title { font-size: ${f(26)}; font-weight: 800; color: var(--sd-fg); letter-spacing: -.015em; line-height: 1.3; }
.sd-card.sd-tone-a { border-color: var(--sd-a); background: var(--sd-a-soft); }
.sd-card.sd-tone-a .sd-card-title { color: var(--sd-a-text); }
.sd-card.sd-tone-b { border-color: var(--sd-b); background: var(--sd-b-soft); }
.sd-card.sd-tone-b .sd-card-title { color: var(--sd-b-text); }
.sd-card.sd-tone-bad { border-color: var(--sd-bad); }
.sd-card.sd-tone-bad .sd-card-title { color: var(--sd-bad); }
.sd-card.sd-tone-good { border-color: var(--sd-good); }
.sd-card.sd-tone-good .sd-card-title { color: var(--sd-good); }
.sd-card.sd-tone-warn { border-color: rgba(251,191,36,.5); }
.sd-card.sd-tone-warn .sd-card-title { color: var(--sd-warn); }

.sd-steps { display: flex; gap: 12px; align-items: stretch; }
.sd-steps.sd-col-dir { flex-direction: column; }
.sd-step { flex: 1; min-width: 0; border: 1px solid var(--sd-line); border-radius: 14px; padding: 12px 16px; background: var(--sd-panel); position: relative; }
.sd-step-n { font-size: ${f(18)}; font-weight: 800; color: var(--sd-accent); letter-spacing: .08em; }
.sd-step-t { font-size: ${f(26)}; font-weight: 800; margin-top: 2px; line-height: 1.3; }
.sd-step-b { font-size: ${f(26)}; color: var(--sd-fg2); margin-top: 4px; line-height: 1.38; }

/* ---- 아이콘 카드 (이유·상태·결정) ---- */
.sd-icards { display: grid; gap: 14px; }
.sd-icard { border: 1px solid var(--sd-line); border-radius: 16px; padding: 16px 20px; background: var(--sd-panel); display: flex; flex-direction: column; gap: 8px; min-width: 0; position: relative; }
.sd-icard-top { display: flex; align-items: center; gap: 12px; }
.sd-icard-icon { flex: none; width: 48px; height: 48px; border-radius: 12px; display: flex; align-items: center; justify-content: center; background: var(--sd-panel2); color: var(--sd-accent); }
.sd-icard-no { flex: none; width: 40px; height: 40px; border-radius: 999px; display: flex; align-items: center; justify-content: center; background: var(--sd-panel2); color: var(--sd-accent); font-size: ${f(20)}; font-weight: 800; }
.sd-icard-title { font-size: ${f(26)}; font-weight: 800; line-height: 1.3; letter-spacing: -.015em; min-width: 0; }
.sd-icard-body { font-size: ${f(26)}; color: var(--sd-fg2); line-height: 1.38; }
.sd-icard-tag { align-self: flex-start; font-size: ${f(18)}; font-weight: 800; padding: 3px 10px; border-radius: 999px; background: var(--sd-panel2); color: var(--sd-fg2); }
.sd-icard.sd-tone-a { border-color: var(--sd-a); background: var(--sd-a-soft); } .sd-icard.sd-tone-a .sd-icard-icon { color: var(--sd-a-text); } .sd-icard.sd-tone-a .sd-icard-tag { background: var(--sd-a); color: #fff; }
.sd-icard.sd-tone-b { border-color: var(--sd-b); background: var(--sd-b-soft); } .sd-icard.sd-tone-b .sd-icard-icon { color: var(--sd-b-text); } .sd-icard.sd-tone-b .sd-icard-tag { background: var(--sd-b); color: #fff; }
.sd-icard.sd-tone-good { border-color: var(--sd-good); } .sd-icard.sd-tone-good .sd-icard-icon { color: var(--sd-good); } .sd-icard.sd-tone-good .sd-icard-tag { background: var(--sd-good-soft); color: var(--sd-good); }
.sd-icard.sd-tone-bad { border-color: var(--sd-bad); } .sd-icard.sd-tone-bad .sd-icard-icon { color: var(--sd-bad); } .sd-icard.sd-tone-bad .sd-icard-tag { background: var(--sd-bad-soft); color: var(--sd-bad); }
.sd-icard.sd-tone-warn { border-color: rgba(251,191,36,.55); } .sd-icard.sd-tone-warn .sd-icard-icon { color: var(--sd-warn); } .sd-icard.sd-tone-warn .sd-icard-tag { background: var(--sd-warn-soft); color: var(--sd-warn); }
.sd-icard.sd-tone-muted { opacity: .92; } .sd-icard.sd-tone-muted .sd-icard-tag { color: var(--sd-fg3); }
.sd-icard.sd-tone-accent { border-color: var(--sd-accent); }
.sd-icard.sd-icard-big { border-width: 2px; }
.sd-icard.sd-icard-big .sd-icard-title { font-size: ${f(32)}; }
.sd-icard.sd-icard-big .sd-icard-icon { width: 58px; height: 58px; }
.dk-flow .sd-icard { grid-column: auto !important; }

/* ---- 좌우 체크리스트 ---- */
.sd-checklist { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 12px; font-size: ${f(26)}; }
.sd-checklist li { display: flex; gap: 12px; align-items: flex-start; line-height: 1.36; }
.sd-check-mark { flex: none; width: 34px; height: 34px; border-radius: 999px; display: flex; align-items: center; justify-content: center; margin-top: 1px; }
.sd-check-x { background: var(--sd-bad-soft); color: var(--sd-bad); }
.sd-check-check { background: var(--sd-good-soft); color: var(--sd-good); }

/* ---- 흐름도 (전과 후) ---- */
.sd-flow { display: flex; flex-direction: column; gap: 22px; padding: 6px 0; }
.sd-flow-row { display: grid; grid-template-columns: 90px 1fr; gap: 14px; align-items: center; }
.sd-flow-label { font-size: ${f(30)}; font-weight: 800; color: var(--sd-fg2); }
.sd-flow-steps { display: flex; align-items: center; gap: 12px; flex-wrap: nowrap; min-width: 0; }
.sd-flow-step { border: 1px solid var(--sd-line); background: var(--sd-panel); border-radius: 14px; padding: 16px 26px; font-size: ${f(32)}; font-weight: 700; white-space: nowrap; }
.sd-flow-arrow { color: var(--sd-fg3); flex: none; }
.sd-flow-result { margin-left: 12px; font-size: ${f(32)}; font-weight: 800; padding: 12px 24px; border-radius: 999px; white-space: nowrap; }
.sd-flow-row.sd-tone-bad .sd-flow-result { background: var(--sd-bad-soft); color: var(--sd-bad); }
.sd-flow-row.sd-tone-good .sd-flow-result { background: var(--sd-good-soft); color: var(--sd-good); }
.sd-flow-row.sd-tone-good .sd-flow-step { border-color: var(--sd-good); }

/* ---- 계단 ---- */
.sd-stairs { display: grid; gap: 12px; align-items: end; flex: 1; min-height: 300px; grid-template-rows: minmax(0, 1fr); }
.sd-stair { border: 1px solid var(--sd-b); background: var(--sd-b-soft); border-radius: 14px 14px 0 0; padding: 14px 18px; display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.sd-stair-n { font-size: ${f(18)}; font-weight: 800; color: var(--sd-b-text); letter-spacing: .06em; }
.sd-stair-t { font-size: ${f(26)}; font-weight: 800; line-height: 1.3; }
.sd-stair-b { font-size: ${f(26)}; color: var(--sd-fg2); line-height: 1.36; }

/* ---- 차트 ---- */
.sd-chart { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.sd-chart-title { font-size: ${f(22)}; font-weight: 800; color: var(--sd-fg); }
.sd-scroll-x { width: 100%; min-width: 0; overflow: hidden; }
.dk-flow .sd-scroll-x { overflow-x: auto; }
.sd-svg { display: block; overflow: visible; }
.sd-svg text { font-family: inherit; }
.sd-legend { display: flex; flex-wrap: wrap; gap: 6px 20px; font-size: ${f(19)}; color: var(--sd-fg2); }
.sd-legend i { display: inline-block; width: 13px; height: 13px; border-radius: 3px; margin-right: 7px; vertical-align: -1px; }
.sd-bars { display: flex; flex-direction: column; gap: 12px; }
.sd-bar-row { display: grid; grid-template-columns: minmax(0, 260px) 1fr minmax(0, 170px); align-items: center; gap: 14px; }
.sd-bar-label { color: var(--sd-fg2); font-size: ${f(20)}; line-height: 1.3; }
.sd-bar-track { position: relative; height: 30px; }
.sd-bar-fill { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 0 4px 4px 0; }
.sd-bar-val { text-align: right; font-weight: 800; color: var(--sd-fg); font-size: ${f(22)}; }
.sd-stack { display: flex; height: 54px; width: 100%; gap: 2px; }
.sd-stack > div { height: 100%; min-width: 2px; }
.sd-stack > div:first-child { border-radius: 4px 0 0 4px; }
.sd-stack > div:last-child { border-radius: 0 4px 4px 0; }
.sd-progress { position: relative; height: 26px; border-radius: 999px; background: var(--sd-panel2); overflow: hidden; }
.sd-progress > div { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 999px; }
.sd-pill { display: inline-flex; align-items: center; gap: 6px; padding: 3px 12px; border-radius: 999px; font-size: ${f(18)}; font-weight: 800; background: var(--sd-panel2); color: var(--sd-fg2); white-space: nowrap; }
.sd-pill.sd-tone-bad { background: var(--sd-bad-soft); color: var(--sd-bad); }
.sd-pill.sd-tone-good { background: var(--sd-good-soft); color: var(--sd-good); }
.sd-pill.sd-tone-warn { background: var(--sd-warn-soft); color: var(--sd-warn); }
.sd-pill.sd-tone-b { background: var(--sd-b-soft); color: var(--sd-b-text); }
.sd-pill.sd-tone-a { background: var(--sd-a-soft); color: var(--sd-a-text); }
.sd-num { font-weight: 800; letter-spacing: -.02em; }

/* ---- 두 엔진 ---- */
.sd-engines { display: grid; grid-template-columns: 1fr 150px 1fr; gap: 0; align-items: stretch; }
.sd-engine { border: 2px solid var(--sd-line); border-radius: 20px; padding: 18px 24px; display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.sd-engine.sd-tone-a { border-color: var(--sd-a); background: var(--sd-a-soft); }
.sd-engine.sd-tone-b { border-color: var(--sd-b); background: var(--sd-b-soft); }
.sd-engine-top { display: flex; align-items: center; gap: 14px; }
.sd-engine-icon { width: 58px; height: 58px; border-radius: 16px; display: flex; align-items: center; justify-content: center; flex: none; }
.sd-engine.sd-tone-a .sd-engine-icon { background: var(--sd-a); color: #fff; }
.sd-engine.sd-tone-b .sd-engine-icon { background: var(--sd-b); color: #fff; }
.sd-engine-name { font-size: ${f(30)}; font-weight: 800; line-height: 1.25; letter-spacing: -.02em; }
.sd-engine-role { font-size: ${f(26)}; font-weight: 700; }
.sd-engine.sd-tone-a .sd-engine-role { color: var(--sd-a-text); }
.sd-engine.sd-tone-b .sd-engine-role { color: var(--sd-b-text); }
.sd-engine-how { font-size: ${f(26)}; color: var(--sd-fg2); line-height: 1.38; }
.sd-engine-link { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; color: var(--sd-fg3); text-align: center; }

/* ---- 매물 ---- */
.sd-map { position: relative; border-radius: 16px; overflow: hidden; border: 1px solid var(--sd-line); background: var(--sd-panel); flex: none; }
.sd-map-tiles { position: absolute; inset: 0; }
/* 전역 img { max-width: 100% } 를 풀어야 타일이 제 크기로 깔린다 */
.sd-map-tiles img { position: absolute; width: 256px; height: 256px; max-width: none; display: block; }
.sd-map-dim { position: absolute; inset: 0; background: rgba(10,13,20,.22); pointer-events: none; }
.sd-pin { position: absolute; transform: translate(-50%, -100%); display: flex; flex-direction: column; align-items: center; text-decoration: none; z-index: 2; }
.sd-pin-dot { min-width: 38px; height: 34px; padding: 0 7px; border-radius: 999px; background: var(--sd-a); color: #fff; font-size: ${f(18)}; font-weight: 800; display: flex; align-items: center; justify-content: center; border: 2px solid #fff; box-shadow: 0 2px 8px rgba(0,0,0,.35); white-space: nowrap; }
.sd-pin-stem { width: 2px; height: 9px; background: #fff; }
a.sd-pin:hover { z-index: 3; }
a.sd-pin:hover .sd-pin-dot { transform: scale(1.12); box-shadow: 0 0 0 3px var(--sd-accent), 0 2px 8px rgba(0,0,0,.35); }
.sd-pin.sd-pin-home .sd-pin-dot { background: #111827; }
.sd-pin.sd-pin-approx .sd-pin-dot { border-style: dashed; }
.sd-pin.sd-pin-ended .sd-pin-dot { opacity: .75; }
.sd-map-attr { position: absolute; right: 6px; bottom: 4px; font-size: ${f(15)}; color: #333; background: rgba(255,255,255,.8); padding: 1px 6px; border-radius: 4px; }
.sd-map-key { position: absolute; left: 10px; top: 10px; font-size: ${f(18)}; background: rgba(10,13,20,.8); color: #eef0e9; border-radius: 10px; padding: 6px 12px; line-height: 1.45; }
.sd-map-empty { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: var(--sd-fg3); font-size: ${f(18)}; }
.sd-inset-frame { position: absolute; border: 2px dashed rgba(255,255,255,.85); border-radius: 6px; pointer-events: none; }

.sd-rcards { display: grid; gap: 12px; min-height: 0; }
.sd-rcard { border: 1px solid var(--sd-line); border-left-width: 6px; border-radius: 14px; background: var(--sd-panel); padding: 12px 16px; display: flex; flex-direction: column; gap: 4px; min-width: 0; text-align: left; color: inherit; font: inherit; cursor: pointer; }
.sd-rcard:hover { background: var(--sd-panel2); }
.sd-rcard-top { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
.sd-rcard-name { font-size: ${f(26)}; font-weight: 800; }
.sd-rcard-fixed { font-size: ${f(22)}; font-weight: 800; white-space: nowrap; }
.sd-rcard-brief { font-size: ${f(22)}; color: var(--sd-fg2); line-height: 1.35; }

.sd-pcards { display: grid; gap: 14px; min-height: 0; flex: 1; }
.sd-pcard { position: relative; display: flex; flex-direction: column; border: 1px solid var(--sd-line); border-radius: 16px; background: var(--sd-panel); overflow: hidden; min-height: 0; color: inherit; text-decoration: none; }
/* 카드 전체를 덮는 투명 링크 — 층별 칩은 그 위 층 */
.sd-pcard-cover { position: absolute; inset: 0; z-index: 1; border-radius: inherit; }
.sd-pcard:has(.sd-pcard-cover) { cursor: pointer; transition: border-color .15s ease, background .15s ease; }
.sd-pcard:has(.sd-pcard-cover:hover), .sd-pcard:has(.sd-pcard-cover:focus-visible), .sd-pcard:has(.sd-link-chip:hover) { border-color: var(--sd-accent); background: var(--sd-panel2); }
.sd-pcard-cover:focus-visible { outline: 2px solid var(--sd-accent); outline-offset: -2px; }
.sd-pcard-go { position: absolute; right: 10px; top: 10px; width: 38px; height: 38px; border-radius: 999px; background: rgba(10,13,20,.78); color: #fff; display: flex; align-items: center; justify-content: center; opacity: 0; transition: opacity .15s ease; transform: rotate(-45deg); }
.sd-pcard-cover:hover .sd-pcard-go, .sd-pcard-cover:focus-visible .sd-pcard-go { opacity: 1; }
.sd-pcard .sd-links { position: relative; z-index: 2; }
.sd-pcard-photo { position: relative; background: var(--sd-panel2); height: 150px; flex: none; }
.sd-pcard-photo img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.sd-pcard-photo .sd-nophoto { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: var(--sd-fg3); font-size: ${f(18)}; }
.sd-pcard-no { position: absolute; left: 10px; top: 10px; min-width: 40px; height: 34px; padding: 0 8px; border-radius: 999px; background: var(--sd-a); color: #fff; font-size: ${f(18)}; font-weight: 800; display: flex; align-items: center; justify-content: center; border: 2px solid #fff; }
.sd-pcard-ended { position: absolute; left: 10px; bottom: 10px; background: var(--sd-bad) !important; color: #fff !important; }
.sd-pcard-body { padding: 12px 16px 14px; display: flex; flex-direction: column; gap: 4px; min-width: 0; flex: 1; min-height: 0; }
.sd-pcard-loc { font-size: ${f(26)}; font-weight: 800; line-height: 1.28; }
/* 매물 카드의 자료 줄 — 역할: 표 본문 (22 이상) */
.sd-pcard-meta { font-size: ${f(22)}; color: var(--sd-fg2); line-height: 1.34; }
.sd-pcard-money { font-size: ${f(22)}; font-weight: 800; color: var(--sd-fg); }
.sd-pcard-feat { font-size: ${f(22)}; color: var(--sd-fg2); line-height: 1.34; }
.sd-links { display: flex; flex-wrap: wrap; gap: 6px; margin-top: auto; padding-top: 6px; }
.sd-link-chip { display: inline-flex; align-items: center; gap: 4px; height: 32px; padding: 0 12px; border-radius: 999px; border: 1px solid var(--sd-line); background: rgba(10,13,20,.35); color: var(--sd-fg2); font-size: ${f(16)}; font-weight: 700; text-decoration: none; white-space: nowrap; }
.sd-link-chip:hover, .sd-link-chip:focus-visible { border-color: var(--sd-accent); color: var(--sd-fg); outline: none; }
.sd-ext { display: inline-block; margin-left: 4px; color: var(--sd-accent); font-weight: 800; }
a.sd-rowlink { color: inherit; text-decoration: none; }
a.sd-rowlink:hover { color: var(--sd-accent); }

/* ---- 가정값 목록 (부록) — 역할: 표 본문 22 ---- */
.sd-arow { display: flex; justify-content: space-between; gap: 10px; font-size: ${f(22)}; line-height: 1.38; border-bottom: 1px solid var(--sd-line2); padding: 1px 0; color: var(--sd-fg2); }
.sd-arow > span:first-child { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sd-arow > span:last-child { white-space: nowrap; font-weight: 700; color: var(--sd-fg); }
.sd-arow.sd-changed, .sd-arow.sd-changed > span:last-child { color: var(--sd-warn); }
.sd-agroup { font-size: ${f(19)}; font-weight: 800; color: var(--sd-accent); margin: 4px 0 2px; }
.sd-amark { font-size: ${f(15)}; font-weight: 600; color: var(--sd-fg3); margin-left: 6px; }
.sd-src-row { display: grid; grid-template-columns: 46px 1fr; gap: 6px; font-size: ${f(17)}; line-height: 1.45; }

/* ---- 가정 칩·배지 (캔버스 위) ---- */
.sd-chips { position: absolute; left: 56px; right: 56px; bottom: 62px; display: flex; gap: 8px; align-items: center; flex-wrap: nowrap; overflow: hidden; }
.sd-chips-label { font-size: ${f(15)}; font-weight: 800; color: var(--sd-fg3); letter-spacing: .04em; margin-right: 2px; white-space: nowrap; }
.sd-chip {
  display: inline-flex; align-items: center; gap: 7px; height: 34px; padding: 0 12px; border-radius: 999px;
  border: 1px solid var(--sd-line); background: rgba(15,18,28,.82); color: var(--sd-fg2);
  font-size: ${f(15)}; white-space: nowrap; cursor: pointer; font-family: inherit;
}
.sd-chip b { color: var(--sd-fg); font-weight: 700; }
.sd-chip:hover { border-color: var(--sd-accent); color: var(--sd-fg); }
.sd-chip.sd-chip-on { border-color: var(--sd-warn); }
.sd-chip.sd-chip-on b { color: var(--sd-warn); }
.sd-chip-more { color: var(--sd-accent); }
.sd-badge {
  position: absolute; right: 56px; top: 24px; display: flex; gap: 8px;
}
.sd-badge span { height: 30px; padding: 0 12px; border-radius: 999px; font-size: ${f(15)}; font-weight: 800; display: inline-flex; align-items: center; letter-spacing: .02em; }
.sd-badge .sd-b-changed { background: rgba(251,191,36,.16); color: var(--sd-warn); border: 1px solid rgba(251,191,36,.5); }
.sd-badge .sd-b-snap { background: rgba(248,113,113,.14); color: var(--sd-bad); border: 1px solid rgba(248,113,113,.45); }

/* 칩 편집 창 (캔버스 안, 칩 위) */
.sd-pop {
  position: absolute; bottom: 104px; width: 420px; z-index: 5;
  background: #141926; border: 1px solid rgba(148,163,184,.35); border-radius: 14px; padding: 14px 16px;
  box-shadow: 0 18px 40px rgba(0,0,0,.45); color: #eef0e9; font-size: 16px;
}
.sd-pop-title { font-size: 17px; font-weight: 800; padding-right: 30px; }
.sd-pop-src { margin-top: 4px; font-size: 15px; color: rgba(238,240,233,.62); line-height: 1.45; }
.sd-pop-row { display: flex; gap: 8px; align-items: center; margin-top: 10px; flex-wrap: wrap; }
.sd-pop input[type=number], .sd-pop select { flex: 1; height: 36px; border-radius: 8px; border: 1px solid rgba(148,163,184,.4); background: #0b0f18; color: #fff; padding: 0 10px; font-size: 16px; font-family: inherit; }
.sd-pop input[type=range] { width: 100%; margin-top: 8px; accent-color: #7dd3fc; }
.sd-pop button { height: 34px; padding: 0 12px; border-radius: 8px; border: 1px solid rgba(148,163,184,.35); background: rgba(148,163,184,.1); color: #eef0e9; font-size: 15px; font-weight: 700; cursor: pointer; font-family: inherit; }
.sd-pop button.sd-primary { background: #7dd3fc; color: #04121c; border-color: #7dd3fc; }
.sd-pop-meta { margin-top: 8px; font-size: 15px; color: rgba(238,240,233,.62); }
.sd-pop-close { position: absolute; right: 8px; top: 8px; height: 28px !important; width: 28px; padding: 0 !important; }

/* 장이 많아 하단 점이 발표 정보를 밀어내지 않게 */
.dk-root .dk-dots { gap: 4px; }
.dk-root .dk-dot { width: 6px; height: 6px; }

/* 하단 단추 */
.dk-btn.sd-on { background: var(--dk-accent); color: #04060a; border-color: var(--dk-accent); }
.sd-ctrl-txt { font-size: 11.5px; font-weight: 800; letter-spacing: .02em; width: auto !important; padding: 0 9px; }
.sd-snap-flag { font-size: 11.5px; font-weight: 800; color: #f87171; border: 1px solid rgba(248,113,113,.5); border-radius: 999px; padding: 3px 9px; margin-right: 4px; white-space: nowrap; }

/* ---- 좁은 화면 (세로로 흘림) ---- */
.dk-flow .sd-slide { position: relative; inset: auto; padding: 22px 16px 18px; }
/* 명조 글꼴의 글자 상자(약 1.45em)가 줄 간격보다 크면 윗줄·아랫줄 상자가 겹친다 */
.dk-flow .sd-title { line-height: 1.46; }
.dk-flow .sd-body { overflow: visible; }
.dk-flow .sd-cols { grid-template-columns: minmax(0, 1fr) !important; }
.dk-flow .sd-kpis { grid-template-columns: minmax(0, 1fr) !important; }
.dk-flow .sd-kpi-value { white-space: normal; }
.dk-flow .sd-icards, .dk-flow .sd-pcards, .dk-flow .sd-rcards, .dk-flow .sd-stairs { grid-template-columns: minmax(0, 1fr) !important; grid-template-rows: none !important; }
.dk-flow .sd-stair { border-radius: 14px; min-height: 0 !important; }
.dk-flow .sd-stairs { min-height: 0; }
.dk-flow .sd-engines { grid-template-columns: minmax(0, 1fr); }
.dk-flow .sd-engine-link { flex-direction: row; padding: 6px 0; }
.dk-flow .sd-engine-link svg { transform: rotate(90deg); }
.dk-flow .sd-table-wrap { overflow-x: auto; }
/* 네 칸 이상인 표만 가로로 민다 — 세 칸 표는 화면 폭에 맞춘다 */
.dk-flow .sd-table:has(th:nth-child(4)) { min-width: 720px; }
.dk-flow .sd-scen { grid-template-columns: minmax(0, 1fr) !important; }
.dk-flow .sd-scen-bar { grid-template-columns: minmax(0, 1fr) 150px !important; }
.dk-flow .sd-tier-row { grid-template-columns: minmax(0, 1fr) !important; }
.dk-flow .sd-heat { min-width: 900px; }
.dk-flow .sd-flow-row { grid-template-columns: minmax(0, 1fr); }
.dk-flow .sd-flow-steps { flex-wrap: wrap; }
.dk-flow .sd-flow-step, .dk-flow .sd-flow-result { white-space: normal; }
.dk-flow .sd-steps { flex-direction: column; }
.dk-flow .sd-bar-row { grid-template-columns: minmax(0, 1fr) minmax(0, 110px); }
.dk-flow .sd-bar-row .sd-bar-track { grid-column: 1 / -1; grid-row: 2; }
.dk-flow .sd-prop { grid-template-columns: minmax(0, 1fr) !important; }
.dk-flow .sd-mapwrap { overflow-x: auto; }
.dk-flow .sd-pcard-photo { height: 180px; }
.dk-flow .sd-chips { position: static; flex-wrap: wrap; padding: 0 16px 16px; }
.dk-flow .sd-badge { position: static; padding: 12px 16px 0; flex-wrap: wrap; }
.dk-flow .sd-pop { position: fixed; left: 8px !important; right: 8px; bottom: 70px; width: auto; }
.dk-flow .sd-arow > span:first-child { white-space: normal; }
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
.sd-field-row input[type=number], .sd-field-row select {
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
.sd-notes-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; font-size: 12.5px; color: rgba(238,240,233,.55); font-weight: 700; margin-bottom: 8px; }
.sd-notes p { margin: 0 0 10px; }
.sd-notes p.sd-qa { border-left: 3px solid #7dd3fc; padding-left: 12px; color: rgba(238,240,233,.9); }

.sd-loading { position: fixed; inset: 0; z-index: 100; background: #04060a; color: rgba(238,240,233,.8); display: flex; align-items: center; justify-content: center; flex-direction: column; gap: 12px; font-family: "Pretendard Variable", Pretendard, sans-serif; font-size: 16px; padding: 24px; text-align: center; }
.sd-loading a { color: #7dd3fc; }

/* ---- 인쇄 ---- */
.sd-print { display: none; }
@media print {
  @page { size: 1504px 846px; margin: 0; }
  html, body { background: #fff !important; }
  body * { visibility: hidden; }
  .sd-print, .sd-print * { visibility: visible; }
  .sd-print { display: block; position: absolute; left: 0; top: 0; width: 1504px; }
  .sd-print-page { position: relative; width: 1504px; height: 846px; overflow: hidden; break-after: page; page-break-after: always; background: #fff; }
  .sd-print-page:last-child { break-after: auto; page-break-after: auto; }
  .sd-print * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .sd-print .dk-rise, .sd-print .dk-grow { opacity: 1 !important; animation: none !important; transform: none !important; }
}
.sd-print-foot { position: absolute; left: 56px; right: 56px; bottom: 24px; display: flex; justify-content: space-between; font-size: 13px; color: var(--sd-fg4); border-top: 1px solid var(--sd-line2); padding-top: 8px; }
.sd-print .sd-map-dim { background: none; }
`;
