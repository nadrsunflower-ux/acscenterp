import "server-only";

// 재무 첨부파일 원본은 재무 권한 뒤의 Firestore 조각으로 보관한다 — 지원사업 서류와 프로젝트 자료가 같이 쓴다.
// 파일은 주인 문서(지원사업·프로젝트) 본문과 분리하므로 본문의 자동 저장이 첨부를 덮지 않는다.
// 검증 중에는 조각을 고칠 수 없고, 크기와 SHA256이 맞아야 목록에 나타난다.

import { createHash, randomBytes } from "node:crypto";
import type { DocumentReference, DocumentSnapshot, Firestore, Transaction } from "firebase-admin/firestore";
import { NEANDER_COL } from "@/lib/neander/collections";
import {
  ATTACHED_FILE_PART_BYTES,
  ATTACHED_FILE_READ_PARTS,
  MAX_ATTACHED_FILES,
  validateAttachedFileMeta,
  withObjectParticle,
  type AttachedFile,
} from "../attached-files";

/** 첨부파일의 주인 — 어느 컬렉션의 문서에 매이는가 */
export interface AttachedFileOwner {
  /** 파일 머리 문서 컬렉션 (조각은 그 아래 parts/{n}) */
  files: string;
  /** 주인 문서 컬렉션 */
  parent: string;
  /** 머리 문서에서 주인 id 를 담는 필드 — 지원사업은 grantId, 프로젝트는 projectId */
  key: string;
  /** 안내 문구에 쓰는 주인 이름 */
  label: string;
}

type FileState = "uploading" | "verifying" | "ready" | "deleting";

interface StoredFile extends Omit<AttachedFile, "id" | "uploadedBy"> {
  uploadedBy: string;
  createdAt: number;
  updatedAt: number;
  state: FileState;
  parts: number;
  verificationToken?: string | null;
  deletionToken?: string | null;
}

const HASH_READ_PARTS = 10;
const STALE_MS = 24 * 60 * 60 * 1000;
const MAX_STALE_CLEANUP = 2;
const ACTIVITY_UPDATE_MS = 60 * 1000;
const isId = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{8,128}$/.test(value);
const token = () => randomBytes(18).toString("base64url");
const partRef = (ref: DocumentReference, n: number) => ref.collection("parts").doc(String(n));

function assertId(value: unknown, label: string): asserts value is string {
  if (!isId(value)) throw new Error(`${label} id가 올바르지 않습니다.`);
}

function assertUploader(by: string) {
  if (typeof by !== "string" || !by.trim() || by.length > 320) throw new Error("올린 사람을 확인할 수 없습니다.");
}

const view = (id: string, data: StoredFile): AttachedFile => ({
  id,
  name: data.name,
  type: data.type,
  size: data.size,
  sha256: data.sha256,
  uploadedAt: data.uploadedAt,
  uploadedBy: data.uploadedBy,
});

// 삭제는 이미 쓰기를 잠갔으므로 중단된 정리를 하루 기다리지 않고 재시도한다.
const isStale = (data: StoredFile) => data.state === "deleting" || (data.state !== "ready" && data.updatedAt < Date.now() - STALE_MS);

function expectedPartSize(file: StoredFile, n: number) {
  if (!Number.isInteger(n) || n < 0 || n >= file.parts) throw new Error("파일 조각 번호가 올바르지 않습니다.");
  return Math.min(ATTACHED_FILE_PART_BYTES, file.size - n * ATTACHED_FILE_PART_BYTES);
}

async function readParts(db: Firestore, ref: DocumentReference, file: StoredFile, from: number, count: number): Promise<Buffer[]> {
  const refs = Array.from({ length: Math.min(count, file.parts - from) }, (_, offset) => partRef(ref, from + offset));
  const snapshots = await db.getAll(...refs);
  const byPath = new Map(snapshots.map((snapshot) => [snapshot.ref.path, snapshot]));
  return refs.map((expected, offset) => {
    const snapshot = byPath.get(expected.path);
    const raw = snapshot?.data()?.data;
    if (!snapshot?.exists || !(raw instanceof Uint8Array)) throw new Error("첨부파일의 조각이 빠져 있습니다. 다시 올려 주세요.");
    const bytes = Buffer.from(raw);
    if (bytes.length !== expectedPartSize(file, from + offset)) throw new Error("저장된 파일 조각의 크기가 맞지 않습니다.");
    return bytes;
  });
}

export type CreateAttachedFileResult = { id: string; parts: number; partBytes: number } | { duplicate: AttachedFile };

