import { NextResponse } from "next/server";
import { adminDb } from "@/lib/neander/server/admin";
import { requireErpUser, accessErrorResponse } from "@/lib/neander/server/auth";
import { NEANDER_COL } from "@/lib/neander/collections";
import { sanitizeGrant, type FinGrantDoc } from "@/lib/neander/finance/grant";

// 지원사업 — 목록 · 저장 · 삭제 (lib/neander/finance/grant.ts).
//
// 보안 규칙에 없는 새 컬렉션이라 서버(Admin SDK)만 붙는다. 권한은 재무와 같다.
// 저장은 문서를 통째로 갈아치운다(프로젝트와 같은 방식) — 회차 · 비목 배열을
// merge 하면 지운 줄이 되살아난다.
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
  console.error("[finance/grants]", e);
  return NextResponse.json({ error: e instanceof Error ? e.message : "알 수 없는 오류" }, { status: 500 });
}

export async function GET(req: Request) {
  try {
    await requireErpUser(req);
    const snap = await adminDb().collection(NEANDER_COL.finGrants).get();
    const grants = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as FinGrantDoc);
    return NextResponse.json({ grants });
  } catch (e) {
    return fail(e);
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireErpUser(req);
    const { id, grant } = (await req.json()) as { id?: string; grant?: Record<string, unknown> };
    const parsed = sanitizeGrant(grant ?? {});
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const db = adminDb();
    const col = db.collection(NEANDER_COL.finGrants);
    const now = Date.now();

    // 코드는 원장 프로젝트코드 칸을 프로젝트와 같이 쓴다 — 둘 사이에서도 겹치면 안 된다.
    // 대소문자만 다른 코드도 같은 것으로 본다 (원장 매칭이 그렇게 한다).
    const wanted = parsed.value.code.toLowerCase();
    const [grants, projects] = await Promise.all([col.get(), db.collection(NEANDER_COL.finProjects).get()]);
    const clash =
      grants.docs.find((d) => d.id !== id && String(d.data().code ?? "").trim().toLowerCase() === wanted) ??
      projects.docs.find((d) => String(d.data().code ?? "").trim().toLowerCase() === wanted);
    if (clash) {
      return NextResponse.json(
        { error: `코드 ${parsed.value.code} 는 이미 「${clash.data().name}」 이 쓰고 있습니다.` },
        { status: 409 },
      );
    }

    if (id) {
      const prev = await col.doc(id).get();
      if (!prev.exists) return NextResponse.json({ error: "지원사업이 없습니다." }, { status: 404 });
      const keep = prev.data() ?? {};
      await col.doc(id).set(
        clean({ ...parsed.value, createdAt: keep.createdAt ?? now, createdBy: keep.createdBy, updatedAt: now, updatedBy: user.email }),
        { merge: false },
      );
      return NextResponse.json({ ok: true, id });
    }
    const ref = await col.add(clean({ ...parsed.value, createdAt: now, createdBy: user.email, updatedAt: now, updatedBy: user.email }));
    return NextResponse.json({ ok: true, id: ref.id });
  } catch (e) {
    return fail(e);
  }
}

export async function DELETE(req: Request) {
  try {
    await requireErpUser(req);
    const id = new URL(req.url).searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id 가 없습니다." }, { status: 400 });
    await adminDb().collection(NEANDER_COL.finGrants).doc(id).delete();
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
