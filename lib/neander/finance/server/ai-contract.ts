// ============================================================
//  계약서 비서 — 프롬프트 · 도구 · 실행
// ------------------------------------------------------------
//  계약서 편집창 옆에 붙어 **그 계약서 한 장**을 두고 이야기하는 비서다.
//  도구 루프는 재무·매출 비서와 같은 것(lib/neander/ai/agent.ts)을 쓴다.
//
//  재무 비서와 다른 점이 하나 있다. 재무 비서는 서버가 Firestore 에서 장부를
//  읽지만, 계약서 비서는 **화면의 초안**을 받는다. 사람이 종이 위에서 방금
//  고친 것, 아직 저장하지 않은 것까지가 「지금 계약서」 이기 때문이다.
//  저장된 것을 읽으면 비서가 한 박자 늦은 글을 고치자고 한다.
//
//  ⚠️ 비서는 계약서를 바꾸지 못한다. 도구는 전부 **제안**이다 — 조항 하나를
//     이렇게, 새 조항을 여기에, 이 칸을 이 값으로. 제안은 응답에 실려 화면의
//     카드가 되고, 사람이 전/후를 보고 「적용」 을 눌러야 초안에 닿는다.
//     초안은 다시 「저장」 을 눌러야 남는다.
//
//  도구가 제안을 만들 때마다 서버 쪽 초안(ctx.draft)에도 입혀 둔다. 한 번의
//  답에서 조항을 끼운 뒤 그 조항을 다시 고치는 식으로 이어 부를 수 있어야
//  해서다. 이 초안은 요청이 끝나면 버려진다 — 어디에도 저장되지 않는다.
// ============================================================

import { argBits, runAgent, type AgentMessage, type AgentResult, type AgentToolOutcome } from "@/lib/neander/ai/agent";
import { CONTRACT_AI_MODEL, isFinAiModelId } from "@/lib/neander/ai/models";
import type { ExtractedAttachment } from "@/lib/neander/server/attachments";
import { todayStrKST } from "@/lib/neander/format";
import { VAT_LABEL, type FinProjectDoc } from "../project";
import { quoteTotals, QUOTE_VAT_LABEL, type FinQuoteDoc } from "../docs";
import { CONTRACT_LIMITS, type ContractItem, type ContractParty, type ContractTerm } from "../contract-body";
import {
  CONTRACT_TEXT_FIELDS,
  CONTRACT_TEXT_LABEL,
  applyContractChange,
  checkContract,
  clauseLabel,
  contractOutline,
  fieldsChangeRows,
  isVatMode,
  matchQuoteStyle,
  newClause,
  numberedRefs,
  type ContractChange,
  type ContractFieldsPatch,
  type ContractProposal,
  type ContractTextField,
  type FinContractDraft,
} from "../contract";

export type ContractChatResult = AgentResult<ContractProposal>;

export interface ContractToolContext {
  /** 화면의 초안. 제안을 만들 때마다 여기에도 입힌다 (요청이 끝나면 버린다) */
  draft: FinContractDraft;
}

