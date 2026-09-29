import "server-only";

// ============================================================
//  발표 장표 저장소 — 내용 · 사진 · 회의용 저장본 (Firestore, 서버만)
// ------------------------------------------------------------
//    neander_decks/{slug}            제목 · 판 번호 · 조각 수 · 해시
//      ├─ parts/{n}                  내용 JSON 의 UTF-8 바이트 조각 (700KB)
//      └─ assets/{id}                사진·지도 타일 바이트 (한 장 900KB 이하)
//    neander_deck_scenarios/{id}     회의용 저장본 (slug · 이름 · 덮어쓴 값 · 만든 사람)
//
//  내용을 저장소(깃)에 두지 않는 이유는 lib/neander/decks/types.ts 머리말.
//  이 컬렉션들은 보안 규칙에 없다 — 브라우저는 직접 읽지 못하고 로그인
//  확인을 거친 API 로만 받는다 (인감 이미지와 같은 길).
//
//  개발 PC 에서는 올리기 전에도 볼 수 있게 private/decks/<slug>/ 의 로컬
//  사본을 먼저 본다 (content.json · assets/<id>.<확장자>). 배포본에는 그
//  폴더가 없어 Firestore 만 쓴다.
// ============================================================

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { Firestore } from "firebase-admin/firestore";
import { NEANDER_COL } from "@/lib/neander/collections";
import type { AssumptionValue, DeckContent, DeckScenario } from "../types";

export const PART_BYTES = 700 * 1024;
export const ASSET_MAX_BYTES = 900 * 1024;

export const isSlug = (s: unknown): s is string => typeof s === "string" && /^[\w-]{3,60}$/.test(s);
export const isAssetId = (s: unknown): s is string => typeof s === "string" && /^[\w-]{1,80}$/.test(s);

const deckRef = (db: Firestore, slug: string) => db.collection(NEANDER_COL.decks).doc(slug);

/** 로컬 사본 자리 — 개발 PC 에서만 있다 */
export const localDeckDir = (slug: string) => path.join(process.cwd(), "private", "decks", slug);
const preferLocal = () => process.env.NODE_ENV !== "production" && process.env.DECK_SOURCE !== "firestore";

interface DeckHead {
  title: string;
  version: number;
  parts: number;
  bytes: number;
  sha256: string;
  updatedAt: number;
  updatedBy: string;
}

// ---- 내용 ----------------------------------------------------

export async function readDeckContent(
  db: Firestore,
  slug: string,
): Promise<{ content: DeckContent; source: "firestore" | "local" } | null> {
  if (preferLocal()) {
    const file = path.join(localDeckDir(slug), "content.json");
    if (existsSync(file)) {
      return { content: JSON.parse(await readFile(file, "utf8")) as DeckContent, source: "local" };
    }
  }
  const head = (await deckRef(db, slug).get()).data() as DeckHead | undefined;
  if (!head) return null;
  const snaps = await Promise.all(
    Array.from({ length: head.parts }, (_, n) => deckRef(db, slug).collection("parts").doc(String(n)).get()),
  );
  const buf = Buffer.concat(
    snaps.map((s) => {
      const d = s.data() as { data?: Buffer | Uint8Array } | undefined;
      if (!d?.data) throw new Error(`장표 내용 조각 ${s.id} 가 없습니다. 다시 올려 주세요.`);
      return Buffer.from(d.data);
    }),
  );
  return { content: JSON.parse(buf.toString("utf8")) as DeckContent, source: "firestore" };
}

/** 올리기 — 같은 해시면 건너뛴다. 조각 수가 줄면 남는 조각을 지운다 */
export async function writeDeckContent(
  db: Firestore,
  content: DeckContent,
  by: string,
): Promise<{ changed: boolean; bytes: number; parts: number }> {
  const buf = Buffer.from(JSON.stringify(content), "utf8");
  const sha256 = createHash("sha256").update(buf).digest("hex");
  const ref = deckRef(db, content.slug);
  const prev = (await ref.get()).data() as DeckHead | undefined;
  const parts = Math.ceil(buf.length / PART_BYTES);
  if (prev?.sha256 === sha256) return { changed: false, bytes: buf.length, parts };

  for (let n = 0; n < parts; n++) {
    await ref.collection("parts").doc(String(n)).set({ data: buf.subarray(n * PART_BYTES, (n + 1) * PART_BYTES) });
  }
  for (let n = parts; n < (prev?.parts ?? 0); n++) await ref.collection("parts").doc(String(n)).delete();
  const head: DeckHead = {
    title: content.meta.title,
    version: content.version,
    parts,
    bytes: buf.length,
    sha256,
    updatedAt: Date.now(),
    updatedBy: by,
  };
  await ref.set(head);
  return { changed: true, bytes: buf.length, parts };
}

