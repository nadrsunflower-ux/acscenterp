import "server-only";

// ============================================================
//  프로젝트(space)별 Firestore — 분석 자료를 프로젝트마다 따로 둔다
// ------------------------------------------------------------
//  spaceDb(db, id) 는 Firestore 를 감싼다:
//    · 분석 컬렉션(SCOPED — 레이더 · 바이럴 형식 · 시장 · 노트 · 대본 · 설정)은 기본 프로젝트가 아니면
//      `<이름>__<id>` 로 바꿔 읽고 쓴다 → 레이더 · 정찰 · 시장 모듈은 고치지 않고 그대로 프로젝트별이 된다
//      (설정 · 하루 비용 계수기 · 잠금도 프로젝트마다).
//    · 대시보드가 모두 봐야 하는 자료(영상 · 소재 · 성공 공식 · 계정 · 폴더)는 한 컬렉션에 두고
//      만들 때 spaceId 를 찍는다 — currentSpace(db) 로 지금 프로젝트를 안다.
//  YouTube 검색 한도 · 사람별 가중치처럼 진짜 전역인 것은 rootDb(db) 로 감싼 것을 벗겨 쓴다.
//  모든 질의는 원래부터 복합 색인 없이 짜여 있어 새 컬렉션에도 색인이 필요 없다.
// ============================================================

import type { Firestore } from "firebase-admin/firestore";
import { AccessError } from "@/lib/neander/server/auth";
import { NEANDER_COL } from "@/lib/neander/collections";
import { DEFAULT_SPACE, DEFAULT_SPACE_ID, SPACE_HEADER, canSeeSpace, isSpaceId, sanitizeSpace, sortSpaces, spaceKind, type SpaceDoc, type SpaceView } from "../spaces";
import type { ClientDoc } from "../types";
import { isShortsAdmin } from "./access";

const SPACE = Symbol("neander.shorts.space");
const ROOT = Symbol("neander.shorts.root");

/** 프로젝트마다 따로 두는 컬렉션 */
export const SCOPED_COLLECTIONS: ReadonlySet<string> = new Set([
  NEANDER_COL.shortsSettings,
  NEANDER_COL.shortsRadar,
  NEANDER_COL.shortsWatch,
  NEANDER_COL.shortsHits,
  NEANDER_COL.shortsFormats,
  NEANDER_COL.shortsReports,
  NEANDER_COL.shortsMarket,
  NEANDER_COL.shortsChannelStats,
  NEANDER_COL.shortsNotes,
  NEANDER_COL.shortsScripts,
]);

export const scopedCollectionName = (name: string, spaceId: string) => (spaceId !== DEFAULT_SPACE_ID && SCOPED_COLLECTIONS.has(name) ? `${name}__${spaceId}` : name);

/** 감싼 것을 벗긴 원래 Firestore (전역 자료용) */
export const rootDb = (db: Firestore): Firestore => ((db as unknown as Record<symbol, Firestore>)[ROOT] ?? db);

/** 이 db 가 어느 프로젝트로 감싸였나 — 감싸지 않았으면 undefined (전체) */
export const currentSpace = (db: Firestore): string | undefined => (db as unknown as Record<symbol, string | undefined>)[SPACE];

/** 만들 때 찍을 프로젝트 — 감싸지 않았으면 기본 프로젝트 */
export const stampSpace = (db: Firestore): string => currentSpace(db) ?? DEFAULT_SPACE_ID;

export function spaceDb(db: Firestore, spaceId: string): Firestore {
  const root = rootDb(db);
  if (!isSpaceId(spaceId)) throw new Error("프로젝트 id 가 올바르지 않습니다.");
  const mapPath = (path: string) => {
    const [head, ...rest] = path.split("/");
    return [scopedCollectionName(head, spaceId), ...rest].join("/");
  };
  return new Proxy(root, {
    get(target, prop) {
      if (prop === SPACE) return spaceId;
      if (prop === ROOT) return target;
      if (prop === "collection") return (path: string) => target.collection(mapPath(path));
      if (prop === "doc") return (path: string) => target.doc(mapPath(path));
      const v = Reflect.get(target, prop, target) as unknown;
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(target) : v;
    },
  });
}

