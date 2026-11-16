// ============================================================
//  프로젝트 워크스페이스 — 팀원 모두가 보는 「운영」 쪽 (2026-11-14)
// ------------------------------------------------------------
//  프로젝트 문서는 재무와 같은 하나(neander_fin_projects)다. 화면과 권한만 나눈다.
//
//    프로젝트 워크스페이스(/neander/projects) — 팀원 모두
//      이름 · 코드 · 발주처 · 상태 · 기간 · 납기 · 장비 · 남은 일 · 다음엔 · 메모
//      고칠 수 있는 칸은 OPS_FIELDS 뿐이다. 서버는 바뀐 칸만 받는다.
//    재무 › 프로젝트 손익(/neander/finance/projects) — 재무 권한자만
//      계약금액 · 입금 회차 · 지출 · 사내 인력 · 이익 · 미수금 · 견적 · 계약 문서 · 「자료」
//
//  메모의 「■ 원가」 구역(내부 원가 · 이익)은 재무 권한이 없는 사람에게 빼고 보낸다.
//  그 사람이 메모를 저장하면 서버가 빼 두었던 구역을 제자리에 다시 넣는다(mergeHiddenSections).
//
//  재무 화면은 문서를 통째로 저장한다. 그 화면을 연 뒤 여기서 운영 칸을 고쳤으면
//  재무 저장이 덮지 않게 서버가 opsUpdatedAt 으로 가린다(mutate project.save).
// ============================================================
import type { FinProjectDoc, FinProjectTodo, ProjectStatus } from "@/lib/neander/finance/project";
import type { ProjectEquipment } from "@/lib/neander/finance/equipment";
import type { NoteRich, NoteRun } from "@/lib/neander/finance/rich-note";

/** 프로젝트 워크스페이스에서 고칠 수 있는 칸 — 재무 저장이 덮지 않게 지키는 칸도 이것 */
export const OPS_FIELDS = ["note", "noteRich", "todos", "lessons", "equipment", "startDate", "endDate", "deliveryDate"] as const;
export type OpsField = (typeof OPS_FIELDS)[number];
export type OpsPatch = Partial<Pick<FinProjectDoc, OpsField>>;

export interface ProjectView {
  id: string;
  code: string;
  name: string;
  client?: string;
  status: ProjectStatus;
  startDate?: string;
  endDate?: string;
  deliveryDate?: string;
  equipment?: ProjectEquipment;
  todos?: FinProjectTodo[];
  lessons?: string;
  note?: string;
  noteRich?: NoteRich;
  /** 메모에서 뺀 구역 수 (재무 권한이 없을 때) — 화면이 「원가 구역은 재무 권한자만」 이라고 알린다 */
  hiddenSections?: number;
  createdAt?: number;
  updatedAt?: number;
  opsUpdatedAt?: number;
}

/** 재무 권한이 없는 사람에게서 가리는 메모 구역 — 「■ 원가」 로 시작하는 제목 줄부터 다음 「■ 」 제목 줄 앞까지 */
const HIDDEN_HEADING = /^■\s*원가/;
const HEADING = /^■ /;

const linesOf = (note: string | undefined) => (note ?? "").replace(/\r\n?/g, "\n").split("\n");
const runText = (runs: NoteRun[]) => runs.map((r) => r.t).join("");

interface Block {
  /** 원래 메모에서 가린 구역 바로 뒤에 오던 제목 줄 (없으면 끝에 있었다) */
  nextHeading: string | null;
  lines: string[];
  rich: NoteRun[][];
}

