// ============================================================
//  AI 분류 도우미 — 규칙이 못 맞힌 거래를 Claude 에게 물어본다
// ------------------------------------------------------------
//  자동분류(classify.ts)는 세 가지 근거로만 판단한다: 과거 이력의 **정확한**
//  거래처 일치, 구독 키워드, 어댑터 힌트. 그래서 새 거래처가 오면 손을 든다
//  — 실측으로 5·6월 파일에서 검토필요가 36건 나왔다.
//
//  사람이 그걸 볼 때 실제로 하는 추론은 이런 것들이다:
//    · `FACEBK *KEV69QZM62` 는 `FACEBK *FXEVTN5N62` 와 같은 메타 광고다
//      (뒤의 난수만 다르다 — 정확 일치로는 절대 안 잡힌다)
//    · `한국전력공사` 는 전기요금이니 운영비 > 전기수도통신비다
//    · `카카오택시-서울34사3106` 는 교통비다
//  이건 언어 이해가 필요한 일이라 규칙으로는 한계가 있다. 그래서 여기서만
//  모델을 쓴다.
//
//  ⚠️ 원칙 두 가지
//   1) **절대 confirmed 로 만들지 않는다.** AI 결과는 `suggested` 로 들어가고
//      검토 대기함에서 사람이 승인한다. 재무에서 조용히 틀린 분류가 쌓이는
//      것이 가장 나쁘다 — 모델이 그럴싸하게 틀릴 때 특히 그렇다.
//   2) **계정 마스터에 없는 계정은 버린다.** 모델이 그럴듯한 이름을 지어내면
//      (`운영비 > 일반운영비 > SaaS비용`) 조인이 깨진다. 317개 잎 계정과
//      정확히 일치하지 않으면 채택하지 않는다.
//
//  ── 왜 OpenRouter 경유인가 ──
//  이미 OpenRouter 를 쓰고 있고 그 비용이 장부에 잡혀 있다(2026-07 툴구독비
//  646,176원 + 대납 513,975원). 키를 하나 더 만들지 않고 기존 창구를 쓰면
//  사용량이 한 곳에 모여 `OpenRouter배분` 시트처럼 프로젝트별 배분도 그대로
//  이어진다.
//
//  OpenRouter 는 OpenAI 호환 `chat/completions` 다. 그래서 Anthropic SDK 를
//  쓰지 않고 fetch 로 직접 부른다 — 엔드포인트 하나뿐이라 의존성을 더할
//  이유가 없다. 대신 Anthropic 특유의 두 가지는 그대로 챙긴다:
//    · 프롬프트 캐시  system 블록에 cache_control 을 붙인다 (계정 마스터 재사용)
//    · 추론 강도      reasoning_effort 로 넘긴다
// ============================================================

import type { FinAccountDoc } from "../db-types";
import { netAmount, type FinTransaction } from "../types";
import { normVendor } from "../classify";

/** 한 번에 물어볼 거래 수 상한 — 응답이 길어지면 품질이 떨어진다 */
export const AI_BATCH_LIMIT = 40;

export interface AiSuggestion {
  id: string;
  acctMajor: string;
  acctMid: string;
  acctMinor: string;
  bizMajor?: string;
  bizMinor?: string;
  /** 0~1 */
  confidence: number;
  reason: string;
}

export interface AiResult {
  suggestions: AiSuggestion[];
  /** 계정 마스터에 없어서 버린 것들 — 조용히 삭제하지 않고 알린다 */
  rejected: { id: string; proposed: string; reason: string }[];
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    /** OpenRouter 가 알려주는 이번 호출 비용 (USD) */
    costUsd?: number;
  };
  model: string;
}

// ---- 프롬프트 재료 --------------------------------------------

/**
 * 계정 마스터를 프롬프트에 넣을 형태로 압축한다.
 * 317줄을 그대로 쓰면 길어서, 대>중 별로 묶고 용례를 붙인다.
 */
export function renderAccounts(accounts: FinAccountDoc[]): string {
  const tree = new Map<string, Map<string, FinAccountDoc[]>>();
  accounts.forEach((a) => {
    const k1 = `${a.txType}|${a.major}`;
    if (!tree.has(k1)) tree.set(k1, new Map());
    const mids = tree.get(k1)!;
    if (!mids.has(a.mid)) mids.set(a.mid, []);
    mids.get(a.mid)!.push(a);
  });

  const lines: string[] = [];
  tree.forEach((mids, k1) => {
    const [txType, major] = k1.split("|");
    lines.push(`\n[${txType}] ${major}`);
    mids.forEach((leaves, mid) => {
      const items = leaves
        .map((a) => (a.example ? `${a.minor}(${a.example})` : a.minor))
        .join(", ");
      lines.push(`  ${mid}: ${items}`);
    });
  });
  return lines.join("\n");
}

