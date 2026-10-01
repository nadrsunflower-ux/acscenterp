// ============================================================
//  AI 사업구분 — 계정은 정해졌는데 사업구분만 빈 거래
// ------------------------------------------------------------
//  AI 분류 도우미(ai-classify.ts)는 계정부터 다시 추측한다. 그래서 장부에
//  사람이 적어 둔 계정이 있는 거래에 쓰면 그 계정이 AI 의 추측으로 바뀐다.
//  여기서는 **계정을 주고 사업구분만** 묻는다.
//
//  모델에 주는 것 (2026-10 실측으로 정한 것):
//    · 품목 메모(계정소분류비고)와 비고 — 「아이디 인두용」 같은 단서는 여기 있다
//    · 그 계정의 과거 사업구분 분포 · 같은 거래처 · 같은 결제수단
//    · 메모 낱말이 겹치는 과거 거래
//
//  ── 얼마나 맞는가 (2026-07·08 사람이 붙인 156건, 답을 가리고 물어봄) ──
//    확신 80% 이상   37건(24%) 중 95% 맞음
//    확신 70~79%     22건 중 77%
//    그 아래          97건 중 62%          (찍기 기준선 64%)
//  확신 80% 이상은 급여·향료처럼 분포가 뚜렷한 계정에 몰려 있다. 쿠팡 생수
//  같은 범용 구매는 모델도 「모르겠다」 고 한다 — 무엇을 어느 매장용으로
//  샀는지가 데이터에 없기 때문이다.
//
//  ⚠️ 그래서 **확신 80% 이상만 제안으로** 올리고 나머지는 건드리지 않는다.
//     확정은 만들지 않는다.
// ============================================================

import { normVendor } from "../classify";
import type { FinPaymentMethodDoc } from "../db-types";
import { netAmount, type FinTransaction } from "../types";

/** 이 확신도 이상만 제안으로 쓴다 */
export const AI_BIZ_MIN_CONFIDENCE = 0.8;
export const AI_BIZ_BATCH = 40;

export interface BizSuggestion {
  id: string;
  bizMajor: string;
  bizMinor: string;
  /** 0~1 */
  confidence: number;
  reason: string;
}

export interface BizResult {
  suggestions: BizSuggestion[];
  /** 장부에 없는 사업구분 조합이라 버린 것 */
  rejected: { id: string; proposed: string }[];
  usage: { inputTokens: number; outputTokens: number; costUsd?: number };
  model: string;
}

const won = (n: number) => Math.round(n).toLocaleString("ko-KR");
const pathOf = (t: Pick<FinTransaction, "acctMajor" | "acctMid" | "acctMinor">) =>
  `${t.acctMajor ?? ""}>${t.acctMid ?? ""}>${t.acctMinor ?? ""}`;
const bizOf = (t: Pick<FinTransaction, "bizMajor" | "bizMinor">) => `${t.bizMajor ?? ""}·${t.bizMinor ?? ""}`;

/** 메모에서 뜻이 있는 낱말만 — 날짜·금액·카드메모 머리말은 뺀다 */
const NOISE = /^(카드메모|자동입력|반영|Sheet|뱅크|토스뱅크|신한|일반이체|카드승인내역)$/;
export function memoWords(t: Pick<FinTransaction, "acctNote" | "note">): string[] {
  const text = `${t.acctNote ?? ""} ${(t.note ?? "").replace(/\[카드메모[^\]]*\]|\d+[.,]\d+|[\d,]+원?/g, " ")}`;
  return [...new Set(text.split(/[^가-힣A-Za-z]+/).filter((w) => w.length >= 2 && !NOISE.test(w)))];
}

function dist(rows: FinTransaction[], top = 4): string {
  const count = new Map<string, number>();
  rows.forEach((r) => count.set(bizOf(r), (count.get(bizOf(r)) ?? 0) + 1));
  const sorted = [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, top);
  return sorted.length ? sorted.map(([k, n]) => `${k} ${n}건`).join(" · ") : "없음";
}

