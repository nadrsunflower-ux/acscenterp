import "server-only";

// 서버 연결 상태 — 값은 보내지 않는다. 있음/없음과 빠진 환경변수 이름만.
// 「설정됨」 은 값이 있다는 뜻일 뿐 계정 · 권한 · 할당량을 확인했다는 뜻이 아니다.

import type { Firestore } from "firebase-admin/firestore";
import type { IntegrationStatus } from "../types";
import { shortsAllowlist } from "./access";
import { openrouterConfigured } from "./ai";
import { coupangConfig } from "./coupang";
import { quotaBytes, usedBytes } from "./media";
import { googleConfig, metaConfig } from "./platforms";
import { tokenKeyConfigured } from "./secret";
import { youtubeApiKey } from "./youtube-data";

export async function integrationStatus(db: Firestore): Promise<IntegrationStatus> {
  const g = googleConfig();
  const m = metaConfig();
  const c = coupangConfig();
  const used = await usedBytes(db).catch(() => 0);
  return {
    openrouter: { configured: openrouterConfigured() },
    youtubeSearch: { configured: !!youtubeApiKey(), missing: youtubeApiKey() ? [] : ["NEANDER_SHORTS_YOUTUBE_API_KEY"] },
    youtubeOAuth: { configured: g.configured, missing: g.missing },
    meta: { configured: m.configured, missing: m.missing },
    coupang: { configured: c.configured, missing: c.missing },
    tokenKey: tokenKeyConfigured(),
    cron: { configured: !!process.env.CRON_SECRET?.trim() },
    companyCoupang: { configured: c.configured },
    storage: { driver: "firestore-chunks", quotaMb: Math.round(quotaBytes() / 1024 / 1024), usedMb: Math.round((used / 1024 / 1024) * 10) / 10 },
    allowlist: { restricted: shortsAllowlist().length > 0 },
  };
}
