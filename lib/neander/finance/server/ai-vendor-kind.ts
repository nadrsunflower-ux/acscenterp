// ============================================================
//  업종 붙이기 (서버 전용) — 가맹점 이름을 모델에게 보여 업종을 받는다
// ------------------------------------------------------------
//  모델이 하는 일은 「이 이름은 무슨 가게인가」 하나다 (finance/vendor-kind.ts).
//  계정 · 금액 · 누가 썼는지는 주지 않는다 — 가게 이름만 간다.
//
//  싼 모델로 충분하다. 2026-10 에 가맹점 1,105곳을 한 번에 붙였을 때 $0.13 이었다.
//  달마다 새로 생기는 가맹점은 수십 곳이라 한 달에 몇 원이다.
// ============================================================

import { DEFAULT_FIN_AI_MODEL } from "@/lib/neander/ai/models";
import { VENDOR_KINDS, vendorKindKey } from "../vendor-kind";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
/** 한 번에 묻는 이름 수 */
const BATCH = 60;
/** 한 요청이 받는 이름 수의 상한 (한 달치 명세서의 새 가맹점은 많아야 백여 곳이다) */
export const VENDOR_KIND_MAX_NAMES = 2000;

const SYSTEM = `한국 법인카드 명세서에 찍힌 가맹점 이름을 보고 업종을 고릅니다. 이름만 보고 판단합니다.
- 식당 이름은 업종을 드러내지 않는 경우가 많습니다 (예: 「만게츠」「연길반점」「대박」「정정」). 고유한 가게 이름처럼 보이고 다른 업종의 단서가 없으면 음식점으로 봅니다.
- 결제대행사(KCP·이니시스·네이버파이낸셜·카카오페이·토스페이먼츠 등)와 쇼핑몰은 「온라인쇼핑·결제대행」.
- 해외 SaaS·AI 서비스(영문 이름, *가 붙은 이름)는 「소프트웨어·온라인구독」, FACEBK·GOOGLE ADS 는 「온라인광고」.
- 정말 짐작이 안 되면 「모름」.
업종 목록: ${VENDOR_KINDS.join(", ")}`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["items"],
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["n", "kind"],
        properties: { n: { type: "integer" }, kind: { type: "string", enum: [...VENDOR_KINDS] } },
      },
    },
  },
};

export interface VendorKindResult {
  /** 가맹점 열쇠(vendorKindKey) → 업종 */
  kinds: Record<string, string>;
  costUsd: number;
  model: string;
}

/** 이름은 한 줄로, 짧게 — 명세서의 가맹점명에 줄바꿈이 든 경우가 있다 */
const clean = (name: string) => name.replace(/[\r\n]+/g, " ").trim().slice(0, 80);

async function askBatch(names: string[], apiKey: string, model: string): Promise<{ kinds: (string | undefined)[]; cost: number }> {
  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      // HTTP 헤더는 latin-1 만 담을 수 있다 — 한글 금지
      "HTTP-Referer": "https://neander-erp.local/finance",
      "X-Title": "NEANDER ERP Vendor Kind",
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      usage: { include: true },
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: names.map((name, i) => `${i + 1}. ${clean(name)}`).join("\n") },
      ],
      response_format: { type: "json_schema", json_schema: { name: "vendor_kinds", strict: true, schema: SCHEMA } },
    }),
    cache: "no-store",
  });
  const body = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: { cost?: number };
    error?: { message?: string };
  };
  if (!res.ok) throw new Error(`업종을 묻지 못했습니다 — ${body.error?.message ?? `HTTP ${res.status}`}`);
  const known = new Set<string>(VENDOR_KINDS);
  const kinds: (string | undefined)[] = names.map(() => undefined);
  try {
    const parsed = JSON.parse(body.choices?.[0]?.message?.content ?? "{}") as { items?: { n?: number; kind?: string }[] };
    (parsed.items ?? []).forEach((it) => {
      const i = (it.n ?? 0) - 1;
      // 목록에 없는 말을 지어내면 버린다
      if (i >= 0 && i < names.length && it.kind && known.has(it.kind)) kinds[i] = it.kind;
    });
  } catch {
    // 답이 깨졌으면 이 묶음은 업종 없이 간다 — 다음에 다시 묻는다
  }
  return { kinds, cost: body.usage?.cost ?? 0 };
}

/**
 * 가맹점 이름들 → 업종. 답을 못 받은 이름은 결과에 없다 (다음 적재 때 다시 묻는다).
 * 같은 이름은 한 번만 묻는다.
 */
export async function labelVendorKinds(names: string[]): Promise<VendorKindResult> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY 가 설정되지 않았습니다.");
  const model = DEFAULT_FIN_AI_MODEL;
  const unique = new Map<string, string>();
  names.forEach((n) => {
    const key = vendorKindKey(n);
    if (key && !unique.has(key)) unique.set(key, n);
  });
  const list = [...unique.entries()].slice(0, VENDOR_KIND_MAX_NAMES);
  const kinds: Record<string, string> = {};
  let costUsd = 0;
  for (let i = 0; i < list.length; i += BATCH) {
    const chunk = list.slice(i, i + BATCH);
    const { kinds: got, cost } = await askBatch(chunk.map(([, name]) => name), apiKey, model);
    costUsd += cost;
    chunk.forEach(([key], k) => {
      if (got[k]) kinds[key] = got[k] as string;
    });
  }
  return { kinds, costUsd, model };
}
