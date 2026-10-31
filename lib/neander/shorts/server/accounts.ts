import "server-only";

// ============================================================
//  게시 계정 — 사람마다 연결하고, 공유는 소유자가 명시적으로
// ------------------------------------------------------------
//  YouTube: Google OAuth (youtube.upload · youtube.readonly) → 갱신 토큰을 암호화해 보관
//  Instagram: Facebook 로그인(페이지에 연결된 프로페셔널 계정) → 페이지 토큰을 암호화해 보관
//             또는 「직접 토큰 입력」 (Meta 앱 개발 모드에서 테스터로 시험할 때)
//
//  계정 문서 id = 플랫폼 · 외부 id · 소유자 → 같은 채널을 둘이 각자 연결해도
//  섞이지 않는다. 토큰은 계정 문서 id 를 AAD 로 암호화한다 (secret.ts).
//
//  OAuth 되돌아오기(callback)는 브라우저 이동이라 로그인 토큰 헤더가 없다.
//  그래서 시작할 때 로그인한 사람으로 state 문서(10분)를 만들고, 돌아올 때
//  state 로 누구인지 안다. state 는 한 번 쓰면 지운다.
// ============================================================

import { createHash, randomBytes } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import { AccessError } from "@/lib/neander/server/auth";
import { NEANDER_COL } from "@/lib/neander/collections";
import type { AccountDoc, AccountView, PublishPlatform } from "../types";
import { assertOwner, canPublishWith, shortsAllowlist } from "./access";
import {
  googleAccessToken,
  googleAuthUrl,
  googleExchangeCode,
  instagramWhoAmI,
  metaAuthUrl,
  metaExchangeCode,
  youtubeMyChannels,
  YOUTUBE_SCOPES,
  META_SCOPES,
} from "./platforms";
import { openTokens, sealTokens } from "./secret";

const col = (db: Firestore) => db.collection(NEANDER_COL.shortsAccounts);
const oauthCol = (db: Firestore) => db.collection(NEANDER_COL.shortsOAuth);
const ownerTag = (email: string) => createHash("sha256").update(email).digest("hex").slice(0, 10);
export const accountId = (platform: PublishPlatform, externalId: string, owner: string) => `${platform}_${externalId.replace(/[^\w-]/g, "")}_${ownerTag(owner)}`;
const isId = (v: unknown): v is string => typeof v === "string" && /^[\w-]{6,120}$/.test(v);

export const toAccountView = (id: string, a: AccountDoc, email: string): AccountView => {
  const { sealed: _s, ...rest } = a;
  return { ...rest, id, mine: a.owner === email, canPublish: canPublishWith(a, email) };
};

/** 내 계정 + 나에게 공유된 계정 + 내가 담당하는 고객사 계정. 관리자 몰아보기면 모든 계정 (토큰 없이 · 게시 권한은 그대로) */
export async function listAccounts(db: Firestore, email: string, admin = false): Promise<AccountView[]> {
  const docs = admin
    ? (await col(db).get()).docs
    : (
        await Promise.all([
          col(db).where("owner", "==", email).get(),
          col(db).where("sharedWith", "array-contains", email).get(),
          col(db).where("clientMembers", "array-contains", email).get(),
        ])
      ).flatMap((s) => s.docs);
  const seen = new Map<string, AccountView>();
  for (const d of docs) seen.set(d.id, toAccountView(d.id, d.data() as AccountDoc, email));
  return [...seen.values()].sort((a, b) => a.platform.localeCompare(b.platform) || a.externalName.localeCompare(b.externalName));
}

export async function getAccountForPublish(db: Firestore, email: string, id: unknown): Promise<AccountDoc & { id: string }> {
  if (!isId(id)) throw new Error("계정 id 가 올바르지 않습니다.");
  const a = (await col(db).doc(id).get()).data() as AccountDoc | undefined;
  if (!a) throw new AccessError(404, "게시 계정을 찾지 못했습니다. 연결이 끊겼을 수 있습니다.");
  if (!canPublishWith(a, email)) throw new AccessError(403, "이 계정으로 게시할 권한이 없습니다. 계정을 연결한 사람에게 공유를 요청하세요.");
  return { ...a, id };
}

/** 실행기용 — 게시 시점의 토큰 (서버 안에서만) */
export async function accountTokens(db: Firestore, id: string): Promise<{ account: AccountDoc; accessToken: string }> {
  const a = (await col(db).doc(id).get()).data() as AccountDoc | undefined;
  if (!a) throw new Error("게시 계정이 지워졌습니다.");
  const t = openTokens<{ refreshToken?: string; pageToken?: string; accessToken?: string }>(a.sealed, id);
  if (a.platform === "youtube") {
    if (!t.refreshToken) throw new Error("YouTube 갱신 토큰이 없습니다. 계정을 다시 연결해 주세요.");
    try {
      return { account: a, accessToken: await googleAccessToken(t.refreshToken) };
    } catch (e) {
      await markNeedsReauth(db, id);
      throw e;
    }
  }
  const token = t.pageToken ?? t.accessToken;
  if (!token) throw new Error("Instagram 토큰이 없습니다. 계정을 다시 연결해 주세요.");
  return { account: a, accessToken: token };
}

