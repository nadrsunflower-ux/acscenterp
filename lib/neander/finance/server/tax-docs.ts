import "server-only";

// ============================================================
//  급여·세무 서류 저장소 — Firestore 조각
// ------------------------------------------------------------
//  Firebase Storage 버킷이 없어서(2026-09-18 · 10-14 확인) 회의 첨부
//  (meetings/server/files.ts)와 같은 길을 간다 — 브라우저가 768KB 씩 나눠 보내고,
//  서버는 조각을 문서(1MB 한도)에 하나씩 둔다.
//
//    neander_fin_tax_docs/{id}     종류 · 귀속 · 읽은 숫자 · 이름 · 크기 · 해시 · complete
//      └─ parts/{n}                data (bytes)
//
//  조각이 다 오면(complete) 서버가 파일을 읽어 종류 · 귀속 · 숫자를 정한다
//  (tax-docs-parse.ts). **읽은 글자는 저장하지 않는다** — 원천징수영수증에는
//  주민등록번호가 있다. 숫자와 이름만 남긴다.
//
//  같은 파일(sha256)을 또 올리면 새로 만들지 않고 있는 것을 돌려준다 — 폴더를
//  통째로 다시 올려도 겹치지 않는다. 사람이 종류 · 귀속을 고친 서류(manual)는
//  다시 읽어도 그 둘을 덮어쓰지 않는다.
//
//  보안 규칙에 없는 컬렉션이라 서버만 붙는다. 권한은 재무와 같다 (라우트의 requireErpUser).
// ============================================================

import { randomBytes } from "node:crypto";
import type { DocumentReference, Firestore } from "firebase-admin/firestore";
import { extractText } from "unpdf";
import { NEANDER_COL } from "@/lib/neander/collections";
import {
  isPeriodFor,
  isTaxDocKind,
  TAX_DOC_EXTS,
  TAX_DOC_MAX_BYTES,
  TAX_DOC_PART_BYTES,
  TAX_ENTITIES,
  taxDocExt,
  type TaxDoc,
  type TaxDocKind,
} from "../tax-docs";
import { readTaxDoc, shareSiblingPeriod, type TaxPeriodSource } from "../tax-docs-parse";

interface StoredDoc extends Omit<TaxDoc, "id"> {
  sha256: string;
  parts: number;
  complete: boolean;
  periodSource?: TaxPeriodSource;
  /** 올린 폴더에서 짐작한 달 — 다시 읽을 때도 쓴다 */
  folderMonth?: string;
  updatedAt?: number;
  updatedBy?: string;
}

const STALE_MS = 24 * 60 * 60 * 1000;

const col = (db: Firestore) => db.collection(NEANDER_COL.finTaxDocs);
const docRef = (db: Firestore, id: string) => col(db).doc(id);
const partRef = (db: Firestore, id: string, n: number) => docRef(db, id).collection("parts").doc(String(n));

const newId = () => randomBytes(12).toString("base64url");
const isId = (id: unknown): id is string => typeof id === "string" && /^[\w-]{10,40}$/.test(id);

/** Firestore 는 undefined 를 거부한다 */
function clean<T extends object>(obj: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v;
  return out;
}

const view = (id: string, d: StoredDoc): TaxDoc => {
  const { sha256: _s, parts: _p, complete: _c, periodSource: _ps, folderMonth: _f, updatedAt: _ua, updatedBy: _ub, ...rest } = d;
  return { id, ...rest };
};

async function getDoc(db: Firestore, id: unknown): Promise<StoredDoc> {
  if (!isId(id)) throw new Error("서류 id 가 올바르지 않습니다.");
  const d = (await docRef(db, id).get()).data() as StoredDoc | undefined;
  if (!d) throw new Error("서류를 찾지 못했습니다. 다른 사람이 지웠을 수 있습니다.");
  return d;
}

