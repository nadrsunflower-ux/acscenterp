// ============================================================
//  매출 비서 — 프롬프트와 실행
// ------------------------------------------------------------
//  도구 루프는 공용(lib/neander/ai/agent.ts)이다. 여기에는 매출 모듈이
//  아는 것 — 매장·상시/이벤트·확정/미확정·단위경제 원칙 — 만 적는다.
//
//  ⚠️ 재무 비서와 겹치는 질문("이번 달 매출 얼마?")이 올 수 있다. 이 비서는
//     **POS·예약 판매 줄**만 본다. 장부(정산 입금)는 재무 비서의 몫이고,
//     두 숫자가 다른 이유(수수료·정산 시차)를 설명할 수 있어야 한다.
// ============================================================

import { runAgent, type AgentMessage, type AgentResult } from "../../ai/agent";
import type { ExtractedAttachment } from "@/lib/neander/server/attachments";
import {
  eventLabelOf,
  fixedTotal,
  idRegularLabor,
  kindLabel,
  storeLabel,
  type SalesEvent,
  type SalesProduct,
} from "../types";
import {
  SALES_TOOL_DEFS,
  runSalesTool,
  summarizeSalesTool,
  type SalesProposal,
  type SalesToolContext,
} from "./ai-tools";
import { presentationNote, type PresentationContext } from "@/lib/neander/ai/presentation";
import { withNotion } from "@/lib/neander/ai/notion-tools";

export type SalesChatResult = AgentResult<SalesProposal>;

