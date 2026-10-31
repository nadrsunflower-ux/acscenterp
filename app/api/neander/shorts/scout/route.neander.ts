import { adminDb } from "@/lib/neander/server/admin";
import { isShortsAdmin, requireShortsUser } from "@/lib/neander/shorts/server/access";
import { fail, json } from "@/lib/neander/shorts/server/http";
import { youtubeKeyFor } from "@/lib/neander/shorts/server/profiles";
import { SCOUT_VIDEO_MODELS } from "@/lib/neander/shorts/server/scout-ai";
import { analyzeHit, buildWeeklyReport, narrateWeeklyReport, scanDue } from "@/lib/neander/shorts/server/scout-run";
import {
  addManualHit,
  addWatch,
  assignHit,
  deleteFormat,
  deleteHit,
  deleteWatch,
  formatFromAnalysis,
  getFormat,
  getHit,
  getScoutSettings,
  listFormats,
  listHits,
  listReports,
  listWatch,
  patchFormatKorea,
  saveFormat,
  saveScoutSettings,
  setKoreanComments,
  updateHit,
  updateWatch,
  upsertHitFromApi,
  watchIdOf,
} from "@/lib/neander/shorts/server/scout-store";
import { readQuota, takeQuota } from "@/lib/neander/shorts/server/store";
import {
  YT_SEARCH_DAILY_LIMIT,
  youtubeChannelOf,
  youtubeCommentSample,
  youtubeDiscoverChannels,
  youtubeRecentUploads,
  youtubeSearch,
  youtubeVideos,
} from "@/lib/neander/shorts/server/youtube-data";
import { computeBaseline, isShortLike, koreanCommentCount, languageOf, parseYoutubeRef, type KoreaStatus } from "@/lib/neander/shorts/scout";

// 바이럴 형식 정찰 — 감시 채널 · 터진 영상 · 형식 카드 · 주간 보고 (회사 공용)
// 공식 API 숫자(src "api")는 여기서 서버가 받아 적을 때만 생긴다.
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const kstDay = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
type Db = ReturnType<typeof adminDb>;

/** 검색 키 (개인 → 회사). search.list 를 쓰는 동작만 하루 횟수를 센다 */
async function ytKey(db: Db, email: string, countSearch: boolean): Promise<string> {
  const yk = await youtubeKeyFor(db, email);
  if (!yk.key) throw new Error("YouTube 검색 키가 없습니다 — 「내 채널 · 연결」 에서 개인 키를 넣거나 회사 키(NEANDER_SHORTS_YOUTUBE_API_KEY)를 설정해 주세요.");
  if (countSearch) {
    const q = await takeQuota(db, yk.source === "personal" ? `ytsearch_${email}_${kstDay()}` : `ytsearch_${kstDay()}`, YT_SEARCH_DAILY_LIMIT);
    if (!q.ok) throw new Error(`오늘 이 키로 YouTube 검색을 ${YT_SEARCH_DAILY_LIMIT}번 썼습니다 (search 한도 하루 100회). 내일 다시 해 주세요.`);
  }
  return yk.key;
}

export async function GET(req: Request) {
  try {
    const { email } = await requireShortsUser(req);
    const db = adminDb();
    const [channels, hits, formats, reports, settings, yk] = await Promise.all([
      listWatch(db),
      listHits(db),
      listFormats(db),
      listReports(db, 12),
      getScoutSettings(db),
      youtubeKeyFor(db, email),
    ]);
    const [searchUsed, aiToday] = await Promise.all([
      readQuota(db, yk.source === "personal" ? `ytsearch_${email}_${kstDay()}` : `ytsearch_${kstDay()}`),
      readQuota(db, `scoutai_${kstDay()}`),
    ]);
    return json({
      me: email,
      admin: isShortsAdmin(email),
      channels,
      hits,
      formats,
      reports,
      settings,
      quotas: { youtubeSearch: { used: searchUsed, limit: YT_SEARCH_DAILY_LIMIT, source: yk.source }, autoAnalyzeToday: aiToday },
      companyKey: !!process.env.NEANDER_SHORTS_YOUTUBE_API_KEY?.trim(),
      models: SCOUT_VIDEO_MODELS,
    });
  } catch (e) {
    return fail(e);
  }
}

