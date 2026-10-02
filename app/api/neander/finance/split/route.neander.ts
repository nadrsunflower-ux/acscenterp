import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/neander/server/admin";
import { requireErpUser, accessErrorResponse } from "@/lib/neander/server/auth";
import { NEANDER_COL } from "@/lib/neander/collections";
import { trimTransaction } from "@/lib/neander/finance/payload";
import { buildMerge, buildSplit, validateSplit, type SplitPart } from "@/lib/neander/finance/split";
import type { FinTransaction } from "@/lib/neander/finance/types";

// 거래 나누기 · 합치기 (finance/split.ts).
//
//   POST { action: "split", id, parts: [{ gross, projectCode?, bizMajor?, … }] }
//   POST { action: "merge", id }          그 거래가 든 묶음을 다시 한 줄로
//
// 화면이 들고 있는 거래는 숨긴 필드(중복 검사 키 · 적재 배치)가 빠져 있다. 새 조각은
// 그 필드를 물려받아야 해서(적재를 되돌리면 같이 지워져야 한다) 서버가 원본을 읽어 만든다.
// 한 묶음(batch)으로 쓴다 — 반쯤 나뉜 상태가 남으면 장부의 합이 틀린다.
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const user = await requireErpUser(req);
    const body = (await req.json().catch(() => ({}))) as { action?: string; id?: string; parts?: unknown };
    const id = String(body.id ?? "");
    if (!id) return NextResponse.json({ error: "id 가 필요합니다." }, { status: 400 });
    const db = adminDb();
    const col = db.collection(NEANDER_COL.finTransactions);
    const now = Date.now();
    const read = async (ids: string[]) =>
      (await db.getAll(...ids.map((x) => col.doc(x))))
        .filter((s) => s.exists)
        .map((s) => trimTransaction({ id: s.id, ...s.data() }));

    if (body.action === "split") {
      const snap = await col.doc(id).get();
      if (!snap.exists) return NextResponse.json({ error: "거래를 찾지 못했습니다." }, { status: 404 });
      const full = { id: snap.id, ...snap.data() } as FinTransaction & Record<string, unknown>;
      const parts = (Array.isArray(body.parts) ? body.parts : []).map((p) => {
        const o = (p ?? {}) as Record<string, unknown>;
        const text = (k: string) => (typeof o[k] === "string" && (o[k] as string).trim() ? (o[k] as string).trim().slice(0, 80) : undefined);
        return {
          gross: Number(o.gross),
          projectCode: text("projectCode"),
          bizMajor: text("bizMajor"),
          bizMinor: text("bizMinor"),
          acctMajor: text("acctMajor"),
          acctMid: text("acctMid"),
          acctMinor: text("acctMinor"),
        } satisfies SplitPart;
      });
      const problem = validateSplit(full, parts);
      if (problem) return NextResponse.json({ error: problem }, { status: 400 });

      const { rootPatch, children } = buildSplit(full, parts, now, user.email);
      const batch = db.batch();
      const rootData: Record<string, unknown> = {};
      Object.entries(rootPatch).forEach(([k, v]) => (rootData[k] = v === null ? FieldValue.delete() : v));
      batch.set(col.doc(id), rootData, { merge: true });
      const created: string[] = [];
      children.forEach((doc) => {
        const ref = col.doc();
        created.push(ref.id);
        batch.set(ref, doc);
      });
      await batch.commit();
      return NextResponse.json({ ok: true, created, transactions: await read([id, ...created]) });
    }

    if (body.action === "merge") {
      const snap = await col.doc(id).get();
      const group = snap.exists ? (snap.get("splitGroup") as string | undefined) : undefined;
      if (!group) return NextResponse.json({ error: "나눈 거래가 아닙니다." }, { status: 400 });
      const partsSnap = await col.where("splitGroup", "==", group).get();
      const plan = buildMerge(partsSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<FinTransaction, "id">) })));
      if (!plan) return NextResponse.json({ error: "합칠 조각을 찾지 못했습니다." }, { status: 400 });

      const trash = db.collection(NEANDER_COL.finTrash);
      const batch = db.batch();
      batch.set(
        col.doc(plan.rootId),
        {
          gross: plan.gross,
          splitGroup: FieldValue.delete(),
          splitNo: FieldValue.delete(),
          splitCount: FieldValue.delete(),
          splitTotal: FieldValue.delete(),
          classReason: "나눴던 거래를 다시 합침",
          updatedAt: now,
          updatedBy: user.email,
        },
        { merge: true },
      );
      // 지우는 조각은 원본을 휴지통에 남긴다 (되돌리기가 거기서 되살린다 — server/trash.ts)
      partsSnap.docs
        .filter((d) => plan.removeIds.includes(d.id))
        .forEach((d) => {
          batch.set(trash.doc(d.id), { doc: d.data(), deletedAt: now, deletedBy: user.email ?? null });
          batch.delete(col.doc(d.id));
        });
      await batch.commit();
      return NextResponse.json({ ok: true, removed: plan.removeIds, transactions: await read([plan.rootId]) });
    }

    return NextResponse.json({ error: "action 은 split · merge 중 하나여야 합니다." }, { status: 400 });
  } catch (e) {
    const denied = accessErrorResponse(e);
    if (denied) return denied;
    console.error("[finance/split]", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "알 수 없는 오류" }, { status: 500 });
  }
}
