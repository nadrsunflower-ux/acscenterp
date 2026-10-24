import { NextResponse } from "next/server";
import { adminDb } from "@/lib/neander/server/admin";
import { requireErpUser, accessErrorResponse } from "@/lib/neander/server/auth";
import { NEANDER_COL } from "@/lib/neander/collections";
import { sanitizePayback, type FinPaybackDoc } from "@/lib/neander/finance/payback";

// 돌려줄 돈 — 프로젝트에 묶이지 않은 것 (lib/neander/finance/payback.ts).
//
// 프로젝트 「매출 차감」 은 프로젝트 문서가 정본이라 여기 오지 않는다 — 화면이
// 프로젝트 저장(mutate project.save)으로 고친다. 새 컬렉션은 보안 규칙에 없어
// 서버(Admin SDK)로만 읽고 쓴다. 권한은 재무와 같다.
export const dynamic = "force-dynamic";

/** Firestore 는 undefined 를 거부한다 */
function clean<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  Object.keys(obj).forEach((k) => {
    if (obj[k] !== undefined) out[k] = obj[k];
  });
  return out;
}

function fail(e: unknown) {
  const denied = accessErrorResponse(e);
  if (denied) return denied;
  console.error("[finance/paybacks]", e);
  return NextResponse.json({ error: e instanceof Error ? e.message : "알 수 없는 오류" }, { status: 500 });
}

export async function GET(req: Request) {
  try {
    await requireErpUser(req);
    const snap = await adminDb().collection(NEANDER_COL.finPaybacks).get();
    const paybacks = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as FinPaybackDoc);
    return NextResponse.json({ paybacks });
  } catch (e) {
    return fail(e);
  }
}

/** { id?, payback } — 문서를 통째로 갈아치운다. id 가 없으면 새로 만든다 */
export async function POST(req: Request) {
  try {
    const user = await requireErpUser(req);
    const body = (await req.json()) as { id?: string; payback?: Record<string, unknown> };
    const parsed = sanitizePayback(body.payback ?? {});
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const db = adminDb();
    const col = db.collection(NEANDER_COL.finPaybacks);
    const now = Date.now();

    // 코드는 원장 프로젝트코드 칸을 프로젝트 · 지원사업과 같이 쓴다 — 겹치면 막는다.
    // 화면은 이 문구를 보고 다음 번호로 다시 보낸다 (finance/codes.ts 의 isCodeClash)
    const code = parsed.value.projectCode?.trim().toLowerCase();
    if (code) {
      const [paybacks, projects, grants] = await Promise.all([
        col.get(),
        db.collection(NEANDER_COL.finProjects).get(),
        db.collection(NEANDER_COL.finGrants).get(),
      ]);
      const same = (d: FirebaseFirestore.QueryDocumentSnapshot, key: string) => String(d.data()[key] ?? "").trim().toLowerCase() === code;
      const clash =
        paybacks.docs.find((d) => d.id !== body.id && same(d, "projectCode")) ??
        projects.docs.find((d) => same(d, "code")) ??
        grants.docs.find((d) => same(d, "code"));
      if (clash) {
        const who = String(clash.data().name ?? clash.data().vendor ?? "다른 건");
        return NextResponse.json({ error: `코드 ${parsed.value.projectCode} 는 이미 「${who}」 이 쓰고 있습니다.` }, { status: 409 });
      }
    }

    if (body.id) {
      const prev = await col.doc(body.id).get();
      if (!prev.exists) return NextResponse.json({ error: "돌려줄 돈 기록이 없습니다." }, { status: 404 });
      await col.doc(body.id).set(
        clean({ ...parsed.value, createdAt: prev.data()?.createdAt ?? now, updatedAt: now, updatedBy: user.email }),
        { merge: false },
      );
      return NextResponse.json({ ok: true, id: body.id });
    }
    const ref = await col.add(clean({ ...parsed.value, createdAt: now, updatedAt: now, updatedBy: user.email }));
    return NextResponse.json({ ok: true, id: ref.id });
  } catch (e) {
    return fail(e);
  }
}

/** ?id= */
export async function DELETE(req: Request) {
  try {
    await requireErpUser(req);
    const id = new URL(req.url).searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id 가 필요합니다." }, { status: 400 });
    await adminDb().collection(NEANDER_COL.finPaybacks).doc(id).delete();
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
