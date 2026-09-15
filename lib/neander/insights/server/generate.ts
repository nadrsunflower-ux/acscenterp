// ============================================================
//  월간 인사이트 — 신호 목록으로 해설(요약·할 일·확인할 것) 만들기
// ------------------------------------------------------------
//  AI 에는 신호(insights/types.ts Signal)만 준다. 원 데이터는 주지 않는다 —
//  신호에 없는 숫자를 지어낼 재료 자체가 없게 한다.
//
//  AI 답은 그대로 믿지 않는다 (sanitizeNarrative):
//    · 근거 신호 id 가 입력에 없는 것은 떼고, 근거가 하나도 안 남은 문장은 버린다
//    · 길이·개수를 자르고 id 는 서버가 다시 매긴다 (s1·a1·r1 …)
//
//  AI 를 못 쓰면(키 없음·HTTP 실패·JSON 못 읽음·쓸 문장 0개) 규칙으로 초안을
//  만든다 (buildFallbackNarrative, fallback: true). 이 함수는 AI 때문에 던지지 않는다 —
//  「만들기」 버튼이 실패로 끝나는 것보다 규칙 초안이라도 남는 편이 낫다.
// ============================================================
import "server-only";

import { INSIGHT_AI_MODEL, isFinAiModelId } from "@/lib/neander/ai/models";
import { shortWon } from "@/lib/neander/format";
import {
  sortSignals,
  type InsightDoc,
  type InsightItem,
  type InsightModule,
  type Signal,
} from "@/lib/neander/insights/types";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

export type InsightNarrative = Pick<
  InsightDoc,
  "summary" | "actions" | "risks" | "comments" | "model" | "costUsd" | "fallback"
>;

export const NARRATIVE_LIMITS = {
  text: 300,
  detail: 300,
  impact: 40,
  comment: 60,
  summary: 3,
  actions: 3,
  risks: 4,
  comments: 20,
} as const;

/** 신뢰도 주제 — 규칙 초안에서 「확인할 것」으로 보낸다 */
const RELIABILITY_TOPIC = /data-reliability|reliability|data-quality|unclassified|missing/i;

const clip = (s: unknown, max: number): string =>
  typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, max) : "";

/** 월 영향(원) → 「월 +80만원」 */
export const impactLabel = (n: number | undefined): string | undefined =>
  typeof n === "number" && Number.isFinite(n) && n !== 0
    ? `월 ${n > 0 ? "+" : "-"}${shortWon(Math.abs(n))}원`
    : undefined;

/** 값이 undefined 인 칸을 뺀 문장 — Firestore 가 undefined 를 거부한다 */
function item(id: string, text: string, signalIds: string[], detail?: string, impact?: string): InsightItem {
  return {
    id,
    text,
    signalIds,
    ...(detail ? { detail } : {}),
    ...(impact ? { impact } : {}),
  };
}

// ── 규칙 초안 ────────────────────────────────────────────────

export function buildFallbackNarrative(signals: Signal[]): InsightNarrative {
  const sorted = sortSignals(signals);

  const summary = sorted
    .slice(0, NARRATIVE_LIMITS.summary)
    .map((s, i) =>
      item(`s${i + 1}`, clip(s.title, NARRATIVE_LIMITS.text), [s.id], clip(s.detail, NARRATIVE_LIMITS.detail), impactLabel(s.impact)),
    )
    .filter((it) => it.text);

  const actions = sorted
    .filter((s) => typeof s.impact === "number" && s.impact !== 0)
    .sort((a, b) => Math.abs(b.impact ?? 0) - Math.abs(a.impact ?? 0))
    .slice(0, NARRATIVE_LIMITS.actions)
    .map((s, i) =>
      item(`a${i + 1}`, clip(`「${s.title}」 — 원인 확인 후 조치`, NARRATIVE_LIMITS.text), [s.id], undefined, impactLabel(s.impact)),
    );

  const reliability = sorted.filter((s) => RELIABILITY_TOPIC.test(s.topic));
  const riskSource = reliability.length > 0 ? reliability : sorted.filter((s) => s.severity === "low");
  const risks = riskSource
    .slice(0, NARRATIVE_LIMITS.risks)
    .map((s, i) => item(`r${i + 1}`, clip(s.title, NARRATIVE_LIMITS.text), [s.id], clip(s.detail, NARRATIVE_LIMITS.detail)))
    .filter((it) => it.text);

  const comments: Record<string, string> = {};
  for (const s of sorted) {
    if (!s.chapter || comments[s.chapter] !== undefined) continue;
    if (Object.keys(comments).length >= NARRATIVE_LIMITS.comments) break;
    const line = clip(s.title, NARRATIVE_LIMITS.comment);
    if (line) comments[s.chapter] = line;
  }

  return { summary, actions, risks, comments, fallback: true };
}

