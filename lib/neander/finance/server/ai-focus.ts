// ============================================================
//  보고 있는 거래 → 비서에게 줄 안내문 (서버 전용)
// ------------------------------------------------------------
//  화면은 id 만 보낸다 (ai/focus.ts). 거래의 내용은 여기서 장부를 읽어 적는다 —
//  브라우저가 보낸 글이 프롬프트에 들어가지 않는다.
//
//  그날의 캘린더 일정도 같이 적는다 (연결돼 있으면). 사람이 검토할 때 보는
//  것과 같은 것을 비서도 본다 — 「9월 19일 10만 원 입금」 은 그날 행사가
//  있었다는 걸 알아야 무엇인지 짐작할 수 있다.
// ============================================================

import type { AssistantFocus } from "@/lib/neander/ai/focus";
import { groupDayEvents, type DayEvent } from "../calendar";
import type { FinPaymentMethodDoc } from "../db-types";
import { netAmount, type FinTransaction } from "../types";

const STATUS: Record<string, string> = { confirmed: "확정", suggested: "제안됨", needs_review: "검토필요" };
/** 안내문에 넣는 글은 한 줄로, 짧게 — 장부의 비고에 줄바꿈·긴 글이 있을 수 있다 */
const one = (s: unknown, max = 160) => String(s ?? "").replace(/[\r\n`]+/g, " ").trim().slice(0, max);

function describe(t: FinTransaction, pms: FinPaymentMethodDoc[]): string {
  const pm = pms.find((p) => p.last4 === t.last4);
  const acct = [t.acctMajor, t.acctMid, t.acctMinor].filter(Boolean).join(" > ");
  const biz = [t.bizMajor, t.bizMinor].filter(Boolean).join(" > ");
  return [
    `id ${t.id}`,
    t.date,
    t.txType,
    `거래처 「${one(t.vendor, 60) || "(없음)"}」`,
    `${Math.round(netAmount(t)).toLocaleString("ko-KR")}원`,
    `결제수단 ${pm ? `${one(pm.alias, 30)}(${t.last4})` : t.last4 || "미지정"}`,
    `상태 ${STATUS[t.status] ?? t.status}`,
    `계정 ${acct || "(아직 없음)"}`,
    `사업구분 ${biz || "(아직 없음)"}`,
    ...(t.projectCode ? [`프로젝트 ${one(t.projectCode, 40)}`] : []),
    ...(t.cardMemo ? [`카드 메모 「${one(t.cardMemo)}」`] : []),
    ...(t.note ? [`비고 「${one(t.note)}」`] : []),
    ...(t.classReason ? [`자동분류 근거 「${one(t.classReason, 200)}」`] : []),
  ].join(" · ");
}

/** 같은 제목이 여러 번 나오면(예약 시간대) 한 줄로 묶는다 — `13:00 제목 ×9` */
function summarizeEvents(events: DayEvent[]): string[] {
  return groupDayEvents(events)
    .slice(0, 12)
    .map(
      ({ first, count }) =>
        `${first.time ?? "종일"} ${one(first.title, 80)}${count > 1 ? ` ×${count}` : ""}${first.calendar ? ` [${one(first.calendar, 20)}]` : ""}`,
    );
}

/**
 * 시스템 프롬프트 끝에 붙일 안내. 거래를 못 찾으면(지워졌거나 남의 id) 아무것도 안 붙인다.
 * `dayEvents` — 그 거래 날짜의 캘린더 일정 (없으면 생략).
 */
export function focusNote(
  focus: AssistantFocus,
  ctx: { transactions: FinTransaction[]; paymentMethods: FinPaymentMethodDoc[] },
  dayEvents: DayEvent[] = [],
): string | undefined {
  const byId = new Map(ctx.transactions.map((t) => [t.id, t]));
  const main = byId.get(focus.id);
  if (!main) return undefined;
  const picked = (focus.selectedIds ?? []).map((id) => byId.get(id)).filter((t): t is FinTransaction => !!t);
  const events = summarizeEvents(dayEvents.filter((e) => e.date === main.date));

  return [
    "== 지금 상황: 검토 대기함에서 이 거래를 보고 있음 ==",
    "사용자는 재무 검토 대기함에서 아래 거래에 커서를 둔 채 비서를 열었습니다.",
    `[보고 있는 거래] ${describe(main, ctx.paymentMethods)}`,
    ...(picked.length > 0
      ? [`[체크박스로 함께 고른 거래 ${picked.length}건]`, ...picked.map((t) => `- ${describe(t, ctx.paymentMethods)}`)]
      : []),
    ...(events.length > 0 ? [`[${main.date} 의 캘린더 일정] ${events.join(" / ")}`] : []),
    "- 「이거」「이 거래」「이건 뭐야」「어떻게 분류해」처럼 대상을 말하지 않은 질문은 **보고 있는 거래**에 대한 것입니다. 어느 거래냐고 되묻지 마세요.",
    "- 분류를 물으면 같은 거래처 · 비슷한 금액의 과거 거래를 search_transactions 로 찾아 근거를 대고, find_accounts 로 계정을 확인한 뒤 답하세요. 그날 일정이 실마리가 되면 언급하세요.",
    "- 고칠 것이 분명하면 propose_update 를 위 id 로 제안하세요 (체크한 거래가 있고 같은 분류가 맞다면 그 id 들도 함께). 근거가 약하면 제안하지 말고 무엇을 확인해야 하는지 말하세요.",
    "- 질문이 이 거래와 상관없으면(다른 달의 합계 · 규칙 등) 이 맥락에 끌려가지 말고 물은 것에 답하세요.",
    "- 답의 첫 줄에서 어느 거래를 두고 말하는지 짧게 밝히세요 (거래처 · 금액 · 날짜).",
  ].join("\n");
}