/** 메모를 「보일 줄」 과 「가린 구역」 으로 나눈다. 가린 구역 앞의 빈 줄 하나는 구역에 붙여 함께 뺀다 */
export function splitHiddenSections(note: string | undefined, rich: NoteRich | undefined) {
  const lines = linesOf(note);
  const richLines: NoteRun[][] =
    rich && rich.lines.length === lines.length && rich.lines.every((l, i) => runText(l) === lines[i])
      ? rich.lines
      : lines.map((l) => (l ? [{ t: l }] : []));
  const shownLines: string[] = [];
  const shownRich: NoteRun[][] = [];
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    if (!HIDDEN_HEADING.test(lines[i])) {
      shownLines.push(lines[i]);
      shownRich.push(richLines[i]);
      i++;
      continue;
    }
    let j = i + 1;
    while (j < lines.length && !HEADING.test(lines[j])) j++;
    // 구역 끝의 빈 줄은 다음 제목과의 사이 띄움이라 보일 쪽에 남긴다
    let end = j;
    while (end > i + 1 && lines[end - 1] === "") end--;
    blocks.push({ nextHeading: j < lines.length ? lines[j] : null, lines: lines.slice(i, end), rich: richLines.slice(i, end) });
    // 구역 앞에 띄움으로 둔 빈 줄이 겹치지 않게 — 앞이 빈 줄이고 뒤에도 빈 줄이면 하나를 뺀다
    if (shownLines.length && shownLines[shownLines.length - 1] === "" && end < j) {
      shownLines.pop();
      shownRich.pop();
    }
    i = end;
  }
  // 끝에 남은 빈 줄은 다듬는다
  while (shownLines.length && shownLines[shownLines.length - 1] === "") {
    shownLines.pop();
    shownRich.pop();
  }
  const shownNote = shownLines.join("\n");
  const hasFormat = shownRich.some((l) => l.some((r) => Object.keys(r).length > 1));
  return {
    note: blocks.length ? shownNote || undefined : note,
    noteRich: blocks.length ? (hasFormat ? ({ v: 1, lines: shownRich } as NoteRich) : undefined) : rich,
    blocks,
  };
}

/**
 * 재무 권한이 없는 사람이 저장한 메모에, 저장돼 있던 메모의 가린 구역을 다시 넣는다.
 * 원래 그 구역 뒤에 오던 제목 줄이 새 메모에도 있으면 그 앞에, 없으면 맨 끝에.
 */
export function mergeHiddenSections(
  next: { note: string | undefined; noteRich: NoteRich | undefined },
  stored: { note: string | undefined; noteRich: NoteRich | undefined },
): { note: string | undefined; noteRich: NoteRich | undefined } {
  const { blocks } = splitHiddenSections(stored.note, stored.noteRich);
  if (!blocks.length) return next;
  const lines = next.note ? linesOf(next.note) : [];
  const nextRich = next.noteRich && next.noteRich.lines.length === lines.length ? next.noteRich.lines : lines.map((l) => (l ? [{ t: l }] : []));
  const outLines = [...lines];
  const outRich = [...nextRich];
  for (const b of blocks) {
    let at = b.nextHeading ? outLines.indexOf(b.nextHeading) : -1;
    const insLines = [...b.lines];
    const insRich = [...b.rich];
    if (at < 0) {
      // 끝에 붙인다 — 앞 내용과 한 줄 띄운다
      if (outLines.length && outLines[outLines.length - 1] !== "") {
        insLines.unshift("");
        insRich.unshift([]);
      }
      at = outLines.length;
    } else {
      // 제목 앞에 넣고 그 제목과 한 줄 띄운다
      insLines.push("");
      insRich.push([]);
    }
    outLines.splice(at, 0, ...insLines);
    outRich.splice(at, 0, ...insRich);
  }
  const hasFormat = outRich.some((l) => l.some((r) => Object.keys(r).length > 1));
  return { note: outLines.join("\n"), noteRich: hasFormat ? { v: 1, lines: outRich } : undefined };
}

/** 프로젝트 문서 → 워크스페이스에 보내는 모양. 돈 칸은 아예 싣지 않는다 */
export function toProjectView(p: FinProjectDoc & { opsUpdatedAt?: number }, financeAccess: boolean): ProjectView {
  const memo = financeAccess
    ? { note: p.note, noteRich: p.noteRich, blocks: [] as Block[] }
    : splitHiddenSections(p.note, p.noteRich);
  return {
    id: p.id,
    code: p.code,
    name: p.name,
    client: p.client,
    status: p.status,
    startDate: p.startDate,
    endDate: p.endDate,
    deliveryDate: p.deliveryDate,
    equipment: p.equipment,
    todos: p.todos,
    lessons: p.lessons,
    note: memo.note,
    noteRich: memo.noteRich,
    hiddenSections: memo.blocks.length || undefined,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    opsUpdatedAt: p.opsUpdatedAt,
  };
}

/** 받은 고칠 거리에서 운영 칸만 남긴다 (모르는 칸은 버린다) */
export function pickOps(patch: unknown): OpsPatch {
  const out: Record<string, unknown> = {};
  if (!patch || typeof patch !== "object") return out;
  for (const k of OPS_FIELDS) if (k in (patch as object)) out[k] = (patch as Record<string, unknown>)[k];
  return out as OpsPatch;
}