export async function listTaxDocs(db: Firestore): Promise<TaxDoc[]> {
  const snap = await col(db).get();
  const out: TaxDoc[] = [];
  const junk: DocumentReference[] = [];
  for (const d of snap.docs) {
    const s = d.data() as StoredDoc;
    if (s.complete) out.push(view(d.id, s));
    else if (s.createdAt < Date.now() - STALE_MS) junk.push(d.ref);
  }
  // 창을 닫아 끊긴 업로드 — 목록 응답을 오래 붙잡지 않게 몇 개씩만
  for (const ref of junk.slice(0, 3)) await db.recursiveDelete(ref).catch(() => undefined);
  return out.sort((a, b) => a.createdAt - b.createdAt);
}

export type CreateResult = { id: string; partBytes: number; parts: number } | { duplicate: TaxDoc };

export async function createTaxDoc(
  db: Firestore,
  by: string,
  meta: { name?: unknown; type?: unknown; size?: unknown; sha256?: unknown; folderMonth?: unknown },
): Promise<CreateResult> {
  const name = String(meta.name ?? "").normalize("NFC").slice(0, 200) || "서류";
  const size = Number(meta.size) || 0;
  const sha256 = String(meta.sha256 ?? "");
  if (size <= 0) throw new Error(`${name} — 빈 파일은 올릴 수 없습니다.`);
  if (size > TAX_DOC_MAX_BYTES) throw new Error(`${name} — 한 파일은 ${TAX_DOC_MAX_BYTES / 1024 / 1024}MB 까지 올릴 수 있습니다.`);
  if (!TAX_DOC_EXTS.includes(taxDocExt(name))) throw new Error(`${name} — 올릴 수 있는 형식은 ${TAX_DOC_EXTS.join(", ")} 입니다.`);
  if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error("파일 지문(sha256)이 없습니다.");

  const same = await col(db).where("sha256", "==", sha256).get();
  const done = same.docs.find((d) => (d.data() as StoredDoc).complete);
  if (done) return { duplicate: view(done.id, done.data() as StoredDoc) };

  const folderMonth = typeof meta.folderMonth === "string" && /^20\d\d-\d\d$/.test(meta.folderMonth) ? meta.folderMonth : undefined;
  const parts = Math.ceil(size / TAX_DOC_PART_BYTES);
  const id = newId();
  const doc: StoredDoc = {
    kind: "other",
    name,
    type: String(meta.type || "application/octet-stream").slice(0, 120),
    size,
    sha256,
    uploadedBy: by,
    createdAt: Date.now(),
    parts,
    complete: false,
    ...(folderMonth ? { folderMonth } : {}),
  };
  await docRef(db, id).set(clean(doc));
  return { id, partBytes: TAX_DOC_PART_BYTES, parts };
}

export async function putTaxDocPart(db: Firestore, by: string, id: unknown, n: number, data: Buffer): Promise<void> {
  const d = await getDoc(db, id);
  if (d.uploadedBy !== by || d.complete) throw new Error("이 서류에는 조각을 더 넣을 수 없습니다.");
  if (!Number.isInteger(n) || n < 0 || n >= d.parts) throw new Error("조각 번호가 올바르지 않습니다.");
  if (data.length > TAX_DOC_PART_BYTES) throw new Error("조각이 너무 큽니다.");
  await partRef(db, id as string, n).set({ data });
}

async function readBytes(db: Firestore, id: string, d: StoredDoc, from = 0, count = d.parts): Promise<Buffer> {
  const refs = [];
  for (let n = from; n < Math.min(d.parts, from + count); n++) refs.push(partRef(db, id, n));
  const snaps = refs.length ? await db.getAll(...refs) : [];
  return Buffer.concat(
    snaps.map((s) => {
      const data = s.data()?.data as Buffer | undefined;
      if (!data) throw new Error(`「${d.name}」 의 조각이 빠져 있습니다. 다시 올려 주세요.`);
      return Buffer.from(data);
    }),
  );
}

/** PDF 쪽마다 글자 — 글자 층이 없거나 못 읽으면 빈 배열 (종류는 파일 이름으로 정한다) */
export async function pdfPages(bytes: Uint8Array): Promise<string[]> {
  try {
    const r = await extractText(bytes, { mergePages: false });
    return Array.isArray(r.text) ? r.text : [String(r.text)];
  } catch {
    return [];
  }
}

