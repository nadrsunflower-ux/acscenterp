// ============================================================
//  월별 원가계산 엑셀 → 매출 모듈 적재 (CLI)
// ------------------------------------------------------------
//  `2601악센트원가계산.xlsx` … `2607…` 을 한 번에 읽어 판매 줄·이벤트를
//  Firestore 에 넣는다. 화면의 「매출 적재」는 POS 원본 한 파일을 올리는
//  용도이고, 이 스크립트는 **과거 월 일괄 이관**용이다.
//
//  ⚠️ 재무 장부에는 아무것도 쓰지 않는다. 매장 매출은 카드사 정산 입금으로
//     이미 장부에 있고, 여기서 만드는 것은 수량·원가·공헌이익을 보기 위한
//     판매 줄이다 (lib/neander/sales/types.ts 주석 참고).
//
//  다시 돌려도 안전하다: 적재 배치 id 가 (연월·매장·경로)로 결정되어
//  있어서, 쓰기 전에 그 배치의 줄을 먼저 지운다. 두 번 돌려도 두 배가
//  되지 않는다.
//
//    npm run sales:import            # 미리보기 (아무것도 쓰지 않음)
//    npm run sales:import -- --commit
//    npm run sales:import -- --commit --month=2603
// ============================================================

import { config } from "dotenv";
config({ path: ".env.local" });

import * as fs from "node:fs";
import * as path from "node:path";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import * as XLSX from "xlsx";
import { NEANDER_COL } from "@/lib/neander/collections";
import { SEED_ASSUMPTIONS, SEED_PRODUCTS } from "@/lib/neander/sales/master-data";
import { seedSalesMasterData } from "@/lib/neander/sales/server/seed";
import { resolveRows, summarize, type RawSaleRow } from "@/lib/neander/sales/resolve";
import { buildPnl } from "@/lib/neander/sales/aggregate";
import {
  parsePayMethod,
  REASON_LABEL,
  type PayRoute,
  type SalesEvent,
  type SalesLine,
  type SalesLineInput,
  type SalesStore,
} from "@/lib/neander/sales/types";

// 연도 폴더의 부모를 기본으로 둔다 — 2025·2026 을 한 번에 훑는다
const DEFAULT_DIR =
  "/Users/idongju/Library/Mobile Documents/com~apple~CloudDocs/*네안데르/0.네안데르 회계";

const args = process.argv.slice(2);
const COMMIT = args.includes("--commit");
const ONLY = args.find((a) => a.startsWith("--month="))?.slice("--month=".length);
const DIR = args.find((a) => a.startsWith("--dir="))?.slice("--dir=".length) ?? DEFAULT_DIR;
/** 미확정을 (매장·원본문구·금액)으로 묶어 큰 것부터 보여준다 — 화면의 검토 대기함과 같은 묶음 */
const BUCKETS = args.includes("--buckets");
/**
 * 이벤트의 준비물·방문자수를 엑셀 값으로 **덮어쓴다.**
 * 기본값은 사람이 화면에서 고친 값을 지키는 것이라, 엑셀 쪽을 고쳤을 때만 쓴다.
 */
const FORCE_EVENTS = args.includes("--force-events");
/**
 * 이벤트 문서를 전부 지우고 다시 만든다. 최초 일괄 이관에서만 쓴다 —
 * 사람이 화면에서 고친 준비물·방문자수까지 날아간다.
 */
const RESET_EVENTS = args.includes("--reset-events");

const won = (n: number) => Math.round(n).toLocaleString("ko-KR");
const pctOf = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(1)}%` : "—");

/** macOS 는 파일명을 NFD 로 준다 — 한글 비교 전에 NFC 로 맞춘다 */
const nfc = (s: string) => s.normalize("NFC");

// ============================================================
//  시트 읽기 도우미
// ============================================================

type Grid = unknown[][];

function sheetGrid(wb: XLSX.WorkBook, name: string): Grid | null {
  const real = wb.SheetNames.find((s) => nfc(s) === name);
  if (!real) return null;
  return XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[real], {
    header: 1,
    defval: null,
    blankrows: true,
    raw: true,
  });
}

const cell = (g: Grid, r: number, c: number) => g[r]?.[c] ?? null;
const text = (v: unknown) => (v === null || v === undefined ? "" : nfc(String(v)).trim());
const num = (v: unknown) => {
  if (typeof v === "number") return v;
  const n = Number(text(v).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

/** 라벨이 모두 들어 있는 헤더 행을 찾는다 (0-기준) */
function findHeader(g: Grid, labels: string[], limit = 40): number | null {
  for (let r = 0; r < Math.min(g.length, limit); r++) {
    const row = (g[r] ?? []).map(text);
    if (labels.every((l) => row.some((v) => v.includes(l)))) return r;
  }
  return null;
}

/**
 * 헤더 행에서 라벨에 해당하는 열 (0-기준, 없으면 -1).
 *
 * ⚠️ **정확히 일치하는 열을 먼저** 찾는다. 네이버 예약 헤더에는
 *    「상품주문번호」가 「상품」보다 앞에 있어서, 포함 검사만 하면 상품명
 *    대신 주문번호를 읽는다 (그러면 전 건이 「모르는 상품명」이 된다).
 *    포함 검사는 달마다 열 이름이 조금씩 다른 경우의 대비책으로만 쓴다
 *    (2월 온라인 시트의 「입금액(배송비포함)」).
 */
function colOf(g: Grid, header: number, label: string): number {
  const row = (g[header] ?? []).map(text);
  const exact = row.findIndex((v) => v === label);
  if (exact >= 0) return exact;
  return row.findIndex((v) => v.includes(label));
}

/** 엑셀 날짜 → YYYY-MM-DD */
function toDate(v: unknown): string {
  if (v instanceof Date) {
    const p = (n: number) => String(n).padStart(2, "0");
    return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`;
  }
  if (typeof v === "number" && v > 20000 && v < 80000) {
    // 엑셀 시리얼 날짜 (1899-12-30 기준)
    const d = new Date(Date.UTC(1899, 11, 30) + v * 86400000);
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
  }
  const s = text(v);
  const m = s.match(/(\d{4})[-./]\s*(\d{1,2})[-./]\s*(\d{1,2})/);
  if (!m) return "";
  const p = (n: string) => n.padStart(2, "0");
  return `${m[1]}-${p(m[2])}-${p(m[3])}`;
}

