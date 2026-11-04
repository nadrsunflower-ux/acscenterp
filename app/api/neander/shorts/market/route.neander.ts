import { adminDb } from "@/lib/neander/server/admin";
import { requestDb } from "@/lib/neander/shorts/server/space-db";
import { AccessError } from "@/lib/neander/server/auth";
import { isShortsAdmin, requireShortsUser } from "@/lib/neander/shorts/server/access";
import { openrouterConfigured } from "@/lib/neander/shorts/server/ai";
import { fail, json } from "@/lib/neander/shorts/server/http";
import {
  compareTrend,
  deleteNote,
  getBrief,
  getGroupSeries,
  getMarketSettings,
  listBriefDays,
  listChannelStats,
  listNotes,
  radarProductTrends,
  refreshGroupSeries,
  runMarketBrief,
  runMarketDaily,
  saveMarketSettings,
  saveNote,
  snapshotChannels,
} from "@/lib/neander/shorts/server/market";
import { naverConfig } from "@/lib/neander/shorts/server/naver";
import { USD_KRW } from "@/lib/neander/shorts/radar";
import { kstDay, listRadar } from "@/lib/neander/shorts/server/radar-run";
import { listHits, listWatch } from "@/lib/neander/shorts/server/scout-store";
import { NEANDER_COL } from "@/lib/neander/collections";
import { youtubeApiKey } from "@/lib/neander/shorts/server/youtube-data";
import { titleTrends } from "@/lib/neander/shorts/server/title-trends";
import { getBriefMailState, listBriefDigests, previewBriefMail, saveBriefMailPref, sendBriefMailTest } from "@/lib/neander/shorts/server/brief-mail";
import { publicOrigin } from "@/lib/neander/mail/server/track";

// 시장 트렌드 — 브리핑 · 검색어 추이 · 채널 모니터링 · 트렌드 노트 (shorts/market.ts)
//   GET  전체 · ?brief=<날짜> · ?compare=1&groups=a,b&range=1y&unit=week&mode=groups|segments
//   POST settings.save(관리자) · run · brief.run · series.refresh · channels.snapshot · note.save · note.delete
//        titles.get(제목 키워드 · 읽기 · shorts/title-trends.ts)
//        briefs.list(대시보드 — 볼 수 있는 모든 프로젝트의 오늘 브리핑 · 읽기)
//        briefmail.get · briefmail.preview(읽기 · 보내지 않음) · briefmail.save · briefmail.test(내게쓰기 한 통 — 사람이 누를 때만)
//        브리핑 · 메일 동작은 프로젝트를 넘나들어(사람별) 고른 프로젝트 머리글과 상관없이 처리한다 (shorts/brief-mail.ts)
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  try {
    const { email } = await requireShortsUser(req);
    const db = await requestDb(req, adminDb(), email);
    const u = new URL(req.url);
    if (u.searchParams.has("compare")) {
      return json(
        await compareTrend(db, {
          groupIds: (u.searchParams.get("groups") ?? "").split(",").filter(Boolean),
          range: (u.searchParams.get("range") as "3m" | "6m" | "1y") ?? "1y",
          unit: u.searchParams.get("unit") === "month" ? "month" : "week",
          mode: u.searchParams.get("mode") === "segments" ? "segments" : "groups",
        }),
      );
    }
    const day = u.searchParams.get("brief");
    if (day) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error("날짜가 올바르지 않습니다.");
      return json({ brief: await getBrief(db, day) });
    }
    const today = kstDay();
    const [settings, briefDays, series, radar, channels, watch, hits, notes, spent] = await Promise.all([
      getMarketSettings(db),
      listBriefDays(db),
      getGroupSeries(db),
      listRadar(db),
      listChannelStats(db),
      listWatch(db),
      listHits(db),
      listNotes(db, email),
      db.collection(NEANDER_COL.shortsSettings).doc(`usage_marketusd_${today}`).get(),
    ]);
    const latestDay = briefDays[0]?.day ?? null;
    const brief = latestDay ? await getBrief(db, latestDay) : null;
    const weekAgo = Date.now() - 7 * 86_400_000;
    const hits7 = new Map<string, number>();
    for (const h of hits) if (h.watchId && h.createdAt >= weekAgo && h.status !== "dismissed") hits7.set(h.watchId, (hits7.get(h.watchId) ?? 0) + 1);
    return json({
      me: email,
      admin: isShortsAdmin(email),
      today,
      settings,
      ready: { naver: naverConfig().configured, youtube: !!youtubeApiKey(), ai: openrouterConfigured() },
      spentKrwToday: Math.round((Number((spent.data() as { usd?: number } | undefined)?.usd) || 0) * USD_KRW),
      brief,
      briefDays,
      series,
      productTrends: radarProductTrends(radar),
      channels,
      // 감시 채널 — 평소 조회 · 최근 7일 터진 영상 수 (채널 모니터링 표에 붙인다)
      watch: watch.map((w) => ({ id: w.id, channelId: w.channelId, title: w.title, country: w.country, active: w.active, baseline: w.scan.baseline, scannedAt: w.scan.at, hits7: hits7.get(w.id) ?? 0, topics: w.topics })),
      notes,
    });
  } catch (e) {
    return fail(e);
  }
}

