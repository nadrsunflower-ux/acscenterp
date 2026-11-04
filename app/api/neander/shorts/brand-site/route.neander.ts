import { adminDb } from "@/lib/neander/server/admin";
import { requestDb } from "@/lib/neander/shorts/server/space-db";
import { requireShortsUser } from "@/lib/neander/shorts/server/access";
import { brandSiteQuota, previewBrandSite } from "@/lib/neander/shorts/server/brand-site";
import { fail, json } from "@/lib/neander/shorts/server/http";

// 업체 홈페이지 · 상세페이지 → 브리프 제안 (server/brand-site.ts)
//   GET  오늘 쓴 횟수 · 하루 상한 (회사 전체)
//   POST site.preview {clientId, url} — 그 업체 담당자만 · 저장하지 않고 제안만 (AI 한 번)
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(req: Request) {
  try {
    const { email } = await requireShortsUser(req);
    const db = await requestDb(req, adminDb(), email);
    return json({ quota: await brandSiteQuota(db) });
  } catch (e) {
    return fail(e);
  }
}

export async function POST(req: Request) {
  try {
    const { email } = await requireShortsUser(req);
    const db = await requestDb(req, adminDb(), email);
    const b = (await req.json()) as Record<string, unknown>;
    switch (b.action) {
      case "site.preview":
        return json({ preview: await previewBrandSite(db, email, { clientId: b.clientId, url: b.url }) });
      default:
        throw new Error("알 수 없는 동작입니다.");
    }
  } catch (e) {
    return fail(e);
  }
}
