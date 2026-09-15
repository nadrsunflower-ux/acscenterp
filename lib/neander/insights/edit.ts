// ============================================================
//  인사이트 초안 고치기 — 화면·서버 공용 순수 함수
// ------------------------------------------------------------
//  「AI 와 고치기」 대화에서 AI 가 낸 수정안(InsightEditProposal)을 편집 중인
//  초안에 넣는다. 서버는 같은 이름표(「핵심 2」)로 초안을 AI 에 보여 주고,
//  화면은 같은 이름표로 사람에게 보여 준다 — 둘이 어긋나면 「2번」이 서로
//  다른 문장을 가리킨다.
// ============================================================

import type { InsightDraft, InsightEditProposal, InsightItem, InsightSection } from "./types";

export const SECTION_LABEL: Record<InsightSection, string> = {
  summary: "핵심",
  actions: "할 일",
  risks: "확인",
};

export const SECTION_PREFIX: Record<InsightSection, string> = { summary: "s", actions: "a", risks: "r" };

/** 「핵심 2」 — 초안에서의 지금 순서 */
export function itemLabel(draft: InsightDraft, section: InsightSection, id: string): string | null {
  const i = draft[section].findIndex((x) => x.id === id);
  return i < 0 ? null : `${SECTION_LABEL[section]} ${i + 1}`;
}

function nextId(draft: InsightDraft, section: InsightSection): string {
  const used = new Set(draft[section].map((x) => x.id));
  let k = draft[section].length + 1;
  while (used.has(`${SECTION_PREFIX[section]}${k}`)) k += 1;
  return `${SECTION_PREFIX[section]}${k}`;
}

/** 이 수정안을 지금 초안에 넣을 수 있는가 — 대상 문장이 이미 지워졌으면 못 넣는다 */
export function canApplyInsightEdit(draft: InsightDraft, p: InsightEditProposal): boolean {
  if (p.kind === "comment") return true;
  if (p.op === "add") return !!p.item;
  return draft[p.section].some((x) => x.id === p.targetId) && (p.op === "remove" || !!p.item);
}

export function applyInsightEdit(draft: InsightDraft, p: InsightEditProposal): InsightDraft {
  if (!canApplyInsightEdit(draft, p)) return draft;
  if (p.kind === "comment") {
    const comments = { ...draft.comments };
    if (p.text.trim()) comments[p.chapter] = p.text;
    else delete comments[p.chapter];
    return { ...draft, comments };
  }
  const list = draft[p.section];
  let next: InsightItem[];
  if (p.op === "remove") next = list.filter((x) => x.id !== p.targetId);
  else if (p.op === "add") next = [...list, { id: nextId(draft, p.section), ...p.item! }];
  else next = list.map((x) => (x.id === p.targetId ? { id: x.id, ...p.item! } : x));
  return { ...draft, [p.section]: next };
}