// ── AI 답 검사 ───────────────────────────────────────────────

function sanitizeItems(raw: unknown, prefix: string, max: number, known: Set<string>): InsightItem[] {
  if (!Array.isArray(raw)) return [];
  const out: InsightItem[] = [];
  for (const r of raw) {
    if (out.length >= max) break;
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const text = clip(o.text, NARRATIVE_LIMITS.text);
    if (!text) continue;
    const ids = Array.isArray(o.signalIds) ? o.signalIds : [];
    const signalIds = [...new Set(ids.filter((id): id is string => typeof id === "string" && known.has(id)))];
    if (signalIds.length === 0) continue;
    out.push(
      item(
        `${prefix}${out.length + 1}`,
        text,
        signalIds,
        clip(o.detail, NARRATIVE_LIMITS.detail) || undefined,
        clip(o.impact, NARRATIVE_LIMITS.impact) || undefined,
      ),
    );
  }
  return out;
}

/**
 * 모델이 돌려준 JSON(이미 파싱한 값)을 검사한다.
 * 쓸 문장이 하나도 없으면 null — 부르는 쪽이 규칙 초안으로 간다.
 */
export function sanitizeNarrative(
  raw: unknown,
  signals: Signal[],
): Pick<InsightDoc, "summary" | "actions" | "risks" | "comments"> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const known = new Set(signals.map((s) => s.id));
  const chapters = new Set(signals.map((s) => s.chapter).filter((c): c is string => !!c));

  const summary = sanitizeItems(o.summary, "s", NARRATIVE_LIMITS.summary, known);
  const actions = sanitizeItems(o.actions, "a", NARRATIVE_LIMITS.actions, known);
  const risks = sanitizeItems(o.risks, "r", NARRATIVE_LIMITS.risks, known);

  const comments: Record<string, string> = {};
  if (o.comments && typeof o.comments === "object" && !Array.isArray(o.comments)) {
    for (const [k, v] of Object.entries(o.comments as Record<string, unknown>)) {
      if (Object.keys(comments).length >= NARRATIVE_LIMITS.comments) break;
      // 신호에 없는 장 이름은 붙일 슬라이드가 없다
      if (!chapters.has(k)) continue;
      const line = clip(v, NARRATIVE_LIMITS.comment);
      if (line) comments[k] = line;
    }
  }

  if (summary.length + actions.length + risks.length === 0) return null;
  return { summary, actions, risks, comments };
}

