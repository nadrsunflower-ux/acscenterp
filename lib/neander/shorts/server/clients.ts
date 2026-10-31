import "server-only";

// ============================================================
//  고객사 (브랜드 대행) — 계약 · 브리프 · 금지 표현 · 제품 · 담당자
// ------------------------------------------------------------
//  월 N편 · 수정 상한 · 승인 · 월간 보고의 바탕이 되는 문서. 조회수 약속 칸은 없다.
//
//  권한: 담당자(members)만 읽고 고친다. 만든 사람은 늘 담당자다. 쇼츠 관리자는 읽기만.
//  담당자 목록은 그 고객사의 프로젝트(members)와 고객사 계정(clientMembers)에 사본으로
//  붙는다 — 담당자가 바뀌면 여기서 함께 고친다 (access.ts 가 사본으로 바로 판단하도록).
// ============================================================

import { randomBytes } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import { AccessError } from "@/lib/neander/server/auth";
import { NEANDER_COL } from "@/lib/neander/collections";
import { currentMonth, emptyProject, httpUrl, newId } from "../model";
import type { FormatDoc } from "../scout";
import type { ClientDoc, ClientProduct, ClientView, ProjectDoc } from "../types";

const col = (db: Firestore) => db.collection(NEANDER_COL.shortsClients);
const isId = (v: unknown): v is string => typeof v === "string" && /^[\w-]{6,60}$/.test(v);
const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
const list = (v: unknown, n: number, max: number) => (Array.isArray(v) ? v.map((x) => str(x, max).trim()).filter(Boolean).slice(0, n) : []);
const monthOf = (v: unknown) => (typeof v === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(v) ? v : null);

export const isClientMember = (c: Pick<ClientDoc, "members"> | undefined, email: string) => !!c && c.members.includes(email);

export async function getClientDoc(db: Firestore, id: unknown): Promise<ClientDoc & { id: string }> {
  if (!isId(id)) throw new Error("고객사 id 가 올바르지 않습니다.");
  const d = (await col(db).doc(id).get()).data() as ClientDoc | undefined;
  if (!d) throw new AccessError(404, "고객사를 찾지 못했습니다.");
  return { ...d, id };
}

/** 읽기 — 담당자 또는 관리자(몰아보기) */
export async function getClient(db: Firestore, email: string, id: unknown, admin = false): Promise<ClientDoc & { id: string }> {
  const c = await getClientDoc(db, id);
  if (!isClientMember(c, email) && !admin) throw new AccessError(403, `「${c.name}」 의 담당자가 아닙니다.`);
  return c;
}

/** 고치기 — 담당자만 */
export async function getClientForEdit(db: Firestore, email: string, id: unknown): Promise<ClientDoc & { id: string }> {
  const c = await getClientDoc(db, id);
  if (!isClientMember(c, email)) throw new AccessError(403, `「${c.name}」 의 담당자만 고칠 수 있습니다.`);
  return c;
}

export const toClientView = (id: string, c: ClientDoc, email: string): ClientView => ({ ...c, id, canEdit: isClientMember(c, email) });

export async function listClients(db: Firestore, email: string, admin = false): Promise<ClientView[]> {
  const snap = admin ? await col(db).get() : await col(db).where("members", "array-contains", email).get();
  return snap.docs.map((d) => toClientView(d.id, d.data() as ClientDoc, email)).sort((a, b) => a.name.localeCompare(b.name, "ko"));
}

function sanitizeProducts(v: unknown, prev: ClientProduct[]): ClientProduct[] {
  return (Array.isArray(v) ? v.slice(0, 40) : []).map((raw) => {
    const r = (raw ?? {}) as Record<string, unknown>;
    const id = typeof r.id === "string" && /^[\w-]{1,48}$/.test(r.id) ? r.id : newId("pd_");
    const old = prev.find((x) => x.id === id);
    return {
      id,
      name: str(r.name, 120).trim() || old?.name || "제품",
      url: httpUrl(str(r.url, 2000)),
      facts: list(r.facts, 20, 300),
      photoIds: (Array.isArray(r.photoIds) ? r.photoIds : []).filter((x): x is string => typeof x === "string" && /^[\w-]{10,40}$/.test(x)).slice(0, 20),
      note: str(r.note, 1000),
    };
  });
}

