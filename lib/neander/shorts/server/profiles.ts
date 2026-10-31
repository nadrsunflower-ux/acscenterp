import "server-only";

// ============================================================
//  사람별 채널 세트 — 쿠팡 파트너스 키 · 채널 아이디 · 개인 YouTube 검색 키
// ------------------------------------------------------------
//  neander_shorts_profiles/{ERP 이메일} 한 문서. 키는 암호문으로만 두고(secret.ts ·
//  AAD = "profile:" + 이메일), 화면에는 끝 4자리와 상태만 보낸다.
//
//  어느 키를 쓰나:
//    검색      내 키 → 없으면 회사 공용 키(환경변수). 결과를 저장하지 않으니 누구 키든 같다.
//    딥링크    **게시할 계정 주인의 키.** 수수료가 키 주인에게 가고, 그 사람의 파트너스에
//              등록된 채널이어야 한다. 공유받은 계정이면 계정 주인의 키로 대신 만든다
//              (키 자체는 서버 밖으로 나가지 않는다). 회사 키로 대신하지 않는다.
//    리포트    내 키로 내 실적만.
//  쿠팡이 한도 초과로 막으면(429, 24시간) blockedUntil 을 적고 그때까지 부르지 않는다.
// ============================================================

import type { Firestore } from "firebase-admin/firestore";
import { AccessError } from "@/lib/neander/server/auth";
import { NEANDER_COL } from "@/lib/neander/collections";
import type { ProfileDoc, ProfileView } from "../types";
import { CoupangApiError, coupangSearch, companyCreds, type CoupangCreds } from "./coupang";
import { openTokens, sealTokens } from "./secret";
import { youtubeApiKey } from "./youtube-data";

const col = (db: Firestore) => db.collection(NEANDER_COL.shortsProfiles);
const aad = (email: string) => `profile:${email}`;
const SUBID = /^[A-Za-z0-9]{8,20}$/;

export function emptyProfile(owner: string): ProfileDoc {
  return {
    owner,
    coupang: { sealed: null, keyHint: null, afCode: "", status: "none", checkedAt: null, message: "", blockedUntil: null },
    subIds: [],
    youtubeKey: { sealed: null, hint: null },
    updatedAt: 0,
  };
}

export const toProfileView = (d: ProfileDoc): ProfileView => {
  const { sealed, ...coupang } = d.coupang;
  return {
    owner: d.owner,
    coupang: { ...coupang, configured: !!sealed },
    subIds: d.subIds,
    youtubeKey: { configured: !!d.youtubeKey.sealed, hint: d.youtubeKey.hint },
    updatedAt: d.updatedAt,
  };
};

export async function getProfile(db: Firestore, email: string): Promise<ProfileDoc> {
  const d = (await col(db).doc(email).get()).data() as ProfileDoc | undefined;
  return d ?? emptyProfile(email);
}

/** 화면용 — 관리자는 모두, 아니면 내 것만 */
export async function listProfiles(db: Firestore, email: string, admin: boolean): Promise<ProfileView[]> {
  if (!admin) return [toProfileView(await getProfile(db, email))];
  const snap = await col(db).get();
  const list = snap.docs.map((d) => toProfileView(d.data() as ProfileDoc));
  if (!list.some((p) => p.owner === email)) list.push(toProfileView(emptyProfile(email)));
  return list;
}

const hint = (k: string) => (k.length > 4 ? `…${k.slice(-4)}` : "…");

export async function saveCoupangKeys(db: Firestore, email: string, input: { accessKey?: unknown; secretKey?: unknown; afCode?: unknown }): Promise<ProfileView> {
  const accessKey = String(input.accessKey ?? "").trim();
  const secretKey = String(input.secretKey ?? "").trim();
  if (!/^[\w-]{8,200}$/.test(accessKey) || !/^[\w-]{8,200}$/.test(secretKey)) throw new Error("파트너스 API 의 Access Key · Secret Key 를 확인해 주세요.");
  const p = await getProfile(db, email);
  const next: ProfileDoc = {
    ...p,
    coupang: {
      ...p.coupang,
      sealed: sealTokens({ accessKey, secretKey }, aad(email)),
      keyHint: hint(accessKey),
      afCode: String(input.afCode ?? p.coupang.afCode ?? "").trim().slice(0, 30),
      status: "unverified",
      checkedAt: null,
      message: "넣기만 했습니다 — 「키 확인」 으로 한 번 검색해 보세요.",
      blockedUntil: null,
    },
    updatedAt: Date.now(),
  };
  await col(db).doc(email).set(next);
  return toProfileView(next);
}

export async function saveProfileMeta(db: Firestore, email: string, input: { afCode?: unknown; subIds?: unknown }): Promise<ProfileView> {
  const p = await getProfile(db, email);
  const next: ProfileDoc = { ...p, updatedAt: Date.now() };
  if (input.afCode !== undefined) next.coupang = { ...p.coupang, afCode: String(input.afCode ?? "").trim().slice(0, 30) };
  if (Array.isArray(input.subIds)) {
    const list: { id: string; label: string }[] = [];
    for (const raw of input.subIds.slice(0, 10)) {
      const r = (raw ?? {}) as { id?: unknown; label?: unknown };
      const id = String(r.id ?? "").trim();
      if (!SUBID.test(id)) throw new Error(`채널 아이디 「${id}」 — 파트너스에 등록한 8~20자 영문·숫자여야 합니다.`);
      if (list.some((x) => x.id === id)) continue;
      list.push({ id, label: String(r.label ?? "").trim().slice(0, 40) });
    }
    next.subIds = list;
    // 지운 채널 아이디를 쓰던 내 계정은 비운다
    const accs = await db.collection(NEANDER_COL.shortsAccounts).where("owner", "==", email).get();
    for (const d of accs.docs) {
      const sub = d.data().coupangSubId as string | null | undefined;
      if (sub && !list.some((x) => x.id === sub)) await d.ref.update({ coupangSubId: null, updatedAt: Date.now() });
    }
  }
  await col(db).doc(email).set(next);
  return toProfileView(next);
}