const SYSTEM = `당신은 (주)네안데르의 계약 담당자와 함께 일하는 계약서 비서입니다. 네안데르는 향수·조향 브랜드 AC'SCENT 를 운영하며, 행사 체험 프로그램(AI 조향사) 운영, 향수·사쉐·굿즈 납품, 캐릭터·아티스트 IP 협업 상품을 합니다.

지금 사용자는 ERP 의 계약서 편집창에서 계약서 한 장을 열어 두고 있습니다. 아래 「지금 계약서」 가 그 종이의 최신 상태입니다 (사용자가 방금 손으로 고친 것까지 들어 있습니다). 지난 대화의 제안이 반영됐는지는 대화가 아니라 「지금 계약서」 를 보고 판단하세요.

할 수 있는 일
- 계약서를 읽고 설명한다. 우리에게 불리하거나 빠진 조항을 짚는다.
- 고칠 것을 도구로 **제안**한다 — 조항 고치기·끼우기·빼기, 제목·전문·맺음말, 금액·기간·당사자·개요 행·품목 표.
- 사용자가 첨부한 문서(상대가 보낸 계약서·수정본·과업지시서·견적서)를 읽고 우리 계약서와 견준다.

절대 규칙
1. **당신은 계약서를 직접 바꿀 수 없습니다.** 도구는 전부 제안이고, 사용자가 카드에서 전/후를 보고 「적용」 을 눌러야 종이에 반영됩니다. "고쳤습니다" · "반영했습니다" · "바꿨습니다" 라고 말하지 말고 "이렇게 고치자고 제안했습니다" 라고 말하세요.
2. **사실을 지어내지 마세요.** 상호·사업자등록번호·주소·대표자·계좌·날짜·금액·수량·요율은 사용자가 말했거나 「지금 계약서」·「프로젝트」·첨부에 있는 것만 씁니다. 모르는 값은 「____」 로 비워 두고 무엇이 필요한지 물어보세요.
3. 조항을 고칠 때는 그 조항의 **전체 글**을 보냅니다. 바꾸지 않는 항도 그대로 넣으세요 — 일부만 보내면 나머지 항이 사라집니다.
4. 조항끼리는 **번호로 부르지 않습니다.** 「제13조의 불가항력」 대신 「불가항력으로」, 「검수 완료일」, 「계약의 개요에 적은 계약금액」 처럼 이름으로 가리킵니다. 조항을 끼우거나 빼면 번호가 밀리기 때문입니다. 같은 조 안의 「제1항」 은 써도 됩니다.
5. 금액·기간·상대방 정보는 「계약의 개요」 에 한 번만 적습니다. 조항 본문에 계약금액 숫자를 되풀이하지 마세요.
6. 문체는 기존 조항을 따릅니다 — 「…한다.」 로 끝나는 문장, 항은 ①②③, 호는 두 칸 들여 「  1.」 「  2.」, 당사자는 둥근 따옴표로 “갑” “을” (곧은 따옴표 "갑" 이 아닙니다). 바꾸지 않는 문장은 글자 하나, 따옴표 하나까지 그대로 둡니다 — 카드가 바뀐 낱말만 짚어 보여 주기 때문에, 손대지 않은 곳이 달라지면 사용자가 무엇이 바뀌었는지 못 찾습니다.
7. 사용자가 말한 것만 바꿉니다. 부탁받지 않은 조항을 덩달아 고치지 마세요. 다만 요청한 변경 때문에 다른 조항과 어긋나게 되면 그 조항도 함께 제안하거나, 어긋난다고 알려 주세요.
8. 뜻이 여러 가지로 읽히거나 값이 빠진 요청은 제안하기 전에 물어보세요. 계약서는 조용히 틀린 한 줄이 가장 비쌉니다.

네안데르의 계약 원칙 (초안을 쓸 때와 상대 계약서를 볼 때의 기준)
- 가능하면 우리가 초안을 먼저 냅니다. 상대가 쓴 계약서를 고치는 것과 우리 계약서를 놓고 협상하는 것은 다른 게임입니다.
- 대가(대금·로열티)는 반드시 본문에 있어야 합니다. 별첨에만 있으면 분쟁 때 근거가 약합니다.
- 로열티는 **판매(순매출) 기준**으로 정산합니다. 생산 수량 기준이나 최소 보장금은 안 팔린 재고에도 돈이 나가 구조적으로 불리합니다.
- 상대의 의무를 명문화합니다 — 자료 제공, 승인 회신 기한(기한이 지나면 승인으로 봄), IP 권리자의 홍보 의무와 미이행 시 감액.
- 해지 조건은 양쪽에 똑같이 적용돼야 합니다. 시정 기간은 14일 이상 (7일은 생산·유통 문제를 풀기에 짧습니다).
- 지체상금에는 상한(보통 계약금액의 10%)과 면책(상대 귀책·불가항력)이 있어야 합니다.
- 우리가 원래 가진 것(AI 조향 프로그램·소프트웨어·조향 레시피·금형)의 권리는 우리에게 남깁니다. 결과물 일체를 넘기는 조항은 범위를 「이 계약을 위해 새로 만든 것」 으로 좁힙니다.
- 계약이 끝난 뒤의 재고·잔여물 처리를 구체적으로 적습니다 (판매를 이어 갈 기간, 그 뒤의 처리).
- 관할 법원이 상대 소재지로만 정해져 있으면 불리합니다. 우리 본점 소재지나 민사소송법상 관할로 맞춥니다.
- 대금은 선금을 받고 시작하는 쪽을 먼저 제시하고, 검수 기한과 「기한 내 통지가 없으면 합격」 을 둡니다.
- 향수·화장품은 「화장품법」, 방향제·디퓨저는 「생활화학제품 및 살생물제의 안전관리에 관한 법률」, 참여자 정보는 「개인정보 보호법」 이 걸립니다.
우리가 돈을 주는 계약(제작 위탁, 우리가 “갑”)에서는 같은 원칙을 반대편에서 봅니다 — 결과물과 우리 비용으로 만든 금형은 우리 것, 재위탁은 동의를 받아야, 납기와 품질 책임은 상대에게.

대화 태도
- 한국어로, 짧고 구체적으로. 제안했으면 무엇을 왜 바꿨는지 한두 줄로 말하고, 조항 전문을 답에 되풀이하지 않습니다 (카드가 전/후를 보여 줍니다).
- 검토를 부탁받으면 중요한 것부터 번호를 매겨 짚고, 고칠 방향을 한 줄씩 붙입니다. 사용자가 「고쳐줘」 라고 하면 그때 제안합니다. 처음부터 한꺼번에 여러 조항을 고치자고 쏟아내지 마세요.
- 당신은 변호사가 아닙니다. 독점·위약벌·지식재산 양도·보증보험처럼 무게가 큰 조건이나 금액이 큰 계약이면 전문가 검토를 권한다고 한 줄만 덧붙이세요. 매번 되풀이하지는 않습니다.

첨부 파일
- 사용자가 파일을 첨부하면 메시지 안에 "=== 첨부 파일: 이름 ===" 블록으로 추출된 글이 들어옵니다.
- 상대가 보낸 계약서라면 위 원칙에 비추어 우리에게 불리한 곳을 조항 번호와 함께 짚습니다. 그 내용을 우리 계약서에 옮기자는 말이 있으면 그때 제안합니다.
- "(길어서 뒷부분 잘림)" 표시가 있으면 일부만 읽었다는 뜻이니 그 한계를 답에 밝히세요.`;

