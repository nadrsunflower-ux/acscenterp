"use client";

// ============================================================
//  메일 클라이언트 — 서버 API 경유
// ------------------------------------------------------------
//  메일 비밀번호가 서버에만 있고 카페24 와는 서버만 말한다. 브라우저는
//  ERP 서버에 묻기만 한다 (app/api/neander/mail/*).
//
//  첨부는 Vercel 요청 한도(4.5MB) 때문에 조각으로 나눠 올린다 (uploadBlob).
//  큰 받은 첨부도 조각으로 나눠 받아 붙인다 (downloadMailAttachment).
//
//  메일 계정을 여러 개 로그인해 둘 수 있다. 요청마다 「지금 보는 계정」
//  (setActiveMailAccount)을 acct 로 붙이고, 다른 계정이 필요한 곳(보내는 계정
//  고르기·공유 메일함)은 acct 를 직접 넘긴다.
// ============================================================

import { getNeanderAuth } from "@/lib/neander/firebase";
import {
  BLOB_PART_BYTES,
  type MailAccountView,
  type MailBlobRef,
  type MailBox,
  type MailComposeState,
  type MailContact,
  type MailCounts,
  type MailDetail,
  type MailFilter,
  type MailListResult,
  type MailProvider,
  type MailReceipt,
  type MailSendInput,
  type MailSignatureSet,
  type MailSummary,
  type MailSyncResult,
  type MailView,
  type SharedFolder,
} from "./types";

const BASE = "/api/neander/mail";

/** 지금 보는 메일 계정 — MailProvider 가 정한다 */
let ACTIVE: string | undefined;
export const setActiveMailAccount = (key: string | undefined) => {
  ACTIVE = key;
};

async function token(): Promise<string> {
  const user = getNeanderAuth().currentUser;
  if (!user) throw new Error("로그인이 필요합니다.");
  return user.getIdToken();
}

async function readError(res: Response): Promise<string> {
  try {
    return ((await res.json()) as { error?: string }).error || `요청이 실패했습니다 (HTTP ${res.status})`;
  } catch {
    return `요청이 실패했습니다 (HTTP ${res.status})`;
  }
}

const withAcct = (url: string, acct: string | undefined) =>
  !acct || /[?&]acct=/.test(url) ? url : `${url}${url.includes("?") ? "&" : "?"}acct=${encodeURIComponent(acct)}`;

async function get<T>(url: string, acct: string | undefined = ACTIVE): Promise<T> {
  const res = await fetch(withAcct(url, acct), { headers: { Authorization: `Bearer ${await token()}` }, cache: "no-store" });
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as T;
}

async function post<T>(url: string, body: object, acct: string | undefined = ACTIVE): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ acct, ...body }),
  });
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as T;
}

const act = <T = { counts: MailCounts }>(action: string, body: object = {}) => post<T>(BASE, { action, ...body });

// ---- 상태 · 목록 --------------------------------------------

export interface MailStatus {
  /** 내가 로그인해 둔 메일 계정들 (계정마다 메일함 수가 붙어 있다) */
  accounts: MailAccountView[];
  /** 서버에 NEANDER_MAIL_KEY 가 있는가 — 없으면 연결할 수 없다 */
  configured: boolean;
  shared?: SharedFolder[];
}

export const fetchMailStatus = () => get<MailStatus>(BASE, undefined);

/** acct: 그 계정의 메일함 (내 다른 계정 · 동료의 공유 메일함). 없으면 지금 보는 계정 */
export function fetchMailList(
  view: MailView,
  opts: { filter?: MailFilter; before?: number; acct?: string } = {},
): Promise<{ list: MailListResult }> {
  if (view === "scheduled") return get(`${BASE}?view=scheduled`, opts.acct ?? ACTIVE);
  const q = new URLSearchParams({ box: view });
  if (opts.filter) q.set("filter", opts.filter);
  if (opts.before) q.set("before", String(opts.before));
  return get(`${BASE}?${q}`, opts.acct ?? ACTIVE);
}

/**
 * 메일 한 통을 회의(또는 어느 회의의 안건)로 옮긴다 — 첨부까지.
 * 서버가 메일 서버에서 원문을 받아 첨부를 회의 첨부로 옮긴다 (api/mail/handoff).
 */
