import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/neander/server/admin";
import { accessErrorResponse, hasFinanceAccess, requireMember } from "@/lib/neander/server/auth";
import { NEANDER_COL } from "@/lib/neander/collections";
import { sanitizeProject, sortProjects, type FinProjectDoc } from "@/lib/neander/finance/project";
import { mergeHiddenSections, pickOps, toProjectView, type OpsField } from "@/lib/neander/projects/view";

// 프로젝트 워크스페이스(/neander/projects) — 팀원 모두가 읽고, 운영 칸만 고친다.
//
//   GET  — 모든 프로젝트를 「운영」 모양으로 (돈 칸은 싣지 않는다 · 재무 권한이 없으면 메모의 「■ 원가」 구역도 뺀다)
//   POST — { id, patch } 바뀐 운영 칸만 (메모 · 남은 일 · 다음엔 · 장비 · 기간 · 납기).
//          재무 권한이 없는 사람이 메모를 저장하면 빼 두었던 「■ 원가」 구역을 서버가 제자리에 다시 넣는다.
//          opsUpdatedAt 을 찍어, 그 전에 열어 둔 재무 화면의 통째 저장이 이 칸들을 덮지 않게 한다.
// 돈 · 문서 · 「자료」는 재무 › 프로젝트 손익(재무 권한)에서만 다룬다. lib/neander/projects/view.ts
export const dynamic = "force-dynamic";

const errorOut = (e: unknown, where: string) => {
  const denied = accessErrorResponse(e);
  if (denied) return denied;
  console.error(`[projects] ${where}`, e);
  return NextResponse.json({ error: e instanceof Error ? e.message : "알 수 없는 오류" }, { status: 500 });
};

/** Firestore 는 undefined 를 못 받는다 — 배열 · 객체 속 빈 값을 걷어 낸다 */
const plain = <T,>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));

export async function GET(req: Request) {
  try {
    const user = await requireMember(req);
    const finance = hasFinanceAccess(user.email);
    const snap = await adminDb().collection(NEANDER_COL.finProjects).get();
    const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as FinProjectDoc);
    return NextResponse.json({ projects: sortProjects(docs).map((p) => toProjectView(p, finance)), financeAccess: finance });
  } catch (e) {
    return errorOut(e, "GET");
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireMember(req);
    const finance = hasFinanceAccess(user.email);
    const body = (await req.json().catch(() => null)) as { id?: unknown; patch?: unknown } | null;
    const id = typeof body?.id === "string" ? body.id : "";
    if (!id) return NextResponse.json({ error: "id 가 필요합니다." }, { status: 400 });
    const ops = pickOps(body?.patch);
    const touched = new Set(Object.keys(ops) as OpsField[]);
    // 메모는 글자와 서식이 한 쌍이다 — 하나만 와도 둘 다 다시 맞춘다
    if (touched.has("note") || touched.has("noteRich")) {
      touched.add("note");
      touched.add("noteRich");
    }
    if (!touched.size) return NextResponse.json({ error: "고칠 칸이 없습니다." }, { status: 400 });

    const ref = adminDb().collection(NEANDER_COL.finProjects).doc(id);
    const now = Date.now();
    const out = await adminDb().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return { error: "프로젝트가 없습니다.", status: 404 } as const;
      const doc = { id: snap.id, ...snap.data() } as FinProjectDoc;
      const next: FinProjectDoc = { ...doc, ...ops };
      if (touched.has("note")) {
        const memo = { note: ops.note, noteRich: ops.noteRich };
        const merged = finance ? memo : mergeHiddenSections(memo, { note: doc.note, noteRich: doc.noteRich });
        next.note = merged.note;
        next.noteRich = merged.noteRich;
      }
      const checked = sanitizeProject(next);
      if (!checked.ok) return { error: checked.error, status: 400 } as const;
      const update: Record<string, unknown> = {};
      for (const k of touched) {
        const v = (checked.value as Record<string, unknown>)[k];
        update[k] = v === undefined || v === "" ? FieldValue.delete() : plain(v);
      }
      tx.update(ref, { ...update, opsUpdatedAt: now, opsUpdatedBy: user.email, updatedAt: now, updatedBy: user.email });
      const saved = { ...doc, ...checked.value, id: doc.id, createdAt: doc.createdAt, opsUpdatedAt: now, updatedAt: now } as FinProjectDoc;
      return { project: toProjectView(saved, finance) } as const;
    });
    if ("error" in out) return NextResponse.json({ error: out.error }, { status: out.status });
    return NextResponse.json(out);
  } catch (e) {
    return errorOut(e, "POST");
  }
}