// ---- 사진·지도 타일 -------------------------------------------

const MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

export const mimeOf = (file: string) => MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream";

async function readLocalAsset(slug: string, id: string): Promise<{ bytes: Uint8Array; mime: string } | null> {
  const dir = path.join(localDeckDir(slug), "assets");
  if (!existsSync(dir)) return null;
  const name = (await readdir(dir)).find((f) => path.parse(f).name === id && MIME[path.extname(f).toLowerCase()]);
  if (!name) return null;
  return { bytes: new Uint8Array(await readFile(path.join(dir, name))), mime: mimeOf(name) };
}

export async function readDeckAsset(
  db: Firestore,
  slug: string,
  id: string,
): Promise<{ bytes: Uint8Array; mime: string } | null> {
  if (preferLocal()) {
    const local = await readLocalAsset(slug, id);
    if (local) return local;
  }
  const d = (await deckRef(db, slug).collection("assets").doc(id).get()).data() as
    | { data?: Buffer | Uint8Array; mime?: string }
    | undefined;
  if (!d?.data) return null;
  return { bytes: new Uint8Array(d.data), mime: d.mime ?? "application/octet-stream" };
}

export async function writeDeckAsset(
  db: Firestore,
  slug: string,
  id: string,
  data: Buffer,
  mime: string,
): Promise<boolean> {
  if (data.length > ASSET_MAX_BYTES) throw new Error(`${id}: ${data.length} bytes — 너무 크다 (900KB 이하)`);
  const sha256 = createHash("sha256").update(data).digest("hex");
  const ref = deckRef(db, slug).collection("assets").doc(id);
  const prev = (await ref.get()).data() as { sha256?: string } | undefined;
  if (prev?.sha256 === sha256) return false;
  await ref.set({ data, mime, bytes: data.length, sha256, updatedAt: Date.now() });
  return true;
}

// ---- 회의용 저장본 --------------------------------------------

const scenarios = (db: Firestore) => db.collection(NEANDER_COL.deckScenarios);

const MAX_VALUES = 300;

/** 저장본 값은 숫자·켜기끄기·비움만 — 모양이 다르면 받지 않는다 */
export function sanitizeScenarioValues(raw: unknown): Record<string, AssumptionValue> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("값 형식이 올바르지 않습니다.");
  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length > MAX_VALUES) throw new Error("값이 너무 많습니다.");
  const out: Record<string, AssumptionValue> = {};
  for (const [k, v] of entries) {
    if (!/^[\w]{1,60}$/.test(k)) continue;
    if (v === null || typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v))) out[k] = v;
  }
  return out;
}

export async function listScenarios(db: Firestore, slug: string): Promise<DeckScenario[]> {
  const snap = await scenarios(db).where("slug", "==", slug).get();
  return snap.docs
    .map((d) => ({ id: d.id, ...(d.data() as Omit<DeckScenario, "id">) }))
    .sort((a, b) => b.createdAt - a.createdAt);
}

export async function saveScenario(
  db: Firestore,
  slug: string,
  name: string,
  values: Record<string, AssumptionValue>,
  by: string,
): Promise<DeckScenario> {
  const clean = name.trim().slice(0, 60);
  if (!clean) throw new Error("저장본 이름을 적어 주세요.");
  const doc = { slug, name: clean, values, createdBy: by, createdAt: Date.now() };
  const ref = await scenarios(db).add(doc);
  return { id: ref.id, ...doc };
}

export async function deleteScenario(db: Firestore, slug: string, id: string, by: string): Promise<void> {
  if (!/^[\w-]{10,40}$/.test(id)) throw new Error("저장본 id 가 올바르지 않습니다.");
  const ref = scenarios(db).doc(id);
  const d = (await ref.get()).data() as DeckScenario | undefined;
  if (!d || d.slug !== slug) throw new Error("저장본을 찾지 못했습니다.");
  if (d.createdBy !== by) throw new Error("저장본은 만든 사람만 지울 수 있습니다.");
  await ref.delete();
}
