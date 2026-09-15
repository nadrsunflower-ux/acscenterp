// ============================================================
//  발표 중 비서 — "지금 몇 월 보고를 하고 있나"를 비서에게 알린다
// ------------------------------------------------------------
//  재무·매출 보고 슬라이드(Deck)에서 비서를 열면, 회의에서 나온 질문은 대개
//  기간을 말하지 않는다 ("와우 이익률 왜 이래?"). 그럴 때는 발표 중인 달을
//  기준으로 답해야 한다. 반대로 "작년 매출은?"처럼 기간을 말하면 그 기간으로.
//
//  ⚠️ 브라우저가 보낸 값을 그대로 프롬프트에 넣지 않는다. 달(YYYY-MM)·모듈만
//     검사해서 받고, 안내문은 서버가 만든다. 장 이름은 짧게 자르고 줄바꿈을 뺀다.
// ============================================================

export interface PresentationContext {
  module: "finance" | "sales";
  /** 발표 중인 달 `YYYY-MM` */
  month: string;
  /** 지금 보고 있는 장 (예: 매장별 손익) */
  chapter?: string;
}

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** 요청 본문의 context — 검사를 통과한 것만 돌려준다 */
export function parsePresentation(raw: unknown): PresentationContext | undefined {
  let v = raw;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return undefined;
    }
  }
  if (!v || typeof v !== "object") return undefined;
  const o = v as Record<string, unknown>;
  if (o.module !== "finance" && o.module !== "sales") return undefined;
  if (typeof o.month !== "string" || !MONTH_RE.test(o.month)) return undefined;
  const chapter =
    typeof o.chapter === "string" ? o.chapter.replace(/[\r\n`=]/g, " ").trim().slice(0, 40) || undefined : undefined;
  return { module: o.module, month: o.month, chapter };
}

const label = (m: string) => `${Number(m.slice(0, 4))}년 ${Number(m.slice(5, 7))}월`;

function shift(m: string, delta: number): string {
  const [y, mo] = m.split("-").map(Number);
  const d = new Date(y, mo - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** 시스템 프롬프트 끝에 붙일 안내 — 캐시되는 앞부분과 따로 둔다 (매 요청 달라질 수 있다) */
export function presentationNote(p: PresentationContext): string {
  const cur = label(p.month);
  const prev = shift(p.month, -1);
  const year = p.month.slice(0, 4);
  const what = p.module === "sales" ? "매출" : "재무";
  return [
    "== 지금 상황: 보고 슬라이드 발표 중 ==",
    `사용자는 지금 ${cur} ${what} 보고 슬라이드를 회의에서 발표하고 있습니다${p.chapter ? ` (화면에 띄운 장: 「${p.chapter}」)` : ""}. 청중의 질문을 받아 옮기는 중일 수 있습니다.`,
    `- 질문에 기간이 없으면 ${cur}(${p.month}) 기준으로 조회해서 답하세요. 「이번 달」은 ${p.month}, 「지난달·전월」은 ${prev} 입니다.`,
    `- 질문에 다른 기간이 있으면(예: 「2025년 매출」, 「작년」, 「3월」, 「상반기」) 반드시 그 기간으로 답하세요. 발표 달에 끌려가지 마세요.`,
    `- 연도 없이 월만 말하면 ${year}년으로 보되, 그 월이 ${cur}보다 뒤면 전년(${Number(year) - 1}년)으로 봅니다. 「작년」은 ${Number(year) - 1}년입니다.`,
    "- 답의 첫 줄에 어느 기간 기준인지 밝히세요 (예: 「2026년 8월 기준」).",
    "- 발표 중이니 짧게, 숫자와 이유 중심으로 답하세요. 표가 필요하면 다섯 줄 안으로.",
  ].join("\n");
}
