import "server-only";

// ============================================================
//  쇼핑쇼츠 접근 — 누가 무엇을 읽고 고칠 수 있나
// ------------------------------------------------------------
//  1) 모듈 입장: NEANDER 팀원(requireMember). NEANDER_SHORTS_EMAILS 가 있으면
//     그 목록에 있는 사람만 (재무의 NEANDER_FINANCE_EMAILS 와 같은 방식).
//  2) 문서마다 owner · visibility:
//       private → 소유자만 읽고 고친다
//       team    → 모듈 사용자 누구나 읽고 고친다. 지우기 · 공개 범위 바꾸기는 소유자만
//  3) 게시 계정은 따로 — 연결한 사람(owner)과 그가 허락한 사람(sharedWith)만
//     게시에 쓴다. 토큰은 어느 경우에도 서버 밖으로 나가지 않는다.
//  5) 고객사(브랜드) 자료 — 그 고객사 담당자(members)가 함께 읽고 고친다. 프로젝트와
//     계정에는 담당자 목록의 사본(members · clientMembers)이 붙어 있어 여기서 바로 판단한다.
//  4) 쇼츠 관리자(NEANDER_SHORTS_ADMIN_EMAILS, 없으면 부트스트랩 관리자)는 모든
//     사람의 것을 **읽기만** 한다 — 「사용자별 현황」 · 몰아보기. 남의 비공개 자료를
//     고치거나, 남의 계정 · 쿠팡 키로 무언가를 하지 않는다. 읽기 경로만 admin 을 넘긴다.
//
//  ⚠️ 프로토타입은 서버 환경변수 하나의 운영 계정을 모두가 썼다. 여기서는 그
//     구조를 쓰지 않는다 — 계정은 사람마다 연결하고 공유는 명시적으로만.
//
//  사용자 · 관리자 목록은 환경변수(배포 설정)에 더해 ERP 에서 고치는 목록(settings/access)을
//  합쳐 쓴다 — 배포 설정을 건드리지 않고 사람을 더하려고. 환경변수에 있는 사람은 ERP 에서 뺄 수 없다.
//  관리자는 사용자이기도 하다. 고치기는 관리자만 (saveShortsAccess).
// ============================================================

import { adminDb } from "@/lib/neander/server/admin";
import { AccessError, requireMember, type ErpUser } from "@/lib/neander/server/auth";
import { NEANDER_COL } from "@/lib/neander/collections";
import type { AccountDoc, Owned } from "../types";

const norm = (s: string | undefined | null) => (s ?? "").trim().toLowerCase();

/** 배포 설정의 사용자 제한 (비어 있으면 팀원 누구나) */
export const shortsAllowlist = () =>
  (process.env.NEANDER_SHORTS_EMAILS ?? "").split(",").map(norm).filter(Boolean);

/** 배포 설정의 관리자 (없으면 ERP 부트스트랩 관리자) */
export function envShortsAdmins(): string[] {
  const own = (process.env.NEANDER_SHORTS_ADMIN_EMAILS ?? "").split(",").map(norm).filter(Boolean);
  if (own.length) return own;
  return (process.env.NEXT_PUBLIC_NEANDER_ADMIN_EMAILS ?? "").split(",").map(norm).filter(Boolean);
}

// ---- ERP 에서 고치는 목록 (neander_shorts_settings/access · 늘 원래 컬렉션) ----

export interface ShortsAccessDoc {
  users: string[];
  admins: string[];
  updatedAt: number;
  updatedBy: string;
}

let accessCache: { users: string[]; admins: string[]; at: number } = { users: [], admins: [], at: 0 };
const ACCESS_TTL = 60_000;
const accessRef = () => adminDb().collection(NEANDER_COL.shortsSettings).doc("access");

/** ERP 목록을 읽어 둔다 (1분) — requireShortsUser 가 요청마다 부른다 */
export async function loadShortsAccess(force = false): Promise<{ users: string[]; admins: string[] }> {
  if (!force && Date.now() - accessCache.at < ACCESS_TTL) return accessCache;
  const d = (await accessRef().get()).data() as Partial<ShortsAccessDoc> | undefined;
  accessCache = { users: (d?.users ?? []).map(norm).filter(Boolean), admins: (d?.admins ?? []).map(norm).filter(Boolean), at: Date.now() };
  return accessCache;
}

/** 관리자 = 배포 설정 ∪ ERP 목록 (ERP 목록은 마지막으로 읽은 것) */
export function shortsAdmins(): string[] {
  return [...new Set([...envShortsAdmins(), ...accessCache.admins])];
}

export const isShortsAdmin = (email: string) => shortsAdmins().includes(norm(email));

