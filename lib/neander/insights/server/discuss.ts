// ============================================================
//  월간 인사이트 — 「AI 와 고치기」 대화
// ------------------------------------------------------------
//  사람이 초안을 읽다가 모르는 곳을 묻고(「할 일 2 의 248만원은 뭐야?」),
//  AI 가 근거를 풀어 설명하고, 방향이 정해지면 문장 수정안을 낸다.
//
//  만들기(generate.ts)와 다른 점: 설명하려면 신호만으로 모자란다. 그래서
//  각 모듈 비서의 **조회 도구**를 그대로 빌려 준다 (장부·판매 줄을 읽기만).
//  모듈 비서의 제안 도구(propose_update · propose_resolve …)는 빼고, 이 대화의
//  제안 도구는 propose_edit 하나다.
//
//  ⚠️ 수정안은 초안을 바꾸지 않는다. 화면이 전/후를 보여 주고 사람이
//     「반영」→「저장」을 눌러야 남는다. 근거 신호 id 규칙은 만들기와 같다 —
//     근거 없는 문장은 제안 단계에서 거부한다.
// ============================================================
import "server-only";

import { argBits, runAgent, type AgentMessage, type AgentResult, type AgentToolOutcome } from "@/lib/neander/ai/agent";
import {
  SALES_TOOL_DEFS,
  runSalesTool,
  summarizeSalesTool,
  type SalesToolContext,
} from "@/lib/neander/sales/server/ai-tools";
import { TOOL_DEFS as FIN_TOOL_DEFS, runTool as runFinanceTool, type ToolContext } from "@/lib/neander/finance/server/ai-tools";
import { SECTION_LABEL, itemLabel } from "@/lib/neander/insights/edit";
import { INSIGHT_AI_MODEL, isFinAiModelId } from "@/lib/neander/ai/models";
import { NARRATIVE_LIMITS } from "./generate";
import type {
  InsightDraft,
  InsightEditProposal,
  InsightItem,
  InsightItemRef,
  InsightModule,
  InsightSection,
  Signal,
} from "@/lib/neander/insights/types";

export type InsightDiscussResult = AgentResult<InsightEditProposal>;

type ModuleContext = { module: "sales"; ctx: SalesToolContext } | { module: "finance"; ctx: ToolContext };

const SECTIONS: InsightSection[] = ["summary", "actions", "risks"];
const MAX_ITEMS = 8;

const clip = (s: unknown, max: number): string =>
  typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, max) : "";

const monthLabel = (m: string) => `${Number(m.slice(0, 4))}년 ${Number(m.slice(5, 7))}월`;

// ── 프롬프트 ─────────────────────────────────────────────────

const DOMAIN: Record<InsightModule, string> = {
  finance: `재무 보고의 바탕 (조회할 때 알아둘 것)
- 거래유형 5종: 수입 · 지출 · 자금거래 · 카드대금결제 · 환급. 자금거래·카드대금결제는 손익이 아닙니다. 환급은 지출에서 차감합니다. 순손익 = 수입 − (지출 − 환급).
- 사업구분: 대분류 B2C/B2B/공용, 소분류 와우·아이디·홍대공용·온라인·SMOAT·조향·개발·기타·공용.
- 기본 집계는 발생주의(카드 사용 시점)입니다.`,
  sales: `매출 보고의 바탕 (조회할 때 알아둘 것)
- 매장 셋: 와우(이벤트 팝업 전용) · 아이디(상시 + 이벤트) · 온라인. 코드 wow/id/online 은 도구용이고 사람에게는 이름으로 부릅니다.
- 매출은 POS·네이버 예약·온라인 주문 줄의 합입니다. 장부(정산 입금)와 금액·날짜가 다른 것은 정상입니다.
- 이익률의 분모는 확정 매출입니다. 고정비 배부는 사실이 아니라 경영 판단입니다.
- 인건비는 끝난 달이면 근무 일지 실측, 아니면 가정값입니다.`,
};