export async function saveClient(db: Firestore, email: string, id: unknown, input: unknown): Promise<string> {
  const r = (input ?? {}) as Record<string, unknown>;
  const prev = id ? await getClientForEdit(db, email, id) : null;
  const contract = (r.contract ?? {}) as Record<string, unknown>;
  const brief = (r.brief ?? {}) as Record<string, unknown>;
  // 담당자 — 등록된 팀원만, 만든 사람은 빠지지 않는다
  const wanted = [...new Set([...(Array.isArray(r.members) ? r.members : []).map((e) => String(e).trim().toLowerCase()).filter(Boolean), prev?.createdBy ?? email])].slice(0, 20);
  for (const e of wanted) {
    if (e === email || e === prev?.createdBy) continue;
    if (!(await db.collection(NEANDER_COL.memberEmails).doc(e).get()).exists) throw new Error(`${e} 은 등록된 팀원이 아닙니다.`);
  }
  if (!wanted.includes(email) && prev) throw new Error("자기 자신을 담당자에서 뺄 수 없습니다 — 다른 담당자가 빼 주세요.");
  const now = Date.now();
  const doc: ClientDoc = {
    name: str(r.name, 80).trim() || prev?.name || "새 고객사",
    status: r.status === "paused" || r.status === "ended" ? r.status : "active",
    members: wanted,
    createdBy: prev?.createdBy ?? email,
    createdAt: prev?.createdAt ?? now,
    updatedAt: now,
    updatedBy: email,
    contract: {
      monthlyFeeKrw: typeof contract.monthlyFeeKrw === "number" && contract.monthlyFeeKrw >= 0 ? Math.round(contract.monthlyFeeKrw) : null,
      vat: contract.vat === "included" ? "included" : "excluded",
      videosPerMonth: Math.min(60, Math.max(1, Math.round(Number(contract.videosPerMonth) || 8))),
      revisionLimit: Math.min(10, Math.max(0, Math.round(Number(contract.revisionLimit ?? 2)))),
      startMonth: monthOf(contract.startMonth) ?? prev?.contract.startMonth ?? currentMonth(),
      endMonth: monthOf(contract.endMonth),
      financeCode: str(contract.financeCode, 30).trim(),
      note: str(contract.note, 2000),
    },
    brief: {
      summary: str(brief.summary, 3000),
      target: str(brief.target, 500),
      tone: str(brief.tone, 300),
      keyMessages: list(brief.keyMessages, 15, 200),
      mustInclude: list(brief.mustInclude, 15, 200),
      banned: list(brief.banned, 60, 80),
      references: list(brief.references, 15, 2000).map(httpUrl).filter(Boolean),
      notes: str(brief.notes, 3000),
    },
    products: sanitizeProducts(r.products, prev?.products ?? []),
    contactName: str(r.contactName, 60),
  };
  const ref = prev ? col(db).doc(prev.id) : col(db).doc(randomBytes(12).toString("base64url"));
  await ref.set(doc);
  if (!prev || prev.members.join() !== doc.members.join() || prev.name !== doc.name) await syncClientCopies(db, ref.id, doc);
  return ref.id;
}

/** 담당자 목록 · 이름 사본을 프로젝트 · 고객사 계정에 */
export async function syncClientCopies(db: Firestore, clientId: string, c: Pick<ClientDoc, "members" | "name">) {
  const [ps, accs] = await Promise.all([
    db.collection(NEANDER_COL.shortsProjects).where("clientId", "==", clientId).get(),
    db.collection(NEANDER_COL.shortsAccounts).where("clientId", "==", clientId).get(),
  ]);
  for (const d of ps.docs) await d.ref.update({ members: c.members, clientName: c.name });
  for (const d of accs.docs) await d.ref.update({ clientMembers: c.members });
}

