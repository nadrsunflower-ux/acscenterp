import { NextResponse } from "next/server";
import { adminDb } from "@/lib/neander/server/admin";
import { requireErpUser, accessErrorResponse } from "@/lib/neander/server/auth";
import { NEANDER_COL } from "@/lib/neander/collections";
import {
  OPEN_PROJECT_STATUSES,
  projectDigest,
  sortProjects,
  type FinProjectDoc,
} from "@/lib/neander/finance/project";

// 끝나지 않은 프로젝트 요약 — ERP 대시보드의 「진행 중 프로젝트」 카드가 쓴다.
//
// /data 는 원장 전체를 싣는다. 카드 하나에 그걸 끌어올 이유가 없어서,
// 준비 중·진행 중 문서만 읽고 서버에서 숫자 몇 개로 줄인다.
// 권한은 재무와 같다 — 허용 목록 밖이면 403 이고, 대시보드는 카드를 숨긴다.
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    await requireErpUser(req);
    const snap = await adminDb()
      .collection(NEANDER_COL.finProjects)
      .where("status", "in", OPEN_PROJECT_STATUSES)
      .get();
    const projects = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as FinProjectDoc);
    return NextResponse.json({ projects: sortProjects(projects).map(projectDigest) });
  } catch (e) {
    const denied = accessErrorResponse(e);
    if (denied) return denied;
    console.error("[finance/projects]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "알 수 없는 오류" },
      { status: 500 },
    );
  }
}
