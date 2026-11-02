import "server-only";

// ============================================================
//  바이럴 형식 정찰 AI — OpenRouter (ERP 의 OPENROUTER_API_KEY)
// ------------------------------------------------------------
//  영상 보기: chat/completions 의 video_url 콘텐츠. Google Gemini(AI Studio)는
//  공개 YouTube 주소를 그대로 받아 화면 · 소리 · 자막을 본다 (2026-10-31 문서 ·
//  실호출 확인: 19초 영상 한 편 구조화 분석 $0.0069 · 14초). YouTube 밖 주소는 보내지 않는다.
//
//  쇼츠 대본 AI(ai.ts)와 달리 여기서는 영상을 「실제로 본다」. 그래도 결과는 AI 의
//  관찰 · 가설이라 화면에 출처 「AI」 로 보인다.
// ============================================================

import { DEFAULT_FIN_AI_MODEL, isFinAiModelId } from "@/lib/neander/ai/models";
import type { HitAnalysis, ScoutReportDoc } from "../scout";
import type { Fetcher } from "./platforms";

const OR = "https://openrouter.ai/api/v1";
// HTTP 헤더는 latin-1 만 — 한글 금지
const HEADERS = { "HTTP-Referer": "https://neander-erp.vercel.app/neander/shorts/scout", "X-Title": "NEANDER ERP Shorts Scout" };

let fetcher: Fetcher = (...a) => fetch(...a);
export const setScoutAiFetch = (f: Fetcher | null) => {
  fetcher = f ?? ((...a) => fetch(...a));
};

/** 영상을 볼 수 있는 모델 (OpenRouter 모델 목록의 input_modalities 에 video) */
export const SCOUT_VIDEO_MODELS = [
  { id: "google/gemini-3.7-flash", label: "Gemini 3.7 Flash (기본)" },
  { id: "google/gemini-3.8-flash", label: "Gemini 3.8 Flash" },
] as const;
export const DEFAULT_SCOUT_VIDEO_MODEL = SCOUT_VIDEO_MODELS[0].id;
const videoModel = (m: unknown) => (SCOUT_VIDEO_MODELS.some((x) => x.id === m) ? (m as string) : DEFAULT_SCOUT_VIDEO_MODEL);

function apiKey(): string {
  const k = process.env.OPENROUTER_API_KEY?.trim();
  if (!k) throw new Error("OPENROUTER_API_KEY 가 없어 AI 기능을 쓸 수 없습니다.");
  return k;
}

type Completion = {
  error?: { message?: string };
  choices?: { message?: { content?: string }; finish_reason?: string }[];
  usage?: { cost?: number };
};

async function complete(body: object, timeoutMs: number): Promise<{ content: string; finish: string; costUsd: number }> {
  let res: Response;
  try {
    res = await fetcher(`${OR}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey()}`, "Content-Type": "application/json", ...HEADERS },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new Error("AI 응답을 받지 못했습니다. 비용이 청구됐을 수 있으니 OpenRouter 사용 내역을 확인한 뒤 다시 시도해 주세요.");
  }
  const raw = (await res.json().catch(() => null)) as Completion | null;
  if (!res.ok || raw?.error) throw new Error(`AI 호출이 실패했습니다: ${String(raw?.error?.message ?? `HTTP ${res.status}`).slice(0, 200)}`);
  const content = raw?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) throw new Error("AI 가 빈 응답을 돌려줬습니다.");
  const cost = raw?.usage?.cost;
  return { content, finish: raw?.choices?.[0]?.finish_reason ?? "", costUsd: typeof cost === "number" && cost > 0 ? cost : 0 };
}