export async function markNeedsReauth(db: Firestore, id: string) {
  await col(db).doc(id).update({ status: "needs_reauth", updatedAt: Date.now() }).catch(() => undefined);
}

// ---- OAuth -------------------------------------------------------------

export const callbackUrl = (origin: string) => `${origin.replace(/\/$/, "")}/api/neander/shorts/oauth/callback`;

/** 고객사 계정이면 그 고객사 담당자인지 확인하고 (이름 · 담당자 사본을 붙이려고) 고객사를 돌려준다 */
async function clientForAccount(db: Firestore, email: string, clientId: unknown): Promise<{ id: string; members: string[] } | null> {
  if (clientId === undefined || clientId === null || clientId === "") return null;
  const { getClientForEdit } = await import("./clients");
  const c = await getClientForEdit(db, email, clientId);
  return { id: c.id, members: c.members };
}

export async function startOAuth(db: Firestore, email: string, platform: PublishPlatform, origin: string, clientId?: unknown): Promise<string> {
  const client = await clientForAccount(db, email, clientId);
  const state = randomBytes(24).toString("base64url");
  const redirectUri = callbackUrl(origin);
  const url = platform === "youtube" ? googleAuthUrl(redirectUri, state) : metaAuthUrl(redirectUri, state);
  await oauthCol(db).doc(state).set({ owner: email, platform, redirectUri, clientId: client?.id ?? null, expiresAt: Date.now() + 10 * 60_000 });
  return url;
}

/** 고객사 계정 문서 id — 누가 연결하든 고객사마다 하나 */
const clientAccountId = (platform: PublishPlatform, externalId: string, clientId: string) => `${platform}_${externalId.replace(/[^\w-]/g, "")}_c${clientId}`;

/** 돌아온 code 로 계정을 만든다. 성공하면 만든 계정 수 */
export async function finishOAuth(db: Firestore, state: string, code: string): Promise<{ owner: string; platform: PublishPlatform; created: number }> {
  if (!/^[\w-]{20,60}$/.test(state)) throw new Error("연결 요청이 올바르지 않습니다.");
  const ref = oauthCol(db).doc(state);
  const s = (await ref.get()).data() as { owner: string; platform: PublishPlatform; redirectUri: string; clientId?: string | null; expiresAt: number } | undefined;
  await ref.delete().catch(() => undefined);
  if (!s || s.expiresAt < Date.now()) throw new Error("연결 요청이 만료됐습니다. ERP 에서 다시 시작해 주세요.");
  const allow = shortsAllowlist();
  if (allow.length && !allow.includes(s.owner)) throw new AccessError(403, "AI STUDIO 사용 권한이 없습니다.");
  const client = s.clientId ? await clientForAccount(db, s.owner, s.clientId) : null;
  const idFor = (platform: PublishPlatform, externalId: string) => (client ? clientAccountId(platform, externalId, client.id) : accountId(platform, externalId, s.owner));
  const clientFields = client ? { clientId: client.id, clientMembers: client.members } : { clientId: null, clientMembers: [] };
  const now = Date.now();
  let created = 0;
  if (s.platform === "youtube") {
    const tok = await googleExchangeCode(code, s.redirectUri);
    const channels = await youtubeMyChannels(tok.accessToken);
    if (!channels.length) throw new Error("이 Google 계정에 YouTube 채널이 없습니다. YouTube 에서 채널을 먼저 만든 뒤 연결해 주세요.");
    for (const ch of channels) {
      const id = idFor("youtube", ch.id);
      const prev = (await col(db).doc(id).get()).data() as AccountDoc | undefined;
      const doc: AccountDoc = {
        owner: s.owner,
        platform: "youtube",
        authMode: "google_oauth",
        externalId: ch.id,
        externalName: ch.title,
        sealed: sealTokens({ refreshToken: tok.refreshToken }, id),
        scopes: tok.scope ? tok.scope.split(" ") : YOUTUBE_SCOPES,
        tokenExpiresAt: null,
        sharedWith: prev?.sharedWith ?? [],
        status: "connected",
        coupangChannel: prev?.coupangChannel ?? null,
        coupangSubId: prev?.coupangSubId ?? null,
        ...clientFields,
        createdAt: prev?.createdAt ?? now,
        updatedAt: now,
      };
      await col(db).doc(id).set(doc);
      created++;
    }
  } else {
    const pages = await metaExchangeCode(code, s.redirectUri);
    if (!pages.length) {
      throw new Error("Facebook 페이지에 연결된 Instagram 프로페셔널 계정을 찾지 못했습니다. Instagram 을 프로페셔널 계정으로 바꾸고 페이지에 연결한 뒤 다시 해 주세요.");
    }
    for (const p of pages) {
      const id = idFor("instagram", p.igUserId);
      const prev = (await col(db).doc(id).get()).data() as AccountDoc | undefined;
      const doc: AccountDoc = {
        owner: s.owner,
        platform: "instagram",
        authMode: "facebook_login",
        externalId: p.igUserId,
        externalName: p.igUsername ? `@${p.igUsername}` : p.pageName,
        sealed: sealTokens({ pageToken: p.pageToken, pageId: p.pageId }, id),
        scopes: META_SCOPES,
        tokenExpiresAt: null,
        sharedWith: prev?.sharedWith ?? [],
        status: "connected",
        coupangChannel: prev?.coupangChannel ?? null,
        coupangSubId: prev?.coupangSubId ?? null,
        ...clientFields,
        createdAt: prev?.createdAt ?? now,
        updatedAt: now,
      };
      await col(db).doc(id).set(doc);
      created++;
    }
  }
  return { owner: s.owner, platform: s.platform, created };
}

