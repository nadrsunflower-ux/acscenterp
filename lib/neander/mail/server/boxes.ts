import "server-only";

// ============================================================
//  메일함 동작 — 옮기기 · 읽음 · 중요 · 스팸 · 영구 삭제 · 폴더 · 외부 메일 · 주소록
// ------------------------------------------------------------
//  메일함이 하위 컬렉션이라(store.ts) 「옮기기」는 복사 + 지우기다. 한 번의
//  일괄 쓰기로 묶어 중간에 끊겨도 두 곳에 남거나 사라지지 않게 한다.
//
//  영구 삭제한 카페24 메일은 다음 확인 때 카페24 서버에서도 지운다
//  (pendingDelete → sync.ts). 네이버·Gmail 계정은 읽음·중요·영구 삭제를 바로
//  IMAP 으로 서버에 건다 (imap.ts). 「외부 메일 설정」으로 받아 온 메일의 서버는
//  건드리지 않는다.
// ============================================================

import { randomBytes } from "node:crypto";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { isCustomBox, type MailAddr, type MailBox, type MailContact, type MailFolder } from "../types";
import { sealSecret } from "./secret";
import { syncExternalNow, testPop } from "./sync";
import { deleteImap, isImapAccount, setImapFlag } from "./imap";
import {
  accountRef,
  boxRef,
  contactsRef,
  metaRef,
  readAccount,
  readPatch,
  starPatch,
  stripUndefined,
  type ExternalAccountDoc,
  type MailAccountDoc,
  type MailDoc,
} from "./store";

/** 한 번에 다루는 메일 수 — 일괄 쓰기 한도(500)의 절반 (옮기기는 문서당 2번 쓴다) */
const MAX_IDS = 200;

const cleanIds = (ids: unknown): string[] =>
  Array.isArray(ids)
    ? [...new Set(ids.filter((x): x is string => typeof x === "string" && /^[\w-]{1,80}$/.test(x)))].slice(0, MAX_IDS)
    : [];

async function readDocs(db: Firestore, owner: string, box: MailBox, ids: string[]) {
  if (!ids.length) return [];
  const snaps = await db.getAll(...ids.map((id) => boxRef(db, owner, box).doc(id)));
  return snaps.filter((s) => s.exists);
}

export async function moveMails(db: Firestore, owner: string, from: MailBox, rawIds: unknown, to: MailBox): Promise<number> {
  if (from === to) return 0;
  if (from === "drafts" || to === "drafts") throw new Error("임시보관함으로는 옮길 수 없습니다.");
  const docs = await readDocs(db, owner, from, cleanIds(rawIds));
  const batch = db.batch();
  for (const s of docs) {
    const { origin, ...rest } = s.data() as MailDoc;
    // 휴지통에서는 원래 자리를 기억해 되돌리기가 제자리로 간다
    const data = to === "trash" ? { ...rest, origin: from === "trash" ? origin : from } : rest;
    batch.set(boxRef(db, owner, to).doc(s.id), data);
    batch.delete(s.ref);
  }
  await batch.commit();
  return docs.length;
}

/** 휴지통에서 되돌리기 — 각자 원래 자리로 */
export async function restoreMails(db: Firestore, owner: string, rawIds: unknown): Promise<number> {
  const docs = await readDocs(db, owner, "trash", cleanIds(rawIds));
  const acc = await readAccount(db, owner);
  const folders = new Set((acc?.folders ?? []).map((f) => f.id));
  const batch = db.batch();
  for (const s of docs) {
    const { origin, ...rest } = s.data() as MailDoc;
    // 폴더가 지워졌으면 받은메일함으로
    const to: MailBox = origin && (!isCustomBox(origin) || folders.has(origin)) ? origin : "inbox";
    batch.set(boxRef(db, owner, to).doc(s.id), rest);
    batch.delete(s.ref);
  }
  await batch.commit();
  return docs.length;
}

/** 네이버·Gmail 이면 서버에도 표시를 건다 (카페24 POP3 는 표시가 없다) */
async function pushFlag(
  db: Firestore,
  owner: string,
  docs: FirebaseFirestore.DocumentSnapshot[],
  flag: "\\Seen" | "\\Flagged",
  on: boolean,
) {
  const refs = docs.map((s) => (s.data() as MailDoc).imap).filter((r): r is NonNullable<MailDoc["imap"]> => !!r);
  if (!refs.length) return;
  const acc = await readAccount(db, owner);
  if (acc && isImapAccount(acc)) await setImapFlag(acc, refs, flag, on).catch(() => undefined);
}

export async function setRead(db: Firestore, owner: string, box: MailBox, rawIds: unknown, read: boolean) {
  const docs = await readDocs(db, owner, box, cleanIds(rawIds));
  const batch = db.batch();
  for (const s of docs) batch.update(s.ref, readPatch(read, (s.data() as MailDoc).date));
  await batch.commit();
  await pushFlag(db, owner, docs, "\\Seen", read);
}