/** history 는 사업구분이 있는 확정 거래 */
export function renderBizItem(
  t: FinTransaction,
  history: FinTransaction[],
  pmOf: Map<string, FinPaymentMethodDoc>,
): string {
  const pm = t.last4 ? pmOf.get(t.last4) : undefined;
  const v = normVendor(t.vendor);
  const samePath = history.filter((x) => pathOf(x) === pathOf(t));
  const words = memoWords(t);
  const byMemo = words.length
    ? history
        .map((x) => ({ x, n: memoWords(x).filter((w) => words.includes(w)).length }))
        .filter((m) => m.n > 0)
        .sort((a, b) => b.n - a.n)
        .slice(0, 4)
    : [];
  const kind = pm ? (pm.kind === "card" ? "법인카드" : pm.kind === "cash" ? "현금" : "통장") : "";
  return [
    `- id: ${t.id}`,
    `  거래일: ${t.date} · ${t.txType} · ${won(netAmount(t))}원 · 거래처: ${t.vendor ?? "(없음)"}`,
    `  결제수단: ${pm ? `${pm.alias} (${kind} · 사업장 ${pm.site})` : (t.last4 ?? "미지정")}`,
    `  계정(확정 — 바꾸지 않는다): ${pathOf(t)}`,
    t.acctNote ? `  품목 메모: ${t.acctNote}` : "",
    t.note ? `  비고: ${t.note}` : "",
    `  [이 계정의 과거 사업구분] ${dist(samePath.slice(-60))}`,
    `  [이 계정 · 같은 거래처] ${dist(samePath.filter((x) => normVendor(x.vendor) === v).slice(-20))}`,
    `  [이 계정 · 같은 결제수단] ${dist(samePath.filter((x) => (x.last4 ?? "") === (t.last4 ?? "")).slice(-30))}`,
    byMemo.length
      ? `  [메모 낱말이 겹치는 과거 거래] ${byMemo.map((m) => `「${m.x.acctNote ?? ""}」 ${m.x.vendor ?? ""} → ${bizOf(m.x)}`).join(" / ")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

const SYSTEM = `당신은 (주)네안데르의 재무 담당자를 돕습니다. 계정은 이미 정해진 거래에 **사업구분**(어느 사업부의 돈인가)만 붙입니다.

사업구분
- B2C·와우 — 와우 매장(홍대)만의 것
- B2C·아이디 — 아이디 매장(홍대)만의 것
- B2C·홍대공용 — 와우·아이디 두 매장이 함께 쓰는 것 (매장 공용 공간·공용 소모품·매장 근무자)
- B2C·신촌 — 신촌 매장 (2025년 하반기 폐점 — 그 전 거래에만)
- B2C·온라인 — 온라인 판매(스마트스토어·자사몰)·택배
- B2C·SMOAT — AI 서비스 SMOAT (서버·AI 구독·결제수수료·학원 영업)
- B2B·조향 — 조향 용역·납품·향료 원자재 (기업 납품용)
- B2B·개발 — 외부 개발 용역
- B2B·기타 — 그 밖의 B2B 거래
- 공용·공용 — 본사·전사 공통 (사무실, 임원, 공통 SaaS, 세금, 특정 사업부에 속하지 않는 것)
- 해당없음·해당없음 — 자금거래 등 손익이 아닌 것

규칙
1. 품목 메모와 비고에 매장·사업 이름이나 용도가 드러나면 그것이 가장 강한 근거입니다 (「아이디 인두용」 → B2C·아이디).
2. 메모에 단서가 없으면 붙어 있는 과거 사업구분 분포를 보세요. 한쪽으로 뚜렷이 모여 있을 때만 confidence 0.8 이상을 주세요.
3. 가를 단서가 없으면 가장 가능성 높은 것을 내되 confidence 를 낮게 주세요. 그럴듯하게 틀리는 것이 모른다고 하는 것보다 나쁩니다.`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["suggestions"],
  properties: {
    suggestions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "bizMajor", "bizMinor", "confidence", "reason"],
        properties: {
          id: { type: "string", description: "입력으로 준 거래 id 를 그대로" },
          bizMajor: { type: "string" },
          bizMinor: { type: "string" },
          confidence: { type: "number", description: "0~1" },
          reason: { type: "string", description: "왜 이 사업구분인지 한 문장" },
        },
      },
    },
  },
} as const;

/** 실제로 모델에 보내는 글 — 무엇이 나가는지 눈으로 확인할 수 있게 */
export function buildBizPrompt(args: {
  items: FinTransaction[];
  history: FinTransaction[];
  paymentMethods: FinPaymentMethodDoc[];
}): { system: string; user: string } {
  const pmOf = new Map(args.paymentMethods.map((p) => [p.last4, p]));
  const ids = new Set(args.items.map((t) => t.id));
  const history = args.history.filter(
    (t) => t.status === "confirmed" && !!t.acctMinor && !!t.bizMajor && !!t.bizMinor && !ids.has(t.id),
  );
  return {
    system: SYSTEM,
    user:
      `아래 ${args.items.length}건에 사업구분을 붙여 주세요. id 는 그대로 돌려주세요.\n\n` +
      args.items.map((t) => renderBizItem(t, history, pmOf)).join("\n\n"),
  };
}

export async function suggestBizUnits(args: {
  items: FinTransaction[];
  history: FinTransaction[];
  paymentMethods: FinPaymentMethodDoc[];
}): Promise<BizResult> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY 가 설정되지 않았습니다.");
  const model = process.env.OPENROUTER_MODEL || "anthropic/claude-opus-5";
  const { system, user } = buildBizPrompt(args);

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      // 헤더는 latin-1 만 담을 수 있다 (ai-classify.ts 와 같은 값)
      "HTTP-Referer": "https://neander-erp.local/finance",
      "X-Title": "NEANDER ERP Finance",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }] },
        { role: "user", content: user },
      ],
      max_tokens: 16000,
      reasoning_effort: "high",
      response_format: { type: "json_schema", json_schema: { name: "finance_biz_unit", strict: true, schema: SCHEMA } },
      provider: { require_parameters: true },
    }),
  });
  const raw = (await res.json().catch(() => null)) as {
    choices?: { message?: { content?: string | null; refusal?: string | null } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
    model?: string;
    error?: { message?: string };
  } | null;
  if (!res.ok || raw?.error) throw new Error(`OpenRouter 호출이 실패했습니다: ${raw?.error?.message ?? `HTTP ${res.status}`}`);
  const content = raw?.choices?.[0]?.message?.content;
  if (!content) throw new Error("모델이 빈 응답을 돌려줬습니다.");
  let parsed: { suggestions?: unknown[] };
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("모델 응답을 JSON 으로 해석하지 못했습니다.");
  }

  // 장부에서 실제로 쓰인 사업구분 조합만 받는다 — 모델이 지어낸 이름은 버린다
  const known = new Set(
    args.history.filter((t) => t.status === "confirmed" && t.bizMajor && t.bizMinor).map(bizOf),
  );
  const wanted = new Set(args.items.map((t) => t.id));
  const suggestions: BizSuggestion[] = [];
  const rejected: BizResult["rejected"] = [];
  (Array.isArray(parsed.suggestions) ? parsed.suggestions : []).forEach((item) => {
    const s = item as Partial<BizSuggestion>;
    const id = String(s.id ?? "");
    const bizMajor = String(s.bizMajor ?? "");
    const bizMinor = String(s.bizMinor ?? "");
    if (!wanted.has(id) || !known.has(`${bizMajor}·${bizMinor}`)) {
      rejected.push({ id, proposed: `${bizMajor}·${bizMinor}` });
      return;
    }
    suggestions.push({
      id,
      bizMajor,
      bizMinor,
      confidence: Math.max(0, Math.min(1, Number(s.confidence) || 0)),
      reason: String(s.reason ?? ""),
    });
  });
  return {
    suggestions,
    rejected,
    usage: {
      inputTokens: raw?.usage?.prompt_tokens ?? 0,
      outputTokens: raw?.usage?.completion_tokens ?? 0,
      costUsd: raw?.usage?.cost,
    },
    model: raw?.model ?? model,
  };
}
