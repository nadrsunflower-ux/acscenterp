// ============================================================
//  엑셀 임포트 칸 점검 — DB 를 건드리지 않는다
// ------------------------------------------------------------
//  두 가지를 못 박는다.
//
//   ① 계좌번호 없는 파일(신한 grid)을 **추정으로** 칸에 넣어도 줄에 계좌가
//      찍힌다. 2026-09 에 이게 빠져 179건이 계좌 없이 들어갔고, 칸은
//      「적재됨 · 0건」으로 보였다.
//   ② 「이 달 거래 없음」 표시가 칸을 채운다. 다만 장부에 그 달 거래가
//      있으면 표시보다 거래를 믿는다.
//
//  가짜 워크북을 만들어 화면(import/page)과 같은 순서로 부른다.
//
//    npm run finance:verify-slots
// ============================================================

import * as XLSX from "xlsx";
import { parseWithAdapter } from "@/lib/neander/finance/adapters";
import {
  buildFinSlots,
  finPuzzleOf,
  monthOfRows,
  resolveFinSlot,
  withSlotAccount,
} from "@/lib/neander/finance/import-slots";
import type { FinPaymentMethodDoc } from "@/lib/neander/finance/db-types";
import type { FinImportBatch, FinTransaction } from "@/lib/neander/finance/types";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "  ✓" : "  ✗"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed += 1;
}

const pm = (last4: string, alias: string, site = "네안데르"): FinPaymentMethodDoc =>
  ({ id: last4, last4, alias, site, kind: "account" }) as FinPaymentMethodDoc;

/** 신한 기업뱅킹 grid 엑셀과 같은 열 — 계좌번호가 어디에도 없다 */
function shinhanWorkbook(rows: (string | number)[][]): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ["거래일시", "적요", "입금액", "출금액", "내용", "잔액", "거래점명"],
    ...rows,
  ]);
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  return wb;
}

const FILE = "grid_exceldata (8).xlsx";
const methods = [pm("4223", "신한출금"), pm("4248", "신한입금"), pm("9279", "우리온라인")];
const slots = buildFinSlots(methods);
const knownLast4 = methods.map((m) => m.last4);

// 지난달 이력 — 4223 은 급여·임대료가 나가는 통장, 4248 은 정산이 들어오는 통장
const tx = (last4: string, date: string, vendor: string, balanceAfter: number): FinTransaction =>
  ({
    id: `${last4}-${date}-${vendor}`,
    date,
    last4,
    vendor,
    gross: 1000,
    txType: "지출",
    status: "confirmed",
    balanceAfter,
    createdAt: 0,
  }) as FinTransaction;
const history: FinTransaction[] = [
  tx("4223", "2026-08-25", "김제연 급여", 5_000_000),
  tx("4223", "2026-08-28", "홍대 임대료", 3_200_000),
  tx("4248", "2026-08-30", "페이히어 정산", 9_000_000),
];

console.log("① 추정으로 찾은 칸에도 계좌가 찍힌다");
{
  const wb = shinhanWorkbook([
    ["2026-09-01 10:00:00", "BZ뱅크", 0, 200_000, "김제연 급여", 3_000_000, "홍대"],
    ["2026-09-10 11:30:00", "BZ뱅크", 0, 1_000_000, "홍대 임대료", 2_000_000, "홍대"],
  ]);
  const parse = (last4?: string) => parseWithAdapter(wb, { fileName: FILE, last4, knownLast4, ownEntities: [] });
  const first = parse();
  check("신한 양식으로 읽는다", first?.adapterId === "shinhan-bank", first?.adapterId ?? "못 읽음");
  if (first) {
    check("처음 읽으면 줄에 계좌가 없다", first.rows.length === 2 && first.rows.every((r) => !r.last4));
    const res = resolveFinSlot(first, slots, history);
    check(
      "잔액이 이어지는 4223 칸을 찾는다",
      res.kind === "slot" && res.slot.key === "account:4223",
      res.kind === "slot" ? res.reason ?? "" : res.kind,
    );
    if (res.kind === "slot") {
      const stamped = withSlotAccount(first, res.slot, parse);
      check("다시 읽으면 모든 줄에 4223 이 찍힌다", stamped.rows.every((r) => r.last4 === "4223"));
      check(
        "중복 키에도 계좌가 들어간다",
        stamped.rows.every((r) => r.dedupHash.split("¦")[1] === "4223"),
        stamped.rows[0]?.dedupHash,
      );
      const forced = parse("4223");
      check(
        "사람이 칸을 골랐을 때와 같은 줄이 나온다",
        JSON.stringify(forced?.rows) === JSON.stringify(stamped.rows),
      );
      check("줄 수·금액은 그대로다", stamped.rows.length === first.rows.length && stamped.rows[1].gross === first.rows[1].gross);
    }
    // 계좌가 이미 있는 줄은 건드리지 않는다
    const withAcct = parse("4248");
    let reparsed = 0;
    if (withAcct) {
      withSlotAccount(withAcct, slots.find((s) => s.key === "account:4223")!, (l) => {
        reparsed += 1;
        return parse(l);
      });
    }
    check("계좌가 이미 있으면 다시 읽지 않는다", reparsed === 0);
  }
}