function systemPrompt(module: InsightModule, month: string): string {
  const what = module === "sales" ? "매출" : "재무";
  return `당신은 ${monthLabel(month)} ${what} 보고의 「이번 달 인사이트」 초안을 사용자와 함께 다듬는 편집자입니다. 사용자는 초안 문장을 읽다가 이해가 안 되거나 틀려 보이는 곳을 묻고, 맞는 방향으로 고쳐 나가려 합니다.

초안은 코드가 데이터에서 뽑은 신호(signals)를 AI 가 읽고 쓴 것입니다. 문장마다 근거 신호 id 가 붙어 있습니다.

하는 일
1. 설명 — 사용자가 가리킨 문장이 어느 신호에서 나왔는지, 그 숫자가 무엇과 무엇을 비교한 것인지 풀어 말합니다. 신호만으로 모자라면 조회 도구로 원 데이터를 찾아 그 숫자를 만든 거래·판매 줄을 보여 줍니다.
2. 짚기 — 설명하다가 문장이 신호와 어긋나거나, 과장됐거나, 원인을 단정했거나, 누가 무엇을 할지 흐리면 그 점을 분명히 말합니다.
3. 고치기 — 방향이 정해지면 \`propose_edit\` 로 수정안을 냅니다. 사용자가 고치자고 하지 않았어도 설명 중에 틀린 것이 드러났으면 설명과 함께 수정안을 내도 됩니다. 방향이 둘 이상 가능하면 먼저 물어봅니다.

절대 규칙
1. 초안을 직접 바꾸지 못합니다. 수정안은 사용자가 「반영」을 누르고 「저장」해야 남습니다. 「고쳤습니다」가 아니라 「이렇게 고치자고 제안했습니다」라고 말합니다.
2. 숫자를 지어내지 않습니다. 대화에서 말하는 숫자는 신호 또는 이번 대화의 조회 결과에서만 가져옵니다.
3. 수정안 문장에 넣는 숫자는 신호에 있는 숫자를 우선합니다. 조회로 새로 확인한 숫자를 넣을 때는 reason 에 어느 조회에서 나왔는지 적습니다.
4. 모든 수정안 문장은 근거 신호 id 를 1개 이상 답니다 (signalIds). 입력에 없는 id 는 거부됩니다.
5. 데이터로 알 수 없는 원인(왜 발주했는지, 누가 결정했는지)은 추측하지 않습니다. 모른다고 말하고, 확인할 사람·질문을 제안합니다.
6. 한 문장에 수정안은 하나만 — 가장 나은 안으로. 사용자가 고르게 하고 싶으면 대화로 선택지를 보여 주고 고른 뒤에 제안합니다.

문장 형식 (수정안)
- text: 한 문장, ${NARRATIVE_LIMITS.text}자 이하. detail: 부연 한두 문장(선택). impact: 「할 일」에만, 근거 신호의 impact 에서 나온 경우 「월 +80만원」 꼴(${NARRATIVE_LIMITS.impact}자 이하).
- 장별 한 줄(comments): ${NARRATIVE_LIMITS.comment}자 이하. 키는 신호의 chapter 문자열.
- 음수 금액은 「-」로 씁니다(△ 금지). 수식어·인사말 없이.

대화 태도
- 한국어로 짧고 구체적으로. 숫자는 천 단위 쉼표. 표가 도움이 되면 마크다운 표(다섯 줄 안팎).
- 문장을 가리킬 때는 초안의 이름표(「핵심 2」「할 일 1」「확인 3」)를 씁니다.
- 사용자 메시지 앞의 「(할 일 2 「…」 에 대해)」는 사용자가 화면에서 그 문장을 짚고 물었다는 뜻입니다. 이름표는 대화 도중 문장이 지워지면 바뀔 수 있으니, 아래 「지금 초안」의 이름표와 인용한 문장을 함께 보고 대상을 찾습니다.

${DOMAIN[module]}`;
}

/** 신호 — 대화 내내 같아 캐시된다 */
function renderSignals(signals: Signal[]): string {
  const payload = signals.map((s) => ({
    id: s.id,
    topic: s.topic,
    severity: s.severity,
    title: s.title,
    detail: s.detail,
    ...(s.impact !== undefined ? { impact: s.impact } : {}),
    metrics: s.metrics,
    ...(s.chapter ? { chapter: s.chapter } : {}),
  }));
  return `== 신호 (이 초안의 근거 — ${signals.length}개) ==\n${JSON.stringify(payload)}`;
}

/** 지금 초안 — 사람이 고칠 때마다 바뀌어 캐시 뒤에 붙인다 */
function renderDraft(draft: InsightDraft, scope: string | undefined, module: InsightModule): string {
  const lines: string[] = ["== 지금 초안 (사용자 화면의 편집 중인 상태 · 아직 저장 전일 수 있음) =="];
  if (scope) {
    lines.push(
      module === "finance"
        ? `범위: 사업장 「${scope}」 — 조회할 때 site="${scope}" 로 좁힙니다.`
        : `범위: ${scope}`,
    );
  }
  for (const section of SECTIONS) {
    lines.push("", `[${SECTION_LABEL[section]}]`);
    if (draft[section].length === 0) lines.push("(없음)");
    draft[section].forEach((it, i) => {
      lines.push(`${SECTION_LABEL[section]} ${i + 1} (id=${it.id}) ${it.text}`);
      if (it.detail) lines.push(`  부연: ${it.detail}`);
      if (it.impact) lines.push(`  영향: ${it.impact}`);
      lines.push(`  근거: ${it.signalIds.join(", ") || "(없음)"}`);
    });
  }
  const chapters = Object.entries(draft.comments);
  lines.push("", "[장별 한 줄]");
  if (chapters.length === 0) lines.push("(없음)");
  for (const [ch, line] of chapters) lines.push(`${ch}: ${line}`);
  return lines.join("\n");
}

