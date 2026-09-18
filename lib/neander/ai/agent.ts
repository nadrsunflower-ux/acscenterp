// ============================================================
//  비서 에이전트 — 모듈 공용 도구 루프
// ------------------------------------------------------------
//  OpenRouter(OpenAI 호환)의 function calling 으로 돈다:
//    모델이 도구를 부르면 → 서버가 실행 → 결과를 붙여 다시 호출 →
//    도구를 더 안 부르면 끝.
//
//  재무 비서(finance/server/ai-chat.ts)의 루프를 그대로 뽑아 모듈 무관하게
//  만든 것이다. 모듈마다 다른 것 — 시스템 프롬프트, 캐시 블록(마스터),
//  도구 정의와 실행, 요약 문구 — 은 AgentSpec 으로 받는다.
//
//  루프는 **서버에서만** 돈다. 도구가 Firestore 를 읽어야 하고, 무엇이
//  모델에 갔는지 서버가 알고 있어야 하기 때문이다.
//
//  ⚠️ 변경은 도구가 하지 않는다. 제안 도구는 목록만 만들고, 그 목록이
//     응답에 실려 화면으로 간다. 저장은 사람이 「적용」을 눌렀을 때 각
//     모듈의 기존 저장 경로로 나간다.
// ============================================================

import { DEFAULT_FIN_AI_MODEL, isFinAiModelId } from "@/lib/neander/ai/models";
import type { ExtractedAttachment } from "@/lib/neander/server/attachments";
import type { AssistantToolCall } from "./chat-log";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
/** 도구 왕복 상한 — 폭주하면 비용이 튄다 */
const MAX_STEPS = 8;

export interface AgentMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AgentToolOutcome<P> {
  /** 모델에게 돌려줄 결과 (JSON 문자열로 직렬화된다) */
  result: unknown;
  /** 이번 호출이 만든 변경 제안 */
  proposal?: P;
}

export interface AgentSpec<P> {
  /** 시스템 프롬프트 본문 */
  system: string;
  /**
   * 시스템 뒤에 붙일 마스터 등 — 매 요청 같으므로 프롬프트 캐시를 건다.
   * (재무는 계정 마스터 ≈4천 토큰, 매출은 상품 마스터)
   */
  cachedContext?: string;
  /**
   * 요청마다 달라질 수 있는 짧은 안내 (예: 발표 중인 달 — ai/presentation.ts).
   * 캐시 블록 뒤에 따로 붙여, 이게 바뀌어도 앞의 긴 캐시가 깨지지 않게 한다.
   */
  note?: string;
  /** OpenAI function calling 형식의 도구 정의 */
  tools: unknown[];
  /**
   * 모듈 도구는 메모리에 올라온 ctx 위에서 바로 돌지만, 노션처럼 밖을 읽는
   * 도구(ai/notion-tools.ts)는 Promise 를 돌려준다. 루프가 둘 다 기다린다.
   */
  runTool: (
    name: string,
    args: Record<string, unknown>,
  ) => AgentToolOutcome<P> | Promise<AgentToolOutcome<P>>;
  /** 화면에 "무엇을 조회했는지" 한 줄로 보여주기 위한 요약 */
  summarize: (name: string, args: Record<string, unknown>, result: unknown) => string;
  /** OpenRouter 통계용 헤더 — latin-1 만 (한글 금지) */
  referer: string;
  title: string;
}

export interface AgentResult<P> {
  reply: string;
  toolCalls: AssistantToolCall[];
  proposals: P[];
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    costUsd?: number;
  };
  model: string;
  /** 도구 상한에 걸려 중간에 멈췄는가 */
  truncated: boolean;
  attachments?: { name: string; chars: number; truncated: boolean }[];
  /**
   * 첨부가 있을 때만: 첨부 텍스트까지 붙여 실제로 모델에 보낸 마지막 사용자
   * 메시지. 클라이언트가 다음 턴 히스토리에 이걸 실어야 대화가 이어진다.
   */
  sentUserContent?: string;
}

type WireMessage =
  | { role: "system"; content: unknown }
  | { role: "user"; content: string }
  | {
      role: "assistant";
      content?: string | null;
      tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
    }
  | { role: "tool"; tool_call_id: string; content: string };