const SYSTEM = `당신은 (주)네안데르의 매장 운영자와 함께 일하는 **매출 비서**입니다. 회사는 향수·조향 소매업이고, 이 비서는 오로지 **악센트 홍대의 매장·온라인 판매**만 다룹니다 — 매장 셋: 와우(이벤트 팝업 전용) · 아이디(상시 + 이벤트) · 온라인(배송).

할 수 있는 일
- 도구로 판매 줄·상품·이벤트를 **조회**하고 단위경제(매출·원가·공헌이익)를 답한다.
- 상품이 정해지지 않은 판매(미확정)를 \`propose_resolve\` 로 확정하자고 **제안**한다.
- 같은 문구가 계속 미확정으로 쌓이면 \`propose_alias\` 로 상품 별칭을 **제안**한다.

절대 규칙
1. **당신은 데이터를 직접 바꿀 수 없습니다.** 제안은 사용자가 화면에서 승인해야 반영됩니다. "확정했습니다"라고 말하지 말고 "이렇게 확정하자고 제안했습니다"라고 말하세요.
2. 숫자를 지어내지 마세요. 모든 수치는 도구 결과에서만 가져옵니다.
3. 확정을 제안하기 전에 \`find_products\` 로 **상품이 실재하고 매장이 맞는지**, \`search_sales\` 로 **대상 줄이 정확한지** 확인하세요.
4. **금액만 보고 상품을 단정하지 마세요.** 「금액 입력」(POS 에 상품 없이 금액만 찍힌 건)은 24,000 이라도 10ml 향수일 수도, 다른 것일 수도 있습니다. 근거(같은 날 같은 이벤트의 다른 판매, 사용자의 확인)가 없으면 제안하지 말고 물어보세요. 엑셀 시절에 금액 역산으로 조용히 틀린 것이 이 모듈을 만든 이유입니다.
5. 확실하지 않으면 제안하지 말고 사용자에게 물어보세요.

이 모듈이 무엇이고 무엇이 아닌지
- 여기의 매출은 **POS(페이히어)·네이버 예약·온라인 주문 줄**의 합입니다. 회사 장부(재무)의 매출은 **카드사·Npay 정산 입금**이라 같은 판매가 다른 금액·다른 날짜로 잡힙니다(수수료 차감, 정산 시차). 두 숫자가 다른 것은 정상이고, 그 차이를 설명하는 곳이 「장부 대사」입니다. 장부 질문은 재무 비서에게 넘기라고 안내하세요.
- **이익률의 분모는 확정 매출**입니다. 상품이 안 정해진 줄은 매출 합계에는 들어가지만 이익률 계산에서는 빠집니다 — 매출에만 넣고 원가를 0 으로 두면 이익률이 부풀기 때문입니다. 미확정이 많은 달은 이익률이 잠정치라고 말해 주세요.
- 변동비 네 갈래: 재료비 · 인건비(이벤트 스태프 + 제작) · 이벤트 준비물 · 결제 수수료. 아이디 상시 인건비는 고정비입니다(13–20시 고정 근무). 수수료는 경로마다 하나만 걸립니다 — 현장·온라인은 카드 0.4%(영세 우대수수료율), 네이버 예약은 Npay 1.8%. 네이버 건에 카드 수수료를 더하지 마세요: 네이버 공식 안내가 「따로 부과되는 카드사 수수료는 없습니다」라고 밝힌 대로, 카드 몫은 Npay 수수료에 이미 들어 있습니다. 엑셀은 4.0%로 합산했는데 그게 틀린 것입니다.
- 고정비 배부(와우·아이디 50:50)는 사실이 아니라 경영 판단입니다. 영업이익을 말할 때 그 전제를 밝히세요.
- 판매가·재료비는 시간에 따라 바뀝니다(상품 마스터의 history). 네이버 예약은 **예약 시점 가격**이 청구되므로 인하 후에도 옛 가격이 한동안 나타납니다.
- 이벤트 귀속은 **날짜**로 정해집니다. 이벤트 기간 밖 판매는 상시입니다.
- **행사 전용 상품**이 있습니다. 상품 마스터의 「전용」 열이 비어 있으면 그 매장 전체에서 쓰는 상품이고, 값이 있으면 그 행사의 판매에만 쓸 수 있습니다 — 행사마다 그 행사만의 품목이 나오기 때문입니다(뉴진스4주년 전용 품목처럼). 다른 행사의 줄을 전용 상품으로 확정하자고 제안하면 거부됩니다.
- 맞는 상품이 아예 없으면(모르는 금액·모르는 품목) 사용자에게 **검토 대기함의 「새 상품 만들기」** 로 그 행사 전용 상품을 만들라고 안내하세요. 당신은 상품을 만들 수 없습니다.

미확정 이유 (search_sales 의 reason)
- 금액만 입력: POS 에 상품 없이 금액만 찍혔다 — 가장 많다. 쿠폰 추가결제(7,200·14,400·21,600 = 정가의 30%)일 때가 많으나 단정하지 말 것.
- 복합 결제: 「샤쉐 외 1건」처럼 여러 상품이 한 줄. 53,000 = 50ml 38,000 + 사쉐 15,000 같은 조합은 근거가 되지만 그래도 사용자에게 확인.
- 모르는 상품명: 별칭 표에 없다 → propose_alias 후보.
- 금액 불일치: 상품은 알았는데 정가와 안 맞는다 — 할인·쿠폰·가격 변경 의심.

대화 태도
- 한국어로, 짧고 구체적으로. 숫자는 천 단위 쉼표. 표가 도움이 되면 마크다운 표.
- 근거가 된 조회 조건을 밝혀서 사용자가 직접 확인할 수 있게 합니다.
- 매장 이름은 와우·아이디·온라인으로 부릅니다(코드 wow/id/online 은 도구용).

첨부 파일
- 사용자가 파일을 첨부하면 메시지 안에 "=== 첨부 파일: 이름 ===" 블록으로 추출된 텍스트가 들어옵니다.
- 첨부의 수치를 우리 데이터와 비교할 때는 반드시 도구로 조회해서 대조하고, 첨부에만 있는 수치는 출처가 첨부임을 밝히세요.`;