/** Instagram 토큰 직접 입력 — 서버가 읽기 요청으로 계정을 확인한 뒤에만 저장한다 */
export async function addManualInstagram(db: Firestore, email: string, input: { igUserId?: unknown; token?: unknown; clientId?: unknown }): Promise<string> {
  const client = await clientForAccount(db, email, input.clientId);
  const igUserId = String(input.igUserId ?? "").trim();
  const token = String(input.token ?? "").trim();
  if (!/^\d{5,40}$/.test(igUserId)) throw new Error("Instagram 프로페셔널 계정 ID(숫자)를 넣어 주세요.");
  if (token.length < 20 || /\s/.test(token)) throw new Error("접근 토큰을 확인해 주세요.");
  const who = await instagramWhoAmI(token, igUserId);
  const id = client ? clientAccountId("instagram", who.id, client.id) : accountId("instagram", who.id, email);
  const now = Date.now();
  const prev = (await col(db).doc(id).get()).data() as AccountDoc | undefined;
  await col(db).doc(id).set({
    owner: email,
    platform: "instagram",
    authMode: "manual_token",
    externalId: who.id,
    externalName: who.username ? `@${who.username}` : who.id,
    sealed: sealTokens({ accessToken: token }, id),
    scopes: [],
    tokenExpiresAt: null,
    sharedWith: prev?.sharedWith ?? [],
    status: "connected",
    coupangChannel: prev?.coupangChannel ?? null,
    coupangSubId: prev?.coupangSubId ?? null,
    clientId: client?.id ?? null,
    clientMembers: client?.members ?? [],
    createdAt: prev?.createdAt ?? now,
    updatedAt: now,
  } satisfies AccountDoc);
  return id;
}

/** 소유자만 — 공유 대상 · 쿠팡 활동 채널 등록 확인 기록 */
export async function updateAccount(
  db: Firestore,
  email: string,
  id: unknown,
  patch: { sharedWith?: unknown; coupangChannel?: unknown; coupangSubId?: unknown },
): Promise<AccountView> {
  if (!isId(id)) throw new Error("계정 id 가 올바르지 않습니다.");
  const ref = col(db).doc(id);
  const a = assertOwner((await ref.get()).data() as AccountDoc | undefined, email, "게시 계정");
  const next: AccountDoc = { ...a, updatedAt: Date.now() };
  if (Array.isArray(patch.sharedWith)) {
    const list = [...new Set(patch.sharedWith.map((e) => String(e).trim().toLowerCase()).filter((e) => /^[^@\s]+@[^@\s]+$/.test(e) && e !== email))].slice(0, 20);
    // 팀원만 — 등록된 이메일인지 확인한다
    for (const e of list) {
      if (!(await db.collection(NEANDER_COL.memberEmails).doc(e).get()).exists) throw new Error(`${e} 은 등록된 팀원이 아닙니다.`);
    }
    next.sharedWith = list;
  }
  if (patch.coupangSubId !== undefined) {
    const sub = String(patch.coupangSubId ?? "").trim();
    if (sub) {
      // 소유자의 파트너스에 등록한 채널 아이디만 — 남의 아이디를 붙이면 실적이 엉뚱한 데로 간다
      const { getProfile } = await import("./profiles");
      const prof = await getProfile(db, email);
      if (!prof.subIds.some((x) => x.id === sub)) throw new Error("먼저 내 쿠팡 채널 아이디 목록에 등록해 주세요.");
    }
    next.coupangSubId = sub || null;
  }
  if (patch.coupangChannel !== undefined) {
    const c = patch.coupangChannel as { registered?: unknown; url?: unknown } | null;
    next.coupangChannel = c && c.registered === true ? { registered: true, by: email, at: Date.now(), url: String(c.url ?? "").slice(0, 300) } : null;
  }
  await ref.set(next);
  return toAccountView(id, next, email);
}

export async function deleteAccount(db: Firestore, email: string, id: unknown): Promise<void> {
  if (!isId(id)) throw new Error("계정 id 가 올바르지 않습니다.");
  assertOwner((await col(db).doc(id).get()).data() as AccountDoc | undefined, email, "게시 계정");
  const pubs = await db.collection(NEANDER_COL.shortsPublications).where("accountId", "==", id).get();
  if (pubs.docs.some((d) => ["scheduled", "queued", "uploading", "processing"].includes(String(d.data().status)))) {
    throw new Error("이 계정으로 진행 중인 게시가 있어 연결을 끊을 수 없습니다.");
  }
  await col(db).doc(id).delete();
}