export async function POST(req: Request) {
  try {
    const { email } = await requireShortsUser(req);
    const db = adminDb();
    const b = (await req.json()) as Record<string, unknown>;
    switch (b.action) {
      // ---- 감시 채널 ----
      case "watch.resolve": {
        const ref = parseYoutubeRef(String(b.ref ?? ""));
        if (!ref) throw new Error("YouTube 채널 주소 · @핸들 · 영상 주소를 넣어 주세요.");
        const channel = await youtubeChannelOf(ref, await ytKey(db, email, false));
        if (!channel) throw new Error("채널을 찾지 못했습니다.");
        return json({ channel });
      }
      case "watch.add": {
        const ref = parseYoutubeRef(String(b.ref ?? ""));
        if (!ref) throw new Error("YouTube 채널 주소 · @핸들 · 영상 주소를 넣어 주세요.");
        const channel = await youtubeChannelOf(ref, await ytKey(db, email, false));
        if (!channel) throw new Error("채널을 찾지 못했습니다.");
        const id = await addWatch(db, email, channel, b);
        return json({ id });
      }
      case "watch.update":
        await updateWatch(db, email, b.id, b.patch);
        return json({ ok: true });
      case "watch.delete":
        await deleteWatch(db, email, b.id);
        return json({ ok: true });
      case "watch.discover": {
        const regionCode = String(b.regionCode ?? "US").toUpperCase();
        const groups = await youtubeDiscoverChannels(
          { query: String(b.query ?? ""), regionCode, language: String(b.language ?? languageOf(regionCode)), days: Number(b.days) || 14 },
          await ytKey(db, email, true),
        );
        const watched = new Set((await listWatch(db)).map((w) => w.channelId));
        return json({ groups: groups.map((g) => ({ ...g, watched: watched.has(g.channel.channelId) })) });
      }
      case "watch.scan": {
        // 지금 훑기 — 하나만(id) 또는 오래 안 훑은 것부터 시간 안에서
        const key = await ytKey(db, email, false);
        const r = await scanDue(db, {
          key,
          by: email,
          deadline: Date.now() + 85_000,
          staleMs: b.force ? 0 : 6 * 3600_000,
          only: typeof b.id === "string" ? b.id : undefined,
        });
        return json(r);
      }

      // ---- 터진 영상 ----
      case "hit.add": {
        const url = String(b.url ?? "").trim();
        const ref = parseYoutubeRef(url);
        if (!ref || ref.kind !== "video") return json({ id: await addManualHit(db, email, b) });
        // YouTube 영상 — 공식 API 로 숫자를 받고, 그 채널 최근 쇼츠로 평소 조회수를 계산한다
        const key = await ytKey(db, email, false);
        const [v] = await youtubeVideos([ref.value], key);
        if (!v) throw new Error("영상을 찾지 못했습니다 (지워졌거나 비공개).");
        const channel = await youtubeChannelOf(ref, key);
        let baseline: number | null = null;
        let baselineRef = "채널을 찾지 못해 평소 조회수를 모름";
        if (channel) {
          const uploads = await youtubeRecentUploads(channel.channelId, key);
          const others = (await youtubeVideos(uploads.map((u) => u.id).filter((id) => id !== v.id), key)).filter((x) => isShortLike(x.duration));
          const base = computeBaseline(others, Date.now());
          baseline = base.value;
          baselineRef = base.value === null ? "그 채널 쇼츠가 모자라 평소 조회수를 모름" : `그 채널 최근 쇼츠 ${base.n}편 조회수 중앙값${base.basis === "young" ? " (어린 영상 포함)" : ""}`;
        }
        const watched = channel ? (await listWatch(db)).find((w) => w.channelId === channel.channelId) : undefined;
        const country = /^[A-Z]{2}$/.test(String(b.country ?? "")) ? String(b.country) : watched?.country || channel?.country || "";
        await upsertHitFromApi(
          db,
          email,
          {
            videoId: v.id,
            url: v.url,
            title: v.title,
            channel: v.channel,
            thumbnail: v.thumbnail,
            publishedAt: v.publishedAt || null,
            duration: v.duration,
            views: v.views,
            likes: v.likes,
            comments: v.comments,
            baseline,
            baselineRef,
            watchId: channel && watched ? watchIdOf(channel.channelId) : null,
            country,
            language: watched?.language || channel?.language || (country ? languageOf(country) : ""),
          },
          { create: true, found: "manual" },
        );
        const id = `yt_${v.id}`;
        if (b.note) await updateHit(db, email, id, { note: b.note });
        return json({ id });
      }
      case "hit.update":
        await updateHit(db, email, b.id, b.patch);
        return json({ ok: true });
      case "hit.delete":
        await deleteHit(db, email, b.id);
        return json({ ok: true });
      case "hit.analyze": {
        const key = await ytKey(db, email, false).catch(() => undefined);
        const r = await analyzeHit(db, email, b.id, { model: b.model, key });
        return json(r);
      }
      case "hit.assign": {
        // formatId: 기존 카드 id · "new"(분석으로 새 카드) · null(묶음 풀기)
        const h = await getHit(db, b.id);
        let formatId = typeof b.formatId === "string" ? b.formatId : null;
        if (formatId === "new") {
          if (!h.analysis) throw new Error("먼저 영상을 분석해 주세요 — 분석 없이 만들려면 형식 카드 탭에서 직접 만드세요.");
          formatId = await formatFromAnalysis(db, email, h.analysis);
        }
        await assignHit(db, email, h.id, formatId);
        return json({ formatId });
      }
      case "hit.koreanComments": {
        const h = await getHit(db, b.id);
        if (h.platform !== "youtube" || !h.externalId) throw new Error("YouTube 영상만 댓글 표본을 읽을 수 있습니다.");
        const comments = await youtubeCommentSample(h.externalId, 100, await ytKey(db, email, false));
        const kc = { ...koreanCommentCount(comments), at: Date.now() };
        await setKoreanComments(db, h.id, kc, email);
        return json(kc);
      }

      // ---- 형식 카드 ----
      case "format.save":
        return json({ id: await saveFormat(db, email, b.id, b.format) });
      case "format.delete":
        await deleteFormat(db, email, b.id);
        return json({ ok: true });
      case "format.koreaSearch": {
        const f = await getFormat(db, b.id);
        const query = String(b.query ?? f.koreanQueries[0] ?? "").trim();
        if (!query) throw new Error("국내 검색어를 넣어 주세요.");
        const items = await youtubeSearch({ query, regionCode: "KR", language: "ko", days: Number(b.days) || 90, max: 25 }, await ytKey(db, email, true));
        await patchFormatKorea(db, email, f.id, {
          ...f.korea,
          query,
          lastSearch: {
            query,
            at: Date.now(),
            results: items.map((i) => ({ id: i.id, url: i.url, title: i.title, channel: i.channel, views: i.views, publishedAt: i.publishedAt || null, thumbnail: i.thumbnail })),
          },
        });
        return json({ items });
      }
      case "format.koreaMark": {
        // 사람이 표본에서 같은 형식을 고른다 — 고른 게 없으면 「국내 표본에 없음」 (미확산 단정 아님)
        const f = await getFormat(db, b.id);
        const last = f.korea.lastSearch;
        if (!last) throw new Error("먼저 국내 검색을 해 주세요.");
        const pick = new Set((Array.isArray(b.videoIds) ? b.videoIds : []).map(String));
        const matches = last.results.filter((r) => pick.has(r.id)).map((r) => ({ url: r.url, title: r.title, views: r.views, publishedAt: r.publishedAt }));
        const asked = String(b.status ?? "");
        const status: KoreaStatus = !matches.length ? "none_in_sample" : asked === "spread" ? "spread" : "some";
        await patchFormatKorea(db, email, f.id, {
          ...f.korea,
          status,
          query: last.query,
          checkedAt: Date.now(),
          by: email,
          sampleSize: last.results.length,
          matches,
          note: String(b.note ?? f.korea.note ?? "").slice(0, 1000),
        });
        return json({ status });
      }

      // ---- 주간 보고 · 설정 ----
      case "report.build":
        return json({ week: await buildWeeklyReport(db, email) });
      case "report.narrate":
        return json(await narrateWeeklyReport(db, email, b.week, b.model));
      case "settings.save":
        return json({ settings: await saveScoutSettings(db, email, b.settings) });

      default:
        throw new Error("알 수 없는 동작입니다.");
    }
  } catch (e) {
    return fail(e);
  }
}