/** 파일을 읽어 종류 · 귀속 · 숫자를 정한 필드 (사람이 고친 종류 · 귀속은 그대로) */
async function readFields(name: string, bytes: Uint8Array, prev: StoredDoc): Promise<Partial<StoredDoc>> {
  const pages = taxDocExt(name) === "pdf" ? await pdfPages(bytes) : [];
  const g = readTaxDoc({ name, pages, folderMonth: prev.folderMonth });
  // 같이 올린 서류에서 빌린 귀속은 다시 읽어도 남긴다 — 이 파일 혼자서는 다시 못 정한다
  const keepSibling = prev.periodSource === "sibling" && g.periodSource !== "text" && g.kind === prev.kind;
  return {
    ...(prev.manual || keepSibling ? {} : { kind: g.kind, period: g.period, periodSource: g.periodSource }),
    entity: prev.manual && prev.entity ? prev.entity : g.entity,
    data: g.data,
    scanned: taxDocExt(name) === "pdf" ? g.scanned : undefined,
    reason: keepSibling ? prev.reason : g.reason,
  };
}

/** 조각이 다 왔는지 세어 보고, 읽어서 목록에 올린다 */
export async function completeTaxDoc(db: Firestore, by: string, id: unknown): Promise<TaxDoc> {
  const d = await getDoc(db, id);
  if (d.uploadedBy !== by) throw new Error("올리기 시작한 사람만 마칠 수 있습니다.");
  const agg = await docRef(db, id as string).collection("parts").count().get();
  if (agg.data().count !== d.parts) throw new Error(`「${d.name}」 이(가) 다 올라가지 않았습니다. 다시 올려 주세요.`);
  const fields = await readFields(d.name, new Uint8Array(await readBytes(db, id as string, d)), d);
  const next: StoredDoc = { ...d, ...fields, complete: true };
  await docRef(db, id as string).set(clean(next));
  return view(id as string, next);
}

/**
 * 같이 올린 서류끼리 귀속 빌려주기 (tax-docs-parse.ts 의 shareSiblingPeriod).
 * 한 번에 올린 묶음마다 부른다 — 화면은 폴더 단위로, 이관 스크립트도 폴더 단위로.
 */
export async function shareTaxDocSiblings(db: Firestore, ids: unknown): Promise<TaxDoc[]> {
  if (!Array.isArray(ids) || !ids.every(isId) || ids.length > 300) throw new Error("서류 id 목록이 올바르지 않습니다.");
  const snaps = ids.length ? await db.getAll(...ids.map((id) => docRef(db, id))) : [];
  const group = snaps
    .filter((s) => s.exists)
    .map((s) => ({ id: s.id, ...(s.data() as StoredDoc) }))
    .filter((s) => s.complete && !s.manual)
    .map((s) => ({ ...s, periodSource: s.periodSource ?? ("none" as TaxPeriodSource), reason: s.reason ?? "" }));
  const shared = shareSiblingPeriod(group);
  const changed = shared.filter((s, i) => s.period !== group[i].period);
  for (const s of changed) {
    await docRef(db, s.id).update(clean({ period: s.period, periodSource: s.periodSource, reason: s.reason }));
  }
  return changed.map(({ id, ...rest }) => view(id, rest as StoredDoc));
}

export interface TaxDocPatch {
  kind?: unknown;
  period?: unknown;
  entity?: unknown;
  note?: unknown;
}

