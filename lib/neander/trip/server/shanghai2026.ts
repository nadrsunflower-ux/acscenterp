import "server-only";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { SHANGHAI_2026_PLAN } from "@/lib/neander/trip/shanghai2026Plan";
import { applyOp, revertChange, TripOpError, type Change, type TripOp, type TripPlan } from "@/lib/neander/trip/shanghai2026Ops";

// ============================================================
//  상하이 출장 일정 저장소 — neander_trip/2026shanghai
// ------------------------------------------------------------
//  문서 하나에 일정 전체(plan)와 판 번호(v)를 둔다. 아직 아무도 안 고쳤으면
//  문서가 없고, 그때는 코드에 든 기본 일정(SHANGHAI_2026_PLAN)을 돌려준다.
//  바꿀 때마다 history 아래에 「누가 · 무엇을 · 전후」를 남겨서 되돌릴 수 있게 한다.
//  누구나 고칠 수 있으니 되돌리기가 유일한 안전장치다 — history 는 지우지 않는다.
// ============================================================

const DOC = "neander_trip/2026shanghai";

export interface PlanState { v: number; plan: TripPlan; updatedAt?: number; by?: string; hid?: string }

export async function loadPlan(db: Firestore): Promise<PlanState> {
  const s = await db.doc(DOC).get();
  if (!s.exists) return { v: 0, plan: SHANGHAI_2026_PLAN };
  const d = s.data() as { v: number; plan: TripPlan; updatedAt?: number; by?: string };
  return { v: d.v, plan: d.plan, updatedAt: d.updatedAt, by: d.by };
}

const newId = () => "u" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

export async function changePlan(db: Firestore, req: { op: TripOp | { op: "revert"; historyId: string }; by: string }): Promise<PlanState> {
  const ref = db.doc(DOC);
  const by = req.by || "익명";
  return db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    const cur: PlanState = s.exists ? (s.data() as PlanState) : { v: 0, plan: SHANGHAI_2026_PLAN };
    let result: { plan: TripPlan; change: Change };
    let revertOf: string | undefined;
    if (req.op.op === "revert") {
      const hid = String((req.op as { historyId: string }).historyId ?? "");
      if (!/^[A-Za-z0-9]{6,40}$/.test(hid)) throw new TripOpError("되돌릴 기록을 찾지 못했어요.");
      const h = await tx.get(ref.collection("history").doc(hid));
      if (!h.exists) throw new TripOpError("되돌릴 기록을 찾지 못했어요.");
      result = revertChange(cur.plan, h.data()!.change as Change);
      revertOf = hid;
    } else {
      result = applyOp(cur.plan, req.op as TripOp, newId);
    }
    const size = Buffer.byteLength(JSON.stringify(result.plan));
    if (size > 400_000) throw new TripOpError("일정이 너무 커졌어요.");
    const now = Date.now();
    const next: PlanState = { v: cur.v + 1, plan: result.plan, updatedAt: now, by };
    tx.set(ref, next);
    const href = ref.collection("history").doc();
    tx.set(href, {
      at: now, by, v: next.v, change: result.change, ...(revertOf ? { revertOf } : {}), createdAt: FieldValue.serverTimestamp(),
    });
    return { ...next, hid: href.id };
  });
}

export interface HistoryRow { id: string; at: number; by: string; op: string; title: string; day: string; revertOf?: string }

export async function listHistory(db: Firestore, limit = 40): Promise<HistoryRow[]> {
  const q = await db.doc(DOC).collection("history").orderBy("at", "desc").limit(limit).get();
  return q.docs.map((d) => {
    const x = d.data() as { at: number; by: string; change: Change; revertOf?: string };
    return { id: d.id, at: x.at, by: x.by, op: x.change.op, title: x.change.title, day: x.change.day, ...(x.revertOf ? { revertOf: x.revertOf } : {}) };
  });
}
