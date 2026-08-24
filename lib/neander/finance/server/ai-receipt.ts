import "server-only";

// ============================================================
//  결제 캡처 읽기 — 스크린샷에서 가맹점·금액·날짜를 뽑는다
// ------------------------------------------------------------
//  지금까지는 결제할 때마다 단톡방에 캡처를 올리고 네 줄을 손으로 쳤다.
//  그런데 그 네 줄은 **이미 캡처 안에 다 있다.** 사람이 옮겨 적을 이유가
//  없다.
//
//  값싼 비전 모델에 캡처를 넘겨 구조화된 값으로 받는다. Flash-lite 기준
//  한 장에 0.3원 정도라 사실상 공짜다 (opus 로 하면 100배가 넘는다 —
//  이 일에는 과한 모델이다).
//
//  ⚠️ 읽은 값을 **바로 저장하지 않는다.** 화면에 채워 주기만 하고 사람이
//     확인한 뒤 저장한다. 금액을 잘못 읽으면 장부가 조용히 틀어지는데,
//     그건 아무것도 안 채워 주는 것보다 나쁘다. 그래서 모델에게 확신도와
//     "못 읽은 것"을 함께 말하게 하고, 화면이 그걸 드러낸다.
//
//  ⚠️ 캡처가 외부 모델로 나간다. 주문 내역과 카드 뒷자리가 담겨 있다.
//     재무 분류·채팅이 이미 OpenRouter 를 거치므로 새로 생기는 경로는
//     아니지만, 사진은 저장하지 않고 읽는 즉시 버린다.
// ============================================================

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
/** 비전 + 구조화 출력이 되면서 가장 싼 축 (입력 $0.10/M) */
const DEFAULT_MODEL = "google/gemini-2.5-flash-lite";
/** 캡처 한 장이면 충분하다 — 여러 장이 오면 앞에서부터 */
export const MAX_IMAGES = 3;

import type { ReceiptRead } from "../card-memo";

export type { ReceiptRead };
/** 모델 정보까지 붙인 결과 */
export type ReceiptResult = ReceiptRead;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    vendor: { type: ["string", "null"], description: "가맹점/판매처 이름. 화면에 보이는 그대로." },
    amount: {
      type: ["number", "null"],
      description:
        "최종 결제 금액(원, 정수). 「총 결제금액」·「결제금액」을 쓴다. 상품금액이나 배송비 각각이 아니다. 할인 후 실제 빠져나간 금액.",
    },
    date: {
      type: ["string", "null"],
      description: "결제일 YYYY-MM-DD. 화면에 연도가 없으면 null. 추측하지 말 것.",
    },
    items: { type: ["string", "null"], description: "무엇을 샀는지 한 줄. 40자 이내. 옵션·수량은 빼고 핵심만. 상품이 1개면 「외 N건」을 붙이지 않는다." },
    last4: { type: ["string", "null"], description: "결제 카드 뒷 4자리 숫자만. 안 보이면 null." },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    uncertain: { type: ["string", "null"], description: "못 읽었거나 헷갈린 것을 한국어 한 줄로. 없으면 null." },
  },
  required: ["vendor", "amount", "date", "items", "last4", "confidence", "uncertain"],
} as const;

