import "server-only";

// ============================================================
//  회의 녹음 AI — 받아쓰기 · 회의록 초안 (OpenRouter · gemini-3.8-flash)
// ------------------------------------------------------------
//  설정은 2026-09-19 실측(77분 실제 회의)에서 정했다. 바꾸기 전에 읽을 것:
//
//  · 받아쓰기는 reasoning effort low — 생각 토큰 0. high 는 1분 조각에
//    생각 2.9만 토큰($0.11 · 3분 25초)을 썼다. medium 도 받아쓰기에서는
//    low 와 같았지만(생각 0) 긴 조각에서 튈 수 있어 쓰지 않는다.
//  · 화자 구분은 **JSON 으로 받을 때만** 된다. 그냥 글로 받으면 여러 사람
//    말이 「화자A」 한 줄로 뭉친다. 키 이름이 긴 객체 배열보다 문자열 배열
//    ("mm:ss|A|내용")이 출력 토큰이 적고 결과는 같았다.
//  · 한 항목 길이를 **글자 수**로 묶는다 ("150자 이내"). "30초 이내" 로는 같은 10분
//    조각을 두 번 받아써 한 번은 1,745자짜리 줄이 나왔다 — 글자 수로 바꾸자 두 번 모두
//    가장 긴 줄이 210자 이하였다 (출력 토큰은 10% 남짓 는다). 5분 조각으로 줄이는
//    것보다 효과가 컸다.
//  · 앞 조각 끝 몇 줄을 넘기면 조각이 바뀌어도 같은 사람이 같은 글자로 남았다.
// ============================================================

import { MEETING_AI_MODEL } from "@/lib/neander/ai/models";
import {
  normalizeSpeaker,
  parseTranscriptLines,
  speakerLabel,
  formatClock,
  type MeetingMinutesDraft,
  type RecAudioFormat,
  type TranscriptLine,
} from "../recording";
import type { TaskCategory } from "@/lib/neander/types";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

// HTTP 헤더는 latin-1 만 담을 수 있다 — 한글 금지
const HEADERS = {
  "HTTP-Referer": "https://neander-erp.vercel.app/neander/meetings",
  "X-Title": "NEANDER ERP Meeting Minutes",
};

