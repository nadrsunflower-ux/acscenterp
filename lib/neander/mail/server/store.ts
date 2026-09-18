import "server-only";

// ============================================================
//  메일 저장 자리 (Firestore, Admin SDK 전용)
// ------------------------------------------------------------
//    neander_mail_accounts/{계정 키}              계정 · 암호문 · 폴더 · 확인 상태
//      (계정 키: 사람의 첫 계정은 ERP 이메일 그대로, 더 붙인 계정은 `ERP이메일#무작위`.
//       한 사람이 메일 계정 여러 개를 로그인해 두고 오간다 — user 필드가 주인이다)
//      ├─ meta/uidls · meta/uidls_<외부id>       카페24(외부)에서 이미 본 메일 표시
//      ├─ meta/contacts                          주소록 (보낸 횟수 · 직접 넣은 주소)
//      ├─ inbox · self · sent · drafts · spam · trash/{id}
//      └─ f_xxxxxxxx/{id}                        내 메일함 (사용자 폴더)
//    neander_mail_scheduled/{id}                 예약 메일 (모두 한 곳 — dispatch.ts)
//    neander_mail_blobs/{id}/parts/{n}           첨부 조각 (blobs.ts)
//    neander_mail_track/{trackId}                수신확인 (track.ts)
//
//  메일함을 필드(box)가 아니라 **하위 컬렉션**으로 나눈 이유: box 로 거르고
//  날짜로 정렬하면 복합 색인이 필요한데, 색인 게시는 사용자 로그인이
//  필요하다 (scripts/deploy-rules.sh). 같은 이유로 안읽음·중요·읽음·첨부
//  거르기도 **정렬 키 필드**로 푼다: 안 읽은 메일에만 byUnread(=date) 를 두면
//  orderBy("byUnread") 가 그 필드가 있는 문서만 날짜순으로 준다 — 단일 필드
//  자동 색인으로 거르기와 정렬이 한 번에 된다. 상태가 바뀌면 키를 붙이고 뗀다.
//
//  ⚠️ 20초마다 도는 확인이 Firestore 를 두드리지 않게, 카페24 쪽 STAT
//     (메일 수·용량)이 지난번과 같으면 계정 문서 1회 읽기로 끝난다.
// ============================================================

import { createHash } from "node:crypto";
import {
  FieldValue,
  type DocumentData,
  type DocumentSnapshot,
  type Firestore,
} from "firebase-admin/firestore";
import { NEANDER_COL } from "@/lib/neander/collections";
import {
  DEFAULT_QUOTA_BYTES,
  isMailBox,
  type ExternalAccountView,
  type MailAccountView,
  type MailAddr,
  type MailAttachmentMeta,
  type MailBox,
  type MailComposeState,
  type MailContact,
  type MailFilter,
  type MailFolder,
  type MailProvider,
  type MailSignatureSet,
  type MailSummary,
  type MailView,
  type SharedFolder,
} from "../types";

/** IMAP 계정의 서버 메일함 하나를 어디까지 가져왔는가 */
export interface ImapBoxState {
  path: string;
  /** UIDVALIDITY — 바뀌면 서버가 메일함을 새로 만든 것이다 (처음부터 다시) */
  uidValidity: string;
  /** 다음에 올 UID — 이것부터 새 메일이다 */
  uidNext: number;
  /** CONDSTORE 가 있으면 — 다른 곳에서 바뀐 읽음·중요 표시를 이것 이후만 받는다 */
  modseq?: string;
  /** ERP 로 가져온 가장 오래된 UID — 「예전 메일 더 가져오기」가 이 아래부터 */
  oldest: number;
  /** 아직 안 가져온 예전 메일 수 */
  older: number;
}

/** IMAP 서버의 메일 한 통 위치 */
export interface ImapRef {
  path: string;
  uid: number;
  uidValidity: string;
}

/** 저장 모양이 바뀔 때 올린다 — 옛 문서를 한 번 고친다 (sync.ts migrate) */
export const MAIL_SCHEMA = 2;

export interface ExternalAccountDoc {
  id: string;
  label: string;
  address: string;
  host: string;
  secret: string;
  initialized: boolean;
  stat: { count: number; size: number } | null;
  lastCheckedAt?: number;
  lastError?: string | null;
  authFailed: boolean;
  authFailCount?: number;
}