export async function deleteClient(db: Firestore, email: string, id: unknown): Promise<void> {
  const c = await getClientForEdit(db, email, id);
  if (c.createdBy !== email) throw new AccessError(403, "고객사를 만든 사람만 지울 수 있습니다.");
  const ps = await db.collection(NEANDER_COL.shortsProjects).where("clientId", "==", c.id).limit(1).get();
  if (!ps.empty) throw new Error("이 고객사의 영상이 있어 지울 수 없습니다 — 상태를 「종료」 로 바꿔 주세요.");
  const accs = await db.collection(NEANDER_COL.shortsAccounts).where("clientId", "==", c.id).limit(1).get();
  if (!accs.empty) throw new Error("이 고객사 소유 게시 계정의 연결을 먼저 끊어 주세요.");
  const media = await db.collection(NEANDER_COL.shortsMedia).where("clientId", "==", c.id).get();
  for (const d of media.docs) await db.recursiveDelete(d.ref);
  await col(db).doc(c.id).delete();
}

/**
 * 고객사 영상 한 편 만들기 — 그 달 계약분. 제품의 확인된 사실이 대본의 재료가 되고,
 * 정찰 형식 카드를 고르면 그 형식(훅 · 구성 · 편집 · 소리)을 참고 자료로 옮긴다.
 * AI 로만 만드는 대행이라 제작 방식 기본은 「전체 AI」.
 */
export async function createClientProject(
  db: Firestore,
  email: string,
  input: { clientId?: unknown; month?: unknown; productId?: unknown; formatId?: unknown; brandTarget?: unknown; title?: unknown },
): Promise<string> {
  const c = await getClientForEdit(db, email, input.clientId);
  const month = monthOf(input.month) ?? currentMonth();
  const product = c.products.find((x) => x.id === input.productId) ?? null;
  let format: (FormatDoc & { id: string }) | null = null;
  if (isId(input.formatId)) {
    const f = (await db.collection(NEANDER_COL.shortsFormats).doc(input.formatId).get()).data() as FormatDoc | undefined;
    if (f) format = { ...f, id: input.formatId };
  }
  const existing = await db.collection(NEANDER_COL.shortsProjects).where("clientId", "==", c.id).get();
  const nInMonth = existing.docs.filter((d) => (d.data() as ProjectDoc).month === month).length + 1;
  const target = input.brandTarget === "own" ? "own" : "client";
  const p = emptyProject(email, {
    title: str(input.title, 200).trim() || `${c.name} ${month.slice(5)}월 #${nInMonth}${product ? ` · ${product.name}` : ""}${format ? ` · ${format.name}` : ""}`,
    product: product?.name ?? "",
    category: "브랜드 대행",
    visibility: "private",
  });
  const doc: ProjectDoc = {
    ...p,
    kind: "brand",
    clientId: c.id,
    clientName: c.name,
    month,
    clientProductId: product?.id ?? null,
    formatId: format?.id ?? null,
    brandTarget: target,
    members: c.members,
    mode: "ai",
    facts: product?.facts ?? [],
    notes: [c.brief.summary && `브리프: ${c.brief.summary}`, product?.note && `제품 메모: ${product.note}`].filter(Boolean).join("\n\n"),
    output: { ...p.output, disclosureOverlay: target === "own" },
    cta: { ...p.cta, type: "link_in_bio", wording: "" },
    reference: format
      ? {
          url: "",
          title: `정찰 형식 「${format.name}」`,
          transcript: "",
          timing: format.structure.map((x, i) => `${i + 1}. ${x}`).join("\n"),
        }
      : p.reference,
    analysis: format
      ? {
          basis: [],
          urlRead: false,
          refs: [],
          totalSec: null,
          productRevealSec: null,
          avgShotSec: null,
          cutCount: null,
          hookPattern: format.hook,
          beats: [],
          narrationSubtitle: "unknown",
          cta: { type: "link_in_bio", keyword: "", wording: "", atSec: null },
          notes: [
            `형식 요약: ${format.summary}`,
            `편집: ${format.editing}`,
            `소리: ${format.sound}`,
            `화면 글자: ${format.textOverlay}`,
            `왜 먹히나: ${format.whyItWorks}`,
            `AI 제작: ${format.aiFeasibility.level} — 쉬운 부분 ${format.aiFeasibility.easyParts} / 어려운 부분 ${format.aiFeasibility.hardParts}`,
            format.riskNote && `위험: ${format.riskNote}`,
          ]
            .filter(Boolean)
            .join("\n"),
          by: "manual",
        }
      : null,
  };
  const id = randomBytes(12).toString("base64url");
  await db.collection(NEANDER_COL.shortsProjects).doc(id).set(doc);
  return id;
}
