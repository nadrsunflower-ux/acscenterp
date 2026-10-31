import { adminDb } from "@/lib/neander/server/admin";
import { coupangProductId, countInfoRequests, emptyDomestic, emptyMetrics, INFO_REQUEST_KEYWORDS, isCoupangAffiliateUrl, measured, newId } from "@/lib/neander/shorts/model";
import { requireShortsUser } from "@/lib/neander/shorts/server/access";
import { coupangDeeplink, coupangSearch } from "@/lib/neander/shorts/server/coupang";
import { getAccountForPublish } from "@/lib/neander/shorts/server/accounts";
import { coupangForSearch, coupangOf, getProfile, noteCoupangResult, youtubeKeyFor } from "@/lib/neander/shorts/server/profiles";
import { fail, json } from "@/lib/neander/shorts/server/http";
import { syncCoupangReports, syncPublicationMetrics } from "@/lib/neander/shorts/server/metrics";
import { getProject, getTrend, patchProject, patchTrendDomestic, takeQuota, writeTrendFromApi } from "@/lib/neander/shorts/server/store";
import { YT_SEARCH_DAILY_LIMIT, youtubeCommentSample, youtubeSearch, youtubeVideos } from "@/lib/neander/shorts/server/youtube-data";
import type { TrendDoc } from "@/lib/neander/shorts/types";

// 조사 — 공식 API 를 서버가 부르고, 「공식 API」 출처는 여기서만 적힌다
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const kstDay = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
const kstMinute = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 16);

/** 검색 키 (개인 → 회사) 와 그 키의 하루 사용량 — 한도는 키(=Google Cloud 프로젝트)마다 따로다 */
async function ytKey(db: ReturnType<typeof adminDb>, email: string, countSearch: boolean): Promise<string> {
  const yk = await youtubeKeyFor(db, email);
  if (!yk.key) throw new Error("YouTube 검색 키가 없습니다 — 계정·연결에서 개인 키를 넣거나 회사 키를 설정해 주세요.");
  if (countSearch) {
    const q = await takeQuota(db, yk.source === "personal" ? `ytsearch_${email}_${kstDay()}` : `ytsearch_${kstDay()}`, YT_SEARCH_DAILY_LIMIT);
    if (!q.ok) throw new Error(`오늘 이 키로 YouTube 검색을 ${YT_SEARCH_DAILY_LIMIT}번 썼습니다 (search 한도 하루 100회). 내일 다시 해 주세요.`);
  }
  return yk.key;
}