export async function mailToMeeting(input: {
  acct?: string;
  box: MailBox;
  id: string;
  parentId?: string;
  date?: string;
  title?: string;
  attachments?: number[];
}): Promise<{ meetingId: string; files: number; skipped: { name: string; reason: string }[] }> {
  const res = await fetch("/api/neander/mail/handoff", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token()}` },
    body: JSON.stringify(input),
  });
  const body = (await res.json()) as { meetingId?: string; files?: number; skipped?: { name: string; reason: string }[]; error?: string };
  if (!res.ok || !body.meetingId) throw new Error(body.error ?? `요청이 실패했습니다 (HTTP ${res.status})`);
  return { meetingId: body.meetingId, files: body.files ?? 0, skipped: body.skipped ?? [] };
}

export const fetchReceipts = () => get<{ receipts: MailReceipt[] }>(`${BASE}?view=receipts`);

export const fetchContacts = () =>
  get<{ contacts: MailContact[]; team: { name?: string; address: string }[] }>(`${BASE}?view=contacts`);

export function fetchMailMessage(view: MailView, id: string, opts: { full?: boolean; acct?: string } = {}) {
  const q = new URLSearchParams({ box: view, id });
  if (opts.full) q.set("full", "1");
  return get<{ message: MailDetail; wasUnread?: boolean }>(`${BASE}/message?${q}`, opts.acct ?? ACTIVE);
}

// ---- 계정 ----------------------------------------------------

/** add: 계정을 하나 더 붙인다. 아니면 지금 계정을 (다시) 연결. provider: 카페24 · 네이버 · Gmail */
export const connectMail = (address: string, password: string, name: string, add = false, provider: MailProvider = "cafe24") =>
  act<{ key: string; accounts: MailAccountView[]; sync: MailSyncResult }>("connect", { address, password, name, add, provider });

/** acct 를 주면 그 계정 (계정 목록에서 별칭을 고칠 때) */
export const updateMail = (
  patch: {
    label?: string;
    /** 빈 값이면 지운다 */
    avatarPhoto?: string;
    avatarEmoji?: string;
    avatarColor?: string;
    name?: string;
    signature?: string;
    keepSentCopy?: boolean;
    trackOpens?: boolean;
    quotaMB?: number;
    password?: string;
  },
  acct?: string,
) => post<{ account: MailAccountView }>(BASE, { action: "update", ...patch }, acct ?? ACTIVE);

export const disconnectMail = () => act<{ ok: true }>("disconnect");

/** 팀 공용 켜고 끄기 — 켜면 ERP 팀원 모두의 계정 목록에 나온다 (연결한 사람만) */
export const setTeamAccount = (team: boolean) => act<{ account: MailAccountView }>("team", { team });

/** 서명 목록과 새 메일·답장 기본 서명을 통째로 저장한다 */
export const saveSignatures = (set: MailSignatureSet) =>
  act<{ account: MailAccountView }>("signatures", { list: set.list, sigNew: set.sigNew ?? null, sigReply: set.sigReply ?? null });

/** 모든 계정을 확인한다 — 결과는 계정 키별 */
export const syncMail = (force = false) =>
  post<{ syncs: Record<string, MailSyncResult> }>(BASE, { action: "sync", force }, undefined);

/** box: 보낸메일함은 네이버·Gmail 계정만 (서버 보낸메일함을 바로 읽는다) */
export const importOlderMail = (box: "inbox" | "sent" = "inbox") => act<{ sync: MailSyncResult; counts: MailCounts }>("older", { box });

// ---- 메일 여러 통 --------------------------------------------

export const markRead = (box: MailBox, ids: string[], read: boolean) => act("read", { box, ids, read });
export const markStar = (box: MailBox, ids: string[], starred: boolean) => act("star", { box, ids, starred });
export const moveMail = (box: MailBox, ids: string[], to: MailBox) => act("move", { box, ids, to });
export const trashMail = (box: MailBox, ids: string[]) => act("trash", { box, ids });
export const restoreMail = (ids: string[]) => act("restore", { ids });
export const reportSpam = (box: MailBox, ids: string[]) => act("spam", { box, ids });
export const notSpam = (ids: string[]) => act<{ counts: MailCounts; account: MailAccountView }>("notSpam", { ids });
export const unblockSender = (address: string) => act<{ account: MailAccountView }>("unblock", { address });
export const purgeMail = (box: MailBox, ids: string[]) => act("purge", { box, ids });
export const emptyMailBox = (box: "trash" | "spam") => act("empty", { box });

// ---- 내 메일함 · 외부 메일 · 주소록 ---------------------------

export const createFolder = (name: string) => act<{ account: MailAccountView }>("folderCreate", { name });
export const renameFolder = (id: string, name: string) => act<{ account: MailAccountView }>("folderRename", { id, name });
export const shareFolder = (id: string, shared: boolean) => act<{ account: MailAccountView }>("folderShare", { id, shared });
export const deleteFolder = (id: string) => act<{ account: MailAccountView; counts: MailCounts }>("folderDelete", { id });

export const addExternal = (input: { label: string; address: string; host: string; password: string }) =>
  act<{ account: MailAccountView; added: MailSummary[]; counts: MailCounts }>("externalAdd", input);
export const setExternalPassword = (id: string, password: string) =>
  act<{ account: MailAccountView }>("externalPassword", { id, password });
export const removeExternal = (id: string) => act<{ account: MailAccountView }>("externalRemove", { id });

export const addContact = (name: string, address: string) => act<{ contacts: MailContact[] }>("contactAdd", { name, address });
export const removeContact = (address: string) => act<{ contacts: MailContact[] }>("contactRemove", { address });

// ---- 쓰기 · 임시저장 · 예약 ----------------------------------

/** acct: 임시저장을 둘 계정 (보내는 계정) */
export const saveDraft = (compose: MailComposeState, draftId?: string, acct?: string) =>
  post<{ draft: MailSummary; counts: MailCounts }>(BASE, { action: "draftSave", compose, draftId }, acct ?? ACTIVE);
export const deleteDrafts = (ids: string[]) => act("draftDelete", { ids });
export const cancelSchedule = (id: string) => act<{ draft: MailSummary; counts: MailCounts }>("scheduleCancel", { id });
export const sendScheduleNow = (id: string) => act("scheduleNow", { id });

/** acct: 보내는 계정 */
export const sendMailNow = (input: MailSendInput, acct?: string) =>
  post<{ sent?: MailSummary | null; failed?: string[]; scheduled?: MailSummary }>(`${BASE}/send`, input, acct ?? ACTIVE);

// ---- 첨부 조각 ------------------------------------------------

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** 파일을 조각으로 올린다 — 진행률(0~1)을 알려 준다 */
export async function uploadBlob(file: File | Blob, name: string, onProgress?: (p: number) => void): Promise<MailBlobRef> {
  const type = file.type || "application/octet-stream";
  const { id, partBytes, parts } = await post<{ id: string; partBytes: number; parts: number }>(`${BASE}/blob`, {
    action: "create",
    name,
    type,
    size: file.size,
  });
  let done = 0;
  const one = async (n: number) => {
    const buf = await file.slice(n * partBytes, (n + 1) * partBytes).arrayBuffer();
    await post(`${BASE}/blob`, { action: "part", id, n, base64: toBase64(buf) });
    done++;
    onProgress?.(done / parts);
  };
  // 세 조각씩 나란히
  for (let n = 0; n < parts; n += 3) await Promise.all([n, n + 1, n + 2].filter((i) => i < parts).map(one));
  await post(`${BASE}/blob`, { action: "done", id });
  return { id, name, type, size: file.size };
}

export const deleteBlobs = (ids: string[]) =>
  ids.length ? post(`${BASE}/blob`, { action: "delete", ids }).catch(() => undefined) : Promise.resolve();

function saveAs(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** 첨부를 받아 브라우저 저장으로 넘긴다 (인증 헤더가 필요해 <a href> 로는 못 받는다) */
export async function downloadMailAttachment(
  view: MailView,
  id: string,
  index: number,
  name: string,
  acct?: string,
): Promise<void> {
  const q = new URLSearchParams({ box: view, id, i: String(index) });
  q.set("acct", acct ?? ACTIVE ?? "");
  const auth = { Authorization: `Bearer ${await token()}` };
  const res = await fetch(`${BASE}/attachment?${q}`, { headers: auth, cache: "no-store" });
  if (!res.ok) throw new Error(await readError(res));

  // 4MB 넘는 첨부는 서버가 조각으로 두고 알려 준다 — 나눠 받아 붙인다
  if ((res.headers.get("content-type") ?? "").includes("application/json")) {
    const { blob } = (await res.json()) as { blob: MailBlobRef & { parts: number } };
    const chunks: ArrayBuffer[] = [];
    for (let from = 0; from < blob.parts; from += 5) {
      const r = await fetch(`${BASE}/blob?id=${blob.id}&from=${from}&count=5`, { headers: auth, cache: "no-store" });
      if (!r.ok) throw new Error(await readError(r));
      chunks.push(await r.arrayBuffer());
    }
    void deleteBlobs([blob.id]);
    saveAs(new Blob(chunks, { type: blob.type }), name);
    return;
  }
  saveAs(await res.blob(), name);
}

// ---- 백업 가져오기 --------------------------------------------

export const importEmlBatch = (box: MailBox, items: { base64: string }[]) =>
  post<{ added: number; duplicate: number; failed: number }>(`${BASE}/import`, { box, items });

export const importEmlBlob = (box: MailBox, blobId: string) =>
  post<{ added: number; duplicate: number; failed: number }>(`${BASE}/import`, { box, blobId });

export { toBase64 as arrayBufferToBase64 };

// ---- 주소 ----------------------------------------------------

/** "홍길동 <a@b.com>, c@d.com" → 주소 목록 */
export function parseAddrInput(s: string): { name?: string; address: string }[] {
  return s
    .split(/[,;\n]/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const m = /^(.*)<([^>]+)>$/.exec(p);
      if (!m) return { address: p };
      const name = m[1].trim().replace(/^"|"$/g, "");
      return name ? { name, address: m[2].trim() } : { address: m[2].trim() };
    });
}

export const formatAddr = (a: { name?: string; address: string }) => (a.name ? `${a.name} <${a.address}>` : a.address);

export const isEmail = (s: string) => /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$/.test(s.trim());