function apiKey(): string {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY 가 설정되지 않아 AI 받아쓰기를 쓸 수 없습니다.");
  return key;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function call(body: object): Promise<{ content: string; costUsd: number; finish?: string; raw: any }> {
  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey()}`, "Content-Type": "application/json", ...HEADERS },
    body: JSON.stringify({
      model: MEETING_AI_MODEL,
      // 스키마를 못 지키는 제공자로 라우팅되면 파싱이 깨진다
      provider: { require_parameters: true },
      ...body,
    }),
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = (await res.json().catch(() => null)) as any;
  if (!res.ok || raw?.error) {
    throw new Error(`AI 호출이 실패했습니다: ${raw?.error?.message ?? `HTTP ${res.status}`}`);
  }
  const content = raw?.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("AI 가 빈 응답을 돌려줬습니다.");
  const cost = raw?.usage?.cost;
  return {
    content,
    costUsd: typeof cost === "number" && cost > 0 ? cost : 0,
    finish: raw?.choices?.[0]?.finish_reason,
    raw,
  };
}

// ---- 받아쓰기 -----------------------------------------------

const TRANSCRIBE_RULES = `회사 회의 녹음의 한 조각(최대 10분)이다. 한국어로 빠짐없이 받아써라.
- 여러 사람이 번갈아 말한다. 목소리가 바뀌는 곳마다 반드시 끊는다. 맞장구("네", "그죠")도 다른 사람이면 따로 끊는다.
- 한 항목의 내용은 150자를 넘기지 않는다. 같은 사람이 길게 말하면 150자 안에서 문장 끝마다 나눠 여러 항목으로 쓴다 (시각도 각각).
- 화자는 A·B·C… 한 글자로 쓰고, 같은 목소리는 끝까지 같은 글자를 쓴다.
- "음", "어" 같은 추임새만 빼고 내용은 줄이거나 요약하지 않는다.
- 알아듣기 어려운 부분은 (안 들림) 으로 적는다. 침묵·잡음은 적지 않는다. 말소리가 없는 조각이면 빈 배열을 돌려준다.
- 시각 mm:ss 는 이 조각 안에서의 시각이다.
발화마다 문자열 하나로 u 배열에 담는다. 형식: "mm:ss|화자|내용". 예: "03:12|B|네, 그렇게 하겠습니다." 한글은 그대로 쓴다(\\u 이스케이프 금지).`;

const TRANSCRIPT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["u"],
  properties: { u: { type: "array", items: { type: "string" } } },
};

/** JSON 이 잘려 와도 완성된 줄은 건진다 (출력 한도에 걸린 경우) */
function salvageLines(content: string): string[] {
  try {
    const parsed = JSON.parse(content) as { u?: unknown };
    if (Array.isArray(parsed.u)) return parsed.u.filter((x): x is string => typeof x === "string");
  } catch {
    // 아래로
  }
  const out: string[] = [];
  for (const m of content.matchAll(/"((?:\d{1,2}:)?\d{1,3}:\d{2}\|(?:[^"\\]|\\.)*)"/g)) {
    try {
      out.push(JSON.parse(`"${m[1]}"`) as string);
    } catch {
      // 깨진 줄은 버린다
    }
  }
  return out;
}

export interface TranscribeResult {
  lines: TranscriptLine[];
  costUsd: number;
}

/**
 * 10분 조각 하나를 받아쓴다. prev 는 바로 앞 조각의 끝 몇 줄 — 화자 글자를 이어 맞춘다.
 */
export async function transcribeAudio(args: {
  audio: Buffer;
  format: RecAudioFormat;
  startSec: number;
  durationSec: number;
  prev: TranscriptLine[];
}): Promise<TranscribeResult> {
  const tail = args.prev
    .slice(-8)
    .map((l) => `${l.s}: ${l.x}`)
    .join("\n");
  const text = tail
    ? `${TRANSCRIBE_RULES}\n\n앞 조각의 마지막 부분 — 화자 글자를 여기에 맞춰 이어 간다:\n${tail}`
    : TRANSCRIBE_RULES;

  const { content, costUsd, finish } = await call({
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text },
          { type: "input_audio", input_audio: { data: args.audio.toString("base64"), format: args.format } },
        ],
      },
    ],
    reasoning: { effort: "low" },
    // 10분 조각은 실측 3~6천 토큰. 한도는 모델이 반복에 빠졌을 때의 울타리다
    max_tokens: 16000,
    response_format: { type: "json_schema", json_schema: { name: "transcript", strict: true, schema: TRANSCRIPT_SCHEMA } },
  });

  const raw = salvageLines(content);
  if (raw.length === 0 && finish === "length") throw new Error("받아쓴 글이 너무 길어 잘렸습니다. 다시 시도해 주세요.");
  return { lines: parseTranscriptLines(raw, args.startSec, args.durationSec), costUsd };
}

// ---- 회의록 초안 --------------------------------------------

const CATEGORIES: TaskCategory[] = ["smoat", "id", "wow", "dev", "etc"];

const MINUTES_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "content", "decisions", "actionItems", "openQuestions"],
  properties: {
    title: { type: "string" },
    content: { type: "string" },
    decisions: { type: "array", items: { type: "string" } },
    actionItems: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["text", "category", "detail", "assignees", "dueDate"],
        properties: {
          text: { type: "string" },
          category: { type: "string", enum: CATEGORIES },
          detail: { type: "string" },
          assignees: { type: "array", items: { type: "string" } },
          dueDate: { type: "string" },
        },
      },
    },
    openQuestions: { type: "array", items: { type: "string" } },
  },
};

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const strs = (v: unknown) => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);

export interface MinutesResult {
  draft: MeetingMinutesDraft;
  costUsd: number;
}

/** 받아쓴 줄 전체 → 회의록 초안. 담당자는 teamNames 안에서만 고르게 하고, 밖의 이름은 버린다 */
export async function draftMinutes(args: {
  lines: TranscriptLine[];
  meetingDate: string;
  meetingTitle?: string;
  teamNames: string[];
  speakers?: Record<string, string>;
}): Promise<MinutesResult> {
  const named = Object.entries(args.speakers ?? {}).filter(([, v]) => v.trim());
  const transcript = args.lines
    .map((l) => `[${formatClock(l.t)}] ${speakerLabel(normalizeSpeaker(l.s), args.speakers)}: ${l.x}`)
    .join("\n");

  const prompt = `아래는 회의 녹음을 AI 가 받아쓴 글이다. 오탈자와 화자 구분 오류가 있을 수 있다.
우리 회사는 네안데르다. 업무 분류: smoat=스모트, id=아이디, wow=와우, dev=개발, etc=기타.
회의 날짜: ${args.meetingDate}${args.meetingTitle ? ` · 제목: ${args.meetingTitle}` : ""}
우리 팀원: ${args.teamNames.join(", ") || "(없음)"}
${named.length ? `화자 이름(사람이 붙였다): ${named.map(([k, v]) => `${k}=${v}`).join(", ")}\n` : ""}
이 받아쓰기로 회의록 초안을 JSON 으로 만든다.
- title: 회의 제목 (25자 이내)
- content: 회의 내용 정리. 주제별로 "■ 소제목" 줄 아래에 "- " 글머리표. 숫자·금액·날짜·이름은 받아쓰기에 있는 그대로 쓴다. 받아쓰기에 없는 내용을 지어내지 않는다. 결정 사항과 남은 질문은 여기에 쓰지 않는다.
- decisions: 이 회의에서 정해진 것
- actionItems: 해야 할 일. 우선순위 높은 순. category 는 위 분류 중 하나. assignees 는 이 일을 맡은 사람을 "우리 팀원" 이름 중에서만 고른다 (모르면 빈 배열). dueDate 는 회의에서 기한이 정해졌으면 회의 날짜 기준으로 계산한 YYYY-MM-DD, 아니면 "". detail 은 한두 문장.
- openQuestions: 정해지지 않고 남은 것`;

  const { content, costUsd } = await call({
    messages: [{ role: "user", content: `${prompt}\n\n<받아쓰기>\n${transcript}\n</받아쓰기>` }],
    reasoning: { effort: "medium" },
    max_tokens: 16000,
    response_format: { type: "json_schema", json_schema: { name: "minutes", strict: true, schema: MINUTES_SCHEMA } },
  });

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(content) as Record<string, unknown>;
  } catch {
    throw new Error("AI 가 돌려준 회의록 초안을 읽지 못했습니다. 다시 만들어 주세요.");
  }
  const team = new Set(args.teamNames);
  const actions = Array.isArray(parsed.actionItems) ? parsed.actionItems : [];
  const draft: MeetingMinutesDraft = {
    title: str(parsed.title).slice(0, 60),
    content: str(parsed.content),
    decisions: strs(parsed.decisions),
    openQuestions: strs(parsed.openQuestions),
    actionItems: actions
      .map((a) => a as Record<string, unknown>)
      .map((a) => {
        const due = str(a.dueDate);
        const category = CATEGORIES.includes(a.category as TaskCategory) ? (a.category as TaskCategory) : "etc";
        return {
          text: str(a.text),
          category,
          detail: str(a.detail),
          assignees: strs(a.assignees).filter((n) => team.has(n)),
          dueDate: /^\d{4}-\d{2}-\d{2}$/.test(due) ? due : "",
        };
      })
      .filter((a) => a.text),
  };
  if (!draft.content && draft.actionItems.length === 0) throw new Error("AI 가 빈 회의록을 돌려줬습니다.");
  return { draft, costUsd };
}
