// ============================================================
//  네이버 예약 (예약자관리) — **대사 전용**, 개인정보 미저장
// ------------------------------------------------------------
//  ⚠️ 두 가지 이유로 거래를 만들지 않는다.
//
//  ① 이중 계상 — 네이버 예약 결제는 **Npay 정산**으로 통장에 들어오고, 그
//     입금이 이미 매출로 잡혀 있다(2026-07 아이디판매·온라인판매 거래처에
//     `Npay정산` 이 있다). 예약 건을 또 넣으면 매출이 두 번 잡힌다.
//
//  ② 개인정보 — 이 파일에는 예약자 이름·전화번호·이메일·방문자 정보가
//     들어 있다. 파일 첫 두 줄에 네이버가 붙인 경고가 그대로 있다:
//     "이용목적이 달성되면 지체없이 파기해야 하며, 사업자가 이러한 주의
//     의무 위반 시 개인정보 관련 법령에 의해 처벌을 받을 수 있습니다."
//     재무 집계에 이름·연락처는 **필요하지 않다.** 그래서 이 파서는
//     그 열을 읽지 않는다 — 읽지 않으면 Firestore 에도, AI 프롬프트에도,
//     화면에도 들어갈 길이 없다.
//
//  읽는 것: 이용일시 · 상품 · 실결제금액 · 결제수단 · 결제상태 · 환불금액
//  읽지 않는 것: 예약자 · 전화번호 · 이메일 · 방문자 · 방문자전화번호 ·
//               요청사항 · 직원메모 (사람 이야기가 들어갈 수 있는 자유 텍스트)
// ============================================================

import type { WorkBook } from "xlsx";
import { cellAt, col, findHeaderRow, hasLabels, parseAmount, pickSheet, sheetRange, str } from "./util";
import type { PosResult, PosSale, PosSaleOption } from "./pos";

/**
 * `26. 6. 1.(월) 오후 4:00` → `2026-06-01`.
 * 네이버 예약은 두 자리 연도와 한글 오전/오후를 쓴다.
 */