export interface MailAccountDoc {
  /**
   * 이 메일 계정의 키 (= 문서 id). 이름이 owner 인 것은 계정이 하나뿐이던 때
   * 「ERP 이메일 = 문서 id」였던 흔적이다 — 코드 곳곳이 이 값으로 자리를 찾는다.
   * 비밀번호 암호문의 AAD 도 이 값이다.
   */
  owner: string;
  /** 이 메일 계정을 연결한 ERP 사용자 — 예전 문서에는 없다 (그때는 owner 와 같다) */
  user?: string;
  /** 계정 별칭 — 계정 목록에서 연필로 고친다 */
  label?: string;
  /** 계정 목록의 동그라미 — 사진(작게 줄인 data URL) › 캐릭터(이모지) › 이름 첫 글자 순으로 보인다 */
  avatarPhoto?: string;
  avatarEmoji?: string;
  /** 캐릭터·글자 동그라미의 배경색 (#rrggbb). 없으면 메일 서비스 색 */
  avatarColor?: string;
  /**
   * 팀 공용 계정 — 연결한 사람(user) 말고도 ERP 팀원 모두가 쓴다. 공용 Gmail 처럼
   * 여럿이 함께 보는 메일함을 한 사람이 앱 비밀번호로 한 번 연결해 두면 끝이다.
   */
  team?: boolean;
  /** 메일 서비스 — 없으면 카페24 (예전 문서) */
  provider?: MailProvider;
  /** IMAP 계정(네이버·Gmail)의 접속 · 가져온 자리 */
  imapHost?: string;
  imapPort?: number;
  smtpPort?: number;
  /** true 면 465 (처음부터 TLS), false 면 587 (STARTTLS) */
  smtpSecure?: boolean;
  /** 로그인 아이디가 메일 주소와 다를 때 (네이버는 「아이디」만 받는 경우가 있다) */
  loginUser?: string;
  imapState?: Partial<Record<"inbox" | "sent" | "spam", ImapBoxState>>;
  address: string;
  name: string;
  signature: string;
  keepSentCopy: boolean;
  trackOpens?: boolean;
  /** secret.ts sealSecret 결과 */
  secret: string;
  popHost: string;
  smtpHost: string;
  connectedAt: number;
  /** 첫 가져오기를 마쳤는가 */
  initialized: boolean;
  /** 지난 확인 때 카페24 STAT — 같으면 목록을 다시 받지 않는다. 가져오다 만 게 있으면 null */
  stat: { count: number; size: number } | null;
  lastCheckedAt?: number;
  /** IMAP 확인 중 (이 시각까지) — 팀 공용 계정을 여러 사람이 동시에 확인해도 서버에는 한 곳만 붙는다 */
  imapRunUntil?: number;
  lastError?: string | null;
  /** 확인이 이 시각부터 계속 실패 중 — 성공하면 null */
  errorSince?: number | null;
  authFailed: boolean;
  /** 이어진 로그인 실패 수 — AUTH_FAIL_LIMIT 에 닿으면 authFailed */
  authFailCount?: number;
  /** 아직 ERP 로 가져오지 않은 예전 메일 수 (meta/uidls.older 길이) */
  olderCount: number;
  /** 다음 확인 때 카페24 에서 지울 UIDL 해시 */
  pendingDelete: string[];
  folders?: MailFolder[];
  /** 스팸 신고한 보낸 사람 (소문자 주소) */
  blocked?: string[];
  externals?: ExternalAccountDoc[];
  usage?: { bytes: number; count: number };
  quotaBytes?: number;
  schema?: number;
}

/** 메일 문서 — MailSummary 에서 id·box·onServer 를 뺀 것 + 원문 연결 */
export interface MailDoc {
  origin?: MailBox;
  from: MailAddr;
  to: MailAddr[];
  cc: MailAddr[];
  bcc?: MailAddr[];
  replyTo?: MailAddr[];
  subject: string;
  date: number;
  snippet: string;
  read: boolean;
  starred?: boolean;
  attachments: MailAttachmentMeta[];
  messageId?: string | null;
  inReplyTo?: string | null;
  references?: string[];
  /** 카페24 원문 — UIDL 과 그 해시. 보낸 메일은 내 받은편지함 사본이 들어오면 채워진다 */
  uidl?: string | null;
  uidlHash?: string | null;
  /** 외부 메일 계정 id — 없으면 카페24 본 계정 */
  acct?: string | null;
  /** IMAP 계정(네이버·Gmail)의 서버 위치 — 첨부 열기 · 읽음 표시 · 삭제를 서버에 건다 */
  imap?: ImapRef | null;
  /** 백업 zip 에서 가져왔다 */
  imported?: boolean;
  /** gzip(JSON{html,text}) */
  body?: Buffer;
  partial?: boolean;
  /** 수신확인 */
  tracks?: { address: string; trackId: string }[];
  opens?: number;
  /** 임시보관함 — 다시 열어 쓸 작성 내용 */
  compose?: MailComposeState;
  /** 임시저장한 ERP 사용자 — 첨부 조각의 주인 (팀 공용 계정에서는 계정 주인과 다르다) */
  by?: string;
  /** 받은 시각 (ERP 에 들어온 때) */
  createdAt: number;
  // ---- 거르기용 정렬 키 (있는 문서만 orderBy 에 잡힌다) ----
  byUnread?: number;
  byRead?: number;
  byStar?: number;
  byAttach?: number;
}