/** 주인 하나에 대한 첨부 저장소 — 목록 · 올리기(만들기 → 조각 → 확인) · 읽기 · 삭제 */
export function attachedFileStore(owner: AttachedFileOwner) {
  const { key, label } = owner;
  const labelObj = withObjectParticle(label);
  const col = (db: Firestore) => db.collection(owner.files);
  const fileRef = (db: Firestore, id: string) => col(db).doc(id);
  const ownerRef = (db: Firestore, ownerId: string) => db.collection(owner.parent).doc(ownerId);

  function parseFile(snapshot: DocumentSnapshot, ownerId: string): StoredFile {
    if (!snapshot.exists) throw new Error("첨부파일을 찾지 못했습니다.");
    const data = snapshot.data() as StoredFile & Record<string, unknown>;
    if (data[key] !== ownerId) throw new Error(`이 ${label}의 첨부파일이 아닙니다.`);
    const parsed = validateAttachedFileMeta(data);
    if (!parsed.ok || parsed.value.name !== data.name || parsed.value.type !== data.type ||
        parsed.value.size !== data.size || parsed.value.sha256 !== data.sha256 ||
        !["uploading", "verifying", "ready", "deleting"].includes(data.state) ||
        !Number.isInteger(data.parts) || data.parts !== Math.ceil(data.size / ATTACHED_FILE_PART_BYTES) ||
        typeof data.uploadedBy !== "string" || !data.uploadedBy || !Number.isFinite(data.createdAt) ||
        !Number.isFinite(data.updatedAt) || !Number.isFinite(data.uploadedAt)) {
      throw new Error("첨부파일 정보가 올바르지 않습니다.");
    }
    return data;
  }

  async function requireOwner(db: Firestore, id: unknown): Promise<string> {
    assertId(id, label);
    if (!(await ownerRef(db, id).get()).exists) throw new Error(`${labelObj} 찾지 못했습니다.`);
    return id;
  }

  async function getFile(db: Firestore, ownerId: unknown, id: unknown): Promise<StoredFile> {
    assertId(ownerId, label);
    assertId(id, "첨부파일");
    const parentRef = ownerRef(db, ownerId);
    const targetRef = fileRef(db, id);
    const snapshots = await db.getAll(parentRef, targetRef);
    const parent = snapshots.find((snapshot) => snapshot.ref.path === parentRef.path);
    const file = snapshots.find((snapshot) => snapshot.ref.path === targetRef.path);
    if (!parent?.exists) throw new Error(`${labelObj} 찾지 못했습니다.`);
    if (!file) throw new Error("첨부파일을 찾지 못했습니다.");
    return parseFile(file, ownerId);
  }

  async function inTransaction(tx: Transaction, db: Firestore, ownerId: string, id: string): Promise<StoredFile> {
    const parent = await tx.get(ownerRef(db, ownerId));
    if (!parent.exists) throw new Error(`${labelObj} 찾지 못했습니다.`);
    return parseFile(await tx.get(fileRef(db, id)), ownerId);
  }

  /** parts를 먼저 지워야 중간 실패 시 재정리할 head가 남는다. */
  async function deleteLockedFile(db: Firestore, ownerId: string, id: string, deletionToken: string, parentExists: boolean) {
    const ref = fileRef(db, id);
    await db.recursiveDelete(ref.collection("parts"));
    await db.runTransaction(async (tx) => {
      const parent = await tx.get(ownerRef(db, ownerId));
      const snapshot = await tx.get(ref);
      if (parent.exists !== parentExists) throw new Error(`${label}의 삭제 상태가 바뀌었습니다. 다시 시도해 주세요.`);
      if (!snapshot.exists) return;
      const current = parseFile(snapshot, ownerId);
      if (current.state !== "deleting" || current.deletionToken !== deletionToken) throw new Error("첨부파일 상태가 바뀌었습니다.");
      tx.delete(ref);
    });
  }

  async function lockForDeletion(db: Firestore, ownerId: string, id: string, parentExists: boolean, staleOnly = false): Promise<string | null> {
    return db.runTransaction(async (tx) => {
      const parent = await tx.get(ownerRef(db, ownerId));
      const snapshot = await tx.get(fileRef(db, id));
      if (parent.exists !== parentExists) throw new Error(parentExists ? `${labelObj} 찾지 못했습니다.` : `${labelObj} 먼저 삭제해 주세요.`);
      if (!snapshot.exists) return null;
      const current = parseFile(snapshot, ownerId);
      // 목록 조회 후 수령 완료됐거나 업로드가 다시 진행된 파일은 정리하지 않는다.
      if (staleOnly && !isStale(current)) return null;
      const deletionToken = current.state === "deleting" && current.deletionToken ? current.deletionToken : token();
      tx.update(snapshot.ref, { state: "deleting", deletionToken, updatedAt: Date.now() });
      return deletionToken;
    });
  }

  async function cleanupStale(db: Firestore, ownerId: string, preferredSha256?: string) {
    const snapshot = await col(db).where(key, "==", ownerId).get();
    const stale = snapshot.docs
      .map((doc) => ({ id: doc.id, data: parseFile(doc, ownerId) }))
      .filter((file) => isStale(file.data))
      .sort((a, b) => Number(b.data.sha256 === preferredSha256) - Number(a.data.sha256 === preferredSha256) || a.data.updatedAt - b.data.updatedAt)
      .slice(0, MAX_STALE_CLEANUP);
    for (const file of stale) {
      // 중단된 업로드 정리에 실패해도 완성된 서류의 조회를 막지 않는다.
      try {
        const deletionToken = await lockForDeletion(db, ownerId, file.id, true, true);
        if (deletionToken) await deleteLockedFile(db, ownerId, file.id, deletionToken, true);
      } catch {
        // 다음 목록 조회나 업로드 요청에서 다시 정리한다.
      }
    }
  }

  async function list(db: Firestore, ownerId: string): Promise<AttachedFile[]> {
    await requireOwner(db, ownerId);
    await cleanupStale(db, ownerId);
    await requireOwner(db, ownerId);
    const snapshot = await col(db).where(key, "==", ownerId).get();
    return snapshot.docs
      .map((doc) => ({ id: doc.id, data: parseFile(doc, ownerId) }))
      .filter((file) => file.data.state === "ready")
      .map((file) => view(file.id, file.data))
      .sort((a, b) => b.uploadedAt - a.uploadedAt || a.id.localeCompare(b.id));
  }

  async function create(
    db: Firestore,
    by: string,
    ownerIdRaw: unknown,
    raw: { name?: unknown; type?: unknown; size?: unknown; sha256?: unknown },
  ): Promise<CreateAttachedFileResult> {
    assertUploader(by);
    const ownerId = await requireOwner(db, ownerIdRaw);
    const checked = validateAttachedFileMeta(raw);
    if (!checked.ok) throw new Error(checked.error);
    const meta = checked.value;
    await cleanupStale(db, ownerId, meta.sha256);
    const id = token();
    return db.runTransaction(async (tx) => {
      if (!(await tx.get(ownerRef(db, ownerId))).exists) throw new Error(`${labelObj} 찾지 못했습니다.`);
      const existing = await tx.get(col(db).where(key, "==", ownerId));
      const records = existing.docs.map((doc) => ({ id: doc.id, data: parseFile(doc, ownerId) }));
      const duplicate = records.find((file) => file.data.sha256 === meta.sha256 && file.data.state === "ready");
      if (duplicate) return { duplicate: view(duplicate.id, duplicate.data) };
      if (records.some((file) => file.data.sha256 === meta.sha256)) throw new Error("같은 파일을 올리거나 확인하는 중입니다. 잠시 후 다시 시도해 주세요.");
      if (records.length >= MAX_ATTACHED_FILES) throw new Error(`${label} 하나에는 파일을 ${MAX_ATTACHED_FILES}개까지 첨부할 수 있습니다.`);
      const now = Date.now();
      const parts = Math.ceil(meta.size / ATTACHED_FILE_PART_BYTES);
      const data: StoredFile & Record<string, unknown> = {
        ...meta, [key]: ownerId, uploadedBy: by, uploadedAt: now, createdAt: now, updatedAt: now, parts, state: "uploading",
      };
      tx.create(fileRef(db, id), data);
      return { id, parts, partBytes: ATTACHED_FILE_PART_BYTES };
    });
  }

  async function putPart(db: Firestore, by: string, ownerId: string, id: string, n: number, bytes: Buffer): Promise<void> {
    assertUploader(by);
    assertId(ownerId, label);
    assertId(id, "첨부파일");
    if (!Buffer.isBuffer(bytes)) throw new Error("파일 조각 형식이 올바르지 않습니다.");
    await db.runTransaction(async (tx) => {
      const current = await inTransaction(tx, db, ownerId, id);
      if (current.uploadedBy !== by || current.state !== "uploading") throw new Error("이 파일에는 조각을 더 넣을 수 없습니다.");
      if (bytes.length !== expectedPartSize(current, n)) throw new Error("파일 조각의 크기가 맞지 않습니다.");
      tx.set(partRef(fileRef(db, id), n), { data: bytes });
      // 업로드가 하루 이상 중단된 파일만 정리한다. 병렬 조각마다 head를 덮지는 않는다.
      if (Date.now() - current.updatedAt >= ACTIVITY_UPDATE_MS) tx.update(fileRef(db, id), { updatedAt: Date.now() });
    });
  }

  async function complete(db: Firestore, by: string, ownerId: string, id: string): Promise<AttachedFile> {
    assertUploader(by);
    assertId(ownerId, label);
    assertId(id, "첨부파일");
    const verificationToken = token();
    const locked = await db.runTransaction(async (tx) => {
      const current = await inTransaction(tx, db, ownerId, id);
      if (current.uploadedBy !== by) throw new Error("올리기 시작한 사람만 파일 확인을 마칠 수 있습니다.");
      if (current.state === "ready") return { ready: current };
      if (current.state !== "uploading") throw new Error("파일을 확인하거나 지우는 중입니다. 잠시 후 다시 시도해 주세요.");
      tx.update(fileRef(db, id), { state: "verifying", verificationToken, updatedAt: Date.now() });
      return { verifying: current };
    });
    if (locked.ready) return view(id, locked.ready);
    const original = locked.verifying!;
    try {
      const aggregate = await fileRef(db, id).collection("parts").count().get();
      if (aggregate.data().count !== original.parts) throw new Error("파일 조각이 모두 올라오지 않았습니다. 다시 올려 주세요.");
      const hash = createHash("sha256");
      let size = 0;
      for (let from = 0; from < original.parts; from += HASH_READ_PARTS) {
        for (const bytes of await readParts(db, fileRef(db, id), original, from, HASH_READ_PARTS)) {
          size += bytes.length;
          hash.update(bytes);
        }
      }
      if (size !== original.size || hash.digest("hex") !== original.sha256) throw new Error("파일 내용이 원본과 다릅니다. 다시 올려 주세요.");
      return await db.runTransaction(async (tx) => {
        const current = await inTransaction(tx, db, ownerId, id);
        if (current.state !== "verifying" || current.verificationToken !== verificationToken ||
            current.sha256 !== original.sha256 || current.size !== original.size || current.parts !== original.parts) {
          throw new Error("파일 확인 중 첨부 상태가 바뀌었습니다. 다시 시도해 주세요.");
        }
        const uploadedAt = Date.now();
        tx.update(fileRef(db, id), { state: "ready", uploadedAt, updatedAt: uploadedAt, verificationToken: null });
        return view(id, { ...current, uploadedAt, state: "ready", verificationToken: null });
      });
    } catch (error) {
      // 삭제나 다른 확인 작업이 가져간 잠금을 되돌리지 않는다.
      await db.runTransaction(async (tx) => {
        const parent = await tx.get(ownerRef(db, ownerId));
        const snapshot = await tx.get(fileRef(db, id));
        if (!parent.exists || !snapshot.exists) return;
        const current = parseFile(snapshot, ownerId);
        if (current.state === "verifying" && current.verificationToken === verificationToken) {
          tx.update(snapshot.ref, { state: "uploading", verificationToken: null, updatedAt: Date.now() });
        }
      }).catch(() => undefined);
      throw error;
    }
  }

  async function read(db: Firestore, ownerId: string, id: string, from: number, count: number): Promise<Buffer> {
    if (!Number.isInteger(from) || from < 0 || !Number.isInteger(count) || count < 1 || count > ATTACHED_FILE_READ_PARTS) throw new Error("파일 조각 범위가 올바르지 않습니다.");
    const current = await getFile(db, ownerId, id);
    if (current.state !== "ready") throw new Error("아직 열 수 없는 첨부파일입니다.");
    if (from >= current.parts) throw new Error("파일 조각 범위가 올바르지 않습니다.");
    return Buffer.concat(await readParts(db, fileRef(db, id), current, from, count));
  }

  async function remove(db: Firestore, ownerId: string, id: string): Promise<void> {
    assertId(ownerId, label);
    assertId(id, "첨부파일");
    const deletionToken = await lockForDeletion(db, ownerId, id, true);
    if (deletionToken) await deleteLockedFile(db, ownerId, id, deletionToken, true);
  }

  /** 주인을 먼저 삭제해 새 첨부 생성을 막은 뒤 남은 원본을 정리한다. */
  async function removeAllFor(db: Firestore, ownerId: string): Promise<void> {
    assertId(ownerId, label);
    if ((await ownerRef(db, ownerId).get()).exists) throw new Error(`${labelObj} 먼저 삭제해 주세요.`);
    const snapshot = await col(db).where(key, "==", ownerId).get();
    for (const file of snapshot.docs) {
      const deletionToken = await lockForDeletion(db, ownerId, file.id, false);
      if (deletionToken) await deleteLockedFile(db, ownerId, file.id, deletionToken, false);
    }
  }

  return { key, list, create, putPart, complete, read, remove, removeAllFor };
}

export type AttachedFileStore = ReturnType<typeof attachedFileStore>;

/** 지원사업 서류 — 사업계획서 · 협약서 · 정산 증빙 */
export const grantFiles = attachedFileStore({
  files: NEANDER_COL.finGrantFiles, parent: NEANDER_COL.finGrants, key: "grantId", label: "지원사업",
});

/** 프로젝트 자료 — 제안서 · 발주처 자료 등 견적·계약서 밖의 파일 */
export const projectFiles = attachedFileStore({
  files: NEANDER_COL.finProjectFiles, parent: NEANDER_COL.finProjects, key: "projectId", label: "프로젝트",
});