export async function deleteCoupangKeys(db: Firestore, email: string): Promise<ProfileView> {
  const p = await getProfile(db, email);
  const next: ProfileDoc = { ...p, coupang: { ...emptyProfile(email).coupang, afCode: p.coupang.afCode }, updatedAt: Date.now() };
  await col(db).doc(email).set(next);
  return toProfileView(next);
}

export async function saveYoutubeKey(db: Firestore, email: string, key: unknown): Promise<ProfileView> {
  const p = await getProfile(db, email);
  const k = String(key ?? "").trim();
  if (k && !/^[\w-]{20,80}$/.test(k)) throw new Error("YouTube Data API 키 형식을 확인해 주세요.");
  const next: ProfileDoc = { ...p, youtubeKey: k ? { sealed: sealTokens({ key: k }, aad(email)), hint: hint(k) } : { sealed: null, hint: null }, updatedAt: Date.now() };
  await col(db).doc(email).set(next);
  return toProfileView(next);
}

// ---- 어느 키로 부르나 ----------------------------------------------------

export interface ResolvedCoupang {
  creds: CoupangCreds;
  /** 키 주인 (회사 키면 "company") */
  owner: string;
  source: "personal" | "company";
}

function personal(p: ProfileDoc): CoupangCreds | null {
  if (!p.coupang.sealed) return null;
  const t = openTokens<{ accessKey: string; secretKey: string }>(p.coupang.sealed, aad(p.owner));
  return { accessKey: t.accessKey, secretKey: t.secretKey };
}

function assertNotBlocked(p: ProfileDoc) {
  if (p.coupang.blockedUntil && p.coupang.blockedUntil > Date.now()) {
    throw new CoupangApiError(`쿠팡이 이 키의 호출을 ${new Date(p.coupang.blockedUntil + 9 * 3600_000).toISOString().slice(5, 16).replace("T", " ")} 까지 막았습니다 (한도 초과). 그때까지 직접 검색으로 진행해 주세요.`, 429);
  }
}

/** 검색 — 내 키, 없으면 회사 키 */
export async function coupangForSearch(db: Firestore, email: string): Promise<ResolvedCoupang> {
  const p = await getProfile(db, email);
  const mine = personal(p);
  if (mine) {
    assertNotBlocked(p);
    return { creds: mine, owner: email, source: "personal" };
  }
  const company = companyCreds();
  if (company) return { creds: company, owner: "company", source: "company" };
  throw new CoupangApiError("쿠팡 파트너스 키가 없습니다. 내 채널·연결에서 내 파트너스 키를 넣거나, 쿠팡에서 직접 검색해 주세요.", 503);
}

/** 딥링크 · 리포트 — 그 사람의 키만 (회사 키로 대신하지 않는다) */
export async function coupangOf(db: Firestore, owner: string): Promise<ResolvedCoupang> {
  const p = await getProfile(db, owner);
  const creds = personal(p);
  if (!creds) throw new AccessError(409, `${owner} 님이 쿠팡 파트너스 키를 아직 넣지 않았습니다. 그 사람의 내 채널·연결 화면에서 넣어야 그 사람의 링크를 만들 수 있습니다.`);
  assertNotBlocked(p);
  return { creds, owner, source: "personal" };
}

/** 개인 YouTube 검색 키 → 없으면 회사 키 */
export async function youtubeKeyFor(db: Firestore, email: string): Promise<{ key: string; source: "personal" | "company" | null }> {
  const p = await getProfile(db, email);
  if (p.youtubeKey.sealed) return { key: openTokens<{ key: string }>(p.youtubeKey.sealed, aad(email)).key, source: "personal" };
  const k = youtubeApiKey();
  return { key: k, source: k ? "company" : null };
}

/** 호출 결과를 상태로 남긴다 — 429 면 24시간 막힘 */
export async function noteCoupangResult(db: Firestore, owner: string, e: unknown | null) {
  if (owner === "company") return;
  const p = await getProfile(db, owner);
  if (!p.coupang.sealed) return;
  const now = Date.now();
  const coupang = { ...p.coupang, checkedAt: now };
  if (!e) Object.assign(coupang, { status: "ok", message: "키가 동작합니다.", blockedUntil: null });
  else if (e instanceof CoupangApiError && e.status === 429) Object.assign(coupang, { status: "failed", message: e.message, blockedUntil: now + 24 * 3600_000 });
  else if (e instanceof CoupangApiError && e.status === 401) Object.assign(coupang, { status: "failed", message: e.message });
  else return;
  await col(db).doc(owner).set({ ...p, coupang, updatedAt: now });
}

/** 키 확인 — 검색 한 번 (1건, 읽기). 저장하지 않는다 */
export async function verifyCoupang(db: Firestore, email: string): Promise<ProfileView> {
  const r = await coupangOf(db, email);
  try {
    await coupangSearch(r.creds, "주방", undefined, 1);
    await noteCoupangResult(db, email, null);
  } catch (e) {
    await noteCoupangResult(db, email, e);
    const p = await getProfile(db, email);
    if (!(e instanceof CoupangApiError && (e.status === 401 || e.status === 429))) {
      await col(db).doc(email).set({ ...p, coupang: { ...p.coupang, status: "failed", checkedAt: Date.now(), message: e instanceof Error ? e.message : "확인 실패" }, updatedAt: Date.now() });
    }
  }
  return toProfileView(await getProfile(db, email));
}