/** 메일 속 「ERP 에서 보기」 주소의 앞 — 배포 주소 (로컬은 요청 주소 그대로) */
const originOf = (req: Request) => publicOrigin(req) ?? new URL(req.url).origin;

export async function POST(req: Request) {
  try {
    const { email } = await requireShortsUser(req);
    const b = (await req.json()) as Record<string, unknown>;
    // 사람별 · 모든 프로젝트 — 지금 고른 프로젝트로 감싸지 않는다 (권한은 listSpacesFor 가 프로젝트마다 본다)
    switch (b.action) {
      case "briefs.list":
        return json(await listBriefDigests(adminDb(), email));
      case "briefmail.get":
        return json({ state: await getBriefMailState(adminDb(), email) });
      case "briefmail.preview":
        return json({ preview: await previewBriefMail(adminDb(), email, originOf(req), b.draft ?? undefined) });
      case "briefmail.save":
        return json({ state: await saveBriefMailPref(adminDb(), email, b.pref) });
      case "briefmail.test":
        return json({ sent: await sendBriefMailTest(adminDb(), email, originOf(req)), state: await getBriefMailState(adminDb(), email) });
    }
    const db = await requestDb(req, adminDb(), email);
    switch (b.action) {
      case "titles.get":
        return json(await titleTrends(db, b));
      case "settings.save":
        if (!isShortsAdmin(email)) throw new AccessError(403, "시장 트렌드 설정은 AI STUDIO 관리자만 바꿉니다.");
        return json({ settings: await saveMarketSettings(db, email, b.settings) });
      case "run":
        return json(await runMarketDaily(db, { by: email, deadline: Date.now() + 280_000 }));
      case "brief.run":
        return json({ brief: await runMarketBrief(db, { by: email, deadline: Date.now() + 110_000 }) });
      case "series.refresh": {
        const notes: string[] = [];
        const calls = await refreshGroupSeries(db, await getMarketSettings(db), { deadline: Date.now() + 100_000 }, notes);
        return json({ calls, notes, series: await getGroupSeries(db) });
      }
      case "channels.snapshot": {
        const notes: string[] = [];
        const r = await snapshotChannels(db, { by: email, deadline: Date.now() + 100_000 }, notes);
        return json({ ...r, notes });
      }
      case "note.save":
        return json({ note: await saveNote(db, email, b.id ?? null, b.note) });
      case "note.delete":
        await deleteNote(db, email, b.id);
        return json({ ok: true });
      default:
        throw new Error("알 수 없는 동작입니다.");
    }
  } catch (e) {
    return fail(e);
  }
}