/** 네이버 「26. 7. 1.(수) 오후 2:00」 → 2026-07-01 */
function toNaverDate(v: unknown): string {
  const s = text(v);
  const m = s.match(/(\d{2,4})\s*\.\s*(\d{1,2})\s*\.\s*(\d{1,2})/);
  if (!m) return "";
  const yy = Number(m[1]);
  const year = yy < 100 ? 2000 + yy : yy;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${year}-${p(Number(m[2]))}-${p(Number(m[3]))}`;
}

// ============================================================
//  이벤트 — 이벤트마스터 + 준비물 + 방문자통계
// ============================================================

/**
 * 이벤트별 준비물 — 「입력_이벤트준비물」 상세 시트에서 코드별로 더한다.
 *
 * ⚠️ 와우매장·아이디매장 시트에도 「준비물」 합계 열이 있지만 **여러 달에서
 *    깨져 있다.** 상세 시트와 집계 열을 월별로 비교하면:
 *      1월 +0 · 2월 +583,860 · 3월 +651,850 · 4월 +415,970
 *      5월 +1,781,760 · 6월 +1,463,500 · 7월 +0
 *    5·6월은 집계가 **전부 0** 이고 상세에는 데이터가 있다. 합치면 이벤트
 *    준비물 4,896,940원이 엑셀 자체 손익에서 빠져 있었다.
 *
 *    1월·7월은 두 값이 원 단위로 같아서, 상세 합산이 집계가 의도한 값과
 *    같은 것이 확인된다 — 그래서 상세를 정본으로 쓴다.
 *
 *    집계 열은 상세 시트가 없을 때의 대비책으로만 남긴다.
 */
function suppliesByCode(wb: XLSX.WorkBook): Map<string, number> {
  const out = new Map<string, number>();
  const g = sheetGrid(wb, "입력_이벤트준비물");
  if (g) {
    // 와우·아이디 구역마다 헤더(이벤트코드 | … | 금액)가 반복된다
    let cCode = -1;
    let cAmt = -1;
    for (let r = 0; r < g.length; r++) {
      const row = (g[r] ?? []).map(text);
      const iCode = row.indexOf("이벤트코드");
      const iAmt = row.indexOf("금액");
      if (iCode >= 0 && iAmt >= 0) {
        cCode = iCode;
        cAmt = iAmt;
        continue;
      }
      if (cCode < 0) continue;
      const code = text(cell(g, r, cCode));
      if (!/^(WE|ID|IE)-\d+/.test(code)) continue;
      const v = cell(g, r, cAmt);
      if (typeof v !== "number") continue;
      out.set(code, (out.get(code) ?? 0) + v);
    }
  }
  if (out.size > 0) return out;

  // 대비책 — 상세 시트가 없으면 집계 열을 쓴다
  for (const name of ["와우매장", "아이디매장"]) {
    const gg = sheetGrid(wb, name);
    if (!gg) continue;
    const h = findHeader(gg, ["코드", "준비물"]);
    if (h === null) continue;
    const cCode = colOf(gg, h, "코드");
    const cSup = colOf(gg, h, "준비물");
    if (cCode < 0 || cSup < 0) continue;
    for (let r = h + 1; r < gg.length; r++) {
      const code = text(cell(gg, r, cCode));
      if (!/^(WE|ID|IE)-\d+/.test(code)) continue;
      out.set(code, num(cell(gg, r, cSup)));
    }
  }
  return out;
}

/**
 * 방문자통계 — 날짜별 구매/미구매. 이벤트 귀속은 **기간**으로 한다
 * (통계 시트의 이벤트명은 「윤두준」 같은 약칭이라 이름으로 못 맞춘다).
 *
 * ⚠️ 이 시트는 달마다 새로 쓰는 게 아니라 1월부터 **누적**돼 파일마다
 *    복사돼 있는데, 사본끼리 내용이 다르다.
 *
 *      · 5월 파일의 사본은 4월까지만 채워져 있다 (5월 방문자는 6월 파일에)
 *      · 2월 파일에는 2월 방문자가 19일치인데, 7월 파일의 사본에는
 *        10일치만 남아 있다 — 이어 복사하면서 9일치(로제·재현·용희·
 *        도영정우)가 사라졌다. 7월 파일의 월별 요약도 남은 10일치로
 *        계산돼 있어서, 2월 전환율이 실제보다 적게 집계돼 왔다.
 *
 *    그래서 **파일 전체를 합치고**, 같은 날짜가 여러 파일에 있으면 그 날이
 *    속한 달의 파일 값을 우선한다 (행사 직후에 적은 값이 가장 정확하다).
 */
function visitorsByDate(wb: XLSX.WorkBook): Map<string, { buyers: number; non: number }> {
  const out = new Map<string, { buyers: number; non: number }>();
  const g = sheetGrid(wb, "방문자통계");
  if (!g) return out;
  const h = findHeader(g, ["날짜", "구매자수"]);
  if (h === null) return out;
  const cDate = colOf(g, h, "날짜");
  const cBuy = colOf(g, h, "구매자수");
  const cNon = colOf(g, h, "미구매자수");
  for (let r = h + 1; r < g.length; r++) {
    const d = toDate(cell(g, r, cDate));
    if (!d) continue;
    const b = num(cell(g, r, cBuy));
    const n = cNon >= 0 ? num(cell(g, r, cNon)) : 0;
    if (b === 0 && n === 0) continue;
    const cur = out.get(d) ?? { buyers: 0, non: 0 };
    out.set(d, { buyers: cur.buyers + b, non: cur.non + n });
  }
  return out;
}

function readEvents(
  wb: XLSX.WorkBook,
  visitors: Map<string, { buyers: number; non: number }>,
  /** 코드가 다른 달과 겹치면 붙일 접미사 (`@2605`). 겹치지 않으면 빈 문자열 */
  suffixFor: (code: string) => string,
): SalesEvent[] {
  const g = sheetGrid(wb, "입력_이벤트마스터");
  if (!g) return [];
  const supplies = suppliesByCode(wb);
  const events: SalesEvent[] = [];

  // 「[ 와우 이벤트 ]」 / 「[ 아이디 이벤트 ]」 구역을 찾아 그 아래 표를 읽는다
  const sections: { store: SalesStore; from: number }[] = [];
  for (let r = 0; r < g.length; r++) {
    const v = text(cell(g, r, 0));
    if (v.includes("와우 이벤트")) sections.push({ store: "wow", from: r });
    if (v.includes("아이디 이벤트")) sections.push({ store: "id", from: r });
  }

  sections.forEach((sec, i) => {
    const end = sections[i + 1]?.from ?? g.length;
    const h = findHeader(g.slice(sec.from, end), ["코드", "이벤트명", "시작일"], 5);
    if (h === null) return;
    const hRow = sec.from + h;
    const c = {
      code: colOf(g, hRow, "코드"),
      name: colOf(g, hRow, "이벤트명"),
      from: colOf(g, hRow, "시작일"),
      to: colOf(g, hRow, "종료일"),
      hours: colOf(g, hRow, "일시간"),
      staff: colOf(g, hRow, "스태프"),
      wage: colOf(g, hRow, "시급"),
    };
    for (let r = hRow + 1; r < end; r++) {
      const code = text(cell(g, r, c.code));
      if (!/^(WE|ID|IE)-\d+/.test(code)) continue;
      const from = toDate(cell(g, r, c.from));
      const to = toDate(cell(g, r, c.to)) || from;
      const name = text(cell(g, r, c.name));
      if (!from || !name) continue;

      // 방문자 기록은 기간으로 합산한다 (통계 시트의 이벤트명은 약칭이라
      // 이름으로 맞추면 놓친다 — 「윤두준」 vs 「하이라이트 윤두준」)
      let buyers = 0;
      let non = 0;
      let seen = false;
      for (const [d, v] of visitors) {
        if (d >= from && d <= to) {
          buyers += v.buyers;
          non += v.non;
          seen = true;
        }
      }

      const ev: SalesEvent = {
        id: code + suffixFor(code),
        store: sec.store,
        name,
        from,
        to,
        hoursPerDay: num(cell(g, r, c.hours)),
        staff: num(cell(g, r, c.staff)),
        supplies: supplies.get(code) ?? 0,
      };
      const wage = num(cell(g, r, c.wage));
      if (wage > 0) ev.wage = wage;
      // 방문자 통계는 와우 팝업만 집계해 왔다
      if (seen && sec.store === "wow") {
        ev.buyers = buyers;
        ev.nonBuyers = non;
      }
      events.push(ev);
    }
  });
  return events;
}

// ============================================================
//  입력 시트 → 원본 판매 줄
// ============================================================

interface SourceSpec {
  sheet: string;
  store: SalesStore;
  route: PayRoute;
}

const SOURCES: SourceSpec[] = [
  { sheet: "입력_페이히어_와우", store: "wow", route: "payhere" },
  { sheet: "입력_페이히어_아이디", store: "id", route: "payhere" },
  { sheet: "입력_페이히어_온라인", store: "online", route: "online" },
  { sheet: "입력_네이버예약", store: "id", route: "naver" },
];

interface ReadResult {
  rows: RawSaleRow[];
  /** 0원 결제 (무료 증정 등) — 매출이 아니라 제외하지만 건수는 남긴다 */
  zero: number;
  /** 원본 합계 */
  total: number;
}

function readSource(wb: XLSX.WorkBook, spec: SourceSpec): ReadResult | null {
  const g = sheetGrid(wb, spec.sheet);
  if (!g) return null;

  if (spec.sheet === "입력_네이버예약") {
    const h = findHeader(g, ["예약번호", "이용일시", "실결제금액"]);
    if (h === null) return null;
    const c = {
      used: colOf(g, h, "이용일시"),
      product: colOf(g, h, "상품"),
      people: colOf(g, h, "인원"),
      paid: colOf(g, h, "실결제금액"),
      refund: colOf(g, h, "환불금액"),
      payStatus: colOf(g, h, "결제상태"),
      // 결제수단이 여기서 갈린다 — 「N페이」가 Npay 면 Npay 예약 수수료,
      // 비어 있으면 Npay 를 안 쓴 건(현장결제)이라 카드 수수료다.
      npay: colOf(g, h, "N페이"),
      bookType: colOf(g, h, "예약유형"),
    };
    const rows: RawSaleRow[] = [];
    let zero = 0;
    /** Npay 가 아닌 유료 건 — 현장결제면 페이히어에도 찍혀 이중계상이 된다 */
    let offNpay = 0;
    /** 영문 예약(외국인) — 해외발급카드였다면 3.5% 다 */
    let foreign = 0;
    for (let r = h + 1; r < g.length; r++) {
      const date = toNaverDate(cell(g, r, c.used));
      if (!date) continue;
      const paid = num(cell(g, r, c.paid));
      if (paid === 0) {
        zero += 1;
        continue;
      }
      const refunded = c.refund >= 0 ? num(cell(g, r, c.refund)) : 0;
      const payStatus = c.payStatus >= 0 ? text(cell(g, r, c.payStatus)) : "";
      const npay = c.npay >= 0 ? text(cell(g, r, c.npay)) : "";
      const bookType = c.bookType >= 0 ? text(cell(g, r, c.bookType)) : "";
      if (c.npay >= 0 && !npay) offNpay += 1;
      if (/영문/.test(bookType)) foreign += 1;
      rows.push({
        date,
        items: [text(cell(g, r, c.product)), text(cell(g, r, c.people))]
          .filter(Boolean)
          .join(" · "),
        total: paid,
        refundedAt: refunded > 0 || payStatus === "환불완료" ? payStatus || "환불" : undefined,
        // Npay 결제면 Npay 예약 수수료. 열이 없던 옛 파일은 비워 두고
        // 경로 기본값(네이버 = Npay 예약)에 맡긴다.
        payMethod: npay ? parsePayMethod(npay) : undefined,
      });
    }
    if (offNpay > 0) {
      console.log(
        `   ⚠️ 네이버 예약: Npay 가 아닌 유료 건 ${offNpay}건 — 현장결제라면 카드 수수료이고,\n` +
          `      페이히어 시트에도 찍혀 있으면 매출이 두 번 잡힌다. 확인이 필요하다.`,
      );
    }
    if (foreign > 0) {
      console.log(
        `   ⚠️ 네이버 예약: 영문 예약 ${foreign}건 — 해외발급카드로 결제됐다면 3.5% 다\n` +
          `      (지금은 국내 예약 요율 1.8% 로 본다). Npay센터 정산 내역에서 확인할 것.`,
      );
    }
    return { rows, zero, total: rows.reduce((s, x) => s + x.total, 0) };
  }

  // 페이히어 — 열 이름이 달마다 조금씩 다르다 (2월 온라인은 「입금액(배송비포함)」)
  const h = findHeader(g, ["결제일", "결제 내역"]);
  if (h === null) return null;
  const cDate = colOf(g, h, "결제일");
  const cItem = colOf(g, h, "결제 내역");
  const cQty = colOf(g, h, "수량");
  // 결제수단 — 페이히어 원본에는 있지만, 엑셀에 붙여넣을 때 네 열
  // (결제일·결제시간·결제 내역·합계)만 남기는 달이 많다. 있으면 쓴다.
  const cMethod = ["결제수단", "결제 수단", "승인구분"]
    .map((l) => colOf(g, h, l))
    .find((i) => i >= 0) ?? -1;
  const amountCandidates = ["입금액", "금액", "합계"]
    .map((l) => colOf(g, h, l))
    .filter((i) => i >= 0);
  const rows: RawSaleRow[] = [];
  let zero = 0;
  let unknownMethod = 0;
  for (let r = h + 1; r < g.length; r++) {
    const date = toDate(cell(g, r, cDate));
    if (!date) continue;
    // 금액 열이 여러 개면 값이 있는 것을 쓴다 (「합계」가 비고 열일 수도 있다)
    let total = 0;
    for (const ci of amountCandidates) {
      const v = num(cell(g, r, ci));
      if (v > 0) {
        total = v;
        break;
      }
    }
    if (total === 0) {
      zero += 1;
      continue;
    }
    const qty = cQty >= 0 ? num(cell(g, r, cQty)) : 0;
    const method = cMethod >= 0 ? parsePayMethod(text(cell(g, r, cMethod))) : undefined;
    if (cMethod >= 0 && !method) unknownMethod += 1;
    rows.push({
      date,
      items: text(cell(g, r, cItem)),
      total,
      qty: qty > 0 ? qty : undefined,
      payMethod: method,
    });
  }
  if (cMethod < 0 && rows.length > 0) {
    console.log(
      `   ⚠️ ${spec.sheet}: 결제수단 열이 없다 — 전부 신용카드 요율로 계산한다.\n` +
        `      체크카드(0.15%)·현금성 간편결제가 섞여 있으면 그만큼 어긋난다.\n` +
        `      페이히어 매출내역을 열 그대로(결제수단 포함) 붙여넣으면 정확해진다.`,
    );
  } else if (unknownMethod > 0) {
    console.log(`   ⚠️ ${spec.sheet}: 모르는 결제수단 문구 ${unknownMethod}건 — 신용카드로 본다.`);
  }
  return { rows, zero, total: rows.reduce((s, x) => s + x.total, 0) };
}

// ============================================================
//  Firestore
// ============================================================

function initAdmin() {
  if (getApps().length > 0) return;
  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_B64;
  if (!b64) throw new Error("FIREBASE_SERVICE_ACCOUNT_B64 가 없습니다 (.env.local 확인).");
  const sa = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
  initializeApp({
    credential: cert({
      projectId: sa.project_id,
      clientEmail: sa.client_email,
      privateKey: sa.private_key,
    }),
  });
}

const BATCH_LIMIT = 450;

function clean(o: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  Object.keys(o).forEach((k) => {
    if (o[k] !== undefined) out[k] = o[k];
  });
  return out;
}

/** 그 배치가 만든 줄을 지운다 — 다시 돌려도 두 배가 되지 않게 */
async function deleteBatch(db: Firestore, importId: string): Promise<number> {
  const snap = await db
    .collection(NEANDER_COL.salesLines)
    .where("importId", "==", importId)
    .get();
  for (let i = 0; i < snap.docs.length; i += BATCH_LIMIT) {
    const wb = db.batch();
    snap.docs.slice(i, i + BATCH_LIMIT).forEach((d) => wb.delete(d.ref));
    await wb.commit();
  }
  return snap.size;
}

async function writeLines(db: Firestore, lines: SalesLineInput[], importId: string) {
  for (let i = 0; i < lines.length; i += BATCH_LIMIT) {
    const wb = db.batch();
    lines.slice(i, i + BATCH_LIMIT).forEach((l) => {
      wb.set(db.collection(NEANDER_COL.salesLines).doc(), clean({ ...l, importId }));
    });
    await wb.commit();
  }
}

/**
 * 이벤트는 사람이 준비물·방문자수를 고치는 값이라 통째로 덮어쓰지 않는다.
 * 이미 있으면 기간·이름만 맞추고, 준비물·방문자는 **비어 있을 때만** 채운다.
 */
async function upsertEvents(db: Firestore, events: SalesEvent[], now: number) {
  const col = db.collection(NEANDER_COL.salesEvents);
  const existing = new Map<string, Record<string, unknown>>();
  const snap = await col.get();
  snap.docs.forEach((d) => existing.set(d.id, d.data()));

  let created = 0;
  let updated = 0;
  for (let i = 0; i < events.length; i += BATCH_LIMIT) {
    const wb = db.batch();
    events.slice(i, i + BATCH_LIMIT).forEach((e) => {
      const prev = existing.get(e.id);
      const patch: Record<string, unknown> = {
        id: e.id,
        store: e.store,
        name: e.name,
        from: e.from,
        to: e.to,
        hoursPerDay: e.hoursPerDay,
        staff: e.staff,
        updatedAt: now,
      };
      if (e.wage !== undefined) patch.wage = e.wage;
      if (prev === undefined) {
        patch.supplies = e.supplies;
        if (e.buyers !== undefined) patch.buyers = e.buyers;
        if (e.nonBuyers !== undefined) patch.nonBuyers = e.nonBuyers;
        patch.createdAt = now;
        created += 1;
      } else if (FORCE_EVENTS) {
        // 엑셀을 정본으로 다시 맞춘다 (준비물 집계가 깨져 있던 달의 보정)
        patch.supplies = e.supplies;
        if (e.buyers !== undefined) patch.buyers = e.buyers;
        if (e.nonBuyers !== undefined) patch.nonBuyers = e.nonBuyers;
        updated += 1;
      } else {
        // 사람이 넣은 값은 건드리지 않는다
        if (!prev.supplies) patch.supplies = e.supplies;
        if (prev.buyers === undefined && e.buyers !== undefined) patch.buyers = e.buyers;
        if (prev.nonBuyers === undefined && e.nonBuyers !== undefined) {
          patch.nonBuyers = e.nonBuyers;
        }
        updated += 1;
      }
      wb.set(col.doc(e.id), clean(patch), { merge: true });
    });
    await wb.commit();
  }
  return { created, updated };
}

// ============================================================
//  본체
// ============================================================

interface MonthResult {
  yymm: string;
  month: string;
  events: SalesEvent[];
  lines: SalesLine[];
  drafts: { importId: string; spec: SourceSpec; lines: SalesLineInput[]; read: ReadResult }[];
}

/**
 * 원가계산 엑셀 찾기 — 이름 규칙이 연도마다 다르다.
 *
 *   2026: `2601악센트원가계산.xlsx` … 파일명에 연월이 있다
 *   2025: `(0103최종)악센트홍대점_원가계산_BEP_v5_37.xlsx` — 연월이 없고,
 *         같은 내용의 사본이 `0.연말결산` 과 `12월` 에 둘 다 있다.
 *         내용은 2025-12 한 달뿐이라 연월을 2512 로 고정하고, 사본 중
 *         **가장 큰 파일**(= 가장 완전한 버전) 하나만 쓴다.
 */
function findFiles(): { yymm: string; file: string }[] {
  if (!fs.existsSync(DIR)) throw new Error(`경로를 찾을 수 없습니다: ${DIR}`);
  const found = new Map<string, { file: string; size: number }>();

  const walk = (dir: string, depth: number) => {
    if (depth > 3) return;
    for (const entry of fs.readdirSync(dir)) {
      if (entry.startsWith(".")) continue;
      const full = path.join(dir, entry);
      let st: fs.Stats;
      try {
        st = fs.statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        walk(full, depth + 1);
        continue;
      }
      const n = nfc(entry);
      if (n.startsWith("~$") || !/\.xlsx?$/i.test(n)) continue;

      let yymm: string | null = null;
      const m = n.match(/^(\d{4})악센트원가계산/);
      if (m) yymm = m[1];
      else if (/악센트홍대점_원가계산_BEP/.test(n)) yymm = "2512";
      if (!yymm) continue;

      const prev = found.get(yymm);
      // 같은 달에 사본이 여럿이면 더 큰(더 완전한) 것을 쓴다
      if (!prev || st.size > prev.size) found.set(yymm, { file: full, size: st.size });
    }
  };
  walk(DIR, 0);

  return [...found.entries()]
    .map(([yymm, v]) => ({ yymm, file: v.file }))
    .sort((a, b) => a.yymm.localeCompare(b.yymm));
}

function processFile(
  yymm: string,
  file: string,
  visitors: Map<string, { buyers: number; non: number }>,
  colliding: Set<string>,
): MonthResult {
  const month = `20${yymm.slice(0, 2)}-${yymm.slice(2)}`;
  const wb = XLSX.readFile(file, { cellDates: true });
  const events = readEvents(wb, visitors, (code) =>
    colliding.has(code) ? `@${yymm}` : "",
  );

  const drafts: MonthResult["drafts"] = [];
  const lines: SalesLine[] = [];
  for (const spec of SOURCES) {
    const read = readSource(wb, spec);
    if (!read || read.rows.length === 0) continue;
    const importId = `xlsx-${yymm}-${spec.store}-${spec.route}`;
    const ls = resolveRows(
      read.rows,
      {
        products: SEED_PRODUCTS,
        events,
        store: spec.store,
        route: spec.route,
        assumptions: SEED_ASSUMPTIONS,
      },
      { importId },
    );
    drafts.push({ importId, spec, lines: ls, read });
    ls.forEach((l, i) => lines.push({ ...l, id: `${importId}-${i}` }));
  }
  return { yymm, month, events, lines, drafts };
}

function report(r: MonthResult) {
  const all = r.drafts.flatMap((d) => d.lines);
  const s = summarize(all);
  const pnl = buildPnl(r.month, r.lines, SEED_PRODUCTS, [], SEED_ASSUMPTIONS);
  const withEvents = buildPnl(r.month, r.lines, SEED_PRODUCTS, r.events, SEED_ASSUMPTIONS);

  console.log(`\n━━ ${r.month}  이벤트 ${r.events.length}건` +
    (r.events.length
      ? ` (준비물 ${won(r.events.reduce((a, e) => a + e.supplies, 0))}원` +
        `, 방문자 기록 ${r.events.filter((e) => e.buyers !== undefined).length}건)`
      : ""));
  r.drafts.forEach((d) => {
    const ds = summarize(d.lines);
    const zero = d.read.zero > 0 ? ` · 0원 ${d.read.zero}건 제외` : "";
    console.log(
      `   ${d.spec.sheet.replace("입력_", "").padEnd(12)} ${String(ds.rows).padStart(4)}줄` +
        ` ${won(ds.total).padStart(12)}원  확정 ${pctOf(ds.resolvedAmount, ds.total).padStart(6)}${zero}`,
    );
    ds.byReason.forEach((x) =>
      console.log(`        · ${REASON_LABEL[x.reason]} ${x.count}건 ${won(x.amount)}원`),
    );
  });
  console.log(
    `   합계 ${String(s.rows).padStart(4)}줄 ${won(s.total).padStart(12)}원` +
      `  확정 ${pctOf(s.resolvedAmount, s.total)}  미확정 ${won(s.reviewAmount)}원`,
  );
  console.log(
    `   손익: 매출 ${won(withEvents.total.revenue)} · 확정 ${won(withEvents.total.confirmedRevenue)}` +
      ` · 공헌 ${won(withEvents.total.contribution)} (${pctOf(withEvents.total.contribution, withEvents.total.confirmedRevenue)})` +
      ` · 영업 ${won(withEvents.total.operating)}`,
  );
  if (pnl.total.revenue !== withEvents.total.revenue) {
    console.log("   ⚠️ 이벤트 유무로 매출이 달라졌다 — 확인 필요");
  }
  return s;
}

(async () => {
  const files = findFiles().filter((f) => !ONLY || f.yymm === ONLY);
  if (files.length === 0) {
    console.log("대상 파일이 없습니다.");
    return;
  }
  console.log(`대상 ${files.length}개 파일${COMMIT ? " · 적재 모드" : " · 미리보기 (쓰지 않음)"}`);

  // 방문자통계는 파일마다 사본이 다르므로 전부 합친다 (위 주석 참고).
  // 대상 월만 골라 돌릴 때도 전체 파일에서 모은다.
  const visitors = new Map<string, { buyers: number; non: number }>();
  const ownMonth = new Set<string>();
  let overrides = 0;
  for (const f of findFiles()) {
    const fileMonth = `20${f.yymm.slice(0, 2)}-${f.yymm.slice(2)}`;
    const v = visitorsByDate(XLSX.readFile(f.file, { cellDates: true }));
    for (const [date, val] of v) {
      const isOwn = date.startsWith(fileMonth);
      if (!visitors.has(date)) {
        visitors.set(date, val);
        if (isOwn) ownMonth.add(date);
      } else if (isOwn && !ownMonth.has(date)) {
        // 그 달의 파일이 더 정확하다 — 덮어쓴다
        const prev = visitors.get(date)!;
        if (prev.buyers !== val.buyers || prev.non !== val.non) overrides += 1;
        visitors.set(date, val);
        ownMonth.add(date);
      }
    }
  }
  console.log(
    `방문자통계: 파일 전체 합산 ${visitors.size}일치` +
      ` (그 달 파일 우선 ${ownMonth.size}일, 값 교체 ${overrides}일)`,
  );

  // 같은 이벤트 코드가 다른 달의 **다른 행사**에 재사용된 경우가 있다
  // (ID-022·023·024 → 5월 EXO 백현/영탁/투어스 영재, 6월 에이티즈 강여상/
  // 임영웅/NCT WISH 리쿠). 코드를 문서 id 로 쓰면 뒤 파일이 앞 파일을
  // 덮어써 5월 3건이 사라진다. 그래서 겹치는 코드에만 `@연월` 을 붙인다.
  const occurrences = new Map<string, Set<string>>();
  for (const f of findFiles()) {
    const wb = XLSX.readFile(f.file, { cellDates: true });
    readEvents(wb, new Map(), () => "").forEach((e) => {
      const set = occurrences.get(e.id) ?? new Set<string>();
      set.add(`${e.from}~${e.to}`);
      occurrences.set(e.id, set);
    });
  }
  const colliding = new Set(
    [...occurrences.entries()].filter(([, v]) => v.size > 1).map(([k]) => k),
  );
  if (colliding.size > 0) {
    console.log(
      `코드 충돌 ${colliding.size}건 — 월 접미사를 붙입니다: ${[...colliding].join(", ")}`,
    );
  }

  const results = files.map((f) => processFile(f.yymm, f.file, visitors, colliding));
  const sums = results.map(report);

  // ---- 전체 합계 -------------------------------------------
  const rows = sums.reduce((a, s) => a + s.rows, 0);
  const total = sums.reduce((a, s) => a + s.total, 0);
  const resolved = sums.reduce((a, s) => a + s.resolvedAmount, 0);
  const review = sums.reduce((a, s) => a + s.reviewAmount, 0);
  const events = results.reduce((a, r) => a + r.events.length, 0);
  console.log("\n══ 전체 ══");
  console.log(`   판매 줄 ${won(rows)}  이벤트 ${events}건`);
  console.log(`   원본 합계 ${won(total)}원`);
  console.log(`   상품 확정 ${won(resolved)}원 (${pctOf(resolved, total)})`);
  console.log(`   미확정   ${won(review)}원 (${pctOf(review, total)})`);

  // 미확정 이유를 전체로 모아 — 무엇부터 손봐야 하는지
  const byReason = new Map<string, { count: number; amount: number }>();
  sums.forEach((s) =>
    s.byReason.forEach((x) => {
      const cur = byReason.get(x.reason) ?? { count: 0, amount: 0 };
      byReason.set(x.reason, { count: cur.count + x.count, amount: cur.amount + x.amount });
    }),
  );
  console.log("\n   미확정 이유 (금액순)");
  [...byReason.entries()]
    .sort((a, b) => b[1].amount - a[1].amount)
    .forEach(([k, v]) =>
      console.log(
        `     ${REASON_LABEL[k as keyof typeof REASON_LABEL].padEnd(8)} ${String(v.count).padStart(4)}건 ${won(v.amount).padStart(12)}원`,
      ),
    );

  if (BUCKETS) {
    const b = new Map<string, { store: string; raw: string; amount: number; n: number; sum: number; reason?: string }>();
    results.forEach((r) =>
      r.lines
        .filter((l) => l.status === "needs_review")
        .forEach((l) => {
          const k = `${l.store}|${l.raw}|${l.amount}`;
          const cur = b.get(k) ?? { store: l.store, raw: l.raw, amount: l.amount, n: 0, sum: 0, reason: l.reason };
          cur.n += 1;
          cur.sum += l.amount;
          b.set(k, cur);
        }),
    );
    console.log("\n══ 미확정 묶음 (금액 큰 순, 상위 30) ══");
    console.log("   화면 검토 대기함에서는 이 묶음 하나가 한 번 클릭이다.");
    [...b.values()]
      .sort((x, y) => y.sum - x.sum)
      .slice(0, 30)
      .forEach((x) =>
        console.log(
          `   ${x.store.padEnd(6)} ${String(x.n).padStart(4)}건 ${won(x.sum).padStart(11)}원` +
            ` @${won(x.amount).padStart(8)}  ${(x.reason ?? "").padEnd(14)} 「${x.raw}」`,
        ),
      );
    console.log(`   … 총 ${b.size}개 묶음`);
  }

  if (!COMMIT) {
    console.log("\n미리보기였습니다. 실제로 넣으려면 --commit 을 붙이세요.");
    return;
  }

  // ---- 적재 -------------------------------------------------
  initAdmin();
  const db = getFirestore();
  const now = Date.now();
  console.log("\n══ 적재 ══");

  if (RESET_EVENTS) {
    const snap = await db.collection(NEANDER_COL.salesEvents).get();
    for (let i = 0; i < snap.docs.length; i += BATCH_LIMIT) {
      const wb = db.batch();
      snap.docs.slice(i, i + BATCH_LIMIT).forEach((d) => wb.delete(d.ref));
      await wb.commit();
    }
    console.log(`   이벤트 ${snap.size}건 삭제 (--reset-events)`);
  }

  // 판매 줄이 참조하는 상품·기본가정이 먼저 있어야 화면이 계산할 수 있다
  const seeded = await seedSalesMasterData(db);
  console.log(`   마스터: 상품 ${seeded.products}종 · 기본가정 1벌`);

  for (const r of results) {
    const ev = await upsertEvents(db, r.events, now);
    console.log(`   ${r.month} 이벤트: 새로 ${ev.created} · 갱신 ${ev.updated}`);
    for (const d of r.drafts) {
      const removed = await deleteBatch(db, d.importId);
      await writeLines(db, d.lines, d.importId);
      const ds = summarize(d.lines);
      await db
        .collection(NEANDER_COL.salesImports)
        .doc(d.importId)
        .set(
          clean({
            id: d.importId,
            fileName: `${r.yymm}악센트원가계산.xlsx`,
            sourceLabel: `원가계산 엑셀 · ${d.spec.sheet.replace("입력_", "")}`,
            store: d.spec.store,
            route: d.spec.route,
            from: d.lines.map((l) => l.date).sort()[0],
            to: d.lines.map((l) => l.date).sort().slice(-1)[0],
            rows: ds.rows,
            resolved: ds.resolved,
            needsReview: ds.needsReview,
            sourceTotal: d.read.total,
            loadedTotal: ds.total,
            createdAt: now,
            createdBy: "scripts/import-sales-xlsx",
          }),
          { merge: true },
        );
      console.log(
        `     ${d.importId}  ${removed > 0 ? `기존 ${removed}줄 교체 → ` : ""}${ds.rows}줄`,
      );
    }
  }
  console.log("\n적재가 끝났습니다. /neander/sales 에서 확인하세요.");
})().catch((e) => {
  console.error("\n실패:", e instanceof Error ? e.message : e);
  process.exit(1);
});
