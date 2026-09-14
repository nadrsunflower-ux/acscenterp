// ============================================================
//  매출 해석기 검증 — 엑셀 원본으로 실제 해석률을 재 본다
// ------------------------------------------------------------
//  재무의 verify-* 스크립트와 같은 성격이다. 화면을 열지 않고, 2026-07
//  원가계산 엑셀의 **입력 시트**(페이히어 와우·아이디·온라인, 네이버
//  예약)를 그대로 읽어 resolve.ts 를 돌린다.
//
//  보려는 것 두 가지:
//   ① 해석률 — 엑셀이 「기타·미분류」로 넘긴 15% 를 우리는 얼마나 줄였나
//   ② 합계   — 적재 합계가 원본 합계와 맞나 (사라지는 돈이 없나)
//
//  실행: npm run sales:verify
//        SALES_XLSX=<경로> 로 다른 달 파일도 검증할 수 있다.
// ============================================================

import * as path from "node:path";
import * as XLSX from "xlsx";
import { SEED_ASSUMPTIONS, SEED_EVENTS, SEED_PRODUCTS, EXCEL_BASELINE } from "../../lib/neander/sales/master-data";
import { resolveRows, summarize, type RawSaleRow } from "../../lib/neander/sales/resolve";
import { buildPnl } from "../../lib/neander/sales/aggregate";
import { REASON_LABEL, type PayRoute, type SalesLine, type SalesStore } from "../../lib/neander/sales/types";

const DEFAULT_XLSX =
  "/Users/idongju/Library/Mobile Documents/com~apple~CloudDocs/*네안데르/0.네안데르 회계/2026/7월/2607악센트원가계산.xlsx";

const FILE = process.env.SALES_XLSX || DEFAULT_XLSX;

const won = (n: number) => n.toLocaleString("ko-KR");
const pctOf = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(1)}%` : "—");

/** 엑셀 날짜 셀 → YYYY-MM-DD */
function toDate(v: unknown): string {
  if (v instanceof Date) {
    const p = (n: number) => String(n).padStart(2, "0");
    return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`;
  }
  const s = String(v ?? "").trim();
  const m = s.match(/(\d{4})[-./](\d{1,2})[-./](\d{1,2})/);
  if (!m) return "";
  const p = (n: string) => n.padStart(2, "0");
  return `${m[1]}-${p(m[2])}-${p(m[3])}`;
}

