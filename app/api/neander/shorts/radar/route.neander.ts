import { adminDb } from "@/lib/neander/server/admin";
import { AccessError } from "@/lib/neander/server/auth";
import { isShortsAdmin, requireShortsUser } from "@/lib/neander/shorts/server/access";
import { openrouterConfigured } from "@/lib/neander/shorts/server/ai";
import { fail, json } from "@/lib/neander/shorts/server/http";
import { naverConfig } from "@/lib/neander/shorts/server/naver";
import {
  getRadarLast,
  getRadarSettings,
  kstDay,
  listRadar,
  radarToday,
  runRadar,
  saveRadarAsTrend,
  saveRadarSettings,
  setRadarDismissed,
} from "@/lib/neander/shorts/server/radar-run";
import { readQuota } from "@/lib/neander/shorts/server/store";
import { YT_SEARCH_DAILY_LIMIT, youtubeApiKey } from "@/lib/neander/shorts/server/youtube-data";

// AI 레이더 — 키워드로 훑은 반응 큰 쇼츠 후보 (회사 공용 · shorts/radar.ts)
// 돌리기는 회사 YouTube 키 · 회사 AI 상한으로만 한다. 설정은 AI STUDIO 관리자만 바꾼다.
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(req: Request) {
  try {
    const { email } = await requireShortsUser(req);
    const db = adminDb();
    const settings = await getRadarSettings(db);
    const [items, last, today, searchUsed] = await Promise.all([listRadar(db), getRadarLast(db), radarToday(db, settings), readQuota(db, `ytsearch_${kstDay()}`)]);
    return json({
      me: email,
      admin: isShortsAdmin(email),
      settings,
      last,
      today: { ...today, searchUsed, searchLimit: YT_SEARCH_DAILY_LIMIT },
      ready: { youtube: !!youtubeApiKey(), ai: openrouterConfigured(), naver: naverConfig().configured },
      items,
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
      case "run":
        return json({ summary: await runRadar(db, { by: email, deadline: Date.now() + 105_000, force: true }) });
      case "save":
        return json({ trendId: await saveRadarAsTrend(db, email, b.id, b.visibility) });
      case "dismiss":
        await setRadarDismissed(db, email, b.id, b.dismissed !== false);
        return json({ ok: true });
      case "settings.save":
        if (!isShortsAdmin(email)) throw new AccessError(403, "레이더 설정은 AI STUDIO 관리자만 바꿉니다.");
        return json({ settings: await saveRadarSettings(db, email, b.settings) });
      default:
        throw new Error("알 수 없는 동작입니다.");
    }
  } catch (e) {
    return fail(e);
  }
}