// ---- 프로젝트 목록 ----------------------------------------------------------

const spacesCol = (db: Firestore) => rootDb(db).collection(NEANDER_COL.shortsSpaces);

/** 모든 프로젝트 — 기본 프로젝트는 저장 전이어도 늘 있다 */
export async function listSpaces(db: Firestore, withArchived = false): Promise<SpaceView[]> {
  const snap = await spacesCol(db).get();
  const list: SpaceView[] = snap.docs.map((d) => ({ ...(d.data() as SpaceDoc), id: d.id }));
  if (!list.some((s) => s.id === DEFAULT_SPACE_ID)) list.push({ ...DEFAULT_SPACE, id: DEFAULT_SPACE_ID });
  return sortSpaces(list.filter((s) => withArchived || !s.archived));
}

// ---- 대행 프로젝트 — 업체 담당자 (1분 사본) ----------------------------------

let membersCache: { map: Map<string, string[]>; at: number } = { map: new Map(), at: 0 };
const MEMBERS_MS = 60_000;

/** 업체(고객사) id → 담당자 — 대행 프로젝트를 누가 보나 */
export async function clientMembersMap(db: Firestore, force = false): Promise<Map<string, string[]>> {
  if (!force && Date.now() - membersCache.at < MEMBERS_MS) return membersCache.map;
  const snap = await rootDb(db).collection(NEANDER_COL.shortsClients).get();
  membersCache = { map: new Map(snap.docs.map((d) => [d.id, (d.data() as ClientDoc).members ?? []])), at: Date.now() };
  return membersCache.map;
}
/** 업체 담당자가 바뀌면 (clients.saveClient) */
export const forgetClientMembers = () => {
  membersCache.at = 0;
};

/** 이 사람이 볼 수 있는 프로젝트 — 대행은 관리자 · 그 업체 담당자만 */
export async function listSpacesFor(db: Firestore, email: string, admin: boolean, withArchived = false): Promise<SpaceView[]> {
  const [list, members] = await Promise.all([listSpaces(db, withArchived), clientMembersMap(db)]);
  return list.filter((s) => canSeeSpace(s, email, admin, (id) => members.get(id)));
}

export async function assertSpaceAccess(db: Firestore, s: SpaceView, email: string): Promise<void> {
  if (spaceKind(s) === "own") return;
  const members = await clientMembersMap(db);
  if (!canSeeSpace(s, email, isShortsAdmin(email), (id) => members.get(id))) throw new AccessError(403, `「${s.name}」 은(는) 대행 프로젝트라 AI STUDIO 관리자와 그 업체 담당자만 봅니다.`);
}

export async function getSpace(db: Firestore, id: string): Promise<SpaceView | null> {
  if (!isSpaceId(id)) return null;
  const d = (await spacesCol(db).doc(id).get()).data() as SpaceDoc | undefined;
  if (d) return { ...d, id };
  return id === DEFAULT_SPACE_ID ? { ...DEFAULT_SPACE, id } : null;
}

const newSpaceId = () => `sp${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-4)}`;

export async function createSpace(db: Firestore, email: string, input: unknown): Promise<SpaceView> {
  const now = Date.now();
  const doc = sanitizeSpace(input, null, email, now);
  if (spaceKind(doc) === "agency") {
    // 대행 — 있는 업체여야 하고, 만드는 사람은 그 업체 담당자 또는 관리자
    const members = (await clientMembersMap(db, true)).get(doc.clientId!);
    if (!members) throw new AccessError(404, "계약 업체를 찾지 못했습니다.");
    if (!members.includes(email) && !isShortsAdmin(email)) throw new AccessError(403, "그 업체의 담당자나 AI STUDIO 관리자만 대행 프로젝트를 만듭니다.");
  }
  const all = await listSpaces(db, true);
  if (all.some((s) => s.name === doc.name)) throw new Error(`「${doc.name}」 프로젝트가 이미 있습니다.`);
  const id = newSpaceId();
  await spacesCol(db).doc(id).create({ ...doc, order: Math.max(0, ...all.map((s) => s.order)) + 1 });
  return { ...doc, id };
}