// ---- 도구 정의 (OpenAI function calling 형식) -------------------

const fn = (name: string, description: string, properties: Record<string, unknown>, required: string[]) => ({
  type: "function",
  function: { name, description, parameters: { type: "object", properties, required } },
});

const REASON = { type: "string", description: "왜 이렇게 바꾸는지 한두 문장 — 카드에 그대로 보입니다" };
const CLAUSE_REF = { type: "string", description: "조항 id — 「지금 계약서」 의 [조항 id …] 값" };
const PARTY = {
  type: "object",
  description: "바꿀 칸만 넣는다",
  properties: {
    name: { type: "string", description: "상호" },
    bizNo: { type: "string", description: "사업자등록번호" },
    address: { type: "string" },
    ceo: { type: "string", description: "대표자 (직함 포함 가능)" },
  },
};

export const CONTRACT_TOOL_DEFS = [
  fn(
    "propose_clause_edit",
    "조항 하나의 글(과 제목)을 바꾸자고 제안한다. text 에는 그 조항의 전체 글을 넣는다 — 바꾸지 않는 항도 포함.",
    {
      clause: CLAUSE_REF,
      title: { type: "string", description: "조항 제목(괄호 안의 말). 그대로 두려면 생략" },
      text: { type: "string", description: "조항의 전체 글. 항은 ①②③, 호는 두 칸 들여 1. 2." },
      reason: REASON,
    },
    ["clause", "text", "reason"],
  ),
  fn(
    "propose_clause_add",
    "새 조항을 끼워 넣자고 제안한다. 번호는 자리에서 저절로 매겨진다.",
    {
      after: { type: "string", description: "이 조항 id 바로 뒤에 끼운다. 생략하면 맨 끝 — 보통은 관련 조항 뒤를 지정한다" },
      title: { type: "string", description: "조항 제목 (괄호 안의 말)" },
      text: { type: "string" },
      reason: REASON,
    },
    ["title", "text", "reason"],
  ),
  fn("propose_clause_remove", "조항 하나를 빼자고 제안한다. 뒤 조항의 번호가 하나씩 당겨진다.", { clause: CLAUSE_REF, reason: REASON }, ["clause", "reason"]),
  fn(
    "propose_text",
    "조항이 아닌 글 — 제목·전문·맺음말 — 을 바꾸자고 제안한다.",
    { field: { type: "string", enum: [...CONTRACT_TEXT_FIELDS], description: "heading 제목 · preamble 전문 · closing 맺음말" }, text: { type: "string" }, reason: REASON },
    ["field", "text", "reason"],
  ),
  fn(
    "propose_fields",
    "계약의 개요와 서명란의 칸을 바꾸자고 제안한다. 바꿀 것만 넣는다.",
    {
      title: { type: "string", description: "계약명" },
      amount: { type: "number", description: "계약금액 (원). 부가세 기준은 vatMode" },
      vatMode: { type: "string", enum: ["excluded", "included", "exempt"], description: "excluded 부가세 별도 · included 부가세 포함 · exempt 면세" },
      startDate: { type: "string", description: "계약기간 시작 YYYY-MM-DD. 빈 글이면 「계약 체결일부터」" },
      endDate: { type: "string", description: "계약기간 끝 YYYY-MM-DD" },
      signedDate: { type: "string", description: "체결일 YYYY-MM-DD. 빈 글이면 비운다" },
      partyA: { ...PARTY, description: "“갑” 의 서명란 — 바꿀 칸만" },
      partyB: { ...PARTY, description: "“을” 의 서명란 — 바꿀 칸만" },
      terms: {
        type: "array",
        description: "개요 표에 덧붙는 행(납품기한·장소·입금 계좌 …)의 **전체 목록**. 바꾸지 않는 행도 넣는다 — 빠진 행은 지워진다",
        items: { type: "object", properties: { label: { type: "string" }, value: { type: "string" } }, required: ["label", "value"] },
      },
      items: {
        type: "array",
        description: "품목 표의 **전체 목록**. 바꾸지 않는 줄도 넣는다 — 빠진 줄은 지워진다",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            spec: { type: "string", description: "규격" },
            qty: { type: "number" },
            unitPrice: { type: "number" },
            note: { type: "string" },
          },
          required: ["name", "qty", "unitPrice"],
        },
      },
      reason: REASON,
    },
    ["reason"],
  ),
];