console.log("\n①-2 신한 개인 인터넷뱅킹 양식 (.xls) — 계좌번호가 파일 안에 있다");
{
  // 개인사업자 명의 계좌(신한일컴)는 기업뱅킹 grid 가 아니라 이 모양으로 온다
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ["거래내역조회"],
    [],
    ["계좌번호", "100-037-891769"],
    ["조회기간", "2026.09.01 ~ 2026.09.30"],
    ["총건수", "2"],
    [],
    ["거래일자", "거래시간", "적요", "출금(원)", "입금(원)", "내용", "잔액(원)", "거래점"],
    ["2026-09-01", "19:36:34", "기업뱅킹 이체", 4400, 0, "공동인증수수료", 0, "대흥역"],
    ["2026-09-01", "19:36:09", "타행인터넷뱅킹", 0, 4400, "유재영", 4400, "(토스)"],
  ]);
  XLSX.utils.book_append_sheet(wb, ws, "신한은행_거래내역조회");
  const personalSlots = buildFinSlots([...methods, pm("1769", "신한일컴", "일해라컴퍼니")]);
  const r = parseWithAdapter(wb, { fileName: "복사본.xls", knownLast4: [...knownLast4, "1769"], ownEntities: [] });
  check("신한 양식으로 읽는다", r?.adapterId === "shinhan-bank", r?.adapterId ?? "못 읽음");
  if (r) {
    check("파일 안의 계좌번호를 읽는다", r.detectedLast4[0] === "1769", r.detectedLast4.join());
    check("두 줄 모두 계좌가 찍힌다", r.rows.length === 2 && r.rows.every((x) => x.last4 === "1769"));
    check("날짜와 시각을 합친다", r.rows[0].datetime === "2026-09-01 19:36:34", r.rows[0].datetime);
    check(
      "출금·입금 방향을 가른다",
      r.rows[0].txType === "지출" && r.rows[0].gross === 4400 && r.rows[1].txType === "수입" && r.rows[1].gross === 4400,
    );
    check("내용이 거래처, 적요·거래점은 비고", r.rows[0].vendor === "공동인증수수료" && /기업뱅킹 이체/.test(r.rows[0].note ?? ""));
    check("잔액 0 도 잔액으로 남긴다", r.rows[0].balanceAfter === 0 && r.rows[1].balanceAfter === 4400);
    const res = resolveFinSlot(r, personalSlots, []);
    check("추정 없이 1769 칸으로 간다", res.kind === "slot" && res.slot.key === "account:1769");
    check("한 달짜리 파일로 본다", monthOfRows(r.rows)?.month === "2026-09");
  }
}

console.log("\n② 거래가 한 줄도 없는 파일은 달을 알 수 없다");
{
  const empty = parseWithAdapter(shinhanWorkbook([]), { fileName: FILE, knownLast4, ownEntities: [] });
  check("0건으로 읽힌다", empty?.rows.length === 0 && empty.errors.length === 0);
  check("달을 정하지 못한다 (화면이 「거래 없음」으로 안내)", monthOfRows(empty?.rows ?? []) === null);
}

console.log("\n③ 「이 달 거래 없음」 표시");
{
  const mark: FinImportBatch = {
    id: "none-1",
    fileName: "거래 없음",
    inserted: 0,
    skipped: 0,
    createdAt: 1,
    month: "2026-09",
    slotKey: "account:9279",
    last4s: ["9279"],
    noActivity: true,
  };
  const before = finPuzzleOf(slots, "2026-09", history, []);
  const after = finPuzzleOf(slots, "2026-09", history, [mark]);
  const piece = after.pieces.find((p) => p.slot.key === "account:9279")!;
  check("표시 전에는 비어 있다", before.filled === 0);
  check("표시하면 그 칸만 채워진다", after.filled === 1 && piece.filled && piece.noActivity);
  check("다른 달에는 번지지 않는다", finPuzzleOf(slots, "2026-10", history, [mark]).filled === 0);

  const late = [...history, tx("9279", "2026-09-20", "네이버페이 정산", 100)];
  const withRows = finPuzzleOf(slots, "2026-09", late, [mark]).pieces.find((p) => p.slot.key === "account:9279")!;
  check("그 달 거래가 장부에 있으면 표시보다 거래를 믿는다", withRows.filled && !withRows.noActivity && withRows.count === 1);

  const all = finPuzzleOf(slots, "2026-09", history, [
    mark,
    { ...mark, id: "none-2", slotKey: "account:4223", last4s: ["4223"] },
    { ...mark, id: "none-3", slotKey: "account:4248", last4s: ["4248"] },
  ]);
  check("표시만으로도 퍼즐이 완성된다", all.complete);
}

console.log(failed === 0 ? "\n모두 통과" : `\n실패 ${failed}건`);
process.exit(failed === 0 ? 0 : 1);