export interface UidlMeta {
  /** 이미 본(가져왔거나 예전 메일로 미뤄 둔) UIDL 해시 */
  seen: string[];
  /** 예전 메일로 미뤄 둔 것 — 최신이 앞. 「이전 메일 더 가져오기」가 앞에서부터 꺼낸다 */
  older: string[];
}

/** 목록에 실어 보내는 필드 — 본문(body)·작성 내용은 빼고 받는다 */
export const SUMMARY_FIELDS = [
  "origin",
  "from",
  "to",
  "cc",
  "subject",
  "date",
  "snippet",
  "read",
  "starred",
  "attachments",
  "uidlHash",
  "imap",
  "acct",
  "imported",
  "opens",
] as const;

export const FILTER_KEY: Record<MailFilter, keyof MailDoc> = {
  unread: "byUnread",
  read: "byRead",
  starred: "byStar",
  attach: "byAttach",
};

export const accountRef = (db: Firestore, owner: string) => db.collection(NEANDER_COL.mailAccounts).doc(owner);
export const metaRef = (db: Firestore, owner: string, ext?: string) =>
  accountRef(db, owner).collection("meta").doc(ext ? `uidls_${ext}` : "uidls");
export const contactsRef = (db: Firestore, owner: string) => accountRef(db, owner).collection("meta").doc("contacts");
/** 서명 — 로고 이미지가 들어가 커질 수 있어 계정 문서(20초마다 읽는다)와 떼어 둔다 */
export const signaturesRef = (db: Firestore, owner: string) => accountRef(db, owner).collection("meta").doc("signatures");

const escapeText = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\r?\n/g, "<br>");

/**
 * 계정의 서명들. 서명 관리가 생기기 전의 글자 서명(signature 필드)은 「기본 서명」
 * 하나로 보여 주고 새 메일·답장 모두에 쓴다 — 저장하면 그때 서명 문서로 옮겨진다.
 */
export async function readSignatures(db: Firestore, acc: MailAccountDoc): Promise<MailSignatureSet> {
  const snap = await signaturesRef(db, acc.owner).get();
  if (snap.exists) return snap.data() as MailSignatureSet;
  if (acc.signature?.trim()) {
    return { list: [{ id: "legacy", name: "기본 서명", html: escapeText(acc.signature.trim()) }], sigNew: "legacy", sigReply: "legacy" };
  }
  return { list: [] };
}
export const boxRef = (db: Firestore, owner: string, box: MailBox) => accountRef(db, owner).collection(box);

/** UIDL 은 서버마다 길이가 제각각이다 — 짧은 해시로 저장한다 (문서 id 에도 쓴다) */
export const hashUid = (uid: string) => createHash("sha256").update(uid).digest("base64url").slice(0, 20);

export async function readAccount(db: Firestore, owner: string): Promise<MailAccountDoc | null> {
  const snap = await accountRef(db, owner).get();
  return snap.exists ? (snap.data() as MailAccountDoc) : null;
}

/** 이 메일 계정을 가진 ERP 사용자 */
export const userOf = (a: MailAccountDoc) => a.user ?? a.owner;

/** 새로 붙이는 메일 계정의 키 */
export const newAccountKey = (me: string) => `${me}#${createHash("sha256").update(`${me}${Date.now()}${Math.random()}`).digest("hex").slice(0, 8)}`;

/** 이 계정을 쓸 수 있는가 — 내가 연결했거나 팀 공용이다 */
export const canUse = (a: MailAccountDoc, me: string) => userOf(a) === me || !!a.team;

/**
 * 한 사람이 쓰는 메일 계정들 — 내가 연결한 것(첫 계정이 앞, 나머지는 붙인 순서) 다음에
 * 팀 공용 계정. 예전 문서에는 user 필드가 없어 질의에 안 잡힌다 — 이때 한 번 채워 둔다.
 */
