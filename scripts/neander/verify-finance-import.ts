// ============================================================
//  재무 이관 검증 — 파서·집계가 엑셀과 원 단위로 맞는지 확인
// ------------------------------------------------------------
//  M1 완료 기준이 "월 집계가 엑셀 총계와 원 단위 일치"이므로,
//  브라우저에서 눈으로 보기 전에 스크립트로 먼저 못을 박는다.
//
//    npm run finance:verify -- "<장부.xlsx 경로>"
//
//  경로를 안 주면 아래 기본 경로(2607 장부)를 쓴다.
// ============================================================

import * as XLSX from "xlsx";
import { parseWorkbook } from "../../lib/neander/finance/xlsx";
import {
  totals,
  businessUnitPL,
  expenseMatrix,
  plOnly,
} from "../../lib/neander/finance/aggregate";
import type { FinTransaction } from "../../lib/neander/finance/types";

const DEFAULT_PATH =
  "/Users/idongju/Library/Mobile Documents/com~apple~CloudDocs/*네안데르/0.네안데르 회계/2026/7월/2607(주)네안데르_장부_OPENROUTER정리완.xlsx";

/** 엑셀 사업부손익 시트의 2026-07 총계 — 이 값과 맞아야 한다 */
const EXPECTED = {
  income: 41_656_602,
  expense: 58_896_728,
  refund: 143_700,
  net: -17_096_426,
};

const won = (n: number) => Math.round(n).toLocaleString("ko-KR");

function main() {
  const path = process.argv[2] || DEFAULT_PATH;
  console.log(`파일: ${path}\n`);

  const wb = XLSX.readFile(path, { cellDates: true });
  const parsed = parseWorkbook(wb);

  console.log(`시트: ${parsed.sheetName} · 헤더 ${parsed.headerRowNo}행`);
  console.log(`읽은 거래: ${parsed.rows.length}건 · 오류 ${parsed.errors.length}건`);
  if (parsed.errors.length) {
    parsed.errors.slice(0, 10).forEach((e) => console.log(`   ⚠️  ${e.rowNo}행 — ${e.reason}`));
  }

  // 파싱 결과를 거래로 승격 (집계는 저장 형태와 동일한 타입으로 돌린다)
  const txs: FinTransaction[] = parsed.rows.map((r, i) => ({
    id: `row-${i}`,
    date: r.date,
    datetime: r.datetime,
    last4: r.last4,
    txType: r.txType,
    bizMajor: r.bizMajor,
    bizMinor: r.bizMinor,
    acctMajor: r.acctMajor,
    acctMid: r.acctMid,
    acctMinor: r.acctMinor,
    vendor: r.vendor,
    acctNote: r.acctNote,
    personalUse: r.personalUse,
    projectCode: r.projectCode,
    gross: r.gross,
    adjust: r.adjust,
    site: r.site,
    note: r.note,
    status: "confirmed",
    refundMatchId: r.refundMatchId,
    dedupHash: r.dedupHash,
    createdAt: 0,
  }));

  // ---- 1) 총계 대조 ----
  const t = totals(plOnly(txs));
  console.log("\n── 총계 대조 ──");
  const checks: [string, number, number][] = [
    ["총수입", t.income, EXPECTED.income],
    ["총지출", t.expense, EXPECTED.expense],
    ["환급", t.refund, EXPECTED.refund],
    ["순손익", t.net, EXPECTED.net],
  ];
  let ok = true;
  checks.forEach(([label, got, want]) => {
    const diff = Math.round(got - want);
    const pass = diff === 0;
    if (!pass) ok = false;
    console.log(
      `  ${pass ? "✅" : "❌"} ${label.padEnd(6)} 계산 ${won(got).padStart(14)}  기대 ${won(want).padStart(14)}` +
        (pass ? "" : `  차이 ${won(diff)}`),
    );
  });

  // ---- 2) 중복 키 유일성 ----
  const hashes = new Set(txs.map((x) => x.dedupHash));
  const dupes = txs.length - hashes.size;
  console.log("\n── 중복 검사 키 ──");
  console.log(
    `  ${dupes === 0 ? "✅" : "⚠️ "} 고유 ${hashes.size}/${txs.length}` +
      (dupes ? ` — ${dupes}건이 같은 키를 공유(동일 거래가 실제로 중복 기재됐을 수 있음)` : ""),
  );

  // ---- 3) 사업부손익 ----
  const pl = businessUnitPL(txs);
  console.log("\n── 사업부별 손익 ──");
  pl.rows.forEach((r) => {
    console.log(
      `  ${r.bizMajor.padEnd(5)} ${r.bizMinor.padEnd(8)} 수입 ${won(r.income).padStart(12)}  지출 ${won(r.expense).padStart(12)}  순손익 ${won(r.net).padStart(13)}`,
    );
  });
  console.log(
    `  ${"총계".padEnd(14)} 수입 ${won(pl.total.income).padStart(12)}  지출 ${won(pl.total.expense).padStart(12)}  순손익 ${won(pl.total.net).padStart(13)}`,
  );

  // ---- 4) 지출 매트릭스 합계 일치 ----
  const m = expenseMatrix(txs);
  const matrixOk = Math.round(m.grandTotal) === Math.round(t.expense - t.refund);
  if (!matrixOk) ok = false;
  console.log("\n── 지출 매트릭스 ──");
  console.log(
    `  ${matrixOk ? "✅" : "❌"} 합계 ${won(m.grandTotal)} (지출−환급 ${won(t.expense - t.refund)})  ${m.rowKeys.length}행 × ${m.colKeys.length}열`,
  );

  console.log(`\n${ok ? "✅ 전체 통과 — 엑셀과 원 단위로 일치합니다." : "❌ 불일치 있음"}`);
  process.exit(ok ? 0 : 1);
}

main();