export async function runAgent<P>(
  spec: AgentSpec<P>,
  args: {
    messages: AgentMessage[];
    /** 사용자가 고른 모델 — 허용 목록(ai-models.ts)에 없으면 무시하고 기본값 */
    model?: string;
    attachments?: ExtractedAttachment[];
  },
): Promise<AgentResult<P>> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENROUTER_API_KEY 가 설정되지 않았습니다. .env.local(로컬)과 Vercel 환경변수(배포)에 넣어주세요.",
    );
  }
  const model = isFinAiModelId(args.model)
    ? args.model
    : process.env.OPENROUTER_MODEL || DEFAULT_FIN_AI_MODEL;

  const attachBlock = (args.attachments ?? [])
    .map(
      (a) =>
        `\n\n=== 첨부 파일: ${a.name}${a.truncated ? " (길어서 뒷부분 잘림)" : ""} ===\n${a.text}\n=== 첨부 끝 ===`,
    )
    .join("");
  const last = args.messages.length - 1;

  const wire: WireMessage[] = [
    {
      role: "system",
      content: [
        {
          type: "text",
          text: spec.cachedContext ? `${spec.system}\n\n${spec.cachedContext}` : spec.system,
          cache_control: { type: "ephemeral" },
        },
        ...(spec.note ? [{ type: "text", text: spec.note }] : []),
      ],
    },
    ...args.messages.map((m, idx) =>
      m.role === "user"
        ? ({ role: "user", content: idx === last ? m.content + attachBlock : m.content } as WireMessage)
        : ({ role: "assistant", content: m.content } as WireMessage),
    ),
  ];

  const toolCalls: AssistantToolCall[] = [];
  const proposals: P[] = [];
  const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, costUsd: 0 };
  let reply = "";
  let truncated = false;
  let usedModel = model;

  for (let step = 0; step < MAX_STEPS; step++) {
    const res = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": spec.referer,
        "X-Title": spec.title,
      },
      body: JSON.stringify({
        model,
        messages: wire,
        tools: spec.tools,
        max_tokens: 8000,
        reasoning_effort: "medium",
        provider: { require_parameters: true },
      }),
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = (await res.json().catch(() => null)) as any;
    if (!res.ok || raw?.error) {
      throw new Error(`OpenRouter 호출이 실패했습니다: ${raw?.error?.message ?? `HTTP ${res.status}`}`);
    }

    const u = raw?.usage ?? {};
    usage.inputTokens += u.prompt_tokens ?? 0;
    usage.outputTokens += u.completion_tokens ?? 0;
    usage.cacheReadTokens += u.prompt_tokens_details?.cached_tokens ?? 0;
    usage.costUsd += u.cost ?? 0;
    usedModel = raw?.model ?? model;

    const msg = raw?.choices?.[0]?.message;
    if (!msg) throw new Error("모델이 빈 응답을 돌려줬습니다.");

    const calls = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
    if (calls.length === 0) {
      reply = typeof msg.content === "string" ? msg.content : "";
      break;
    }

    // 어시스턴트의 도구 호출을 그대로 기록에 남긴다 (프로토콜상 필수)
    wire.push({ role: "assistant", content: msg.content ?? null, tool_calls: calls });

    for (const call of calls) {
      let parsedArgs: Record<string, unknown> = {};
      try {
        parsedArgs = JSON.parse(call.function?.arguments || "{}");
      } catch {
        wire.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify({ ok: false, error: "인자를 JSON 으로 읽지 못했습니다." }),
        });
        continue;
      }
      const name = call.function?.name ?? "";
      const outcome = await spec.runTool(name, parsedArgs);
      if (outcome.proposal !== undefined) proposals.push(outcome.proposal);
      toolCalls.push({ name, args: parsedArgs, summary: spec.summarize(name, parsedArgs, outcome.result) });
      wire.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(outcome.result) });
    }

    if (step === MAX_STEPS - 1) truncated = true;
  }

  if (!reply && truncated) {
    reply = "조회를 여러 번 했는데도 답을 정리하지 못했습니다. 질문을 조금 좁혀서 다시 물어봐 주세요.";
  }

  return {
    reply,
    toolCalls,
    proposals,
    usage: {
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: usage.cacheReadTokens,
      costUsd: usage.costUsd || undefined,
    },
    model: usedModel,
    truncated,
    ...(attachBlock
      ? {
          attachments: (args.attachments ?? []).map((a) => ({
            name: a.name,
            chars: a.text.length,
            truncated: a.truncated,
          })),
          sentUserContent: args.messages[last].content + attachBlock,
        }
      : {}),
  };
}

/** 도구 인자를 "k=v k=v" 한 줄로 — 요약 문구를 만들 때 쓴다 */
export function argBits(a: Record<string, unknown>, skip: string[] = ["limit"]): string {
  return Object.entries(a)
    .filter(([k, v]) => v !== undefined && v !== "" && !skip.includes(k))
    .map(
      ([k, v]) =>
        `${k}=${Array.isArray(v) ? `${v.length}건` : typeof v === "object" ? JSON.stringify(v) : v}`,
    )
    .join(" ");
}