export async function requireShortsUser(req: Request): Promise<ErpUser> {
  const user = await requireMember(req);
  const access = await loadShortsAccess().catch(() => accessCache);
  const allow = shortsAllowlist();
  const allowed = allow.length === 0 || allow.includes(user.email) || access.users.includes(user.email) || access.admins.includes(user.email) || envShortsAdmins().includes(user.email);
  if (!allowed) {
    throw new AccessError(403, `${user.email} 은 AI STUDIO 사용 권한이 없습니다. AI STUDIO 관리자에게 「사용자별 현황」 의 사용자 목록 등록을 요청하세요.`);
  }
  return user;
}

/** 화면에 보낼 목록 — 배포 설정에 있는 사람은 「고정」 */
export async function shortsAccessView(): Promise<{ users: string[]; admins: string[]; fixedUsers: string[]; fixedAdmins: string[]; open: boolean }> {
  const a = await loadShortsAccess();
  return { users: a.users, admins: a.admins, fixedUsers: shortsAllowlist(), fixedAdmins: envShortsAdmins(), open: shortsAllowlist().length === 0 };
}

/** 사용자 · 관리자 목록 고치기 — 관리자만. 팀원만 넣을 수 있고, 자기 자신을 관리자에서 빼지 못한다 */
export async function saveShortsAccess(email: string, input: { users?: unknown; admins?: unknown }): Promise<ShortsAccessDoc> {
  await loadShortsAccess(true);
  if (!isShortsAdmin(email)) throw new AccessError(403, "AI STUDIO 사용자 · 관리자는 관리자만 바꿉니다.");
  const clean = (v: unknown) => [...new Set((Array.isArray(v) ? v : []).map((x) => norm(String(x))).filter((x) => /^[^@\s]+@[^@\s]+$/.test(x)))].slice(0, 50);
  const admins = clean(input.admins);
  const users = clean(input.users).filter((x) => !admins.includes(x));
  for (const e of [...users, ...admins]) {
    if (!(await adminDb().collection(NEANDER_COL.memberEmails).doc(e).get()).exists) throw new Error(`${e} 은 등록된 NEANDER 팀원이 아닙니다.`);
  }
  if (!envShortsAdmins().includes(email) && !admins.includes(email)) throw new Error("자기 자신을 관리자에서 뺄 수 없습니다 — 다른 관리자가 빼 주세요.");
  const doc: ShortsAccessDoc = { users, admins, updatedAt: Date.now(), updatedBy: email };
  await accessRef().set(doc);
  await loadShortsAccess(true);
  return doc;
}

type Shared = Pick<Owned, "owner" | "visibility"> & { members?: string[] };

/** admin = 관리자 몰아보기 (읽기 전용 경로에서만 true 로 넘긴다) */
export const canRead = (doc: Shared | undefined, email: string, admin = false) =>
  !!doc && (doc.owner === email || doc.visibility === "team" || !!doc.members?.includes(email) || admin);

/** 고치기 — 관리자라도 남의 비공개는 고치지 않는다 (고객사 담당자는 고친다) */
export const canEdit = (doc: Shared | undefined, email: string) =>
  !!doc && (doc.owner === email || doc.visibility === "team" || !!doc.members?.includes(email));

export const isOwner = (doc: Pick<Owned, "owner"> | undefined, email: string) => !!doc && doc.owner === email;

/** 받침에 맞는 조사 — 「영상은」 · 「소재는」 (한글이 아니면 「은(는)」 그대로) */
const josa = (w: string, batchim: string, plain: string) => {
  const c = w.charCodeAt(w.length - 1) - 0xac00;
  return c >= 0 && c <= 11171 ? w + (c % 28 ? batchim : plain) : `${w}${batchim}(${plain})`;
};

export function assertRead<T extends Shared>(doc: T | undefined, email: string, what: string, admin = false): T {
  if (!doc) throw new AccessError(404, `${josa(what, "을", "를")} 찾지 못했습니다. 지워졌을 수 있습니다.`);
  if (!canRead(doc, email, admin)) throw new AccessError(403, `${josa(what, "은", "는")} 다른 사람의 비공개 자료입니다.`);
  return doc;
}

export function assertOwner<T extends Pick<Owned, "owner">>(doc: T | undefined, email: string, what: string): T {
  if (!doc) throw new AccessError(404, `${josa(what, "을", "를")} 찾지 못했습니다.`);
  if (doc.owner !== email) throw new AccessError(403, `${what}의 소유자만 할 수 있습니다.`);
  return doc;
}

/** 게시 계정을 쓸 수 있는가 — 소유자 · 소유자가 허락한 팀원 · (고객사 계정이면) 그 고객사 담당자 */
export const canPublishWith = (acc: Pick<AccountDoc, "owner" | "sharedWith" | "clientMembers"> | undefined, email: string) =>
  !!acc && (acc.owner === email || acc.sharedWith.includes(email) || !!acc.clientMembers?.includes(email));