const S = { type: "string" };
const nNum = { type: ["number", "null"] };
const ANALYSIS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "formatName", "summary", "hook", "structure", "editing", "sound", "textOverlay", "whyItWorks",
    "languageDependence", "aiFeasibility", "risks", "riskNote", "brandIdeas", "koreanQueries", "totalSec", "cutCount", "match",
  ],
  properties: {
    formatName: S,
    summary: S,
    hook: S,
    structure: { type: "array", items: S },
    editing: S,
    sound: S,
    textOverlay: S,
    whyItWorks: S,
    languageDependence: { type: "string", enum: ["visual", "mixed", "verbal"] },
    aiFeasibility: {
      type: "object",
      additionalProperties: false,
      required: ["level", "easyParts", "hardParts"],
      properties: { level: { type: "string", enum: ["easy", "possible", "hard"] }, easyParts: S, hardParts: S },
    },
    risks: { type: "array", items: { type: "string", enum: ["music", "real_person", "danger", "claims", "other"] } },
    riskNote: S,
    brandIdeas: { type: "array", items: S },
    koreanQueries: { type: "array", items: S },
    totalSec: nNum,
    cutCount: nNum,
    match: {
      type: "object",
      additionalProperties: false,
      required: ["formatId", "reason"],
      properties: { formatId: { type: ["string", "null"] }, reason: S },
    },
  },
};

const ANALYZE_SYSTEM = `너는 한국의 숏폼 영상 기획사에서 국내외 바이럴 영상을 분석하는 사람이다. 이 회사는 실제 촬영 없이 AI 영상 생성만으로 브랜드 홍보 영상을 만든다. 영상을 직접 보고(화면 · 소리 · 자막) 한국어로 정리한다.

원칙:
- 소재(무엇을 다뤘나)가 아니라 형식(어떻게 만들었나)을 뽑는다. 다른 제품 · 주제에 그대로 옮겨 쓸 수 있는 틀이어야 한다.
- formatName 은 12자 안팎의 짧은 이름이다 (예: 「거대 제품 도심 등장」 「유리 과일 자르기 ASMR」).
- 보이고 들리는 것(관찰)과 왜 먹혔는지(가설)를 섞지 않는다. whyItWorks 만 가설이다.
- hook 은 첫 2초에 보이고 들리는 것을 구체적으로 쓴다.
- structure 는 3~6단계 흐름이다.
- languageDependence: 말을 몰라도 먹히면 visual, 말 · 자막이 핵심이면 verbal, 섞이면 mixed.
- aiFeasibility: 지금의 AI 영상 생성(Veo · Kling · Seedance 급)으로 이 형식을 재현하기 쉬운가. AI 는 초현실 장면 · 카메라 움직임 · 동물 · 변신 · 질감에 강하고, 손으로 작은 물건 다루기 · 글자 · 라벨 · 정확한 제품 기능 시연 · 여러 컷에서 같은 얼굴 유지에 약하다.
- risks: 유행 음원을 쓰면 music, 실존 인물이나 그 인물의 밈에 기대면 real_person, 따라 하면 다칠 수 있으면 danger, 효능 · 과장 표현이 핵심이면 claims. 해당 없으면 빈 배열.
- brandIdeas: 이 형식을 제품 홍보에 쓰는 아이디어 2~3개. 특정 브랜드 이름은 쓰지 않는다.
- koreanQueries: 한국 유튜브에서 이 형식이 이미 있는지 찾아볼 짧은 한국어 검색어 2~3개.
- match: 아래 「기존 형식 카드」 중 만드는 방식이 같은 것이 있으면 그 id, 없으면 null. 주제만 같고 만드는 방식이 다르면 다른 형식이다.
- totalSec · cutCount 는 영상에서 센 값이다. 모르면 null.
- 영상을 볼 수 없었다면 추측하지 말고 summary 를 「영상을 보지 못함」 으로 쓰고 나머지는 비운다.`;