/** 모델 답 문자열에서 JSON 객체를 꺼낸다 — ```json 울타리나 앞뒤 말이 붙어 와도 */
export function parseJsonObject(content: string): unknown {
  const text = content.trim();
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

// ── 프롬프트 ─────────────────────────────────────────────────

function systemPrompt(module: InsightModule, month: string): string {
  const role =
    module === "sales"
      ? "당신은 향수 공방 매장 「악센트 홍대」의 매장 운영 컨설턴트입니다. 사장에게 월간 매출 보고의 해설을 씁니다."
      : "당신은 회사(NEANDER · 악센트)의 재무 담당입니다. 대표에게 월간 재무 보고의 해설을 씁니다.";
  return `${role}
대상 달: ${month}

입력은 코드가 데이터에서 뽑은 신호(signals) JSON 배열입니다. 각 신호는 id · topic · severity · title · detail · impact(월 영향, 원) · metrics · chapter 를 가집니다.

규칙:
1. 숫자는 신호에 있는 숫자만 씁니다. 계산해서 새 숫자를 만들거나 추정하지 않습니다.
2. 모든 문장은 근거 신호 id 를 signalIds 에 1개 이상 답니다. 입력에 없는 id 는 쓰지 않습니다.
3. summary — 돈에 가장 크게 걸린 사실 3개. 신호끼리 원인·결과로 이어지는 근거가 있으면 한 문장으로 연결합니다 (그때 signalIds 에 둘 다).
4. actions — 다음 달에 할 구체적인 일 3개. 누가 무엇을 하는지 적습니다. impact 는 근거 신호의 impact 에서 나온 경우에만 「월 +80만원」 꼴로 쓰고, 아니면 비웁니다.
5. risks — 데이터 신뢰도 문제나 사람이 확인해야 할 것. 4개 이하.
6. comments — 신호에 나온 chapter 마다 한 줄(60자 이하). 키는 chapter 문자열을 그대로 씁니다.
7. 짧고 구체적으로. 뻔한 조언(「마케팅 강화」「비용 절감 노력」 등)은 신호에 직접 연결될 때만 씁니다. 수식어·인사말 없이.
8. text 는 한 문장(300자 이하), detail 은 부연 한두 문장(선택).

출력은 아래 모양의 JSON 객체 하나만. 설명·코드 울타리 없이.
{
  "summary": [{ "text": "...", "detail": "...", "impact": "월 -120만원", "signalIds": ["topic:대상"] }],
  "actions": [{ "text": "...", "detail": "...", "impact": "...", "signalIds": ["..."] }],
  "risks":   [{ "text": "...", "detail": "...", "signalIds": ["..."] }],
  "comments": { "장 이름": "한 줄" }
}`;
}

/** AI 에 넘길 신호 — 링크(href)·module 은 판단에 필요 없어 뺀다 */
const signalPayload = (signals: Signal[]) =>
  signals.map((s) => ({
    id: s.id,
    topic: s.topic,
    severity: s.severity,
    title: s.title,
    detail: s.detail,
    ...(s.impact !== undefined ? { impact: s.impact } : {}),
    metrics: s.metrics,
    ...(s.chapter ? { chapter: s.chapter } : {}),
  }));

// ── 본체 ─────────────────────────────────────────────────────

export async function generateInsightNarrative(args: {
  module: InsightModule;
  month: string;
  signals: Signal[];
  model?: string;
}): Promise<InsightNarrative> {
  const signals = sortSignals(args.signals);
  if (signals.length === 0) {
    return { summary: [], actions: [], risks: [], comments: {}, fallback: true };
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.error("[insights/generate] OPENROUTER_API_KEY 가 없어 규칙 초안으로 만듭니다.");
    return buildFallbackNarrative(signals);
  }
  const model = isFinAiModelId(args.model) ? args.model : INSIGHT_AI_MODEL;

  try {
    const res = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        // HTTP 헤더는 latin-1 만 담을 수 있다 — 한글 금지
        "HTTP-Referer": `https://neander-erp.local/${args.module}`,
        "X-Title": "NEANDER ERP Monthly Insight",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt(args.module, args.month) },
          { role: "user", content: `signals:\n${JSON.stringify(signalPayload(signals))}` },
        ],
        response_format: { type: "json_object" },
        max_tokens: 4000,
      }),
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = (await res.json().catch(() => null)) as any;
    if (!res.ok || raw?.error) {
      throw new Error(`OpenRouter 호출이 실패했습니다: ${raw?.error?.message ?? `HTTP ${res.status}`}`);
    }
    const costUsd = typeof raw?.usage?.cost === "number" && raw.usage.cost > 0 ? raw.usage.cost : undefined;
    const usedModel = typeof raw?.model === "string" ? raw.model : model;
    const content = raw?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) throw new Error("모델이 빈 응답을 돌려줬습니다.");

    const clean = sanitizeNarrative(parseJsonObject(content), signals);
    if (!clean) throw new Error("모델 답에서 근거가 붙은 문장을 하나도 찾지 못했습니다.");

    return {
      ...clean,
      model: usedModel,
      ...(costUsd !== undefined ? { costUsd } : {}),
    };
  } catch (e) {
    console.error("[insights/generate] AI 해설 실패 — 규칙 초안으로 만듭니다.", e);
    return buildFallbackNarrative(signals);
  }
}