const SYSTEM = `당신은 한국 결제/주문 화면 캡처에서 장부에 적을 값을 뽑아내는 도구입니다.

캡처는 쿠팡·네이버·배달앱의 「주문 완료」, 카드사 「결제 완료」 알림, 영수증 등입니다.

규칙
- **금액은 최종 결제 금액**입니다. 「총 결제금액」·「결제금액」을 쓰세요. 상품금액과 배송비가 따로 적혀 있으면 그 둘이 아니라 합계를 씁니다. 할인·적립이 있으면 실제로 빠져나간 금액입니다.
- **연도가 화면에 없으면 date 를 null 로 두세요.** 올해라고 짐작하지 마세요. 「8.24」 처럼 월·일만 있으면 null 입니다.
- 가맹점은 화면 표기 그대로 씁니다 (「쿠팡(주)」 를 「쿠팡」 으로 고치지 마세요).
- items 는 무엇을 샀는지 짧게. 상품이 **2개 이상일 때만** 대표 하나에 「 외 N건」 을 붙입니다(1개면 붙이지 않습니다).
- 카드 뒷 4자리가 보이면 숫자 4개만 씁니다. 마스킹(****)뿐이면 null 입니다.
- **읽히지 않으면 지어내지 말고 null 을 쓰고 uncertain 에 적으세요.** 사람이 확인해서 고칠 것이므로, 빈 칸이 틀린 값보다 낫습니다.
- confidence 는 금액과 가맹점을 둘 다 또렷하게 읽었을 때만 high 입니다.`;

export async function readReceipt(args: {
  /** 이미지 데이터 URL (data:image/...;base64,...) */
  images: string[];
  /** 등록된 카드 뒷 4자리 — 화면에서 읽은 값을 맞춰 보게 한다 */
  knownLast4?: string[];
}): Promise<ReceiptResult> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENROUTER_API_KEY 가 설정되지 않았습니다. 사진 읽기 없이 직접 입력할 수 있습니다.",
    );
  }
  const model = process.env.OPENROUTER_VISION_MODEL || DEFAULT_MODEL;
  const images = args.images.slice(0, MAX_IMAGES);
  if (images.length === 0) throw new Error("이미지가 없습니다.");

  const hint = args.knownLast4?.length
    ? `\n\n등록된 카드 뒷 4자리: ${args.knownLast4.join(", ")}. 화면에서 읽은 번호가 이 중 하나와 같으면 그 값을 쓰고, 아니면 읽은 그대로 쓰세요.`
    : "";

  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      // HTTP 헤더는 latin-1 만 담을 수 있다 — 한글 금지
      "HTTP-Referer": "https://neander-erp.vercel.app/neander/finance/card",
      "X-Title": "NEANDER ERP Card Memo",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: SYSTEM + hint },
        {
          role: "user",
          content: [
            { type: "text", text: "이 결제 캡처에서 장부에 적을 값을 뽑아 주세요." },
            ...images.map((url) => ({ type: "image_url", image_url: { url } })),
          ],
        },
      ],
      max_tokens: 600,
      // 스키마를 못 지키는 제공자로 라우팅되면 파싱이 깨진다
      provider: { require_parameters: true },
      response_format: {
        type: "json_schema",
        json_schema: { name: "receipt", strict: true, schema: SCHEMA },
      },
    }),
  });

  const raw = (await res.json().catch(() => null)) as any;
  if (!res.ok || raw?.error) {
    throw new Error(`캡처를 읽지 못했습니다: ${raw?.error?.message ?? `HTTP ${res.status}`}`);
  }
  const text = raw?.choices?.[0]?.message?.content;
  if (typeof text !== "string") throw new Error("모델이 빈 응답을 돌려줬습니다.");

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("모델 응답을 JSON 으로 읽지 못했습니다.");
  }

  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  const num = (v: unknown) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) && n !== 0 ? Math.abs(n) : undefined;
  };
  const date = str(parsed.date);

  return {
    vendor: str(parsed.vendor),
    amount: num(parsed.amount),
    // 형식이 어긋나면 버린다 — 화면의 날짜 칸을 망가뜨리지 않게
    date: date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined,
    items: str(parsed.items),
    last4: (str(parsed.last4) ?? "").replace(/\D/g, "").slice(-4) || undefined,
    confidence:
      parsed.confidence === "high" || parsed.confidence === "medium" ? parsed.confidence : "low",
    uncertain: str(parsed.uncertain),
    model: raw?.model ?? model,
    costUsd: typeof raw?.usage?.cost === "number" ? raw.usage.cost : undefined,
  };
}
