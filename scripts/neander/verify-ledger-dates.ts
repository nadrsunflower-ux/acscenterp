// ============================================================
//  엑셀 날짜 칸 읽기 점검 — DB 를 건드리지 않는다
// ------------------------------------------------------------
//  통합거래장의 날짜 칸이 글자가 아니라 **날짜 값**일 때, 엑셀에 적힌 그 날짜가
//  나오는지 본다. 예전에는 UTC 로 잘라 한국 시간 0시~9시가 전날이 됐다
//  (4,472건 — fix-ledger-dates.ts). 어느 시간대의 컴퓨터에서 올려도 같아야 한다.
//
//    npm run finance:verify-dates
//    TZ=UTC npm run finance:verify-dates        (다른 시간대에서도)
// ============================================================

import * as XLSX from "xlsx";
import { parseWorkbook } from "@/lib/neander/finance/xlsx";
import { parseDateTime } from "@/lib/neander/finance/adapters/util";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "  ✓" : "  ✗"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed += 1;
}

/** 엑셀 직렬값 — 2025-01-01 이 45658 이다 */
const D = (days: number, h = 0, m = 0, s = 0) => 45658 + days + (h * 3600 + m * 60 + s) / 86400;
const dateCell = (v: number, z = "yyyy-mm-dd hh:mm:ss") => ({ t: "n", v, z });

// 날짜 열 · 거래유형 · 원금액 · 거래처 (헤더는 파서가 찾는 이름)
const CASES: [string, number | string, string][] = [
  ["날짜만 적힌 칸 (0시)", D(55), "2025-02-25"],
  ["달의 첫날 — 전달 말일로 가면 안 된다", D(59), "2025-03-01"],
  ["해의 첫날", D(0), "2025-01-01"],
  ["새벽 2시 반", D(124, 2, 30), "2025-05-05"],
  ["아침 8시 59분", D(124, 8, 59, 59), "2025-05-05"],
  ["밤 11시 59분 59초", D(124, 23, 59, 59), "2025-05-05"],
  ["0시에 1ms 모자란 값 (소수 오차)", D(55) - 1e-8, "2025-02-25"],
  ["글자로 적힌 날짜", "2026.08.10 12:53:57", "2026-08-10"],
];

const ws = XLSX.utils.aoa_to_sheet([["거래일시", "거래유형", "원금액", "거래처"]]);
CASES.forEach(([name, v], i) => {
  XLSX.utils.sheet_add_aoa(ws, [[null, "지출", 1000 + i, name]], { origin: { r: i + 1, c: 0 } });
  ws[XLSX.utils.encode_cell({ r: i + 1, c: 0 })] = typeof v === "number" ? dateCell(v) : { t: "s", v };
});
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, "통합거래장");
// 파일로 썼다가 실제 적재와 같은 옵션으로 다시 읽는다
const parsed = parseWorkbook(XLSX.read(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }), { cellDates: true }));

console.log(`통합거래장 파서 (시간대 ${Intl.DateTimeFormat().resolvedOptions().timeZone})`);
check("모든 행을 읽는다", parsed.rows.length === CASES.length && parsed.errors.length === 0, `${parsed.rows.length}행`);
CASES.forEach(([name, , want], i) => {
  const row = parsed.rows[i];
  check(name, row?.date === want, `${row?.date}`);
  check(`  중복 키도 그 날짜로 시작한다`, !!row?.dedupHash.startsWith(`${want}¦`));
});

console.log("은행·카드 어댑터의 날짜 읽기");
const local = (y: number, mo: number, d: number, h = 0, mi = 0, s = 0, ms = 0) => new Date(y, mo - 1, d, h, mi, s, ms);
check("날짜만", parseDateTime(local(2025, 2, 25))?.date === "2025-02-25");
check("0시에 1ms 모자란 값", parseDateTime(local(2025, 2, 24, 23, 59, 59, 999))?.date === "2025-02-25");
check("0시에 1ms 모자란 값에는 시각을 붙이지 않는다", parseDateTime(local(2025, 2, 24, 23, 59, 59, 999))?.datetime === undefined);
check("새벽 거래", parseDateTime(local(2025, 5, 5, 2, 30))?.datetime === "2025-05-05 02:30:00");

console.log(failed === 0 ? "\n모두 통과" : `\n실패 ${failed}건`);
process.exit(failed === 0 ? 0 : 1);