/** 거래처 이름에서 난수·번호 꼬리를 떼어 비교용 뿌리를 만든다 */
export function vendorRoot(v: string): string {
  return normVendor(v)
    .replace(/[*#\-_]+\s*[a-z0-9]{4,}\s*$/i, "") // `FACEBK *KEV69QZM62` → `facebk`
    .replace(/\d{4,}\s*$/, "") // 뒤에 붙은 번호
    .replace(/[^가-힣a-z0-9 ]/g, " ")
    .trim();
}

/**
 * 이 거래와 비슷한 과거 확정 거래를 찾는다.
 *
 * 정확 일치는 규칙이 이미 시도했으므로, 여기서는 **부분 일치**를 본다 —
 * 그게 AI 가 값을 더하는 지점이다. 근거로 쓸 사례를 주는 것이지 답을
 * 주는 게 아니라서, 맞지 않는 사례가 섞여도 모델이 걸러낼 수 있다.
 */
export function similarPast(
  target: FinTransaction,
  history: FinTransaction[],
  limit = 4,
): FinTransaction[] {
  const root = vendorRoot(target.vendor ?? "");
  if (!root || root.length < 2) return [];
  const scored: { t: FinTransaction; score: number }[] = [];
  history.forEach((h) => {
    if (h.status !== "confirmed" || !h.acctMinor) return;
    const hr = vendorRoot(h.vendor ?? "");
    if (!hr) return;
    let score = 0;
    if (hr === root) score = 3;
    else if (hr.includes(root) || root.includes(hr)) score = 2;
    else {
      // 첫 단어가 같으면 같은 계열일 가능성 (쿠팡 / 쿠팡이츠)
      const a = root.split(" ")[0];
      const b = hr.split(" ")[0];
      if (a.length >= 2 && a === b) score = 1;
    }
    if (score > 0) scored.push({ t: h, score });
  });
  return scored
    .sort((x, y) => y.score - x.score)
    .slice(0, limit)
    .map((x) => x.t);
}

const won = (n: number) => Math.round(n).toLocaleString("ko-KR");

export function renderItems(items: FinTransaction[], history: FinTransaction[]): string {
  return items
    .map((t) => {
      const past = similarPast(t, history);
      const pastText = past.length
        ? past
            .map(
              (p) =>
                `      · ${p.vendor} → ${[p.acctMajor, p.acctMid, p.acctMinor].join(">")}` +
                `${p.bizMajor ? ` [${p.bizMajor}·${p.bizMinor ?? ""}]` : ""}`,
            )
            .join("\n")
        : "      · (비슷한 과거 거래 없음)";
      return [
        `- id: ${t.id}`,
        `  거래일: ${t.date}`,
        `  거래유형: ${t.txType}`,
        `  거래처: ${t.vendor ?? "(없음)"}`,
        `  금액: ${won(netAmount(t))}원`,
        t.last4 ? `  결제수단: ${t.last4}` : "",
        t.site ? `  사업장: ${t.site}` : "",
        t.note ? `  비고: ${t.note}` : "",
        `  비슷한 과거 확정 거래:`,
        pastText,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");
}

// ---- 스키마 --------------------------------------------------

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
        required: ["id", "acctMajor", "acctMid", "acctMinor", "confidence", "reason"],
        properties: {
          id: { type: "string", description: "입력으로 준 거래 id 를 그대로" },
          acctMajor: { type: "string", description: "계정대분류" },
          acctMid: { type: "string", description: "계정중분류" },
          acctMinor: { type: "string", description: "계정소분류" },
          bizMajor: { type: "string", description: "B2C · B2B · 공용 중 하나. 모르면 생략" },
          bizMinor: { type: "string", description: "와우·아이디·홍대공용·온라인·SMOAT·조향·개발·기타·공용. 모르면 생략" },
          confidence: {
            type: "number",
            description: "0~1. 0.5 미만이면 사람이 봐야 한다는 뜻으로 낸다",
          },
          reason: {
            type: "string",
            description: "왜 이 계정인지 한 문장. 근거가 된 과거 거래나 거래처 성격을 밝힌다",
          },
        },
      },
    },
  },
} as const;

const SYSTEM_RULES = `당신은 (주)네안데르의 재무 담당자를 돕는 분류 도우미입니다. 향수·조향 제조/소매업이며 매장(와우·아이디), 온라인, B2B 조향/개발 사업을 합니다.

주어진 거래를 아래 **계정 마스터에 실제로 존재하는 계정**으로 분류하세요.

절대 규칙
1. 계정 3단(대분류·중분류·소분류)은 아래 목록에 **글자 그대로** 있는 조합만 쓰세요. 없는 이름을 새로 만들면 그 결과는 폐기됩니다.
2. 거래유형이 「지출」이면 [지출] 계정만, 「수입」이면 [수입] 계정만 쓰세요.
3. 확실하지 않으면 confidence 를 낮게 주세요. 틀린 분류를 그럴듯하게 확정하는 것이 모르겠다고 하는 것보다 나쁩니다.
4. 「비슷한 과거 확정 거래」가 있으면 가장 강한 근거입니다. 거래처명 뒤의 난수·주문번호만 다른 경우가 많으니(예: FACEBK *A1B2 와 FACEBK *C3D4 는 같은 메타 광고) 그런 패턴을 알아보세요.
5. 사업구분(bizMajor/bizMinor)은 아는 경우에만 채우세요. 전사 공통 비용은 공용·공용입니다.

판단에 도움이 되는 맥락
- 개인 이름 거래처는 급여·프리랜서비·대납 정산일 수 있습니다. 금액이 크고 매달 반복되면 급여, 소액이면 식대·대납일 가능성이 큽니다.
- 해외 결제(FACEBK, GOOGLE, OPENAI 등)는 마케팅비 또는 구독/서비스개발비입니다.
- 공공요금(한국전력, 도시가스, KT, 상수도)은 운영비 > 전기수도통신비입니다.
- 4대보험(국민건강, 국민연금, 고용보험, 산재보험)은 인건비 > 사대보험입니다.
- 배달·음식점은 인건비 > 복리후생비 > 일반식대(직원 식대)입니다.
- 쿠팡·네이버 같은 범용 마켓플레이스는 무엇을 샀는지에 따라 달라지므로 비고를 보고, 단서가 없으면 confidence 를 낮게 주세요.`;

/**
 * 실제로 모델에 보내는 프롬프트를 그대로 만들어 돌려준다.
 * 무엇이 나가는지 눈으로 확인할 수 있어야 한다 — 재무 데이터를 모델에
 * 보내는 일이라 "대충 이런 걸 보낸다"로는 부족하다.
 */
export function buildPrompt(args: {
  items: FinTransaction[];
  history: FinTransaction[];
  accounts: FinAccountDoc[];
}): { system: string; user: string } {
  return {
    system: `${SYSTEM_RULES}\n\n== 계정 마스터 (이 안에서만 고를 것) ==\n${renderAccounts(args.accounts)}`,
    user: `아래 ${args.items.length}건을 분류해 주세요. 각 건마다 하나의 결과를 내고, id 는 그대로 돌려주세요.\n\n${renderItems(args.items, args.history)}`,
  };
}

// ---- 호출 ----------------------------------------------------

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
/** 기본 모델. 구조화 출력·프롬프트 캐시·1M 컨텍스트를 지원한다. */
const DEFAULT_MODEL = "anthropic/claude-opus-5";

interface OpenRouterResponse {
  choices?: {
    message?: { content?: string | null; refusal?: string | null };
    finish_reason?: string;
  }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    cost?: number;
    cache_discount?: number;
    prompt_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number };
  };
  model?: string;
  error?: { message?: string; code?: number | string };
}