/** 네이버 「26. 7. 1.(수) 오후 2:00」 → 2026-07-01 */
function toNaverDate(v: unknown): string {
  const s = String(v ?? "");
  const m = s.match(/(\d{2,4})\s*\.\s*(\d{1,2})\s*\.\s*(\d{1,2})/);
  if (!m) return "";
  const yy = Number(m[1]);
  const year = yy < 100 ? 2000 + yy : yy;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${year}-${p(Number(m[2]))}-${p(Number(m[3]))}`;
}

const num = (v: unknown) => {
  const n = Number(String(v ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

interface Source {
  sheet: string;
  store: SalesStore;
  route: PayRoute;
  read: (rows: unknown[][]) => RawSaleRow[];
}

/** 페이히어 입력 시트 — 6행 헤더(결제일·결제시간·결제 내역·합계), 7행부터 데이터 */
const readPayhere = (rows: unknown[][]): RawSaleRow[] =>
  rows
    .slice(6)
    .map((r) => ({ date: toDate(r[0]), items: String(r[2] ?? "").trim(), total: num(r[3]) }))
    .filter((r) => r.date && r.total > 0);

const SOURCES: Source[] = [
  { sheet: "입력_페이히어_와우", store: "wow", route: "payhere", read: readPayhere },
  { sheet: "입력_페이히어_아이디", store: "id", route: "payhere", read: readPayhere },
  {
    sheet: "입력_페이히어_온라인",
    store: "online",
    route: "online",
    // 온라인 시트는 수량 열(E)이 따로 있다 — 있으면 역산하지 않는다
    read: (rows) =>
      rows
        .slice(6)
        .map((r) => ({
          date: toDate(r[0]),
          items: String(r[2] ?? "").trim(),
          total: num(r[5]) || num(r[3]),
          qty: num(r[4]) || undefined,
        }))
        .filter((r) => r.date && r.total > 0),
  },
  {
    sheet: "입력_네이버예약",
    store: "id",
    route: "naver",
    // 6행 헤더. N=이용일시(13) · P=상품(15) · Q=인원(16) · R=실결제금액(17)
    read: (rows) =>
      rows
        .slice(6)
        .map((r) => ({
          date: toNaverDate(r[13]),
          items: [String(r[15] ?? "").trim(), String(r[16] ?? "").trim()]
            .filter(Boolean)
            .join(" · "),
          total: num(r[17]),
        }))
        .filter((r) => r.date && r.total > 0),
  },
];

function main() {
  console.log(`\n파일: ${path.basename(FILE)}\n`);
  const wb = XLSX.readFile(FILE, { cellDates: true });

  const allLines: SalesLine[] = [];
  let sourceGrand = 0;

  for (const src of SOURCES) {
    const ws = wb.Sheets[src.sheet];
    if (!ws) {
      console.log(`  ⚠️  시트 없음: ${src.sheet}`);
      continue;
    }
    const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null, raw: false, blankrows: true });
    // raw:false 는 날짜를 문자열로 주므로 날짜 셀만 다시 읽는다
    const rawRows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null, blankrows: true });
    const merged = rows.map((r, i) => {
      const o = [...r];
      const rr = rawRows[i];
      if (rr) {
        o[0] = rr[0] ?? o[0];
        o[13] = r[13] ?? rr[13];
      }
      return o;
    });

    const parsed = src.read(merged);
    const drafts = resolveRows(
      parsed,
      {
        products: SEED_PRODUCTS,
        events: SEED_EVENTS,
        store: src.store,
        route: src.route,
        assumptions: SEED_ASSUMPTIONS,
      },
      {},
    );
    const s = summarize(drafts);
    sourceGrand += s.total;

    console.log(`── ${src.sheet}  (${src.store} · ${src.route})`);
    console.log(`   줄 ${s.rows}  합계 ${won(s.total)}원`);
    console.log(
      `   확정 ${s.resolved} (${pctOf(s.resolved, s.rows)})  금액 ${won(s.resolvedAmount)}원 (${pctOf(s.resolvedAmount, s.total)})`,
    );
    console.log(
      `   검토 ${s.needsReview} (${pctOf(s.needsReview, s.rows)})  금액 ${won(s.reviewAmount)}원 (${pctOf(s.reviewAmount, s.total)})`,
    );
    s.byReason.forEach((r) =>
      console.log(`     · ${REASON_LABEL[r.reason]}: ${r.count}건 ${won(r.amount)}원`),
    );
    console.log(
      `   이벤트 귀속 없음 ${s.unattributed.count}건 ${won(s.unattributed.amount)}원\n`,
    );

    drafts.forEach((d, i) => allLines.push({ ...d, id: `${src.sheet}-${i}` }));
  }

  // ---- 월 손익 ---------------------------------------------
  const pnl = buildPnl(EXCEL_BASELINE.month, allLines, SEED_PRODUCTS, SEED_EVENTS, SEED_ASSUMPTIONS);
  const t = pnl.total;

  console.log("══ 월 손익 (laborMode=fixed) ══");
  console.log(`   매출(전부)  ${won(t.revenue)}`);
  console.log(`   확정 매출    ${won(t.confirmedRevenue)}  ← 이익률의 분모`);
  console.log(`   미확정 매출  ${won(t.pendingRevenue)}  (${pctOf(t.pendingRevenue, t.revenue)})`);
  console.log(`   변동비      ${won(t.variable.total)}`);
  console.log(
    `     재료비 ${won(t.variable.material)} · 이벤트인건비 ${won(t.variable.eventLabor)} · 제작 ${won(Math.round(t.variable.makeLabor))} · 준비물 ${won(t.variable.supplies)} · 수수료 ${won(t.variable.fee)}`,
  );
  console.log(`   공헌이익    ${won(t.contribution)}  (확정 기준 ${pctOf(t.contribution, t.confirmedRevenue)})`);
  console.log(`   고정비      ${won(t.fixedTotal)}`);
  console.log(`   영업이익    ${won(t.operating)}  (확정 기준 ${pctOf(t.operating, t.confirmedRevenue)})`);
  console.log(`   미확정      ${t.reviewCount}건 ${won(t.reviewAmount)}원 (${pctOf(t.reviewAmount, t.revenue)})\n`);

  pnl.stores.forEach((s) =>
    console.log(
      `   ${s.store.padEnd(7)} 매출 ${won(s.revenue).padStart(12)}  확정 ${won(s.confirmedRevenue).padStart(12)}` +
        `  공헌 ${won(Math.round(s.contribution)).padStart(12)} (${pctOf(s.contribution, s.confirmedRevenue).padStart(6)})` +
        `  영업 ${won(Math.round(s.operating)).padStart(12)}`,
    ),
  );

  // ---- 엑셀과 비교 -----------------------------------------
  console.log("\n══ 엑셀 대비 ══");
  const b = EXCEL_BASELINE;
  const cmp = (label: string, ours: number, theirs: number) => {
    const gap = ours - theirs;
    const mark = gap === 0 ? "=" : gap > 0 ? "+" : "−";
    console.log(
      `   ${label.padEnd(10)} 우리 ${won(ours).padStart(12)}  엑셀 ${won(theirs).padStart(12)}  ${mark}${won(Math.abs(gap))}`,
    );
  };
  cmp("매출", t.revenue, b.revenue.total);
  cmp("변동비", t.variable.total, b.variable.total);
  cmp("공헌이익", t.contribution, b.contribution.total);
  cmp("영업이익", t.operating, b.operating.total);
  console.log(
    `\n   원본 합계 ${won(sourceGrand)} · 엑셀 원본 합계 ${won(
      b.posSourceTotal.wow + b.posSourceTotal.id + b.posSourceTotal.online + b.naverSourceTotal,
    )}`,
  );
  console.log(
    `   엑셀 미분류 ${won(b.unclassified)}원 (15.2%) → 우리 미확정 ${won(t.reviewAmount)}원 (${pctOf(
      t.reviewAmount,
      t.revenue,
    )})`,
  );
  // 차이의 정체를 숫자로 밝힌다 — "엑셀과 다르다"만으로는 쓸모가 없다
  const laborFix = 1_295_000; // 엑셀이 두 번 센 타임인건비 (2026-07)
  // 엑셀의 수수료 규칙(네이버 1.8+2.2=4.0% · 카드 2.2%)을 그대로 재현해 차이를 뽑는다.
  // 네이버에 카드 수수료를 겹쳐 매긴 것과, 우대등급이 아닌 요율을 쓴 것 둘 다 들어 있다.
  const excelFeePnl = buildPnl(EXCEL_BASELINE.month, allLines, SEED_PRODUCTS, SEED_EVENTS, {
    ...SEED_ASSUMPTIONS,
    fee: { naverBooking: 0.04, card: 0.022 },
  });
  const feeFix = excelFeePnl.total.variable.fee - t.variable.fee;
  console.log("\n══ 차이의 정체 ══");
  console.log(
    `   ① 미확정 매출 −${won(t.pendingRevenue)}  이익률 계산에서 뺐다 (엑셀은 평균원가율로 메웠다)`,
  );
  console.log(
    `   ② 인건비 이중계상 +${won(laborFix)}  엑셀은 타임인건비(변동비)와 상시 인건비(고정비)를 함께 넣었다`,
  );
  console.log(
    `   ③ 이벤트 기간 밖 +30,000  엑셀 분석에서 빠져 있던 와우 판매`,
  );
  console.log(
    `   ④ 수수료 과대계상 +${won(feeFix)}  엑셀은 네이버 건에 카드 수수료를 겹쳐 매기고` +
      ` (공식 안내: 「따로 부과되는 카드사 수수료는 없습니다」), 카드도 우대등급이 아닌 2.2% 를 썼다\n`,
  );
  console.log(
    "   → 대기함을 비우면 ① 이 사라지고, 공헌이익은 엑셀보다 ②+④ 만큼 높은 값으로 수렴한다.\n",
  );
}

main();