export async function setStar(db: Firestore, owner: string, box: MailBox, rawIds: unknown, starred: boolean) {
  const docs = await readDocs(db, owner, box, cleanIds(rawIds));
  const batch = db.batch();
  for (const s of docs) batch.update(s.ref, starPatch(starred, (s.data() as MailDoc).date));
  await batch.commit();
  await pushFlag(db, owner, docs, "\\Flagged", starred);
}

/** 스팸 신고 — 보낸 사람을 막고 스팸메일함으로. 다음부터 그 사람 메일은 바로 스팸함으로 간다 */
export async function markSpam(db: Firestore, owner: string, box: MailBox, rawIds: unknown): Promise<number> {
  const ids = cleanIds(rawIds);
  const docs = await readDocs(db, owner, box, ids);
  const senders = [...new Set(docs.map((s) => (s.data() as MailDoc).from.address.toLowerCase()).filter(Boolean))];
  if (senders.length) await accountRef(db, owner).update({ blocked: FieldValue.arrayUnion(...senders) });
  return moveMails(db, owner, box, ids, "spam");
}

/** 스팸 아님 — 막은 보낸 사람을 풀고 받은메일함으로 */
export async function markNotSpam(db: Firestore, owner: string, rawIds: unknown): Promise<number> {
  const ids = cleanIds(rawIds);
  const docs = await readDocs(db, owner, "spam", ids);
  const senders = [...new Set(docs.map((s) => (s.data() as MailDoc).from.address.toLowerCase()).filter(Boolean))];
  if (senders.length) await accountRef(db, owner).update({ blocked: FieldValue.arrayRemove(...senders) });
  return moveMails(db, owner, "spam", ids, "inbox");
}

export async function unblockSender(db: Firestore, owner: string, address: string) {
  await accountRef(db, owner).update({ blocked: FieldValue.arrayRemove(address.toLowerCase()) });
}

/** 영구 삭제 — ERP 에서 지우고, 카페24 원문은 다음 확인 때 서버에서도 지운다 */
export async function purgeMails(db: Firestore, owner: string, box: MailBox, rawIds: unknown): Promise<number> {
  if (box !== "trash" && box !== "spam") throw new Error("휴지통·스팸메일함에서만 영구 삭제할 수 있습니다.");
  const docs = await readDocs(db, owner, box, cleanIds(rawIds));
  const hashes: string[] = [];
  const imapRefs: NonNullable<MailDoc["imap"]>[] = [];
  const batch = db.batch();
  for (const s of docs) {
    const d = s.data() as MailDoc;
    if (d.imap) imapRefs.push(d.imap);
    else if (d.uidlHash && !d.acct) hashes.push(d.uidlHash);
    batch.delete(s.ref);
  }
  await batch.commit();
  // 카페24 는 다음 확인 때 POP3 로 지우고, 네이버·Gmail 은 바로 IMAP 으로 지운다
  if (hashes.length) await accountRef(db, owner).update({ pendingDelete: FieldValue.arrayUnion(...hashes) });
  if (imapRefs.length) {
    const acc = await readAccount(db, owner);
    if (acc && isImapAccount(acc)) await deleteImap(acc, imapRefs).catch(() => undefined);
  }
  return docs.length;
}

/** 휴지통·스팸메일함 비우기 */
export async function emptyBox(db: Firestore, owner: string, box: MailBox): Promise<number> {
  let total = 0;
  for (;;) {
    const snap = await boxRef(db, owner, box).select().limit(MAX_IDS).get();
    if (snap.empty) break;
    total += await purgeMails(db, owner, box, snap.docs.map((d) => d.id));
  }
  return total;
}

// ---- 내 메일함 (폴더) ----------------------------------------

const newFolderId = () => `f_${randomBytes(8).toString("hex").slice(0, 8)}` as `f_${string}`;

async function editFolders(db: Firestore, owner: string, fn: (list: MailFolder[]) => MailFolder[]): Promise<MailFolder[]> {
  const ref = accountRef(db, owner);
  return db.runTransaction(async (tx) => {
    const a = (await tx.get(ref)).data() as MailAccountDoc | undefined;
    if (!a) throw new Error("연결된 메일 계정이 없습니다.");
    const next = fn([...(a.folders ?? [])]);
    tx.update(ref, { folders: next });
    return next;
  });
}

const folderName = (s: unknown) => {
  const name = String(s ?? "").trim().slice(0, 40);
  if (!name) throw new Error("메일함 이름을 넣어 주세요.");
  return name;
};