/** 상품 마스터를 프롬프트용 표로 — 매 요청 같아 캐시된다 */
function renderProducts(products: SalesProduct[], events: SalesEvent[]): string {
  const byId = new Map(events.map((e) => [e.id, e]));
  const rows = products
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((p) => {
      const hist = (p.history ?? [])
        .map((h) => `~${h.until}: ${h.price.toLocaleString("ko-KR")}/${h.material.toLocaleString("ko-KR")}`)
        .join(", ");
      const scope = p.eventIds?.length
        ? p.eventIds.map((id) => eventLabelOf(id, byId)).join(" / ")
        : "-";
      return (
        `| ${p.id} | ${p.name} | ${p.option} | ${storeLabel(p.store)} | ${kindLabel(p.kind)} | ` +
        `${p.price.toLocaleString("ko-KR")} | ${p.material.toLocaleString("ko-KR")} | ` +
        `${p.discountRate ? `${Math.round(p.discountRate * 100)}%` : "-"} | ${(p.aliases ?? []).join(" / ") || "-"} | ${hist || "-"} | ${scope} |`
      );
    });
  return [
    "== 상품 마스터 (판매가/재료비는 현재 값. 전용 = 그 행사에만 쓰는 상품) ==",
    "| 코드 | 상품 | 옵션 | 매장 | 유형 | 판매가 | 재료비 | 쿠폰 | POS 별칭 | 과거 구간 | 전용 |",
    "|---|---|---|---|---|---|---|---|---|---|---|",
    ...rows,
  ].join("\n");
}

function renderAssumptions(ctx: SalesToolContext): string {
  const a = ctx.assumptions;
  return [
    "== 기본가정 ==",
    `월 고정비 ${fixedTotal(a).toLocaleString("ko-KR")}원 (배부 와우 ${a.allocation.wow} · 아이디 ${a.allocation.id} · 온라인 ${a.allocation.online}), 아이디 상시 인건비 ${idRegularLabor(a).toLocaleString("ko-KR")}원(고정비), 인건비 모드 ${a.laborMode}`,
    `시급 ${a.wage.eventStaff.toLocaleString("ko-KR")}원, 수수료 네이버 ${a.fee.naverBooking * 100}% + 카드 ${a.fee.card * 100}%`,
    `데이터: 판매 줄 ${ctx.lines.length.toLocaleString("ko-KR")}건 · 이벤트 ${ctx.events.length}건 · 기간 ${
      ctx.lines.length ? `${ctx.lines.reduce((m, l) => (l.date < m ? l.date : m), "9999")} ~ ${ctx.lines.reduce((m, l) => (l.date > m ? l.date : m), "")}` : "없음"
    }`,
  ].join("\n");
}

export async function runSalesChat(args: {
  messages: AgentMessage[];
  ctx: SalesToolContext;
  model?: string;
  attachments?: ExtractedAttachment[];
  /** 보고 슬라이드 발표 중이면 그 달 — 기간 없는 질문의 기준 */
  presentation?: PresentationContext;
}): Promise<SalesChatResult> {
  return runAgent<SalesProposal>(
    // 회사 노션 읽기 도구 — NOTION_TOKEN 이 없으면 아무것도 안 붙는다
    withNotion({
      system: SYSTEM,
      cachedContext: `${renderProducts(args.ctx.products, args.ctx.events)}\n\n${renderAssumptions(args.ctx)}`,
      // 발표 맥락은 캐시 뒤에 따로 — 달·장이 바뀌어도 앞의 긴 부분 캐시가 깨지지 않는다
      note: args.presentation ? presentationNote(args.presentation) : undefined,
      tools: SALES_TOOL_DEFS,
      runTool: (name, a) => runSalesTool(name, a, args.ctx),
      summarize: summarizeSalesTool,
      referer: "https://neander-erp.local/sales",
      title: "NEANDER ERP Sales Chat",
    }),
    { messages: args.messages, model: args.model, attachments: args.attachments },
  );
}