// ── 제안 도구 ────────────────────────────────────────────────

const PROPOSE_EDIT_DEF = {
  type: "function" as const,
  function: {
    name: "propose_edit",
    description:
      "초안 문장 하나를 고치거나(replace) 더하거나(add) 지우자고(remove) 제안한다. 장별 한 줄은 section=comments. " +
      "초안을 바꾸지 않는다 — 사용자가 화면에서 전/후를 보고 반영한다. 한 호출에 한 문장.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["section", "op", "reason"],
      properties: {
        section: { type: "string", enum: ["summary", "actions", "risks", "comments"], description: "핵심·할 일·확인·장별 한 줄" },
        op: { type: "string", enum: ["replace", "add", "remove"] },
        targetId: {
          type: "string",
          description: "replace·remove 의 대상 문장 id (초안의 id=… 값). comments 면 장(chapter) 이름",
        },
        text: { type: "string", description: "새 문장 (replace·add). comments 면 한 줄" },
        detail: { type: "string", description: "부연 (선택)" },
        impact: { type: "string", description: "할 일에만 — 「월 +80만원」 꼴 (선택)" },
        signalIds: { type: "array", items: { type: "string" }, description: "근거 신호 id 1개 이상 (replace·add)" },
        reason: { type: "string", description: "왜 이렇게 고치는지 한두 문장 — 사용자가 반영할지 판단할 근거" },
      },
    },
  },
};

let proposalSeq = 0;

function proposeEdit(
  a: Record<string, unknown>,
  draft: InsightDraft,
  signals: Signal[],
): AgentToolOutcome<InsightEditProposal> {
  const fail = (error: string) => ({ result: { ok: false, error } });
  const reason = clip(a.reason, 300);
  if (!reason) return fail("reason 이 필요합니다.");
  const op = a.op;
  if (op !== "replace" && op !== "add" && op !== "remove") return fail("op 는 replace · add · remove 중 하나입니다.");
  const id = `ie${Date.now().toString(36)}${(proposalSeq++).toString(36)}`;

  if (a.section === "comments") {
    const chapter = clip(a.targetId, 80);
    const chapters = new Set([
      ...signals.map((s) => s.chapter).filter((c): c is string => !!c),
      ...Object.keys(draft.comments),
    ]);
    if (!chapters.has(chapter)) return fail(`장 이름 「${chapter}」 이 신호에도 초안에도 없습니다.`);
    const text = op === "remove" ? "" : clip(a.text, NARRATIVE_LIMITS.comment);
    if (op !== "remove" && !text) return fail("text 가 필요합니다.");
    return {
      result: { ok: true, proposed: id },
      proposal: { id, kind: "comment", chapter, text, before: draft.comments[chapter], reason },
    };
  }

  const section = a.section as InsightSection;
  if (!SECTIONS.includes(section)) return fail("section 은 summary · actions · risks · comments 중 하나입니다.");
  const list = draft[section];
  const target = op === "add" ? undefined : list.find((x) => x.id === a.targetId);
  if (op !== "add" && !target) {
    return fail(`targetId 「${String(a.targetId ?? "")}」 인 문장이 ${SECTION_LABEL[section]}에 없습니다. 초안의 id=… 값을 쓰세요.`);
  }
  if (op === "add" && list.length >= MAX_ITEMS) return fail(`${SECTION_LABEL[section]}은 ${MAX_ITEMS}개까지입니다.`);

  if (op === "remove") {
    return {
      result: { ok: true, proposed: id, target: itemLabel(draft, section, target!.id) },
      proposal: { id, kind: "item", section, op, targetId: target!.id, before: target, reason },
    };
  }

  const text = clip(a.text, NARRATIVE_LIMITS.text);
  if (!text) return fail("text 가 필요합니다.");
  const known = new Set(signals.map((s) => s.id));
  const rawIds = Array.isArray(a.signalIds) ? a.signalIds : [];
  let signalIds = [...new Set(rawIds.filter((s): s is string => typeof s === "string" && known.has(s)))];
  // 근거를 안 적고 문장만 다듬은 경우 — 원래 문장의 근거를 이어받는다
  if (signalIds.length === 0 && target && rawIds.length === 0) signalIds = target.signalIds;
  if (signalIds.length === 0) return fail("signalIds 에 입력 신호의 id 가 1개 이상 있어야 합니다.");

  const detail = clip(a.detail, NARRATIVE_LIMITS.detail);
  const impact = section === "actions" ? clip(a.impact, NARRATIVE_LIMITS.impact) : "";
  const item: Omit<InsightItem, "id"> = {
    text,
    signalIds,
    ...(detail ? { detail } : {}),
    ...(impact ? { impact } : {}),
  };
  return {
    result: { ok: true, proposed: id, ...(target ? { target: itemLabel(draft, section, target.id) } : {}) },
    proposal: { id, kind: "item", section, op, ...(target ? { targetId: target.id, before: target } : {}), item, reason },
  };
}

