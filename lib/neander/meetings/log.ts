// ============================================================
//  회의 기록 — 누가 무엇을 했는가
// ------------------------------------------------------------
//  회의 문서는 팀이 같이 고친다. 「이 문장 누가 고쳤지」 · 「이 파일 누가
//  올렸지」 를 나중에 알 수 있어야 해서, 손댄 일을 한 줄씩 남긴다.
//
//  기록하는 사람(by)은 **서버가 찍는다** (requireMember 의 이메일).
//  브라우저가 보내는 값으로 두면 남의 이름으로 남길 수 있다.
// ============================================================

export type MeetingEventKind =
  | "created" // 회의를 만들었다
  | "edited" // 회의록을 고쳤다 (detail: 무엇이 바뀌었는지)
  | "file-added" // 첨부를 올렸다 (detail: 파일 이름)
  | "file-removed"
  | "file-archived" // 첨부를 노션으로 옮겼다
  | "recording-added" // 녹음을 마쳤다
  | "recording-removed"
  | "minutes-ai" // AI 회의록 초안을 문서에 넣었다
  | "agenda-linked" // 다른 회의의 안건으로 묶었다 (detail: 상위 회의 이름)
  | "agenda-unlinked";

export interface MeetingEvent {
  id: string;
  meetingId: string;
  at: number;
  /** 한 사람의 ERP 이메일 — 화면이 팀원 목록에서 이름·사진을 찾는다 */
  by: string;
  kind: MeetingEventKind;
  detail?: string;
}

const TEXT: Record<MeetingEventKind, string> = {
  created: "회의를 만들었습니다",
  edited: "회의록을 고쳤습니다",
  "file-added": "파일을 올렸습니다",
  "file-removed": "파일을 지웠습니다",
  "file-archived": "파일을 노션으로 옮겼습니다",
  "recording-added": "녹음을 마쳤습니다",
  "recording-removed": "녹음을 지웠습니다",
  "minutes-ai": "AI 회의록 초안을 넣었습니다",
  "agenda-linked": "안건으로 묶었습니다",
  "agenda-unlinked": "안건에서 뺐습니다",
};

/** 「파일을 올렸습니다」 · 「회의록을 고쳤습니다 — 제목 · 본문」 */
export const meetingEventText = (e: Pick<MeetingEvent, "kind" | "detail">) =>
  e.detail ? `${TEXT[e.kind]} — ${e.detail}` : TEXT[e.kind];

/** 기록으로 남길 만큼 바뀐 것 — 없으면 null (저장만 누른 경우는 기록하지 않는다) */
export function describeMeetingEdit(
  before: { date: string; title?: string; content: string; actionItems: unknown[]; links?: unknown[] },
  after: { date: string; title?: string; content: string; actionItems: unknown[]; links?: unknown[] },
): string | null {
  const parts: string[] = [];
  if (before.date !== after.date) parts.push("날짜");
  if ((before.title ?? "") !== (after.title ?? "")) parts.push("제목");
  if (before.content !== after.content) parts.push("회의 내용");
  if (JSON.stringify(before.actionItems) !== JSON.stringify(after.actionItems)) parts.push("액션플랜");
  if (JSON.stringify(before.links ?? []) !== JSON.stringify(after.links ?? [])) parts.push("자료 링크");
  return parts.length ? parts.join(" · ") : null;
}