export async function listUserAccounts(db: Firestore, me: string): Promise<MailAccountDoc[]> {
  const [snap, legacy, team] = await Promise.all([
    db.collection(NEANDER_COL.mailAccounts).where("user", "==", me).get(),
    accountRef(db, me).get(),
    db.collection(NEANDER_COL.mailAccounts).where("team", "==", true).get(),
  ]);
  const map = new Map(snap.docs.map((d) => [d.id, d.data() as MailAccountDoc]));
  if (legacy.exists && !map.has(me)) {
    const a = legacy.data() as MailAccountDoc;
    if (!a.user) await legacy.ref.update({ user: me });
    map.set(me, { ...a, user: me });
  }
  const mine = [...map.values()].sort((a, b) =>
    a.owner === me ? -1 : b.owner === me ? 1 : (a.connectedAt ?? 0) - (b.connectedAt ?? 0),
  );
  const shared = team.docs
    .filter((d) => !map.has(d.id))
    .map((d) => d.data() as MailAccountDoc)
    .sort((a, b) => (a.connectedAt ?? 0) - (b.connectedAt ?? 0));
  return [...mine, ...shared];
}

export function accountView(a: MailAccountDoc): MailAccountView {
  return {
    key: a.owner,
    provider: a.provider ?? "cafe24",
    team: a.team || undefined,
    connectedBy: a.team ? userOf(a) : undefined,
    label: a.label || undefined,
    avatarPhoto: a.avatarPhoto || undefined,
    avatarEmoji: a.avatarEmoji || undefined,
    avatarColor: a.avatarColor || undefined,
    address: a.address,
    name: a.name,
    signature: a.signature ?? "",
    keepSentCopy: a.keepSentCopy !== false,
    trackOpens: a.trackOpens !== false,
    connectedAt: a.connectedAt,
    lastCheckedAt: a.lastCheckedAt,
    authFailed: !!a.authFailed,
    lastError: a.lastError ?? undefined,
    errorSince: a.lastError ? a.errorSince ?? undefined : undefined,
    olderCount: a.provider && a.provider !== "cafe24" ? a.imapState?.inbox?.older ?? 0 : a.olderCount ?? 0,
    olderSent: a.imapState?.sent?.older || undefined,
    folders: a.folders ?? [],
    blocked: a.blocked ?? [],
    externals: (a.externals ?? []).map(
      (x): ExternalAccountView => ({
        id: x.id,
        label: x.label,
        address: x.address,
        host: x.host,
        lastCheckedAt: x.lastCheckedAt,
        lastError: x.lastError ?? undefined,
        authFailed: !!x.authFailed,
      }),
    ),
    usage: a.usage,
    quotaBytes: a.quotaBytes || DEFAULT_QUOTA_BYTES,
  };
}

export function toSummary(id: string, box: MailView, d: DocumentData, externals?: ExternalAccountDoc[]): MailSummary {
  const ext = d.acct ? externals?.find((x) => x.id === d.acct) : undefined;
  return {
    id,
    box,
    origin: d.origin,
    from: d.from ?? { address: "" },
    to: d.to ?? [],
    cc: d.cc ?? [],
    subject: d.subject ?? "",
    date: d.date ?? 0,
    snippet: d.snippet ?? "",
    read: !!d.read,
    starred: !!d.starred,
    attachments: d.attachments ?? [],
    onServer: !!(d.uidlHash || d.imap),
    imported: d.imported || undefined,
    source: d.acct ? ext?.label || ext?.address || "외부 메일" : undefined,
    opens: typeof d.opens === "number" ? d.opens : undefined,
  };
}

export const snapSummary = (s: DocumentSnapshot, box: MailView, externals?: ExternalAccountDoc[]) =>
  toSummary(s.id, box, s.data() ?? {}, externals);

/** Firestore 는 undefined 필드를 받지 않는다 */
export function stripUndefined<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}

/** 주소 목록에서 이름이 빈 칸을 뗀다 (undefined 필드는 Firestore 가 거절) */
export const cleanAddrs = (list: MailAddr[]) =>
  list.map((a) => (a.name ? { name: a.name, address: a.address } : { address: a.address }));

/** 새 문서에 붙일 정렬 키 */
export function sortKeys(d: { date: number; read: boolean; starred?: boolean; attachments: unknown[] }) {
  return stripUndefined({
    byUnread: d.read ? undefined : d.date,
    byRead: d.read ? d.date : undefined,
    byStar: d.starred ? d.date : undefined,
    byAttach: d.attachments.length ? d.date : undefined,
  });
}

