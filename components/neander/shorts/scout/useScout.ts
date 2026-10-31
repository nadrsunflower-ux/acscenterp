"use client";

// 바이럴 형식 정찰 자료 — 정찰 화면에서만 받는다 (쇼핑쇼츠 워크스페이스 자료와 따로)
import { useCallback, useEffect, useState } from "react";
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
  quotas: { youtubeSearch: { used: number; limit: number; source: "personal" | "company" | null }; autoAnalyzeToday: number };
  companyKey: boolean;
  models: readonly { id: string; label: string }[];
}

let cache: ScoutData | null = null;

export function useScoutData() {
  const [data, setData] = useState<ScoutData | null>(cache);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try {
      const d = await shortsGet<ScoutData>("scout");
      cache = d;
      setData(d);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "정찰 자료를 불러오지 못했습니다.");
    }
  }, []);
  useEffect(() => {
    void refresh();
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);
  return { data, error, refresh };
}

export const scout = <T = { ok: true }>(action: string, body: object = {}) => shortsPost<T>("scout", { action, ...body });