/** 고치기 — 팀 공용이라 누구나. 보관 · 되살리기는 관리자만, 기본 프로젝트는 보관할 수 없다 */
export async function updateSpace(db: Firestore, email: string, id: unknown, input: unknown, admin: boolean): Promise<SpaceView> {
  if (!isSpaceId(id)) throw new Error("프로젝트 id 가 올바르지 않습니다.");
  const prev = await getSpace(db, id);
  if (!prev) throw new AccessError(404, "프로젝트를 찾지 못했습니다.");
  const r = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  if (typeof r.archived === "boolean" && r.archived !== prev.archived) {
    if (!admin) throw new AccessError(403, "프로젝트 보관은 AI STUDIO 관리자만 합니다.");
    if (id === DEFAULT_SPACE_ID && r.archived) throw new Error("기본 프로젝트는 보관할 수 없습니다.");
  }
  await assertSpaceAccess(db, prev, email);
  const { id: _id, ...base } = prev;
  const next = sanitizeSpace(r, base, email);
  if (next.name !== prev.name && (await listSpaces(db, true)).some((s) => s.id !== id && s.name === next.name)) throw new Error(`「${next.name}」 프로젝트가 이미 있습니다.`);
  await spacesCol(db).doc(id).set(next);
  return { ...next, id };
}

/** AI 에 넘길 채널 주제 — 기본 프로젝트(살림)는 원래 프롬프트 그대로라 null */
export async function spaceNiche(db: Firestore): Promise<{ name: string; description: string } | null> {
  const id = currentSpace(db);
  if (!id || id === DEFAULT_SPACE_ID) return null;
  const s = await getSpace(db, id);
  return s ? { name: s.name, description: s.description } : null;
}

// ---- 요청의 프로젝트 ----------------------------------------------------------

const known = new Map<string, number>();
const knownSpace = new Map<string, SpaceView>();
const KNOWN_MS = 5 * 60_000;

/**
 * 화면이 보낸 프로젝트(머리글)가 있는 프로젝트인지 — 없는 id 로 아무 컬렉션이나 만들지 않게.
 * email 을 주면 대행 프로젝트를 볼 수 있는 사람인지도 본다 (관리자 · 그 업체 담당자).
 */
export async function spaceFromRequest(req: Request, db: Firestore, email?: string): Promise<string> {
  const raw = (req.headers.get(SPACE_HEADER) ?? "").trim();
  if (!raw || raw === DEFAULT_SPACE_ID) return DEFAULT_SPACE_ID;
  if (!isSpaceId(raw)) throw new Error("프로젝트 id 가 올바르지 않습니다.");
  const at = known.get(raw);
  let s = at && Date.now() - at < KNOWN_MS ? (knownSpace.get(raw) ?? null) : null;
  if (!s) {
    s = await getSpace(db, raw);
    if (!s) throw new AccessError(404, "고른 프로젝트를 찾지 못했습니다. 위의 프로젝트를 다시 골라 주세요.");
    known.set(raw, Date.now());
    knownSpace.set(raw, s);
  }
  if (email) await assertSpaceAccess(db, s, email);
  return raw;
}

/** 요청의 프로젝트로 감싼 db — email 을 주면 대행 프로젝트 권한도 본다 */
export async function requestDb(req: Request, db: Firestore, email?: string): Promise<Firestore> {
  return spaceDb(db, await spaceFromRequest(req, db, email));
}

/**
 * 자동 실행(cron) — 보관하지 않은 프로젝트마다 차례로. until 까지 남은 시간을 남은 프로젝트 수로
 * 나눠 각자의 마감(deadline)으로 넘긴다 (앞 프로젝트가 일찍 끝나면 뒤가 더 쓴다).
 */
export async function forEachSpace<T>(db: Firestore, until: number, fn: (sdb: Firestore, space: SpaceView, deadline: number) => Promise<T>): Promise<Record<string, T | string>> {
  const out: Record<string, T | string> = {};
  const list = await listSpaces(db);
  for (let i = 0; i < list.length; i++) {
    const s = list[i];
    const deadline = Date.now() + Math.max(0, until - Date.now()) / (list.length - i);
    try {
      out[s.name] = await fn(spaceDb(db, s.id), s, deadline);
    } catch (e) {
      out[s.name] = e instanceof Error ? e.message : String(e);
    }
  }
  return out;
}