/** 읽음이 바뀔 때 고칠 필드 */
export const readPatch = (read: boolean, date: number) => ({
  read,
  byUnread: read ? FieldValue.delete() : date,
  byRead: read ? date : FieldValue.delete(),
});

export const starPatch = (starred: boolean, date: number) => ({
  starred,
  byStar: starred ? date : FieldValue.delete(),
});

export async function countUnread(db: Firestore, owner: string, box: MailBox = "inbox"): Promise<number> {
  const agg = await boxRef(db, owner, box).where("read", "==", false).count().get();
  return agg.data().count;
}

// ---- 접근 ----------------------------------------------------

export class MailAccessError extends Error {}

/**
 * 요청이 고른 내 메일 계정. 키가 없으면 첫 계정. 남의 계정 키면 거절한다
 * (남의 메일함은 resolveBox 의 공유 폴더로만 연다).
 */
export async function resolveAccount(db: Firestore, me: string, key?: unknown): Promise<MailAccountDoc> {
  if (typeof key === "string" && key) {
    const acc = await readAccount(db, key);
    if (!acc || !canUse(acc, me)) throw new MailAccessError("내 메일 계정이 아닙니다.");
    return acc;
  }
  const [first] = await listUserAccounts(db, me);
  if (!first) throw new MailAccessError("연결된 메일 계정이 없습니다.");
  return first;
}

/**
 * 어느 메일 계정의 어느 메일함을 여는가. 내 계정이면 모두, 남의 계정이면
 * 그 사람이 공유한 폴더만 읽기 전용으로 열린다 (카페24 공유메일함).
 */
export async function resolveBox(
  db: Firestore,
  me: string,
  box: unknown,
  key?: string | null,
): Promise<{ owner: string; box: MailBox; readonly: boolean; account: MailAccountDoc }> {
  if (!isMailBox(box)) throw new MailAccessError("알 수 없는 메일함입니다.");
  const account = key ? await readAccount(db, key) : (await listUserAccounts(db, me))[0] ?? null;
  if (!account) throw new MailAccessError("연결된 메일 계정이 없습니다.");
  if (canUse(account, me)) return { owner: account.owner, box, readonly: false, account };
  const folder = (account.folders ?? []).find((f) => f.id === box);
  if (!folder?.shared) throw new MailAccessError("공유되지 않은 메일함입니다.");
  return { owner: account.owner, box, readonly: true, account };
}

/** 팀원들이 공유한 메일함 — 팀이 작아 계정 문서를 통째로 읽는다 */
export async function listSharedFolders(db: Firestore, viewer: string): Promise<SharedFolder[]> {
  const snap = await db.collection(NEANDER_COL.mailAccounts).get();
  const out: SharedFolder[] = [];
  for (const d of snap.docs) {
    const a = d.data() as MailAccountDoc;
    // 내 계정 · 팀 공용 계정의 폴더는 계정째 열리므로 공유메일함에 따로 두지 않는다
    if ((a.user ?? d.id) === viewer || a.team) continue;
    for (const f of a.folders ?? []) {
      if (f.shared) out.push({ owner: d.id, ownerName: a.name || a.address, address: a.address, id: f.id, name: f.name });
    }
  }
  return out;
}

// ---- 주소록 --------------------------------------------------

const MAX_CONTACTS = 800;

export async function readContacts(db: Firestore, owner: string): Promise<MailContact[]> {
  const snap = await contactsRef(db, owner).get();
  return ((snap.data()?.list as MailContact[] | undefined) ?? []).slice();
}

/** 보낸 주소를 세어 둔다 — 「최근 사용 주소」「자주 쓰는 주소」 */
export async function noteRecipients(db: Firestore, owner: string, list: MailAddr[]): Promise<void> {
  if (!list.length) return;
  const ref = contactsRef(db, owner);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const contacts = ((snap.data()?.list as MailContact[] | undefined) ?? []).slice();
    const now = Date.now();
    for (const a of list) {
      const key = a.address.trim().toLowerCase();
      const hit = contacts.find((c) => c.address.toLowerCase() === key);
      if (hit) {
        hit.count += 1;
        hit.last = now;
        if (a.name && !hit.name) hit.name = a.name;
      } else {
        contacts.push(stripUndefined({ address: a.address.trim(), name: a.name || undefined, count: 1, last: now }));
      }
    }
    // 넘치면 직접 넣은 것은 두고 오래·적게 쓴 것부터 버린다
    contacts.sort((x, y) => Number(!!y.manual) - Number(!!x.manual) || y.last - x.last);
    tx.set(ref, { list: contacts.slice(0, MAX_CONTACTS) });
  });
}