// ---- 도구 실행 ---------------------------------------------------

const rid = () => Math.random().toString(36).slice(2, 10);
const str = (v: unknown) => (typeof v === "string" ? v : "");
const fail = (error: string): AgentToolOutcome<ContractProposal> => ({ result: { ok: false, error } });
const cleanText = (v: unknown, max: number) => str(v).replace(/\r\n?/g, "\n").trimEnd().slice(0, max);

/** 조항을 찾는다 — id 가 먼저, 「8」·「제8조」 처럼 번호로 불러도 받아 준다 */
function findClause(draft: FinContractDraft, ref: unknown): number {
  const s = String(ref ?? "").trim();
  const byId = draft.body.clauses.findIndex((x) => x.id === s);
  if (byId >= 0) return byId;
  const m = /^제?\s*(\d+)\s*조?$/.exec(s);
  if (m) {
    const n = Number(m[1]) - 1;
    if (n >= 0 && n < draft.body.clauses.length) return n;
  }
  return -1;
}

const clauseList = (draft: FinContractDraft) =>
  draft.body.clauses.map((x, i) => ({ id: x.id, label: clauseLabel(i, x.title) }));

const noClause = (draft: FinContractDraft) =>
  fail(`그런 조항이 없습니다. 지금 조항: ${clauseList(draft).map((x) => `${x.label} [${x.id}]`).join(" · ")}`);

/** 날짜 인자 — 빈 글은 「비운다」(null), 꼴이 틀리면 undefined 대신 오류 */
function dateArg(v: unknown): string | null | undefined | "bad" {
  if (v === undefined) return undefined;
  const s = str(v).trim();
  if (!s) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "bad";
}

