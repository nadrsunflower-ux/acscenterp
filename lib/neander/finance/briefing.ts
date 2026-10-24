// ============================================================
//  월요일 자금 브리핑 · 알림 — 매일 들여다보지 않아도 알게
// ------------------------------------------------------------
//  재무 화면은 사람이 열어야 돈다. 그래서 「통장이 언제 모자라나 · 받을 돈 · 빠진 것 ·
//  남은 검토」 를 한 장으로 만든다. 서버의 매일 밤 점검(api/neander/finance/cron)이
//  월요일 아침에 이것을 만들어 둔다.
//
//  알림은 둘만 둔다 (알림 피로 — 지속될 때만 · 묶어서 한 번 · 할 일 포함):
//    · 곧 통장이 기준선 아래로 내려가는 예측
//    · 받을 날이 7일 넘게 지난 받을 돈
//  빠진 정기 지출은 브리핑에만 적는다 (매달 엑셀이 늦게 올라오면 늘 울리게 된다).
//
//  ⚠️ 현금 예측은 여기서 만들지 않는다 — 런웨이(runway.ts)가 정본이다. 런웨이의 결과를
//     `cash` 로 받아 옮겨 적기만 한다. 두 군데서 따로 세면 숫자가 어긋난다.
//
//  숫자는 코드가 센다 — 여기에 AI 는 없다.
// ============================================================

import type { OpenInstallment, ReceiptMatch } from "./receivables";
import type { RecurringSeries } from "./recurring";

const won = (n: number) => `${Math.round(n).toLocaleString("ko-KR")}원`;
const md = (d: string) => `${Number(d.slice(5, 7))}.${Number(d.slice(8, 10))}`;
const DAY = 86_400_000;

/** 런웨이가 내다본 현금 — 브리핑 · 알림은 이것만 옮겨 적는다 */
export interface CashOutlook {
  /** 시작 잔액의 기준일 · 금액 */
  asOf: string;
  opening: number;
  /** 처음 0원 아래로 내려가는 날 (없으면 없음) */
  firstBelow?: { date: string; closing: number };
  /** 내다본 기간에서 가장 낮은 날 */
  lowest?: { date: string; closing: number };
}

export type AlertKind = "low-cash" | "overdue";

export interface FinAlert {
  /** 같은 일이면 같은 열쇠 — 상태가 바뀔 때만 새로 울린다 */
  key: string;
  kind: AlertKind;
  title: string;
  detail: string;
  href: string;
}

export interface BriefingInput {
  today: string;
  /** 런웨이의 현금 예측 — 없으면 통장 줄 · 기준선 알림을 빼고 만든다 */
  cash?: CashOutlook;
  open: OpenInstallment[];
  matches: ReceiptMatch[];
  recurring: RecurringSeries[];
  /** 검토 대기함에 남은 건수 */
  pending: number;
  /** 지난 7일 엔진이 사람 없이 확정한 건수 */
  autoConfirmed: number;
  /** 통장이 이 아래로 내려가면 알린다 (원). 없으면 0 */
  minCash?: number;
}

export interface FinBriefing {
  /** 그 주의 월요일 */
  weekOf: string;
  at: number;
  headline: string;
  lines: { label: string; text: string; tone?: "danger" | "warning" | "neutral" }[];
  alerts: FinAlert[];
}

/** 통장 기준선 알림은 이만큼 안에 닥칠 때만 */
const LOW_CASH_WITHIN_DAYS = 35;

export function buildAlerts({ today, cash, open, minCash = 0 }: Pick<BriefingInput, "today" | "cash" | "open" | "minCash">): FinAlert[] {
  const out: FinAlert[] = [];
  const low = cash?.firstBelow;
  if (low && (Date.parse(low.date) - Date.parse(today)) / DAY <= LOW_CASH_WITHIN_DAYS) {
    out.push({
      key: `low-cash:${low.date.slice(0, 7)}`,
      kind: "low-cash",
      title: `${md(low.date)} 즈음 통장이 ${minCash > 0 ? `기준선 ${won(minCash)}` : "0원"} 아래로 내려갑니다`,
      detail: `예측 잔액 ${won(low.closing)} — 런웨이 기준입니다.`,
      href: "/neander/finance/reports/runway",
    });
  }
  open
    .filter((o) => o.dueDate && (Date.parse(today) - Date.parse(o.dueDate)) / DAY > 7)
    .forEach((o) =>
      out.push({
        key: `overdue:${o.key}`,
        kind: "overdue",
        title: `${o.projectName} ${o.kind} — 받을 날 ${md(o.dueDate!)} 에서 ${Math.round((Date.parse(today) - Date.parse(o.dueDate!)) / DAY)}일 지났습니다`,
        detail: `남은 돈 ${won(o.remaining)}${o.client ? ` · ${o.client}` : ""}`,
        href: `/neander/finance/projects/${o.projectId}`,
      }),
    );
  return out;
}

/** 그 날이 든 주의 월요일 */
const mondayOf = (date: string) => {
  const d = new Date(`${date}T00:00:00Z`);
  return new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * DAY).toISOString().slice(0, 10);
};

export function buildBriefing(input: BriefingInput): FinBriefing {
  const { today, cash, open, matches, recurring, pending, autoConfirmed } = input;
  const missing = recurring.filter((s) => s.status === "missing");
  const sure = matches.filter((m) => m.confidence === "high");
  const alerts = buildAlerts(input);

  const lines: FinBriefing["lines"] = [];
  if (cash) {
    lines.push({
      label: "통장",
      text:
        `${md(cash.asOf)} 기준 ${won(cash.opening)}` +
        (cash.firstBelow ? ` · ${md(cash.firstBelow.date)} 즈음 바닥 (${won(cash.firstBelow.closing)})` : cash.lowest ? ` · 가장 낮은 날 ${md(cash.lowest.date)} ${won(cash.lowest.closing)}` : ""),
      tone: cash.firstBelow ? "danger" : "neutral",
    });
  }
  lines.push(
    {
      label: "받을 돈",
      text: open.length
        ? `${open.length}건 ${won(open.reduce((s, o) => s + o.remaining, 0))}${
            sure.length ? ` — 장부에 들어온 것으로 보이는 입금 ${sure.length}건, 받음 처리만 하면 됩니다` : ""
          }`
        : "없음",
      tone: alerts.some((a) => a.kind === "overdue") ? "warning" : "neutral",
    },
    {
      label: "정기 지출",
      text: missing.length
        ? `빠진 것 ${missing.length}건 — ${missing.slice(0, 3).map((s) => `${s.vendor} ${won(s.amount)} (${md(s.nextDate)})`).join(", ")}`
        : "빠진 것 없음",
      tone: missing.length ? "warning" : "neutral",
    },
    { label: "검토 대기함", text: `${pending.toLocaleString("ko-KR")}건 남음 · 지난 7일 자동 확정 ${autoConfirmed.toLocaleString("ko-KR")}건` },
  );
  const headline = alerts.length
    ? alerts[0].title
    : cash?.firstBelow
      ? `${md(cash.firstBelow.date)} 즈음 통장이 바닥납니다`
      : "이번 주 자금에 급한 일은 없습니다";
  return { weekOf: mondayOf(today), at: Date.now(), headline, lines, alerts };
}