export const createFolder = (db: Firestore, owner: string, name: unknown) =>
  editFolders(db, owner, (list) => {
    const n = folderName(name);
    if (list.some((f) => f.name === n)) throw new Error("같은 이름의 메일함이 있습니다.");
    return [...list, { id: newFolderId(), name: n, shared: false }];
  });

export const renameFolder = (db: Firestore, owner: string, id: string, name: unknown) =>
  editFolders(db, owner, (list) => list.map((f) => (f.id === id ? { ...f, name: folderName(name) } : f)));

export const shareFolder = (db: Firestore, owner: string, id: string, shared: boolean) =>
  editFolders(db, owner, (list) => list.map((f) => (f.id === id ? { ...f, shared } : f)));

/** 폴더 지우기 — 안의 메일은 휴지통으로 */
export async function deleteFolder(db: Firestore, owner: string, id: string): Promise<MailFolder[]> {
  if (!isCustomBox(id)) throw new Error("알 수 없는 메일함입니다.");
  for (;;) {
    const snap = await boxRef(db, owner, id).select().limit(MAX_IDS).get();
    if (snap.empty) break;
    await moveMails(db, owner, id, snap.docs.map((d) => d.id), "trash");
  }
  return editFolders(db, owner, (list) => list.filter((f) => f.id !== id));
}

// ---- 외부 메일 설정 ------------------------------------------

export async function addExternal(
  db: Firestore,
  owner: string,
  input: { label?: string; address?: string; host?: string; password?: string },
) {
  const address = String(input.address ?? "").trim();
  const host = String(input.host ?? "").trim().toLowerCase();
  const password = String(input.password ?? "");
  if (!address || !password) throw new Error("아이디(메일 주소)와 비밀번호를 넣어 주세요.");
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host)) throw new Error("받는 서버(POP3) 주소를 확인해 주세요.");
  const acc = await readAccount(db, owner);
  if (!acc) throw new Error("먼저 회사 메일을 연결해 주세요.");
  if ((acc.externals ?? []).some((x) => x.address.toLowerCase() === address.toLowerCase() && x.host === host)) {
    throw new Error("이미 연결한 외부 메일입니다.");
  }

  await testPop(host, address, password, true);
  const id = randomBytes(4).toString("hex");
  const ext: ExternalAccountDoc = {
    id,
    label: String(input.label ?? "").trim().slice(0, 30) || address,
    address,
    host,
    secret: sealSecret(password, `${owner}#${id}`),
    initialized: false,
    stat: null,
    lastError: null,
    authFailed: false,
    authFailCount: 0,
  };
  await accountRef(db, owner).update({ externals: FieldValue.arrayUnion(ext) });
  return syncExternalNow(db, owner, id);
}

export async function updateExternalPassword(db: Firestore, owner: string, id: string, password: string) {
  const acc = await readAccount(db, owner);
  const ext = acc?.externals?.find((x) => x.id === id);
  if (!acc || !ext) throw new Error("외부 메일을 찾지 못했습니다.");
  await testPop(ext.host, ext.address, password, true);
  const externals = (acc.externals ?? []).map((x) =>
    x.id === id
      ? { ...x, secret: sealSecret(password, `${owner}#${id}`), authFailed: false, authFailCount: 0, lastError: null }
      : x,
  );
  await accountRef(db, owner).update({ externals });
}

/** 외부 메일 끊기 — 이미 가져온 메일은 남긴다 */
export async function removeExternal(db: Firestore, owner: string, id: string) {
  const acc = await readAccount(db, owner);
  if (!acc) return;
  await accountRef(db, owner).update({ externals: (acc.externals ?? []).filter((x) => x.id !== id) });
  await metaRef(db, owner, id).delete();
}

// ---- 주소록 --------------------------------------------------

export async function addContact(db: Firestore, owner: string, c: MailAddr) {
  const address = c.address.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) throw new Error("메일 주소 형식이 아닙니다.");
  const ref = contactsRef(db, owner);
  await db.runTransaction(async (tx) => {
    const list = (((await tx.get(ref)).data()?.list as MailContact[] | undefined) ?? []).slice();
    const hit = list.find((x) => x.address.toLowerCase() === address.toLowerCase());
    if (hit) {
      hit.manual = true;
      if (c.name) hit.name = c.name;
    } else {
      list.unshift(stripUndefined({ address, name: c.name?.trim() || undefined, count: 0, last: 0, manual: true }));
    }
    tx.set(ref, { list });
  });
}

export async function removeContact(db: Firestore, owner: string, address: string) {
  const ref = contactsRef(db, owner);
  await db.runTransaction(async (tx) => {
    const list = ((await tx.get(ref)).data()?.list as MailContact[] | undefined) ?? [];
    tx.set(ref, { list: list.filter((x) => x.address.toLowerCase() !== address.toLowerCase()) });
  });
}
