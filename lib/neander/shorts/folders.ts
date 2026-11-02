// ============================================================
//  영상 폴더 — 나무 · 개수 · 이름 규칙 (화면 · 서버가 같이 쓴다)
// ------------------------------------------------------------
//  smoat Q 「결과물」 의 폴더 체계를 따른다(사용자 요청 2026-11-02):
//  왼쪽 칸에 폴더 나무, 고르면 오른쪽에 그 폴더의 영상.
//
//  · 폴더는 AI STUDIO 전체가 같이 쓰는 나무 하나다 (영상은 한 종류의 문서라 Q 처럼
//    유형마다 따로 둘 필요가 없다 — 쿠팡 · 일반 · 고객사는 걸러 보기로).
//  · 영상 하나는 폴더 하나에만 들어간다 (ProjectDoc.folderId · 없으면 폴더 밖).
//  · 폴더의 개수 = 그 폴더와 하위 폴더에 든 영상 (보는 사람이 볼 수 있는 것만).
//  · 부모가 지워졌거나 고리가 생긴 폴더는 맨 위로 올려 탐색에서 빠지지 않게 한다.
// ============================================================

import type { FolderView } from "./types";

export const FOLDER_NAME_MAX = 40;
/** 폴더 깊이 — 아주 깊으면 이름 칸이 사라진다 (맨 위 = 1) */
export const FOLDER_MAX_DEPTH = 6;

/** 폴더 이름 다듬기 — 틀리면 이유를 던진다 */
export function cleanFolderName(name: unknown): string {
  const s = String(name ?? "")
    .replace(/[\u0000-\u001f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) throw new Error("폴더 이름을 적어 주세요.");
  if ([...s].length > FOLDER_NAME_MAX) throw new Error(`폴더 이름은 ${FOLDER_NAME_MAX}자 이하로 적어 주세요.`);
  if (/[/\\]/.test(s)) throw new Error("폴더 이름에는 / 와 \\ 를 쓸 수 없습니다.");
  return s;
}

const byName = (a: FolderView, b: FolderView) => a.name.localeCompare(b.name, "ko", { numeric: true }) || a.createdAt - b.createdAt;

export interface FolderTree {
  byId: Map<string, FolderView>;
  /** 부모 id(맨 위는 null) → 이름순 자식 */
  children: Map<string | null, FolderView[]>;
  parentOf: (id: string) => string | null;
  /** 맨 위부터 그 폴더까지 */
  pathTo: (id: string | null) => FolderView[];
  /** 그 폴더와 모든 하위 폴더 id */
  subtree: (id: string) => Set<string>;
  depthOf: (id: string) => number;
}

export function folderTree(folders: readonly FolderView[]): FolderTree {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const parent = new Map<string, string | null>();
  for (const f of byId.values()) {
    let p = f.parentId && byId.has(f.parentId) ? f.parentId : null;
    // 고리(A → B → A)가 있으면 맨 위로
    const seen = new Set([f.id]);
    for (let c = p; c; c = byId.get(c)?.parentId ?? null) {
      if (seen.has(c) || !byId.has(c)) {
        if (seen.has(c)) p = null;
        break;
      }
      seen.add(c);
    }
    parent.set(f.id, p);
  }
  const children = new Map<string | null, FolderView[]>();
  for (const f of byId.values()) {
    const p = parent.get(f.id) ?? null;
    children.set(p, [...(children.get(p) ?? []), f]);
  }
  for (const list of children.values()) list.sort(byName);
  const parentOf = (id: string) => parent.get(id) ?? null;
  const pathTo = (id: string | null) => {
    const out: FolderView[] = [];
    for (let c = id; c && byId.has(c) && out.length <= byId.size; c = parentOf(c)) out.unshift(byId.get(c)!);
    return out;
  };
  const subtree = (id: string) => {
    const out = new Set<string>();
    const walk = (x: string) => {
      if (out.has(x)) return;
      out.add(x);
      for (const k of children.get(x) ?? []) walk(k.id);
    };
    if (byId.has(id)) walk(id);
    return out;
  };
  return { byId, children, parentOf, pathTo, subtree, depthOf: (id) => pathTo(id).length };
}

/** 폴더마다 영상 수 — direct(바로 안) · total(하위 포함). 없는 폴더를 가리키는 영상은 폴더 밖으로 센다 */
export function folderCounts(tree: FolderTree, videos: readonly { folderId?: string | null }[]) {
  const direct = new Map<string, number>();
  let outside = 0;
  for (const v of videos) {
    if (v.folderId && tree.byId.has(v.folderId)) direct.set(v.folderId, (direct.get(v.folderId) ?? 0) + 1);
    else outside++;
  }
  const total = new Map<string, number>();
  const sum = (id: string): number => {
    const hit = total.get(id);
    if (hit !== undefined) return hit;
    total.set(id, 0); // 고리 방지
    const n = (direct.get(id) ?? 0) + (tree.children.get(id) ?? []).reduce((a, k) => a + sum(k.id), 0);
    total.set(id, n);
    return n;
  };
  for (const id of tree.byId.keys()) sum(id);
  return { direct, total, outside, all: videos.length };
}

/** 이 폴더(하위 포함)에 드는 영상인가 — folderId null = 전체 */
export function inFolder(tree: FolderTree, videoFolderId: string | null | undefined, folderId: string | null): boolean {
  if (!folderId) return true;
  return !!videoFolderId && tree.subtree(folderId).has(videoFolderId);
}

/** 보기용 경로 — 「고1 영어 › 1학기」 (from 아래만: 지금 보는 폴더 기준 상대 경로) */
export function folderLabel(tree: FolderTree, id: string | null | undefined, from: string | null = null): string {
  if (!id || !tree.byId.has(id)) return "";
  const path = tree.pathTo(id);
  const start = from ? path.findIndex((f) => f.id === from) + 1 : 0;
  return path
    .slice(start)
    .map((f) => f.name)
    .join(" › ");
}