function partyArg(v: unknown): Partial<ContractParty> | undefined {
  if (!v || typeof v !== "object") return undefined;
  const r = v as Record<string, unknown>;
  const out: Partial<ContractParty> = {};
  (["name", "bizNo", "address", "ceo"] as const).forEach((k) => {
    if (typeof r[k] === "string") out[k] = (r[k] as string).replace(/\s*\n+\s*/g, " ").trim().slice(0, CONTRACT_LIMITS.partyField);
  });
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * 제안 하나를 만들고 서버 쪽 초안에 입힌다.
 * 결과에는 바뀐 뒤의 조항 목록을 돌려준다 — 모델이 새 번호와 id 를 보고 이어 부른다.
 */
function propose(
  ctx: ContractToolContext,
  p: Omit<ContractProposal, "id">,
  extra: Record<string, unknown> = {},
): AgentToolOutcome<ContractProposal> {
  const proposal: ContractProposal = { id: rid(), ...p };
  ctx.draft = applyContractChange(ctx.draft, p.change);
  return {
    result: { ok: true, proposed: p.label, note: "제안일 뿐입니다 — 사용자가 「적용」 을 눌러야 반영됩니다.", clauses: clauseList(ctx.draft), ...extra },
    proposal,
  };
}

export function runContractTool(name: string, raw: Record<string, unknown>, ctx: ContractToolContext): AgentToolOutcome<ContractProposal> {
  const draft = ctx.draft;
  // 모델이 곧은 따옴표로 돌려보낸 글을 계약서의 따옴표 모양에 맞춘다 (contract.ts 의 matchQuoteStyle)
  const quoted = (v: unknown) => (typeof v === "string" ? matchQuoteStyle(v, draft) : v);
  const a: Record<string, unknown> = { ...raw, title: quoted(raw.title), text: quoted(raw.text) };
  const reason = str(a.reason).trim().slice(0, 400);
  const L = CONTRACT_LIMITS;

  switch (name) {
    case "propose_clause_edit": {
      const i = findClause(draft, a.clause);
      if (i < 0) return noClause(draft);
      const cur = draft.body.clauses[i];
      const text = cleanText(a.text, L.clauseText);
      const title = a.title === undefined ? cur.title : str(a.title).replace(/\n+/g, " ").trim().slice(0, L.clauseTitle);
      if (!text.trim()) return fail("text 가 비어 있습니다. 조항의 전체 글을 넣어주세요. 조항을 없애려면 propose_clause_remove 를 쓰세요.");
      if (text === cur.text && title === cur.title) return fail("바뀐 것이 없습니다 — 지금 조항과 같은 글입니다.");
      return propose(ctx, {
        label: `${clauseLabel(i, cur.title)} 고치기`,
        reason,
        change: { kind: "clause.edit", clauseId: cur.id, title, text },
        before: { title: cur.title, text: cur.text },
      });
    }

    case "propose_clause_add": {
      if (draft.body.clauses.length >= L.clauses) return fail(`조항은 ${L.clauses}개까지입니다.`);
      const text = cleanText(a.text, L.clauseText);
      const title = str(a.title).replace(/\n+/g, " ").trim().slice(0, L.clauseTitle);
      if (!title || !text.trim()) return fail("title 과 text 가 모두 필요합니다.");
      let afterId: string | null = null;
      if (a.after !== undefined && String(a.after).trim()) {
        const i = findClause(draft, a.after);
        if (i < 0) return noClause(draft);
        afterId = draft.body.clauses[i].id;
      }
      const at = afterId ? draft.body.clauses.findIndex((x) => x.id === afterId) + 1 : draft.body.clauses.length;
      const clause = newClause(title, text);
      const out = propose(ctx, {
        label: `${clauseLabel(at, title)} 끼우기`,
        reason,
        change: { kind: "clause.add", afterId, index: at, clause },
      });
      return withRefs(out, ctx, { newClauseId: clause.id });
    }

    case "propose_clause_remove": {
      const i = findClause(draft, a.clause);
      if (i < 0) return noClause(draft);
      const cur = draft.body.clauses[i];
      const out = propose(ctx, {
        label: `${clauseLabel(i, cur.title)} 빼기`,
        reason,
        change: { kind: "clause.remove", clauseId: cur.id },
        before: { title: cur.title, text: cur.text },
      });
      return withRefs(out, ctx);
    }

    case "propose_text": {
      const field = str(a.field) as ContractTextField;
      if (!(CONTRACT_TEXT_FIELDS as readonly string[]).includes(field)) return fail("field 는 heading · preamble · closing 중 하나입니다.");
      const text = cleanText(a.text, field === "heading" ? L.heading : L.longText).trim();
      if (!text) return fail("text 가 비어 있습니다.");
      if (text === draft.body[field]) return fail("바뀐 것이 없습니다.");
      return propose(ctx, {
        label: `${CONTRACT_TEXT_LABEL[field]} 고치기`,
        reason,
        change: { kind: "text", field, text },
        before: { text: draft.body[field] },
      });
    }

    case "propose_fields": {
      const patch: ContractFieldsPatch = {};
      if (typeof a.title === "string" && a.title.trim()) patch.title = a.title.trim().slice(0, 200);
      if (a.amount !== undefined) {
        const n = Number(a.amount);
        if (!Number.isFinite(n) || n < 0) return fail("amount 는 0 이상의 숫자(원)여야 합니다.");
        patch.amount = Math.round(n);
      }
      if (a.vatMode !== undefined) {
        if (!isVatMode(a.vatMode)) return fail("vatMode 는 excluded · included · exempt 중 하나입니다.");
        patch.vatMode = a.vatMode;
      }
      for (const k of ["startDate", "endDate", "signedDate"] as const) {
        const d = dateArg(a[k]);
        if (d === "bad") return fail(`${k} 는 YYYY-MM-DD 꼴이어야 합니다.`);
        if (d !== undefined) patch[k] = d;
      }
      const start = patch.startDate === undefined ? draft.startDate : (patch.startDate ?? undefined);
      const end = patch.endDate === undefined ? draft.endDate : (patch.endDate ?? undefined);
      if (start && end && start > end) return fail("계약기간의 끝이 시작보다 앞섭니다.");
      const pa = partyArg(a.partyA);
      const pb = partyArg(a.partyB);
      if (pa) patch.partyA = pa;
      if (pb) patch.partyB = pb;
      if (Array.isArray(a.terms)) {
        // 같은 이름의 행은 id 를 지킨다 — 되돌리기와 화면의 줄이 같은 행을 가리키게
        const left = [...draft.body.terms];
        patch.terms = (a.terms as Record<string, unknown>[])
          .filter((t) => t && typeof t === "object")
          .slice(0, L.terms)
          .map((t): ContractTerm => {
            const label = str(t.label).replace(/\n+/g, " ").trim().slice(0, L.termLabel);
            const k = left.findIndex((x) => x.label.trim() === label);
            const id = k >= 0 ? left.splice(k, 1)[0].id : rid();
            return { id, label, value: cleanText(t.value, L.termValue).trim() };
          })
          .filter((t) => t.label || t.value);
      }
      if (Array.isArray(a.items)) {
        patch.items = (a.items as Record<string, unknown>[])
          .filter((t) => t && typeof t === "object" && str(t.name).trim())
          .slice(0, L.items)
          .map((t): ContractItem => {
            const spec = str(t.spec).trim();
            const note = str(t.note).trim();
            return {
              id: rid(),
              name: str(t.name).trim().slice(0, 160),
              ...(spec ? { spec: spec.slice(0, 120) } : {}),
              qty: Number.isFinite(Number(t.qty)) ? Number(t.qty) : 0,
              unitPrice: Number.isFinite(Number(t.unitPrice)) ? Math.round(Number(t.unitPrice)) : 0,
              ...(note ? { note: note.slice(0, 120) } : {}),
            };
          });
      }
      const rows = fieldsChangeRows(draft, patch);
      if (rows.length === 0) return fail("바뀐 것이 없습니다 — 지금 값과 같습니다. 바꿀 칸과 값을 넣어주세요.");
      return propose(ctx, {
        label: `${rows.map((r) => r.label).slice(0, 3).join(" · ")}${rows.length > 3 ? ` 외 ${rows.length - 3}` : ""} 바꾸기`,
        reason,
        change: { kind: "fields", patch },
        rows,
      });
    }

    default:
      return fail(`모르는 도구입니다: ${name}`);
  }
}

/**
 * 조항을 끼우거나 뺀 뒤 — 다른 조를 번호로 부르는 조항이 남아 있으면 알려 준다.
 * 양식은 번호로 부르지 않게 썼지만, 사람이 손으로 적어 넣었을 수 있다.
 */
function withRefs(
  out: AgentToolOutcome<ContractProposal>,
  ctx: ContractToolContext,
  extra: Record<string, unknown> = {},
): AgentToolOutcome<ContractProposal> {
  const refs = numberedRefs(ctx.draft.body);
  return {
    ...out,
    result: {
      ...(out.result as Record<string, unknown>),
      ...extra,
      ...(refs.length > 0
        ? {
            numberedRefs: refs,
            warning: "조항 번호가 밀렸습니다. 위 조항들은 다른 조를 번호로 부릅니다 — 가리키는 조가 맞는지 확인하고, 틀리면 이름으로 고쳐 부르도록 제안하세요.",
          }
        : {}),
    },
  };
}

// ---- 요청마다 달라지는 것 -----------------------------------------

const won = (n: number) => Math.round(n).toLocaleString("ko-KR");

/** 프로젝트와 그 견적서 — 비서가 금액·일정·품목의 근거로 쓴다 */
function projectNote(project: FinProjectDoc | undefined, quotes: FinQuoteDoc[]): string {
  if (!project) return "";
  const out = [
    "== 프로젝트 (ERP 의 프로젝트 손익에 적힌 것) ==",
    `이름: ${project.name} (${project.code})`,
    `발주처: ${project.client || "(없음)"}`,
    `계약금액: ${won(project.contractAmount ?? 0)}원 · ${VAT_LABEL[project.vatMode ?? "excluded"]}`,
    `기간: ${project.startDate ?? "?"} ~ ${project.endDate ?? "?"}`,
  ];
  const ins = project.installments ?? [];
  if (ins.length > 0) {
    out.push(`입금 일정: ${ins.map((i) => `${i.kind} ${won(i.amount)}원${i.dueDate ? ` (${i.dueDate})` : ""}${i.paidDate ? " 입금됨" : ""}`).join(" · ")}`);
  }
  if (project.note?.trim()) out.push(`메모: ${project.note.trim().slice(0, 400)}`);
  quotes.slice(0, 2).forEach((q) => {
    const t = quoteTotals(q);
    out.push("", `== 견적서 ${q.quoteNo} 「${q.title}」 (${q.date} · ${QUOTE_VAT_LABEL[q.vatMode]} · 합계 ${won(t.total)}원) ==`);
    if (q.delivery) out.push(`납품기한: ${q.delivery}`);
    if (q.payment) out.push(`대금 지불방식: ${q.payment}`);
    q.lines.slice(0, 30).forEach((l) => out.push(`- ${l.name}${l.spec ? ` (${l.spec})` : ""} — ${won(l.qty)} × ${won(l.unitPrice)}`));
  });
  return out.join("\n");
}

function contractNote(draft: FinContractDraft): string {
  const check = checkContract(draft);
  const lines = [`== 지금 계약서 (오늘 ${todayStrKST()}) ==`, contractOutline(draft), "", "== 살펴본 것 =="];
  lines.push(`본문에 남은 빈칸(____): ${check.blanks}곳`);
  if (check.missing.length > 0) lines.push(`비어 있는 칸: ${check.missing.join(" · ")}`);
  check.dangling.forEach((d) => lines.push(`${d.clause} 가 없는 ${d.ref} 를 가리킵니다`));
  return lines.join("\n");
}

export async function runContractChat(args: {
  messages: AgentMessage[];
  draft: FinContractDraft;
  project?: FinProjectDoc;
  /** 이 프로젝트의 견적서 — 최근 것이 앞 */
  quotes?: FinQuoteDoc[];
  model?: string;
  attachments?: ExtractedAttachment[];
}): Promise<ContractChatResult> {
  const ctx: ContractToolContext = { draft: args.draft };
  const project = projectNote(args.project, args.quotes ?? []);
  return runAgent<ContractProposal>(
    {
      system: SYSTEM,
      // 계약서는 요청마다 다르다 — 캐시되는 앞부분(규칙·원칙) 뒤에 따로 붙인다
      note: [project, contractNote(args.draft)].filter(Boolean).join("\n\n"),
      tools: CONTRACT_TOOL_DEFS,
      runTool: (name, a) => runContractTool(name, a, ctx),
      summarize,
      // HTTP 헤더는 latin-1 만 담을 수 있다 — 한글 금지
      referer: "https://neander-erp.local/finance/contracts",
      title: "NEANDER ERP Contract Chat",
    },
    {
      messages: args.messages,
      // 나가는 문서의 문장이다 — 비서 공통 기본값(싼 모델)이 아니라 계약서용 기본값을 쓴다
      model: isFinAiModelId(args.model) ? args.model : CONTRACT_AI_MODEL,
      attachments: args.attachments,
    },
  );
}

/** 화면에 "무엇을 했는지" 한 줄로 보여주기 위한 요약 */
function summarize(name: string, a: Record<string, unknown>, result: unknown): string {
  const r = result as { ok?: boolean; proposed?: string; error?: string } | undefined;
  if (r?.ok) return `제안 — ${r.proposed ?? name}`;
  return `제안 거부 (${name} ${argBits(a, ["text", "reason", "terms", "items"])}) — ${r?.error ?? ""}`;
}
