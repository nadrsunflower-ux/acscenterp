import { adminDb } from "@/lib/neander/server/admin";
import { isShortsAdmin, requireShortsUser } from "@/lib/neander/shorts/server/access";
import { listProfiles, youtubeKeyFor } from "@/lib/neander/shorts/server/profiles";
import { listClients } from "@/lib/neander/shorts/server/clients";
import { listAccounts } from "@/lib/neander/shorts/server/accounts";
import { TTS_MODELS, VIDEO_MODELS } from "@/lib/neander/shorts/server/ai";
import { fail, json } from "@/lib/neander/shorts/server/http";
import { listJobs } from "@/lib/neander/shorts/server/jobs";
import { listPublications } from "@/lib/neander/shorts/server/publishing";
import { integrationStatus } from "@/lib/neander/shorts/server/status";
import { getWeights, listMetrics, listProjects, listTemplates, listTrends, readQuota } from "@/lib/neander/shorts/server/store";
import { YT_SEARCH_DAILY_LIMIT } from "@/lib/neander/shorts/server/youtube-data";

// 쇼핑쇼츠 워크스페이스 한 벌 — 내가 볼 수 있는 것만 (비공개는 소유자에게만).
// ?scope=all 은 쇼츠 관리자만: 모든 사람의 것을 읽기 전용으로 (사용자별 현황 · 몰아보기)
export const dynamic = "force-dynamic";

const kstDay = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);

export async function GET(req: Request) {
  try {
    const { email } = await requireShortsUser(req);
    const db = adminDb();
    const admin = isShortsAdmin(email);
    const all = admin && new URL(req.url).searchParams.get("scope") === "all";
    const [trends, projects, templates, accounts, jobs, weights, status, ytUsed, profiles, clients] = await Promise.all([
      listTrends(db, email, all),
      listProjects(db, email, all),
      listTemplates(db, email, all),
      listAccounts(db, email, all),
      listJobs(db, email),
      getWeights(db, email),
      integrationStatus(db),
      readQuota(db, `ytsearch_${kstDay()}`),
      listProfiles(db, email, all),
      listClients(db, email, all),
    ]);
    // 내 검색 키 (개인 → 회사) 와 그 키의 오늘 사용량
    const yk = await youtubeKeyFor(db, email);
    const myYtUsed = yk.source === "personal" ? await readQuota(db, `ytsearch_${email}_${kstDay()}`) : ytUsed;
    const ids = projects.map((p) => p.id);
    const [publications, metrics] = await Promise.all([listPublications(db, email, ids), listMetrics(db, email, ids)]);
    return json({
      me: email,
      admin,
      scope: all ? "all" : "mine",
      profiles,
      clients,
      trends,
      projects,
      templates,
      accounts,
      jobs,
      publications,
      metrics,
      weights,
      status,
      quotas: { youtubeSearch: { used: myYtUsed, limit: YT_SEARCH_DAILY_LIMIT, source: yk.source } },
      models: { tts: TTS_MODELS, video: VIDEO_MODELS },
    });
  } catch (e) {
    return fail(e);
  }
}
