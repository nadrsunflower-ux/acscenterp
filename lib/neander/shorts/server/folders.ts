import "server-only";

// ============================================================
//  영상 폴더 — 만들기 · 이름 바꾸기 · 지우기 · 영상 옮기기
// ------------------------------------------------------------
//  나무 · 개수 · 이름 규칙은 shorts/folders.ts. 폴더는 AI STUDIO 사용자 모두가 같이 쓴다.
//  영상 옮기기는 그 영상을 고칠 수 있는 사람만 (관리자라도 남의 비공개는 못 옮긴다).
//  옮길 때 updatedAt 을 바꾸지 않는다 — 열어 둔 편집 화면의 저장이 「다른 곳에서 고쳤다」 로
//  막히지 않게 (저장은 folderId 를 이전 값 그대로 둔다 · store.ts).
// ============================================================

import { randomBytes } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import { NEANDER_COL } from "@/lib/neander/collections";
import { AccessError } from "@/lib/neander/server/auth";
import { cleanFolderName, FOLDER_MAX_DEPTH, folderTree } from "../folders";
import type { FolderDoc, FolderView, ProjectDoc } from "../types";
import { canEdit } from "./access";

const col = (db: Firestore) => db.collection(NEANDER_COL.shortsFolders);
const projects = (db: Firestore) => db.collection(NEANDER_COL.shortsProjects);
const isId = (v: unknown): v is string => typeof v === "string" && /^[\w-]{6,40}$/.test(v);

export async function listFolders(db: Firestore): Promise<FolderView[]> {
  const snap = await col(db).get();
  return snap.docs.map((d) => ({ ...(d.data() as FolderDoc), id: d.id }));
}

function assertUniqueName(siblings: readonly FolderView[], name: string, except?: string) {
  if (siblings.some((f) => f.id !== except && f.name.localeCompare(name, "ko", { sensitivity: "accent" }) === 0)) {
    throw new AccessError(409, `같은 자리에 「${name}」 폴더가 이미 있습니다.`);
  }
}

/** 새 폴더 — parentId 가 없으면 맨 위 */
export async function createFolder(db: Firestore, email: string, input: { name?: unknown; parentId?: unknown }): Promise<FolderView> {
  const name = cleanFolderName(input.name);
  const tree = folderTree(await listFolders(db));
  const parentId = input.parentId == null || input.parentId === "" ? null : String(input.parentId);
  if (parentId && !tree.byId.has(parentId)) throw new AccessError(404, "위 폴더를 찾지 못했습니다. 지워졌을 수 있습니다.");
  if (parentId && tree.depthOf(parentId) >= FOLDER_MAX_DEPTH) throw new Error(`폴더는 ${FOLDER_MAX_DEPTH}단까지 만들 수 있습니다.`);
  assertUniqueName(tree.children.get(parentId) ?? [], name);
  const now = Date.now();
  const id = randomBytes(9).toString("base64url");
  const doc: FolderDoc = { name, parentId, createdBy: email, createdAt: now, updatedAt: now };
  await col(db).doc(id).create(doc);
  return { ...doc, id };
}

export async function renameFolder(db: Firestore, _email: string, id: unknown, nameIn: unknown): Promise<void> {
  if (!isId(id)) throw new Error("폴더 id 가 올바르지 않습니다.");
  const name = cleanFolderName(nameIn);
  const tree = folderTree(await listFolders(db));
  const f = tree.byId.get(id);
  if (!f) throw new AccessError(404, "폴더를 찾지 못했습니다. 지워졌을 수 있습니다.");
  assertUniqueName(tree.children.get(tree.parentOf(id)) ?? [], name, id);
  await col(db).doc(id).update({ name, updatedAt: Date.now() });
}

/**
 * 폴더 지우기 — 하위 폴더도 함께. 안에 든 영상은 지우지 않고 폴더 밖으로 꺼낸다
 * (보는 사람이 못 보는 남의 비공개 영상도 — 없는 폴더를 가리키지 않게).
 */
export async function deleteFolder(db: Firestore, _email: string, id: unknown): Promise<{ folders: number; videos: number }> {
  if (!isId(id)) throw new Error("폴더 id 가 올바르지 않습니다.");
  const tree = folderTree(await listFolders(db));
  if (!tree.byId.has(id)) throw new AccessError(404, "폴더를 찾지 못했습니다. 지워졌을 수 있습니다.");
  const ids = [...tree.subtree(id)];
  let videos = 0;
  for (let i = 0; i < ids.length; i += 30) {
    const snap = await projects(db).where("folderId", "in", ids.slice(i, i + 30)).get();
    for (let j = 0; j < snap.docs.length; j += 400) {
      const batch = db.batch();
      for (const d of snap.docs.slice(j, j + 400)) batch.update(d.ref, { folderId: null });
      await batch.commit();
    }
    videos += snap.size;
  }
  for (let i = 0; i < ids.length; i += 400) {
    const batch = db.batch();
    for (const x of ids.slice(i, i + 400)) batch.delete(col(db).doc(x));
    await batch.commit();
  }
  return { folders: ids.length, videos };
}

/** 영상 옮기기 — folderId null = 폴더 밖. 고칠 수 없는 영상이 하나라도 있으면 아무것도 옮기지 않는다 */
export async function moveProjects(db: Firestore, email: string, idsIn: unknown, folderIdIn: unknown): Promise<number> {
  const ids = Array.isArray(idsIn) ? [...new Set(idsIn.filter(isId))].slice(0, 200) : [];
  if (!ids.length) throw new Error("옮길 영상을 골라 주세요.");
  const folderId = folderIdIn == null || folderIdIn === "" ? null : String(folderIdIn);
  if (folderId && !(await col(db).doc(folderId).get()).exists) throw new AccessError(404, "옮길 폴더를 찾지 못했습니다. 지워졌을 수 있습니다.");
  const refs = ids.map((id) => projects(db).doc(id));
  const snaps = await db.getAll(...refs);
  for (const s of snaps) {
    const p = s.data() as ProjectDoc | undefined;
    if (!p) throw new AccessError(404, "영상을 찾지 못했습니다. 지워졌을 수 있습니다.");
    if (!canEdit(p, email)) throw new AccessError(403, `「${p.title}」 은(는) 다른 사람의 비공개 영상이라 옮길 수 없습니다.`);
  }
  const batch = db.batch();
  for (const s of snaps) if ((s.data() as ProjectDoc).folderId !== folderId) batch.update(s.ref, { folderId });
  await batch.commit();
  return ids.length;
}