export async function analyzeVideo(input: {
  model?: unknown;
  url: string;
  title: string;
  channel: string;
  country: string;
  views: number | null;
  multiple: number | null;
  formats: { id: string; name: string; summary: string }[];
}): Promise<{ analysis: Omit<HitAnalysis, "model" | "costUsd" | "at" | "by">; costUsd: number; model: string }> {
  if (!/^https:\/\/www\.youtube\.com\/watch\?v=[\w-]{11}$/.test(input.url)) throw new Error("AI 가 직접 볼 수 있는 것은 YouTube 영상뿐입니다.");
  const model = videoModel(input.model);
  const known = input.formats.length
    ? input.formats.slice(0, 80).map((f) => `- ${f.id}: ${f.name}${f.summary ? ` — ${f.summary.slice(0, 120)}` : ""}`).join("\n")
    : "(아직 없음)";
  const text = [
    `영상: ${input.title || "(제목 없음)"} · 채널 ${input.channel || "?"} · 나라 ${input.country || "?"}`,
    `조회수 ${input.views ?? "?"} · 채널 평소의 ${input.multiple ?? "?"}배`,
    "",
    "기존 형식 카드:",
    known,
  ].join("\n");
  const r = await complete(
    {
      model,
      provider: { require_parameters: true },
      max_tokens: 4000,
      messages: [
        { role: "system", content: ANALYZE_SYSTEM },
        { role: "user", content: [{ type: "text", text }, { type: "video_url", video_url: { url: input.url } }] },
      ],
      response_format: { type: "json_schema", json_schema: { name: "format_analysis", strict: true, schema: ANALYSIS_SCHEMA } },
      usage: { include: true },
    },
    110_000,
  );
  let a: Omit<HitAnalysis, "model" | "costUsd" | "at" | "by">;
  try {
    a = JSON.parse(r.content);
  } catch {
    throw new Error(r.finish === "length" ? "AI 응답이 너무 길어 잘렸습니다." : "AI 응답 형식을 읽지 못했습니다.");
  }
  const ids = new Set(input.formats.map((f) => f.id));
  const clip = (s: unknown, n: number) => (typeof s === "string" ? s.trim().slice(0, n) : "");
  const list = (v: unknown, items: number, n: number) => (Array.isArray(v) ? v.map((x) => clip(x, n)).filter(Boolean).slice(0, items) : []);
  const numOr = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v * 10) / 10 : null);
  const analysis: Omit<HitAnalysis, "model" | "costUsd" | "at" | "by"> = {
    formatName: clip(a.formatName, 80) || "이름 없는 형식",
    summary: clip(a.summary, 500),
    hook: clip(a.hook, 500),
    structure: list(a.structure, 10, 200),
    editing: clip(a.editing, 500),
    sound: clip(a.sound, 300),
    textOverlay: clip(a.textOverlay, 300),
    whyItWorks: clip(a.whyItWorks, 600),
    languageDependence: ["visual", "mixed", "verbal"].includes(a.languageDependence) ? a.languageDependence : "mixed",
    aiFeasibility: {
      level: ["easy", "possible", "hard"].includes(a.aiFeasibility?.level) ? a.aiFeasibility.level : "possible",
      easyParts: clip(a.aiFeasibility?.easyParts, 400),
      hardParts: clip(a.aiFeasibility?.hardParts, 400),
    },
    risks: (Array.isArray(a.risks) ? a.risks : []).filter((x) => ["music", "real_person", "danger", "claims", "other"].includes(x)).slice(0, 5),
    riskNote: clip(a.riskNote, 400),
    brandIdeas: list(a.brandIdeas, 6, 300),
    koreanQueries: list(a.koreanQueries, 5, 60),
    totalSec: numOr(a.totalSec),
    cutCount: numOr(a.cutCount),
    // 목록에 없는 id 를 지어내면 버린다
    match: { formatId: a.match?.formatId && ids.has(a.match.formatId) ? a.match.formatId : null, reason: clip(a.match?.reason, 300) },
  };
  return { analysis, costUsd: r.costUsd, model };
}