function parseNaverDate(v: unknown): { date: string; datetime?: string } | null {
  const s = str(v);
  if (!s) return null;
  const m = s.match(/(\d{2,4})\s*\.\s*(\d{1,2})\s*\.\s*(\d{1,2})/);
  if (!m) return null;
  const yy = Number(m[1]);
  const year = yy < 100 ? 2000 + yy : yy;
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${year}-${pad(Number(m[2]))}-${pad(Number(m[3]))}`;

  const tm = s.match(/(오전|오후)\s*(\d{1,2}):(\d{2})/);
  if (!tm) return { date };
  let h = Number(tm[2]);
  // 「오후 16:09」처럼 24시간 표기에 오후가 붙어 오는 행이 실제로 있다.
  // 이미 12를 넘으면 그대로 둔다 — 12를 더하면 28시가 된다.
  if (tm[1] === "오후" && h < 12) h += 12;
  if (tm[1] === "오전" && h === 12) h = 0;
  return { date, datetime: `${date} ${pad(h)}:${tm[3]}:00` };
}

/** 한 행의 품목별 내역. 금액이 있는 칸만 — 없으면 필드 자체를 붙이지 않는다 */
function optionsOf(
  ws: Parameters<typeof cellAt>[0],
  r: number,
  cols: { label: string; count: number; amount: number }[],
): { options?: PosSaleOption[] } {
  const options = cols
    .map((c) => ({
      label: c.label,
      count: parseAmount(cellAt(ws, r, c.count)).amount,
      amount: parseAmount(cellAt(ws, r, c.amount)).amount,
    }))
    .filter((o) => o.count > 0 && o.amount > 0);
  return options.length > 0 ? { options } : {};
}

export function detectNaverBooking(wb: WorkBook): number {
  return hasLabels(wb, ["예약번호", "이용일시", "실결제금액"]) ? 0.95 : 0;
}

export function parseNaverBooking(wb: WorkBook, fileName?: string): PosResult | null {
  const picked = pickSheet(wb, "Report");
  if (!picked) return null;
  const { name, ws } = picked;

  // 헤더가 3행이다 (1~2행은 네이버가 붙인 개인정보 경고문)
  const head = findHeaderRow(ws, ["예약번호", "이용일시", "실결제금액"], 12);
  if (!head) return null;

  const c = {
    used: col(head.cols, "이용일시"),
    product: col(head.cols, "상품"),
    people: col(head.cols, "인원"),
    paid: col(head.cols, "실결제금액"),
    method: col(head.cols, "결제수단"),
    payStatus: col(head.cols, "결제상태"),
    refund: col(head.cols, "환불금액"),
    // 취소해도 남는 돈 — 2608 실측으로 늘 「실결제 − 환불」과 같았다
    cancelFee: col(head.cols, "취소수수료"),
    channel: col(head.cols, "유입경로"),
    status: col(head.cols, "상태"),
    // 예약자·전화번호·이메일은 **일부러 읽지 않는다** (위 주석 참고)
  };

  // 품목별 수량·금액 열 — 「옵션3-[포도알이벤트] 퍼퓸(50ml)」 과 그 짝
  // 「… 결제금액」. 한 예약에 50ml 10병 + 10ml 4병처럼 섞여 오면 상품·인원
  // 열만으로는 나눌 수 없는데, 이 열에는 답이 그대로 있다 (2608 실측: 금액이
  // 있는 169건 모두 옵션 금액의 합 = 실결제금액). 개인정보가 없는 열이다.
  //
  // ⚠️ head.cols 로 찾지 않는다 — 열 이름 정규화가 괄호를 지워서
  //    「퍼퓸(50ml)」과 「퍼퓸(10ml)」의 용량이 사라진다. 헤더 칸을 그대로 읽는다.
  const optionCols: { label: string; count: number; amount: number }[] = [];
  {
    const range = sheetRange(ws);
    const titles = new Map<string, number>();
    for (let ci = range.s.c; ci <= range.e.c; ci++) {
      const t = str(cellAt(ws, head.row, ci));
      if (t) titles.set(t, ci);
    }
    titles.forEach((ci, t) => {
      const m = t.match(/^(?:가격분류|옵션)\d+-(.+)$/);
      if (!m || /결제금액$/.test(t)) return;
      const amount = titles.get(`${t} 결제금액`);
      if (amount !== undefined) optionCols.push({ label: m[1].trim(), count: ci, amount });
    });
  }

  const sales: PosSale[] = [];
  const warnings: string[] = [];
  let refundTotal = 0;
  let refundCount = 0;
  let freeCount = 0;
  let cancelled = 0;
  let feeKeptCount = 0;
  let feeKeptTotal = 0;
  const methods = new Map<string, number>();

  const range = sheetRange(ws);
  for (let r = head.row + 1; r <= range.e.r; r++) {
    const rowNo = r + 1;
    const dt = parseNaverDate(cellAt(ws, r, c.used));
    if (!dt) continue;

    const paid = parseAmount(cellAt(ws, r, c.paid)).amount;
    const refunded = c.refund >= 0 ? parseAmount(cellAt(ws, r, c.refund)).amount : 0;
    const payStatus = c.payStatus >= 0 ? str(cellAt(ws, r, c.payStatus)) : "";
    const status = c.status >= 0 ? str(cellAt(ws, r, c.status)) : "";
    const method = c.method >= 0 ? str(cellAt(ws, r, c.method)) : "";

    if (/취소/.test(status)) cancelled += 1;
    const isRefund = refunded > 0 || payStatus === "환불완료" || payStatus === "입금대기취소";
    if (isRefund) {
      refundTotal += refunded || paid;
      refundCount += 1;
    }
    // 실결제 0원 건이 실제로 있다 (무료 증정 `special gift`). 매출이 아니므로
    // 합계에는 넣지 않되 몇 건인지는 밝힌다 — 조용히 빼면 건수가 안 맞는다.
    if (paid === 0) {
      freeCount += 1;
      continue;
    }
    if (method) methods.set(method, (methods.get(method) ?? 0) + paid);

    sales.push({
      rowNo,
      date: dt.date,
      datetime: dt.datetime,
      items: [
        c.product >= 0 ? str(cellAt(ws, r, c.product)) : "",
        c.people >= 0 ? str(cellAt(ws, r, c.people)) : "",
      ]
        .filter(Boolean)
        .join(" · "),
      total: paid,
      // 네이버는 카드/포인트/계좌를 문구로만 주므로 세부 배분을 만들지 않는다.
      // 전액을 「간편결제」로 두고, 결제수단별 내역은 아래 warnings 로 알린다.
      card: 0,
      cash: 0,
      easy: paid,
      other: 0,
      online: 0,
      ...optionsOf(ws, r, optionCols),
      refundedAt: isRefund ? payStatus || "환불" : undefined,
      ...(isRefund
        ? {
            refundAmount: refunded,
            ...(c.cancelFee >= 0 ? { cancelFee: parseAmount(cellAt(ws, r, c.cancelFee)).amount } : {}),
          }
        : {}),
    });
    if (isRefund) {
      const kept = c.cancelFee >= 0 ? parseAmount(cellAt(ws, r, c.cancelFee)).amount : Math.max(0, paid - refunded);
      if (kept > 0) {
        feeKeptCount += 1;
        feeKeptTotal += kept;
      }
    }
  }

  const total = sales.reduce((s, x) => s + x.total, 0);
  const dates = sales.map((s) => s.date).sort();
  const from = dates[0];
  const to = dates[dates.length - 1];

  if (freeCount > 0) {
    warnings.push(`실결제 0원 ${freeCount}건(무료 증정 등)은 매출 합계에서 제외했습니다.`);
  }
  if (cancelled > 0) {
    warnings.push(`상태가 취소인 ${cancelled}건이 있습니다.`);
  }
  if (feeKeptCount > 0) {
    warnings.push(
      `취소됐지만 취소수수료로 남은 금액이 ${feeKeptCount}건 ${feeKeptTotal.toLocaleString("ko-KR")}원 있습니다.`,
    );
  }
  if (methods.size > 0) {
    warnings.push(
      `결제수단: ${[...methods.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `${k} ${v.toLocaleString("ko-KR")}`)
        .join(" · ")}`,
    );
  }
  warnings.push(
    "네이버 예약 결제는 `Npay정산` 입금으로 장부에 들어오며, 그 입금은 아이디판매로 분류돼 " +
      "있습니다(실측). 다른 계정과 맞춰보려면 아래에서 계정을 바꾸세요.",
  );
  warnings.push(
    "예약자 이름·전화번호·이메일·직원메모는 읽지 않았습니다 (재무 집계에 불필요하며 개인정보입니다).",
  );

  return {
    sourceLabel: "네이버 예약",
    store: "네이버 예약 (온라인)",
    period: from && to ? `${from}~${to}` : "",
    from,
    to,
    // 장부 실측 기준 기본값: 네이버 예약 결제는 `Npay정산` 으로 들어오고
    // 그 입금이 **아이디판매**로 분류돼 있다 (2026-05~07 실측 51건 2,388만원).
    // 상품도 매장 체험 상품이라 온라인판매가 아니다. 다만 이건 운영 방식에
    // 따라 달라질 수 있으므로 화면에서 바꿀 수 있게 해 뒀다.
    unit: { bizMajor: "B2C", bizMinor: "아이디", acctMinor: "아이디판매" },
    summary: {
      total,
      net: total - refundTotal,
      count: sales.length,
      avg: sales.length ? Math.round(total / sales.length) : 0,
      refund: refundTotal,
      refundCount,
    },
    sales,
    byMethod: { card: 0, cash: 0, easy: total, other: 0, online: 0 },
    sheetName: name,
    warnings,
  };
}
