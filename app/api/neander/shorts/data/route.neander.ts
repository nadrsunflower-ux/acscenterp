import { adminDb } from "@/lib/neander/server/admin";
import { hasFinanceAccess } from "@/lib/neander/server/auth";
import { isShortsAdmin, requireShortsUser, shortsAccessView } from "@/lib/neander/shorts/server/access";
import { clientFinance, type ClientFinanceSummary } from "@/lib/neander/shorts/server/client-finance";
import { spaceOf } from "@/lib/neander/shorts/spaces";
import { listProfiles, youtubeKeyFor } from "@/lib/neander/shorts/server/profiles";
import { listClients } from "@/lib/neander/shorts/server/clients";
import { listAccounts } from "@/lib/neander/shorts/server/accounts";
import { TTS_MODELS, VIDEO_MODELS } from "@/lib/neander/shorts/server/ai";
import { fail, json } from "@/lib/neander/shorts/server/http";
import { listJobs } from "@/lib/neander/shorts/server/jobs";
import { listFolders } from "@/lib/neander/shorts/server/folders";
import { listPublications } from "@/lib/neander/shorts/server/publishing";
import { listSpacesFor } from "@/lib/neander/shorts/server/space-db";
import { listEvents } from "@/lib/neander/shorts/server/events";
import { integrationStatus } from "@/lib/neander/shorts/server/status";
import { getWeights, listMetrics, listProjects, listTemplates, listTrends, readQuota } from "@/lib/neander/shorts/server/store";
import { YT_SEARCH_DAILY_LIMIT } from "@/lib/neander/shorts/server/youtube-data";

// 쇼핑쇼츠 워크스페이스 한 벌 — 내가 볼 수 있는 것만 (비공개는 소유자에게만).
// ?scope=all 은 쇼츠 관리자만: 모든 사람의 것을 읽기 전용으로 (사용자별 현황 · 몰아보기)
// 대행 프로젝트(업체별)는 관리자 · 그 업체 담당자에게만 — 볼 수 없는 프로젝트의 자료는 빼고 보낸다.
// 업체의 재무 계약 요약은 재무 권한이 있는 사람에게만, AI STUDIO 사용자 · 관리자 목록은 관리자에게만.
export const dynamic = "force-dynamic";

const kstDay = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);

export async function GET(req: Request) {
  try {
    const { email } = await requireShortsUser(req);
    const db = adminDb();
    const admin = isShortsAdmin(email);
    const all = admin && new URL(req.url).searchParams.get("scope") === "all";
    const [trends, projects, templates, accounts, jobs, weights, status, ytUsed, profiles, clients, folders] = await Promise.all([
      listTrends(db, email, all),
      listProjects(db, email, all),
      listTemplates(db, email, all),
      listAccounts(db, email, all),
      listJobs(db, email),
      getWeights(db, email),
      integrationStatus(db),
      readQuota(db, `ytsearch_${kstDay()}`),
      listProfiles(db, email, all),
      // 관리자는 「보기」 와 상관없이 모든 업체를 읽는다 (대행 프로젝트를 보려고 — 고치기는 담당자만)
      listClients(db, email, admin),
      listFolders(db),
    ]);
    // 내 검색 키 (개인 → 회사) 와 그 키의 오늘 사용량
    const yk = await youtubeKeyFor(db, email);
    const myYtUsed = yk.source === "personal" ? await readQuota(db, `ytsearch_${email}_${kstDay()}`) : ytUsed;
    // 볼 수 있는 프로젝트의 자료만 (대행 프로젝트 권한)
    const spaces = await listSpacesFor(db, email, admin, true);
    const visible = new Set(spaces.map((x) => x.id));
    const here = (x: { spaceId?: string | null }) => visible.has(spaceOf(x));
    const shownProjects = projects.filter(here);
    const ids = shownProjects.map((p) => p.id);
    const [publications, metrics, events] = await Promise.all([listPublications(db, email, ids), listMetrics(db, email, ids), listEvents(db, email, admin).catch(() => [])]);
    // 업체 ↔ 재무 계약 요약 (재무 권한이 있을 때만)
    const financeAccess = hasFinanceAccess(email);
    const codes = financeAccess ? [...new Set(clients.flatMap((c) => c.contract.financeCodes ?? (c.contract.financeCode ? [c.contract.financeCode] : [])))] : [];
    const summaries = codes.length ? await clientFinance(db, codes).catch(() => [] as ClientFinanceSummary[]) : [];
    const byCode = new Map(summaries.map((x) => [x.code.toUpperCase(), x]));
    const clientFinanceMap = Object.fromEntries(
      clients.map((c) => [c.id, (c.contract.financeCodes ?? (c.contract.financeCode ? [c.contract.financeCode] : [])).map((k) => byCode.get(k.toUpperCase())).filter(Boolean)]),
    );
    return json({
      me: email,
      admin,
      // AI STUDIO 프로젝트 — 자료는 볼 수 있는 모든 프로젝트 것을 보내고 화면이 고른 프로젝트로 거른다 (대시보드는 전체)
      spaces,
      scope: all ? "all" : "mine",
      profiles,
      clients,
      financeAccess,
      clientFinance: financeAccess ? clientFinanceMap : {},
      access: admin ? await shortsAccessView() : null,
      // 손으로 적은 일정 (볼 수 있는 프로젝트의 것만)
      events,
      folders: folders.filter(here),
      trends: trends.filter(here),
      projects: shownProjects,
      templates: templates.filter(here),
      accounts: accounts.filter(here),
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
