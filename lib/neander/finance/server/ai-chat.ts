// ============================================================
//  재무 비서 — 프롬프트와 실행
// ------------------------------------------------------------
//  도구 루프는 공용(lib/neander/ai/agent.ts)이다. 원래 이 파일에 있던 루프를
//  그대로 뽑아 만든 것이라 동작은 같다. 여기에는 재무 모듈이 아는 것 —
//  장부 구조·절대 규칙·계정 마스터 — 만 적는다.
//
//  ⚠️ 변경은 도구가 하지 않는다. `propose_update` 는 제안 목록만 만들고,
//     그 목록이 응답에 실려 화면으로 간다. 저장은 사람이 「적용」을 눌렀을 때
//     기존 경로(transaction.applyEdits)로 나간다. ai-tools.ts 주석 참고.
// ============================================================

import { argBits, runAgent, type AgentMessage, type AgentResult } from "@/lib/neander/ai/agent";
import { withNotion } from "@/lib/neander/ai/notion-tools";
import { presentationNote, type PresentationContext } from "@/lib/neander/ai/presentation";
import { renderAccounts } from "./ai-classify";
import { TOOL_DEFS, runTool, type ChangeProposal, type ToolContext } from "./ai-tools";
import type { ExtractedAttachment } from "@/lib/neander/server/attachments";

export type ChatMessage = AgentMessage;
export type ChatResult = AgentResult<ChangeProposal>;

const SYSTEM = `당신은 (주)네안데르의 재무 담당자와 함께 일하는 재무 비서입니다. 향수·조향 제조/소매업이며 매장(와우·아이디), 온라인, B2B 조향/개발 사업을 합니다.

할 수 있는 일
- 도구로 장부를 **조회**하고 집계해서 질문에 답한다.
- 고칠 것이 있으면 \`propose_update\` 로 **제안**한다.

절대 규칙
1. **당신은 장부를 직접 바꿀 수 없습니다.** \`propose_update\` 는 제안일 뿐이고 사용자가 화면에서 승인해야 반영됩니다. "수정했습니다"라고 말하지 말고 "이렇게 바꾸자고 제안했습니다"라고 말하세요.
2. 숫자를 지어내지 마세요. 모든 수치는 도구 결과에서만 가져옵니다. 도구를 부르지 않고 금액을 말하면 안 됩니다.
3. 계정을 바꾸자고 제안하기 전에 \`find_accounts\` 로 **실재하는 계정인지 확인**하세요. 마스터에 없는 계정은 거부됩니다.
4. 변경을 제안하기 전에 \`search_transactions\` 로 **대상이 정확한지 확인**하세요. 짐작으로 id 를 만들지 마세요.
5. 확실하지 않으면 제안하지 말고 사용자에게 물어보세요. 재무에서 조용히 틀린 변경이 가장 나쁩니다.

장부의 구조 (알아둘 것)
- 거래유형 5종: 수입 · 지출 · 자금거래 · 카드대금결제 · 환급. **자금거래와 카드대금결제는 손익이 아닙니다** (계좌 간 이동, 이미 카드내역으로 비용을 잡은 것).
- 환급은 지출에서 차감됩니다. 순손익 = 수입 − (지출 − 환급).
- 사업구분 축: 대분류 B2C/B2B/공용, 소분류 와우·아이디·홍대공용·온라인·SMOAT·조향·개발·기타·공용.
- 집계 기준 두 가지: 발생주의(카드 사용 시점) / 현금흐름(통장 출금 시점).
- 분류 상태: confirmed(확정) · suggested(제안됨) · needs_review(검토필요).

대화 태도
- 한국어로, 짧고 구체적으로 답합니다. 숫자는 천 단위 쉼표를 씁니다.
- 표가 도움이 되면 마크다운 표를 씁니다.
- 근거가 된 조회 조건을 밝혀서 사용자가 직접 확인할 수 있게 합니다.

첨부 파일
- 사용자가 파일을 첨부하면 메시지 안에 "=== 첨부 파일: 이름 ===" 블록으로 추출된 텍스트가 들어옵니다.
- 첨부의 수치를 장부와 비교할 때는 반드시 도구로 장부를 조회해서 대조하고, 첨부에만 있는 수치는 출처가 첨부임을 밝히세요.
- "(길어서 뒷부분 잘림)" 표시가 있으면 일부만 읽었다는 뜻이니 그 한계를 답에 언급하세요.`;

export async function runFinanceChat(args: {
  messages: ChatMessage[];
  ctx: ToolContext;
  /** 사용자가 고른 모델 — 허용 목록(ai-models.ts)에 없으면 무시하고 기본값 */
  model?: string;
  /** 마지막 사용자 메시지에 붙일 첨부 (라우트가 추출을 끝낸 상태) */
  attachments?: ExtractedAttachment[];
  /** 보고 슬라이드 발표 중이면 그 달 — 기간 없는 질문의 기준 */
  presentation?: PresentationContext;
}): Promise<ChatResult> {
  return runAgent<ChangeProposal>(
    // 회사 노션 읽기 도구 — NOTION_TOKEN 이 없으면 아무것도 안 붙는다
    withNotion({
      system: SYSTEM,
      // 계정 마스터는 매 요청 같으므로 캐시를 건다 (≈4천 토큰)
      cachedContext: `== 계정 마스터 ==\n${renderAccounts(args.ctx.accounts)}`,
      // 발표 맥락은 캐시 뒤에 따로 — 달·장이 바뀌어도 앞의 긴 부분 캐시가 깨지지 않는다
      note: args.presentation ? presentationNote(args.presentation) : undefined,
      tools: TOOL_DEFS,
      runTool: (name, a) => runTool(name, a, args.ctx),
      summarize,
      // HTTP 헤더는 latin-1 만 담을 수 있다 — 한글 금지
      referer: "https://neander-erp.local/finance",
      title: "NEANDER ERP Finance Chat",
    }),
    { messages: args.messages, model: args.model, attachments: args.attachments },
  );
}

/** 화면에 "무엇을 조회했는지" 한 줄로 보여주기 위한 요약 */
function summarize(name: string, a: Record<string, unknown>, result: unknown): string {
  const r = result as Record<string, unknown> | undefined;
  const bits = argBits(a);
  switch (name) {
    case "search_transactions":
      return `거래 조회 ${bits} → ${r?.count ?? 0}건`;
    case "summarize_transactions":
      return `집계 ${bits} → ${r?.groupCount ?? 0}개 그룹 / ${r?.totalCount ?? 0}건`;
    case "get_monthly_report":
      return `월 리포트 ${bits}`;
    case "find_accounts":
      return `계정 검색 ${bits} → ${r?.count ?? 0}개`;
    case "propose_update":
      return r?.ok ? `변경 제안 ${r?.proposed ?? 0}건` : `변경 제안 거부 — ${r?.error ?? ""}`;
    default:
      return `${name} ${bits}`;
  }
}