/** 주간 보고 요약 — 보고서 숫자만 근거로 (글 모델, 버튼을 눌렀을 때만) */
export async function narrateReport(input: { model?: unknown; report: ScoutReportDoc; countryLabel: (c: string) => string }): Promise<{ text: string; costUsd: number; model: string }> {
  const model = typeof input.model === "string" && isFinAiModelId(input.model) ? input.model : DEFAULT_FIN_AI_MODEL;
  const r = input.report;
  const line = (l: ScoutReportDoc["rising"][number]) =>
    `${l.name} [${l.stage}] 나라 ${l.countries.map(input.countryLabel).join("·") || "?"} · 예시 ${l.examples}편 · 배수 중앙값 ${l.medianMultiple ?? "?"} · 한국 ${l.korea} · AI ${l.ai} · 언어 ${l.lang}`;
  const data = [
    `기간: ${new Date(r.from).toISOString().slice(0, 10)} ~ ${new Date(r.to).toISOString().slice(0, 10)}`,
    `감시 채널 ${r.counts.channels}곳 · 새로 터진 영상 ${r.counts.newHits}편 · 형식 카드 ${r.counts.formats}장 · 아직 안 묶은 영상 ${r.counts.unassigned}편`,
    `나라별 새 영상: ${r.counts.byCountry.map((c) => `${input.countryLabel(c.country)} ${c.hits}`).join(", ") || "없음"}`,
    "떠오르는 형식:", ...r.rising.map(line),
    "해외에만 보이는 형식(국내 표본에 없음·확인 전):", ...r.abroadOnly.map(line),
    "포화 조짐:", ...r.saturating.map(line),
    "시차(해외 처음 → 한국 처음):", ...r.lags.map((l) => `${l.name}: ${input.countryLabel(l.from)} → 한국 ${l.days}일`),
  ].join("\n");
  const out = await complete(
    {
      model,
      max_tokens: 1500,
      messages: [
        {
          role: "system",
          content:
            "너는 AI 영상 대행사의 트렌드 담당이다. 아래 주간 정찰 데이터만 근거로, 이번 주 무엇을 만들어 볼지 팀에 보고하는 요약을 한국어 보고체(…다)로 5~8줄 쓴다. 데이터에 없는 숫자 · 영상 · 사실을 만들지 않는다. 국내 표본에 없다는 것은 「표본에서 못 찾았다」 는 뜻이지 한국에 없다는 단정이 아니다. 형식 이름은 그대로 쓴다. 마크다운 제목 없이 줄글 또는 「- 」 목록으로.",
        },
        { role: "user", content: data },
      ],
      usage: { include: true },
    },
    90_000,
  );
  return { text: out.content.trim().slice(0, 4000), costUsd: out.costUsd, model };
}

// ---- 자동화 (scout-auto-run.ts) — 글 모델 · 하루 몇 번 · 한 번에 몇 원 -------------------------

async function completeJson<T>(system: string, user: string, name: string, schema: object, maxTokens: number): Promise<{ data: T; costUsd: number; model: string }> {
  const model = DEFAULT_FIN_AI_MODEL;
  const out = await complete(
    {
      model,
      max_tokens: maxTokens,
      provider: { require_parameters: true },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: { type: "json_schema", json_schema: { name, strict: true, schema } },
      usage: { include: true },
    },
    90_000,
  );
  try {
    return { data: JSON.parse(out.content) as T, costUsd: out.costUsd, model };
  } catch {
    throw new Error(out.finish === "length" ? "AI 응답이 너무 길어 잘렸습니다." : "AI 응답 형식을 읽지 못했습니다.");
  }
}

/**
 * 아직 안 묶은 터진 영상(분석 결과 글)들을 「만드는 방식이 같은 것」 끼리 묶는다.
 * 2편 이상 모인 묶음만 돌려준다. 기존 카드와 같으면 그 카드 id.
 */