function summarizeEdit(a: Record<string, unknown>, result: unknown): string {
  const r = result as { ok?: boolean; error?: string; target?: string } | undefined;
  const opLabel = a.op === "add" ? "추가" : a.op === "remove" ? "삭제" : "수정";
  const where =
    a.section === "comments"
      ? `장별 한 줄 「${String(a.targetId ?? "")}」`
      : r?.target ?? SECTION_LABEL[a.section as InsightSection] ?? String(a.section);
  return r?.ok ? `${where} ${opLabel} 제안` : `수정 제안 거부 — ${r?.error ?? ""}`;
}

// ── 본체 ─────────────────────────────────────────────────────

/** 모듈 비서의 조회 도구만 — 그쪽 제안 도구는 이 대화에서 쓰면 안 된다 */
const readOnly = <T extends { function: { name: string } }>(defs: readonly T[]) =>
  defs.filter((d) => !d.function.name.startsWith("propose_"));

/** 「묻기」 팝오버에서 온 대화 — 사람이 짚은 문장 하나에 집중시킨다 */
function focusNote(draft: InsightDraft, focus: InsightItemRef | undefined): string {
  if (!focus) return "";
  const it = draft[focus.section].find((x) => x.id === focus.itemId);
  const label = itemLabel(draft, focus.section, focus.itemId);
  if (!it || !label) return "";
  return [
    "",
    "== 지금 대화의 대상 ==",
    `사용자는 「${label}」(section=${focus.section}, id=${it.id}) 한 문장 옆에서 피드백을 남기고 있습니다: ${it.text}`,
    "- 이 문장에 대한 설명·피드백으로 읽고, 고칠 때는 이 문장을 대상으로 propose_edit 을 냅니다 (targetId 에 위 id).",
    "- 사용자의 피드백이 방향을 분명히 정했으면(「이 숫자 빼줘」「담당자를 재무팀으로」) 되묻지 말고 바로 수정안을 냅니다. 모호하면 한 번만 짧게 묻습니다.",
    "- 답은 짧게 — 좁은 팝오버에 뜹니다. 표는 꼭 필요할 때만 세 줄 안으로.",
  ].join("\n");
}

export async function runInsightDiscussion(args: {
  month: string;
  scope?: string;
  signals: Signal[];
  draft: InsightDraft;
  messages: AgentMessage[];
  data: ModuleContext;
  model?: string;
  focus?: InsightItemRef;
}): Promise<InsightDiscussResult> {
  const { data, draft, signals } = args;
  const module = data.module;

  const lookupDefs = data.module === "sales" ? readOnly(SALES_TOOL_DEFS) : readOnly(FIN_TOOL_DEFS);
  const lookupNames = new Set(lookupDefs.map((d) => d.function.name));

  return runAgent<InsightEditProposal>(
    {
      system: systemPrompt(module, args.month),
      cachedContext: renderSignals(signals),
      note: renderDraft(draft, args.scope, module) + focusNote(draft, args.focus),
      tools: [...lookupDefs, PROPOSE_EDIT_DEF],
      runTool: (name, a) => {
        if (name === "propose_edit") return proposeEdit(a, draft, signals);
        if (!lookupNames.has(name)) return { result: { ok: false, error: `이 대화에서 쓸 수 없는 도구입니다: ${name}` } };
        // 조회 도구는 제안을 만들지 않는다 — 혹시 돌아와도 버린다
        return data.module === "sales"
          ? { result: runSalesTool(name, a, data.ctx).result }
          : { result: runFinanceTool(name, a, data.ctx).result };
      },
      summarize: (name, a, result) => {
        if (name === "propose_edit") return summarizeEdit(a, result);
        if (data.module === "sales") return summarizeSalesTool(name, a, result);
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
          default:
            return `${name} ${bits}`;
        }
      },
      referer: `https://neander-erp.local/${module}/insights`,
      title: "NEANDER ERP Insight Editor",
    },
    // 비서 기본값(Flash)이 아니라 인사이트 모델 — 허용 목록에 없는 요청 모델도 이걸로
    { messages: args.messages, model: isFinAiModelId(args.model) ? args.model : INSIGHT_AI_MODEL },
  );
}