export async function suggestClassifications(args: {
  items: FinTransaction[];
  history: FinTransaction[];
  accounts: FinAccountDoc[];
}): Promise<AiResult> {
  const { items, history } = args;
  // 은퇴 계정(active:false)은 추천 후보에서 뺀다 — 새 거래가 폐점 매장
  // 계정에 붙으면 안 된다. 프롬프트와 검증 집합이 같은 목록을 봐야 한다.
  const accounts = args.accounts.filter((a) => a.active !== false);
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENROUTER_API_KEY 가 설정되지 않았습니다. .env.local(로컬)과 Vercel 환경변수(배포)에 " +
        "OpenRouter 키를 넣어주세요. 모델을 바꾸려면 OPENROUTER_MODEL 도 함께 설정합니다 " +
        `(기본 ${DEFAULT_MODEL}).`,
    );
  }
  if (items.length === 0) return emptyResult();

  const model = process.env.OPENROUTER_MODEL || DEFAULT_MODEL;
  const { system, user } = buildPrompt({ items, history, accounts });

  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      // OpenRouter 대시보드에서 어느 앱이 쓴 건지 구분되게 (선택 헤더).
      // ⚠️ HTTP 헤더는 latin-1 만 담을 수 있다. 한글을 넣으면 fetch 가
      //    "Cannot convert argument to a ByteString" 으로 죽는다.
      "HTTP-Referer": "https://neander-erp.local/finance",
      "X-Title": "NEANDER ERP Finance",
    },
    body: JSON.stringify({
      model,
      // 계정 마스터(≈4천 토큰)는 요청마다 같다. Anthropic 모델은 캐시를
      // 명시해야 걸리므로 system 블록에 cache_control 을 붙인다.
      messages: [
        {
          role: "system",
          content: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
        },
        { role: "user", content: user },
      ],
      max_tokens: 16000,
      reasoning_effort: "high",
      response_format: {
        type: "json_schema",
        json_schema: { name: "finance_classification", strict: true, schema: SCHEMA },
      },
      // 구조화 출력을 지원하지 않는 제공자로 새지 않게 한다 —
      // 그런 곳으로 가면 스키마가 무시되고 파싱이 깨진다.
      provider: { require_parameters: true },
    }),
  });

  const raw = (await res.json().catch(() => null)) as OpenRouterResponse | null;
  if (!res.ok || raw?.error) {
    const msg = raw?.error?.message ?? `HTTP ${res.status}`;
    throw new Error(`OpenRouter 호출이 실패했습니다: ${msg}`);
  }

  const choice = raw?.choices?.[0];
  if (choice?.message?.refusal) {
    throw new Error(`모델이 응답을 거부했습니다: ${choice.message.refusal}`);
  }
  const content = choice?.message?.content;
  if (!content) {
    throw new Error("모델이 빈 응답을 돌려줬습니다. 잠시 후 다시 시도해주세요.");
  }

  let parsed: { suggestions?: unknown[] };
  try {
    parsed = JSON.parse(content);
  } catch {
    // 파싱 실패를 성공으로 위장하지 않는다
    throw new Error("모델 응답을 JSON 으로 해석하지 못했습니다. 잠시 후 다시 시도해주세요.");
  }

  const u = raw?.usage ?? {};
  const usage = {
    inputTokens: u.prompt_tokens ?? 0,
    outputTokens: u.completion_tokens ?? 0,
    cacheReadTokens: u.prompt_tokens_details?.cached_tokens ?? 0,
    cacheWriteTokens: u.prompt_tokens_details?.cache_write_tokens ?? 0,
    costUsd: u.cost,
  };

  // 계정 마스터 대조 — 없는 계정은 채택하지 않는다
  const valid = new Set(accounts.map((a) => `${a.txType}|${a.major}|${a.mid}|${a.minor}`));
  const byId = new Map(items.map((t) => [t.id, t]));
  const suggestions: AiSuggestion[] = [];
  const rejected: AiResult["rejected"] = [];

  (Array.isArray(parsed.suggestions) ? parsed.suggestions : []).forEach((rawItem) => {
    const s = rawItem as Partial<AiSuggestion>;
    const id = String(s.id ?? "");
    const acctMajor = String(s.acctMajor ?? "");
    const acctMid = String(s.acctMid ?? "");
    const acctMinor = String(s.acctMinor ?? "");
    const path = `${acctMajor}>${acctMid}>${acctMinor}`;
    const t = byId.get(id);
    if (!t) {
      rejected.push({ id, proposed: path, reason: "요청에 없던 id" });
      return;
    }
    if (!valid.has(`${t.txType}|${acctMajor}|${acctMid}|${acctMinor}`)) {
      rejected.push({ id, proposed: path, reason: `계정 마스터에 없는 조합 (${t.txType})` });
      return;
    }
    suggestions.push({
      id,
      acctMajor,
      acctMid,
      acctMinor,
      bizMajor: s.bizMajor ? String(s.bizMajor) : undefined,
      bizMinor: s.bizMinor ? String(s.bizMinor) : undefined,
      confidence: Math.max(0, Math.min(1, Number(s.confidence) || 0)),
      reason: String(s.reason ?? ""),
    });
  });

  return { suggestions, rejected, usage, model: raw?.model ?? model };
}

function emptyResult(): AiResult {
  return {
    suggestions: [],
    rejected: [],
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    model: "",
  };
}