/** 사람이 고친다 — 종류 · 귀속을 고치면 manual 이 붙어 다시 읽어도 안 바뀐다 */
export async function updateTaxDoc(db: Firestore, by: string, id: unknown, patch: TaxDocPatch): Promise<TaxDoc> {
  const d = await getDoc(db, id);
  if (!d.complete) throw new Error("아직 올라가는 중인 서류입니다.");
  const next: StoredDoc = { ...d, updatedAt: Date.now(), updatedBy: by };
  if (patch.kind !== undefined || patch.period !== undefined) {
    const kind = (patch.kind ?? d.kind) as TaxDocKind;
    if (!isTaxDocKind(kind)) throw new Error("서류 종류가 올바르지 않습니다.");
    const period = patch.period === undefined ? d.period : String(patch.period || "") || undefined;
    if (period !== undefined && !isPeriodFor(kind, period)) throw new Error(`귀속 「${period}」 이(가) 이 종류에 맞지 않습니다.`);
    next.kind = kind;
    next.period = period;
    next.periodSource = undefined;
    next.manual = true;
    next.reason = `${by.split("@")[0]} 님이 고침`;
  }
  if (patch.entity !== undefined) {
    const e = String(patch.entity || "");
    if (e && !(TAX_ENTITIES as readonly string[]).includes(e)) throw new Error("사업자가 올바르지 않습니다.");
    next.entity = e || undefined;
  }
  if (patch.note !== undefined) next.note = String(patch.note || "").slice(0, 500) || undefined;
  await docRef(db, id as string).set(clean(next));
  return view(id as string, next);
}

export async function deleteTaxDoc(db: Firestore, id: unknown): Promise<{ name: string } | null> {
  if (!isId(id)) throw new Error("서류 id 가 올바르지 않습니다.");
  const d = (await docRef(db, id).get()).data() as StoredDoc | undefined;
  await db.recursiveDelete(docRef(db, id));
  return d ? { name: d.name } : null;
}

/** 조각 [from, from+count) 을 이어 붙인 바이트 */
export async function readTaxDocParts(db: Firestore, id: unknown, from: number, count: number): Promise<Buffer> {
  const d = await getDoc(db, id);
  if (!d.complete) throw new Error("아직 올라가는 중인 서류입니다.");
  return readBytes(db, id as string, d, from, count);
}

// ---- 이관 스크립트 · 다시 읽기 --------------------------------------

/** 한 번에 넣는다 (서버 안 — 이관 스크립트). 같은 파일이 있으면 그것을 돌려준다 */
export async function putWholeTaxDoc(
  db: Firestore,
  by: string,
  file: { name: string; type: string; bytes: Buffer; sha256: string; folderMonth?: string },
): Promise<{ doc: TaxDoc; duplicate: boolean }> {
  const made = await createTaxDoc(db, by, { name: file.name, type: file.type, size: file.bytes.length, sha256: file.sha256, folderMonth: file.folderMonth });
  if ("duplicate" in made) return { doc: made.duplicate, duplicate: true };
  try {
    for (let n = 0; n < made.parts; n++) {
      await putTaxDocPart(db, by, made.id, n, file.bytes.subarray(n * made.partBytes, (n + 1) * made.partBytes));
    }
    return { doc: await completeTaxDoc(db, by, made.id), duplicate: false };
  } catch (e) {
    await db.recursiveDelete(docRef(db, made.id)).catch(() => undefined);
    throw e;
  }
}

/** 읽기 규칙을 고친 뒤 — 이미 올린 서류를 다시 읽는다 (사람이 고친 종류 · 귀속은 그대로) */
export async function rereadTaxDocs(db: Firestore): Promise<{ id: string; before: string; after: string }[]> {
  const snap = await col(db).get();
  const changes: { id: string; before: string; after: string }[] = [];
  for (const s of snap.docs) {
    const d = s.data() as StoredDoc;
    if (!d.complete) continue;
    const fields = await readFields(d.name, new Uint8Array(await readBytes(db, s.id, d)), d);
    const next = { ...d, ...fields };
    const sig = (x: StoredDoc) => `${x.kind} ${x.period ?? "-"} ${x.entity ?? "-"} ${JSON.stringify(x.data ?? {}).length}`;
    if (sig(next) !== sig(d)) changes.push({ id: s.id, before: sig(d), after: sig(next) });
    await s.ref.set(clean(next));
  }
  return changes;
}
