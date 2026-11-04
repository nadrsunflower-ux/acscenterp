"use client";

// 바이럴 형식 정찰 자료 — 정찰 화면에서만 받는다 (쇼핑쇼츠 워크스페이스 자료와 따로)
// 자료는 프로젝트마다 따로다(요청 머리글의 지금 프로젝트) — 앞서 본 것을 먼저 보여 줄 때도 같은 프로젝트 것만.
import { useCallback, useEffect, useState } from "react";
import { useShorts } from "@/components/neander/shorts/ShortsProvider";
import { shortsGet, shortsPost } from "@/lib/neander/shorts/client";
import type { FormatDoc, HitDoc, ScoutReportDoc, ScoutSettings, WatchChannelDoc } from "@/lib/neander/shorts/scout";

export type WithId<T> = T & { id: string };

export interface ScoutData {
  me: string;
  admin: boolean;
  channels: WithId<WatchChannelDoc>[];
  hits: WithId<HitDoc>[];
  formats: WithId<FormatDoc>[];
  reports: ScoutReportDoc[];
  settings: ScoutSettings;
  quotas: {
    youtubeSearch: { used: number; limit: number; source: "personal" | "company" | null };
    autoAnalyzeToday: number;
    /** 감시 채널 「터진 영상 vs 평소」 비교 — 프로젝트마다 하루 상한 */
    channelCompare?: { used: number; limit: number };
  };
  companyKey: boolean;
  models: readonly { id: string; label: string }[];
}

/** 프로젝트별로 마지막에 받은 자료 — 다른 프로젝트 자료를 잠깐이라도 섞어 보이지 않게 */
const cache = new Map<string, ScoutData>();

export function useScoutData() {
  const { space } = useShorts();
  const [data, setData] = useState<ScoutData | null>(() => cache.get(space) ?? null);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try {
      const d = await shortsGet<ScoutData>("scout");
      cache.set(space, d);
      setData(d);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "정찰 자료를 불러오지 못했습니다.");
    }
  }, [space]);
  useEffect(() => {
    void refresh();
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);
  return { data, error, refresh };
}

export const scout = <T = { ok: true }>(action: string, body: object = {}) => shortsPost<T>("scout", { action, ...body });