export async function clusterFormats(input: {
  hits: { id: string; formatName: string; summary: string; hook: string; structure: string[] }[];
  formats: { id: string; name: string; summary: string }[];
}): Promise<{ groups: { name: string; hitIds: string[]; formatId: string | null; reason: string }[]; costUsd: number; model: string }> {
  const hits = input.hits.slice(0, 40);
  if (hits.length < 2) return { groups: [], costUsd: 0, model: DEFAULT_FIN_AI_MODEL };
  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["groups"],
    properties: {
      groups: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["name", "hitIds", "formatId", "reason"],
          properties: { name: S, hitIds: { type: "array", items: S }, formatId: { type: ["string", "null"] }, reason: S },
        },
      },
    },
  };
  const system = `너는 바이럴 쇼츠의 「형식(어떻게 만들었나)」 을 묶는 사람이다. 아래 영상 분석 글들 중 만드는 방식이 같은 것끼리 묶는다.
- 주제 · 상품이 달라도 훅 · 구성 · 편집 방식이 같으면 같은 형식이다. 주제만 같고 방식이 다르면 다른 형식이다.
- 2편 이상 모이는 묶음만 돌려준다. 혼자인 영상은 넣지 않는다. 한 영상은 한 묶음에만.
- 「기존 형식 카드」 와 방식이 같으면 formatId 에 그 id, 아니면 null.
- name 은 12자 안팎의 짧은 형식 이름(예: 「전후 비교 3초 반전」).
- 확실하지 않으면 묶지 않는다. 억지로 묶지 않는다.`;
  const user = JSON.stringify({
    formats: input.formats.slice(0, 60).map((f) => ({ id: f.id, name: f.name, summary: f.summary.slice(0, 160) })),
    hits: hits.map((h) => ({ id: h.id, formatName: h.formatName, summary: h.summary.slice(0, 200), hook: h.hook.slice(0, 120), structure: h.structure.slice(0, 6).map((x) => x.slice(0, 60)) })),
  });
  const out = await completeJson<{ groups: { name: string; hitIds: string[]; formatId: string | null; reason: string }[] }>(system, user, "cluster_formats", schema, 3000);
  const known = new Set(hits.map((h) => h.id));
  const fids = new Set(input.formats.map((f) => f.id));
  const used = new Set<string>();
  const groups = out.data.groups
    .map((g) => ({
      name: g.name.trim().slice(0, 40),
      hitIds: g.hitIds.filter((id) => known.has(id) && !used.has(id) && (used.add(id), true)),
      formatId: g.formatId && fids.has(g.formatId) ? g.formatId : null,
      reason: g.reason.slice(0, 200),
    }))
    .filter((g) => g.name && (g.hitIds.length >= 2 || (g.formatId && g.hitIds.length >= 1)));
  return { groups, costUsd: out.costUsd, model: out.model };
}

/**
 * 국내 검색 표본 중 이 형식과 같은 방식으로 보이는 영상을 고른다 — 영상은 보지 않고 제목 · 채널 · 설명 글로만.
 */
export async function judgeKoreaSample(input: {
  format: { name: string; summary: string; hook: string; structure: string[] };
  results: { id: string; title: string; channel: string; description: string }[];
}): Promise<{ matchIds: string[]; reason: string; costUsd: number; model: string }> {
  if (!input.results.length) return { matchIds: [], reason: "표본이 비어 있음", costUsd: 0, model: DEFAULT_FIN_AI_MODEL };
  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["matchIds", "reason"],
    properties: { matchIds: { type: "array", items: S }, reason: S },
  };
  const system = `너는 한국 유튜브 검색 표본에서 주어진 쇼츠 형식(어떻게 만들었나)과 같은 방식의 영상을 고른다.
- 영상을 보지 못한다. 제목 · 채널 · 설명 글로 같은 방식임이 꽤 분명한 것만 고른다. 주제만 같으면 고르지 않는다.
- 애매하면 고르지 않는다. 고른 게 없어도 된다 (그건 「표본에서 못 찾음」 일 뿐이다).
- reason 은 한 줄로.`;
  const user = JSON.stringify({
    format: { name: input.format.name, summary: input.format.summary.slice(0, 300), hook: input.format.hook.slice(0, 200), structure: input.format.structure.slice(0, 6) },
    results: input.results.slice(0, 25).map((r) => ({ id: r.id, title: r.title.slice(0, 150), channel: r.channel.slice(0, 60), description: r.description.slice(0, 200) })),
  });
  const out = await completeJson<{ matchIds: string[]; reason: string }>(system, user, "korea_sample", schema, 1200);
  const known = new Set(input.results.map((r) => r.id));
  return { matchIds: out.data.matchIds.filter((id) => known.has(id)), reason: out.data.reason.slice(0, 300), costUsd: out.costUsd, model: out.model };
}
