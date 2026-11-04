import { adminDb } from "@/lib/neander/server/admin";
import { AccessError } from "@/lib/neander/server/auth";
import { requestDb } from "@/lib/neander/shorts/server/space-db";
import { isShortsAdmin, requireShortsUser } from "@/lib/neander/shorts/server/access";
import { fail, json } from "@/lib/neander/shorts/server/http";
import { getProjectKeywords, saveProjectKeywords } from "@/lib/neander/shorts/server/keywords";
import { MAX_PROJECT_KEYWORDS, NAVER_KEYWORDS } from "@/lib/neander/shorts/keywords";

// 조사 키워드 — 프로젝트 하나의 키워드 목록 (shorts/keywords.ts). 기획 네 화면 위의 키워드 막대와
// 프로젝트 › 고치기가 읽고 쓴다. 저장하면 소재 발굴 검색어 · 시장 트렌드 묶음이 같이 바뀐다.
// 어느 프로젝트인지는 머리글로 받는다 (고치기 창은 지금 고른 것이 아닌 프로젝트를 보낼 수 있다).
// 고치기는 AI STUDIO 관리자만 — 레이더 · 시장 트렌드 설정과 같은 규칙이다.
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const { email } = await requireShortsUser(req);
    const db = await requestDb(req, adminDb(), email);
    return json({ ...(await getProjectKeywords(db)), admin: isShortsAdmin(email), max: MAX_PROJECT_KEYWORDS, naverMax: NAVER_KEYWORDS });
  } catch (e) {
    return fail(e);
  }
}

export async function POST(req: Request) {
  try {
    const { email } = await requireShortsUser(req);
    if (!isShortsAdmin(email)) throw new AccessError(403, "조사 키워드는 AI STUDIO 관리자만 바꿉니다.");
    const db = await requestDb(req, adminDb(), email);
    const b = (await req.json()) as { keywords?: unknown };
    return json(await saveProjectKeywords(db, email, b.keywords));
  } catch (e) {
    return fail(e);
  }
}