export async function POST(req: Request) {
  try {
    const { email } = await requireShortsUser(req);
    const db = adminDb();
    const b = (await req.json()) as Record<string, unknown>;
    switch (b.action) {
      case "yt.search": {
        const key = await ytKey(db, email, true);
        const items = await youtubeSearch({
          query: String(b.query ?? ""),
          regionCode: String(b.regionCode ?? "KR"),
          language: String(b.language ?? "ko"),
          days: Number(b.days) || 30,
          max: Number(b.max) || 20,
        }, key);
        // 저장하지 않는다 — 사람이 고른 것만 소재로 저장 (yt.saveTrend 가 다시 받아 적는다)
        return json({ items, at: Date.now() });
      }

      case "yt.saveTrend": {
        const ids = (Array.isArray(b.videoIds) ? b.videoIds : []).map(String).slice(0, 20);
        const items = await youtubeVideos(ids, await ytKey(db, email, false));
        const ctx = b.searchContext as { query?: string; regionCode?: string; language?: string } | undefined;
        const out: string[] = [];
        for (const it of items) {
          const now = Date.now();
          const data: Omit<TrendDoc, "owner" | "createdAt" | "updatedAt" | "updatedBy" | "visibility" | "viewHistory"> & { visibility?: TrendDoc["visibility"] } = {
            platform: "youtube",
            url: it.url,
            externalId: it.id,
            channel: it.channel,
            title: it.title,
            publishedAt: it.publishedAt || null,
            collectedAt: now,
            collectedBy: "youtube_api",
            searchContext: ctx?.query ? { query: String(ctx.query).slice(0, 200), regionCode: String(ctx.regionCode ?? ""), language: String(ctx.language ?? "") } : null,
            product: String(b.product ?? "").slice(0, 200),
            category: String(b.category ?? "").slice(0, 60),
            country: ctx?.regionCode ? String(ctx.regionCode).slice(0, 2) : "",
            language: ctx?.language ? String(ctx.language).slice(0, 5) : "",
            identification: { status: "unconfirmed", evidence: "" },
            metrics: {
              ...emptyMetrics(),
              views: measured(it.views, "api", "YouTube Data API videos.list", now),
              likes: measured(it.likes, "api", it.likes === null ? "좋아요 비공개" : "YouTube Data API videos.list", now),
              comments: measured(it.comments, "api", it.comments === null ? "댓글 꺼짐" : "YouTube Data API videos.list", now),
            },
            infoSample: { sampled: null, matched: null, keywords: [], src: "manual" },
            domestic: emptyDomestic(),
            tags: [],
            notes: "",
            projectId: null,
            sample: false,
            visibility: b.visibility === "team" ? "team" : "private",
          };
          out.push(await writeTrendFromApi(db, email, null, data));
        }
        return json({ ids: out });
      }

      case "yt.refreshTrend": {
        const t = await getTrend(db, email, b.trendId);
        if (t.platform !== "youtube" || !t.externalId) throw new Error("YouTube 에서 모은 소재만 다시 모을 수 있습니다.");
        const [it] = await youtubeVideos([t.externalId], await ytKey(db, email, false));
        if (!it) throw new Error("영상을 찾지 못했습니다 (지워졌거나 비공개).");
        const now = Date.now();
        await writeTrendFromApi(db, email, t.id, {
          ...t,
          collectedAt: now,
          metrics: {
            ...t.metrics,
            views: measured(it.views, "api", "YouTube Data API videos.list", now),
            likes: measured(it.likes, "api", "YouTube Data API videos.list", now),
            comments: measured(it.comments, "api", "YouTube Data API videos.list", now),
          },
        });
        return json({ ok: true });
      }

      case "yt.commentSample": {
        // 댓글 100개(관련도 순)에서 정보 요청 낱말 — 표본임을 기록에 남긴다
        const t = await getTrend(db, email, b.trendId);
        if (t.platform !== "youtube" || !t.externalId) throw new Error("YouTube 소재만 댓글 표본을 읽을 수 있습니다.");
        const comments = await youtubeCommentSample(t.externalId, 100, await ytKey(db, email, false));
        const keywords = Array.isArray(b.keywords) && b.keywords.length ? (b.keywords as unknown[]).map(String).slice(0, 40) : INFO_REQUEST_KEYWORDS;
        const r = countInfoRequests(comments, keywords);
        await writeTrendFromApi(db, email, t.id, { ...t, infoSample: { sampled: r.sampled, matched: r.matched, keywords, src: "api", at: Date.now() } });
        return json({ sampled: r.sampled, matched: r.matched });
      }

      case "domestic.search": {
        const t = await getTrend(db, email, b.trendId);
        const query = String(b.query ?? t.product ?? "").trim();
        if (!query) throw new Error("국내 검색어를 넣어 주세요.");
        const key = await ytKey(db, email, true);
        const items = await youtubeSearch({ query, regionCode: "KR", language: "ko", days: Number(b.days) || 90, max: 25 }, key);
        await patchTrendDomestic(db, email, t.id, {
          ...t.domestic,
          query,
          lastSearch: { query, at: Date.now(), results: items.map((i) => ({ id: i.id, url: i.url, title: i.title, views: i.views })) },
        });
        return json({ items });
      }

      case "domestic.mark": {
        // 사람이 표본에서 「유사함」 을 고른다 — 고른 게 없으면 「이 표본에서 못 찾음」 (미확산 단정 아님)
        const t = await getTrend(db, email, b.trendId);
        const last = t.domestic.lastSearch;
        if (!last) throw new Error("먼저 국내 검색을 해 주세요.");
        const pick = new Set((Array.isArray(b.videoIds) ? b.videoIds : []).map(String));
        const matches = last.results.filter((r) => pick.has(r.id)).map((r) => ({ url: r.url, title: r.title, views: r.views, src: "api" as const }));
        await patchTrendDomestic(db, email, t.id, {
          ...t.domestic,
          status: matches.length ? "found" : "none_in_sample",
          method: "api",
          query: last.query,
          checkedAt: Date.now(),
          sampleSize: last.results.length,
          matches,
          note: String(b.note ?? t.domestic.note ?? "").slice(0, 1000),
        });
        return json({ ok: true });
      }

      case "coupang.search": {
        // 내 키(없으면 회사 키). 키 주인마다 분당 30회에서 먼저 멈춘다 (쿠팡 한도 분당 50회 · 넘으면 24시간 차단)
        const ck = await coupangForSearch(db, email);
        const q = await takeQuota(db, `coupang_${ck.owner}_${kstMinute()}`, 30);
        if (!q.ok) throw new Error("이 쿠팡 키로 1분에 30번 검색했습니다. 잠시 뒤 다시 해 주세요 (한도를 넘으면 하루 동안 막힙니다).");
        try {
          const r = await coupangSearch(ck.creds, String(b.keyword ?? ""));
          await noteCoupangResult(db, ck.owner, null);
          // 저장하지 않는다 — Open API 약관: 받은 데이터를 복제·저장하지 않는다
          return json({ ...r, keySource: ck.source });
        } catch (e) {
          await noteCoupangResult(db, ck.owner, e);
          throw e;
        }
      }

      case "coupang.addCandidate": {
        const url = String(b.productUrl ?? "");
        const productId = coupangProductId(url) ?? (String(b.productId ?? "").match(/^\d+$/) ? String(b.productId) : null);
        if (!productId) throw new Error("쿠팡 상품 주소를 확인하지 못했습니다.");
        const id = newId("cp_");
        const target = await getProject(db, email, b.projectId);
        const saved = await patchProject(db, target.id, email, (p) => {
          if (p.coupang.candidates.some((c) => c.productId === productId)) throw new Error("이미 후보에 있는 상품입니다.");
          p.coupang.candidates.push({
            id,
            url: `https://www.coupang.com/vp/products/${productId}`,
            productId,
            name: String(b.productName ?? "").slice(0, 300),
            brand: "",
            model: "",
            size: "",
            material: "",
            spec: "",
            options: "",
            // 가격 · 판매 상태는 사람이 쿠팡에서 확인해 적는다 (API 값은 저장하지 않는다)
            price: null,
            saleStatus: "unknown",
            checkedAt: Date.now(),
            source: "api",
            comparison: "",
            match: "candidate",
            checks: { brand: null, model: null, size: null, material: null, options: null, appearance: null },
            confirmedBy: null,
            confirmedAt: null,
          });
        });
        return json({ project: saved, candidateId: id });
      }

      case "coupang.deeplink": {
        // 게시할 계정 주인의 쿠팡 키로 만든다 — 수수료 · 등록 채널이 그 사람의 것이어야 한다.
        // 계정을 안 고르면 내 키로 (내 계정에 올릴 링크).
        const p = await getProject(db, email, b.projectId);
        const c = p.coupang.candidates.find((x) => x.id === b.candidateId);
        if (!c) throw new Error("후보를 찾지 못했습니다.");
        if (c.match !== "identical") throw new Error("동일 상품으로 확인한 후보에만 제휴 링크를 만듭니다.");
        const account = typeof b.accountId === "string" && b.accountId ? await getAccountForPublish(db, email, b.accountId) : null;
        const owner = account?.owner ?? email;
        const ck = await coupangOf(db, owner);
        let subId = account?.coupangSubId ?? "";
        if (!subId && typeof b.subId === "string" && b.subId && owner === email) {
          // 내 키로 만들 때만 내 채널 아이디 목록에서 고를 수 있다
          if (!(await getProfile(db, email)).subIds.some((x) => x.id === b.subId)) throw new Error("내 쿠팡 채널 아이디 목록에 없는 아이디입니다.");
          subId = String(b.subId);
        }
        let r;
        try {
          r = await coupangDeeplink(ck.creds, c.url, subId || undefined);
          await noteCoupangResult(db, owner, null);
        } catch (e) {
          await noteCoupangResult(db, owner, e);
          throw e;
        }
        if (!isCoupangAffiliateUrl(r.shortenUrl)) throw new Error("받은 링크가 쿠팡 파트너스 주소가 아닙니다.");
        const saved = await patchProject(db, p.id, email, (pp) => {
          pp.coupang.affiliate = { url: r.shortenUrl, candidateId: c.id, subId, method: "api", issuedAt: Date.now(), by: email, coupangOwner: owner, accountId: account?.id ?? null };
        });
        return json({ project: saved });
      }

      case "metrics.sync":
        return json(await syncPublicationMetrics(db, email, String(b.publicationId)));

      case "coupang.reports": {
        const q = await takeQuota(db, `coupang_reports_${kstDay()}_${email}`, 20);
        if (!q.ok) throw new Error("오늘 쿠팡 리포트를 20번 가져왔습니다. 리포트는 하루 한 번(15시) 갱신됩니다.");
        return json(await syncCoupangReports(db, email));
      }
      default:
        throw new Error("알 수 없는 동작입니다.");
    }
  } catch (e) {
    return fail(e);
  }
}
